import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "./cli.ts";

const SHEET = `# pstack model configuration

# access: {"provider":"grok","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}
# access: {"provider":"devin","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}

swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high
`;

let scratch = "";

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    capture: {
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
    },
  };
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-model-policy-cli-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("model-policy CLI sheet reads", () => {
  it("reports unconfigured only for a missing sheet", async () => {
    const capture = io();
    const code = await main(
      ["resolve", "--sheet", join(scratch, "missing.sheet"), "--role", "swarm workers", "--parent", "codex"],
      capture.capture
    );
    expect(code).toBe(0);
    expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
      status: "unconfigured",
      role: "swarm workers",
    });
  });

  it("fails rather than defaulting when the sheet path cannot be read", async () => {
    const capture = io();
    const code = await main(
      ["resolve", "--sheet", scratch, "--role", "swarm workers", "--parent", "codex"],
      capture.capture
    );
    expect(code).toBe(64);
    expect(capture.stderr.join("")).toContain("cannot read sheet");
    expect(capture.stdout.join("")).toBe("");
  });
});

describe("model-policy missing configuration boundary", () => {
  it("rejects a path beneath a regular file instead of selecting defaults", () => {
    const file = join(scratch, "not-a-directory");
    writeFileSync(file, "unchanged");
    const capture = io();
    expect(main(["resolve", "--sheet", join(file, "models.md"), "--role", "swarm workers", "--parent", "codex"], capture.capture)).toBe(64);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr.join("")).toContain("cannot read sheet");
  });

  it("keeps missing-role defaults only for legacy sheets", () => {
    for (const [text, expected] of [["how explorer: inherit-parent\n", 0], [SHEET, 65]] as const) {
      const path = join(scratch, "partial.md");
      writeFileSync(path, text);
      const capture = io();
      expect(main(["resolve", "--sheet", path, "--role", "bug-fix", "--parent", "codex"], capture.capture)).toBe(expected);
      if (expected === 0) expect(JSON.parse(capture.stdout.join("")).status).toBe("unconfigured");
      else {
        expect(capture.stdout).toEqual([]);
        expect(capture.stderr.join("")).toContain("policy-enabled sheet has no role");
      }
    }
  });
});

describe("model-policy next command", () => {
  function sheetPath(text: string = SHEET): string {
    const path = join(scratch, "models.sheet");
    writeFileSync(path, text);
    return path;
  }

  function statePath(state: unknown): string {
    const path = join(scratch, "state.json");
    writeFileSync(path, typeof state === "string" ? state : JSON.stringify({ access: "read-only", ...(state as object) }));
    return path;
  }

  function args(state: string, sheet: string = sheetPath()): string[] {
    return [
      "next",
      "--sheet", sheet,
      "--role", "swarm workers",
      "--parent", "codex",
      "--state", state,
    ];
  }

  it("launches the first authorized attempt on an empty event log", async () => {
    const capture = io();
    const code = await main(args(statePath({ events: [] })), capture.capture);
    expect(code).toBe(0);
    const out = JSON.parse(capture.stdout.join(""));
    expect(out).toMatchObject({
      status: "decision",
      role: "swarm workers",
      header: "swarm workers",
      laneIndex: 0,
      decision: {
        kind: "launch",
        attemptIndex: 0,
        attempt: { descriptor: "grok:grok-4.7@xhigh", apiSpend: "deny" },
      },
    });
  });

  it("advances on usage-exhausted and stops when the chain is exhausted", async () => {
    const advance = io();
    expect(
      await main(
        args(statePath({
          events: [{ attemptIndex: 0, status: "usage-exhausted", processStarted: true }],
          exhaustedGroups: ["grok"],
        })),
        advance.capture
      )
    ).toBe(0);
    expect(JSON.parse(advance.stdout.join("")).decision).toMatchObject({
      kind: "launch",
      attemptIndex: 1,
    });

    const done = io();
    expect(
      await main(
        args(statePath({
          events: [
            { attemptIndex: 0, status: "usage-exhausted", processStarted: true },
            { attemptIndex: 1, status: "usage-exhausted", processStarted: true },
          ],
          exhaustedGroups: ["grok", "devin"],
        })),
        done.capture
      )
    ).toBe(0);
    expect(JSON.parse(done.stdout.join("")).decision).toMatchObject({
      kind: "stop",
      reason: "chain-exhausted",
    });
  });

  it("rejects omitted access instead of assuming a writer is read-only", () => {
    const capture = io();
    expect(main(args(statePath(JSON.stringify({ events: [
      { attemptIndex: 0, status: "usage-exhausted", processStarted: true },
    ], exhaustedGroups: ["grok"] }))), capture.capture)).toBe(64);
    expect(capture.stdout).toEqual([]);
    expect(capture.stderr.join("")).toContain('"access" must be');
  });

  it("rejects impossible histories instead of launching another attempt", () => {
    for (const events of [
      [{ attemptIndex: 0, status: "complete" }, { attemptIndex: 99, status: "usage-exhausted", processStarted: false }],
      [{ attemptIndex: 0, status: "complete" }, { attemptIndex: 1, status: "usage-exhausted" }],
      [{ attemptIndex: 0, status: "failed" }, { attemptIndex: 1, status: "usage-exhausted" }],
      [{ attemptIndex: 0, status: "usage-exhausted" }, { attemptIndex: 0, status: "usage-exhausted" }],
      [{ attemptIndex: 1, status: "usage-exhausted" }, { attemptIndex: 0, status: "usage-exhausted" }],
    ]) {
      const capture = io();
      expect(main(args(statePath({ events, exhaustedGroups: ["grok"] })), capture.capture)).toBe(64);
      expect(capture.stdout).toEqual([]);
    }
  });

  it("permits history gaps only for providers exhausted elsewhere", () => {
    for (const exhaustedGroups of [[], ["grok"]]) {
      const capture = io();
      const code = main(args(statePath({ events: [{ attemptIndex: 1, status: "usage-exhausted", processStarted: false }], exhaustedGroups })), capture.capture);
      expect(code).toBe(exhaustedGroups.length === 0 ? 64 : 0);
      if (code === 0) expect(JSON.parse(capture.stdout.join("")).decision).toEqual({ kind: "stop", reason: "chain-exhausted" });
      else expect(capture.stdout).toEqual([]);
    }
  });

  it("rejects a history recorded on an attempt the sheet does not authorize", async () => {
    const blocked = sheetPath(SHEET.replace(
      '"provider":"grok","funding":"included"',
      '"provider":"grok","funding":"unknown"'
    ));
    for (const events of [
      [{ attemptIndex: 0, status: "terminal-failure", processStarted: false }],
      [
        { attemptIndex: 0, status: "terminal-failure", processStarted: false },
        { attemptIndex: 1, status: "usage-exhausted", processStarted: false },
      ],
    ]) {
      const capture = io();
      const code = await main(
        args(statePath({ events, exhaustedGroups: ["grok"] }), blocked),
        capture.capture
      );
      expect(code, JSON.stringify(events)).toBe(64);
      expect(capture.stdout, JSON.stringify(events)).toEqual([]);
      expect(capture.stderr.join(""), JSON.stringify(events)).toContain(
        "does not authorize"
      );
    }
  });

  it("rejects history that skips a blocked route even when its provider is exhausted", async () => {
    const blocked = sheetPath(SHEET.replace(
      '"provider":"grok","funding":"included"',
      '"provider":"grok","funding":"unknown"'
    ));
    for (const exhaustedGroups of [[], ["grok"]]) {
      const capture = io();
      const code = await main(
        args(
          statePath({
            events: [{ attemptIndex: 1, status: "usage-exhausted", processStarted: false }],
            exhaustedGroups,
          }),
          blocked
        ),
        capture.capture
      );
      expect(code, JSON.stringify(exhaustedGroups)).toBe(64);
      expect(capture.stdout, JSON.stringify(exhaustedGroups)).toEqual([]);
      expect(capture.stderr.join(""), JSON.stringify(exhaustedGroups)).toContain(
        "event history skips"
      );
    }
  });

  it("stops a started writer for inspection", async () => {
    const capture = io();
    await main(
      args(statePath({
        events: [{ attemptIndex: 0, status: "usage-exhausted", processStarted: true }],
        exhaustedGroups: ["grok"],
        access: "isolated-write",
      })),
      capture.capture
    );
    expect(JSON.parse(capture.stdout.join("")).decision).toMatchObject({
      kind: "inspect",
      reason: "started-writer",
    });
  });

  it("refuses to autoauthorize a chain attempt with unknown funding", async () => {
    const capture = io();
    const code = await main(
      args(
        statePath({ events: [{ attemptIndex: 0, status: "usage-exhausted", processStarted: false }] }),
        sheetPath(SHEET.replace(
          '"provider":"devin","funding":"included"',
          '"provider":"devin","funding":"unknown"'
        ))
      ),
      capture.capture
    );
    expect(code).toBe(0);
    expect(JSON.parse(capture.stdout.join("")).decision).toMatchObject({
      kind: "stop",
      reason: "unauthorized",
    });
  });

  it("reports unconfigured for a missing sheet or role", async () => {
    const missing = io();
    expect(
      await main(
        args(statePath({ events: [] }), join(scratch, "absent.sheet")),
        missing.capture
      )
    ).toBe(0);
    expect(JSON.parse(missing.stdout.join("")).status).toBe("unconfigured");

    const role = io();
    await main(
      ["next", "--sheet", sheetPath("swarm workers: inherit-parent\n"), "--role", "nonexistent", "--parent", "codex", "--state", statePath({ events: [] })],
      role.capture
    );
    expect(JSON.parse(role.stdout.join("")).status).toBe("unconfigured");
  });

  it("rejects malformed state instead of deciding on it", async () => {
    for (const [index, state] of [
      "not json",
      JSON.stringify({ events: "nope" }),
      JSON.stringify({ events: [{ attemptIndex: -1, status: "failed" }] }),
      JSON.stringify({ events: [{ attemptIndex: 0, status: "exploded" }] }),
      JSON.stringify({ events: [], access: "full-send" }),
      JSON.stringify({ events: [], mystery: 1 }),
    ].entries()) {
      const capture = io();
      const code = await main(args(statePath(state)), capture.capture);
      expect(code, state).toBe(64);
      expect(capture.stderr.join(""), String(index)).toContain("error:");
    }
  });
});

describe("model-policy broad-policy next command", () => {
  const BROAD_SHEET = SHEET.replace(
    "swarm workers:",
    '# fallback: {"on":["usage-exhausted","route-unavailable","terminal-failure","deadline-exceeded"]}\nswarm workers:'
  );

  function sheetPath(text: string = SHEET): string {
    const path = join(scratch, "models.sheet");
    writeFileSync(path, text);
    return path;
  }
  function statePath(state: unknown): string {
    const path = join(scratch, "state.json");
    writeFileSync(path, typeof state === "string" ? state : JSON.stringify({ access: "read-only", ...(state as object) }));
    return path;
  }
  function args(state: string, sheet: string = sheetPath(BROAD_SHEET)): string[] {
    return ["next", "--sheet", sheet, "--role", "swarm workers", "--parent", "codex", "--state", state];
  }

  it("advances on saved broad outcomes and stays quota-only without a declaration", () => {
    for (const status of ["route-unavailable", "terminal-failure", "deadline-exceeded"]) {
      const capture = io();
      expect(
        main(args(statePath({ events: [{ attemptIndex: 0, status, processStarted: true }] })), capture.capture),
        status
      ).toBe(0);
      expect(JSON.parse(capture.stdout.join("")).decision, status).toMatchObject({ kind: "launch", attemptIndex: 1 });
    }
    const legacy = io();
    expect(
      main(args(statePath({ events: [{ attemptIndex: 0, status: "terminal-failure", processStarted: true }] }), sheetPath(SHEET)), legacy.capture)
    ).toBe(0);
    expect(JSON.parse(legacy.stdout.join("")).decision).toMatchObject({ kind: "stop", reason: "not-eligible" });
  });

  it("keeps cancelled-style failures terminal: failed always stops", () => {
    const capture = io();
    expect(
      main(args(statePath({ events: [{ attemptIndex: 0, status: "failed", processStarted: true }] })), capture.capture)
    ).toBe(0);
    expect(JSON.parse(capture.stdout.join("")).decision).toMatchObject({ kind: "stop", reason: "not-eligible" });
  });

  it("inspects a started writer, advances on clear, and stops on unsafe", () => {
    const failed = { attemptIndex: 0, status: "terminal-failure", processStarted: true };
    const pending = io();
    main(args(statePath({ events: [failed], access: "isolated-write" })), pending.capture);
    expect(JSON.parse(pending.stdout.join("")).decision).toMatchObject({ kind: "inspect", reason: "started-writer" });

    const clear = io();
    main(args(statePath({
      events: [{ ...failed, inspection: { state: "clear", evidenceRef: "diff-review#1" } }],
      access: "isolated-write",
    })), clear.capture);
    expect(JSON.parse(clear.stdout.join("")).decision).toMatchObject({ kind: "launch", attemptIndex: 1 });

    const unsafe = io();
    main(args(statePath({
      events: [{ ...failed, inspection: { state: "unsafe", evidenceRef: "diff-review#1" } }],
      access: "isolated-write",
    })), unsafe.capture);
    expect(JSON.parse(unsafe.stdout.join("")).decision).toMatchObject({ kind: "stop", reason: "unsafe-writer" });
  });

  it("stops on an unsafe verdict regardless of access mode or recorded start", () => {
    for (const access of ["read-only", "isolated-write"] as const) {
      for (const processStarted of [true, false, undefined] as const) {
        const event: Record<string, unknown> = {
          attemptIndex: 0,
          status: "route-unavailable",
          inspection: { state: "unsafe", evidenceRef: "diff-review#1" },
        };
        if (processStarted !== undefined) event.processStarted = processStarted;
        const capture = io();
        expect(
          main(args(statePath({ events: [event], access })), capture.capture),
          `${access} processStarted=${String(processStarted)}`
        ).toBe(0);
        expect(
          JSON.parse(capture.stdout.join("")).decision,
          `${access} processStarted=${String(processStarted)}`
        ).toMatchObject({ kind: "stop", reason: "unsafe-writer" });
      }
    }
  });

  it("rejects recorded history that continued past an unsafe verdict", () => {
    for (const access of ["read-only", "isolated-write"] as const) {
      for (const processStarted of [true, false, undefined] as const) {
        const event: Record<string, unknown> = {
          attemptIndex: 0,
          status: "route-unavailable",
          inspection: { state: "unsafe", evidenceRef: "diff-review#1" },
        };
        if (processStarted !== undefined) event.processStarted = processStarted;
        const capture = io();
        expect(
          main(
            args(statePath({
              events: [event, { attemptIndex: 1, status: "usage-exhausted", processStarted: false }],
              access,
            })),
            capture.capture
          ),
          `${access} processStarted=${String(processStarted)}`
        ).toBe(64);
        expect(capture.stdout).toEqual([]);
        expect(capture.stderr.join("")).toContain("could not advance");
      }
    }
  });

  it("rejects state that bypasses a required writer inspection", () => {
    const events = [
      { attemptIndex: 0, status: "terminal-failure", processStarted: true },
      { attemptIndex: 1, status: "usage-exhausted", processStarted: false },
    ];
    const capture = io();
    expect(main(args(statePath({ events, access: "isolated-write" })), capture.capture)).toBe(64);
    expect(capture.stderr.join("")).toContain("could not advance");
  });

  it("rejects malformed inspection records instead of bypassing them", () => {
    for (const inspection of [
      { state: "clear" },
      { state: "clear", evidenceRef: "  " },
      { state: "maybe", evidenceRef: "x" },
      { state: "clear", evidenceRef: "x", extra: 1 },
      "clear",
    ]) {
      const capture = io();
      expect(
        main(args(statePath({
          events: [{ attemptIndex: 0, status: "terminal-failure", processStarted: true, inspection }],
          access: "isolated-write",
        })), capture.capture),
        JSON.stringify(inspection)
      ).toBe(64);
    }
  });

  it("rejects a sheet with two fallback declarations", () => {
    const capture = io();
    expect(
      main(args(statePath({ events: [] }), sheetPath(`${BROAD_SHEET.trimEnd()}\n# fallback: {"on":["usage-exhausted"]}\n`)), capture.capture)
    ).toBe(65);
  });
});

describe("model-policy normalize command", () => {
  const BROAD_SHEET = SHEET.replace(
    "swarm workers:",
    '# fallback: {"on":["usage-exhausted","route-unavailable","terminal-failure","deadline-exceeded"]}\nswarm workers:'
  );

  function receipt(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schemaVersion: 1,
      status: "child-failed",
      parent: "codex",
      provider: "grok",
      model: "grok-4.7",
      effort: "xhigh",
      mode: "read-only",
      cwd: "/tmp/work",
      promptPath: "/tmp/prompt.md",
      outputPath: "/tmp/out",
      startedAt: "2026-09-24T00:00:00Z",
      completedAt: "2026-09-24T00:00:01Z",
      elapsedMs: 1_000,
      executable: "/usr/bin/grok",
      preflight: { argv: ["grok", "models"], status: "passed", evidence: "authenticated" },
      argv: ["grok", "-p"],
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
      apiSpend: "deny",
      timeoutMs: null,
      terminalSuccess: false,
      ...overrides,
    };
  }

  function normalizeArgs(receiptValue: unknown, extra: readonly string[] = []): string[] {
    const sheet = join(scratch, "models.sheet");
    writeFileSync(sheet, BROAD_SHEET);
    const receiptPath = join(scratch, "receipt.json");
    if (receiptValue !== undefined) {
      writeFileSync(receiptPath, typeof receiptValue === "string" ? receiptValue : JSON.stringify(receiptValue));
    }
    return [
      "normalize", "--sheet", sheet, "--role", "swarm workers", "--parent", "codex",
      "--lane", "0", "--attempt", "0", "--receipt", receiptPath, "--mode", "read-only",
      ...extra,
    ];
  }

  it("normalizes a terminal receipt into an event with its receipt path", () => {
    const capture = io();
    expect(main(normalizeArgs(receipt()), capture.capture)).toBe(0);
    const out = JSON.parse(capture.stdout.join(""));
    expect(out).toMatchObject({
      status: "event",
      attempt: "grok:grok-4.7@xhigh",
      event: {
        attemptIndex: 0,
        status: "terminal-failure",
        processStarted: true,
        receiptPath: join(scratch, "receipt.json"),
      },
    });
  });

  it("normalizes each broad outcome including the explicit-deadline gate", () => {
    for (const [overrides, expected] of [
      [{ status: "usage-exhausted", error: { message: "quota", evidence: "captured diagnostic" } }, "usage-exhausted"],
      [{ status: "unauthenticated", exitCode: 77, processStarted: false, failurePhase: "preflight" }, "route-unavailable"],
      [{ status: "timed-out", timeoutMs: 30_000 }, "deadline-exceeded"],
      [{ status: "timed-out" }, "failed"],
      [{ status: "cancelled", exitCode: null }, "failed"],
      [{ status: "billing-policy-blocked", exitCode: null, processStarted: false, failurePhase: "preflight" }, "failed"],
      [{ status: "complete", exitCode: 0, error: null, failurePhase: null }, "complete"],
    ] as const) {
      const capture = io();
      expect(main(normalizeArgs(receipt(overrides)), capture.capture), JSON.stringify(overrides)).toBe(0);
      expect(JSON.parse(capture.stdout.join("")).event.status, JSON.stringify(overrides)).toBe(expected);
    }
  });

  it("rejects identity mismatches between receipt and authorized attempt", () => {
    for (const overrides of [
      { provider: "devin", model: "swe-2", effort: "high" },
      { model: "grok-4.8" },
      { effort: "high" },
      { parent: "claude" },
      { mode: "isolated-write" },
      { apiSpend: "approved" },
      { apiSpend: "legacy" },
    ]) {
      const capture = io();
      expect(
        main(normalizeArgs(receipt(overrides)), capture.capture),
        JSON.stringify(overrides)
      ).toBe(65);
      expect(capture.stderr.join(""), JSON.stringify(overrides)).toContain("identity mismatch");
    }
  });

  it("requires the requested access mode and a matching recorded apiSpend", () => {
    const missingMode = io();
    expect(
      main(normalizeArgs(receipt()).filter((arg) => arg !== "read-only" && arg !== "--mode"), missingMode.capture)
    ).toBe(64);
    expect(missingMode.stderr.join("")).toContain("--mode");

    const declared = io();
    expect(
      main(normalizeArgs(receipt({ mode: "isolated-write" })), declared.capture)
    ).toBe(65);
    expect(declared.stderr.join("")).toContain("identity mismatch on mode");
  });

  it("rejects contradictory and unproven receipts instead of retrying", () => {
    for (const overrides of [
      { status: "malformed-output", exitCode: null, processStarted: false, failurePhase: "invocation" },
      { status: "unavailable-cli", processStarted: true, failurePhase: "preflight" },
    ]) {
      const capture = io();
      expect(
        main(normalizeArgs(receipt(overrides)), capture.capture),
        JSON.stringify(overrides)
      ).toBe(65);
    }
    for (const overrides of [
      { status: "child-failed", exitCode: null, signal: null, terminalSuccess: false },
      { status: "child-failed", terminalSuccess: undefined },
    ]) {
      const capture = io();
      expect(
        main(normalizeArgs(receipt(overrides)), capture.capture),
        JSON.stringify(overrides)
      ).toBe(0);
      expect(
        JSON.parse(capture.stdout.join("")).event.status,
        JSON.stringify(overrides)
      ).toBe("failed");
    }
  });

  it("rejects unreadable, malformed, and non-runner evidence", () => {
    writeFileSync(join(scratch, "models.sheet"), BROAD_SHEET);
    const missing = io();
    expect(main([
      "normalize", "--sheet", join(scratch, "models.sheet"), "--role", "swarm workers",
      "--parent", "codex", "--lane", "0", "--attempt", "0", "--receipt", join(scratch, "absent.json"),
    ], missing.capture)).toBe(64);
    for (const content of ["not json", JSON.stringify({ hello: "world" })]) {
      const capture = io();
      expect(main(normalizeArgs(content), capture.capture), content).toBe(
        content === "not json" ? 64 : 65
      );
    }
  });

  it("refuses to normalize a native alias attempt from a runner receipt", () => {
    const aliasSheet = `# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}\n# access: {"provider":"grok","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}\nswarm workers: inherit-parent -> grok:grok-4.7@xhigh\n`;
    const sheet = join(scratch, "alias.sheet");
    writeFileSync(sheet, aliasSheet);
    const receiptPath = join(scratch, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt({ provider: "codex", model: "gpt-5.6-sol", effort: "high" })));
    const capture = io();
    expect(main([
      "normalize", "--sheet", sheet, "--role", "swarm workers", "--parent", "codex",
      "--lane", "0", "--attempt", "0", "--receipt", receiptPath, "--mode", "read-only",
    ], capture.capture)).toBe(64);
    expect(capture.stderr.join("")).toContain("native lane");
  });

  it("refuses to normalize an explicit native descriptor from a runner receipt", () => {
    const nativeSheet = `# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}\n# access: {"provider":"grok","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}\nswarm workers: codex:gpt-5.6-sol@max -> grok:grok-4.7@xhigh\n`;
    const sheet = join(scratch, "native.sheet");
    writeFileSync(sheet, nativeSheet);
    const receiptPath = join(scratch, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt({ provider: "codex", model: "gpt-5.6-sol", effort: "max" })));
    const capture = io();
    expect(main([
      "normalize", "--sheet", sheet, "--role", "swarm workers", "--parent", "codex",
      "--lane", "0", "--attempt", "0", "--receipt", receiptPath, "--mode", "read-only",
    ], capture.capture)).toBe(64);
    expect(capture.stderr.join("")).toContain("native lane");
  });

  it("refuses a same-parent Claude descriptor a shipped native lane covers", () => {
    const nativeSheet = `# access: {"provider":"claude","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}
# access: {"provider":"grok","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}
swarm workers: claude:opus@max -> grok:grok-4.7@xhigh
`;
    const sheet = join(scratch, "native-claude.sheet");
    writeFileSync(sheet, nativeSheet);
    const receiptPath = join(scratch, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt({ parent: "claude", provider: "claude", model: "opus", effort: "max" })));
    const capture = io();
    expect(main([
      "normalize", "--sheet", sheet, "--role", "swarm workers", "--parent", "claude",
      "--lane", "0", "--attempt", "0", "--receipt", receiptPath, "--mode", "read-only",
    ], capture.capture)).toBe(64);
    expect(capture.stderr.join("")).toContain("native lane");
  });

  it("normalizes a same-parent external Claude receipt into an event", () => {
    const externalSheet = `# access: {"provider":"claude","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}
# access: {"provider":"grok","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}
swarm workers: claude:haiku@low -> grok:grok-4.7@xhigh
`;
    const sheet = join(scratch, "external-claude.sheet");
    writeFileSync(sheet, externalSheet);
    const receiptPath = join(scratch, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt({
      parent: "claude",
      provider: "claude",
      model: "haiku",
      effort: "low",
      status: "complete",
      exitCode: 0,
      error: null,
      failurePhase: null,
      reportedModel: "claude-haiku-4-5",
      modelVerified: true,
      modelEvidence: "provider-report",
    })));
    const capture = io();
    expect(main([
      "normalize", "--sheet", sheet, "--role", "swarm workers", "--parent", "claude",
      "--lane", "0", "--attempt", "0", "--receipt", receiptPath, "--mode", "read-only",
    ], capture.capture)).toBe(0);
    const out = JSON.parse(capture.stdout.join(""));
    expect(out).toMatchObject({
      status: "event",
      attempt: "claude:haiku@low",
      event: { attemptIndex: 0, status: "complete" },
    });
  });

  it("rejects out-of-range lane and attempt indices", () => {
    const receiptPath = join(scratch, "receipt.json");
    writeFileSync(receiptPath, JSON.stringify(receipt()));
    const sheet = join(scratch, "models.sheet");
    writeFileSync(sheet, BROAD_SHEET);
    for (const [lane, attempt] of [["9", "0"], ["0", "9"], ["-1", "0"], ["0", "x"]]) {
      const capture = io();
      expect(main([
        "normalize", "--sheet", sheet, "--role", "swarm workers", "--parent", "codex",
        "--lane", lane, "--attempt", attempt, "--receipt", receiptPath, "--mode", "read-only",
      ], capture.capture), `${lane}/${attempt}`).toBe(64);
    }
  });
});

describe("model-policy validate command", () => {
  const FACT = (provider: string, funding: string = "included") =>
    `# access: {"provider":"${provider}","funding":"${funding}","capacity":"high","apiSpend":"deny","provenance":"user"}`;

  const FULL_SHEET = `# pstack model configuration

# budget: unlimited (max)
${FACT("grok")}
${FACT("codex")}
${FACT("claude")}

feature, refactoring: grok:grok-4.7@xhigh
bug-fix: codex:gpt-5.6-sol@max
perf-issue: codex:gpt-5.6-sol@max
hillclimb: codex:gpt-5.6-sol@max
judgment and prose: claude:opus@max
hardest tasks: claude:opus@max
how explorer: grok:grok-4.7@xhigh
how explainer: claude:opus@max
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
arena cross-judge pool: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
swarm workers: grok:grok-4.7@xhigh
architect runners: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
interrogate reviewers: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
`;

  function validateArgs(text: string, extra: readonly string[] = []): string[] {
    const path = join(scratch, "models.sheet");
    writeFileSync(path, text);
    return ["validate", "--sheet", path, ...extra];
  }

  it("validates a complete policy sheet for each parent", async () => {
    for (const parent of ["claude", "codex"]) {
      const capture = io();
      const code = await main(validateArgs(FULL_SHEET, ["--parent", parent]), capture.capture);
      expect(code, parent).toBe(0);
      expect(JSON.parse(capture.stdout.join(""))).toMatchObject({ status: "valid", roles: 15 });
    }
  });

  it("rejects a setup candidate that omitted all access metadata", () => {
    const capture = io();
    expect(main(validateArgs(FULL_SHEET.replace(/^# access:.*\n/gm, ""), ["--parent", "codex"]), capture.capture)).toBe(65);
    expect(capture.stderr.join("")).toContain("setup requires access facts");
  });

  it("requires --parent", async () => {
    const capture = io();
    const code = await main(validateArgs(FULL_SHEET), capture.capture);
    expect(code).toBe(64);
    expect(capture.stderr.join("")).toContain("--parent");
  });

  it("rejects a policy sheet missing an access fact for a configured route", async () => {
    const capture = io();
    const code = await main(
      validateArgs(FULL_SHEET.replace(`${FACT("grok")}\n`, ""), ["--parent", "claude"]),
      capture.capture
    );
    expect(code).toBe(65);
    expect(capture.stderr.join("")).toContain("no access fact for provider grok");
  });

  it("rejects unauthorized facts and same-parent alias duplicates", async () => {
    const unknown = io();
    const code = await main(
      validateArgs(FULL_SHEET.replace(FACT("grok"), FACT("grok", "unknown")), ["--parent", "claude"]),
      unknown.capture
    );
    expect(code).toBe(65);
    expect(unknown.stderr.join("")).toContain("not authorized");

    const dup = io();
    const dupCode = await main(
      validateArgs(
        FULL_SHEET.replace(
          "how explorer: grok:grok-4.7@xhigh",
          "how explorer: codex:gpt-5.6-sol@max -> inherit-parent"
        ),
        ["--parent", "codex"]
      ),
      dup.capture
    );
    expect(dupCode).toBe(65);
    expect(dup.stderr.join("")).toContain("codex account");
  });
});
