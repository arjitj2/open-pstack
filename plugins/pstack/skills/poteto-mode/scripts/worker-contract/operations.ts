import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { PARENT_OPERATION_KINDS, type ParentOperationKind } from "../runner/types.ts";

export class OperationLedgerError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(issues.join("\n"));
    this.name = "OperationLedgerError";
    this.issues = issues;
  }
}

export const OPERATION_STATES = ["pending", "complete", "rejected"] as const;
export type OperationState = (typeof OPERATION_STATES)[number];

export interface OperationRecord {
  readonly id: string;
  readonly task: string;
  readonly checkpoint: string;
  readonly kind: ParentOperationKind;
  readonly state: OperationState;
  // The parent-declared precondition for the operation (for example the
  // expected base commit or file set). Free-form JSON owned by the caller.
  readonly expected: Record<string, unknown>;
  readonly result: unknown;
  readonly recordedAt: string;
  readonly completedAt: string | null;
}

export interface OperationLedger {
  readonly version: 1;
  readonly operations: OperationRecord[];
}

export interface OperationInput {
  readonly id: string;
  readonly task: string;
  readonly checkpoint: string;
  readonly kind: ParentOperationKind;
  readonly state: OperationState;
  readonly expected: Record<string, unknown>;
  readonly result: unknown;
}

export type RecordOutcome =
  | { readonly kind: "recorded"; readonly operation: OperationRecord }
  | { readonly kind: "idempotent"; readonly operation: OperationRecord }
  | { readonly kind: "transitioned"; readonly operation: OperationRecord };

function fail(issues: readonly string[]): never {
  throw new OperationLedgerError(issues);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validateInput(input: OperationInput): string[] {
  const issues: string[] = [];
  if (!nonempty(input.id)) issues.push("operation id must be a nonempty string");
  if (!nonempty(input.task)) issues.push("operation task must be a nonempty string");
  if (!nonempty(input.checkpoint)) issues.push("operation checkpoint must be a nonempty string");
  if (!(PARENT_OPERATION_KINDS as readonly string[]).includes(input.kind)) {
    issues.push(`operation kind must be one of ${PARENT_OPERATION_KINDS.join(", ")}`);
  }
  if (!(OPERATION_STATES as readonly string[]).includes(input.state)) {
    issues.push(`operation state must be one of ${OPERATION_STATES.join(", ")}`);
  }
  if (!isObject(input.expected)) issues.push("operation expected state must be a JSON object");
  return issues;
}

export function parseOperationRecord(value: unknown, index: number): OperationRecord {
  if (!isObject(value)) fail([`operations[${index}] must be an object`]);
  const issues: string[] = [];
  if (!nonempty(value.id)) issues.push(`operations[${index}].id must be a nonempty string`);
  if (!nonempty(value.task)) issues.push(`operations[${index}].task must be a nonempty string`);
  if (!nonempty(value.checkpoint)) issues.push(`operations[${index}].checkpoint must be a nonempty string`);
  if (
    typeof value.kind !== "string" ||
    !(PARENT_OPERATION_KINDS as readonly string[]).includes(value.kind)
  ) {
    issues.push(`operations[${index}].kind must be one of ${PARENT_OPERATION_KINDS.join(", ")}`);
  }
  if (
    typeof value.state !== "string" ||
    !(OPERATION_STATES as readonly string[]).includes(value.state)
  ) {
    issues.push(`operations[${index}].state must be one of ${OPERATION_STATES.join(", ")}`);
  }
  if (!isObject(value.expected)) issues.push(`operations[${index}].expected must be an object`);
  if (!nonempty(value.recordedAt)) issues.push(`operations[${index}].recordedAt must be a nonempty string`);
  if (value.completedAt !== null && !nonempty(value.completedAt)) {
    issues.push(`operations[${index}].completedAt must be null or a nonempty string`);
  }
  if (issues.length > 0) fail(issues);
  return {
    id: value.id as string,
    task: value.task as string,
    checkpoint: value.checkpoint as string,
    kind: value.kind as ParentOperationKind,
    state: value.state as OperationState,
    expected: value.expected as Record<string, unknown>,
    result: value.result ?? null,
    recordedAt: value.recordedAt as string,
    completedAt: (value.completedAt as string | null) ?? null,
  };
}

export function parseLedger(text: string, source: string): OperationLedger {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail([`operation ledger is not valid JSON: ${source}`]);
  }
  if (!isObject(value)) fail([`operation ledger must be a JSON object: ${source}`]);
  if (value.version !== 1) fail([`operation ledger version must be 1: ${source}`]);
  if (!Array.isArray(value.operations)) fail([`operation ledger requires an operations array: ${source}`]);
  const operations = value.operations.map((entry, index) => parseOperationRecord(entry, index));
  const ids = new Set<string>();
  for (const operation of operations) {
    if (ids.has(operation.id)) {
      fail([`operation ledger repeats operation id ${JSON.stringify(operation.id)}`]);
    }
    ids.add(operation.id);
  }
  return { version: 1, operations };
}

export function readLedger(path: string): OperationLedger {
  if (!existsSync(path)) return { version: 1, operations: [] };
  return parseLedger(readFileSync(path, "utf8"), path);
}

export function writeLedger(path: string, ledger: OperationLedger): void {
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

// Record an operation or transition it. The record is idempotent: repeating
// an identical call returns the stored record unchanged, a pending operation
// can transition to complete or rejected, and any contradictory reuse of the
// same id — or a different id naming the same task, checkpoint, and kind —
// is an ambiguous duplicate the caller must reconcile instead of retrying.
export function recordOperation(
  ledger: OperationLedger,
  input: OperationInput,
  now: string
): RecordOutcome {
  const issues = validateInput(input);
  if (issues.length > 0) fail(issues);

  const duplicate = ledger.operations.find(
    (entry) =>
      entry.id !== input.id &&
      entry.task === input.task &&
      entry.checkpoint === input.checkpoint &&
      entry.kind === input.kind &&
      entry.state !== "rejected"
  );
  if (duplicate !== undefined) {
    fail([
      `operation ${JSON.stringify(input.id)} duplicates ${JSON.stringify(duplicate.id)} ` +
        `for task ${JSON.stringify(input.task)} checkpoint ${JSON.stringify(input.checkpoint)} ` +
        `kind ${JSON.stringify(input.kind)}; reconcile the recorded operation instead of retrying`,
    ]);
  }

  const existing = ledger.operations.find((entry) => entry.id === input.id);
  if (existing === undefined) {
    const operation: OperationRecord = {
      id: input.id,
      task: input.task,
      checkpoint: input.checkpoint,
      kind: input.kind,
      state: input.state,
      expected: input.expected,
      result: input.result ?? null,
      recordedAt: now,
      completedAt: input.state === "pending" ? null : now,
    };
    ledger.operations.push(operation);
    return { kind: "recorded", operation };
  }

  const sameIdentity =
    existing.task === input.task &&
    existing.checkpoint === input.checkpoint &&
    existing.kind === input.kind &&
    samePayload(existing.expected, input.expected);
  if (!sameIdentity) {
    fail([
      `operation ${JSON.stringify(input.id)} conflicts with the recorded operation: ` +
        "task, checkpoint, kind, or expected state differs; this is ambiguous, not a retry",
    ]);
  }

  if (existing.state === "pending" && input.state !== "pending") {
    const transitioned: OperationRecord = {
      ...existing,
      state: input.state,
      result: input.result ?? existing.result,
      completedAt: now,
    };
    const index = ledger.operations.indexOf(existing);
    ledger.operations[index] = transitioned;
    return { kind: "transitioned", operation: transitioned };
  }
  if (existing.state !== "pending" && input.state === "pending") {
    fail([
      `operation ${JSON.stringify(input.id)} is already ${existing.state}; ` +
        "it cannot return to pending",
    ]);
  }
  if (existing.state !== input.state) {
    fail([
      `operation ${JSON.stringify(input.id)} is already ${existing.state}; ` +
        `it cannot become ${input.state}`,
    ]);
  }
  if (input.result !== undefined && !samePayload(existing.result, input.result)) {
    fail([
      `operation ${JSON.stringify(input.id)} already recorded a different result`,
    ]);
  }
  return { kind: "idempotent", operation: existing };
}

export function pendingOperations(ledger: OperationLedger): readonly OperationRecord[] {
  return ledger.operations.filter((operation) => operation.state === "pending");
}
