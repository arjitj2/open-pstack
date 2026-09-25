import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeAgent, openCodeConfig, openCodeDirectory, openCodeEnvironment, openCodePreflightPassed, parseOpenCodeTranscript, validateOpenCodeModel } from "./opencode.ts";
import { runLane } from "./run.ts";
import { classifyProcessOutcome, hasTerminalSuccess } from "./provider-failure.ts";
import { invocationCommand } from "./commands.ts";
import type { RunnerOptions } from "./types.ts";

function event(type: string, id: string, detail: object = {}, messageID = "m1") {
  return { type, sessionID: "s1", part: { id, sessionID: "s1", messageID, ...detail } };
}
const start = event("step_start", "start");
const text = event("text", "text", { text: "FINAL" });
const finish = event("step_finish", "finish", { reason: "stop", tokens: { input: 10, output: 5, total: 15, reasoning: 0, cache: { read: 2, write: 0 } }, cost: 0.01 });
function stream(...events: unknown[]): string { return events.map(value => JSON.stringify(value)).join("\n"); }
const success = stream(start, text, finish);

describe("OpenCode transcript contract", () => {
  it("extracts one final message with observed session and deduplicated usage", () => {
    expect(parseOpenCodeTranscript(stream(start, start, text, text, finish, finish))).toEqual({ kind: "complete", output: {
      text: "FINAL", sessionId: "s1", reportedModel: null, costUsd: 0.01,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, reasoningTokens: 0, cachedInputTokens: 2, cacheCreationInputTokens: 0 },
    } });
  });
  it("keeps only final message text while accumulating distinct steps", () => {
    const result = parseOpenCodeTranscript(stream(start, text, event("tool_use", "tool"), finish,
      event("step_start", "s2", {}, "m2"), event("text", "t2", { text: "DONE" }, "m2"), event("step_finish", "f2", { reason: "stop", tokens: { input: 7 }, cost: 0.02 }, "m2")));
    expect(result).toMatchObject({ kind: "complete", output: { text: "DONE", usage: { inputTokens: 17 }, costUsd: 0.03 } });
  });
  for (const [name, value] of Object.entries({
    progress: stream(start, text), toolOnly: stream(start, event("tool_use", "tool"), finish),
    stopWithTool: stream(start, text, event("tool_use", "tool"), finish),
    laterWork: stream(start, text, finish, event("step_start", "s2", {}, "m2")),
    restartedStep: stream(start, text, finish, event("step_start", "s2")),
    staleStepText: stream(start, text, event("step_finish", "length", { reason: "length" }), event("step_start", "s2"), finish),
    laterReasoning: stream(start, text, finish, event("reasoning", "r2")),
    laterText: stream(start, text, finish, event("text", "t2", { text: "still working" })),
    length: stream(start, text, event("step_finish", "f", { reason: "length" })),
    mixedSession: stream(start, { ...text, sessionID: "s2" }, finish),
    malformed: success + "\n{", empty: "", noStart: stream(text, finish),
    emptyText: stream(start, event("text", "text", { text: " " }), finish),
    wrongPartSession: stream(start, { ...text, part: { ...text.part, sessionID: "other" } }, finish),
  })) it(`rejects ${name}`, () => expect(parseOpenCodeTranscript(value).kind).toBe("incomplete"));
  it("preserves terminal errors and never classifies generic quota text as exhaustion", () => {
    const stdout = success + "\n" + JSON.stringify({ type: "error", sessionID: "s1", error: { name: "APIError", data: { statusCode: 429, message: "quota exhausted" } } });
    expect(parseOpenCodeTranscript(stdout).kind).toBe("error");
    const outcome = { stdout, stderr: "quota exhausted", exitCode: 1 };
    expect(classifyProcessOutcome("opencode", outcome).status).toBeNull();
    expect(hasTerminalSuccess("opencode", outcome)).toBe(false);
    expect(hasTerminalSuccess("opencode", { ...outcome, stdout: success })).toBe(true);
  });
});

let scratch = "";
let previousEnv: NodeJS.ProcessEnv;
function options(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return { parent: "codex", provider: "opencode", model: "openai/vendor/model", effort: "default", mode: "read-only", promptPath: join(scratch, "prompt"), cwd: scratch, outputPath: join(scratch, "output"), receiptPath: join(scratch, "receipt"), timeoutMs: null, apiSpend: "approved", ...overrides };
}
function fixture(value: object): void { writeFileSync(join(scratch, "fixture.json"), JSON.stringify(value)); }
const fake = `#!/usr/bin/env bun
import { readFileSync, writeFileSync, statSync } from "node:fs";
const fixture = JSON.parse(readFileSync("fixture.json", "utf8"));
const args = process.argv.slice(2);
const configPath = process.env.OPENCODE_CONFIG;
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (args.includes("debug")) {
  writeFileSync("preflight.json", JSON.stringify({args, config, configMode: statSync(configPath).mode & 511, home: process.env.HOME, configHome:process.env.XDG_CONFIG_HOME, opencodeHome:process.env.OPENCODE_TEST_HOME, override:process.env.OPENCODE_CONFIG_CONTENT}));
  if (fixture.preflightDelay) await Bun.sleep(fixture.preflightDelay);
  if (fixture.poison) config.agent[config.default_agent].permission.bash = "allow";
  if (fixture.mcp) config.mcp = {evil:{type:"local",command:["false"],enabled:true}};
  if (fixture.preflightSecret) { console.error("SECRET_SENTINEL"); process.exit(1); }
  console.log(JSON.stringify(config)); process.exit(0);
}
writeFileSync("invoked.json", JSON.stringify({args, prompt:await Bun.stdin.text()}));
if (fixture.delay) await Bun.sleep(fixture.delay);
console.log(fixture.stdout);
process.exit(fixture.exit ?? 0);
`;
beforeEach(() => {
  previousEnv = { ...process.env };
  scratch = mkdtempSync(join(tmpdir(), "pstack-opencode-"));
  mkdirSync(join(scratch, "bin"));
  const cli = join(scratch, "bin", "opencode");
  writeFileSync(cli, fake); chmodSync(cli, 0o755);
  process.env.PATH = `${join(scratch, "bin")}:${process.env.PATH}`;
  process.env.OPENCODE_CONFIG_CONTENT = "hostile ambient config";
  writeFileSync(join(scratch, "prompt"), "Read and report.\n");
  fixture({ stdout: success });
});
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
  Object.assign(process.env, previousEnv);
  rmSync(scratch, { recursive: true, force: true });
});

describe("OpenCode optional worker", () => {
  it("supports exact nested model IDs and rejects implicit selection or effort", () => {
    validateOpenCodeModel("provider/vendor/model-1.2", "default");
    validateOpenCodeModel("amazon-bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0", "default");
    for (const model of ["auto", "provider/auto", "model", "provider//model", "provider/model/", "provider/../model", "provider/model;echo"]) expect(() => validateOpenCodeModel(model, "default")).toThrow();
    expect(() => validateOpenCodeModel("provider/model", "high")).toThrow();
    expect(invocationCommand(options()).args).not.toContain("--variant");
  });
  it("runs a pinned CLI with private config, records honest proof and removes config", async () => {
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",modelVerified:false,modelEvidence:"pinned-argv",reportedModel:null,sessionId:"s1"});
    expect(readFileSync(opts.outputPath,"utf8").trim()).toBe("FINAL");
    const observed = JSON.parse(readFileSync(join(scratch,"preflight.json"),"utf8"));
    expect(observed.configMode).toBe(0o600);
    expect(observed.override).toBeUndefined();
    expect(observed.home).toBe(previousEnv.HOME);
    expect(observed.config.model).toBe(opts.model);
    expect(observed.config.small_model).toBe(opts.model);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
    expect(result.receipt.preflight.evidence).toContain("authentication deferred");
  });
  for (const apiSpend of ["deny",null] as const) it(`blocks ${apiSpend ?? "legacy"} billing before CLI startup`, async () => {
    const opts = options({apiSpend});
    expect((await runLane(opts)).receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,preflight:{status:"not-run"}});
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  for (const poison of [{poison:true},{mcp:true},{preflightSecret:true}]) it(`rejects unsafe effective configuration ${JSON.stringify(poison)}`, async () => {
    fixture(poison);
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt.status).not.toBe("complete");
    expect(JSON.stringify(result.receipt)).not.toContain("SECRET_SENTINEL");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("requires a Git root for edits and keeps shell/recursive tools denied", async () => {
    expect(() => openCodeConfig(options({mode:"isolated-write"}))).toThrow("Git worktree root");
    execFileSync("git",["init",scratch],{stdio:"ignore"});
    const opts = options({mode:"isolated-write"});
    const config = openCodeConfig(opts) as {agent:Record<string,{permission:Record<string,unknown>}>};
    expect(config.agent[openCodeAgent(opts)].permission).toMatchObject({"*":{"*":"deny"},edit:{"*":"allow"},external_directory:{"*":"deny"}});
    mkdirSync(join(scratch,"nested"));
    expect(() => openCodeConfig(options({mode:"isolated-write",cwd:join(scratch,"nested")}))).toThrow("Git worktree root");
    expect((await runLane(opts)).receipt.status).toBe("complete");
  });
  it("rejects overridden settings, variants, agent grants and custom providers", () => {
    const opts = options();
    const env = openCodeEnvironment(opts,process.env);
    const config = openCodeConfig(opts) as Record<string,unknown>;
    expect(openCodePreflightPassed(JSON.stringify(config),opts,env)).toBe(true);
    for (const change of [{small_model:"other/model"},{share:"auto"},{lsp:{}},{formatter:{}},{compaction:{auto:true}},{provider:{custom:{}}}]) expect(openCodePreflightPassed(JSON.stringify({...config,...change}),opts,env)).toBe(false);
    const agents = config.agent as Record<string,object>;
    for (const change of [{variant:"high"},{permission:{"*":"allow"}},{options:{reasoningEffort:"high"}}]) expect(openCodePreflightPassed(JSON.stringify({...config,agent:{[openCodeAgent(opts)]:{...agents[openCodeAgent(opts)],...change}}}),opts,env)).toBe(false);
  });
  it("cleans up on explicit timeout", async () => {
    fixture({delay:5000,stdout:success});
    const opts = options({timeoutMs:300});
    expect((await runLane(opts)).receipt.status).toBe("timed-out");
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
    expect(existsSync(opts.outputPath)).toBe(false);
  });
  it("cleans up on cancellation during preflight", async () => {
    fixture({preflightDelay:5000});
    const opts = options();
    const running = runLane(opts);
    for (let i=0;i<100 && !existsSync(join(scratch,"preflight.json"));i++) await Bun.sleep(10);
    expect(existsSync(join(scratch,"preflight.json"))).toBe(true);
    process.emit("SIGTERM");
    expect((await running).receipt).toMatchObject({status:"cancelled",processStarted:false});
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("preserves preexisting paths and receipts malformed output", async () => {
    const opts = options();
    mkdirSync(openCodeDirectory(opts));
    writeFileSync(join(openCodeDirectory(opts),"keep"),"keep");
    expect((await runLane(opts)).receipt.status).toBe("child-failed");
    expect(readFileSync(join(openCodeDirectory(opts),"keep"),"utf8")).toBe("keep");
    fixture({stdout:stream(start,text)});
    const next = options({receiptPath:join(scratch,"next-receipt"),outputPath:join(scratch,"next-output")});
    expect((await runLane(next)).receipt.status).toBe("malformed-output");
    expect(existsSync(next.outputPath)).toBe(false);
    expect(existsSync(openCodeDirectory(next))).toBe(false);
  });
});
