import {
  ACCESS_MODES,
  API_SPEND_MODES,
  EFFORTS,
  PARENTS,
  PROVIDERS,
  RECEIPT_STATUSES,
  type AccessMode,
  type Effort,
  type Parent,
  type Provider,
  type ReceiptApiSpend,
  type ReceiptStatus,
} from "../runner/types.ts";
import {
  ModelPolicyError,
  type AttemptApiSpend,
  type AttemptOutcomeStatus,
  type DeniedCause,
  type ExecutionIdentity,
} from "./model-policy.ts";
import { PARENT_OPERATION_KINDS, type ParentOperationKind } from "../runner/types.ts";
import { isAbsolute, resolve } from "node:path";

export const RECEIPT_EVENT_STATUS: Readonly<Record<ReceiptStatus, AttemptOutcomeStatus>> = {
  complete: "complete",
  "needs-parent-operation": "needs-parent-operation",
  cancelled: "failed",
  "unavailable-cli": "route-unavailable",
  unauthenticated: "route-unavailable",
  "unavailable-model": "route-unavailable",
  "usage-exhausted": "usage-exhausted",
  "billing-policy-blocked": "failed",
  "timed-out": "deadline-exceeded",
  "child-failed": "terminal-failure",
  "malformed-output": "terminal-failure",
  "unsupported-capability": "failed",
};

const FAILURE_PHASES = ["preflight", "invocation", "postprocess"] as const;
const RECEIPT_API_SPENDS = [...API_SPEND_MODES, "legacy"] as const;

export interface ReceiptIdentity {
  readonly parent: Parent;
  readonly provider: Provider;
  readonly model: string;
  readonly effort: Effort;
  readonly mode: AccessMode;
  readonly apiSpend: AttemptApiSpend;
  readonly contract?: "legacy" | "strict";
  readonly receiptPath?: string;
}

export interface NormalizedReceiptEvent {
  readonly status: AttemptOutcomeStatus;
  readonly processStarted?: boolean;
  // Verified denial evidence or the requested parent operation when the
  // status is permission-blocked or needs-parent-operation.
  readonly deniedCause?: DeniedCause;
  readonly handoff?: {
    readonly operation: ParentOperationKind;
    readonly taskId: string;
    readonly checkpointId: string;
    readonly ref?: string;
  };
  readonly execution?: ExecutionIdentity;
}

function canonicalPath(value: unknown, field: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || value !== resolve(value) || value.includes("\0")) {
    fail([`${field} must be a normalized absolute path`]);
  }
  return value;
}

function fail(issues: readonly string[]): never {
  throw new ModelPolicyError(issues);
}

// Normalize a raw runner receipt into one lane event for the descriptor the
// caller says it ran. Identity (parent/provider/model/effort plus the
// requested access mode and saved apiSpend) must match the authorized
// attempt exactly, and the terminal status must be coherent with the rest of
// the receipt. Outcomes that cannot prove their eligibility — a timed-out
// receipt with no recorded explicit deadline, a started failure with no
// settled child evidence, a quota claim recorded before or outside the
// workload phases, a route claim once the child may have started, a
// started or possibly started recoverable claim with no recorded
// success-conflict assessment, a receipt carrying a trusted terminal
// success, or a launcher/programming error — normalize to "failed", which
// never advances a chain.
export function normalizeReceiptEvent(
  value: unknown,
  expected: ReceiptIdentity
): NormalizedReceiptEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(["receipt must be a JSON object"]);
  }
  const receipt = value as Record<string, unknown>;
  if (receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2) {
    fail([`receipt schemaVersion must be 1 or 2, found ${JSON.stringify(receipt.schemaVersion)}`]);
  }
  const status = receipt.status;
  if (
    typeof status !== "string" ||
    !(RECEIPT_STATUSES as readonly string[]).includes(status)
  ) {
    fail([`receipt status must be one of ${RECEIPT_STATUSES.join(", ")}`]);
  }
  const receiptStatus = status as ReceiptStatus;

  if (
    typeof receipt.parent !== "string" ||
    !(PARENTS as readonly string[]).includes(receipt.parent)
  ) {
    fail(["receipt parent is not a supported parent"]);
  }
  if (
    typeof receipt.provider !== "string" ||
    !(PROVIDERS as readonly string[]).includes(receipt.provider)
  ) {
    fail(["receipt provider is not a supported provider"]);
  }
  if (typeof receipt.model !== "string" || receipt.model.trim().length === 0) {
    fail(["receipt model must be a nonempty string"]);
  }
  if (
    typeof receipt.effort !== "string" ||
    (!(EFFORTS as readonly string[]).includes(receipt.effort) && receipt.effort !== "default")
  ) {
    fail(["receipt effort is not a supported effort"]);
  }
  if (
    typeof receipt.mode !== "string" ||
    !(ACCESS_MODES as readonly string[]).includes(receipt.mode)
  ) {
    fail(["receipt mode is not a supported access mode"]);
  }
  if (
    receipt.apiSpend !== undefined &&
    (typeof receipt.apiSpend !== "string" ||
      !(RECEIPT_API_SPENDS as readonly string[]).includes(receipt.apiSpend))
  ) {
    fail(["receipt apiSpend must be deny, approved, or legacy when present"]);
  }
  const receiptApiSpend = (receipt.apiSpend ?? "legacy") as ReceiptApiSpend;
  const expectedApiSpend: ReceiptApiSpend =
    expected.apiSpend === "unset" ? "legacy" : expected.apiSpend;

  const mismatched: string[] = [];
  if (receipt.parent !== expected.parent) mismatched.push("parent");
  if (receipt.provider !== expected.provider) mismatched.push("provider");
  if (receipt.model !== expected.model) mismatched.push("model");
  if (receipt.effort !== expected.effort) mismatched.push("effort");
  if (receipt.mode !== expected.mode) mismatched.push("mode");
  if (receiptApiSpend !== expectedApiSpend) mismatched.push("apiSpend");
  if (expected.contract !== undefined && (receipt.contract ?? "legacy") !== expected.contract) mismatched.push("contract");
  if (mismatched.length > 0) {
    fail([
      `receipt identity mismatch on ${mismatched.join(", ")}: ` +
        `receipt is ${receipt.parent}/${receipt.provider}:${receipt.model}@${receipt.effort} ` +
        `(mode ${receipt.mode}, apiSpend ${receiptApiSpend}), ` +
        `expected ${expected.parent}/${expected.provider}:${expected.model}@${expected.effort} ` +
        `(mode ${expected.mode}, apiSpend ${expectedApiSpend})`,
    ]);
  }

  let execution: ExecutionIdentity | undefined;
  if (receipt.schemaVersion === 2) {
    const id = receipt.executionId;
    if (typeof id !== "string" || !id.trim()) fail(["receipt executionId must be nonempty"]);
    canonicalPath(receipt.outputPath, "receipt outputPath");
    const rawReceiptPath = canonicalPath(receipt.receiptPath, "receipt receiptPath");
    canonicalPath(receipt.cwd, "receipt cwd");
    if (expected.receiptPath !== undefined && canonicalPath(expected.receiptPath, "expected receipt path") !== rawReceiptPath) {
      fail(["receipt path differs from the normalized file path"]);
    }
    const paths = receipt.canonicalPaths;
    if (paths === null || typeof paths !== "object" || Array.isArray(paths)) {
      fail(["schema 2 receipt requires canonicalPaths"]);
    }
    const canonical = paths as Record<string, unknown>;
    const outputPath = canonicalPath(canonical.output, "canonical output path");
    const receiptPath = canonicalPath(canonical.receipt, "canonical receipt path");
    const workspacePath = canonicalPath(canonical.cwd, "canonical cwd");
    const contract = receipt.contract ?? "legacy";
    if (contract !== "legacy" && contract !== "strict") fail(["receipt contract is invalid"]);
    execution = {
      id, outputPath, receiptPath, workspacePath,
      descriptor: `${expected.provider}:${expected.model}@${expected.effort}`,
      apiSpend: expected.apiSpend, access: expected.mode, contract,
    };
  }

  if (
    receipt.exitCode !== null &&
    (typeof receipt.exitCode !== "number" || !Number.isInteger(receipt.exitCode))
  ) {
    fail(["receipt exitCode must be null or an integer"]);
  }
  const exitCode = receipt.exitCode as number | null;

  if (
    receipt.signal !== null &&
    (typeof receipt.signal !== "string" || receipt.signal.trim().length === 0)
  ) {
    fail(["receipt signal must be null or a nonempty string"]);
  }
  const signal = receipt.signal as string | null;

  let processStarted: boolean | undefined;
  if (receipt.processStarted === undefined) {
    processStarted = undefined;
  } else if (typeof receipt.processStarted === "boolean") {
    processStarted = receipt.processStarted;
  } else {
    fail(["receipt processStarted must be a boolean when present"]);
  }

  if (
    receipt.failurePhase !== null &&
    (typeof receipt.failurePhase !== "string" ||
      !(FAILURE_PHASES as readonly string[]).includes(receipt.failurePhase))
  ) {
    fail(["receipt failurePhase must be preflight, invocation, postprocess, or null"]);
  }

  if (processStarted === false && receipt.failurePhase !== "preflight") {
    fail(["a receipt with processStarted false can only fail in the preflight phase"]);
  }
  if (receipt.failurePhase === "preflight" && processStarted === true) {
    fail(["a preflight failure cannot record processStarted true"]);
  }
  if (receipt.failurePhase === "postprocess" && exitCode !== 0) {
    fail(["a postprocess failure requires a settled clean child exit"]);
  }

  if (receipt.error !== null) {
    const error = receipt.error;
    if (error === null || typeof error !== "object" || Array.isArray(error)) {
      fail(["receipt error must be an object or null"]);
    }
    const entry = error as Record<string, unknown>;
    if (typeof entry.message !== "string" || typeof entry.evidence !== "string") {
      fail(["receipt error must carry string message and evidence"]);
    }
  }

  let toolDenialVerified = false;
  let toolDenialCause: "permission" | "unknown" = "unknown";
  if (receipt.toolDenial !== undefined) {
    const denial = receipt.toolDenial;
    if (denial === null || typeof denial !== "object" || Array.isArray(denial)) {
      fail(["receipt toolDenial must be an object"]);
    }
    const entry = denial as Record<string, unknown>;
    if (typeof entry.verified !== "boolean") {
      fail(["receipt toolDenial.verified must be a boolean"]);
    }
    if (entry.cause !== undefined && entry.cause !== "permission" && entry.cause !== "unknown") {
      fail(["receipt toolDenial.cause must be permission or unknown"]);
    }
    toolDenialCause = entry.cause === "permission" ? "permission" : "unknown";
    if (
      entry.tool !== null &&
      (typeof entry.tool !== "string" || entry.tool.trim().length === 0)
    ) {
      fail(["receipt toolDenial.tool must be null or a nonempty string"]);
    }
    if (
      entry.requestedAction !== null &&
      (typeof entry.requestedAction !== "string" || entry.requestedAction.trim().length === 0)
    ) {
      fail(["receipt toolDenial.requestedAction must be null or a nonempty string"]);
    }
    if (typeof entry.evidence !== "string") {
      fail(["receipt toolDenial.evidence must be a string"]);
    }
    toolDenialVerified = entry.verified;
  }

  let handoff: NormalizedReceiptEvent["handoff"];
  if (receipt.handoff !== undefined) {
    const request = receipt.handoff;
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      fail(["receipt handoff must be an object"]);
    }
    const entry = request as Record<string, unknown>;
    if (
      typeof entry.operation !== "string" ||
      !(PARENT_OPERATION_KINDS as readonly string[]).includes(entry.operation)
    ) {
      fail([`receipt handoff.operation must be one of ${PARENT_OPERATION_KINDS.join(", ")}`]);
    }
    if (typeof entry.task !== "string" || entry.task.trim().length === 0) {
      fail(["receipt handoff.task must be a nonempty string"]);
    }
    if (typeof entry.checkpoint !== "string" || entry.checkpoint.trim().length === 0) {
      fail(["receipt handoff.checkpoint must be a nonempty string"]);
    }
    if (entry.summary !== undefined && typeof entry.summary !== "string") {
      fail(["receipt handoff.summary must be a string when present"]);
    }
    handoff = {
      operation: entry.operation as ParentOperationKind,
      taskId: entry.task,
      checkpointId: entry.checkpoint,
      ...(typeof entry.summary === "string" && entry.summary.trim().length > 0
        ? { ref: entry.summary }
        : {}),
    };
  }
  if (receipt.handoffMalformed !== undefined && typeof receipt.handoffMalformed !== "boolean") {
    fail(["receipt handoffMalformed must be a boolean when present"]);
  }
  if (handoff !== undefined && (receipt.schemaVersion !== 2 || receiptStatus !== "needs-parent-operation")) {
    fail(["only a schema 2 needs-parent-operation receipt may carry a handoff"]);
  }
  if (toolDenialVerified && (receiptStatus === "complete" || receiptStatus === "needs-parent-operation")) {
    fail(["a delivered terminal receipt cannot carry verified tool-denial evidence"]);
  }

  if (
    receipt.timeoutMs !== undefined &&
    receipt.timeoutMs !== null &&
    (typeof receipt.timeoutMs !== "number" ||
      !Number.isFinite(receipt.timeoutMs) ||
      receipt.timeoutMs <= 0)
  ) {
    fail(["receipt timeoutMs must be a positive number or null when present"]);
  }
  const timeoutMs = (receipt.timeoutMs ?? null) as number | null;

  if (receipt.terminalSuccess !== undefined && typeof receipt.terminalSuccess !== "boolean") {
    fail(["receipt terminalSuccess must be a boolean when present"]);
  }

  if (receiptStatus === "complete" || receiptStatus === "needs-parent-operation") {
    if (
      exitCode !== 0 ||
      receipt.error !== null ||
      receipt.failurePhase !== null ||
      (receiptStatus === "complete" && receipt.terminalSuccess === true)
    ) {
      fail(["a complete receipt requires exitCode 0 and no error, failure phase, or success conflict"]);
    }
    if (receipt.handoffMalformed === true) fail(["malformed handoff cannot be a delivered terminal status"]);
    if (receiptStatus === "needs-parent-operation" && handoff === undefined) fail(["handoff status requires handoff"]);
    if (handoff !== undefined) {
      return { status: "needs-parent-operation", processStarted, handoff, execution };
    }
    return { status: "complete", processStarted, execution };
  }
  if (receipt.error === null) {
    fail(["a non-complete receipt requires an error record"]);
  }
  if (
    receiptStatus === "usage-exhausted" &&
    (receipt.error as { evidence: string }).evidence.trim().length === 0
  ) {
    fail(["a usage-exhausted receipt requires recorded classification evidence"]);
  }

  // A settled child is real process evidence: a known exit code, or a
  // recorded signal delivery (a signal-killed child can settle with a null
  // exit). Absence on a started failure is the launcher/programming catch.
  const childSettled = exitCode !== null || signal !== null;
  const needsSettledChild =
    processStarted !== false && receipt.failurePhase !== "preflight";

  let mapped = RECEIPT_EVENT_STATUS[receiptStatus];
  if (receipt.terminalSuccess === true) {
    mapped = "failed";
  } else if (needsSettledChild && !childSettled) {
    mapped = "failed";
  } else if (receiptStatus === "timed-out") {
    if (
      timeoutMs === null ||
      (!childSettled && processStarted !== false) ||
      (processStarted !== false && receipt.terminalSuccess !== false)
    ) {
      mapped = "failed";
    }
  } else if (receiptStatus === "usage-exhausted") {
    // Runner quota is only knowable after the workload ran: the failure
    // must land in the invocation or postprocess phase of a settled child.
    // A preflight or phase-less claim can never prove exhaustion, and a
    // not-started receipt is already confined to preflight above.
    if (
      receipt.failurePhase !== "invocation" &&
      receipt.failurePhase !== "postprocess"
    ) {
      mapped = "failed";
    }
  } else if (
    receiptStatus === "unavailable-cli" ||
    receiptStatus === "unauthenticated" ||
    receiptStatus === "unavailable-model"
  ) {
    // Route proof exists only before the workload starts. A not-started
    // receipt is already confined to the preflight phase above; once the
    // child may have run, an unproven authentication or model claim can
    // mask completed work no recorded assessment can rule out.
    if (processStarted !== false) {
      mapped = "failed";
    }
  } else if (receiptStatus === "child-failed" || receiptStatus === "malformed-output") {
    if (receipt.terminalSuccess !== false) {
      mapped = "failed";
    } else if (toolDenialVerified && toolDenialCause === "permission") {
      // Provider-owned denial evidence upgrades the ambiguous terminal
      // status to a verified permission interruption.
      mapped = "permission-blocked";
    } else if (toolDenialVerified) {
      mapped = "failed";
    }
  } else if (receiptStatus === "unsupported-capability") {
    if (processStarted !== false || receipt.failurePhase !== "preflight") {
      mapped = "failed";
    }
  }
  const deniedCause: DeniedCause | undefined =
    mapped === "permission-blocked" ? "permission" : undefined;
  return {
    status: mapped,
    processStarted,
    execution,
    ...(deniedCause === undefined ? {} : { deniedCause }),
  };
}
