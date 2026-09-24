import {
  EFFORTS,
  PROVIDERS,
  type Effort,
  type Parent,
  type Provider,
} from "../runner/types.ts";

export const MAX_ATTEMPTS_PER_SEAT = 3;

export const ALIASES = ["inherit-parent", "auto"] as const;
export type Alias = (typeof ALIASES)[number];

export type Funding = "included" | "metered" | "unknown";
export type CapacityExpectation = "standard" | "high" | "unknown";
export type Provenance = "user" | "provider";
export type ApiSpendPolicy = "deny" | "approved";
export type AttemptApiSpend = ApiSpendPolicy | "unset";

const FUNDINGS = ["included", "metered", "unknown"] as const;
const CAPACITIES = ["standard", "high", "unknown"] as const;
const PROVENANCES = ["user", "provider"] as const;
const API_SPENDS = ["deny", "approved"] as const;

export const FALLBACK_REASONS = [
  "usage-exhausted",
  "route-unavailable",
  "terminal-failure",
  "deadline-exceeded",
] as const;
export type FallbackReason = (typeof FALLBACK_REASONS)[number];

export interface FallbackPolicy {
  readonly on: readonly FallbackReason[];
}

export const QUOTA_ONLY_FALLBACK: FallbackPolicy = { on: ["usage-exhausted"] };

export class ModelPolicyError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "ModelPolicyError";
    this.issues = issues;
  }
}

export interface RoleRowSpec {
  readonly header: string;
  readonly roles: readonly string[];
  readonly panel: boolean;
  readonly minSeats: number;
  readonly nativeOnly: boolean;
}

export const ROLE_ROWS: readonly RoleRowSpec[] = [
  { header: "feature, refactoring", roles: ["feature", "refactoring"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "bug-fix", roles: ["bug-fix"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "perf-issue", roles: ["perf-issue"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "hillclimb", roles: ["hillclimb"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "judgment and prose", roles: ["judgment and prose"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "hardest tasks", roles: ["hardest tasks"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "how explorer", roles: ["how explorer"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "how explainer", roles: ["how explainer"], panel: false, minSeats: 1, nativeOnly: false },
  { header: "why investigators, synthesizer", roles: ["why investigators", "synthesizer"], panel: false, minSeats: 1, nativeOnly: true },
  { header: "reflect tooling, judgment, divergent, synthesizer", roles: ["reflect tooling", "judgment", "divergent", "synthesizer"], panel: false, minSeats: 1, nativeOnly: true },
  { header: "arena runners", roles: ["arena runners"], panel: true, minSeats: 1, nativeOnly: false },
  { header: "arena cross-judge pool", roles: ["arena cross-judge pool"], panel: true, minSeats: 1, nativeOnly: false },
  { header: "swarm workers", roles: ["swarm workers"], panel: true, minSeats: 1, nativeOnly: false },
  { header: "architect runners", roles: ["architect runners"], panel: true, minSeats: 2, nativeOnly: false },
  { header: "interrogate reviewers", roles: ["interrogate reviewers"], panel: true, minSeats: 1, nativeOnly: false },
];

const ROLE_ROW_BY_HEADER = new Map(ROLE_ROWS.map((row) => [row.header, row]));

export interface AccessFact {
  readonly provider: Provider;
  readonly funding: Funding;
  readonly capacity: CapacityExpectation;
  readonly apiSpend: ApiSpendPolicy;
  readonly provenance: Provenance;
  readonly plan: string | null;
  readonly note: string | null;
  readonly observedAt: string | null;
}

export type Attempt =
  | { readonly kind: "alias"; readonly alias: Alias }
  | { readonly kind: "descriptor"; readonly provider: Provider; readonly model: string; readonly effort: Effort };

export interface Seat {
  readonly attempts: readonly Attempt[];
}

export interface SheetRow {
  readonly spec: RoleRowSpec;
  readonly leading: readonly string[];
  readonly seats: readonly Seat[];
}

export interface SheetModel {
  readonly preamble: readonly string[];
  readonly rows: readonly SheetRow[];
  readonly footer: readonly string[];
  readonly trailingNewline: boolean;
  readonly budget: string | null;
  readonly access: readonly AccessFact[];
  // The declared `# fallback:` policy, or null when the sheet never declares
  // one (quota-only default).
  readonly fallback: FallbackPolicy | null;
}

export type AttemptAuthorization =
  | { readonly state: "allowed" }
  | { readonly state: "blocked"; readonly reason: string };

export interface AttemptPolicy {
  readonly descriptor: string;
  readonly attempt: Attempt;
  readonly exhaustionGroup: Provider;
  readonly funding: Funding | "unset";
  readonly apiSpend: AttemptApiSpend;
  readonly route: "native" | "external";
  readonly authorization: AttemptAuthorization;
}

export interface LanePolicy {
  readonly id: string;
  readonly attempts: readonly AttemptPolicy[];
  readonly fallback: FallbackPolicy;
}

export interface RolePolicy {
  readonly role: string;
  readonly header: string;
  readonly lanes: readonly LanePolicy[];
}

export interface PolicyContext {
  readonly checkAttempt?: (
    attempt: Extract<Attempt, { kind: "descriptor" }>,
    header: string
  ) => string | null;
}

const ATTEMPT_RE =
  /^(claude|codex|grok|devin|cursor):([A-Za-z0-9][A-Za-z0-9._-]*)@([a-z]+)$/;

const ACCESS_KEY_ORDER = [
  "provider",
  "funding",
  "capacity",
  "apiSpend",
  "provenance",
  "plan",
  "note",
  "observedAt",
] as const;

function isAlias(value: string): value is Alias {
  return (ALIASES as readonly string[]).includes(value);
}

function parseAttempt(raw: string, header: string): Attempt {
  const text = raw.trim();
  if (isAlias(text)) return { kind: "alias", alias: text };
  const match = ATTEMPT_RE.exec(text);
  if (match === null) {
    throw new ModelPolicyError([
      `${header}: attempt ${JSON.stringify(text)} is not \`inherit-parent\`, \`auto\`, or \`provider:model@effort\``,
    ]);
  }
  const effort = match[3] as Effort;
  if (!(EFFORTS as readonly string[]).includes(effort) && effort !== "default") {
    throw new ModelPolicyError([
      `${header}: unsupported effort ${JSON.stringify(effort)} in ${JSON.stringify(text)}`,
    ]);
  }
  return {
    kind: "descriptor",
    provider: match[1] as Provider,
    model: match[2],
    effort,
  };
}

function renderAttempt(attempt: Attempt): string {
  return attempt.kind === "alias"
    ? attempt.alias
    : `${attempt.provider}:${attempt.model}@${attempt.effort}`;
}

function parseAccessFact(json: string, line: string): AccessFact {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ModelPolicyError([`access line is not valid JSON: ${line}`]);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelPolicyError([`access line must be a JSON object: ${line}`]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(ACCESS_KEY_ORDER as readonly string[]).includes(key)) {
      throw new ModelPolicyError([`access line has unknown key ${JSON.stringify(key)}: ${line}`]);
    }
  }
  const issues: string[] = [];
  const provider = record.provider;
  if (typeof provider !== "string" || !(PROVIDERS as readonly string[]).includes(provider)) {
    issues.push(`access provider must be one of ${PROVIDERS.join(", ")}`);
  }
  if (typeof record.funding !== "string" || !(FUNDINGS as readonly string[]).includes(record.funding)) {
    issues.push(`access funding must be one of ${FUNDINGS.join(", ")}`);
  }
  if (typeof record.capacity !== "string" || !(CAPACITIES as readonly string[]).includes(record.capacity)) {
    issues.push(`access capacity must be one of ${CAPACITIES.join(", ")}`);
  }
  if (typeof record.apiSpend !== "string" || !(API_SPENDS as readonly string[]).includes(record.apiSpend)) {
    issues.push(`access apiSpend must be one of ${API_SPENDS.join(", ")}`);
  }
  if (typeof record.provenance !== "string" || !(PROVENANCES as readonly string[]).includes(record.provenance)) {
    issues.push(`access provenance must be one of ${PROVENANCES.join(", ")}`);
  }
  for (const key of ["plan", "note", "observedAt"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      issues.push(`access ${key} must be a string when present`);
    }
  }
  if (issues.length > 0) {
    throw new ModelPolicyError(issues.map((issue) => `${issue}: ${line}`));
  }
  return {
    provider: provider as Provider,
    funding: record.funding as Funding,
    capacity: record.capacity as CapacityExpectation,
    apiSpend: record.apiSpend as ApiSpendPolicy,
    provenance: record.provenance as Provenance,
    plan: (record.plan as string | undefined) ?? null,
    note: (record.note as string | undefined) ?? null,
    observedAt: (record.observedAt as string | undefined) ?? null,
  };
}

function parseFallbackPolicy(json: string, line: string): FallbackPolicy {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ModelPolicyError([`fallback line is not valid JSON: ${line}`]);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelPolicyError([`fallback line must be a JSON object: ${line}`]);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "on") {
      throw new ModelPolicyError([`fallback line has unknown key ${JSON.stringify(key)}: ${line}`]);
    }
  }
  const on = record.on;
  if (!Array.isArray(on)) {
    throw new ModelPolicyError([`fallback "on" must be an array: ${line}`]);
  }
  const seen = new Set<string>();
  const reasons: FallbackReason[] = [];
  for (const entry of on) {
    if (typeof entry !== "string" || !(FALLBACK_REASONS as readonly string[]).includes(entry)) {
      throw new ModelPolicyError([
        `fallback reason must be one of ${FALLBACK_REASONS.join(", ")}: ${line}`,
      ]);
    }
    if (seen.has(entry)) {
      throw new ModelPolicyError([`fallback line repeats reason ${JSON.stringify(entry)}: ${line}`]);
    }
    seen.add(entry);
    reasons.push(entry as FallbackReason);
  }
  return { on: reasons };
}

function collectComments(model: {
  preamble: readonly string[];
  rows: readonly SheetRow[];
  footer: readonly string[];
}): string[] {
  const comments: string[] = [];
  const push = (lines: readonly string[]) => {
    for (const line of lines) if (line.trimStart().startsWith("#")) comments.push(line.trim());
  };
  push(model.preamble);
  for (const row of model.rows) push(row.leading);
  push(model.footer);
  return comments;
}

type RoleRowMatch =
  | { readonly kind: "known"; readonly spec: RoleRowSpec; readonly rhs: string }
  | { readonly kind: "unknown"; readonly header: string; readonly rhs: string }
  | { readonly kind: "none" };

function matchRoleRow(line: string): RoleRowMatch {
  let spec: RoleRowSpec | null = null;
  let rhs = "";
  for (const candidate of ROLE_ROWS) {
    if (
      line.startsWith(`${candidate.header}:`) &&
      (spec === null || candidate.header.length > spec.header.length)
    ) {
      spec = candidate;
      rhs = line.slice(candidate.header.length + 1).trim();
    }
  }
  if (spec !== null) return { kind: "known", spec, rhs };
  const boundary = /:(?=[ \t]|$)/.exec(line);
  if (boundary === null) return { kind: "none" };
  return {
    kind: "unknown",
    header: line.slice(0, boundary.index).trim(),
    rhs: line.slice(boundary.index + 1).trim(),
  };
}

export function parseSheet(text: string, context: PolicyContext = {}): SheetModel {
  const lines = text.split(/\r?\n/);
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailingNewline) lines.pop();

  const issues: string[] = [];
  const preamble: string[] = [];
  const footer: string[] = [];
  const rows: SheetRow[] = [];
  let pending: string[] = [];
  let sawRow = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("#") || line.trim().length === 0) {
      if (sawRow) pending.push(line);
      else preamble.push(line);
      continue;
    }

    const match = matchRoleRow(line);
    if (match.kind === "none") {
      if (sawRow) pending.push(line);
      else preamble.push(line);
      continue;
    }
    if (match.kind === "unknown") {
      issues.push(`unknown role row header: ${JSON.stringify(match.header)}`);
      sawRow = true;
      rows.push({
        spec: { header: match.header, roles: [match.header], panel: true, minSeats: 1, nativeOnly: false },
        leading: pending,
        seats: [],
      });
      pending = [];
      continue;
    }
    const spec = match.spec;
    const header = spec.header;
    const rhs = match.rhs;
    sawRow = true;

    const seats: Seat[] = [];
    const seatTexts: string[] = [];
    if (rhs.length === 0) {
      issues.push(`${header}: row has no attempts`);
    } else {
      for (const segment of rhs.split(",")) {
        const seat = segment.trim();
        if (seat.length === 0) {
          issues.push(`${header}: empty seat between commas; remove the stray comma`);
        } else {
          seatTexts.push(seat);
        }
      }
    }
    if (!spec.panel && seatTexts.length > 1) {
      issues.push(`${header}: single-model role must have exactly one seat, found ${seatTexts.length}`);
    }
    for (const seatText of seatTexts) {
      const attemptTexts = seatText.split("->").map((attempt) => attempt.trim());
      if (attemptTexts.some((attempt) => attempt.length === 0)) {
        issues.push(`${header}: empty attempt in seat ${JSON.stringify(seatText)}`);
        continue;
      }
      if (attemptTexts.length > MAX_ATTEMPTS_PER_SEAT) {
        issues.push(
          `${header}: seat ${JSON.stringify(seatText)} has ${attemptTexts.length} attempts; the maximum is ${MAX_ATTEMPTS_PER_SEAT}`
        );
      }
      const attempts: Attempt[] = [];
      let aliasCount = 0;
      const providers = new Set<string>();
      const seen = new Set<string>();
      for (const attemptText of attemptTexts) {
        let attempt: Attempt;
        try {
          attempt = parseAttempt(attemptText, header);
        } catch (error) {
          if (error instanceof ModelPolicyError) issues.push(...error.issues);
          else throw error;
          continue;
        }
        if (spec.nativeOnly && attempt.kind !== "alias") {
          issues.push(
            `${header}: this role requires the parent's live MCP surface; every attempt must be \`inherit-parent\` or \`auto\``
          );
        }
        if (attempt.kind === "alias") {
          aliasCount += 1;
        } else {
          if (providers.has(attempt.provider)) {
            issues.push(
              `${header}: seat ${JSON.stringify(seatText)} repeats provider ${attempt.provider}; a fallback to the same provider is the same account`
            );
          }
          providers.add(attempt.provider);
          if (context.checkAttempt !== undefined) {
            const issue = context.checkAttempt(attempt, header);
            if (issue !== null) issues.push(`${header}: ${issue}`);
          }
        }
        const key = renderAttempt(attempt);
        if (seen.has(key)) {
          issues.push(`${header}: duplicate attempt ${JSON.stringify(key)} in one seat`);
        }
        seen.add(key);
        attempts.push(attempt);
      }
      if (aliasCount > 1) {
        issues.push(
          `${header}: seat ${JSON.stringify(seatText)} has ${aliasCount} parent-account aliases; a second alias attempts the same account`
        );
      }
      seats.push({ attempts });
    }
    rows.push({ spec, leading: pending, seats });
    pending = [];
  }
  for (const line of pending) footer.push(line);

  const seenHeaders = new Set<string>();
  for (const row of rows) {
    if (row.spec !== undefined && ROLE_ROW_BY_HEADER.has(row.spec.header)) {
      if (seenHeaders.has(row.spec.header)) {
        issues.push(`duplicate role row: ${row.spec.header}`);
      }
      seenHeaders.add(row.spec.header);
    }
  }

  const partial = { preamble, rows, footer };
  const comments = collectComments(partial);
  let budget: string | null = null;
  const access: AccessFact[] = [];
  const accessProviders = new Set<string>();
  let fallback: FallbackPolicy | null = null;
  let fallbackLines = 0;
  for (const comment of comments) {
    if (comment.startsWith("# budget:")) {
      budget = comment.slice("# budget:".length).trim();
    }
    const accessIndex = comment.indexOf("# access:");
    if (accessIndex >= 0) {
      const json = comment.slice(accessIndex + "# access:".length).trim();
      try {
        const fact = parseAccessFact(json, comment);
        if (accessProviders.has(fact.provider)) {
          issues.push(
            `provider ${fact.provider} has more than one access record; one account per provider is supported`
          );
        }
        accessProviders.add(fact.provider);
        access.push(fact);
      } catch (error) {
        if (error instanceof ModelPolicyError) issues.push(...error.issues);
        else throw error;
      }
    }
    if (comment.startsWith("# fallback:")) {
      fallbackLines += 1;
      const json = comment.slice("# fallback:".length).trim();
      try {
        fallback = parseFallbackPolicy(json, comment);
      } catch (error) {
        if (error instanceof ModelPolicyError) issues.push(...error.issues);
        else throw error;
      }
    }
  }
  if (fallbackLines > 1) {
    issues.push("more than one # fallback: declaration; declare the recovery policy once");
  }

  if (issues.length > 0) throw new ModelPolicyError(issues);
  return { preamble, rows, footer, trailingNewline, budget, access, fallback };
}

export function renderSheet(model: SheetModel): string {
  const lines: string[] = [...model.preamble];
  for (const row of model.rows) {
    lines.push(...row.leading);
    const rhs = row.seats
      .map((seat) => seat.attempts.map(renderAttempt).join(" -> "))
      .join(", ");
    lines.push(`${row.spec.header}: ${rhs}`);
  }
  lines.push(...model.footer);
  return lines.join("\n") + (model.trailingNewline ? "\n" : "");
}

export function assertCompleteSheet(model: SheetModel): void {
  const issues: string[] = [];
  const byHeader = new Map(model.rows.map((row) => [row.spec.header, row]));
  for (const spec of ROLE_ROWS) {
    const row = byHeader.get(spec.header);
    if (row === undefined) {
      issues.push(`missing required role row: ${spec.header}`);
      continue;
    }
    if (row.seats.length < spec.minSeats) {
      issues.push(
        `${spec.header}: requires at least ${spec.minSeats} seat${spec.minSeats === 1 ? "" : "s"}, found ${row.seats.length}`
      );
    }
    if (!spec.panel && row.seats.length !== 1) {
      issues.push(`${spec.header}: single-model role must have exactly one seat`);
    }
    for (const seat of row.seats) {
      if (seat.attempts.length === 0) {
        issues.push(`${spec.header}: seat has no attempts`);
      }
    }
  }
  if (issues.length > 0) throw new ModelPolicyError(issues);
}

function leafRow(model: SheetModel, role: string): SheetRow | null {
  const byHeader = model.rows.find((row) => row.spec.header === role);
  if (byHeader !== undefined) return byHeader;
  const matches = model.rows.filter((row) => row.spec.roles.includes(role));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new ModelPolicyError([
      `role ${JSON.stringify(role)} is ambiguous; name its row header: ${matches
        .map((row) => row.spec.header)
        .join(" | ")}`,
    ]);
  }
  return null;
}

function exhaustionGroupFor(attempt: Attempt, parent: Parent): Provider {
  return attempt.kind === "alias" ? parent : attempt.provider;
}

export function resolveRole(
  model: SheetModel,
  role: string,
  parent: Parent
): RolePolicy | null {
  const policyEnabled = model.access.length > 0 ||
    model.fallback !== null ||
    model.rows.some((entry) => entry.seats.some((seat) => seat.attempts.length > 1));
  const row = leafRow(model, role);
  if (row === null) {
    if (policyEnabled) {
      throw new ModelPolicyError([`policy-enabled sheet has no role ${JSON.stringify(role)}; repair it through setup before dispatch`]);
    }
    return null;
  }
  const issues: string[] = [];
  const lanes: LanePolicy[] = row.seats.map((seat, index) => {
    const chained = seat.attempts.length > 1;
    const groups = new Set<Provider>();
    const attempts = seat.attempts.map((attempt): AttemptPolicy => {
      const provider = exhaustionGroupFor(attempt, parent);
      const fact = model.access.find((entry) => entry.provider === provider);
      if (groups.has(provider)) {
        issues.push(
          `${row.spec.header} seat ${index + 1}: two attempts resolve to the ${provider} account; one current account per provider cannot recover exhausted capacity`
        );
      }
      groups.add(provider);
      const native = attempt.kind === "alias" || attempt.provider === parent;
      let authorization: AttemptAuthorization = { state: "allowed" };
      if (fact === undefined) {
        if (chained || policyEnabled) {
          const reason = `no access fact for provider ${provider}`;
          issues.push(
            `${row.spec.header} seat ${index + 1}: attempt ${JSON.stringify(renderAttempt(attempt))} has ${reason}; every configured route on a policy-enabled sheet needs confirmed funding`
          );
          authorization = { state: "blocked", reason };
        }
      } else if (fact.funding === "unknown") {
        authorization = {
          state: "blocked",
          reason: `provider ${provider} funding is unknown; unknown funding is not autoauthorized`,
        };
      } else if (fact.provenance !== "user") {
        authorization = {
          state: "blocked",
          reason: `provider ${provider} access is provider-observed; funding and API spending require operator confirmation`,
        };
      } else if (fact.funding === "metered" && fact.apiSpend !== "approved") {
        authorization = {
          state: "blocked",
          reason: `provider ${provider} funding is metered; metered routes require apiSpend "approved"`,
        };
      }
      return {
        descriptor: renderAttempt(attempt),
        attempt,
        exhaustionGroup: provider,
        funding: fact?.funding ?? "unset",
        apiSpend: fact?.apiSpend ?? "unset",
        route: native ? "native" : "external",
        authorization,
      };
    });
    return {
      id: `${row.spec.header}#${index + 1}`,
      attempts,
      fallback: model.fallback ?? QUOTA_ONLY_FALLBACK,
    };
  });
  if (issues.length > 0) throw new ModelPolicyError(issues);
  return { role, header: row.spec.header, lanes };
}

export function validateSheet(model: SheetModel, parent: Parent): void {
  const issues: string[] = [];
  if (model.access.length === 0) issues.push("setup requires access facts for every configured provider");
  try {
    assertCompleteSheet(model);
  } catch (error) {
    if (error instanceof ModelPolicyError) issues.push(...error.issues);
    else throw error;
  }
  for (const row of model.rows) {
    try {
      const policy = resolveRole(model, row.spec.header, parent);
      if (policy !== null) {
        for (const lane of policy.lanes) {
          for (const attempt of lane.attempts) {
            if (attempt.authorization.state === "blocked") {
              issues.push(
                `${lane.id}: ${attempt.descriptor} is not authorized: ${attempt.authorization.reason}`
              );
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof ModelPolicyError) issues.push(...error.issues);
      else throw error;
    }
  }
  if (issues.length > 0) throw new ModelPolicyError(issues);
}

export type AttemptOutcomeStatus =
  | "complete"
  | "usage-exhausted"
  | "route-unavailable"
  | "terminal-failure"
  | "deadline-exceeded"
  | "failed";

// The parent's own verdict after inspecting a started writer's preserved
// worktree and external side effects. `evidenceRef` records what was
// inspected; it is an attestation by the trusted caller, not proof that the
// helper itself inspected anything.
export interface AttemptInspection {
  readonly state: "clear" | "unsafe";
  readonly evidenceRef: string;
}

export interface AttemptEvent {
  readonly attemptIndex: number;
  readonly status: AttemptOutcomeStatus;
  readonly processStarted?: boolean;
  readonly inspection?: AttemptInspection;
  readonly receiptPath?: string;
}

export type NextAttempt =
  | { readonly kind: "launch"; readonly attemptIndex: number; readonly attempt: AttemptPolicy }
  | { readonly kind: "stop"; readonly reason: "complete" | "chain-exhausted" | "not-eligible" | "unauthorized" | "unsafe-writer" }
  | { readonly kind: "inspect"; readonly reason: "started-writer" };

function outcomeAuthorized(lane: LanePolicy, status: AttemptOutcomeStatus): boolean {
  return (lane.fallback.on as readonly string[]).includes(status);
}

// Whether a terminal event could have advanced to a later attempt under the
// lane's saved policy and access mode. `nextAttempt` uses this for the last
// event; the CLI applies it to every earlier event so a recorded history
// cannot contain a continuation that was never authorized.
export function eventAdvancesUnderPolicy(
  lane: LanePolicy,
  event: AttemptEvent,
  access: "read-only" | "isolated-write"
): boolean {
  if (event.status === "complete" || event.status === "failed") return false;
  if (!outcomeAuthorized(lane, event.status)) return false;
  if (access === "isolated-write" && event.processStarted !== false) {
    return (
      event.inspection?.state === "clear" &&
      event.inspection.evidenceRef.trim().length > 0
    );
  }
  return true;
}

export function nextAttempt(
  lane: LanePolicy,
  events: readonly AttemptEvent[],
  exhaustedGroups: ReadonlySet<Provider>,
  access: "read-only" | "isolated-write"
): NextAttempt {
  if (events.some((event) => event.status === "complete")) {
    return { kind: "stop", reason: "complete" };
  }
  const last = events.at(-1);
  if (last !== undefined) {
    if (last.status === "failed") return { kind: "stop", reason: "not-eligible" };
    if (!outcomeAuthorized(lane, last.status)) {
      return { kind: "stop", reason: "not-eligible" };
    }
    if (
      access === "isolated-write" &&
      last.processStarted !== false
    ) {
      const inspection = last.inspection;
      if (inspection?.state === "unsafe") {
        return { kind: "stop", reason: "unsafe-writer" };
      }
      if (
        inspection?.state !== "clear" ||
        inspection.evidenceRef.trim().length === 0
      ) {
        return { kind: "inspect", reason: "started-writer" };
      }
    }
  }
  for (let index = (last?.attemptIndex ?? -1) + 1; index < lane.attempts.length; index += 1) {
    const attempt = lane.attempts[index];
    if (attempt.authorization.state === "blocked") {
      return { kind: "stop", reason: "unauthorized" };
    }
    if (exhaustedGroups.has(attempt.exhaustionGroup)) continue;
    return { kind: "launch", attemptIndex: index, attempt };
  }
  return { kind: "stop", reason: "chain-exhausted" };
}

