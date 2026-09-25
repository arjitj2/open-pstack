import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { devinConfig, devinConfigPath, devinExportDirectory, devinExportPath, devinModel, devinPromptPath } from "./devin.ts";
import { invocationCommand } from "./commands.ts";
import { childEnvironment, runLane } from "./run.ts";
import { parseArgs } from "./cli.ts";
import { normalizeReceiptEvent } from "../model-policy/receipt-event.ts";
import type { RunnerOptions } from "./types.ts";

let scratch: string;
let oldPath: string | undefined;
let options: RunnerOptions;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-devin-test-"));
  oldPath = process.env.PATH;
  process.env.PATH = `${scratch}:${oldPath}`;
  writeFileSync(join(scratch, "prompt.md"), "Inspect the assigned file.");
  options = {
    parent: "codex", provider: "devin", model: "swe-2", effort: "high",
    mode: "read-only", cwd: scratch, promptPath: join(scratch, "prompt.md"),
    outputPath: join(scratch, "result.md"), receiptPath: join(scratch, "receipt.json"),
    timeoutMs: null,
    apiSpend: null,
  };
});

afterEach(() => {
  if (oldPath === undefined) delete process.env.PATH;
  else process.env.PATH = oldPath;
  rmSync(scratch, { recursive: true, force: true });
});

function transcript(message: string, toolCalls: unknown = []): { schema_version: string; steps: Record<string, unknown>[] } {
  return {
    schema_version: "ATIF-v1.7",
    steps: [
      { source: "system", message: "PRIVATE_SYSTEM_CONTEXT" },
      { source: "agent", message, tool_calls: toolCalls, reasoning_content: "PRIVATE_REASONING" },
    ],
  };
}

function fakeDevin(response: string, exitCode = 0, auth = "Logged in (via Devin).", stderr = "", exported: unknown = transcript(response), omitExport = false) {
  const path = join(scratch, "devin");
  writeFileSync(path, `#!/usr/bin/env bun
import { statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(${JSON.stringify(auth)});
  process.exit(0);
}
const config = await Bun.file(args[args.indexOf("--config") + 1]).json();
if (config.subagents_enabled !== false) throw new Error("recursive agents enabled");
const promptPath = args[args.indexOf("--prompt-file") + 1];
await Bun.write(${JSON.stringify(join(scratch, "captured-prompt.txt"))}, await Bun.file(promptPath).text());
if (args.includes("--sandbox") && (statSync(promptPath).mode & 0o777) !== 0o600) throw new Error("prompt not private");
const exportPath = args[args.indexOf("--export") + 1];
if ((statSync(exportPath).mode & 0o777) !== 0o600) throw new Error("export file not private");
if ((statSync(dirname(exportPath)).mode & 0o777) !== 0o700) throw new Error("export directory not private");
if (${omitExport}) unlinkSync(exportPath);
else await Bun.write(exportPath, ${JSON.stringify(typeof exported === "string" ? exported : JSON.stringify(exported))});
console.log(${JSON.stringify(response)});
console.error(${JSON.stringify(stderr)});
process.exit(${exitCode});
`);
  chmodSync(path, 0o755);
}

describe("Devin external provider", () => {
  it("pins supported SWE variants and rejects unavailable effort combinations", () => {
    for (const effort of ["medium", "high", "max"] as const) {
      expect(devinModel("swe-2", effort)).toBe(`swe-2-${effort}`);
    }
    expect(devinModel("swe-1.6", "default")).toBe("swe-1-6");
    for (const effort of ["low", "xhigh", "default"] as const) {
      expect(() => devinModel("swe-2", effort)).toThrow("Devin supports");
    }
    expect(() => devinModel("swe-1.6", "high")).toThrow("Devin supports");
    expect(() => devinModel("swe", "high")).toThrow("Devin supports");
  });

  it("accepts SWE-1.6's fixed effort through the public CLI", () => {
    const parsed = parseArgs([
      "--parent", "codex", "--provider", "devin", "--model", "swe-1.6",
      "--effort", "default", "--mode", "read-only", "--cwd", scratch,
      "--prompt", options.promptPath, "--output", options.outputPath,
      "--receipt", options.receiptPath,
    ]);
    expect(parsed?.effort).toBe("default");
  });

  it("keeps metacharacters in prompt paths as argv data", () => {
    const promptPath = join(scratch, "prompt $(touch BAD).md");
    const command = invocationCommand({ ...options, promptPath });
    expect(command.args).toContain(promptPath);
    expect(command.args).toContain("swe-2-high");
    expect(command.args).not.toContain("--effort");
    expect(command.stdin).toBe("none");
  });

  it("disables child delegation and imports, and denies writes and shell in read-only mode", () => {
    const config = devinConfig(options);
    expect(config.shell.setup_complete).toBe(true);
    expect(config.subagents_enabled).toBe(false);
    expect(Object.values(config.read_config_from).every(value => value === false)).toBe(true);
    expect(config.permissions.deny).toEqual(expect.arrayContaining(["Write(**)", "exec", "mcp__*"]));
    const writer = invocationCommand({ ...options, mode: "isolated-write" });
    expect(writer.args).toContain("--sandbox");
    expect(writer.args).not.toContain("--permission-mode");
    const writerConfig = devinConfig({ ...options, mode: "isolated-write" });
    expect(writerConfig.permissions.deny).toEqual(expect.arrayContaining(["edit", "write"]));
    expect(writerConfig.permissions.deny).not.toContain("exec");
    expect(writer.args).not.toContain("dangerous");
  });

  for (const parent of ["codex", "claude"] as const) {
    for (const model of ["swe-2", "swe-1.6"]) {
      it(`returns ${model} results to ${parent} with honest model evidence`, async () => {
        fakeDevin("DEVIN_RESULT");
        const input = { ...options, parent, model, effort: model === "swe-2" ? "high" as const : "default" as const };
        const result = await runLane(input);
        expect(result.exitCode).toBe(0);
        expect(readFileSync(input.outputPath, "utf8")).toBe("DEVIN_RESULT");
        expect(result.receipt.modelEvidence).toBe("pinned-argv");
        expect(result.receipt.modelVerified).toBe(false);
        expect(result.receipt.usage).toBeNull();
        expect(result.receipt.argv).toContain(devinModel(model, input.effort));
        expect(existsSync(devinConfigPath(input))).toBe(false);
        expect(existsSync(devinExportDirectory(input))).toBe(false);
      });
    }
  }

  it("adds writer tool constraints without modifying the assigned prompt", async () => {
    const original = "Create a file.\nThen run its test.\n";
    writeFileSync(options.promptPath, original);
    fakeDevin("DONE");
    const input = { ...options, mode: "isolated-write" as const };
    const result = await runLane(input);
    expect(result.exitCode).toBe(0);
    const sent = readFileSync(join(scratch, "captured-prompt.txt"), "utf8");
    expect(sent).toContain("Use sandboxed exec for ALL file creation, modification, and testing");
    expect(sent.endsWith(original)).toBe(true);
    expect(readFileSync(options.promptPath, "utf8")).toBe(original);
    expect(result.receipt.promptPath).toBe(options.promptPath);
    expect(result.receipt.argv).toContain(devinPromptPath(input));
    expect(existsSync(devinExportDirectory(input))).toBe(false);
  });

  it("keeps unproven account-restriction wording as an ordinary child failure", async () => {
    fakeDevin("Upgrade to Pro to access this model", 1);
    const result = await runLane(options);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.failurePhase).toBe("invocation");
    expect(result.receipt.error?.evidence).toContain("Upgrade to Pro to access this model");
    expect(existsSync(options.outputPath)).toBe(false);
    expect(existsSync(devinConfigPath(options))).toBe(false);
    expect(existsSync(devinExportDirectory(options))).toBe(false);
  });

  it("fails authentication even when auth status exits zero", async () => {
    fakeDevin("SHOULD_NOT_RUN", 0, "Not logged in. Run devin auth login.");
    const result = await runLane(options);
    expect(result.receipt.status).toBe("unauthenticated");
    expect(result.receipt.preflight.status).toBe("failed");
    expect(existsSync(options.outputPath)).toBe(false);
  });

  it("does not report an empty successful process as a completed answer", async () => {
    fakeDevin(" ");
    const result = await runLane(options);
    expect(result.receipt.status).toBe("malformed-output");
    expect(existsSync(options.outputPath)).toBe(false);
  });

  const welcome = "\x1b[1mWelcome to Devin CLI!\x1b[0m\n\n ✓ Logged in as test@example.com.\n\n\x1b[?2004lYou're all set. Run \x1b[1mdevin\x1b[0m to get started.";

  it("rejects the observed onboarding-only zero-exit output", async () => {
    fakeDevin(welcome, 0, "Logged in (via Devin).", "", { schema_version: "ATIF-v1.7", steps: [] });
    const result = await runLane(options);
    expect(result.exitCode).not.toBe(0);
    expect(result.receipt.status).toBe("malformed-output");
    expect(existsSync(options.outputPath)).toBe(false);
  });

  it("keeps the answer after a recognized onboarding banner", async () => {
    fakeDevin(`${welcome}\nProgress text`, 0, "Logged in (via Devin).", "", transcript("PSTACK_READ_OK"));
    const result = await runLane(options);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(options.outputPath, "utf8")).toBe("PSTACK_READ_OK");
  });

  it("keeps response text that merely mentions the welcome message", async () => {
    const response = "Welcome to Devin CLI! is the banner shown on first run.";
    fakeDevin(response);
    const result = await runLane(options);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(options.outputPath, "utf8")).toBe(response);
  });

  it("rejects an incomplete turn when headless tool confirmation fails", async () => {
    fakeDevin("I will create the file.", 0, "Logged in (via Devin).",
      "warning: rejected a tool call that requires confirmation. Running in non-interactive mode. Use --permission-mode dangerous to auto-approve all tools.");
    const result = await runLane({ ...options, mode: "isolated-write" });
    expect(result.receipt.status).toBe("malformed-output");
    expect(existsSync(options.outputPath)).toBe(false);
  });

  it("vetoes replay when a rejected tool call masks a finished final export", async () => {
    fakeDevin("I will create the file.", 0, "Logged in (via Devin).",
      "warning: rejected a tool call that requires confirmation. Running in non-interactive mode. Use --permission-mode dangerous to auto-approve all tools.");
    const input = { ...options, mode: "isolated-write" as const };
    const result = await runLane(input);
    expect(result.receipt.status).toBe("malformed-output");
    expect(result.receipt.terminalSuccess).toBe(true);
    expect(
      normalizeReceiptEvent(result.receipt, {
        parent: input.parent,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        mode: input.mode,
        apiSpend: "unset",
      }).status
    ).toBe("failed");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("keeps an unfinished export as failure evidence despite a rejected tool call", async () => {
    fakeDevin("I will create the file.", 0, "Logged in (via Devin).",
      "warning: rejected a tool call that requires confirmation. Running in non-interactive mode. Use --permission-mode dangerous to auto-approve all tools.",
      { schema_version: "ATIF-v1.7", steps: [{ source: "agent", message: "Working", tool_calls: [{ function_name: "exec" }] }] });
    const input = { ...options, mode: "isolated-write" as const };
    const result = await runLane(input);
    expect(result.receipt.status).toBe("malformed-output");
    expect(result.receipt.terminalSuccess).toBe(false);
    expect(
      normalizeReceiptEvent(result.receipt, {
        parent: input.parent,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        mode: input.mode,
        apiSpend: "unset",
      }).status
    ).toBe("terminal-failure");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  for (const [name, exported] of [
    ["progress before rejected tools", transcript("I'll attempt both writes now.", [{ function_name: "write" }])],
    ["tool-only turn", transcript("", [{ function_name: "exec" }])],
    ["malformed tool calls", transcript("Done", null)],
    ["non-agent final step", { schema_version: "ATIF-v1.7", steps: [{ source: "user", message: "Done" }] }],
    ["invalid JSON", "PRIVATE_INVALID_JSON"],
    ["unknown schema", { schema_version: "ATIF-v9", steps: [] }],
    ["malformed steps", { schema_version: "ATIF-v1.7", steps: {} }],
  ]) {
    it(`rejects ${name} without exposing private transcript content`, async () => {
      fakeDevin("Public progress", 0, "Logged in (via Devin).", "", exported);
      const result = await runLane(options);
      expect(result.receipt.status).toBe("malformed-output");
      expect(existsSync(options.outputPath)).toBe(false);
      expect(existsSync(devinExportDirectory(options))).toBe(false);
      expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE_");
    });
  }

  it("returns only the final writer message after a successful tool step", async () => {
    const exported = transcript("PSTACK_TEST_PASSED");
    exported.steps.splice(1, 0, { source: "agent", message: "Editing", tool_calls: [{ function_name: "exec" }] });
    fakeDevin("Editing\nPSTACK_TEST_PASSED", 0, "Logged in (via Devin).", "", exported);
    const result = await runLane({ ...options, mode: "isolated-write" });
    expect(result.exitCode).toBe(0);
    expect(readFileSync(options.outputPath, "utf8")).toBe("PSTACK_TEST_PASSED");
    expect(existsSync(devinExportDirectory(options))).toBe(false);
  });

  it("vetoes replay when a finished ATIF export conflicts with a nonzero exit", async () => {
    fakeDevin("PSTACK_DONE", 1, "Logged in (via Devin).", "neutral stderr");
    const result = await runLane(options);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.terminalSuccess).toBe(true);
    expect(
      normalizeReceiptEvent(result.receipt, {
        parent: options.parent,
        provider: options.provider,
        model: options.model,
        effort: options.effort,
        mode: options.mode,
        apiSpend: "unset",
      }).status
    ).toBe("failed");
    expect(existsSync(options.outputPath)).toBe(false);
  });

  it("keeps a missing or unfinished export as failure evidence on nonzero exit", async () => {
    for (const [name, exported, omitExport] of [
      ["omitted export", transcript("PSTACK_DONE"), true],
      ["unfinished export", { schema_version: "ATIF-v1.7", steps: [{ source: "agent", message: "Working", tool_calls: [{ function_name: "exec" }] }] }, false],
      ["malformed export", "not json", false],
    ] as const) {
      fakeDevin("PSTACK_DONE", 1, "Logged in (via Devin).", "neutral stderr", exported, omitExport);
      const attempt = { ...options, receiptPath: join(scratch, `receipt-${name}.json`) };
      const result = await runLane(attempt);
      expect(result.receipt.status, name).toBe("child-failed");
      expect(result.receipt.terminalSuccess, name).toBe(false);
      expect(
        normalizeReceiptEvent(result.receipt, {
          parent: attempt.parent,
          provider: attempt.provider,
          model: attempt.model,
          effort: attempt.effort,
          mode: attempt.mode,
          apiSpend: "unset",
        }).status,
        name
      ).toBe("terminal-failure");
    }
  });

  it("fails closed when the CLI omits its export", async () => {
    fakeDevin("Looks finished", 0, "Logged in (via Devin).", "", undefined, true);
    const result = await runLane(options);
    expect(result.receipt.status).toBe("malformed-output");
    expect(result.receipt.error?.message).toBe("devin did not produce a readable export");
    expect(existsSync(options.outputPath)).toBe(false);
    expect(existsSync(devinExportDirectory(options))).toBe(false);
  });

  it("cleans private artifacts when an explicit deadline expires before dispatch", async () => {
    fakeDevin("SHOULD_NOT_RUN");
    const result = await runLane({ ...options, timeoutMs: 1 }, Date.now() - 100);
    expect(result.receipt.status).toBe("timed-out");
    expect(existsSync(devinConfigPath(options))).toBe(false);
    expect(existsSync(devinExportDirectory(options))).toBe(false);
  });

  it("preserves an existing export directory on collision", async () => {
    fakeDevin("SHOULD_NOT_RUN");
    mkdirSync(devinExportDirectory(options));
    writeFileSync(devinExportPath(options), "existing");
    const result = await runLane(options);
    expect(result.receipt.status).toBe("child-failed");
    expect(readFileSync(devinExportPath(options), "utf8")).toBe("existing");
    expect(existsSync(devinConfigPath(options))).toBe(false);
  });

  it("preserves a pre-existing config path on collision", async () => {
    fakeDevin("SHOULD_NOT_RUN");
    writeFileSync(devinConfigPath(options), "existing");
    const result = await runLane(options);
    expect(result.receipt.status).toBe("child-failed");
    expect(readFileSync(devinConfigPath(options), "utf8")).toBe("existing");
  });

  it("does not allow fixed effort for existing providers", async () => {
    await expect(runLane({ ...options, provider: "claude", model: "fable", effort: "default" })).rejects.toThrow("only for Cursor, Antigravity, or Devin SWE-1.6");
  });

  it("removes both parent identity sets from Devin's environment", () => {
    const env = childEnvironment("devin", { CODEX_THREAD_ID: "c", CLAUDECODE: "1", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });
});
