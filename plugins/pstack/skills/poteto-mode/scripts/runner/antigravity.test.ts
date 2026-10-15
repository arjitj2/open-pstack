import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityAgentDefinition, antigravityLaneFiles, antigravitySettingsTakeover, antigravityStdin, antigravityWriterVersion, antigravityTools, createAntigravityLaneFiles } from "./antigravity.ts";
import { invocationCommand } from "./commands.ts";
import { parseProviderOutput } from "./parse-output.ts";
import { runLane, validateOptions } from "./run.ts";
import type { RunnerOptions } from "./types.ts";

let scratch = "";
let oldPath: string | undefined;
let oldFixture: string | undefined;
let oldKey: string | undefined;
let oldHome: string | undefined;
const fake = `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const base = process.env.PSTACK_AGY_TEST_DIR;
const fixture = JSON.parse(readFileSync(join(base, "fixture.json"), "utf8"));
const args = process.argv.slice(2);
if (args[0] === "--version") {
  writeFileSync(join(base, "version.json"), JSON.stringify({args}));
  console.log(fixture.version ?? "1.3.5");
  process.exit(fixture.versionExit ?? 0);
}
if (args[0] === "models") {
  writeFileSync(join(base, "preflight.json"), JSON.stringify({args}));
  console.log(fixture.models ?? "gemini-3.1-pro-high\\tGemini 3.1 Pro (High)");
  process.exit(fixture.modelsExit ?? 0);
}
const value = (flag) => args[args.indexOf(flag) + 1];
const agent = value("--agent");
const model = value("--model");
const hookPath = join(process.cwd(), ".agents", "hooks.json");
const prompt = await Bun.stdin.text();
const agentPath = join(process.cwd(), ".agents", "agents", agent + ".md");
writeFileSync(join(base, "observed.json"), JSON.stringify({args,prompt,cwd:process.cwd(),agentPath,definition:readFileSync(agentPath,"utf8")}));
if (fixture.delay) await Bun.sleep(fixture.delay);
const session = "cd79dc0d-aa88-47ae-89f5-08c3863b58a2";
let hooks;
try { hooks = JSON.parse(readFileSync(join(process.cwd(), ".agents", "hooks.json"),"utf8")).pstack; } catch {}
if (hooks) {
  const metadata = {conversationId:session, workspacePaths:[process.cwd()], modelName:model};
  for (const [stage,payload] of [["SessionStart",metadata], ["Stop",{...metadata,fullyIdle:true}]]) {
    const run = Bun.spawnSync(["/bin/sh","-c",hooks[stage][0].command], {stdin:Buffer.from(JSON.stringify(payload))});
    if (run.exitCode !== 0 || JSON.parse(run.stdout.toString()).decision === "deny") throw Error("Fixture guard refused");
  }
}
const init = {event:"init",conversation_id:session,init:{model:fixture.reportedModel ?? model,agent:fixture.reportedAgent ?? agent}};
if (fixture.replaceHook) { writeFileSync(hookPath, "USER_REPLACEMENT"); }
const step = {event:"step_update",step_update:{step_type:"tool",tool_name:fixture.tool ?? "view_file",...(fixture.toolError ? {tool_info:{error:fixture.toolError}} : {})}};
const result = {event:"result",result:{conversation_id:session,status:fixture.status ?? "SUCCESS",response:fixture.response ?? "AGY_OK",num_turns:1,...(fixture.denied ? {denied_actions:[]} : {})}};
const stream = fixture.raw ?? [init,step,result].map(JSON.stringify).join("\\n");
console.log(stream);
if (fixture.stderr) console.error(fixture.stderr);
process.exit(fixture.exit ?? 0);
`;

beforeEach(() => {
  scratch = mkdtempSync(join(process.cwd(), ".pstack-agy-test-"));
  oldHome = process.env.HOME;
  process.env.HOME = scratch;
  mkdirSync(join(scratch, ".gemini/config/projects"), {recursive:true});
  writeFileSync(join(scratch, ".gemini/config/projects/default-cli-project.json"), JSON.stringify({id:"default-cli-project",name:"CLI Project",projectResources:{}}));
  mkdirSync(join(scratch, "bin"));
  const executable = join(scratch, "bin", "agy");
  writeFileSync(executable, fake);
  chmodSync(executable, 0o755);
  oldPath = process.env.PATH;
  oldFixture = process.env.PSTACK_AGY_TEST_DIR;
  oldKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.PATH = `${join(scratch, "bin")}:${oldPath}`;
  process.env.PSTACK_AGY_TEST_DIR = scratch;
  mkdirSync(join(scratch, "worktree"));
  writeFileSync(join(scratch, "prompt.md"), "Read the assigned value and answer.\n");
  writeFileSync(join(scratch, "fixture.json"), "{}");
});
afterEach(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
  if (oldFixture === undefined) delete process.env.PSTACK_AGY_TEST_DIR; else process.env.PSTACK_AGY_TEST_DIR = oldFixture;
  if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey;
  rmSync(scratch, { recursive: true, force: true });
});
function options(override: Partial<RunnerOptions> = {}): RunnerOptions {
  return {
    parent: "codex", provider: "antigravity", model: "gemini-3.1-pro-high", effort: "default",
    mode: "read-only", promptPath: join(scratch, "prompt.md"), cwd: join(scratch, "worktree"),
    outputPath: join(scratch, "output.txt"), receiptPath: join(scratch, "receipt.json"),
    timeoutMs: null, apiSpend: "approved", ...override,
  };
}
function fixture(value: object): void { writeFileSync(join(scratch, "fixture.json"), JSON.stringify(value)); }
interface ObservedInvocation {
  readonly args: string[];
  readonly prompt: string;
  readonly cwd: string;
  readonly agentPath: string;
  readonly definition: string;
}
function observed(): ObservedInvocation { return JSON.parse(readFileSync(join(scratch, "observed.json"), "utf8")) as ObservedInvocation; }

describe("Antigravity external lanes", () => {
  it("requires an exact slug, default effort, and explicit API spend", () => {
    for (const patch of [{model:"auto"}, {model:"bad slug"}, {effort:"high" as const}, {apiSpend:null}]) {
      expect(() => validateOptions(options(patch))).toThrow();
    }
  });

  it("accepts stable compatible writer versions without a tested-version floor", async () => {
    for (const version of ["1.0.0","1.3.5","1.99.123"]) expect(antigravityWriterVersion(version)).toBe(version);
    fixture({version:"1.99.123"});
    const result = await runLane(options({mode:"isolated-write"}));
    expect(result.receipt.status).toBe("complete");
    expect(result.receipt.preflight.evidence).toContain("Antigravity 1.99.123");
  });

  it.each(["2.0.0","0.9.0","1.3.5-beta.1","unknown","1.3.5\nPRIVATE_BANNER_VALUE"])("rejects unsupported writer version %s before model invocation", async version => {
    fixture({version});
    const result = await runLane(options({mode:"isolated-write"}));
    expect(result.receipt.status).toBe("unavailable-cli");
    expect(result.receipt.processStarted).toBe(false);
    expect(existsSync(join(scratch,"observed.json"))).toBe(false);
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain("PRIVATE_BANNER_VALUE");
    expect(result.receipt.preflight.evidence).toContain("stable agy 1.x");
  });

  it("declares only proven tools and encodes one stdin turn", () => {
    expect(antigravityTools("read-only")).toEqual(["view_file","list_dir","grep_search"]);
    expect(antigravityTools("isolated-write")).toEqual(["view_file","list_dir","grep_search","write_to_file","replace_file_content","multi_replace_file_content","run_command","manage_task"]);
    for (const mode of ["read-only", "isolated-write"] as const) {
      const definition = antigravityAgentDefinition("pstack-test", mode);
      for (const forbidden of ["command_status", "call_mcp_tool", "search_web", "invoke_subagent"]) {
        expect(definition).not.toContain(forbidden);
      }
    }
    const encoded = antigravityStdin('A "quote"\n雪', "/tmp/assigned", "read-only");
    expect(encoded.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(encoded)).toMatchObject({event:"user",message:{content:expect.stringContaining('A "quote"\n雪')}});
  });

  it("runs read-only from a private cwd and removes its agent directory", async () => {
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt).toMatchObject({status:"complete",modelEvidence:"pinned-argv",modelVerified:false,reportedModel:opts.model});
    expect(readFileSync(opts.outputPath,"utf8")).toBe("AGY_OK");
    const seen = observed();
    expect(seen.cwd).toBe(realpathSync(scratch) + "/receipt.json.antigravity");
    expect(seen.args).toContain("--disable-slash-commands");
    expect(seen.args[0]).toBe("--print=");
    expect(seen.args).toContain("--add-dir");
    expect(seen.args).not.toContain("--mode");
    expect(seen.args).not.toContain("--effort");
    expect(seen.prompt).not.toBe(readFileSync(opts.promptPath,"utf8"));
    expect(seen.prompt).toContain(opts.cwd);
    expect(existsSync(seen.cwd)).toBe(false);
    expect(existsSync(join(opts.cwd,".agents"))).toBe(false);
    expect(existsSync(join(scratch,"version.json"))).toBe(false);
  });

  it("runs a sandboxed command-capable writer in the assigned worktree and cleans its agent file", async () => {
    const opts = options({mode:"isolated-write"});
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("complete");
    const seen = observed();
    expect(seen.cwd).toBe(realpathSync(opts.cwd));
    expect(seen.args).toContain("accept-edits");
    expect(seen.args[0]).toBe("--print=");
    expect(seen.args).not.toContain("--disable-slash-commands");
    expect(seen.definition).toContain("write_to_file");
    expect(existsSync(seen.agentPath)).toBe(false);
    expect(existsSync(join(opts.cwd,".agents"))).toBe(false);
  });

  it("sends the rendered contract with sandboxed check guidance and workspace addressing", async () => {
    const opts = options({mode:"isolated-write"});
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("complete");
    const seen = observed();
    const turn = JSON.parse(seen.prompt);
    expect(turn.event).toBe("user");
    const content = turn.message.content as string;
    expect(content).toContain(`Edit only the assigned dedicated worktree at ${opts.cwd}.`);
    expect(content).toContain("## Worker contract");
    expect(content).toContain("`run_command` for suitable checks");
    expect(seen.args).toContain("default-cli-project");
    expect(content).not.toContain("the parent runs tests");
    expect(content).toContain("Read the assigned value and answer.");
  });

  it("blocks ambient API credentials before any CLI process starts", async () => {
    process.env.GEMINI_API_KEY = "secret-not-for-receipts";
    const result = await runLane(options({apiSpend:"deny"}));
    expect(result.receipt).toMatchObject({status:"billing-policy-blocked",processStarted:false,failurePhase:"preflight"});
    expect(result.exitCode).toBe(78);
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    expect(JSON.stringify(result.receipt)).not.toContain("secret-not-for-receipts");
    expect(existsSync(`${options().receiptPath}.antigravity`)).toBe(false);
  });

  it("fails closed on settings routing, unreadable JSON, and custom overrides", () => {
    const path = join(scratch,"settings.json");
    expect(antigravitySettingsTakeover(path)).toBeNull();
    for (const content of ["{", "null", '{"modelProvider":null}', '{"modelConfigOverrides":{}}']) {
      writeFileSync(path,content);
      expect(antigravitySettingsTakeover(path)).not.toBeNull();
    }
    writeFileSync(path,'{"other":true}');
    expect(antigravitySettingsTakeover(path)).toBeNull();
  });

  it("rejects denied actions, wrong identity, forbidden tools and malformed streams", async () => {
    for (const [name, value, status] of [
      ["denied", {denied:true}, "child-failed"],
      ["model", {reportedModel:"other-model"}, "malformed-output"],
      ["agent", {reportedAgent:"other-agent"}, "malformed-output"],
      ["tool", {tool:"run_command"}, "malformed-output"],
      ["garbage", {raw:"not json"}, "malformed-output"],
    ] as const) {
      const opts = options({outputPath:join(scratch,`${name}.txt`),receiptPath:join(scratch,`${name}.json`)});
      fixture(value);
      const result = await runLane(opts);
      expect(result.receipt.status, name).toBe(status);
      expect(existsSync(opts.outputPath)).toBe(false);
      expect(existsSync(`${opts.receiptPath}.antigravity`)).toBe(false);
    }
  });

  it("surfaces native hook failures despite final SUCCESS and permits ordinary check failures", async () => {
    for (const error of ["denied by pre-tool hook: policy", "JSON hook jsonhook__test failed: missing", "failed to unmarshal result from hook jsonhook__test via protojson: malformed"]) {
      fixture({tool:"run_command",toolError:error + " CANARY_ARGUMENTS"});
      const opts = options({mode:"isolated-write",receiptPath:join(scratch,`hook-${error.length}.json`),outputPath:join(scratch,`hook-${error.length}.txt`)});
      const result = await runLane(opts);
      expect(result.receipt).toMatchObject({status:"child-failed",terminalSuccess:true,toolDenial:{verified:true,cause:"permission"}});
      expect(existsSync(opts.outputPath)).toBe(false);
      expect(JSON.stringify(result.receipt)).not.toContain("CANARY_ARGUMENTS");
    }
    fixture({tool:"run_command",toolError:"Command exited with code 1; stdout: JSON hook jsonhook__quoted failed: example"});
    expect((await runLane(options({mode:"isolated-write"}))).receipt.status).toBe("complete");
  });

  it("identifies conflicting policy source and key in preparation receipts without private values", async () => {
    const opts = options({mode:"isolated-write"});
    mkdirSync(join(opts.cwd,".agents"));
    const hooks = join(opts.cwd,".agents/hooks.json");
    const privateValue = "PRIVATE_POLICY_VALUE";
    writeFileSync(hooks,privateValue);
    const conflict = await runLane(opts);
    expect(conflict.receipt.error?.evidence).toContain(hooks);
    expect(conflict.receipt.error?.evidence).toContain("existing workspace hooks");
    expect(JSON.stringify(conflict.receipt)).not.toContain(privateValue);
    expect(readFileSync(hooks,"utf8")).toBe(privateValue);
    expect(existsSync(join(scratch,"observed.json"))).toBe(false);
    rmSync(hooks);
    const prior = process.env.AGY_UNKNOWN_POLICY;
    process.env.AGY_UNKNOWN_POLICY = privateValue;
    try {
      const unknown = await runLane(options({mode:"isolated-write",receiptPath:join(scratch,"unknown.json"),outputPath:join(scratch,"unknown.txt")}));
      expect(unknown.receipt.status).toBe("child-failed");
      expect(unknown.receipt.error?.evidence).toContain("environment");
      expect(unknown.receipt.error?.evidence).toContain("AGY_UNKNOWN_POLICY");
      expect(JSON.stringify(unknown.receipt)).not.toContain(privateValue);
      expect(existsSync(join(scratch,"observed.json"))).toBe(false);
    } finally {
      if (prior === undefined) delete process.env.AGY_UNKNOWN_POLICY; else process.env.AGY_UNKNOWN_POLICY = prior;
    }
  });

  it("keeps ownership-loss cleanup from leaving a complete receipt", async () => {
    fixture({replaceHook:true});
    const opts = options({mode:"isolated-write"});
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("malformed-output");
    expect(JSON.parse(readFileSync(opts.receiptPath,"utf8")).status).toBe("malformed-output");
    expect(readFileSync(join(opts.cwd,".agents/hooks.json"),"utf8")).toBe("USER_REPLACEMENT");
    expect(existsSync(opts.outputPath)).toBe(false);
    expect(existsSync(antigravityLaneFiles(opts).agentPath)).toBe(false);
  });

  it("keeps the original provider failure when cleanup also loses ownership", async () => {
    fixture({replaceHook:true,denied:true});
    const result = await runLane(options({mode:"isolated-write"}));
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.error?.message).not.toBe("Antigravity cleanup could not remove owned lane files");
    expect(result.receipt.error?.evidence).toContain("Antigravity cleanup could not remove owned lane files");
  });

  it("preserves terminal success when the child exits nonzero", async () => {
    fixture({exit:7});
    const result = await runLane(options());
    expect(result.receipt).toMatchObject({status:"child-failed",terminalSuccess:true,processStarted:true});
  });

  it("cleans private and worktree agent files after an explicit timeout", async () => {
    fixture({delay:500});
    for (const mode of ["read-only","isolated-write"] as const) {
      const opts = options({mode,outputPath:join(scratch,`${mode}.txt`),receiptPath:join(scratch,`${mode}.json`),timeoutMs:120});
      const result = await runLane(opts);
      expect(result.receipt.status).toBe("timed-out");
      expect(existsSync(antigravityLaneFiles(opts).agentPath)).toBe(false);
      expect(existsSync(opts.outputPath)).toBe(false);
    }
  });

  it("cleans a worktree agent file after handled cancellation", async () => {
    fixture({delay:1000});
    const opts = options({mode:"isolated-write"});
    const run = runLane(opts);
    while (!existsSync(join(scratch,"observed.json"))) await Bun.sleep(10);
    process.emit("SIGTERM");
    const result = await run;
    expect(result.receipt.status).toBe("cancelled");
    expect(existsSync(antigravityLaneFiles(opts).agentPath)).toBe(false);
    expect(existsSync(opts.outputPath)).toBe(false);
  });

  it("does not overwrite reserved output or a colliding agent definition", async () => {
    const opts = options({mode:"isolated-write"});
    const files = antigravityLaneFiles(opts);
    mkdirSync(files.directory,{recursive:true});
    writeFileSync(files.agentPath,"user-owned");
    const blocked = await runLane(opts);
    expect(blocked.receipt.status).toBe("child-failed");
    expect(readFileSync(files.agentPath,"utf8")).toBe("user-owned");
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
    const second = options({mode:"isolated-write",outputPath:join(scratch,"reserved.txt"),receiptPath:join(scratch,"reserved.json")});
    writeFileSync(second.outputPath,"keep");
    await expect(runLane(second)).rejects.toThrow();
    expect(readFileSync(second.outputPath,"utf8")).toBe("keep");
  });

  it("rejects a symlinked agent directory without writing through it", async () => {
    const opts = options({mode:"isolated-write"});
    const outside = join(scratch,"outside");
    mkdirSync(outside);
    symlinkSync(outside,join(opts.cwd,".agents"));
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("child-failed");
    expect(existsSync(join(outside,"agents"))).toBe(false);
    expect(existsSync(join(scratch,"preflight.json"))).toBe(false);
  });

  it("preserves replaced empty agent directories and reports their lost ownership", () => {
    const opts = options({mode:"isolated-write"});
    const lane = createAntigravityLaneFiles(opts);
    const path = lane.files.directory;
    renameSync(path,`${path}-original`); mkdirSync(path);
    expect(() => lane.assertUnchanged()).toThrow("directory ownership changed");
    expect(() => lane.cleanup()).toThrow(); lane.cleanup();
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}-original`)).toBe(true);
  });

  it("uses the captured one-turn shape and rejects a result after result", () => {
    const session = "one";
    const init = {event:"init",conversation_id:session,init:{model:"gemini-3.1-pro-high",agent:"pstack-test"}};
    const result = {event:"result",result:{conversation_id:session,status:"SUCCESS",response:"OK",num_turns:1,usage:{input_tokens:2,output_tokens:3,thinking_tokens:1,cache_read_tokens:1,total_tokens:5}}};
    const stream = [init,result].map((event) => JSON.stringify(event)).join("\n");
    expect(parseProviderOutput("antigravity",stream,"","gemini-3.1-pro-high")).toMatchObject({text:"OK",reportedModel:"gemini-3.1-pro-high",usage:{inputTokens:2,outputTokens:3,reasoningTokens:1,cachedInputTokens:1}});
    expect(() => parseProviderOutput("antigravity",`${stream}\n${JSON.stringify(result)}`,"","gemini-3.1-pro-high")).toThrow();
  });
  it("bounds a failed invocation receipt to terminal result fields", async () => {
    const session = "fixture-session";
    fixture({
      raw: [
        JSON.stringify({event:"init",conversation_id:session,init:{model:"gemini-3.1-pro-high",agent:"pstack-test"}}),
        JSON.stringify({event:"step_update",step_update:{step_type:"thought",text:"CANARY_REASONING"}}),
        JSON.stringify({event:"step_update",step_update:{step_type:"tool",tool_name:"run_command",detail:"CANARY_TOOL_ARGUMENTS"}}),
        "CANARY_MALFORMED_LINE",
        JSON.stringify({event:"result",result:{conversation_id:session,status:"ERROR",response:"agy terminal detail",extension:"CANARY_TERMINAL_EXTENSION"}}),
      ].join("\n"),
      stderr: "CANARY_STDERR",
      exit: 1,
    });
    const opts = options();
    const result = await runLane(opts);
    expect(result.receipt.status).toBe("child-failed");
    const serialized = `${JSON.stringify(result.receipt)}\n${readFileSync(opts.receiptPath, "utf8")}`;
    for (const canary of ["CANARY_REASONING","CANARY_TOOL_ARGUMENTS","CANARY_NARRATION","CANARY_MALFORMED_LINE","CANARY_STDERR","CANARY_TERMINAL_EXTENSION"]) {
      expect(serialized).not.toContain(canary);
    }
    expect(result.receipt.error?.evidence).toContain("agy terminal detail");
    expect(result.receipt.error?.evidence).toContain("stdout:");
  });
});
