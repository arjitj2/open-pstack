import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { invocationCommand } from "./commands.ts";
import { cursorConfig, cursorUserConfigPath, cursorConfigDirectory } from "./cursor.ts";
import { parseArgs } from "./cli.ts";
import { runLane, validateOptions } from "./run.ts";
import type { RunnerOptions } from "./types.ts";

let scratch = "";
let originalPath: string | undefined;
let originalConfig: string | undefined;
let originalApiKey: string | undefined;
const fake = `#!/usr/bin/env bun
import { readFileSync, writeFileSync, statSync } from "node:fs";
const cwd = process.cwd();
const fixture = JSON.parse(readFileSync(cwd + "/fixture.json", "utf8"));
const directory = process.env.CURSOR_CONFIG_DIR;
const config = JSON.parse(readFileSync(directory + "/cli-config.json", "utf8"));
const args = process.argv.slice(2);
if (args[0] === "status" || args[0] === "--version") {
  writeFileSync(cwd + "/observed.json", JSON.stringify({
    args, config, directory, directoryMode: statSync(directory).mode & 511,
    configMode: statSync(directory + "/cli-config.json").mode & 511,
    codex: process.env.CODEX_THREAD_ID, claude: process.env.CLAUDECODE,
  }));
  if (args[0] === "--version") { console.log("2026.09.10-fixture"); process.exit(fixture.versionExit ?? 0); }
  console.log(JSON.stringify(fixture.auth ?? {isAuthenticated:true}));
  process.exit(fixture.authExit ?? 0);
}
const prompt = await Bun.stdin.text();
writeFileSync(cwd + "/invoked.json", JSON.stringify({args,prompt,cwd,hasApiKey:!!process.env.CURSOR_API_KEY}));
if (fixture.delay) await Bun.sleep(fixture.delay);
if (fixture.exit) { console.error(fixture.error); process.exit(fixture.exit); }
console.log(fixture.raw ?? JSON.stringify(fixture.result ?? {
  type:"result", subtype:"success", is_error:false, result:"CURSOR_OK", session_id:"cursor-session"
}));
`;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack cursor "));
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  const executable = join(bin, "cursor-agent");
  writeFileSync(executable, fake);
  chmodSync(executable, 0o755);
  originalPath = process.env.PATH;
  originalConfig = process.env.CURSOR_CONFIG_DIR;
  originalApiKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  process.env.PATH = `${bin}:${originalPath}`;
  process.env.CURSOR_CONFIG_DIR = join(scratch, "user-config");
  mkdirSync(process.env.CURSOR_CONFIG_DIR);
  writeFileSync(join(process.env.CURSOR_CONFIG_DIR, "cli-config.json"), "{}");
  writeFileSync(join(scratch, "prompt.md"), "Read file named 'a b'; reply with CURSOR_OK.\n");
  writeFileSync(join(scratch, "fixture.json"), "{}");
});
afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  if (originalConfig === undefined) delete process.env.CURSOR_CONFIG_DIR;
  else process.env.CURSOR_CONFIG_DIR = originalConfig;
  if (originalApiKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalApiKey;
  rmSync(scratch, { recursive: true, force: true });
});
function options(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return {
    parent: "codex", provider: "cursor", model: "composer-2.5", effort: "default",
    mode: "read-only", promptPath: join(scratch, "prompt.md"), cwd: scratch,
    outputPath: join(scratch, "result.txt"), receiptPath: join(scratch, "receipt.json"), timeoutMs: null,
    apiSpend: null,
    ...overrides,
  };
}
function fixture(value: object): void {
  writeFileSync(join(scratch, "fixture.json"), JSON.stringify(value));
}
function observed(name: string): any {
  return JSON.parse(readFileSync(join(scratch, name), "utf8"));
}

describe("Cursor external lanes", () => {
  for (const parent of ["claude", "codex"] as const) {
    it(`runs from ${parent} with exact model, stdin, and private permissions`, async () => {
      const opts = options({ parent });
      const result = await runLane(opts);
      expect(result.exitCode).toBe(0);
      expect(result.receipt).toMatchObject({status:"complete",provider:"cursor",model:"composer-2.5",effort:"default",modelVerified:false,reportedModel:null,modelEvidence:"pinned-argv",sessionId:"cursor-session"});
      expect(readFileSync(opts.outputPath, "utf8")).toBe("CURSOR_OK");
      expect(observed("invoked.json")).toMatchObject({cwd:realpathSync(scratch),prompt:readFileSync(opts.promptPath, "utf8")});
      expect(observed("invoked.json").args).toEqual(["--print","--output-format","json","--trust","--model","composer-2.5","--workspace",scratch,"--sandbox","enabled","--mode","ask"]);
      const config = observed("observed.json");
      expect(config).toMatchObject({directory:cursorConfigDirectory(opts),directoryMode:0o700,configMode:0o600});
      expect(config.config.permissions.deny).toEqual(["Mcp(*:*)","WebFetch(*)","Write(**)","Shell(*)"]);
      expect(config.codex).toBeUndefined();
      expect(config.claude).toBeUndefined();
      expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
      expect(readFileSync(join(scratch,"user-config","cli-config.json"),"utf8")).toBe("{}");
    });
  }
  it("defers API-key authentication to the actual model invocation", async () => {
    process.env.CURSOR_API_KEY = "fixture-secret-key";
    fixture({auth:{isAuthenticated:false}});
    const result = await runLane(options());
    expect(result.receipt.status).toBe("complete");
    expect(observed("observed.json").args).toEqual(["--version"]);
    expect(observed("invoked.json").hasApiKey).toBe(true);
    expect(JSON.stringify(result.receipt)).toContain("authentication deferred");
    for (const value of [result.receipt, observed("observed.json"), observed("invoked.json")]) {
      expect(JSON.stringify(value)).not.toContain("fixture-secret-key");
    }
  });
  it("does not skip a failed executable preflight with an API key", async () => {
    process.env.CURSOR_API_KEY = "fixture-key";
    fixture({versionExit:1});
    expect((await runLane(options())).receipt.status).not.toBe("complete");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
  });
  it("keeps blank API keys on the strict OAuth preflight", async () => {
    process.env.CURSOR_API_KEY = "  ";
    fixture({auth:{isAuthenticated:false}});
    expect((await runLane(options())).receipt.status).toBe("unauthenticated");
    expect(observed("observed.json").args).toEqual(["status","--format","json"]);
  });
  for (const error of ["HTTP 401", "Unauthorized", "Invalid API key", "API key has expired"]) {
    it(`classifies model authentication rejection: ${error}`, async () => {
      process.env.CURSOR_API_KEY = "fixture-key";
      fixture({exit:1,error});
      const opts = options();
      expect((await runLane(opts)).receipt.status).toBe("unauthenticated");
      expect(existsSync(join(scratch,"invoked.json"))).toBe(true);
      expect(existsSync(opts.outputPath)).toBe(false);
      expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
    });
  }
  for (const useHttp1ForAgent of [true, false, "true"]) {
    it(`preserves only a boolean transport option: ${JSON.stringify(useHttp1ForAgent)}`, async () => {
      const path = join(scratch,"user-config","cli-config.json");
      const original = JSON.stringify({network:{useHttp1ForAgent,endpoint:"unsafe"},permissions:{allow:["Shell(*)"]},hooks:{run:"unsafe"},apiKey:"secret-sentinel"});
      writeFileSync(path,original);
      expect((await runLane(options())).receipt.status).toBe("complete");
      const config = observed("observed.json").config;
      expect(config.network).toEqual(typeof useHttp1ForAgent === "boolean" ? {useHttp1ForAgent} : undefined);
      expect(config.permissions.allow).toEqual([]);
      expect(config.hooks).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain("secret-sentinel");
      expect(readFileSync(path,"utf8")).toBe(original);
    });
  }
  it("resolves source configuration before creating the private override", () => {
    expect(cursorUserConfigPath({CURSOR_CONFIG_DIR:"relative config",XDG_CONFIG_HOME:"/xdg"},"/user","/workspace")).toBe("/workspace/relative config/cli-config.json");
    expect(cursorUserConfigPath({XDG_CONFIG_HOME:"/xdg"},"/user","/workspace")).toBe("/xdg/cursor/cli-config.json");
    expect(cursorUserConfigPath({},"/user","/workspace")).toBe("/user/.cursor/cli-config.json");
    expect(cursorConfig("read-only",join(scratch,"missing.json"))).not.toHaveProperty("network");
  });
  it("fails safely on malformed source config without launching or leaving private files", async () => {
    writeFileSync(join(scratch,"user-config","cli-config.json"),"not JSON");
    const opts = options();
    expect((await runLane(opts)).receipt.status).toBe("child-failed");
    expect(existsSync(join(scratch,"observed.json"))).toBe(false);
    expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
  });
  it("accepts default effort through the command-line parser", () => {
    const parsed = parseArgs(["--parent","codex","--provider","cursor","--model","composer-2.5","--effort","default","--mode","read-only","--prompt",join(scratch,"prompt.md"),"--cwd",scratch,"--output",join(scratch,"out"),"--receipt",join(scratch,"receipt")]);
    expect(parsed?.effort).toBe("default");
  });
  it("rejects unpinned selection, flag injection, and unsupported effort", () => {
    for (const model of ["auto", "Auto", "--force", "composer 2.5", ""]) expect(() => validateOptions(options({ model }))).toThrow();
    expect(() => validateOptions(options({ effort: "high" }))).toThrow("default effort");
    expect(() => validateOptions(options({ provider:"grok", model:"grok-4.7" }))).toThrow("only for Cursor or Devin SWE-1.6");
  });
  it("keeps writers sandboxed without ask mode or blanket force", async () => {
    const opts = options({mode:"isolated-write"});
    expect(invocationCommand(opts).args).not.toContain("--force");
    expect(invocationCommand(opts).args).not.toContain("ask");
    expect((await runLane(opts)).exitCode).toBe(0);
    expect(observed("observed.json").config.permissions.deny).toEqual(["Mcp(*:*)","WebFetch(*)"]);
  });
  for (const auth of [{isAuthenticated:false}, {isAuthenticated:"true"}, {status:"authenticated"}]) {
    it(`rejects unconfirmed auth ${JSON.stringify(auth)}`, async () => {
      fixture({auth});
      const opts = options();
      expect((await runLane(opts)).receipt.status).toBe("unauthenticated");
      expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
      expect(existsSync(opts.outputPath)).toBe(false);
      expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
    });
  }
  for (const raw of ["not JSON", "null", JSON.stringify({type:"result",subtype:"success",is_error:false,result:"  "})]) {
    it(`rejects malformed or unsuccessful result ${raw}`, async () => {
      fixture({raw});
      const opts = options();
      expect((await runLane(opts)).receipt.status).toBe("malformed-output");
      expect(existsSync(opts.outputPath)).toBe(false);
      expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
    });
  }
  it("receipts a structured error result as a provider failure, not malformed output", async () => {
    fixture({raw: JSON.stringify({type:"result",subtype:"error",is_error:true,result:"failed"})});
    const opts = options();
    expect((await runLane(opts)).receipt.status).toBe("child-failed");
    expect(existsSync(opts.outputPath)).toBe(false);
    expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
  });
  it("rejects a contradictory model report", async () => {
    fixture({result:{type:"result",subtype:"success",is_error:false,result:"OK",model:"composer-2.5-other"}});
    expect((await runLane(options())).receipt.status).toBe("malformed-output");
  });
  it("records actual Cursor usage without inventing cost or model proof", async () => {
    fixture({result:{type:"result",subtype:"success",is_error:false,result:"OK",session_id:"s1",usage:{inputTokens:18779,outputTokens:37,cacheReadTokens:590,cacheWriteTokens:0}}});
    expect((await runLane(options())).receipt).toMatchObject({modelVerified:false,modelEvidence:"pinned-argv",usage:{inputTokens:18779,outputTokens:37,cachedInputTokens:590,cacheCreationInputTokens:0},costUsd:null});
  });
  it("does not overwrite or remove a preexisting config directory", async () => {
    const opts = options();
    mkdirSync(cursorConfigDirectory(opts));
    writeFileSync(join(cursorConfigDirectory(opts),"keep"),"keep");
    expect((await runLane(opts)).receipt.status).toBe("child-failed");
    expect(readFileSync(join(cursorConfigDirectory(opts),"keep"),"utf8")).toBe("keep");
    expect(existsSync(opts.outputPath)).toBe(false);
  });
  it("does not create configuration when output reservation fails", async () => {
    const opts = options();
    writeFileSync(opts.outputPath,"existing");
    await expect(runLane(opts)).rejects.toThrow();
    expect(readFileSync(opts.outputPath,"utf8")).toBe("existing");
    expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
  });
  it("preserves a provider rejection and cleans up", async () => {
    fixture({exit:1,error:"Requested model is unavailable"});
    const opts = options();
    expect((await runLane(opts)).receipt.status).toBe("unavailable-model");
    expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
  });
  it("cleans up after an explicit deadline", async () => {
    fixture({delay:5000});
    const opts = options({timeoutMs:1000});
    expect((await runLane(opts)).receipt.status).toBe("timed-out");
    expect(existsSync(cursorConfigDirectory(opts))).toBe(false);
    expect(existsSync(opts.outputPath)).toBe(false);
  });
});
