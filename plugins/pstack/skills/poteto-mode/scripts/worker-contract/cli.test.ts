import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "./cli.ts";

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
  scratch = mkdtempSync(join(tmpdir(), "pstack-worker-contract-cli-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("worker-contract prepare", () => {
  it("prepares a legacy contract for any route as prompt-only", async () => {
    const capture = io();
    const code = await main(
      ["prepare", "--parent", "codex", "--provider", "grok", "--route", "external", "--mode", "isolated-write", "--contract", "legacy"],
      capture.capture
    );
    expect(code).toBe(0);
    const result = JSON.parse(capture.stdout.join(""));
    expect(result.kind).toBe("prepared");
    expect(result.enforcement).toBe("prompt-only");
  });

  it("reports unsupported for strict routes without inventing a boundary", async () => {
    for (const provider of ["codex", "grok", "devin", "cursor", "antigravity", "opencode"]) {
      const capture = io();
      const code = await main(
        ["prepare", "--parent", "claude", "--provider", provider, "--route", "external", "--mode", "isolated-write", "--contract", "strict"],
        capture.capture
      );
      expect(code, provider).toBe(0);
      const result = JSON.parse(capture.stdout.join(""));
      expect(result.kind, provider).toBe("unsupported");
      expect(result.missing.length, provider).toBeGreaterThan(0);
    }
  });

  it("supports strict claude external only when the host probe passed", async () => {
    const denied = io();
    expect(
      await main(
        ["prepare", "--parent", "codex", "--provider", "claude", "--route", "external", "--mode", "isolated-write", "--contract", "strict"],
        denied.capture
      )
    ).toBe(0);
    expect(JSON.parse(denied.stdout.join("")).kind).toBe("unsupported");

    const allowed = io();
    expect(
      await main(
        ["prepare", "--parent", "codex", "--provider", "claude", "--route", "external", "--mode", "isolated-write", "--contract", "strict", "--host-verified"],
        allowed.capture
      )
    ).toBe(0);
    const prepared = JSON.parse(allowed.stdout.join(""));
    expect(prepared.kind).toBe("prepared");
    expect(prepared.enforcement).toBe("provider-controls");
    expect(prepared.instructions).toContain("pstack-handoff");
  });

  it("rejects missing and invalid arguments", async () => {
    const capture = io();
    expect(await main(["prepare", "--parent", "codex"], capture.capture)).toBe(64);
    const bad = io();
    expect(
      await main(
        ["prepare", "--parent", "codex", "--provider", "grok", "--route", "sideways", "--mode", "read-only"],
        bad.capture
      )
    ).toBe(64);
  });
});

describe("worker-contract interpret", () => {
  it("classifies an ordinary response as complete", async () => {
    const path = join(scratch, "response.md");
    writeFileSync(path, "Edited the parser and ran the tests.");
    const capture = io();
    expect(await main(["interpret", "--response", path], capture.capture)).toBe(0);
    expect(JSON.parse(capture.stdout.join("")).kind).toBe("complete");
  });

  it("classifies a valid handoff as needs-parent-operation with its request", async () => {
    const path = join(scratch, "response.md");
    writeFileSync(
      path,
      "Work preserved.\n```pstack-handoff\n" +
        JSON.stringify({
          task: "issue-57",
          checkpoint: "cp-1",
          operation: "commit-checkpoint",
          files: ["a.ts"],
          checks: [],
          summary: "commit the checkpoint",
        }) +
        "\n```"
    );
    const capture = io();
    expect(await main(["interpret", "--response", path], capture.capture)).toBe(0);
    const outcome = JSON.parse(capture.stdout.join(""));
    expect(outcome.kind).toBe("needs-parent-operation");
    expect(outcome.handoff.operation).toBe("commit-checkpoint");
  });

  it("fails a malformed handoff instead of trusting it", async () => {
    const path = join(scratch, "response.md");
    writeFileSync(path, "```pstack-handoff\n{\"operation\":\"rm -rf /\"}\n```");
    const capture = io();
    expect(await main(["interpret", "--response", path], capture.capture)).toBe(0);
    const outcome = JSON.parse(capture.stdout.join(""));
    expect(outcome.kind).toBe("failed");
    expect(outcome.malformedHandoff).toBe(true);
  });
});

describe("worker-contract operation ledger", () => {
  it("records, transitions, and lists operations idempotently", async () => {
    const ledger = join(scratch, "ops.json");
    const record = io();
    expect(
      await main(
        ["op-record", "--ledger", ledger, "--id", "op-1", "--task", "issue-57", "--checkpoint", "cp-1", "--kind", "commit-checkpoint", "--state", "pending", "--expected", "{\"base\":\"abc\"}"],
        record.capture
      )
    ).toBe(0);
    expect(JSON.parse(record.stdout.join("")).kind).toBe("recorded");

    const retry = io();
    expect(
      await main(
        ["op-record", "--ledger", ledger, "--id", "op-1", "--task", "issue-57", "--checkpoint", "cp-1", "--kind", "commit-checkpoint", "--state", "pending", "--expected", "{\"base\":\"abc\"}"],
        retry.capture
      )
    ).toBe(0);
    expect(JSON.parse(retry.stdout.join("")).kind).toBe("idempotent");

    const done = io();
    expect(
      await main(
        ["op-record", "--ledger", ledger, "--id", "op-1", "--task", "issue-57", "--checkpoint", "cp-1", "--kind", "commit-checkpoint", "--state", "complete", "--expected", "{\"base\":\"abc\"}", "--result", "{\"sha\":\"beef\"}"],
        done.capture
      )
    ).toBe(0);
    expect(JSON.parse(done.stdout.join("")).kind).toBe("transitioned");

    const status = io();
    expect(await main(["op-status", "--ledger", ledger], status.capture)).toBe(0);
    const summary = JSON.parse(status.stdout.join(""));
    expect(summary.operations).toHaveLength(1);
    expect(summary.operations[0].state).toBe("complete");
    expect(summary.pending).toEqual([]);
  });

  it("rejects ambiguous duplicates and conflicting reuse", async () => {
    const ledger = join(scratch, "ops.json");
    const record = io();
    await main(
      ["op-record", "--ledger", ledger, "--id", "op-1", "--task", "t", "--checkpoint", "c", "--kind", "run-checks", "--state", "pending"],
      record.capture
    );
    const duplicate = io();
    expect(
      await main(
        ["op-record", "--ledger", ledger, "--id", "op-2", "--task", "t", "--checkpoint", "c", "--kind", "run-checks", "--state", "pending"],
        duplicate.capture
      )
    ).toBe(65);
    const conflict = io();
    expect(
      await main(
        ["op-record", "--ledger", ledger, "--id", "op-1", "--task", "t", "--checkpoint", "different", "--kind", "run-checks", "--state", "pending"],
        conflict.capture
      )
    ).toBe(65);
  });

  it("never accepts a kind outside the closed vocabulary", async () => {
    const ledger = join(scratch, "ops.json");
    const capture = io();
    expect(
      await main(
        ["op-record", "--ledger", ledger, "--id", "op-1", "--task", "t", "--checkpoint", "c", "--kind", "git push origin main", "--state", "pending"],
        capture.capture
      )
    ).toBe(64);
  });
});
