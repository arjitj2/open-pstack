import { describe, expect, it } from "bun:test";
import {
  claudeRestrictedSupport,
  interpretWorkerResult,
  parseHandoffBlock,
  prepareAssignment,
  renderWorkerContractBlock,
  renderWorkerPrompt,
  strictRouteSupport,
} from "./worker-contract.ts";
import type { ToolDenial } from "../runner/types.ts";

const claudeStrictHelp =
  "Usage: claude [options]\n  --restricted            restrict tools\n" +
  "  --permission-prompts <mode>  control approval prompts\n  --safe-mode";

describe("strictRouteSupport", () => {
  it("supports only an external claude lane, gated on a host probe", () => {
    const verdict = strictRouteSupport({ parent: "codex", provider: "claude", route: "external" });
    expect(verdict.supported).toBe(true);
    expect(verdict.requiresHostProbe).toBe(true);
  });

  it("rejects native lanes because a prompt cannot restrict host tools", () => {
    for (const parent of ["claude", "codex"] as const) {
      const verdict = strictRouteSupport({ parent, provider: parent, route: "native" });
      expect(verdict.supported).toBe(false);
      expect(verdict.reason).toContain("full-access tools");
    }
  });

  it("rejects every other external provider with an explicit reason", () => {
    for (const provider of ["codex", "grok", "devin", "cursor", "antigravity", "opencode"] as const) {
      const verdict = strictRouteSupport({ parent: "claude", provider, route: "external" });
      expect(verdict.supported, provider).toBe(false);
      expect(verdict.missing.length, provider).toBeGreaterThan(0);
      expect(verdict.reason.length, provider).toBeGreaterThan(0);
    }
  });
});

describe("claudeRestrictedSupport", () => {
  it("requires both --restricted and --permission-prompts in the installed help", () => {
    expect(claudeRestrictedSupport(claudeStrictHelp)).toBe(true);
    expect(claudeRestrictedSupport("Usage: claude [options]\n  --restricted")).toBe(false);
    expect(claudeRestrictedSupport("Usage: claude [options]")).toBe(false);
  });
});

describe("prepareAssignment", () => {
  it("prepares the legacy contract as honest prompt-only guidance", () => {
    const prepared = prepareAssignment({
      parent: "codex",
      provider: "grok",
      route: "external",
      access: "isolated-write",
      contract: "legacy",
    });
    expect(prepared.kind).toBe("prepared");
    if (prepared.kind !== "prepared") throw new Error("expected prepared");
    expect(prepared.enforcement).toBe("prompt-only");
    expect(prepared.capabilities).toEqual([]);
    expect(prepared.instructions).toContain("Worker contract");
  });

  it("fails strict preparation before dispatch on an unverifiable route", () => {
    const result = prepareAssignment({
      parent: "claude",
      provider: "devin",
      route: "external",
      access: "isolated-write",
      contract: "strict",
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind !== "unsupported") throw new Error("expected unsupported");
    expect(result.missing).toContain("no-shell-descendants");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("requires the host probe for a strict claude lane", () => {
    const without = prepareAssignment(
      { parent: "codex", provider: "claude", route: "external", access: "isolated-write", contract: "strict" },
      false
    );
    expect(without.kind).toBe("unsupported");
    const withProbe = prepareAssignment(
      { parent: "codex", provider: "claude", route: "external", access: "isolated-write", contract: "strict" },
      true
    );
    expect(withProbe.kind).toBe("prepared");
    if (withProbe.kind !== "prepared") throw new Error("expected prepared");
    expect(withProbe.enforcement).toBe("provider-controls");
    expect(withProbe.capabilities).toContain("git-metadata-denied");
  });
});

describe("renderWorkerContractBlock", () => {
  it("assigns Git ownership to the parent and forbids writer Git mutation", () => {
    const block = renderWorkerContractBlock({
      parent: "codex",
      provider: "grok",
      route: "external",
      access: "isolated-write",
      contract: "legacy",
    });
    expect(block).toContain("Never stage, commit, reset, rebase");
    expect(block).toContain(".git");
    expect(block).toContain("pstack-handoff");
    expect(block).toContain("commit-checkpoint");
    expect(block).toContain("run-checks");
    expect(block).toContain("untrusted request");
  });

  it("adds file-only capability guidance only under the strict contract", () => {
    const legacy = renderWorkerContractBlock({
      parent: "codex",
      provider: "claude",
      route: "external",
      access: "isolated-write",
      contract: "legacy",
    });
    const strict = renderWorkerContractBlock({
      parent: "codex",
      provider: "claude",
      route: "external",
      access: "isolated-write",
      contract: "strict",
    });
    expect(legacy).not.toContain("no shell, command, test, network");
    expect(strict).toContain("no shell, command, test, network");
  });

  it("renders the shared block ahead of the assigned task", () => {
    const prompt = renderWorkerPrompt(
      { parent: "codex", provider: "grok", route: "external", access: "isolated-write", contract: "legacy" },
      "Fix the parser."
    );
    expect(prompt).toContain("## Worker contract");
    expect(prompt.endsWith("Assigned task:\nFix the parser.")).toBe(true);
  });
});

describe("parseHandoffBlock", () => {
  const valid = JSON.stringify({
    task: "issue-57",
    checkpoint: "cp-1",
    operation: "commit-checkpoint",
    files: ["runner/types.ts", "worker-contract/cli.ts"],
    checks: ["bun test"],
    summary: "commit the prepared checkpoint",
  });

  it("returns none for an ordinary final response", () => {
    expect(parseHandoffBlock("Done: edited two files.").kind).toBe("none");
    expect(parseHandoffBlock("```json\n{\"a\":1}\n```").kind).toBe("none");
  });

  it("parses exactly one valid fenced handoff block", () => {
    const parsed = parseHandoffBlock(`All work is done.\n\n\`\`\`pstack-handoff\n${valid}\n\`\`\`\n`);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") throw new Error("expected ok");
    expect(parsed.handoff.operation).toBe("commit-checkpoint");
    expect(parsed.handoff.checkpoint).toBe("cp-1");
    expect(parsed.handoff.files).toEqual(["runner/types.ts", "worker-contract/cli.ts"]);
  });

  it("rejects a second handoff block as ambiguous", () => {
    const parsed = parseHandoffBlock(`\`\`\`pstack-handoff\n${valid}\n\`\`\`\n\`\`\`pstack-handoff\n${valid}\n\`\`\``);
    expect(parsed.kind).toBe("malformed");
  });

  it("rejects malformed, unknown, and injection payloads", () => {
    const cases = [
      "not json",
      JSON.stringify({ task: "t", checkpoint: "c", operation: "commit-checkpoint", files: [], checks: [], summary: "s", extra: true }),
      JSON.stringify({ task: "t", checkpoint: "c", operation: "rm -rf /", files: [], checks: [], summary: "s" }),
      JSON.stringify({ task: "t", checkpoint: "c", operation: "commit-checkpoint", files: ["/etc/passwd"], checks: [], summary: "s" }),
      JSON.stringify({ task: "t", checkpoint: "c", operation: "commit-checkpoint", files: ["../outside.ts"], checks: [], summary: "s" }),
      JSON.stringify({ task: "", checkpoint: "c", operation: "commit-checkpoint", files: [], checks: [], summary: "s" }),
    ];
    for (const payload of cases) {
      const parsed = parseHandoffBlock(`\`\`\`pstack-handoff\n${payload}\n\`\`\``);
      expect(parsed.kind, payload).toBe("malformed");
    }
  });
});

describe("interpretWorkerResult", () => {
  const denial: ToolDenial = {
    verified: true,
    tool: "exec",
    requestedAction: "git commit",
    evidence: "provider rejected the tool call",
  };

  it("treats verified provider-owned denial as permission-blocked", () => {
    const outcome = interpretWorkerResult({ delivered: false, finalText: null, denial });
    expect(outcome.kind).toBe("permission-blocked");
  });

  it("ignores unverified denial claims", () => {
    const outcome = interpretWorkerResult({
      delivered: true,
      finalText: "done",
      denial: { ...denial, verified: false },
    });
    expect(outcome.kind).toBe("complete");
  });

  it("fails an undelivered run without inventing a denial", () => {
    const outcome = interpretWorkerResult({ delivered: false, finalText: null, denial: null });
    expect(outcome.kind).toBe("failed");
  });

  it("returns needs-parent-operation for a valid handoff and failed for a malformed one", () => {
    const ok = interpretWorkerResult({
      delivered: true,
      finalText:
        "Work preserved.\n```pstack-handoff\n" +
        JSON.stringify({
          task: "t",
          checkpoint: "c",
          operation: "run-checks",
          files: [],
          checks: ["bun test"],
          summary: "run the checks",
        }) +
        "\n```",
      denial: null,
    });
    expect(ok.kind).toBe("needs-parent-operation");
    const malformed = interpretWorkerResult({
      delivered: true,
      finalText: "```pstack-handoff\nnope\n```",
      denial: null,
    });
    expect(malformed.kind).toBe("failed");
    if (malformed.kind !== "failed") throw new Error("expected failed");
    expect(malformed.malformedHandoff).toBe(true);
  });
});
