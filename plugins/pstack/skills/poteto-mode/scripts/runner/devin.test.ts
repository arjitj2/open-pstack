import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { devinConfig, devinConfigPath, devinModel } from "./devin.ts";
import { invocationCommand } from "./commands.ts";
import { childEnvironment, runLane } from "./run.ts";
import { parseArgs } from "./cli.ts";
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
  };
});

afterEach(() => {
  if (oldPath === undefined) delete process.env.PATH;
  else process.env.PATH = oldPath;
  rmSync(scratch, { recursive: true, force: true });
});

function fakeDevin(response: string, exitCode = 0, auth = "Logged in (via Devin).") {
  const path = join(scratch, "devin");
  writeFileSync(path, `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "auth") {
  console.log(${JSON.stringify(auth)});
  process.exit(0);
}
const config = await Bun.file(args[args.indexOf("--config") + 1]).json();
if (config.subagents_enabled !== false) throw new Error("recursive agents enabled");
console.log(${JSON.stringify(response)});
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
    expect(config.subagents_enabled).toBe(false);
    expect(Object.values(config.read_config_from).every(value => value === false)).toBe(true);
    expect(config.permissions.deny).toEqual(expect.arrayContaining(["Write(**)", "exec", "mcp__*"]));
    const writer = invocationCommand({ ...options, mode: "isolated-write" });
    expect(writer.args).toContain("--sandbox");
    expect(writer.args).toContain("accept-edits");
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
      });
    }
  }

  it("reports account restrictions without substituting another model", async () => {
    fakeDevin("Upgrade to Pro to access this model", 1);
    const result = await runLane(options);
    expect(result.receipt.status).toBe("unavailable-model");
    expect(existsSync(options.outputPath)).toBe(false);
    expect(existsSync(devinConfigPath(options))).toBe(false);
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

  it("preserves a pre-existing config path on collision", async () => {
    fakeDevin("SHOULD_NOT_RUN");
    writeFileSync(devinConfigPath(options), "existing");
    const result = await runLane(options);
    expect(result.receipt.status).toBe("child-failed");
    expect(readFileSync(devinConfigPath(options), "utf8")).toBe("existing");
  });

  it("does not allow fixed effort for existing providers", async () => {
    await expect(runLane({ ...options, provider: "claude", model: "fable", effort: "default" })).rejects.toThrow("only for Devin");
  });

  it("removes both parent identity sets from Devin's environment", () => {
    const env = childEnvironment("devin", { CODEX_THREAD_ID: "c", CLAUDECODE: "1", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });
});
