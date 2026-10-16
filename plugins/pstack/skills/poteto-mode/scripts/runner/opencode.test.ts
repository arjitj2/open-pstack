import { createOpenCodeShell } from "./opencode-shell.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOpenCodeStream, parseOpenCodeExport, openCodeOAuthPreflightPassed, openCodeV1OAuthListPassed, OPENCODE_CHATGPT_SUBSCRIPTION_MODEL, OPENCODE_CHATGPT_ENDPOINT, OPENCODE_SUPPORTED_RANGE, OPENCODE_TESTED_VERSIONS, OPENCODE_V1_MINIMUM, openCodeAgent, openCodeAttempt, openCodeV1Config, openCodeV2Config, openCodeConfigDirectory, openCodeDirectory, openCodeEnvironment, openCodeFilesUnchanged, openCodeFunding, openCodePreflightPassed, openCodeSelectVersion, parseOpenCodeProviderConfig, parseOpenCodeTranscript, validateOpenCodeModel, type OpenCodeAttempt, type OpenCodeV1Attempt, type OpenCodeV2Attempt, type OpenCodeVersion } from "./opencode.ts";
import { runLane } from "./run.ts";
import { classifyProcessOutcome, hasTerminalSuccess } from "./provider-failure.ts";
import { invocationCommand } from "./commands.ts";
import { main } from "./cli.ts";
import { createHash } from "node:crypto";
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
    toolOnFinalMessage: stream(start,{type:"tool_use",sessionID:"s1",part:{id:"call",messageID:"m1",sessionID:"s1"}},finish),
    missingFinishReason: stream(start,text,event("step_finish","f2")),
    wrongPartSession: stream(start, { ...text, part: { ...text.part, sessionID: "other" } }, finish),
  })) it(`rejects ${name}`, () => expect(parseOpenCodeTranscript(value).kind).toBe("incomplete"));
  it("admits V1 and V2 tool identities without treating conflicting identities as interchangeable", () => {
    const v1tool = { type: "tool_use", sessionID: "s1", part: { id: "call-1", sessionID: "s1", messageID: "m1", tool: "read" } };
    const v2tool = { type: "tool_use", sessionID: "s1", part: { partID: "part-9", id: "call-9", sessionID: "s1", messageID: "m1", tool: "read" } };
    expect(inspectOpenCodeStream(stream(v1tool)).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream(v2tool)).kind).toBe("identified");
    for (const tool of [v1tool, v2tool]) {
      const stdout = stream(start, tool, finish,
        event("step_start", "s2", {}, "m2"), event("text", "t2", { text: "DONE" }, "m2"), event("step_finish", "f2", { reason: "stop" }, "m2"));
      expect(parseOpenCodeTranscript(stdout).kind).toBe("complete");
    }
    expect(inspectOpenCodeStream(stream(v2tool, { ...v2tool, part: { partID: "part-9", id: "other-call", sessionID: "s1", messageID: "m1", tool: "read" } })).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream(v1tool, { ...v1tool, part: { ...v1tool.part, messageID: "other" } })).kind).toBe("incomplete");
    expect(inspectOpenCodeStream(stream({ ...v2tool, part: { ...v2tool.part, partID: "call-9", id: "v2-call" } }, { ...v1tool, part: { ...v1tool.part, id: "call-9" } })).kind).toBe("incomplete");
  });
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
const v2Version: OpenCodeVersion = { contract: "v2", major: 2, minor: 0, patch: 26, text: "2.0.26" };
const v1Version: OpenCodeVersion = { contract: "v1", major: 1, minor: 18, patch: 32, text: "1.18.32" };
function v2Attempt(opts: RunnerOptions, env: NodeJS.ProcessEnv = process.env): OpenCodeV2Attempt {
  const attempt = openCodeAttempt(opts, env, v2Version);
  if (attempt === null || attempt.contract !== "v2") throw Error("expected a V2 attempt");
  return attempt;
}
function v1Attempt(opts: RunnerOptions, env: NodeJS.ProcessEnv = process.env): OpenCodeV1Attempt {
  const attempt = openCodeAttempt(opts, env, v1Version);
  if (attempt === null || attempt.contract !== "v1") throw Error("expected a V1 attempt");
  return attempt;
}
const syntheticOpenCode = `#!/usr/bin/env bun
import { readFileSync, writeFileSync, statSync, symlinkSync } from "node:fs";
const fixture = JSON.parse(readFileSync("fixture.json", "utf8"));
const rawArgs = process.argv.slice(2);
if (rawArgs[0] === "--version") {
  writeFileSync("version.json", JSON.stringify(rawArgs));
  if (fixture.versionDelay) await Bun.sleep(fixture.versionDelay);
  console.log(fixture.version ?? "opencode v2.0.26"); process.exit(fixture.versionExit ?? 0);
}
const v1 = process.env.OPENCODE_CONFIG_DIR === undefined;
const configPath = v1 ? process.env.OPENCODE_CONFIG : process.env.OPENCODE_CONFIG_DIR + "/opencode.json";
const configDir = v1 ? undefined : process.env.OPENCODE_CONFIG_DIR;
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (v1 && !config.$schema) { config.$schema = "https://opencode.ai/config.json"; writeFileSync(configPath, JSON.stringify(config)); }
const args = rawArgs[0] === "--pure" ? rawArgs.slice(1) : rawArgs;
if (args.includes("debug")) {
  writeFileSync("preflight.json", JSON.stringify({args: rawArgs, config, configMode: statSync(configPath).mode & 511, home: process.env.HOME, pwd: process.env.PWD, service: v1 ? undefined : JSON.parse(readFileSync(configDir + "/service.json", "utf8")), configHome:process.env.XDG_CONFIG_HOME, opencodeHome:process.env.OPENCODE_TEST_HOME, override:process.env.OPENCODE_CONFIG_CONTENT, noColor:process.env.NO_COLOR}));
  if (fixture.preflightDelay) await Bun.sleep(fixture.preflightDelay);
  if (fixture.shellPoison) writeFileSync(process.env.SHELL, "#!/bin/sh\\nexit 0\\n");
  if (fixture.preflightSecret) { console.error("SECRET_SENTINEL"); process.exit(1); }
  if (v1) {
    if (fixture.poison) config.agent[config.default_agent].permission.bash = {"*":"allow"};
    if (fixture.mcp) config.mcp = {evil:{type:"local",command:["false"],enabled:true}};
    if (fixture.configPoison) writeFileSync(configPath, "{}");
    console.log(JSON.stringify(fixture.debugV2Shape ? [{type:"document",path:configPath,info:config},{type:"directory",path:"/cross"}] : config)); process.exit(0);
  }
  if (fixture.poison) config.agents[config.default_agent].permissions.push({action:"bash",resource:"*",effect:"allow"});
  if (fixture.mcp) config.mcp = {evil:{type:"local",command:["false"],enabled:true}};
  if (fixture.supplemental) writeFileSync(configDir + "/opencode.jsonc", "{}");
  if (fixture.symlink) symlinkSync(configPath, configDir + "/ambient.json");
  if (fixture.servicePoison) writeFileSync(configDir + "/service.json", "{}");
  if (fixture.debugV1Shape) { console.log(JSON.stringify(config)); process.exit(0); }
  const entries = [{type:"document",path:configPath,info:config},{type:"directory",path:configDir}];
  if (fixture.extraSource) entries.push({type:"document",info:{model:{providerID:"evil",model:"evil"}}});
  console.log(JSON.stringify(entries)); process.exit(0);
}
if (args[0] === "auth") {
  writeFileSync("auth.json", JSON.stringify({args: rawArgs, env:process.env}));
  if (fixture.authDelay) await Bun.sleep(fixture.authDelay);
  if (fixture.authPoison) writeFileSync(configPath, "{}");
  if (v1) {
    process.stdout.write(fixture.authV1 ?? fixture.authRaw ?? "\\u250c  Credentials ~/.local/share/opencode/auth.json\\n\\u2502\\n\\u25cf  OpenAI oauth\\n\\u2502\\n\\u2514  1 credentials\\n");
  } else {
    console.log(fixture.authRaw ?? JSON.stringify(fixture.auth ?? [{id:"openai",name:"CANARY_ACCOUNT",connections:[{type:"credential",id:"CANARY_CONNECTION",label:"CANARY_LABEL",method:"oauth"}]}]));
  }
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
writeFileSync("invoked.json", JSON.stringify({args: rawArgs,created:Date.now(), pwd: process.env.PWD, env: process.env, prompt:await Bun.stdin.text()}));
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
  it("selects the contract from bare or prefixed stable banners by major", () => {
    for (const [banner, contract] of [["1.18.29","v1"],["1.18.32\n","v1"],["opencode v1.18.29","v1"],["opencode v1.19.4","v1"],["1.19.0","v1"],["1.18.40","v1"],["2.0.0","v2"],["2.0.25","v2"],["opencode v2.0.26","v2"],["opencode v2.0.27","v2"],["opencode v2.1.0","v2"],["2.1.0+build.3","v2"]] as const) {
      expect(openCodeSelectVersion(banner)).toMatchObject({kind:"supported",version:{contract}});
    }
    expect(openCodeSelectVersion("2.0.27")).toMatchObject({kind:"supported",version:{contract:"v2",text:"2.0.27"}});
    for (const banner of ["1.18.28","1.4.0","0.99.99","3.0.0","opencode v3.0.0","","unknown","2.0.26-beta","opencode v1.19.0-rc.1","v2.0.26","opencode 2.0.26","opencode v2.0.26 noise","1.18.32\nnoise","2.0"]) {
      expect(openCodeSelectVersion(banner).kind, JSON.stringify(banner)).toBe("unsupported");
    }
    expect(OPENCODE_SUPPORTED_RANGE).toBe(">=1.18.29 <3.0.0 stable");
    expect(OPENCODE_V1_MINIMUM).toBe("1.18.29");
    expect(OPENCODE_TESTED_VERSIONS).toEqual(["1.18.32","2.0.0","2.0.25","2.0.26","2.0.27"]);
  });
  for (const version of ["1.18.28", "1.4.0", "0.99.99", "3.0.0", "opencode v3.0.0", "", "unknown", "opencode v2.0.26-beta", "opencode v1.18.32-rc.1", "opencode v2.0.26\nnoise"]) it(`blocks unsupported version ${JSON.stringify(version)} before config or inference`, async () => {
    fixture({version, stdout:success});
    const opts = options();
    const receipt = (await runLane(opts)).receipt;
    expect(receipt).toMatchObject({status:"unavailable-cli",processStarted:false,preflight:{status:"failed"}});
    expect(receipt.preflight.argv.at(-1)).toBe("--version");
    expect(receipt.error?.message).toContain("OpenCode");
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  for (const version of ["2.0.0", "opencode v2.0.25", "opencode v2.0.27", "opencode v2.1.0", "opencode v1.19.4", "1.18.40"]) it(`admits compatible stable ${JSON.stringify(version)} through the same capability checks`, async () => {
    fixture({version, stdout:success});
    const opts = options({receiptPath:join(scratch,`receipt-${version.replace(/[^0-9.]/g,"")}`),outputPath:join(scratch,`output-${version.replace(/[^0-9.]/g,"")}`)});
    expect((await runLane(opts)).receipt.status).toBe("complete");
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
  it.each(["1.18.32", "opencode v2.0.26"])("rejects modified shell policy before inference on %s", async version => {
    execFileSync("git", ["init", scratch], {stdio:"ignore"});
    fixture({version, shellPoison:true, stdout:success});
    const result = await runLane(options({mode:"isolated-write"}));
    expect(result.receipt.processStarted).toBe(false);
    expect(result.receipt.preflight.status).toBe("failed");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(options()))).toBe(false);
  });

  it("requires a real Git root and denies Git metadata edits", () => {
    expect(() => openCodeV2Config(options({mode:"isolated-write"}))).toThrow("Git worktree root");
    execFileSync("git",["init",scratch],{stdio:"ignore"});
    const cwd = scratch;
    const opts = options({mode:"isolated-write",cwd});
    const config = openCodeV2Config(opts);
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
    const shell = createOpenCodeShell(cwd);
    try {
      const writer = openCodeAttempt(opts, process.env, v2Version, shell)!;
      const enabled = openCodeV2Config(opts, process.env, shell);
      expect(enabled.shell).toBe(shell.executable);
      expect(enabled.plugins).toContain("opencode.tool.shell");
      expect(enabled.agents[openCodeAgent(opts)].permissions).toContainEqual({action:"shell",resource:"*",effect:"allow"});
      expect(writer.environment.SHELL).toBe(shell.executable);
      const legacy = openCodeAttempt(opts, process.env, v1Version, shell)!;
      expect(legacy.environment.SHELL).toBe(shell.executable);
      expect(JSON.stringify(legacy.config)).toContain('"bash":{"*":"allow"}');
      expect(() => openCodeAttempt(options(), process.env, v2Version, shell)).toThrow("Read-only");
    } finally { rmSync(shell.directory, {recursive:true,force:true}); }

    mkdirSync(join(scratch,"nested"));
    expect(() => openCodeV2Config(options({mode:"isolated-write",cwd:join(scratch,"nested")}))).toThrow("Git worktree root");
  });

  it("checks native entries structurally and rejects poisoned sources and rule order", () => {
    const opts = options();
    const attempt = v2Attempt(opts);
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
    const attempt = v2Attempt(options());
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
    const env = openCodeEnvironment(options(),inherited,"v2");
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

describe("OpenCode V1 worker contract", () => {
  it("runs a compatible V1 CLI with private config, strict stream completion, and cleanup", async () => {
    fixture({version:"1.18.32", stdout:success});
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",modelVerified:false,modelEvidence:"pinned-argv",reportedModel:null,sessionId:"s1"});
    expect(readFileSync(opts.outputPath,"utf8").trim()).toBe("FINAL");
    const observed = JSON.parse(readFileSync(join(scratch,"preflight.json"),"utf8"));
    expect(observed.args).toEqual(["--pure","debug","config"]);
    expect(observed.configMode).toBe(0o600);
    expect(observed.override).toBeUndefined();
    expect(observed.service).toBeUndefined();
    expect(observed.config.model).toBe(opts.model);
    expect(observed.config.small_model).toBe(opts.model);
    expect(observed.config.autoupdate).toBe(false);
    expect(observed.config.compaction).toEqual({auto:false,prune:false});
    expect(observed.config.provider).toBeUndefined();
    const invoked = JSON.parse(readFileSync(join(scratch,"invoked.json"),"utf8"));
    expect(invoked.args).toEqual(["run","--pure","--format","json","--model",opts.model,"--agent",openCodeAgent(opts),"--dir",opts.cwd,"--title","pstack-worker"]);
    expect(existsSync(join(scratch,"auth.json"))).toBe(false);
    expect(existsSync(join(scratch,"export.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
    expect(result.receipt.preflight.evidence).toContain("authentication deferred");
  });
  it("rejects a V1 stream missing its terminal step_finish without attempting export", async () => {
    fixture({version:"1.18.32", stdout:stream(start,text)});
    const opts = options();
    expect((await runLane(opts)).receipt.status).toBe("malformed-output");
    expect(existsSync(opts.outputPath)).toBe(false);
    expect(existsSync(join(scratch,"export.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("fails closed when the debug output belongs to the other contract", async () => {
    fixture({version:"1.18.32", debugV2Shape:true, stdout:success});
    expect((await runLane(options())).receipt.status).not.toBe("complete");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
  });
  it("fails closed when a V2 banner receives V1-shaped merged config", async () => {
    fixture({debugV1Shape:true, stdout:success});
    expect((await runLane(options())).receipt.status).not.toBe("complete");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
  });
  for (const poison of [{poison:true},{mcp:true},{preflightSecret:true},{configPoison:true}]) it(`rejects unsafe V1 effective configuration ${JSON.stringify(poison)}`, async () => {
    fixture({version:"1.18.32", ...poison, stdout:success});
    const result = await runLane(options());
    expect(result.receipt.status).not.toBe("complete");
    expect(JSON.stringify(result.receipt)).not.toContain("SECRET_SENTINEL");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(options()))).toBe(false);
  });
  for (const apiSpend of ["deny",null] as const) it(`blocks ${apiSpend ?? "legacy"} V1 billing before CLI startup`, async () => {
    fixture({version:"1.18.32"});
    const opts = options({apiSpend});
    expect((await runLane(opts)).receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,preflight:{status:"not-run"}});
    expect(existsSync(join(scratch,"version.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("cleans up on cancellation during the V1 configuration preflight", async () => {
    fixture({version:"1.18.32", preflightDelay:5000});
    const opts = options();
    const running = runLane(opts);
    for (let i=0;i<500 && !existsSync(join(scratch,"preflight.json"));i++) await Bun.sleep(10);
    expect(existsSync(join(scratch,"preflight.json"))).toBe(true);
    process.emit("SIGTERM");
    expect((await running).receipt).toMatchObject({status:"cancelled",processStarted:false});
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("builds the released V1 config shape with an ordered permission map", () => {
    const opts = options();
    const config = openCodeV1Config(opts) as Record<string, unknown>;
    expect(config.model).toBe(opts.model);
    expect(config.small_model).toBe(opts.model);
    expect(config.default_agent).toBe(openCodeAgent(opts));
    expect(config.share).toBe("disabled");
    expect(config.autoupdate).toBe(false);
    expect(config.compaction).toEqual({auto:false,prune:false});
    expect(config.provider).toBeUndefined();
    const agent = (config.agent as Record<string,Record<string,unknown>>)[openCodeAgent(opts)];
    expect(agent.mode).toBe("primary");
    expect(agent.model).toBe(opts.model);
    const permission = agent.permission as Record<string,Record<string,string>>;
    expect(permission["*"]).toEqual({"*":"deny"});
    expect(permission.read).toEqual({"*":"allow"});
    expect(permission.glob).toEqual({"*":"allow"});
    expect(permission.grep).toEqual({"*":"allow"});
    expect(permission.edit).toBeUndefined();
    expect(permission.external_directory["*"]).toBe("deny");
    expect(Object.keys(permission)).toEqual(["*","read","glob","grep","external_directory"]);
  });
  it("checks V1 effective configuration structurally and rejects mismatches", () => {
    const opts = options();
    const attempt = v1Attempt(opts);
    mkdirSync(openCodeDirectory(opts), { recursive: true });
    writeFileSync(attempt.configPath, JSON.stringify(attempt.config), { mode: 0o600 });
    const merged = JSON.parse(JSON.stringify(attempt.config)) as Record<string, unknown>;
    expect(openCodePreflightPassed(JSON.stringify(merged), attempt)).toBe(true);
    for (const change of [
      (value: Record<string,unknown>) => { value.model = "other/model"; },
      (value: Record<string,unknown>) => { value.default_agent = "other"; },
      (value: Record<string,unknown>) => { value.share = "auto"; },
      (value: Record<string,unknown>) => { value.compaction = { auto: true, prune: false }; },
      (value: Record<string,unknown>) => { value.provider = { custom: {} }; },
      (value: Record<string,unknown>) => { value.mcp = { evil: { enabled: true } }; },
      (_value: Record<string,unknown>, a: Record<string,unknown>) => { a.model = "other/model"; },
      (_value: Record<string,unknown>, a: Record<string,unknown>) => { (a.permission as Record<string,Record<string,string>>).bash = { "*": "allow" }; },
      (_value: Record<string,unknown>, a: Record<string,unknown>) => { a.extra = true; },
      (_value: Record<string,unknown>, a: Record<string,unknown>) => { a.options = { temperature: 0 }; },
    ]) {
      const value = JSON.parse(JSON.stringify(attempt.config)) as Record<string, unknown>;
      const a = (value.agent as Record<string,Record<string,unknown>>)[String(value.default_agent)];
      change(value, a);
      expect(openCodePreflightPassed(JSON.stringify(value), attempt)).toBe(false);
    }
    expect(openCodePreflightPassed("[]", attempt)).toBe(false);
    expect(Object.isFrozen(attempt)).toBe(true);
    expect(Object.isFrozen(attempt.config)).toBe(true);
  });
  it("rejects replacement symlinks for the private V1 config file", () => {
    const attempt = v1Attempt(options());
    const merged = JSON.stringify(attempt.config);
    mkdirSync(openCodeDirectory(options()), { recursive: true });
    writeFileSync(attempt.configPath, merged, { mode: 0o600 });
    expect(openCodeFilesUnchanged(attempt)).toBe(true);
    const foreign = join(scratch, "foreign.json");
    writeFileSync(foreign, merged);
    rmSync(attempt.configPath);
    symlinkSync(foreign, attempt.configPath);
    expect(openCodeFilesUnchanged(attempt)).toBe(false);
  });
  it("checks V1 merged output against the private file", () => {
    const attempt = v1Attempt(options());
    expect(openCodePreflightPassed(JSON.stringify(attempt.config), attempt)).toBe(false);
    mkdirSync(openCodeDirectory(options()), { recursive: true });
    writeFileSync(attempt.configPath, JSON.stringify(attempt.config), { mode: 0o600 });
    expect(openCodePreflightPassed(JSON.stringify(attempt.config), attempt)).toBe(true);
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
  it("rejects missing credential-method capability before inference without an exact-version gate", async () => {
    fixture({version:"opencode v2.0.0",auth:[{id:"openai",connections:[{type:"credential",id:"CANARY_ID",label:"CANARY_LABEL"}]}],stdout:success});
    const result = await runLane(subscription());
    expect(result.receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,funding:{authentication:null}});
    expect(result.receipt.preflight.evidence).toContain("Upgrade OpenCode if auth list does not expose credential methods");
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain("CANARY_");
  });
  for (const extra of [{authRaw:"{"},{authExit:1},{authPoison:true}]) it(`rejects failed or malformed auth preflight ${JSON.stringify(extra)}`, async () => {
    fixture({...extra,stdout:success}); const opts=subscription();
    expect((await runLane(opts)).receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false});
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
  });
  it("uses the native OAuth home/data with a positive provider and stripped credential/route environment", async () => {
    Object.assign(process.env,{XDG_DATA_HOME:"/native/data",OPENAI_API_KEY:"PRIVATE_KEY",ANTHROPIC_AUTH_TOKEN:"PRIVATE_TOKEN",OPENAI_BASE_URL:"PRIVATE_ROUTE",HTTP_PROXY:"PRIVATE_PROXY",HTTPS_PROXY:"PRIVATE_PROXY",NODE_OPTIONS:"PRIVATE_PRELOAD",AWS_PROFILE:"PRIVATE_ACCOUNT"});
    const opts = subscription(); const attempt=v2Attempt(opts);
    expect(attempt.config.plugins).toContain("opencode.provider.openai"); expect(attempt.config.plugins).toContain("opencode.config.provider");
    expect(attempt.config.plugins).not.toContain("opencode.provider.*"); expect(attempt.config.plugins).not.toContain("opencode.provider.chatgpt");
    expect(attempt.config.providers).toEqual({openai:{settings:{baseURL:OPENCODE_CHATGPT_ENDPOINT,transport:"http"}}});
    expect(attempt.environment.HOME).toBe(previousEnv.HOME); expect(attempt.environment.XDG_DATA_HOME).toBe("/native/data");
    for(const key of ["OPENAI_API_KEY","ANTHROPIC_AUTH_TOKEN","OPENAI_BASE_URL","HTTP_PROXY","HTTPS_PROXY","NODE_OPTIONS","AWS_PROFILE"]) expect(attempt.environment[key]).toBeUndefined();
    fixture({stdout:stream(text)}); const result=await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",apiSpend:"deny",funding:{kind:"chatgpt-subscription",authentication:"native-openai-oauth",configuredEndpoint:OPENCODE_CHATGPT_ENDPOINT},preflight:{evidence:"OpenCode 2.0.26 (v2): private configuration verified; exactly one visible native OpenAI OAuth credential"}});
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


const v1AuthBlock = "\u250c  Credentials ~/.local/share/opencode/auth.json\n\u2502\n\u25cf  OpenAI oauth\n\u2502\n\u2514  1 credentials\n";
describe("OpenCode V1 explicit ChatGPT subscription", () => {
  it("admits exactly one native OpenAI OAuth credential block and rejects grammar deviations", () => {
    expect(openCodeV1OAuthListPassed(v1AuthBlock, "")).toBe(true);
    expect(openCodeV1OAuthListPassed(v1AuthBlock, "\x1b[0m\n")).toBe(true);
    expect(openCodeV1OAuthListPassed("\x1b[32m" + v1AuthBlock + "\x1b[0m", "\x1b[0m\n")).toBe(true);
    expect(openCodeV1OAuthListPassed(v1AuthBlock.replace("1 credentials", "1 credential"), "")).toBe(true);
    expect(openCodeV1OAuthListPassed("", v1AuthBlock)).toBe(true);
    expect(openCodeV1OAuthListPassed(v1AuthBlock.replaceAll("\n", "\r\n"), "")).toBe(true);
    for (const [name, [out, err]] of Object.entries({
      api: ["Credentials /p\n\u2502  OpenAI api\n\u2514  1 credentials\n", ""],
      badCount: [v1AuthBlock.replace("1 credentials", "2 credentials"), ""],
      zeroCount: [v1AuthBlock.replace("1 credentials", "0 credentials"), ""],
      duplicate: ["Credentials /p\n\u25cf  OpenAI oauth\n\u25cf  OpenAI oauth\n\u2514  1 credentials\n", ""],
      extraEntry: ["Credentials /p\n\u25cf  OpenAI oauth\n\u2502  Anthropic oauth\n\u2514  2 credentials\n", ""],
      environment: ["Environment\n\u2502  OPENAI_API_KEY\n\u2514  1 environment variables\n", ""],
      envSection: [v1AuthBlock + "Environment\n\u2502  OPENAI_API_KEY\n\u2514  1 environment variables\n", ""],
      unknownLine: [v1AuthBlock + "noise\n", ""],
      bareEntry: ["OpenAI oauth\n", ""],
      splitFragment: [v1AuthBlock, "OpenAI oauth\n"],
      frameOnlyOtherStream: [v1AuthBlock, "│\n"],
      repeatedFrame: [v1AuthBlock.replace("OpenAI oauth", "│OpenAI oauth"), ""],
      bothStreams: [v1AuthBlock, v1AuthBlock],
      controlNoise: ["\x1b[2J" + v1AuthBlock, ""],
      apiKeyNoise: ["Credentials /p\n\u25cf  OpenAI oauth\n\u2514  1 credentials\n", "OPENAI_API_KEY\n"],
    })) {
      expect(openCodeV1OAuthListPassed(out, err), name).toBe(false);
    }
  });
  it("runs a V1 subscription lane under the native home with truthful endpoint metadata", async () => {
    Object.assign(process.env,{XDG_DATA_HOME:"/native/data",OPENAI_API_KEY:"PRIVATE_KEY",OPENAI_BASE_URL:"PRIVATE_ROUTE"});
    fixture({version:"1.18.32", stdout:success});
    const opts = subscription();
    const attempt = v1Attempt(opts);
    expect((attempt.config as Record<string,unknown>).provider).toBeUndefined();
    expect(attempt.environment.XDG_DATA_HOME).toBe("/native/data");
    expect(attempt.environment.NO_COLOR).toBe("1");
    expect(attempt.environment.OPENCODE_CONFIG).toBe(join(openCodeDirectory(opts),"opencode.json"));
    expect(attempt.environment.OPENCODE_CONFIG_DIR).toBeUndefined();
    for (const key of ["OPENAI_API_KEY","OPENAI_BASE_URL","OPENCODE_CONFIG_DIR"]) expect(attempt.environment[key]).toBeUndefined();
    const result = await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",apiSpend:"deny",sessionId:"s1",funding:{kind:"chatgpt-subscription",authentication:"native-openai-oauth",configuredEndpoint:null},preflight:{evidence:"OpenCode 1.18.32 (v1): private configuration verified; exactly one visible native OpenAI OAuth credential"}});
    const auth = JSON.parse(readFileSync(join(scratch,"auth.json"),"utf8"));
    const invoked = JSON.parse(readFileSync(join(scratch,"invoked.json"),"utf8"));
    expect(auth.args).toEqual(["--pure","auth","list"]);
    expect(auth.env).toEqual(invoked.env);
    const observed = JSON.parse(readFileSync(join(scratch,"preflight.json"),"utf8"));
    expect(observed.args).toEqual(["--pure","debug","config"]);
    expect(observed.noColor).toBe("1");
    expect(observed.config.provider).toBeUndefined();
    expect(existsSync(join(scratch,"export.json"))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE_");
  });
  for (const bad of [
    {authV1:"Credentials /p\n\u2502  OpenAI api\n\u2514  1 credentials\n"},
    {authV1:"Credentials /p\n\u25cf  OpenAI oauth\n\u2514  2 credentials\n"},
    {authV1:"Credentials /p\n\u25cf  OpenAI oauth\n\u25cf  OpenAI oauth\n\u2514  1 credentials\n"},
    {authV1:"Credentials /p\n\u25cf  OpenAI oauth\n\u2514  1 credentials\nEnvironment\n\u2502  OPENAI_API_KEY\n\u2514  1 environment variables\n"},
    {authV1:"OpenAI oauth\n"},
    {authV1:""},
    {authRaw:"Credentials /p\n\u25cf  OpenAI oauth\n\u2514  1 credentials\n", authStderr:"OpenAI oauth\n"},
    {authStderr:"CANARY_AUTH_STDERR\n"},
    {authExit:1},
    {authPoison:true},
  ]) it(`stops the V1 workload when native auth metadata fails ${JSON.stringify(bad)}`, async () => {
    fixture({version:"1.18.32", stdout:success, ...bad});
    const result = await runLane(subscription());
    expect(result.receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,apiSpend:"deny",funding:{authentication:null}});
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(join(scratch,"export.json"))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain("CANARY_");
  });
});

const litellm = {name:"CANARY_PROVIDER_NAME",package:"@ai-sdk/openai-compatible",env:["LITELLM_API_KEY"],settings:{baseURL:"http://CANARY_HOST:4000/v1"},models:{"claude-haiku-5-5":{capabilities:{tools:true}}}};
const providerFile = {litellm, other:{name:"CANARY_UNSELECTED",settings:{baseURL:"http://CANARY_UNSELECTED_HOST/v1"}}};
function custom(overrides: Partial<RunnerOptions> = {}): RunnerOptions {
  return options({model:"litellm/claude-haiku-5-5",opencodeProviderConfig:parseOpenCodeProviderConfig(JSON.stringify(providerFile),"litellm/claude-haiku-5-5"),...overrides});
}
async function cli(extra: readonly string[], file: object = providerFile, model = "litellm/claude-haiku-5-5") {
  const path = join(scratch,"providers.json");
  writeFileSync(path, JSON.stringify(file));
  let stderr = "";
  const code = await main(["--parent","codex","--provider","opencode","--model",model,"--effort","default","--mode","read-only","--prompt",join(scratch,"prompt"),"--cwd",scratch,"--output",join(scratch,"output"),"--receipt",join(scratch,"receipt"),"--opencode-provider-config",path,...extra], Date.now(), {stdout:()=>{},stderr:value=>{stderr+=value;}});
  return {code, stderr};
}
describe("OpenCode user-defined provider config", () => {
  it("adds exactly the selected entry and the config-provider plugin to the private V2 config", async () => {
    const {code} = await cli(["--api-spend","approved"]);
    expect(code).toBe(0);
    expect(readFileSync(join(scratch,"output"),"utf8").trim()).toBe("FINAL");
    const observed = JSON.parse(readFileSync(join(scratch,"preflight.json"),"utf8")).config;
    expect(observed.providers).toEqual({litellm});
    expect(observed.model).toEqual({providerID:"litellm",model:"claude-haiku-5-5"});
    expect(observed.plugins.slice(0,4)).toEqual(["-*","opencode.models.dev","opencode.provider.*","opencode.config.provider"]);
    expect(JSON.stringify(observed)).not.toContain("CANARY_UNSELECTED");
  });
  it("leaves the default V2 config without providers or the config-provider plugin", () => {
    const config = openCodeV2Config(options());
    expect(Object.keys(config)).toEqual(["model","default_agent","share","update","snapshots","lsp","formatter","compaction","warming","plugins","agents"]);
    expect(config.plugins).toEqual(["-*","opencode.models.dev","opencode.provider.*","opencode.config.agent","opencode.config.compaction","opencode.config.formatter","opencode.config.snapshot","opencode.tool.read","opencode.tool.glob","opencode.tool.grep"]);
  });
  it("keeps V2 preflight exact with the entry and rejects a foreign source or a changed entry", async () => {
    const attempt = v2Attempt(custom());
    mkdirSync(attempt.configDirectory,{recursive:true});
    writeFileSync(join(attempt.configDirectory,"opencode.json"),JSON.stringify(attempt.config));
    writeFileSync(join(attempt.configDirectory,"service.json"),JSON.stringify({disabled:true}));
    const entries = [{type:"document",path:join(attempt.configDirectory,"opencode.json"),info:attempt.config},{type:"directory",path:attempt.configDirectory}];
    expect(openCodePreflightPassed(JSON.stringify(entries),attempt)).toBe(true);
    const changed = {...attempt.config,providers:{litellm:{...litellm,settings:{baseURL:"http://elsewhere/v1"}}}};
    expect(openCodePreflightPassed(JSON.stringify([{...entries[0],info:changed},entries[1]]),attempt)).toBe(false);
    expect(openCodePreflightPassed(JSON.stringify([...entries,{type:"document",info:{model:{providerID:"evil",model:"evil"}}}]),attempt)).toBe(false);
    fixture({extraSource:true,stdout:success});
    const opts = custom({receiptPath:join(scratch,"foreign-receipt"),outputPath:join(scratch,"foreign-output")});
    expect((await runLane(opts)).receipt).toMatchObject({processStarted:false,preflight:{status:"failed"}});
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
  });
  for (const [name, entry, key] of [
    ["provider apiKey", {...litellm,settings:{...litellm.settings,apiKey:"CANARY_KEY"}}, "apiKey"],
    ["provider headers", {...litellm,headers:{Authorization:"Bearer CANARY_KEY"}}, "headers"],
    ["model headers", {...litellm,models:{"claude-haiku-5-5":{headers:{"x-api-key":"CANARY_KEY"}}}}, "headers"],
    ["variant apiKey", {...litellm,models:{"claude-haiku-5-5":{variants:[{id:"fast",settings:{apiKey:"CANARY_KEY"}}]}}}, "apiKey"],
  ] as const) it(`rejects credentials in the selected entry: ${name}`, async () => {
    const {code, stderr} = await cli(["--api-spend","approved"], {litellm:entry});
    expect(code).toBe(64);
    expect(stderr).toContain(`must not contain ${key}`);
    expect(stderr).toContain("name the key's environment variable in env");
    expect(stderr).not.toContain("CANARY_KEY");
    expect(existsSync(join(scratch,"version.json"))).toBe(false);
  });
  it("rejects a file without an entry for the model's provider", async () => {
    const {code, stderr} = await cli(["--api-spend","approved"], {other:providerFile.other});
    expect(code).toBe(64);
    expect(stderr).toContain('no entry for provider "litellm"');
    expect(existsSync(join(scratch,"version.json"))).toBe(false);
  });
  for (const [name, extra, model] of [
    ["ChatGPT subscription mode", ["--api-spend","deny","--opencode-chatgpt-subscription"], OPENCODE_CHATGPT_SUBSCRIPTION_MODEL],
    ["denied API spend", ["--api-spend","deny"], "litellm/claude-haiku-5-5"],
    ["legacy API spend", [], "litellm/claude-haiku-5-5"],
  ] as const) it(`rejects provider config with ${name}`, async () => {
    const {code, stderr} = await cli(extra, {...providerFile,openai:litellm}, model);
    expect(code).toBe(64);
    expect(stderr).toContain("--opencode-provider-config requires provider opencode with ordinary native authentication");
    expect(existsSync(join(scratch,"version.json"))).toBe(false);
  });
  it("blocks the V1 contract before writing configuration", async () => {
    fixture({version:"1.18.32",stdout:success});
    const opts = custom();
    const receipt = (await runLane(opts)).receipt;
    expect(receipt).toMatchObject({status:"unavailable-cli",processStarted:false,preflight:{status:"failed"}});
    expect(receipt.error?.message).toContain("requires the OpenCode V2 contract");
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(existsSync(join(scratch,"invoked.json"))).toBe(false);
    expect(existsSync(openCodeDirectory(opts))).toBe(false);
  });
  it("records the provider ID and entry digest in the receipt but not the entry body", async () => {
    const opts = custom();
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("complete");
    const canonical = '{"env":["LITELLM_API_KEY"],"models":{"claude-haiku-5-5":{"capabilities":{"tools":true}}},"name":"CANARY_PROVIDER_NAME","package":"@ai-sdk/openai-compatible","settings":{"baseURL":"http://CANARY_HOST:4000/v1"}}';
    expect(result.receipt.opencodeProviderConfig).toEqual({providerID:"litellm",sha256:createHash("sha256").update(canonical).digest("hex")});
    const reordered = parseOpenCodeProviderConfig(JSON.stringify({litellm:Object.fromEntries(Object.entries(litellm).reverse())}),opts.model);
    const again = await runLane(custom({opencodeProviderConfig:reordered,receiptPath:join(scratch,"receipt-2"),outputPath:join(scratch,"output-2")}));
    expect(again.receipt.opencodeProviderConfig).toEqual(result.receipt.opencodeProviderConfig);
    const serialized = `${JSON.stringify(result.receipt)}\n${readFileSync(opts.receiptPath,"utf8")}`;
    expect(serialized).not.toContain("CANARY_");
    expect(serialized).not.toContain("LITELLM_API_KEY");
    expect(serialized).not.toContain("openai-compatible");
    expect((await runLane(options({receiptPath:join(scratch,"receipt-3"),outputPath:join(scratch,"output-3")}))).receipt.opencodeProviderConfig).toBeUndefined();
  });
});
