import { readFileSync } from "node:fs";
import {
  ACCESS_MODES,
  PARENTS,
  PROVIDERS,
  UsageError,
  type AccessMode,
  type Parent,
  type Provider,
} from "../runner/types.ts";
import {
  ModelPolicyError,
  eventAdvancesUnderPolicy,
  nextAttempt,
  parseSheet,
  resolveRole,
  validateSheet,
  type AttemptEvent,
  type AttemptOutcomeStatus,
  type LanePolicy,
  type RolePolicy,
} from "./model-policy.ts";
import { normalizeReceiptEvent } from "./receipt-event.ts";

const HELP = `Usage: pstack-model-policy <command> [options]

Commands:
  resolve --sheet <file> --role "<role row or leaf role>" --parent <claude|codex>
      Print the role's resolved lane chains as JSON. A missing sheet or missing
      role in a legacy sheet prints {"status":"unconfigured"} so the caller uses its documented
      default. A malformed sheet or a sheet that cannot be read is an error.
  next --sheet <file> --role "<role row or leaf role>" --parent <claude|codex> \
       --state <file> [--lane <index>]
      Apply the shared finite decision to one lane and print the outcome as
      JSON: launch, stop, or inspect. The state file is a JSON object:
      {"events":[{"attemptIndex":0,"status":"complete|usage-exhausted|
      route-unavailable|terminal-failure|deadline-exceeded|failed",
      "processStarted":true,"inspection":{"state":"clear|unsafe",
      "evidenceRef":"..."},"receiptPath":"..."}...],
      "exhaustedGroups":["provider"...],
      "access":"read-only|isolated-write"}. exhaustedGroups defaults to [] and
      access is required. Every earlier event must have been able to advance
      under the lane's saved # fallback policy (or the quota-only default).
      This helper only decides; the parent owns dispatch, evidence, and
      writer isolation.
  normalize --sheet <file> --role "<role row or leaf role>" --parent <claude|codex> \
            --lane <index> --attempt <index> --receipt <file> --mode <read-only|isolated-write>
      Read one runner receipt and print the lane event it proves as JSON. The
      receipt's parent, provider, model, effort, access mode, and recorded
      apiSpend must exactly match the authorized attempt at that index and
      its saved access fact; terminal statuses normalize through the shared
      mapping and a receipt path is preserved on the event. Native lanes have
      no runner receipt: normalize them only from explicit host terminal
      metadata.
  validate --sheet <file> --parent <claude|codex>
      Strict-parse the sheet, require every documented role row, panel
      minimums, chain limits, and access-fact fields, then resolve every row
      for the given parent: each configured route must carry an authorized
      access fact and no two attempts may resolve to the parent account.
      Exits nonzero with the issue list when the sheet could not be written
      by setup.

This helper only reads the model sheet and the state file. It never probes
providers, reads credentials, selects models, or launches anything.
`;

interface Io {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: Io = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function optionValue(
  name: string,
  argv: readonly string[],
  index: number
): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${name} requires a value`);
  }
  return value;
}

function parseParent(value: string | undefined): Parent {
  if (value === undefined || !(PARENTS as readonly string[]).includes(value)) {
    throw new UsageError(`--parent must be one of: ${PARENTS.join(", ")}`);
  }
  return value as Parent;
}

type OptionalSheet =
  | { readonly kind: "loaded"; readonly text: string }
  | { readonly kind: "missing"; readonly reason: string };

function readOptionalSheet(path: string): OptionalSheet {
  try {
    return { kind: "loaded", text: readFileSync(path, "utf8") };
  } catch (error) {
    const code =
      error !== null && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
    if (code === "ENOENT") {
      return { kind: "missing", reason: `sheet not found: ${path}` };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`cannot read sheet ${path}: ${message}`);
  }
}

interface DecisionState {
  readonly events: readonly AttemptEvent[];
  readonly exhaustedGroups: ReadonlySet<Provider>;
  readonly access: AccessMode;
}

const EVENT_STATUSES = [
  "complete",
  "usage-exhausted",
  "route-unavailable",
  "terminal-failure",
  "deadline-exceeded",
  "failed",
] as const;

const INSPECTION_STATES = ["clear", "unsafe"] as const;

function parseDecisionState(path: string): DecisionState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`cannot read decision state ${path}: ${message}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new UsageError(`decision state is not valid JSON: ${path}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageError("decision state must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["events", "exhaustedGroups", "access"].includes(key)) {
      throw new UsageError(`decision state has unknown key ${JSON.stringify(key)}`);
    }
  }
  if (!Array.isArray(record.events)) {
    throw new UsageError('decision state requires an "events" array');
  }
  const events = record.events.map((event, index): AttemptEvent => {
    if (event === null || typeof event !== "object" || Array.isArray(event)) {
      throw new UsageError(`events[${index}] must be an object`);
    }
    const entry = event as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (!["attemptIndex", "status", "processStarted", "inspection", "receiptPath"].includes(key)) {
        throw new UsageError(`events[${index}] has unknown key ${JSON.stringify(key)}`);
      }
    }
    if (
      typeof entry.attemptIndex !== "number" ||
      !Number.isInteger(entry.attemptIndex) ||
      entry.attemptIndex < 0
    ) {
      throw new UsageError(`events[${index}].attemptIndex must be a nonnegative integer`);
    }
    if (
      typeof entry.status !== "string" ||
      !(EVENT_STATUSES as readonly string[]).includes(entry.status)
    ) {
      throw new UsageError(
        `events[${index}].status must be one of ${EVENT_STATUSES.join(", ")}`
      );
    }
    if (entry.processStarted !== undefined && typeof entry.processStarted !== "boolean") {
      throw new UsageError(`events[${index}].processStarted must be a boolean`);
    }
    let inspection: AttemptEvent["inspection"];
    if (entry.inspection !== undefined) {
      const record = entry.inspection;
      if (record === null || typeof record !== "object" || Array.isArray(record)) {
        throw new UsageError(`events[${index}].inspection must be an object`);
      }
      const value = record as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (!["state", "evidenceRef"].includes(key)) {
          throw new UsageError(`events[${index}].inspection has unknown key ${JSON.stringify(key)}`);
        }
      }
      if (
        typeof value.state !== "string" ||
        !(INSPECTION_STATES as readonly string[]).includes(value.state)
      ) {
        throw new UsageError(
          `events[${index}].inspection.state must be one of ${INSPECTION_STATES.join(", ")}`
        );
      }
      if (typeof value.evidenceRef !== "string" || value.evidenceRef.trim().length === 0) {
        throw new UsageError(
          `events[${index}].inspection.evidenceRef must be a nonempty string`
        );
      }
      inspection = {
        state: value.state as "clear" | "unsafe",
        evidenceRef: value.evidenceRef,
      };
    }
    if (entry.receiptPath !== undefined && typeof entry.receiptPath !== "string") {
      throw new UsageError(`events[${index}].receiptPath must be a string`);
    }
    return {
      attemptIndex: entry.attemptIndex,
      status: entry.status as AttemptOutcomeStatus,
      processStarted: entry.processStarted as boolean | undefined,
      inspection,
      receiptPath: entry.receiptPath as string | undefined,
    };
  });
  if (
    record.exhaustedGroups !== undefined &&
    (!Array.isArray(record.exhaustedGroups) ||
      record.exhaustedGroups.some(
        (group) =>
          typeof group !== "string" ||
          !(PROVIDERS as readonly string[]).includes(group)
      ))
  ) {
    throw new UsageError(
      `decision state "exhaustedGroups" must be an array of: ${PROVIDERS.join(", ")}`
    );
  }
  if (
    typeof record.access !== "string" ||
    !(ACCESS_MODES as readonly string[]).includes(record.access)
  ) {
    throw new UsageError(`decision state "access" must be one of ${ACCESS_MODES.join(", ")}`);
  }
  return {
    events,
    exhaustedGroups: new Set((record.exhaustedGroups ?? []) as Provider[]),
    access: record.access as AccessMode,
  };
}

interface ResolvedTarget {
  readonly model: ReturnType<typeof parseSheet>;
  readonly policy: RolePolicy;
}

function resolveTarget(
  sheet: string,
  role: string,
  parent: Parent,
  io: Io
): ResolvedTarget | null {
  const loaded = readOptionalSheet(sheet);
  if (loaded.kind === "missing") {
    io.stdout(`${JSON.stringify({ status: "unconfigured", role, reason: loaded.reason })}\n`);
    return null;
  }
  const text = loaded.text;
  const model = parseSheet(text);
  const policy = resolveRole(model, role, parent);
  if (policy === null) {
    io.stdout(`${JSON.stringify({ status: "unconfigured", role })}\n`);
    return null;
  }
  return { model, policy };
}

function commandResolve(argv: readonly string[], io: Io): number {
  let sheet: string | undefined;
  let role: string | undefined;
  let parent: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--sheet":
        sheet = optionValue("--sheet", argv, i);
        i += 1;
        break;
      case "--role":
        role = optionValue("--role", argv, i);
        i += 1;
        break;
      case "--parent":
        parent = optionValue("--parent", argv, i);
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (sheet === undefined) throw new UsageError("--sheet is required");
  if (role === undefined) throw new UsageError("--role is required");
  const resolvedParent = parseParent(parent);

  const target = resolveTarget(sheet, role, resolvedParent, io);
  if (target === null) return 0;
  io.stdout(`${JSON.stringify({ status: "resolved", ...target.policy }, null, 2)}\n`);
  return 0;
}

function commandNext(argv: readonly string[], io: Io): number {
  let sheet: string | undefined;
  let role: string | undefined;
  let parent: string | undefined;
  let state: string | undefined;
  let lane = "0";
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--sheet":
        sheet = optionValue("--sheet", argv, i);
        i += 1;
        break;
      case "--role":
        role = optionValue("--role", argv, i);
        i += 1;
        break;
      case "--parent":
        parent = optionValue("--parent", argv, i);
        i += 1;
        break;
      case "--state":
        state = optionValue("--state", argv, i);
        i += 1;
        break;
      case "--lane":
        lane = optionValue("--lane", argv, i);
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (sheet === undefined) throw new UsageError("--sheet is required");
  if (role === undefined) throw new UsageError("--role is required");
  if (state === undefined) throw new UsageError("--state is required");
  const resolvedParent = parseParent(parent);
  const laneIndex = Number(lane);
  if (!Number.isInteger(laneIndex) || laneIndex < 0) {
    throw new UsageError("--lane must be a nonnegative integer");
  }

  const decision = parseDecisionState(state);
  const target = resolveTarget(sheet, role, resolvedParent, io);
  if (target === null) return 0;
  const lanePolicy: LanePolicy | undefined = target.policy.lanes[laneIndex];
  if (lanePolicy === undefined) {
    throw new UsageError(
      `lane ${laneIndex} is out of range; ${target.policy.header} has ${target.policy.lanes.length} lane(s)`
    );
  }
  let previous: AttemptEvent | undefined;
  for (const event of decision.events) {
    if (event.attemptIndex >= lanePolicy.attempts.length) {
      throw new UsageError("event attemptIndex is out of range for this lane");
    }
    if (lanePolicy.attempts[event.attemptIndex].authorization.state === "blocked") {
      throw new UsageError("event history records an attempt the saved policy does not authorize");
    }
    if (previous !== undefined) {
      if (event.attemptIndex <= previous.attemptIndex) {
        throw new UsageError("events must have unique, increasing attempt indices");
      }
      if (!eventAdvancesUnderPolicy(lanePolicy, previous, decision.access)) {
        throw new UsageError(
          "events contain an attempt after an outcome the saved policy could not advance, or a started writer without a clear inspection"
        );
      }
    }
    for (let skipped = (previous?.attemptIndex ?? -1) + 1; skipped < event.attemptIndex; skipped += 1) {
      const skippedAttempt = lanePolicy.attempts[skipped];
      if (skippedAttempt.authorization.state === "blocked") {
        throw new UsageError("event history skips an unauthorized attempt");
      }
      if (!decision.exhaustedGroups.has(skippedAttempt.exhaustionGroup)) {
        throw new UsageError("event history skips an attempt whose provider is not exhausted");
      }
    }
    previous = event;
  }
  const outcome = nextAttempt(
    lanePolicy,
    decision.events,
    decision.exhaustedGroups,
    decision.access
  );
  io.stdout(
    `${JSON.stringify(
      {
        status: "decision",
        role,
        header: target.policy.header,
        laneIndex,
        lane: lanePolicy.id,
        decision: outcome,
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function commandNormalize(argv: readonly string[], io: Io): number {
  let sheet: string | undefined;
  let role: string | undefined;
  let parent: string | undefined;
  let receiptPath: string | undefined;
  let mode: string | undefined;
  let lane = "0";
  let attempt = "0";
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--sheet":
        sheet = optionValue("--sheet", argv, i);
        i += 1;
        break;
      case "--role":
        role = optionValue("--role", argv, i);
        i += 1;
        break;
      case "--parent":
        parent = optionValue("--parent", argv, i);
        i += 1;
        break;
      case "--lane":
        lane = optionValue("--lane", argv, i);
        i += 1;
        break;
      case "--attempt":
        attempt = optionValue("--attempt", argv, i);
        i += 1;
        break;
      case "--receipt":
        receiptPath = optionValue("--receipt", argv, i);
        i += 1;
        break;
      case "--mode":
        mode = optionValue("--mode", argv, i);
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (sheet === undefined) throw new UsageError("--sheet is required");
  if (role === undefined) throw new UsageError("--role is required");
  if (receiptPath === undefined) throw new UsageError("--receipt is required");
  if (mode === undefined || !(ACCESS_MODES as readonly string[]).includes(mode)) {
    throw new UsageError(`--mode must be one of: ${ACCESS_MODES.join(", ")}`);
  }
  const resolvedParent = parseParent(parent);
  const laneIndex = Number(lane);
  const attemptIndex = Number(attempt);
  if (!Number.isInteger(laneIndex) || laneIndex < 0) {
    throw new UsageError("--lane must be a nonnegative integer");
  }
  if (!Number.isInteger(attemptIndex) || attemptIndex < 0) {
    throw new UsageError("--attempt must be a nonnegative integer");
  }

  const target = resolveTarget(sheet, role, resolvedParent, io);
  if (target === null) return 0;
  const lanePolicy: LanePolicy | undefined = target.policy.lanes[laneIndex];
  if (lanePolicy === undefined) {
    throw new UsageError(
      `lane ${laneIndex} is out of range; ${target.policy.header} has ${target.policy.lanes.length} lane(s)`
    );
  }
  const attemptPolicy = lanePolicy.attempts[attemptIndex];
  if (attemptPolicy === undefined) {
    throw new UsageError(
      `attempt ${attemptIndex} is out of range; lane ${laneIndex} has ${lanePolicy.attempts.length} attempt(s)`
    );
  }
  if (attemptPolicy.attempt.kind !== "descriptor" || attemptPolicy.route === "native") {
    throw new UsageError(
      `attempt ${attemptIndex} (${attemptPolicy.descriptor}) is a native lane; normalize native lanes only from explicit host terminal metadata, never a runner receipt or generated prose`
    );
  }
  const descriptor = attemptPolicy.attempt;

  let text: string;
  try {
    text = readFileSync(receiptPath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`cannot read receipt ${receiptPath}: ${message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new UsageError(`receipt is not valid JSON: ${receiptPath}`);
  }
  const normalized = normalizeReceiptEvent(raw, {
    parent: resolvedParent,
    provider: descriptor.provider,
    model: descriptor.model,
    effort: descriptor.effort,
    mode: mode as AccessMode,
    apiSpend: attemptPolicy.apiSpend,
  });
  const event: AttemptEvent = {
    attemptIndex,
    status: normalized.status,
    ...(normalized.processStarted === undefined
      ? {}
      : { processStarted: normalized.processStarted }),
    receiptPath,
  };
  io.stdout(
    `${JSON.stringify(
      {
        status: "event",
        role,
        header: target.policy.header,
        laneIndex,
        lane: lanePolicy.id,
        attempt: attemptPolicy.descriptor,
        event,
      },
      null,
      2
    )}\n`
  );
  return 0;
}

function commandValidate(argv: readonly string[], io: Io): number {
  let sheet: string | undefined;
  let parent: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--sheet":
        sheet = optionValue("--sheet", argv, i);
        i += 1;
        break;
      case "--parent":
        parent = optionValue("--parent", argv, i);
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (sheet === undefined) throw new UsageError("--sheet is required");
  const resolvedParent = parseParent(parent);
  const loaded = readOptionalSheet(sheet);
  if (loaded.kind === "missing") throw new UsageError(loaded.reason);
  const model = parseSheet(loaded.text);
  validateSheet(model, resolvedParent);
  io.stdout(`${JSON.stringify({ status: "valid", roles: model.rows.length })}\n`);
  return 0;
}

export function main(
  argv: readonly string[],
  io: Io = defaultIo
): number {
  try {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h") {
      io.stdout(HELP);
      return 0;
    }
    if (command === "resolve") return commandResolve(argv.slice(1), io);
    if (command === "next") return commandNext(argv.slice(1), io);
    if (command === "normalize") return commandNormalize(argv.slice(1), io);
    if (command === "validate") return commandValidate(argv.slice(1), io);
    throw new UsageError(`unknown command: ${command}`);
  } catch (error) {
    if (error instanceof ModelPolicyError) {
      io.stderr(`invalid model sheet:\n${error.message}\n`);
      return 65;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    io.stderr(HELP);
    return 64;
  }
}
