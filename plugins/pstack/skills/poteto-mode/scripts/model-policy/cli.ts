import { readFileSync } from "node:fs";
import {
  ACCESS_MODES,
  PARENTS,
  PROVIDERS,
  WORKER_CONTRACT_MODES,
  UsageError,
  type AccessMode,
  type Parent,
  type Provider,
} from "../runner/types.ts";
import {
  ModelPolicyError,
  eventAdvancesUnderPolicy,
  eventSuccessorAuthorized,
  nextAttempt,
  parseSheet,
  resolveRole,
  validateSheet,
  type AttemptEvent,
  type AttemptOutcomeStatus,
  type DeniedCause,
  type LanePolicy,
  type RolePolicy,
} from "./model-policy.ts";
import { PARENT_OPERATION_KINDS, type ParentOperationKind } from "../runner/types.ts";
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
      JSON: launch, continue, parent-operation, stop, policy-denied, or
      inspect. The state file is a JSON object:
      {"events":[{"attemptIndex":0,"status":"complete|usage-exhausted|
      route-unavailable|terminal-failure|deadline-exceeded|failed|
      permission-blocked|needs-parent-operation",
      "processStarted":true,"inspection":{"state":"clear|unsafe|none",
      "evidenceRef":"..."},"receiptPath":"...",
      "continuationOrdinal":0,"deniedCause":"permission|unsupported-tool|
      changed-files|guard|other","execution":{"id":"...","outputPath":"...",
      "receiptPath":"...","workspacePath":"...","descriptor":"...",
      "apiSpend":"deny|approved|unset","access":"read-only|isolated-write",
      "contract":"legacy|strict"},
      "recovery":{"correction":"...","blockageId":"...","snapshotRef":"...",
      "snapshotDigest":"<sha256>","partialWorkRef":"...","sideEffectsRef":"...",
      "stoppedWritersRef":"...","nextExecution":{"...":"..."}},
      "handoff":{"operation":"commit-checkpoint|run-checks","taskId":"...",
      "checkpointId":"...","ref":"..."},
      "parentOperation":{"kind":"commit-checkpoint|run-checks","taskId":"...",
      "checkpointId":"..."}}...],
      "exhaustedGroups":["provider"...],
      "access":"read-only|isolated-write"}. exhaustedGroups defaults to [] and
      access is required. Every adjacent pair must be an advance the saved
      policy permits: fallback outcomes move to a later attempt descriptor,
      permission-blocked moves to a same-attempt continuation only under the
      sheet's # continuation policy, a handoff is followed by exactly the
      parent operation it requested, and a completed operation is followed
      by the continued execution. Events without an explicit
      continuationOrdinal are numbered by position among same-attempt
      executions. This helper only decides; the parent owns dispatch,
      evidence, and writer isolation.
  normalize --sheet <file> --role "<role row or leaf role>" --parent <claude|codex> \
            --lane <index> --attempt <index> --receipt <file> --mode <read-only|isolated-write> [--contract <legacy|strict>]
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
  "permission-blocked",
  "needs-parent-operation",
] as const;

const INSPECTION_STATES = ["clear", "unsafe", "none"] as const;

const DENIED_CAUSES = [
  "none",
  "permission",
  "unsupported-tool",
  "changed-files",
  "guard",
  "other",
] as const;

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
      if (
        ![
          "attemptIndex",
          "status",
          "processStarted",
          "inspection",
          "receiptPath",
          "continuationOrdinal",
          "deniedCause",
          "correction",
          "execution",
          "recovery",
          "handoff",
          "parentOperation",
        ].includes(key)
      ) {
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
        state: value.state as "clear" | "unsafe" | "none",
        evidenceRef: value.evidenceRef,
      };
    }
    if (entry.receiptPath !== undefined && typeof entry.receiptPath !== "string") {
      throw new UsageError(`events[${index}].receiptPath must be a string`);
    }
    if (
      entry.continuationOrdinal !== undefined &&
      (typeof entry.continuationOrdinal !== "number" ||
        !Number.isInteger(entry.continuationOrdinal) ||
        entry.continuationOrdinal < 0)
    ) {
      throw new UsageError(`events[${index}].continuationOrdinal must be a nonnegative integer`);
    }
    if (
      entry.deniedCause !== undefined &&
      (typeof entry.deniedCause !== "string" ||
        !(DENIED_CAUSES as readonly string[]).includes(entry.deniedCause))
    ) {
      throw new UsageError(`events[${index}].deniedCause must be one of ${DENIED_CAUSES.join(", ")}`);
    }
    const parseExecution = (value: unknown, label: string): NonNullable<AttemptEvent["execution"]> => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new UsageError(`${label} must be an object`);
      }
      const item = value as Record<string, unknown>;
      const keys = ["id", "outputPath", "receiptPath", "workspacePath", "descriptor", "apiSpend", "access", "contract"];
      if (Object.keys(item).some((key) => !keys.includes(key)) ||
          ["id", "outputPath", "receiptPath", "workspacePath", "descriptor"].some((key) => typeof item[key] !== "string" || !(item[key] as string).trim()) ||
          !["deny", "approved", "unset"].includes(item.apiSpend as string) ||
          !(ACCESS_MODES as readonly string[]).includes(item.access as string) ||
          !["legacy", "strict"].includes(item.contract as string)) {
        throw new UsageError(`${label} has invalid execution identity`);
      }
      return item as unknown as NonNullable<AttemptEvent["execution"]>;
    };
    const execution = entry.execution === undefined ? undefined : parseExecution(entry.execution, `events[${index}].execution`);
    let recovery: AttemptEvent["recovery"];
    if (entry.recovery !== undefined) {
      if (entry.recovery === null || typeof entry.recovery !== "object" || Array.isArray(entry.recovery)) {
        throw new UsageError(`events[${index}].recovery must be an object`);
      }
      const value = entry.recovery as Record<string, unknown>;
      const keys = ["correction", "blockageId", "snapshotRef", "snapshotDigest", "partialWorkRef", "sideEffectsRef", "stoppedWritersRef", "nextExecution"];
      if (Object.keys(value).some((key) => !keys.includes(key)) ||
          keys.slice(0, -1).some((key) => typeof value[key] !== "string" || !(value[key] as string).trim())) {
        throw new UsageError(`events[${index}].recovery is incomplete`);
      }
      recovery = {
        correction: value.correction as string,
        blockageId: value.blockageId as string,
        snapshotRef: value.snapshotRef as string,
        snapshotDigest: value.snapshotDigest as string,
        partialWorkRef: value.partialWorkRef as string,
        sideEffectsRef: value.sideEffectsRef as string,
        stoppedWritersRef: value.stoppedWritersRef as string,
        nextExecution: parseExecution(value.nextExecution, `events[${index}].recovery.nextExecution`),
      };
    }
    let handoff: AttemptEvent["handoff"];
    if (entry.handoff !== undefined) {
      const request = entry.handoff;
      if (request === null || typeof request !== "object" || Array.isArray(request)) {
        throw new UsageError(`events[${index}].handoff must be an object`);
      }
      const value = request as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (!["operation", "taskId", "checkpointId", "ref"].includes(key)) {
          throw new UsageError(`events[${index}].handoff has unknown key ${JSON.stringify(key)}`);
        }
      }
      if (
        typeof value.operation !== "string" ||
        !(PARENT_OPERATION_KINDS as readonly string[]).includes(value.operation)
      ) {
        throw new UsageError(
          `events[${index}].handoff.operation must be one of ${PARENT_OPERATION_KINDS.join(", ")}`
        );
      }
      if (typeof value.taskId !== "string" || value.taskId.trim().length === 0) {
        throw new UsageError(`events[${index}].handoff.taskId must be a nonempty string`);
      }
      if (typeof value.checkpointId !== "string" || value.checkpointId.trim().length === 0) {
        throw new UsageError(`events[${index}].handoff.checkpointId must be a nonempty string`);
      }
      if (value.ref !== undefined && typeof value.ref !== "string") {
        throw new UsageError(`events[${index}].handoff.ref must be a string`);
      }
      handoff = {
        operation: value.operation as ParentOperationKind,
        taskId: value.taskId,
        checkpointId: value.checkpointId,
        ref: value.ref as string | undefined,
      };
    }
    let parentOperation: AttemptEvent["parentOperation"];
    if (entry.parentOperation !== undefined) {
      const operation = entry.parentOperation;
      if (operation === null || typeof operation !== "object" || Array.isArray(operation)) {
        throw new UsageError(`events[${index}].parentOperation must be an object`);
      }
      const value = operation as Record<string, unknown>;
      for (const key of Object.keys(value)) {
        if (!["kind", "taskId", "checkpointId"].includes(key)) {
          throw new UsageError(`events[${index}].parentOperation has unknown key ${JSON.stringify(key)}`);
        }
      }
      if (
        typeof value.kind !== "string" ||
        !(PARENT_OPERATION_KINDS as readonly string[]).includes(value.kind)
      ) {
        throw new UsageError(
          `events[${index}].parentOperation.kind must be one of ${PARENT_OPERATION_KINDS.join(", ")}`
        );
      }
      if (typeof value.taskId !== "string" || value.taskId.trim().length === 0) {
        throw new UsageError(`events[${index}].parentOperation.taskId must be a nonempty string`);
      }
      if (typeof value.checkpointId !== "string" || value.checkpointId.trim().length === 0) {
        throw new UsageError(`events[${index}].parentOperation.checkpointId must be a nonempty string`);
      }
      parentOperation = {
        kind: value.kind as ParentOperationKind,
        taskId: value.taskId,
        checkpointId: value.checkpointId,
      };
      if (entry.status !== "complete" && entry.status !== "failed") {
        throw new UsageError(
          `events[${index}] records a parent operation; its status must be complete or failed`
        );
      }
      if (entry.handoff !== undefined) {
        throw new UsageError(`events[${index}] cannot carry both handoff and parentOperation`);
      }
    }
    if (entry.status === "needs-parent-operation" && handoff === undefined) {
      throw new UsageError(
        `events[${index}] is needs-parent-operation but carries no handoff request`
      );
    }
    if (entry.status === "permission-blocked") {
      if (entry.deniedCause === undefined || entry.deniedCause === "none") {
        throw new UsageError(
          `events[${index}] is permission-blocked but carries no verified deniedCause`
        );
      }
    }
    return {
      attemptIndex: entry.attemptIndex,
      status: entry.status as AttemptOutcomeStatus,
      processStarted: entry.processStarted as boolean | undefined,
      inspection,
      receiptPath: entry.receiptPath as string | undefined,
      continuationOrdinal: entry.continuationOrdinal as number | undefined,
      deniedCause: entry.deniedCause as DeniedCause | undefined,
      execution,
      recovery,
      handoff,
      parentOperation,
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
  const events: AttemptEvent[] = [];
  const executionCounts = new Map<number, number>();
  for (const raw of decision.events) {
    if (raw.attemptIndex >= lanePolicy.attempts.length) {
      throw new UsageError("event attemptIndex is out of range for this lane");
    }
    if (lanePolicy.attempts[raw.attemptIndex].authorization.state === "blocked") {
      throw new UsageError("event history records an attempt the saved policy does not authorize");
    }
    let event = raw;
    if (raw.parentOperation === undefined) {
      const ordinal = executionCounts.get(raw.attemptIndex) ?? 0;
      if (raw.continuationOrdinal !== undefined && raw.continuationOrdinal !== ordinal) {
        throw new UsageError(
          `event on attempt ${raw.attemptIndex} carries continuationOrdinal ${raw.continuationOrdinal}; the history implies ${ordinal}`
        );
      }
      event = { ...raw, continuationOrdinal: ordinal };
      executionCounts.set(raw.attemptIndex, ordinal + 1);
    } else {
      if (previous === undefined) {
        throw new UsageError("the first event cannot record a parent operation");
      }
      if (raw.status !== "complete" && raw.status !== "failed") {
        throw new UsageError("a parent-operation event must record complete or failed");
      }
    }
    if (previous !== undefined) {
      if (!eventSuccessorAuthorized(lanePolicy, previous, event, decision.access)) {
        throw new UsageError(
          "events contain a continuation the saved policy could not advance, a parent operation that does not match its request, or a started writer without a clear inspection"
        );
      }
      if (previous.status === "permission-blocked" ||
          (previous.parentOperation !== undefined && previous.status === "complete")) {
        const permitted = nextAttempt(lanePolicy, events, decision.exhaustedGroups, decision.access, false);
        if (permitted.kind !== "continue" || event.execution === undefined ||
            JSON.stringify(permitted.preparedExecution) !== JSON.stringify(event.execution)) {
          throw new UsageError("recorded continuation exceeds policy or differs from its reviewed execution");
        }
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
    events.push(event);
    previous = event;
  }
  const outcome = nextAttempt(
    lanePolicy,
    events,
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
  let contract = "legacy";
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
      case "--contract":
        contract = optionValue("--contract", argv, i);
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
  if (!(WORKER_CONTRACT_MODES as readonly string[]).includes(contract)) {
    throw new UsageError(`--contract must be one of: ${WORKER_CONTRACT_MODES.join(", ")}`);
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
    contract: contract as "legacy" | "strict",
    receiptPath,
  });
  const event: AttemptEvent = {
    attemptIndex,
    status: normalized.status,
    ...(normalized.processStarted === undefined
      ? {}
      : { processStarted: normalized.processStarted }),
    ...(normalized.deniedCause === undefined
      ? {}
      : { deniedCause: normalized.deniedCause }),
    ...(normalized.handoff === undefined ? {} : { handoff: normalized.handoff }),
    ...(normalized.execution === undefined ? {} : { execution: normalized.execution }),
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
