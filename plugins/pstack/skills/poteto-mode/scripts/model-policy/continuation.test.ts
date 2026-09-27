import { describe, expect, it } from "bun:test";
import {
  ModelPolicyError,
  eventAdvancesUnderPolicy,
  eventSuccessorAuthorized,
  nextAttempt,
  parseSheet,
  resolveRole,
  type AttemptEvent,
  type ContinuationPolicy,
  type LanePolicy,
} from "./model-policy.ts";

const SHEET = `# pstack model configuration

# access: {"provider":"grok","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}
# access: {"provider":"devin","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}

swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high
`;

function lane(continuation?: ContinuationPolicy): LanePolicy {
  return {
    id: "swarm workers#1",
    fallback: { on: ["usage-exhausted"] },
    continuation,
    attempts: [
      { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
      { descriptor: "devin:swe-2@high", attempt: { kind: "descriptor", provider: "devin", model: "swe-2", effort: "high" }, exhaustionGroup: "devin", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
    ],
  };
}

const OTHER_ONLY: ContinuationPolicy = { on: ["other"], maxExecutions: 2 };
const HANDOFF_ONLY: ContinuationPolicy = { on: ["handoff"], maxExecutions: 2 };
const ALL: ContinuationPolicy = { on: ["handoff", "other", "guard", "unsupported-tool"], maxExecutions: 4 };

const CLEAR = { state: "clear", evidenceRef: "diff#1" } as const;

function denied(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    attemptIndex: 0,
    status: "permission-blocked",
    processStarted: true,
    deniedCause: "other",
    inspection: CLEAR,
    ...overrides,
  };
}

const HANDOFF = {
  operation: "commit-checkpoint",
  taskId: "issue-57",
  checkpointId: "cp-1",
} as const;

function handoff(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    attemptIndex: 0,
    status: "needs-parent-operation",
    processStarted: true,
    inspection: CLEAR,
    handoff: HANDOFF,
    ...overrides,
  };
}

describe("continuation sheet policy", () => {
  it("parses a declared continuation policy and propagates it to lanes", () => {
    const model = parseSheet(
      SHEET.replace(
        "# access: {\"provider\":\"devin\"",
        '# continuation: {"on":["handoff","other"],"max":2}\n# access: {"provider":"devin"'
      )
    );
    expect(model.continuation).toEqual({ on: ["handoff", "other"], maxExecutions: 2 });
    const policy = resolveRole(model, "swarm workers", "codex");
    expect(policy?.lanes[0].continuation).toEqual({ on: ["handoff", "other"], maxExecutions: 2 });
  });

  it("keeps sheets without a declaration at one-attempt semantics", () => {
    const policy = resolveRole(parseSheet(SHEET), "swarm workers", "codex");
    expect(policy?.lanes[0].continuation).toBeUndefined();
    expect(nextAttempt(lane(undefined), [denied()], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "no-continuation" });
  });

  it("rejects malformed, unknown, duplicate, and out-of-range declarations", () => {
    for (const declaration of [
      '{"on":"other"}',
      '{"on":["bogus"]}',
      '{"on":["changed-files"]}',
      '{"on":["other"],"max":0}',
      '{"on":["other"],"max":5}',
      '{"on":["other"],"limit":2}',
      "not json",
    ]) {
      expect(
        () => parseSheet(`${SHEET}\n# continuation: ${declaration}\n`),
        declaration
      ).toThrow(ModelPolicyError);
    }
    expect(() =>
      parseSheet(
        `${SHEET}\n# continuation: {"on":["other"]}\n# continuation: {"on":["guard"]}\n`
      )
    ).toThrow(/more than one # continuation/);
  });
});

describe("permission-blocked continuation decision", () => {
  it("continues on the same attempt with fresh execution identity", () => {
    const decision = nextAttempt(lane(OTHER_ONLY), [denied()], new Set(), "isolated-write");
    expect(decision).toMatchObject({ kind: "continue", attemptIndex: 0, execution: 2 });
    if (decision.kind !== "continue") throw new Error("expected continue");
    expect(decision.attempt.descriptor).toBe("grok:grok-4.7@xhigh");
  });

  it("denies causes the saved policy does not cover", () => {
    expect(
      nextAttempt(lane(ALL), [denied({ deniedCause: "changed-files" })], new Set(), "isolated-write")
    ).toMatchObject({ kind: "policy-denied", reason: "changed-files" });
    expect(
      nextAttempt(lane({ on: ["guard"], maxExecutions: 2 }), [denied()], new Set(), "isolated-write")
    ).toMatchObject({ kind: "policy-denied", reason: "no-continuation" });
  });

  it("enforces the finite execution allowance", () => {
    const events = [
      denied({ continuationOrdinal: 0 }),
      denied({ continuationOrdinal: 1, correction: "added the missing flag" }),
    ];
    expect(nextAttempt(lane(OTHER_ONLY), events, new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "exhausted-allowance" });
  });

  it("vetoes an unchanged repeat denial", () => {
    const base = [
      denied({ continuationOrdinal: 0 }),
      denied({ continuationOrdinal: 1, correction: "dropped the git call" }),
    ];
    expect(nextAttempt(lane(ALL), base, new Set(), "isolated-write"))
      .toMatchObject({ kind: "continue", attemptIndex: 0, execution: 3 });
    const unchanged = [
      denied({ continuationOrdinal: 0 }),
      denied({ continuationOrdinal: 1 }),
    ];
    expect(nextAttempt(lane(ALL), unchanged, new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "repeat-denial" });
    const sameCorrection = [
      denied({ continuationOrdinal: 0 }),
      denied({ continuationOrdinal: 1, correction: "same fix" }),
      denied({ continuationOrdinal: 2, correction: "same fix" }),
    ];
    expect(nextAttempt(lane(ALL), sameCorrection, new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "repeat-denial" });
  });

  it("inspects a started writer before continuing and stops on unsafe", () => {
    const uninspected = denied({ inspection: undefined });
    expect(nextAttempt(lane(ALL), [uninspected], new Set(), "isolated-write"))
      .toMatchObject({ kind: "inspect", reason: "started-writer" });
    const unsafe = denied({ inspection: { state: "unsafe", evidenceRef: "diff#1" } });
    expect(nextAttempt(lane(ALL), [unsafe], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "unsafe-writer" });
    // Read-only lanes and provably unstarted writers skip inspection.
    expect(nextAttempt(lane(ALL), [uninspected], new Set(), "read-only"))
      .toMatchObject({ kind: "continue" });
    expect(
      nextAttempt(lane(ALL), [denied({ processStarted: false, inspection: undefined })], new Set(), "isolated-write")
    ).toMatchObject({ kind: "continue" });
  });

  it("never falls back to another attempt on a permission block", () => {
    const decision = nextAttempt(lane(ALL), [denied()], new Set(), "isolated-write");
    expect(decision.kind).toBe("continue");
    if (decision.kind !== "continue") throw new Error("expected continue");
    expect(decision.attemptIndex).toBe(0);
  });
});

describe("handoff and parent-operation decision", () => {
  it("proposes exactly the parent operation the handoff requested", () => {
    const decision = nextAttempt(lane(HANDOFF_ONLY), [handoff()], new Set(), "isolated-write");
    expect(decision).toMatchObject({
      kind: "parent-operation",
      attemptIndex: 0,
      operation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    });
  });

  it("continues on the same route after the requested operation completes", () => {
    const op: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    const decision = nextAttempt(lane(HANDOFF_ONLY), [handoff(), op], new Set(), "isolated-write");
    expect(decision).toMatchObject({ kind: "continue", attemptIndex: 0, execution: 2 });
    if (decision.kind !== "continue") throw new Error("expected continue");
    expect(decision.attempt.descriptor).toBe("grok:grok-4.7@xhigh");
  });

  it("denies handoff continuation the sheet never opted into", () => {
    const op: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    expect(nextAttempt(lane(OTHER_ONLY), [handoff(), op], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "no-continuation" });
    expect(nextAttempt(lane(undefined), [handoff(), op], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "no-continuation" });
  });

  it("stops after a failed operation and rejects conflicting or ambiguous op records", () => {
    const failed: AttemptEvent = {
      attemptIndex: 0,
      status: "failed",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    expect(nextAttempt(lane(HANDOFF_ONLY), [handoff(), failed], new Set(), "isolated-write"))
      .toMatchObject({ kind: "stop", reason: "not-eligible" });
    const wrongKind: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "run-checks", taskId: "issue-57", checkpointId: "cp-1" },
    };
    expect(nextAttempt(lane(HANDOFF_ONLY), [handoff(), wrongKind], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "conflicting-operation" });
    const extra: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    expect(
      nextAttempt(lane(HANDOFF_ONLY), [handoff(), extra, extra], new Set(), "isolated-write")
    ).toMatchObject({ kind: "policy-denied", reason: "ambiguous-state" });
    // Orphan operation records with no requesting outcome are ambiguous too.
    expect(nextAttempt(lane(HANDOFF_ONLY), [extra], new Set(), "isolated-write"))
      .toMatchObject({ kind: "policy-denied", reason: "ambiguous-state" });
  });

  it("requires a recorded clear inspection before the parent operates", () => {
    expect(
      nextAttempt(lane(HANDOFF_ONLY), [handoff({ inspection: undefined })], new Set(), "isolated-write")
    ).toMatchObject({ kind: "inspect", reason: "started-writer" });
    expect(
      nextAttempt(
        lane(HANDOFF_ONLY),
        [handoff({ inspection: { state: "unsafe", evidenceRef: "x" } })],
        new Set(),
        "isolated-write"
      )
    ).toMatchObject({ kind: "stop", reason: "unsafe-writer" });
  });

  it("does not let an operation record masquerade as task completion", () => {
    const op: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    // A completed op alone continues the assignment; only a worker
    // completion event closes it.
    const decision = nextAttempt(lane(HANDOFF_ONLY), [handoff(), op], new Set(), "isolated-write");
    expect(decision.kind).toBe("continue");
    expect(
      nextAttempt(
        lane(HANDOFF_ONLY),
        [handoff(), op, { attemptIndex: 0, status: "complete", continuationOrdinal: 1 }],
        new Set(),
        "isolated-write"
      )
    ).toMatchObject({ kind: "stop", reason: "complete" });
  });
});

describe("pairwise event authorization", () => {
  it("authorizes a handoff only to the matching parent operation", () => {
    const request = handoff();
    const matching: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    const wrongCheckpoint: AttemptEvent = {
      ...matching,
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-2" },
    };
    const exec: AttemptEvent = { attemptIndex: 0, status: "complete", continuationOrdinal: 1 };
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), request, matching, "isolated-write")).toBe(true);
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), request, wrongCheckpoint, "isolated-write")).toBe(false);
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), request, exec, "isolated-write")).toBe(false);
  });

  it("authorizes a denial only to the next same-attempt execution", () => {
    const first = denied({ continuationOrdinal: 0 });
    const continued = denied({ continuationOrdinal: 1, correction: "fixed" });
    const wrongOrdinal = denied({ continuationOrdinal: 2 });
    const laterAttempt = denied({ attemptIndex: 1 });
    expect(eventSuccessorAuthorized(lane(ALL), first, continued, "isolated-write")).toBe(true);
    expect(eventSuccessorAuthorized(lane(ALL), first, wrongOrdinal, "isolated-write")).toBe(false);
    expect(eventSuccessorAuthorized(lane(ALL), first, laterAttempt, "isolated-write")).toBe(false);
    // Without the opt-in clause the pair is never legal.
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), first, continued, "isolated-write")).toBe(false);
  });

  it("authorizes a completed operation only to a same-attempt execution", () => {
    const op: AttemptEvent = {
      attemptIndex: 0,
      status: "complete",
      parentOperation: { kind: "commit-checkpoint", taskId: "issue-57", checkpointId: "cp-1" },
    };
    const failedOp: AttemptEvent = { ...op, status: "failed" };
    const exec: AttemptEvent = { attemptIndex: 0, status: "permission-blocked", deniedCause: "other", continuationOrdinal: 1 };
    const otherAttempt: AttemptEvent = { attemptIndex: 1, status: "usage-exhausted" };
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), op, exec, "isolated-write")).toBe(true);
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), op, otherAttempt, "isolated-write")).toBe(false);
    expect(eventSuccessorAuthorized(lane(HANDOFF_ONLY), op, op, "isolated-write")).toBe(false);
    expect(eventAdvancesUnderPolicy(lane(HANDOFF_ONLY), failedOp, "isolated-write")).toBe(false);
  });
});
