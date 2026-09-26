import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { nativeClaudeAgent, nativeLane } from "./native-route.ts";

const PLUGIN_AGENTS_DIR = join(import.meta.dir, "..", "..", "..", "..", "agents");

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-native-route-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function writeAgent(name: string, frontmatter: string, body = "Do the task.\n"): void {
  writeFileSync(join(scratch, `${name}.md`), `---\n${frontmatter}\n---\n${body}`);
}

describe("nativeLane", () => {
  it("covers every shipped Claude agent by frontmatter, not by a literal list", () => {
    for (const model of ["fable", "opus", "sonnet"]) {
      for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
        expect(nativeClaudeAgent(model, effort)).toBe(`pstack-${model}-${effort}`);
      }
    }
    expect(nativeLane("claude", { provider: "claude", model: "opus", effort: "max" }))
      .toBe("pstack-opus-max");
  });

  it("recognizes an additional shipped agent from a fixture without code changes", () => {
    writeAgent("pstack-nova-medium", "name: pstack-nova-medium\ndescription: fixture\nmodel: nova\neffort: medium\nbackground: true\ndisallowedTools: Agent, Task");
    expect(nativeClaudeAgent("nova", "medium", scratch)).toBe("pstack-nova-medium");
    expect(nativeLane("claude", { provider: "claude", model: "nova", effort: "medium" }, scratch))
      .toBe("pstack-nova-medium");
    expect(nativeLane("claude", { provider: "claude", model: "nova", effort: "high" }, scratch))
      .toBeNull();
  });

  it("routes historical Claude pins through their migrated native alias", () => {
    expect(nativeLane("claude", { provider: "claude", model: "claude-opus-4-1", effort: "max" }))
      .toBe("pstack-opus-max");
    expect(nativeLane("claude", { provider: "claude", model: "claude-haiku-4-5", effort: "high" }))
      .toBeNull();
  });

  it("reads native agents from a checkout with Windows line endings", () => {
    writeFileSync(join(scratch, "pstack-nova-low.md"),
      "---\r\nname: pstack-nova-low\r\nmodel: nova\r\neffort: low\r\nbackground: true\r\n---\r\nDo the task.\r\n");
    expect(nativeClaudeAgent("nova", "low", scratch)).toBe("pstack-nova-low");
  });

  it("returns null for Claude models no shipped agent covers", () => {
    expect(nativeClaudeAgent("haiku", "low")).toBeNull();
    expect(nativeClaudeAgent("claude-haiku-4-5", "high")).toBeNull();
    expect(nativeLane("claude", { provider: "claude", model: "haiku", effort: "low" })).toBeNull();
  });

  it("covers every Codex model on a Codex parent through spawn_agent", () => {
    expect(nativeLane("codex", { provider: "codex", model: "gpt-7-nova", effort: "high" }))
      .toBe("spawn_agent");
    expect(nativeLane("codex", { provider: "codex", model: "gpt-5.6-sol", effort: "max" }))
      .toBe("spawn_agent");
  });

  it("never claims a cross-provider native route", () => {
    expect(nativeLane("claude", { provider: "codex", model: "gpt-5.6-sol", effort: "max" })).toBeNull();
    expect(nativeLane("codex", { provider: "claude", model: "opus", effort: "max" })).toBeNull();
    expect(nativeLane("claude", { provider: "grok", model: "grok-4.7", effort: "xhigh" })).toBeNull();
  });

  it("fails clearly on malformed shipped definitions instead of rerouting", () => {
    for (const frontmatter of [
      "name: pstack-nova-medium\nmodel: nova\neffort: medium",
      "name: pstack-nova-medium\nmodel: nova\nbackground: true",
      "name: pstack-nova-medium\nmodel: nova\neffort: kindof\nbackground: true",
      "name: wrong-name\nmodel: nova\neffort: medium\nbackground: true",
      "name: pstack-nova-medium\nmodel: nova\neffort: medium\nbackground: false",
    ]) {
      const dir = mkdtempSync(join(tmpdir(), "pstack-native-bad-"));
      writeFileSync(join(dir, "pstack-nova-medium.md"), `---\n${frontmatter}\n---\nbody\n`);
      expect(() => nativeClaudeAgent("nova", "medium", dir)).toThrow("malformed");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails clearly on missing frontmatter and on duplicate native selections", () => {
    writeFileSync(join(scratch, "pstack-nova-medium.md"), "no frontmatter here\n");
    expect(() => nativeClaudeAgent("nova", "medium", scratch)).toThrow("malformed");

    writeFileSync(join(scratch, "pstack-nova-medium.md"), "---\nname: pstack-nova-medium\nmodel: nova\neffort: medium\nbackground: true\n---\n");
    writeFileSync(join(scratch, "pstack-nova-alt.md"), "---\nname: pstack-nova-alt\nmodel: nova\neffort: medium\nbackground: true\n---\n");
    expect(() => nativeClaudeAgent("nova", "medium", scratch)).toThrow("both select");
  });

  it("fails clearly when the shipped agent directory cannot be inspected", () => {
    expect(() => nativeClaudeAgent("opus", "max", join(scratch, "missing"))).toThrow(
      "cannot inspect shipped native agents"
    );
  });

  it("ignores non-agent files and non-pstack agents", () => {
    writeFileSync(join(scratch, "notes.md"), "pstack- unrelated\n");
    writeFileSync(join(scratch, "poteto-agent.md"), "---\nname: poteto-agent\n---\n");
    writeAgent("pstack-nova-low", "name: pstack-nova-low\nmodel: nova\neffort: low\nbackground: true");
    expect(nativeClaudeAgent("nova", "low", scratch)).toBe("pstack-nova-low");
  });
});
