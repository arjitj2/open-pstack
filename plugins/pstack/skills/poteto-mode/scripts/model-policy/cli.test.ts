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
