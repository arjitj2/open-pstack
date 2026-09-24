import { describe, expect, it } from "bun:test";
import {
  ModelPolicyError,
  nextAttempt,
  type AttemptOutcomeStatus,
  type LanePolicy,
} from "./model-policy.ts";
import {
  RECEIPT_EVENT_STATUS,
  normalizeReceiptEvent,
  type ReceiptIdentity,
} from "./receipt-event.ts";
import { PROVIDERS, RECEIPT_STATUSES, type ReceiptStatus } from "../runner/types.ts";

const IDENTITY: ReceiptIdentity = {
  parent: "codex",
  provider: "claude",
  model: "opus",
  effort: "high",
  mode: "read-only",
  apiSpend: "unset",
};

// A two-attempt writer lane whose saved policy authorizes every recoverable
// outcome, so only the normalized event status can stop a launch.
const WRITER_LANE: LanePolicy = {
  id: "swarm workers#1",
  fallback: {
    on: ["usage-exhausted", "route-unavailable", "terminal-failure", "deadline-exceeded"],
  },
  attempts: [
    { descriptor: "claude:opus@high", attempt: { kind: "descriptor", provider: "claude", model: "opus", effort: "high" }, exhaustionGroup: "claude", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
    { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
  ],
};

function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    status: "child-failed",
    parent: "codex",
    provider: "claude",
    model: "opus",
    effort: "high",
    mode: "read-only",
    cwd: "/tmp/work",
    promptPath: "/tmp/prompt.md",
    outputPath: "/tmp/out",
    startedAt: "2026-09-24T00:00:00Z",
    completedAt: "2026-09-24T00:00:01Z",
    elapsedMs: 1_000,
    executable: "/usr/bin/claude",
    preflight: { argv: ["claude", "auth", "status"], status: "passed", evidence: "authenticated" },
    argv: ["claude", "-p"],
    exitCode: 1,
    signal: null,
    reportedModel: null,
    modelVerified: false,
    modelEvidence: null,
    sessionId: null,
    usage: null,
    costUsd: null,
    error: { message: "child exited with status 1", evidence: "stderr text" },
    failurePhase: "invocation",
    processStarted: true,
    apiSpend: "legacy",
    timeoutMs: null,
    ...overrides,
  };
}

describe("receipt event mapping", () => {
  it("is total over every receipt status for every provider", () => {
    expect(Object.keys(RECEIPT_EVENT_STATUS).sort()).toEqual(
      [...RECEIPT_STATUSES].sort()
    );
    const preflightStatuses = new Set([
      "billing-policy-blocked",
      "unavailable-cli",
      "unauthenticated",
      "unavailable-model",
      "timed-out",
    ]);
    for (const provider of PROVIDERS) {
      for (const status of RECEIPT_STATUSES) {
        const identity: ReceiptIdentity = {
          parent: provider === "codex" ? "claude" : "codex",
          provider,
          model: "m",
          effort: "high",
          mode: "read-only",
          apiSpend: "unset",
        };
        const base = receipt({
          parent: identity.parent,
          provider,
          model: "m",
          status,
          error: status === "complete" ? null : { message: "m", evidence: "e" },
          exitCode:
            status === "complete" || status === "malformed-output"
              ? 0
              : status === "timed-out" ||
                  status === "cancelled" ||
                  status === "billing-policy-blocked" ||
                  status === "unavailable-cli"
                ? null
                : 1,
          failurePhase:
            status === "complete"
              ? null
              : status === "malformed-output"
                ? "postprocess"
                : preflightStatuses.has(status)
                  ? "preflight"
                  : "invocation",
          processStarted: !preflightStatuses.has(status),
          timeoutMs: status === "timed-out" ? 5_000 : null,
          terminalSuccess:
            preflightStatuses.has(status) ||
            status === "complete" ||
            status === "cancelled"
              ? undefined
              : false,
        });
        const event = normalizeReceiptEvent(base, identity);
        expect(event.status, `${provider}/${status}`).toBe(
          RECEIPT_EVENT_STATUS[status as ReceiptStatus]
        );
      }
    }
  });

  it("maps terminal receipt statuses to policy outcomes", () => {
    const cases: Array<[string, Record<string, unknown>, AttemptOutcomeStatus]> = [
      ["complete", { status: "complete", exitCode: 0, error: null, failurePhase: null }, "complete"],
      ["cancelled", { status: "cancelled", exitCode: null, processStarted: true }, "failed"],
      ["billing-policy-blocked", { status: "billing-policy-blocked", exitCode: null, processStarted: false, failurePhase: "preflight" }, "failed"],
      ["unavailable-cli", { status: "unavailable-cli", exitCode: null, processStarted: false, failurePhase: "preflight" }, "route-unavailable"],
      ["unauthenticated", { status: "unauthenticated", exitCode: 77, processStarted: false, failurePhase: "preflight" }, "route-unavailable"],
      ["unavailable-model", { status: "unavailable-model", exitCode: 69, processStarted: false, failurePhase: "preflight" }, "route-unavailable"],
      ["usage-exhausted", { status: "usage-exhausted", exitCode: 75 }, "usage-exhausted"],
      ["child-failed", { status: "child-failed", exitCode: 1, terminalSuccess: false }, "terminal-failure"],
      ["malformed-output", { status: "malformed-output", exitCode: 0, failurePhase: "postprocess", terminalSuccess: false }, "terminal-failure"],
      ["timed-out", { status: "timed-out", timeoutMs: 30_000, terminalSuccess: false }, "deadline-exceeded"],
    ];
    for (const [name, overrides, expected] of cases) {
      expect(
        normalizeReceiptEvent(receipt(overrides), IDENTITY).status,
        name
      ).toBe(expected);
    }
  });

  it("treats a generic 429 child failure as terminal-failure, never quota", () => {
    const event = normalizeReceiptEvent(
      receipt({
        terminalSuccess: false,
        error: {
          message: "child exited with status 1",
          evidence: "HTTP 429 Too Many Requests: rate limit exceeded",
        },
      }),
      IDENTITY
    );
    expect(event.status).toBe("terminal-failure");
  });

  it("requires an explicit recorded deadline and a settled owned process for deadline-exceeded", () => {
    expect(
      normalizeReceiptEvent(
        receipt({ status: "timed-out", timeoutMs: 30_000, terminalSuccess: false }),
        IDENTITY
      ).status
    ).toBe("deadline-exceeded");
    // A proved preflight deadline stays eligible without a recorded
    // success-conflict assessment: the child never ran, so there is no
    // completed work a missing assessment could mask.
    expect(
      normalizeReceiptEvent(
        receipt({ status: "timed-out", timeoutMs: 30_000, processStarted: false, exitCode: null, failurePhase: "preflight" }),
        IDENTITY
      ).status
    ).toBe("deadline-exceeded");
    expect(
      normalizeReceiptEvent(
        receipt({ status: "timed-out", timeoutMs: 30_000, exitCode: null, signal: "SIGTERM", terminalSuccess: false }),
        IDENTITY
      ).status
    ).toBe("deadline-exceeded");
    for (const overrides of [
      { status: "timed-out", timeoutMs: null },
      { status: "timed-out", timeoutMs: 30_000, exitCode: null, terminalSuccess: false },
      { status: "timed-out" },
      // An old runner never assessed whether the timed-out child finished;
      // a started receipt without the field cannot prove the deadline lane.
      { status: "timed-out", timeoutMs: 30_000 },
      { status: "timed-out", timeoutMs: 30_000, terminalSuccess: true },
    ]) {
      expect(
        normalizeReceiptEvent(receipt(overrides), IDENTITY).status,
        JSON.stringify(overrides)
      ).toBe("failed");
    }
  });

  it("treats a child failure without a settled exit as a launcher error, not a backend failure", () => {
    const event = normalizeReceiptEvent(
      receipt({
        exitCode: null,
        error: {
          message: "launcher failed after reserving output paths",
          evidence: "spawn failed",
        },
        failurePhase: "preflight",
        processStarted: false,
      }),
      IDENTITY
    );
    expect(event.status).toBe("failed");
  });

  it("requires settled child evidence for every started recoverable failure", () => {
    for (const [status, extra] of [
      ["child-failed", { terminalSuccess: false }],
      ["malformed-output", { terminalSuccess: false, exitCode: null, failurePhase: "invocation" }],
      ["usage-exhausted", { terminalSuccess: false }],
      ["unavailable-model", { terminalSuccess: false }],
      ["unauthenticated", { terminalSuccess: false }],
      ["timed-out", { terminalSuccess: false, timeoutMs: 30_000 }],
    ] as const) {
      const event = normalizeReceiptEvent(
        receipt({ status, exitCode: null, signal: null, ...extra }),
        IDENTITY
      );
      expect(event.status, status).toBe("failed");
    }
  });

  it("accepts a recorded signal as settlement for a started terminal failure", () => {
    const event = normalizeReceiptEvent(
      receipt({ exitCode: null, signal: "SIGKILL", terminalSuccess: false }),
      IDENTITY
    );
    expect(event.status).toBe("terminal-failure");
  });

  it("vetoes every recoverable status on a trusted terminal success", () => {
    for (const [status, extra] of [
      ["child-failed", {}],
      ["malformed-output", { exitCode: 0, failurePhase: "postprocess" }],
      ["usage-exhausted", {}],
      ["unavailable-model", {}],
      ["unavailable-cli", { exitCode: null, processStarted: false, failurePhase: "preflight" }],
      ["unauthenticated", {}],
      ["timed-out", { timeoutMs: 30_000 }],
    ] as const) {
      const event = normalizeReceiptEvent(
        receipt({ status, terminalSuccess: true, ...extra }),
        IDENTITY
      );
      expect(event.status, status).toBe("failed");
    }
  });

  it("treats a missing success-conflict assessment as unproven for terminal-failure", () => {
    for (const [status, extra] of [
      ["child-failed", {}],
      ["malformed-output", { exitCode: 0, failurePhase: "postprocess" }],
    ] as const) {
      const event = normalizeReceiptEvent(
        receipt({ status, ...extra }),
        IDENTITY
      );
      expect(event.status, status).toBe("failed");
    }
    expect(
      normalizeReceiptEvent(receipt({ status: "usage-exhausted" }), IDENTITY).status
    ).toBe("usage-exhausted");
    // A proved preflight route failure stays eligible without the field —
    // the child never ran — but a started route failure from an old runner
    // can mask completed work and must normalize to failed.
    expect(
      normalizeReceiptEvent(
        receipt({ status: "unavailable-model", exitCode: 69, processStarted: false, failurePhase: "preflight" }),
        IDENTITY
      ).status
    ).toBe("route-unavailable");
    expect(
      normalizeReceiptEvent(receipt({ status: "unavailable-model" }), IDENTITY).status
    ).toBe("failed");
  });

  it("requires a recorded assessment for every started or unknown-start broad outcome", () => {
    for (const [status, extra] of [
      ["timed-out", { timeoutMs: 30_000 }],
      ["child-failed", {}],
      ["malformed-output", { exitCode: 0, failurePhase: "postprocess" }],
    ] as const) {
      const expected = RECEIPT_EVENT_STATUS[status as ReceiptStatus];
      // A runner that assessed no success conflict stays eligible.
      expect(
        normalizeReceiptEvent(
          receipt({ status, terminalSuccess: false, ...extra }),
          IDENTITY
        ).status,
        `${status} assessed`
      ).toBe(expected);
      // A receipt that predates the field proves nothing once the child may
      // have run.
      expect(
        normalizeReceiptEvent(receipt({ status, ...extra }), IDENTITY).status,
        `${status} unassessed`
      ).toBe("failed");
      // A trusted final success still vetoes.
      expect(
        normalizeReceiptEvent(
          receipt({ status, terminalSuccess: true, ...extra }),
          IDENTITY
        ).status,
        `${status} conflicted`
      ).toBe("failed");
      // An unknown start is treated as possibly started.
      const { processStarted, ...unknownStart } = receipt({ status, ...extra });
      expect(
        normalizeReceiptEvent(unknownStart, IDENTITY).status,
        `${status} unknown-start`
      ).toBe("failed");
      const assessedUnknownStart = receipt({
        status,
        terminalSuccess: false,
        ...extra,
      });
      delete assessedUnknownStart.processStarted;
      expect(
        normalizeReceiptEvent(assessedUnknownStart, IDENTITY).status,
        `${status} unknown-start assessed`
      ).toBe(expected);
    }
    // Proved preflight failures remain valid without the field.
    for (const [status, extra, expected] of [
      ["unavailable-model", { exitCode: 69 }, "route-unavailable"],
      ["unauthenticated", { exitCode: 77 }, "route-unavailable"],
      ["timed-out", { exitCode: null, timeoutMs: 30_000 }, "deadline-exceeded"],
    ] as const) {
      expect(
        normalizeReceiptEvent(
          receipt({ status, processStarted: false, failurePhase: "preflight", ...extra }),
          IDENTITY
        ).status,
        `${status} preflight`
      ).toBe(expected);
    }
  });

  it("grants quota only to a workload-phase failure of a settled child", () => {
    for (const overrides of [
      // A proved-not-started preflight receipt cannot observe runner quota,
      // however it settled and however it was assessed.
      { status: "usage-exhausted", processStarted: false, failurePhase: "preflight", exitCode: null },
      { status: "usage-exhausted", processStarted: false, failurePhase: "preflight", exitCode: 75, terminalSuccess: false },
      // A quota claim with no recorded workload phase fails closed.
      { status: "usage-exhausted", failurePhase: null },
      { status: "usage-exhausted", failurePhase: null, terminalSuccess: false },
    ]) {
      const event = normalizeReceiptEvent(
        receipt({ error: { message: "quota", evidence: "captured diagnostic" }, ...overrides }),
        IDENTITY
      );
      expect(event.status, JSON.stringify(overrides)).toBe("failed");
      expect(
        nextAttempt(
          WRITER_LANE,
          [{ attemptIndex: 0, ...event }],
          new Set(),
          "isolated-write"
        ),
        JSON.stringify(overrides)
      ).toMatchObject({ kind: "stop", reason: "not-eligible" });
    }
    // A receipt that omits failurePhase entirely is rejected, not mapped.
    const { failurePhase, ...noPhase } = receipt({
      status: "usage-exhausted",
      error: { message: "quota", evidence: "captured diagnostic" },
    });
    expect(() => normalizeReceiptEvent(noPhase, IDENTITY)).toThrow(ModelPolicyError);
    // A legacy receipt that predates processStarted stays eligible when the
    // recorded workload phase and a settled child carry the proof.
    const { processStarted, ...legacy } = receipt({
      status: "usage-exhausted",
      exitCode: 75,
      error: { message: "quota", evidence: "captured diagnostic" },
    });
    expect(normalizeReceiptEvent(legacy, IDENTITY).status).toBe("usage-exhausted");
    // The runner's postprocess quota form: a terminal envelope after a clean
    // child exit.
    expect(
      normalizeReceiptEvent(
        receipt({
          status: "usage-exhausted",
          exitCode: 0,
          failurePhase: "postprocess",
          terminalSuccess: false,
        }),
        IDENTITY
      ).status
    ).toBe("usage-exhausted");
  });

  it("grants route-unavailable only to a proved-not-started preflight failure", () => {
    for (const status of ["unavailable-cli", "unauthenticated", "unavailable-model"] as const) {
      // A started invocation claim can mask completed work: it normalizes to
      // failed even when the runner recorded no success conflict.
      for (const overrides of [
        { status, terminalSuccess: false },
        { status, exitCode: 69, terminalSuccess: false },
        { status },
      ]) {
        const event = normalizeReceiptEvent(receipt(overrides), IDENTITY);
        expect(event.status, JSON.stringify(overrides)).toBe("failed");
        expect(
          nextAttempt(
            WRITER_LANE,
            [{ attemptIndex: 0, ...event }],
            new Set(),
            "isolated-write"
          ),
          JSON.stringify(overrides)
        ).toMatchObject({ kind: "stop", reason: "not-eligible" });
      }
      // An unknown start is treated as possibly started, assessed or not.
      for (const terminalSuccess of [false, undefined]) {
        const { processStarted, ...unknownStart } = receipt({ status, terminalSuccess });
        expect(
          normalizeReceiptEvent(unknownStart, IDENTITY).status,
          `${status} unknown-start`
        ).toBe("failed");
      }
      // Only a proved-not-started preflight failure stays eligible, with or
      // without a recorded success-conflict assessment.
      for (const terminalSuccess of [false, undefined]) {
        expect(
          normalizeReceiptEvent(
            receipt({ status, processStarted: false, failurePhase: "preflight", terminalSuccess }),
            IDENTITY
          ).status,
          `${status} preflight`
        ).toBe("route-unavailable");
      }
    }
  });

  it("keeps cancelled and billing-blocked terminal even under broad policy", () => {
    for (const status of ["cancelled", "billing-policy-blocked"] as const) {
      expect(
        normalizeReceiptEvent(
          receipt({
            status,
            exitCode: null,
            processStarted: status === "billing-policy-blocked" ? false : true,
            failurePhase: status === "billing-policy-blocked" ? "preflight" : "invocation",
          }),
          IDENTITY
        ).status,
        status
      ).toBe("failed");
    }
  });

  it("omits processStarted when the receipt never recorded it", () => {
    const { processStarted, ...rest } = receipt({ terminalSuccess: false });
    const event = normalizeReceiptEvent(rest, IDENTITY);
    expect(event.status).toBe("terminal-failure");
    expect(event.processStarted).toBeUndefined();
    expect(
      normalizeReceiptEvent(receipt({ terminalSuccess: false }), IDENTITY).processStarted
    ).toBe(true);
  });
});

describe("receipt identity and consistency validation", () => {
  it("rejects identity mismatches on parent, provider, model, effort, and mode", () => {
    for (const [key, value] of [
      ["parent", "claude"],
      ["provider", "grok"],
      ["model", "sonnet"],
      ["effort", "max"],
      ["mode", "isolated-write"],
    ] as const) {
      expect(
        () => normalizeReceiptEvent(receipt({ [key]: value }), IDENTITY),
        key
      ).toThrow(ModelPolicyError);
      expect(
        () => normalizeReceiptEvent(receipt({ [key]: value }), IDENTITY)
      ).toThrow(/identity mismatch/);
    }
  });

  it("binds the recorded apiSpend to the saved access fact", () => {
    const deny: ReceiptIdentity = { ...IDENTITY, apiSpend: "deny" };
    expect(
      normalizeReceiptEvent(
        receipt({ apiSpend: "deny", terminalSuccess: false }),
        deny
      ).status
    ).toBe("terminal-failure");
    for (const value of ["approved", "legacy", undefined]) {
      expect(
        () => normalizeReceiptEvent(receipt({ apiSpend: value }), deny),
        String(value)
      ).toThrow(/identity mismatch on apiSpend|apiSpend/);
    }
    expect(
      normalizeReceiptEvent(
        receipt({ apiSpend: "legacy", terminalSuccess: false }),
        IDENTITY
      ).status
    ).toBe("terminal-failure");
    const { apiSpend, ...legacyReceipt } = receipt({ terminalSuccess: false });
    expect(normalizeReceiptEvent(legacyReceipt, IDENTITY).status).toBe("terminal-failure");
    for (const value of ["deny", "approved"]) {
      expect(
        () => normalizeReceiptEvent(receipt({ apiSpend: value }), IDENTITY),
        value
      ).toThrow(/apiSpend/);
    }
  });

  it("rejects contradictory phase, start, and exit combinations", () => {
    for (const overrides of [
      { processStarted: false, failurePhase: "invocation" },
      { processStarted: false, failurePhase: "invocation", status: "usage-exhausted", exitCode: 75 },
      { processStarted: false, failurePhase: "postprocess" },
      { processStarted: false, failurePhase: "invocation", status: "malformed-output", exitCode: null },
      { processStarted: true, failurePhase: "preflight" },
      { processStarted: true, failurePhase: "preflight", status: "unavailable-cli" },
      { failurePhase: "postprocess", exitCode: 1 },
      { failurePhase: "postprocess", exitCode: null },
      { status: "complete", exitCode: 0, error: null, failurePhase: null, processStarted: false },
    ]) {
      expect(
        () => normalizeReceiptEvent(receipt(overrides), IDENTITY),
        JSON.stringify(overrides)
      ).toThrow(ModelPolicyError);
    }
  });

  it("rejects malformed and inconsistent receipts", () => {
    for (const value of [
      null,
      "receipt",
      [],
      receipt({ schemaVersion: 2 }),
      receipt({ status: "exploded" }),
      receipt({ status: "complete" }),
      receipt({ status: "complete", exitCode: 0 }),
      receipt({ status: "complete", exitCode: 0, error: null, failurePhase: "invocation" }),
      receipt({ status: "complete", exitCode: 1, error: null, failurePhase: null }),
      receipt({ status: "complete", exitCode: 0, error: null, failurePhase: null, terminalSuccess: true }),
      receipt({ error: null }),
      receipt({ status: "usage-exhausted", error: { message: "quota", evidence: "  " } }),
      receipt({ processStarted: "yes" }),
      receipt({ exitCode: 1.5 }),
      receipt({ signal: 15 }),
      receipt({ signal: "  " }),
      receipt({ timeoutMs: "soon" }),
      receipt({ timeoutMs: -5, status: "timed-out" }),
      receipt({ terminalSuccess: "yes" }),
      receipt({ apiSpend: "sometimes" }),
      receipt({ parent: "grok" }),
      receipt({ provider: "openai" }),
      receipt({ model: "" }),
      receipt({ effort: "ludicrous" }),
      receipt({ mode: "full-send" }),
      receipt({ error: { message: "m" } }),
      receipt({ failurePhase: "during" }),
    ]) {
      expect(
        () => normalizeReceiptEvent(value, IDENTITY),
        JSON.stringify(value)?.slice(0, 120)
      ).toThrow(ModelPolicyError);
    }
  });
});
