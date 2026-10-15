import { afterEach, beforeEach, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { antigravityTools, ANTIGRAVITY_WRITE_TOOLS } from "./antigravity.ts";
import { createWriterBoundary } from "./antigravity-policy.ts";

let scratch = "";
beforeEach(() => { scratch = mkdtempSync(join(process.cwd(), ".pstack-guard-test-")); });
afterEach(() => { rmSync(scratch, {recursive:true, force:true}); });
const conversationId = "cd79dc0d-aa88-47ae-89f5-08c3863b58a2";
function prepare(name = "lane") {
  const home = join(scratch, name, "home");
  const root = join(scratch, name, "worktree");
  mkdirSync(join(home, ".gemini/config/projects"), {recursive:true});
  mkdirSync(join(root, ".agents/agents"), {recursive:true});
  writeFileSync(join(home, ".gemini/config/projects/default-cli-project.json"), JSON.stringify({id:"default-cli-project",name:"My display name",projectResources:{}}));
  const agentPath = join(root, ".agents/agents/lane.md");
  writeFileSync(agentPath, "agent");
  const create = (env: NodeJS.ProcessEnv = {}) => createWriterBoundary({home,root,agentPath,model:"gemini-test-high",tools:antigravityTools("isolated-write"),writeTools:ANTIGRAVITY_WRITE_TOOLS,env});
  return {home,root,agentPath,create};
}
function drive(lane: ReturnType<typeof prepare>) {
  const boundary = lane.create();
  const hooks = JSON.parse(readFileSync(join(lane.root, ".agents/hooks.json"), "utf8")).pstack;
  const call = (stage: "SessionStart" | "PreToolUse" | "PostToolUse" | "Stop", input: object = {}) => {
    const entry = hooks[stage][0];
    const command: unknown = entry.command ?? entry.hooks[0].command;
    if (typeof command !== "string") throw Error("invalid fixture hook");
    const payload = {conversationId,workspacePaths:[lane.root],modelName:"gemini-test-high",...input};
    const result = Bun.spawnSync(["/bin/sh","-c",command], {stdin:Buffer.from(JSON.stringify(payload))});
    expect(result.exitCode).toBe(0);
    return JSON.parse(result.stdout.toString());
  };
  return {boundary,call};
}
const command = (root: string, extra: object = {}) => ({toolCall:{name:"run_command",args:{CommandLine:"python3 - <<'PY' | cat\nprint('arbitrary shell')\nPY\nsh -c 'echo nested'",Cwd:root,...extra}}});

it("runs the copied guard with native provenance, arbitrary shell, async modes and idle completion", () => {
  const lane = prepare();
  const {boundary,call} = drive(lane);
  expect(call("SessionStart")).toEqual({});
  const input = command(lane.root,{WaitMsBeforeAsync:5,BypassSandbox:false,RunPersistent:true,IsDaemon:true,RequestedTerminalID:"",toolAction:"check",toolSummary:"check",waitForPreviousTools:true});
  const before = JSON.stringify(input);
  expect(call("PreToolUse", input)).toEqual({decision:"auto_approve"});
  expect(JSON.stringify(input)).toBe(before);
  expect(call("PostToolUse", input)).toEqual({});
  expect(call("Stop",{fullyIdle:false}).decision).toBe("continue");
  expect(() => boundary.verifySettlement(conversationId)).toThrow();
  expect(call("Stop",{fullyIdle:true})).toEqual({});
  boundary.verifySettlement(conversationId);
  const control = readdirSync(lane.home).filter(name => name.startsWith(".pstack-antigravity-"));
  expect(control).toHaveLength(1);
  const controlName = control[0];
  if (!controlName) throw Error("missing fixture control directory");
  const state = readFileSync(join(lane.home,controlName,"state.json"),"utf8");
  expect(JSON.parse(state)).toEqual({conversationId});
  expect(readFileSync(join(lane.home,controlName,"idle"),"utf8")).toBe("1");
  expect(readFileSync(join(lane.home,controlName,"denied"),"utf8")).toBe("0");
  expect(state).not.toContain("arbitrary shell");
  boundary.cleanup(); boundary.cleanup();
  expect(existsSync(join(lane.root,".agents/hooks.json"))).toBe(false);
  expect(existsSync(join(lane.home,controlName))).toBe(false);
});

it.each([{BypassSandbox:true},{RequestedTerminalID:"terminal-1"},{Cwd:"/"},{UnexpectedControl:true},{RunPersistent:"true"},{IsDaemon:1},{WaitMsBeforeAsync:-1},{CommandLine:" "}])("denies invalid command controls %j", args => {
  const lane = prepare();
  const {boundary,call} = drive(lane);
  call("SessionStart");
  expect(call("PreToolUse",command(lane.root,args)).decision).toBe("deny");
  expect(call("PreToolUse",command(lane.root)).decision).toBe("deny");
  expect(call("Stop",{fullyIdle:false}).decision).toBe("continue");
  expect(call("Stop",{fullyIdle:true})).toEqual({});
  expect(() => boundary.verifySettlement(conversationId)).toThrow();
  boundary.cleanup();
});

it("requires startup and the same conversation, workspace and model", () => {
  for (const [index, input] of [{}, {conversationId:"different"}, {workspacePaths:[scratch]}, {modelName:"other"}].entries()) {
    const lane = prepare(String(index)); const {boundary,call} = drive(lane);
    if (index) call("SessionStart");
    expect(call("PreToolUse",{...command(lane.root),...input}).decision).toBe("deny");
    boundary.cleanup();
  }
});

it("permits native task actions only with conversation-local selectors", () => {
  const lane = prepare(); const {boundary,call} = drive(lane); call("SessionStart");
  for (const Action of ["status","kill","send_input"]) for (const TaskId of ["task-2",`${conversationId}/task-2`]) {
    expect(call("PreToolUse",{toolCall:{name:"manage_task",args:{Action,TaskId,Input:"x"}}}).decision).toBe("auto_approve");
  }
  expect(call("PreToolUse",{toolCall:{name:"manage_task",args:{Action:"list"}}}).decision).toBe("auto_approve");
  expect(call("PreToolUse",{toolCall:{name:"manage_task",args:{Action:"status",TaskId:"foreign/task-2"}}}).decision).toBe("deny");
  boundary.cleanup();
});

it("protects agent and hooks from every direct write tool and follows target ancestry", () => {
  for (const [index, tool] of ANTIGRAVITY_WRITE_TOOLS.entries()) {
    const lane = prepare(String(index)); const {boundary,call} = drive(lane); call("SessionStart");
    expect(call("PreToolUse",{toolCall:{name:tool,args:{TargetFile:join(lane.root,"normal.txt")}}}).decision).toBe("allow");
    expect(call("PreToolUse",{toolCall:{name:tool,args:{TargetFile:index ? lane.agentPath : join(lane.root,".agents/hooks.json")}}}).decision).toBe("deny");
    boundary.cleanup();
  }
  const lane = prepare("symlink"); const {boundary,call} = drive(lane); call("SessionStart");
  symlinkSync(lane.home,join(lane.root,"escape"));
  expect(call("PreToolUse",{toolCall:{name:"write_to_file",args:{TargetFile:join(lane.root,"escape/new.txt")}}}).decision).toBe("deny");
  boundary.cleanup();
});

it("refuses ambient policy and existing hooks without changing them; routing stays independent", () => {
  for (const [index, settings] of [{toolPermission:"always-proceed"},{permissions:{allow:["command(*)"]}},{hooks:{}},{unknownPolicy:true}].entries()) {
    const lane = prepare(String(index)); const path = join(lane.home,".gemini/antigravity-cli/settings.json"); mkdirSync(join(lane.home,".gemini/antigravity-cli"));
    const text = JSON.stringify(settings); writeFileSync(path,text);
    expect(lane.create).toThrow(path); expect(readFileSync(path,"utf8")).toBe(text);
    expect(existsSync(join(lane.root,".agents/hooks.json"))).toBe(false);
  }
  const lane = prepare("route"); mkdirSync(join(lane.home,".gemini/antigravity-cli"));
  writeFileSync(join(lane.home,".gemini/antigravity-cli/settings.json"),JSON.stringify({trustedWorkspaces:[lane.root],modelProvider:"known-route",modelConfigOverrides:{}}));
  const boundary = lane.create({AGY_CLI_DISABLE_AUTO_UPDATE:"true",AGY_ADC_AUTH:"true",AGY_LLM_GATEWAY_ENDPOINT:"route"}); boundary.cleanup();
  const hooks = join(lane.root,".agents/hooks.json"); writeFileSync(hooks,"user-owned");
  expect(lane.create).toThrow("existing workspace hooks"); expect(readFileSync(hooks,"utf8")).toBe("user-owned");
});

it("detects source and plugin additions on tool calls and settlement", () => {
  const lane = prepare(); mkdirSync(join(lane.home,".gemini/config/plugins"));
  const {boundary,call} = drive(lane); call("SessionStart");
  mkdirSync(join(lane.home,".gemini/config/plugins/new-plugin"));
  expect(call("PreToolUse",command(lane.root)).decision).toBe("deny");
  expect(call("Stop",{fullyIdle:true})).toEqual({});
  expect(() => boundary.assertUnchanged()).toThrow("policy source changed"); boundary.cleanup();
});

it("preserves replacement discovery files and reports ownership loss during cleanup", () => {
  const lane = prepare(); const {boundary,call} = drive(lane); call("SessionStart");
  const hook = join(lane.root,".agents/hooks.json"); renameSync(hook,join(lane.root,"captured-hooks.json")); writeFileSync(hook,"replacement");
  expect(call("PreToolUse",command(lane.root)).decision).toBe("deny");
  expect(() => boundary.cleanup()).toThrow("lost ownership"); boundary.cleanup();
  expect(readFileSync(hook,"utf8")).toBe("replacement");
});

it("refuses malformed, symlinked and unknown source shapes and rolls back setup", () => {
  for (const [index, text] of ["{","null",JSON.stringify({globalPermissionGrants:[]})].entries()) {
    const lane = prepare(String(index)); const path = join(lane.home,".gemini/config/config.json"); writeFileSync(path,text);
    expect(lane.create).toThrow(path); expect(readdirSync(lane.home).some(name=>name.startsWith(".pstack-antigravity-"))).toBe(false);
  }
  const lane = prepare("link"); symlinkSync(lane.agentPath,join(lane.home,".gemini/config/config.json")); expect(lane.create).toThrow("ancestry must be real");
  const empty = prepare("failure"); rmSync(join(empty.root,".agents"),{recursive:true}); expect(empty.create).toThrow();
  expect(readdirSync(empty.home).some(name=>name.startsWith(".pstack-antigravity-"))).toBe(false);
});

it("preserves replaced external control directories and mutable state inodes", () => {
  const lane = prepare("directory"); const {boundary} = drive(lane);
  const name = readdirSync(lane.home).find(name=>name.startsWith(".pstack-antigravity-"));
  if (!name) throw Error("missing fixture control");
  const directory = join(lane.home,name);
  renameSync(directory,`${directory}-original`); mkdirSync(directory);
  expect(() => boundary.cleanup()).toThrow("ownership changed");
  expect(existsSync(directory)).toBe(true);
  const stateLane = prepare("state"); const second = drive(stateLane); second.call("SessionStart"); second.call("Stop",{fullyIdle:true});
  const stateName = readdirSync(stateLane.home).find(name=>name.startsWith(".pstack-antigravity-"));
  if (!stateName) throw Error("missing state fixture");
  const path = join(stateLane.home,stateName,"state.json");
  renameSync(path,`${path}-original`); writeFileSync(path,JSON.stringify({conversationId,idle:true,denial:null}));
  expect(() => second.boundary.verifySettlement(conversationId)).toThrow("state ownership changed");
  expect(() => second.boundary.cleanup()).toThrow("lost ownership");
  expect(existsSync(path)).toBe(true);
});

it("preserves a denial when a hook loaded an earlier state before another hook rejected", async () => {
  const lane = prepare("concurrent"); const {boundary,call} = drive(lane); call("SessionStart");
  const name = readdirSync(lane.home).find(name => name.startsWith(".pstack-antigravity-"));
  if (!name) throw Error("missing fixture control");
  const directory = join(lane.home,name);
  const preload = join(scratch,"observe-state.mjs");
  writeFileSync(preload, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const read = fs.readFileSync;
fs.readFileSync = (path,...args) => { const value = read(path,...args); if (typeof path === "number" || String(path).endsWith("/state.json")) process.stderr.write("STATE_READ\\n"); return value; };
syncBuiltinESMExports();
`);
  const child = spawn("node",["--import",preload,join(directory,"guard.mjs"),"pre"],{stdio:["pipe","pipe","pipe"]});
  let output = ""; child.stdout.on("data",chunk => { output += chunk; });
  const settled = once(child,"close");
  await once(child.stderr,"data");
  expect(call("PreToolUse",command(lane.root,{BypassSandbox:true})).decision).toBe("deny");
  child.stdin.end(JSON.stringify({conversationId,workspacePaths:[lane.root],modelName:"gemini-test-high",...command(lane.root)}));
  await settled;
  expect(JSON.parse(output).decision).toBe("deny");
  expect(call("PreToolUse",command(lane.root)).decision).toBe("deny");
  call("Stop",{fullyIdle:true});
  expect(() => boundary.verifySettlement(conversationId)).toThrow();
  boundary.cleanup();
});

it.each(["SessionStart", "PostToolUse"] as const)("keeps %s output schema valid on validation failure and retains denial", stage => {
  const lane = prepare(stage); const {boundary,call} = drive(lane);
  if (stage === "PostToolUse") call("SessionStart");
  expect(call(stage,{modelName:"other"})).toEqual({});
  expect(call("PreToolUse",command(lane.root)).decision).toBe("deny");
  expect(call("Stop",{fullyIdle:true})).toEqual({});
  expect(() => boundary.verifySettlement(conversationId)).toThrow();
  boundary.cleanup();
});

it("denies direct writes through a dangling leaf symlink", () => {
  const lane = prepare("dangling"); const {boundary,call} = drive(lane); call("SessionStart");
  symlinkSync(join(lane.home,"absent.txt"),join(lane.root,"link"));
  expect(call("PreToolUse",{toolCall:{name:"write_to_file",args:{TargetFile:join(lane.root,"link")}}}).decision).toBe("deny");
  expect(existsSync(join(lane.home,"absent.txt"))).toBe(false);
  boundary.cleanup();
});

it("retains denial when session JSON cannot be read", () => {
  const lane = prepare("malformed-state"); const {boundary,call} = drive(lane); call("SessionStart");
  const name = readdirSync(lane.home).find(name => name.startsWith(".pstack-antigravity-"));
  if (!name) throw Error("missing fixture control");
  const state = join(lane.home,name,"state.json"); const before = readFileSync(state);
  writeFileSync(state,"{");
  expect(call("PostToolUse",command(lane.root))).toEqual({});
  expect(readFileSync(join(lane.home,name,"denied"),"utf8")).toBe("1");
  writeFileSync(state,before);
  expect(call("PreToolUse",command(lane.root)).decision).toBe("deny");
  call("Stop",{fullyIdle:true});
  expect(() => boundary.verifySettlement(conversationId)).toThrow();
  boundary.cleanup();
});

it.each(["idle","denied"])("preserves replaced %s flag inodes during cleanup", flag => {
  const lane = prepare(flag); const {boundary,call} = drive(lane); call("SessionStart"); call("Stop",{fullyIdle:true});
  const name = readdirSync(lane.home).find(name => name.startsWith(".pstack-antigravity-"));
  if (!name) throw Error("missing fixture control");
  const path = join(lane.home,name,flag);
  renameSync(path,`${path}-original`); writeFileSync(path,flag === "idle" ? "1" : "0");
  expect(() => boundary.verifySettlement(conversationId)).toThrow("state ownership changed");
  expect(() => boundary.cleanup()).toThrow("lost ownership");
  expect(existsSync(path)).toBe(true);
});
