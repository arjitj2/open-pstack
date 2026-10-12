import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOpenCodeStream, parseOpenCodeExport, openCodeOAuthPreflightPassed, OPENCODE_CHATGPT_SUBSCRIPTION_MODEL, OPENCODE_CHATGPT_ENDPOINT, openCodeAgent, openCodeAttempt, openCodeConfig, openCodeConfigDirectory, openCodeDirectory, openCodeEnvironment, openCodeFunding, openCodePreflightPassed, parseOpenCodeTranscript, openCodeVersionError, validateOpenCodeModel } from "./opencode.ts";
import { runLane } from "./run.ts";
import { classifyProcessOutcome, hasTerminalSuccess } from "./provider-failure.ts";
import { invocationCommand } from "./commands.ts";
import type { RunnerOptions } from "./types.ts";

function event(type: string, id: string, detail: object = {}, messageID = "m1") {
  return { type, sessionID: "s1", part: { ...(type === "tool_use" ? { partID: `part-${id}` } : {}), id, sessionID: "s1", messageID, ...detail } };
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
    incompleteEarlier: stream(start,text,event("step_start","s2",{},"m2"),event("text","t2",{text:"DONE"},"m2"),event("step_finish","f2",{reason:"stop"},"m2")),
    reconciliationText: stream(start,text,finish,event("text","prt_m1_text-0",{text:"TAIL"}),finish),
    changedFinish: stream(start,text,finish,event("step_finish","finish",{reason:"length"})),
    missingToolPartID: stream(start,{type:"tool_use",sessionID:"s1",part:{id:"call",messageID:"m1",sessionID:"s1"}},finish),
    missingFinishReason: stream(start,text,event("step_finish","f2")),
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
const syntheticOpenCode = `#!/usr/bin/env bun
import { readFileSync, writeFileSync, statSync, symlinkSync } from "node:fs";
const fixture = JSON.parse(readFileSync("fixture.json", "utf8"));
const args = process.argv.slice(2);
if (args[0] === "--version") {
  writeFileSync("version.json", JSON.stringify(args));
  if (fixture.versionDelay) await Bun.sleep(fixture.versionDelay);
  console.log(fixture.version ?? "opencode v2.0.26"); process.exit(fixture.versionExit ?? 0);
}
const configDir = process.env.OPENCODE_CONFIG_DIR;
const configPath = configDir + "/opencode.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (args.includes("debug")) {
  writeFileSync("preflight.json", JSON.stringify({args, config, configMode: statSync(configPath).mode & 511, home: process.env.HOME, pwd: process.env.PWD, service: JSON.parse(readFileSync(configDir + "/service.json", "utf8")), configHome:process.env.XDG_CONFIG_HOME, opencodeHome:process.env.OPENCODE_TEST_HOME, override:process.env.OPENCODE_CONFIG_CONTENT}));
  if (fixture.preflightDelay) await Bun.sleep(fixture.preflightDelay);
  if (fixture.poison) config.agents[config.default_agent].permissions.push({action:"bash",resource:"*",effect:"allow"});
  if (fixture.mcp) config.mcp = {evil:{type:"local",command:["false"],enabled:true}};
  if (fixture.preflightSecret) { console.error("SECRET_SENTINEL"); process.exit(1); }
  if (fixture.supplemental) writeFileSync(configDir + "/opencode.jsonc", "{}");
  if (fixture.symlink) symlinkSync(configPath, configDir + "/ambient.json");
  if (fixture.servicePoison) writeFileSync(configDir + "/service.json", "{}");
  const entries = [{type:"document",path:configPath,info:config},{type:"directory",path:configDir}];
  if (fixture.extraSource) entries.push({type:"document",info:{model:{providerID:"evil",model:"evil"}}});
  console.log(JSON.stringify(entries)); process.exit(0);
}
if (args[0] === "auth") {
  writeFileSync("auth.json", JSON.stringify({args, env:process.env}));
  if (fixture.authDelay) await Bun.sleep(fixture.authDelay);
  if (fixture.authPoison) writeFileSync(configPath, "{}");
  console.log(fixture.authRaw ?? JSON.stringify(fixture.auth ?? [{id:"openai",name:"CANARY_ACCOUNT",connections:[{type:"credential",id:"CANARY_CONNECTION",label:"CANARY_LABEL",method:"oauth"}]}]));
  if (fixture.authStderr) console.error(fixture.authStderr);
  process.exit(fixture.authExit ?? 0);
}
if (args[0] === "session") {
  writeFileSync("export.json", JSON.stringify({args,env:process.env}));
  if (fixture.exportDelay) await Bun.sleep(fixture.exportDelay);
  const invocation = JSON.parse(readFileSync("invoked.json", "utf8"));
  const model = {providerID:config.model.providerID,id:config.model.model,variant:"default"};
  const now = Date.now();
  const exported = {info:{id:"s1",agent:config.default_agent,model,cost:0.01,tokens:{input:10,output:5,reasoning:0,cache:{read:2,write:0}},outcome:"succeeded",time:{created:invocation.created,updated:now,idle:now},location:{directory:process.cwd()}},messages:[{id:"u1",type:"user",time:{created:invocation.created},text:invocation.prompt,files:[]},{id:"m1",type:"assistant",agent:config.default_agent,model,time:{created:invocation.created,completed:now},finish:"stop",content:[{type:"text",text:fixture.finalText ?? "FINAL"}]},{id:"idle",type:"idle",time:{created:now},outcome:"succeeded"}]};
  console.log(fixture.exportRaw ?? JSON.stringify(fixture.exportDocument ?? exported));
  process.exit(fixture.exportExit ?? (fixture.exportMissing ? 1 : 0));
}
writeFileSync("invoked.json", JSON.stringify({args,created:Date.now(), pwd: process.env.PWD, env: process.env, prompt:await Bun.stdin.text()}));
if (fixture.delay) await Bun.sleep(fixture.delay);
console.log(fixture.stdout);
if (fixture.stderr) console.error(fixture.stderr);
process.exit(fixture.exit ?? 0);
`;
beforeEach(() => {
  previousEnv = { ...process.env };
  scratch = mkdtempSync(join(tmpdir(), "pstack-opencode-"));
  mkdirSync(join(scratch, "bin"));
  const cli = join(scratch, "bin", "opencode");
  writeFileSync(cli, syntheticOpenCode); chmodSync(cli, 0o755);
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
  it("accepts only the tested stable native V2 banner", () => {
    expect(openCodeVersionError("opencode v2.0.26\n")).toBeNull();
  });
  for (const version of ["1.4.0", "1.18.32", "2.0.26", "opencode v2.0.25", "opencode v2.0.27", "opencode v3.0.0", "", "unknown", "opencode v2.0.26-beta", "opencode v2.0.26\nnoise"]) it(`blocks unsupported version ${JSON.stringify(version)} before config or inference`, async () => {
    fixture({version, stdout:success});
    const opts = options();
    const receipt = (await runLane(opts)).receipt;
    expect(receipt).toMatchObject({status:"unavailable-cli",processStarted:false,preflight:{status:"failed"}});
    expect(receipt.preflight.argv.at(-1)).toBe("--version");
    expect(receipt.error?.message).toContain("2.0.26");
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("shares the explicit deadline with the version preflight", async () => {
    fixture({versionDelay:5000});
    const opts = options({timeoutMs:300});
    const receipt = (await runLane(opts)).receipt;
    expect(receipt).toMatchObject({status:"timed-out",processStarted:false});
    expect(receipt.preflight.argv.at(-1)).toBe("--version");
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });

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
    expect(observed.config.model).toEqual({providerID:"openai",model:"vendor/model"});
    expect(observed.config.small_model).toBeUndefined();
    expect(observed.config.update).toBe("disable");
    expect(observed.config.compaction).toEqual({auto:false});
    expect(observed.config.snapshots).toBe(false);
    expect(observed.config.warming).toBe(false);
    expect(observed.service).toEqual({disabled:true});
    expect(observed.pwd).toBe(opts.cwd);
    expect(observed.args).toEqual(["debug","config"]);
    const invoked = JSON.parse(readFileSync(join(scratch,"invoked.json"),"utf8"));
    expect(invoked.pwd).toBe(opts.cwd);
    expect(invoked.args).toEqual(["run","--standalone","--format","json","--model",opts.model,"--agent",openCodeAgent(opts),"--title","pstack-worker"]);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
    expect(result.receipt.preflight.evidence).toContain("authentication deferred");
  });
  for (const apiSpend of ["deny",null] as const) it(`blocks ${apiSpend ?? "legacy"} billing before CLI startup`, async () => {
    const opts = options({apiSpend});
    expect((await runLane(opts)).receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,preflight:{status:"not-run"}});
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(existsSync(join(scratch,"version.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  for (const poison of [{poison:true},{mcp:true},{preflightSecret:true},{supplemental:true},{symlink:true},{servicePoison:true},{extraSource:true}]) it(`rejects unsafe effective configuration ${JSON.stringify(poison)}`, async () => {
    fixture(poison);
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt.status).not.toBe("complete");
    expect(JSON.stringify(result.receipt)).not.toContain("SECRET_SENTINEL");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("requires a real Git root and denies Git metadata edits", () => {
    expect(() => openCodeConfig(options({mode:"isolated-write"}))).toThrow("Git worktree root");
    execFileSync("git",["init",scratch],{stdio:"ignore"});
    const cwd = scratch;
    const opts = options({mode:"isolated-write",cwd});
    const config = openCodeConfig(opts);
    const rules = config.agents[openCodeAgent(opts)].permissions;
    expect(rules[0]).toEqual({action:"*",resource:"*",effect:"deny"});
    expect(rules).toContainEqual({action:"edit",resource:"*",effect:"allow"});
    for (const resource of [".git", ".git/*", "*/.git", "*/.git/*",join(cwd,".git"),join(cwd,".git","*")]) {
      expect(rules).toContainEqual({action:"edit",resource,effect:"deny"});
    }
    expect(rules.at(-2)).toEqual({action:"external_directory",resource:"*",effect:"deny"});
    expect(config.plugins).toContain("opencode.tool.edit");
    expect(config.plugins).toContain("opencode.tool.write");
    expect(config.plugins).not.toContain("opencode.tool.patch");
    expect(config.plugins).not.toContain("opencode.tool.shell");
    mkdirSync(join(scratch,"nested"));
    expect(() => openCodeConfig(options({mode:"isolated-write",cwd:join(scratch,"nested")}))).toThrow("Git worktree root");
  });

  it("checks native entries structurally and rejects poisoned sources and rule order", () => {
    const opts = options();
    const attempt = openCodeAttempt(opts,process.env)!;
    mkdirSync(attempt.configDirectory,{recursive:true});
    writeFileSync(join(attempt.configDirectory,"opencode.json"),JSON.stringify(attempt.config));
    writeFileSync(join(attempt.configDirectory,"service.json"),JSON.stringify({disabled:true}));
    const entries = [{type:"document",path:join(attempt.configDirectory,"opencode.json"),info:attempt.config},{type:"directory",path:attempt.configDirectory}];
    expect(openCodePreflightPassed(JSON.stringify(entries),attempt)).toBe(true);
    expect(openCodePreflightPassed(JSON.stringify(entries.map(entry => Object.fromEntries(Object.entries(entry).reverse()))),attempt)).toBe(true);
    const nativeReordered = JSON.parse(JSON.stringify(entries));
    nativeReordered[0].info.model = {model:"vendor/model",providerID:"openai"};
    nativeReordered[0].info.agents[openCodeAgent(opts)].permissions = nativeReordered[0].info.agents[openCodeAgent(opts)].permissions.map((rule: object) => Object.fromEntries(Object.entries(rule).reverse()));
    expect(openCodePreflightPassed(JSON.stringify(nativeReordered),attempt)).toBe(true);
    const rules = attempt.config.agents[openCodeAgent(opts)].permissions;
    for (const change of [{model:{providerID:"other",model:"model"}},{share:"auto"},{lsp:{}},{formatter:{}},{compaction:{auto:true}},{warming:true},{providers:{custom:{}}},{plugins:["*"]},
      {agents:{[openCodeAgent(opts)]:{...attempt.config.agents[openCodeAgent(opts)],permissions:[...rules].reverse()}}}]) {
      expect(openCodePreflightPassed(JSON.stringify([{...entries[0],info:{...attempt.config,...change}},entries[1]]),attempt)).toBe(false);
    }
    for (const bad of [[],entries.slice(0,1),[...entries,entries[0]],entries.toReversed(),[{...entries[0],path:undefined},entries[1]],[entries[0],{...entries[1],path:scratch}]]) {
      expect(openCodePreflightPassed(JSON.stringify(bad),attempt)).toBe(false);
    }
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Object.isFrozen(attempt.config.agents)).toBe(true);
  });

  it("rejects replacement symlinks for the private native files", () => {
    const attempt = openCodeAttempt(options(),process.env)!;
    mkdirSync(attempt.configDirectory,{recursive:true});
    const document = join(scratch,"foreign.json");
    writeFileSync(document,JSON.stringify(attempt.config));
    symlinkSync(document,join(attempt.configDirectory,"opencode.json"));
    writeFileSync(join(attempt.configDirectory,"service.json"),JSON.stringify({disabled:true}));
    const entries = [{type:"document",path:join(attempt.configDirectory,"opencode.json"),info:attempt.config},{type:"directory",path:attempt.configDirectory}];
    expect(openCodePreflightPassed(JSON.stringify(entries),attempt)).toBe(false);
  });

  it("preserves native data locations only for explicitly approved ordinary authentication", () => {
    const inherited = {HOME:"/native/home",XDG_DATA_HOME:"/native/data",OPENCODE_CONFIG:"/hostile",OPENCODE_PASSWORD:"private"};
    const env = openCodeEnvironment(options(),inherited);
    expect(env.HOME).toBe(inherited.HOME);
    expect(env.XDG_DATA_HOME).toBe(inherited.XDG_DATA_HOME);
    expect(env.OPENCODE_CONFIG).toBeUndefined();
    expect(env.OPENCODE_PASSWORD).toBeUndefined();
  });

  it("classifies native pre-session errors and excludes private response bodies from receipts", async () => {
    fixture({stdout:stream({type:"error",sessionID:"",error:{type:"provider.auth",message:"Free route rejected",response:{body:"PRIVATE_RESPONSE_BODY"}}}),exit:1});
    expect(parseOpenCodeTranscript(JSON.parse(readFileSync(join(scratch,"fixture.json"),"utf8")).stdout).kind).toBe("error");
    const result = await runLane(subscription());
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.error?.evidence).toContain("provider.auth");
    expect(result.receipt.error?.evidence).toContain("Free route rejected");
    expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE_RESPONSE_BODY");
    expect(result.receipt.apiSpend).toBe("deny");
  });

  it("cleans up on explicit timeout", async () => {
    fixture({delay:5000,stdout:success});
    const opts = options({timeoutMs:300});
    expect((await runLane(opts)).receipt.status).toBe("timed-out");
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
    expect(existsSync(opts.outputPath)).toBe(false);
  });
  for (const phase of ["version", "invocation"] as const) it(`cleans up on cancellation during ${phase}`, async () => {
    fixture(phase === "version" ? {versionDelay:5000} : {delay:5000,stdout:success});
    const opts = options();
    const running = runLane(opts);
    const marker = join(scratch,phase === "version" ? "version.json" : "invoked.json");
    for (let i=0;i<500 && !existsSync(marker);i++) await Bun.sleep(10);
    expect(existsSync(marker)).toBe(true);
    process.emit("SIGTERM");
    expect((await running).receipt).toMatchObject({status:"cancelled",processStarted:phase === "invocation"});
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
    expect(existsSync(opts.outputPath)).toBe(false);
  });
  it("preserves terminal-success evidence but refuses output on a nonzero exit", async () => {
    fixture({stdout:success,exit:1});
    const opts = options();
    expect((await runLane(opts)).receipt).toMatchObject({status:"child-failed",terminalSuccess:true,processStarted:true});
    expect(existsSync(opts.outputPath)).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("cleans up on cancellation during preflight", async () => {
    fixture({preflightDelay:5000});
    const opts = options();
    const running = runLane(opts);
    for (let i=0;i<500 && !existsSync(join(scratch,"preflight.json"));i++) await Bun.sleep(10);
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
    fixture({stdout:stream(start,text),exportMissing:true});
    const next = options({receiptPath:join(scratch,"next-receipt"),outputPath:join(scratch,"next-output")});
    expect((await runLane(next)).receipt.status).toBe("malformed-output");
    expect(existsSync(next.outputPath)).toBe(false);
    expect(existsSync(openCodeDirectory(next))).toBe(false);
  });
  it("bounds a malformed invocation receipt to capture counts", async () => {
    fixture({
      stdout: [
        JSON.stringify({ type: "step_start", sessionID: "s1", part: { id: "st", sessionID: "s1", messageID: "m1" } }),
        JSON.stringify({ type: "reasoning", sessionID: "s1", part: { id: "r", sessionID: "s1", messageID: "m1", text: "CANARY_REASONING" } }),
        JSON.stringify({ type: "tool_use", sessionID: "s1", part: { id: "t", sessionID: "s1", messageID: "m1", tool: "bash", input: "CANARY_TOOL_ARGUMENTS", output: "CANARY_TOOL_RESULT" } }),
        JSON.stringify({ type: "text", sessionID: "s1", part: { id: "x", sessionID: "s1", messageID: "m1", text: "CANARY_NARRATION" } }),
        "CANARY_MALFORMED_LINE",
        JSON.stringify({ type: "error", sessionID: "s1", error: { name: "APIError", message: "provider terminal detail", data: { detail: "CANARY_TERMINAL_EXTENSION" } }, extension: "CANARY_TERMINAL_EXTENSION" }),
      ].join("\n"),
      stderr: "CANARY_STDERR noise",
      exit: 1,
    });
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("child-failed");
    const serialized = `${JSON.stringify(result.receipt)}\n${readFileSync(opts.receiptPath, "utf8")}`;
    for (const canary of ["CANARY_REASONING","CANARY_TOOL_ARGUMENTS","CANARY_TOOL_RESULT","CANARY_NARRATION","CANARY_MALFORMED_LINE","CANARY_STDERR","CANARY_TERMINAL_EXTENSION"]) {
      expect(serialized).not.toContain(canary);
    }
    expect(result.receipt.error?.evidence).not.toContain("provider terminal detail");
    expect(result.receipt.error?.evidence).toContain("stdout:");
  });
});

function exportFixture() {
  const model = { providerID: "openai", id: "gpt-6.1-sol", variant: "default" };
  return {
    info: { id: "s1", agent: "worker", model, outcome: "succeeded", location: { directory: "/fixture" }, time: { created: 10, updated: 30, idle: 31 }, cost: 0, tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 0 } } },
    messages: [
      { id: "u1", type: "user", time: { created: 11 }, text: "PROMPT", files: [] },
      { id: "m1", type: "assistant", agent: "worker", model, time: { created: 12, completed: 30 }, finish: "stop", content: [{ type: "text", text: "FINAL" }] },
      { id: "i1", type: "idle", time: { created: 31 }, outcome: "succeeded" },
    ],
  };
}
const exportExpected = { cwd: "/fixture", prompt: "PROMPT", agent: "worker", model: OPENCODE_CHATGPT_SUBSCRIPTION_MODEL, started: 9 };
function verdict(value: unknown, stdout = stream(text)) {
  const inspected = inspectOpenCodeStream(stdout);
  if (inspected.kind !== "identified") return inspected;
  return parseOpenCodeExport(typeof value === "string" ? value : JSON.stringify(value), inspected, exportExpected);
}

describe("OpenCode native completion", () => {
  it("accepts missing finishes and reconciliation-only text, delivering export text and usage once", () => {
    for (const stdout of [stream(text), stream(start, text), stream(start,text,finish,event("text","suffix",{text:"TAIL"}))]) {
      expect(verdict(exportFixture(),stdout)).toMatchObject({kind:"complete",output:{text:"FINAL",reportedModel:null,usage:{inputTokens:10,outputTokens:5},costUsd:0}});
    }
    const result = verdict(exportFixture(),success);
    if (result.kind !== "complete") throw Error("fixture was incomplete");
    expect(result.output.usage?.totalTokens).toBeUndefined();
  });
  for (const field of ["id", "agent", "model", "location", "outcome", "time", "parentID", "fork", "revert"] as const) it(`rejects mismatched session ${field}`, () => {
    const value = exportFixture();
    Object.assign(value.info,{[field]: field === "time" ? {created:1,idle:31} : "wrong"});
    expect(verdict(value).kind).toBe("incomplete");
  });
  for (const [name, mutate] of Object.entries({
    prompt: (value: ReturnType<typeof exportFixture>) => { value.messages[0]!.text = "OTHER"; },
    duplicate: (value: ReturnType<typeof exportFixture>) => { value.messages[2]!.id = "m1"; },
    absentFinal: (value: ReturnType<typeof exportFixture>) => { value.messages[1]!.id = "older"; },
    laterAssistant: (value: ReturnType<typeof exportFixture>) => { value.messages.splice(2,0,{...value.messages[1]!,id:"later"}); },
    laterUser: (value: ReturnType<typeof exportFixture>) => { value.messages.splice(2,0,{...value.messages[0]!,id:"u2"}); },
    unknownRecord: (value: ReturnType<typeof exportFixture>) => { value.messages.splice(2,0,{...value.messages[0]!,id:"unknown",type:"shell"}); },
    idleFailure: (value: ReturnType<typeof exportFixture>) => { value.messages[2]!.outcome = "failed"; },
    idleMissing: (value: ReturnType<typeof exportFixture>) => { value.messages.pop(); },
    idleEarly: (value: ReturnType<typeof exportFixture>) => { value.messages[2]!.time.created = 29; },
    completedMissing: (value: ReturnType<typeof exportFixture>) => { delete value.messages[1]!.time.completed; },
    finalError: (value: ReturnType<typeof exportFixture>) => { Object.assign(value.messages[1]!,{error:{message:"failed"}}); },
    finalRetry: (value: ReturnType<typeof exportFixture>) => { Object.assign(value.messages[1]!,{retry:{attempt:1}}); },
    finalTool: (value: ReturnType<typeof exportFixture>) => { Object.assign(value.messages[1]!,{content:[{type:"tool",id:"call",state:{status:"completed"}}]}); },
    blank: (value: ReturnType<typeof exportFixture>) => { value.messages[1]!.content![0]!.text = " "; },
    staleOrder: (value: ReturnType<typeof exportFixture>) => { value.messages[1]!.time.created = 10; },
    extraPromptAgent: (value: ReturnType<typeof exportFixture>) => { Object.assign(value.messages[0]!,{agents:["foreign"]}); },
    usage: (value: ReturnType<typeof exportFixture>) => { value.info.tokens.input = -1; },
  })) it(`rejects ${name}`, () => { const value = exportFixture(); mutate(value); expect(verdict(value).kind).toBe("incomplete"); });
  for (const reason of ["length","error","unknown","content-filter","tool-calls"]) it(`rejects final ${reason}`, () => {
    const value = exportFixture(); value.messages[1]!.finish = reason;
    expect(verdict(value).kind).toBe("incomplete");
  });
  it("rejects truncated exports and conflicting stream finishes", () => {
    expect(verdict("{").kind).toBe("incomplete");
    expect(verdict(exportFixture(),stream(start,text,event("step_finish","finish",{reason:"length"}))).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream(text,{...text,part:{...text.part,messageID:"other"}})).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream(start,text,finish,event("step_finish","finish",{reason:"length"}))).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream(start,event("step_start","other-start"),text)).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream(text,finish,event("step_finish","other-finish",{reason:"stop"}))).kind).toBe("incomplete");
    const tool = event("tool_use","call");
    expect(inspectOpenCodeStream(stream(tool,{...tool,part:{...tool.part,id:"other-call"}})).kind).toBe("incomplete");
  });
  for (const status of ["completed","error","streaming","running"]) it(`requires settled earlier tools (${status})`, () => {
    const value = exportFixture();
    const earlier = structuredClone(value.messages[1]!);
    Object.assign(earlier,{id:"earlier",finish:"tool-calls",time:{created:12,completed:20},content:[{type:"tool",id:"call",time:{created:13,completed:19},state:{status}}]});
    value.messages[1]!.time.created = 21;
    value.messages.splice(1,0,earlier);
    const stdout = stream(event("tool_use","call",{},"earlier"),event("text","t",{text:"FINAL"}));
    expect(verdict(value,stdout).kind).toBe(status === "completed" || status === "error" ? "complete" : "incomplete");
    expect(verdict(value,stream(text,event("tool_use","call",{},"earlier"))).kind).toBe("incomplete");
  });
  for (const stdout of [stream(text),stream(start,text)]) it("runs one standalone export with the frozen attempt environment", async () => {
    fixture({stdout});
    const opts = options(); const result = await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",usage:{inputTokens:10,outputTokens:5}});
    expect(readFileSync(opts.outputPath,"utf8")).toBe("FINAL");
    const exported = JSON.parse(readFileSync(join(scratch,"export.json"),"utf8"));
    const invoked = JSON.parse(readFileSync(join(scratch,"invoked.json"),"utf8"));
    expect(exported.args).toEqual(["session","export","--standalone","s1"]);
    expect(exported.env).toEqual(invoked.env);
  });
  it("preserves export completion through nonzero workload and malformed handoff without output", async () => {
    for (const badHandoff of [false,true]) {
      fixture({stdout:stream(text),exit:badHandoff ? 0 : 1,finalText:badHandoff ? "```pstack-handoff\n{}\n```" : "FINAL"});
      const opts = options({receiptPath:join(scratch,`receipt-${badHandoff}`),outputPath:join(scratch,`output-${badHandoff}`)});
      expect((await runLane(opts)).receipt).toMatchObject({status:badHandoff ? "malformed-output" : "child-failed",terminalSuccess:true});
      expect(existsSync(opts.outputPath)).toBe(false);
    }
  });
  it("does not deliver when native export fails, and preserves strict stream completion", async () => {
    fixture({stdout:success,exportExit:1}); const opts = options();
    expect((await runLane(opts)).receipt).toMatchObject({status:"malformed-output",terminalSuccess:true});
    expect(existsSync(opts.outputPath)).toBe(false);
  });
  it("shares the absolute deadline with export and cleans up", async () => {
    fixture({stdout:stream(text),exportDelay:10000}); const opts = options({timeoutMs:4000});
    expect((await runLane(opts)).receipt).toMatchObject({status:"timed-out",terminalSuccess:false});
    expect(existsSync(join(scratch,"export.json"))).toBe(true);
    expect(existsSync(opts.outputPath)).toBe(false); expect(existsSync(openCodeDirectory(opts))).toBe(false);
  },8000);
  it("settles export cancellation before cleaning up", async () => {
    fixture({stdout:stream(text),exportDelay:5000}); const opts = options(); const running = runLane(opts);
    for (let i=0;i<500 && !existsSync(join(scratch,"export.json"));i++) await Bun.sleep(10);
    expect(existsSync(join(scratch,"export.json"))).toBe(true); process.emit("SIGTERM");
    const result = await running;
    expect(result.receipt.status).toBe("cancelled"); expect(result.receipt.terminalSuccess).toBeUndefined();
    expect(existsSync(opts.outputPath)).toBe(false); expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
});

const oauth = [{id:"openai",connections:[{type:"credential",method:"oauth",id:"CANARY_CONNECTION",label:"CANARY_ACCOUNT"}]}];
function subscription(overrides: Partial<RunnerOptions> = {}) { return options({apiSpend:"deny",model:OPENCODE_CHATGPT_SUBSCRIPTION_MODEL,opencodeChatgptSubscription:true,...overrides}); }
describe("OpenCode explicit ChatGPT subscription", () => {
  it("constructs only the exact denied subscription branch", () => {
    expect(openCodeFunding(subscription())).toEqual({kind:"chatgpt-subscription",apiSpend:"deny",model:OPENCODE_CHATGPT_SUBSCRIPTION_MODEL});
    for (const change of [{provider:"codex" as const},{model:"openai/other"},{effort:"high" as const},{apiSpend:null},{apiSpend:"approved" as const}]) expect(() => openCodeFunding(subscription(change))).toThrow();
  });
  for (const auth of [[],{},[...oauth,...oauth],[{id:"other",connections:oauth[0]!.connections}],[{id:"openai",connections:[]}],[{id:"openai",connections:[...oauth[0]!.connections,...oauth[0]!.connections]}],[{id:"openai",connections:[{type:"credential",method:"api"}]}],[{id:"openai",connections:[{type:"env",method:"oauth"}]}],[{id:"openai",connections:[{type:"external",method:"oauth"}]}],[...oauth,{id:"opencode",connections:[{type:"credential",method:"api"}]}]]) it(`rejects incompatible visible auth ${JSON.stringify(auth)}`, async () => {
    expect(openCodeOAuthPreflightPassed(JSON.stringify(auth))).toBe(false);
    fixture({auth,stdout:success,authStderr:"CANARY_AUTH_STDERR"}); const opts = subscription(); const result = await runLane(opts);
    expect(result.receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,apiSpend:"deny",funding:{authentication:null}});
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false); expect(existsSync(join(scratch,"export.json"))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain("CANARY_");
  });
  for (const extra of [{authRaw:"{"},{authExit:1},{authPoison:true}]) it(`rejects failed or malformed auth preflight ${JSON.stringify(extra)}`, async () => {
    fixture({...extra,stdout:success}); const opts=subscription();
    expect((await runLane(opts)).receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false});
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
  });
  it("uses the native OAuth home/data with a positive provider and stripped credential/route environment", async () => {
    Object.assign(process.env,{XDG_DATA_HOME:"/native/data",OPENAI_API_KEY:"PRIVATE_KEY",ANTHROPIC_AUTH_TOKEN:"PRIVATE_TOKEN",OPENAI_BASE_URL:"PRIVATE_ROUTE",HTTP_PROXY:"PRIVATE_PROXY",HTTPS_PROXY:"PRIVATE_PROXY",NODE_OPTIONS:"PRIVATE_PRELOAD",AWS_PROFILE:"PRIVATE_ACCOUNT"});
    const opts = subscription(); const attempt=openCodeAttempt(opts,process.env)!;
    expect(attempt.config.plugins).toContain("opencode.provider.openai"); expect(attempt.config.plugins).toContain("opencode.config.provider");
    expect(attempt.config.plugins).not.toContain("opencode.provider.*"); expect(attempt.config.plugins).not.toContain("opencode.provider.chatgpt");
    expect(attempt.config.providers).toEqual({openai:{settings:{baseURL:OPENCODE_CHATGPT_ENDPOINT,transport:"http"}}});
    expect(attempt.environment.HOME).toBe(previousEnv.HOME); expect(attempt.environment.XDG_DATA_HOME).toBe("/native/data");
    for(const key of ["OPENAI_API_KEY","ANTHROPIC_AUTH_TOKEN","OPENAI_BASE_URL","HTTP_PROXY","HTTPS_PROXY","NODE_OPTIONS","AWS_PROFILE"]) expect(attempt.environment[key]).toBeUndefined();
    fixture({stdout:stream(text)}); const result=await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",apiSpend:"deny",funding:{kind:"chatgpt-subscription",authentication:"native-openai-oauth",configuredEndpoint:OPENCODE_CHATGPT_ENDPOINT},preflight:{evidence:"private configuration verified; exactly one visible native OpenAI OAuth connection"}});
    const auth=JSON.parse(readFileSync(join(scratch,"auth.json"),"utf8")); const invoked=JSON.parse(readFileSync(join(scratch,"invoked.json"),"utf8")); const exported=JSON.parse(readFileSync(join(scratch,"export.json"),"utf8"));
    expect(auth.args).toEqual(["auth","list","--standalone","--format","json"]); expect(auth.env).toEqual(invoked.env); expect(auth.env).toEqual(exported.env);
    expect(JSON.stringify(result.receipt)).not.toContain("CANARY_"); expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE_");
  });
  for(const cancel of [false,true]) it(`handles ${cancel ? "cancellation" : "deadline"} during auth without a workload`,async()=>{
    fixture({authDelay:10000}); const opts=subscription({timeoutMs:cancel ? null : 4000}); const running=runLane(opts);
    if(cancel){ for(let i=0;i<500 && !existsSync(join(scratch,"auth.json"));i++) await Bun.sleep(10); expect(existsSync(join(scratch,"auth.json"))).toBe(true); process.emit("SIGTERM"); }
    expect((await running).receipt.status).toBe(cancel ? "cancelled" : "timed-out"); expect(existsSync(join(scratch,"auth.json"))).toBe(true); expect(existsSync(join(scratch,"invoked.json"))).toBe(false); expect(existsSync(openCodeDirectory(opts))).toBe(false);
  },8000);
});
