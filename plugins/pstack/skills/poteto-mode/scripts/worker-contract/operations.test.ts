import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OperationLedgerError,
  parseLedger,
  pendingOperations,
  readLedger,
  recordOperation,
  recordOperationFile,
  writeLedger,
  type OperationInput,
  type OperationLedger,
} from "./operations.ts";

let scratch = "";
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-ops-test-"));
});
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function input(overrides: Partial<OperationInput> = {}): OperationInput {
  return {
    id: "op-1",
    task: "issue-57",
    checkpoint: "cp-1",
    kind: "commit-checkpoint",
    state: "pending",
    expected: { base: "abc123" },
    result: undefined,
    ...overrides,
  };
}

function ledger(): OperationLedger {
  return { version: 1, operations: [] };
}

describe("recordOperation", () => {
  it("records a pending operation once and stays idempotent on retry", () => {
    const state = ledger();
    const first = recordOperation(state, input(), "t1");
    expect(first.kind).toBe("recorded");
    const again = recordOperation(state, input(), "t2");
    expect(again.kind).toBe("idempotent");
    expect(again.operation.recordedAt).toBe("t1");
    expect(state.operations).toHaveLength(1);
  });

  it("transitions pending to complete or rejected exactly once", () => {
    const state = ledger();
    recordOperation(state, input(), "t1");
    const done = recordOperation(state, input({ state: "complete", result: { sha: "deadbeef" } }), "t2");
    expect(done.kind).toBe("transitioned");
    expect(done.operation.state).toBe("complete");
    expect(done.operation.completedAt).toBe("t2");
    const again = recordOperation(state, input({ state: "complete", result: { sha: "deadbeef" } }), "t3");
    expect(again.kind).toBe("idempotent");
    expect(() =>
      recordOperation(state, input({ state: "pending" }), "t4")
    ).toThrow(OperationLedgerError);
  });

  it("rejects contradictory reuse of an operation id as ambiguous", () => {
    const state = ledger();
    recordOperation(state, input(), "t1");
    expect(() =>
      recordOperation(state, input({ checkpoint: "cp-2" }), "t2")
    ).toThrow(/conflicts with the recorded operation/);
    expect(() =>
      recordOperation(state, input({ expected: { base: "different" } }), "t2")
    ).toThrow(/conflicts/);
  });

  it("rejects a different id naming the same task, checkpoint, and kind", () => {
    const state = ledger();
    recordOperation(state, input(), "t1");
    expect(() =>
      recordOperation(state, input({ id: "op-2" }), "t2")
    ).toThrow(/duplicates/);
    recordOperation(state, input({ state: "rejected" }), "t2");
    expect(() => recordOperation(state, input({ id: "op-3" }), "t3")).toThrow(/duplicates/);
    const retry = recordOperation(state, input({ id: "op-3", checkpoint: "cp-reviewed-2" }), "t3");
    expect(retry.kind).toBe("recorded");
  });

  it("rejects different results recorded under the same state", () => {
    const state = ledger();
    recordOperation(state, input(), "t0");
    recordOperation(state, input({ state: "complete", result: { sha: "a" } }), "t1");
    expect(() =>
      recordOperation(state, input({ state: "complete", result: { sha: "b" } }), "t2")
    ).toThrow(/different result/);
  });

  it("validates the closed vocabulary and structured ids", () => {
    const state = ledger();
    expect(() =>
      recordOperation(state, input({ kind: "git push" as never }), "t1")
    ).toThrow(/kind must be one of/);
    expect(() => recordOperation(state, input({ id: " " }), "t1")).toThrow(/id must be/);
    expect(() => recordOperation(state, input({ expected: [] as never }), "t1")).toThrow(/object/);
  });
});

describe("ledger file", () => {
  it("preserves concurrent CLI reservations without losing records", async () => {
    const path = join(scratch, "concurrent.json");
    const executable = join(import.meta.dir, "pstack-worker-contract");
    const children = Array.from({ length: 16 }, (_, index) => Bun.spawn([
      process.execPath, executable,
      "op-record", "--ledger", path, "--id", `op-${index}`,
      "--task", "issue-57", "--checkpoint", `cp-${index}`,
      "--kind", "commit-checkpoint", "--state", "pending",
      "--expected", JSON.stringify({ head: "abc" }),
    ], { stdout: "pipe", stderr: "pipe" }));
    const exits = await Promise.all(children.map((child) => child.exited));
    expect(exits).toEqual(Array(16).fill(0));
    expect(readLedger(path).operations).toHaveLength(16);
    expect(recordOperationFile(path, input({ id: "op-0", checkpoint: "cp-0", expected: { head: "abc" } }), "later").kind)
      .toBe("idempotent");
  });

  it("requires a pending reservation before terminal outcomes", () => {
    expect(() => recordOperationFile(join(scratch, "ops.json"), input({ state: "complete" }), "t1"))
      .toThrow(/reserved as pending/);
  });
  it("round-trips a ledger and reports pending operations", () => {
    const path = join(scratch, "ops.json");
    const state = ledger();
    recordOperation(state, input(), "t1");
    recordOperation(state, input({ id: "op-2", checkpoint: "cp-2" }), "t2");
    recordOperation(state, input({ id: "op-2", checkpoint: "cp-2", state: "complete" }), "t2");
    writeLedger(path, state);
    const loaded = readLedger(path);
    expect(loaded.operations).toHaveLength(2);
    expect(pendingOperations(loaded).map((op) => op.id)).toEqual(["op-1"]);
    const after = readLedger(path);
    const outcome = recordOperation(after, input({ state: "complete" }), "t3");
    expect(outcome.kind).toBe("transitioned");
    writeLedger(path, after);
    expect(pendingOperations(readLedger(path))).toHaveLength(0);
  });

  it("starts empty when the file is absent and rejects duplicate ids on load", () => {
    const path = join(scratch, "ops.json");
    expect(readLedger(path).operations).toEqual([]);
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        operations: [
          { id: "x", task: "t", checkpoint: "c", kind: "run-checks", state: "pending", expected: {}, result: null, recordedAt: "t", completedAt: null },
          { id: "x", task: "t", checkpoint: "c2", kind: "run-checks", state: "pending", expected: {}, result: null, recordedAt: "t", completedAt: null },
        ],
      })
    );
    expect(() => readLedger(path)).toThrow(/repeats operation id/);
  });

  it("rejects malformed ledger payloads", () => {
    expect(() => parseLedger("not json", "x")).toThrow(OperationLedgerError);
    expect(() => parseLedger('{"version":2,"operations":[]}', "x")).toThrow(/version/);
    expect(() =>
      parseLedger('{"version":1,"operations":[{"id":"a"}]}', "x")
    ).toThrow(OperationLedgerError);
  });
});
