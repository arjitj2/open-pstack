import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ModelPolicyError,
  eventSuccessorAuthorized,
  nextAttempt,
  parseSheet,
  resolveRole,
  type AttemptEvent,
  type ContinuationPolicy,
  type ExecutionIdentity,
  type LanePolicy,
} from "./model-policy.ts";

const SHEET = `# pstack model configuration
# access: {"provider":"grok","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}
swarm workers: grok:grok-4.7@xhigh
`;

function lane(continuation?: ContinuationPolicy): LanePolicy {
  return {
    id: "swarm workers#1", fallback: { on: ["usage-exhausted"] }, continuation,
    attempts: [{ descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } }],
  };
}

const PERMISSION: ContinuationPolicy = { on: ["permission"], maxExecutions: 3 };
const HANDOFF: ContinuationPolicy = { on: ["handoff"], maxExecutions: 2 };
const CLEAR = { state: "clear", evidenceRef: "inspection/clear.json" } as const;
const DIGEST = "a".repeat(64);
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "pstack-continuation-")));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function identity(index: number): ExecutionIdentity {
  const workspacePath = join(ROOT, `workspace-${index}`);
  mkdirSync(workspacePath, { recursive: true });
  return {
    id: `exec-${index}`, outputPath: join(ROOT, `output-${index}`),
    receiptPath: join(ROOT, `receipt-${index}`), workspacePath,
    descriptor: "grok:grok-4.7@xhigh", apiSpend: "deny", access: "isolated-write", contract: "legacy",
  };
}

function denied(index = 0, overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    attemptIndex: 0, status: "permission-blocked", processStarted: true,
    deniedCause: "permission", inspection: CLEAR, continuationOrdinal: index,
    execution: identity(index),
    recovery: {
      correction: `corrected operation ${index}`, blockageId: `block-${index}`,
      snapshotRef: `/tmp/snapshot-${index}`, snapshotDigest: DIGEST,
      partialWorkRef: `/tmp/partial-${index}`, sideEffectsRef: `/tmp/effects-${index}`,
      stoppedWritersRef: `/tmp/stopped-${index}`, nextExecution: identity(index + 1),
    },
    ...overrides,
  };
}

function handoff(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return denied(0, {
    status: "needs-parent-operation", deniedCause: undefined,
    handoff: { operation: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    ...overrides,
  });
}

const op: AttemptEvent = {
  attemptIndex: 0, status: "complete",
  parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
};

describe("continuation sheet", () => {
  it("accepts only handoff and concrete permission recovery", () => {
    const model = parseSheet(`${SHEET}# continuation: {"on":["permission","handoff"],"max":2}\n`);
    expect(resolveRole(model, "swarm workers", "codex")?.lanes[0].continuation)
      .toEqual({ on: ["permission", "handoff"], maxExecutions: 2 });
    for (const reason of ["other", "guard", "unsupported-tool", "changed-files"]) {
      expect(() => parseSheet(`${SHEET}# continuation: {"on":["${reason}"]}\n`)).toThrow(ModelPolicyError);
    }
  });

  it("keeps an undeclared sheet at one attempt", () => {
    expect(nextAttempt(lane(), [denied()], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "no-continuation" });
  });
});

describe("permission continuation", () => {
  it("continues the same descriptor with the parent's fresh execution identity", () => {
    expect(nextAttempt(lane(PERMISSION), [denied()], new Set(), "isolated-write"))
      .toMatchObject({ kind: "continue", attemptIndex: 0, execution: 2, preparedExecution: identity(1) });
  });

  it("requires every part of the first recovery attestation", () => {
    const base = denied();
    const recovery = base.recovery!;
    for (const partial of [
      { correction: "" }, { blockageId: "" }, { snapshotRef: "" },
      { snapshotDigest: "not a digest" }, { partialWorkRef: "" },
      { sideEffectsRef: "" }, { stoppedWritersRef: "" },
      { nextExecution: identity(0) },
    ]) {
      const event = denied(0, { recovery: { ...recovery, ...partial } });
      expect(nextAttempt(lane(PERMISSION), [event], new Set(), "isolated-write"))
        .toMatchObject({ kind: "policy-denied", reason: "missing-readiness" });
    }
    expect(nextAttempt(lane(PERMISSION), [denied(0, { inspection: undefined })], new Set(), "isolated-write"))
      .toMatchObject({ kind: "inspect", reason: "started-writer" });
    expect(nextAttempt(lane(PERMISSION), [denied(0, { inspection: { state: "unsafe", evidenceRef: "x" } })], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "unsafe-writer" });
  });

  it("rejects unknown, safety, auth, spending, capability, and resource stops", () => {
    for (const cause of ["none", "other", "guard", "unsupported-tool", "changed-files"] as const) {
      expect(nextAttempt(lane(PERMISSION), [denied(0, { deniedCause: cause })], new Set(), "isolated-write").kind)
        .not.toBe("continue");
    }
    expect(nextAttempt(lane(PERMISSION), [{ attemptIndex: 0, status: "failed" }], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "not-eligible" });
    expect(nextAttempt(lane(PERMISSION), [{ attemptIndex: 0, status: "complete" }], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "complete" });
  });

  it("requires a new correction and blockage identity on later recovery", () => {
    const first = denied();
    const second = denied(1, { recovery: { ...denied(1).recovery!, correction: first.recovery!.correction } });
    expect(nextAttempt(lane(PERMISSION), [first, second], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "missing-readiness" });
    expect(nextAttempt(lane(PERMISSION), [first, denied(1)], new Set(), "isolated-write"))
      .toMatchObject({ kind: "continue", execution: 3 });
    expect(nextAttempt(lane({ on: ["permission"], maxExecutions: 2 }), [first, denied(1)], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "exhausted-allowance" });
  });

  it("authorizes only the prepared next execution in recorded history", () => {
    const first = denied();
    expect(eventSuccessorAuthorized(lane(PERMISSION), first, denied(1), "isolated-write")).toBe(true);
    expect(eventSuccessorAuthorized(lane(PERMISSION), first, denied(1, { execution: identity(9) }), "isolated-write")).toBe(false);
    expect(eventSuccessorAuthorized(lane(PERMISSION), first, denied(2), "isolated-write")).toBe(false);
  });

  it("keeps historical authorization after the successor writes its artifacts", () => {
    const firstBase = denied();
    const secondBase = denied(1);
    const first = { ...firstBase, execution: identity(20), recovery: { ...firstBase.recovery!, nextExecution: identity(21) } };
    const second = { ...secondBase, execution: identity(21), recovery: { ...secondBase.recovery!, nextExecution: identity(22) } };
    writeFileSync(second.execution!.outputPath, "finished output");
    writeFileSync(second.execution!.receiptPath, "finished receipt");
    expect(eventSuccessorAuthorized(lane(PERMISSION), first, second, "isolated-write")).toBe(true);
    expect(nextAttempt(lane(PERMISSION), [first, second], new Set(), "isolated-write"))
      .toMatchObject({ kind: "continue", execution: 3 });
  });
});

describe("handoff", () => {
  it("requests only the matching parent operation", () => {
    expect(nextAttempt(lane(HANDOFF), [handoff()], new Set(), "isolated-write"))
      .toMatchObject({ kind: "parent-operation", operation: op.parentOperation });
    expect(eventSuccessorAuthorized(lane(HANDOFF), handoff(), op, "isolated-write")).toBe(true);
    expect(eventSuccessorAuthorized(lane(HANDOFF), handoff(), { ...op, parentOperation: { ...op.parentOperation!, checkpointId: "wrong" } }, "isolated-write"))
      .toBe(false);
  });

  it("continues after a completed operation only with reviewed readiness", () => {
    expect(nextAttempt(lane(HANDOFF), [handoff(), op], new Set(), "isolated-write"))
      .toMatchObject({ kind: "continue", execution: 2, preparedExecution: identity(1) });
    expect(nextAttempt(lane(HANDOFF), [handoff({ recovery: undefined }), op], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "missing-readiness" });
    expect(nextAttempt(lane(HANDOFF), [handoff(), { ...op, status: "failed" }], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "not-eligible" });
    for (const status of ["needs-parent-operation", "permission-blocked", "route-unavailable"] as const) {
      expect(nextAttempt(lane(HANDOFF), [handoff(), { ...op, status }], new Set(), "isolated-write").kind)
        .not.toBe("continue");
    }
    expect(nextAttempt(lane(HANDOFF), [handoff(), op, { attemptIndex: 0, status: "complete" }], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "complete" });
  });
});
