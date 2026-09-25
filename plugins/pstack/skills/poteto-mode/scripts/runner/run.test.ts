import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { childEnvironment, runLane } from "./run.ts";
import { main } from "./cli.ts";
import { nextAttempt, type LanePolicy } from "../model-policy/model-policy.ts";
import { normalizeReceiptEvent } from "../model-policy/receipt-event.ts";
import type { Provider, RunnerOptions, RunnerReceipt } from "./types.ts";

let scratch = "";
let bin = "";
let previousPath: string | undefined;

const fake = `#!/usr/bin/env bun
import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const name = process.argv[1].split("/").at(-1);
const isPreflight =
  (name === "claude" && args.includes("auth")) ||
  (name === "codex" && args[0] === "login") ||
  (name === "grok" && args[0] === "models") ||
  (name === "devin" && args[0] === "auth") ||
  (name === "cursor-agent" && (args[0] === "status" || args[0] === "--version"));
const stage = isPreflight ? "preflight" : "model";
if (process.env.FAKE_NETWORK_TEST_URL) {
  let connected = false;
  try {
    await fetch(process.env.FAKE_NETWORK_TEST_URL + "/" + stage);
    connected = true;
  } catch {}
  appendFileSync(process.env.FAKE_NETWORK_LOG_PATH, stage + ":" + connected + "\\n");
}
const startedPath = isPreflight
  ? process.env.FAKE_PREFLIGHT_STARTED_PATH
  : process.env.FAKE_MODEL_STARTED_PATH;
if (startedPath) writeFileSync(startedPath, String(process.pid));
const cancelStage = process.env.FAKE_CANCEL_STAGE ??
  (process.env.FAKE_CANCEL === "1" ? "model" : "");
if (cancelStage === stage) {
  const stop = (signal) => {
    writeFileSync(process.env.FAKE_TERMINATED_PATH, signal);
    if (process.env.FAKE_IGNORE_SIGNAL !== "1") process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  writeFileSync(process.env.FAKE_STARTED_PATH, String(process.pid));
  await Bun.sleep(5_000);
}
const delay = Number(
  stage === "preflight"
    ? process.env.FAKE_PREFLIGHT_DELAY_MS ?? 0
    : process.env.FAKE_MODEL_DELAY_MS ?? 0
);
if (delay > 0) await Bun.sleep(delay);
if (process.env.FAKE_TIMEOUT === "1" && !args.includes("status") && !args.includes("models")) {
  await Bun.sleep(5_000);
}
if (isPreflight && process.env.FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT === "1") {
  unlinkSync(process.argv[1]);
}
if (name === "claude" && args.includes("auth")) {
  throw new Error("Unexpected Claude auth probe");
}
if (name === "codex" && args[0] === "login") {
  console.log(process.env.FAKE_CODEX_LOGIN_STATUS ?? "Logged in using ChatGPT");
  process.exit(0);
}
if (name === "devin" && args[0] === "auth") {
  console.log("Logged in as runner-test@example.invalid");
  process.exit(0);
}
if (name === "cursor-agent" && (args[0] === "status" || args[0] === "--version")) {
  console.log(args[0] === "status" ? JSON.stringify({isAuthenticated:true}) : "2026.09.23-86fc751");
  process.exit(0);
}
if (name === "grok" && args[0] === "models") {
  if (process.env.FAKE_GROK_PREFLIGHT_LOG_PATH) {
    appendFileSync(process.env.FAKE_GROK_PREFLIGHT_LOG_PATH, "attempt\\n");
  }
  const transientMarker = process.env.FAKE_GROK_TRANSIENT_UNAUTH_PATH;
  if (transientMarker && !existsSync(transientMarker)) {
    writeFileSync(transientMarker, String(process.pid));
    console.log("Available models:\\n  * grok-4.7 (default)");
    console.error("You are not authenticated.");
    process.exit(0);
  }
  if (process.env.FAKE_GROK_MISSING_MODEL === "1") {
    console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.5 (default)");
    process.exit(0);
  }
  if (process.env.FAKE_GROK_UNAUTH === "1") {
    console.error("Not logged in. Run grok auth login.");
    process.exit(1);
  }
  console.log("You are logged in with grok.com.\\nAvailable models:\\n  * grok-4.7 (default)");
  process.exit(0);
}
const modelIndex = args.findIndex((value) => value === "--model");
const model = modelIndex >= 0 ? args[modelIndex + 1] : "unknown";
const reportedModel = model === "fable"
  ? "claude-fable-9-9"
  : model === "opus"
    ? "claude-opus-9"
    : model === "sonnet"
      ? "claude-sonnet-9-9"
      : model;
if (process.env.FAKE_INVALID_MODEL === "1") {
  console.error("The requested model is not supported with this account.");
  process.exit(1);
}
if (stage === "model" && process.env.FAKE_QUOTA_STDERR === "1") {
  console.error(JSON.stringify({type:"error",error:{type:"insufficient_quota",message:"You exceeded your current quota"}}));
  process.exit(1);
}
if (stage === "model" && process.env.FAKE_GENERIC_429 === "1") {
  console.error("HTTP 429 Too Many Requests: rate limit exceeded, please slow down");
  process.exit(1);
}
if (stage === "model" && process.env.FAKE_QUOTA_RESULT === "1") {
  console.log(JSON.stringify({result:"",is_error:true,subtype:"error_during_execution",errors:[JSON.stringify({type:"error",error:{type:"insufficient_quota",message:"Your usage quota is exhausted"}})]}));
  process.exit(0);
}
if (stage === "model" && process.env.FAKE_QUOTA_TEXT === "1") {
  console.log(JSON.stringify({result:"You have exceeded your quota and cannot proceed",session_id:"c1",is_error:false,modelUsage:{[reportedModel]:{}}}));
  process.exit(0);
}
if (stage === "model" && process.env.FAKE_QUOTA_WORDS_STDERR === "1") {
  console.error("You have exceeded your current quota, please check your plan and billing details");
  process.exit(1);
}
if (stage === "model" && process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS) {
  const seconds = Number(process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS) / 1000;
  const descendant = Bun.spawn(["/bin/sh", "-c", "sleep " + seconds], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (process.env.FAKE_DESCENDANT_PID_PATH) {
    writeFileSync(process.env.FAKE_DESCENDANT_PID_PATH, String(descendant.pid));
  }
  descendant.unref();
}
if (stage === "model" && process.env.FAKE_SELF_SIGNAL) {
  process.kill(process.pid, process.env.FAKE_SELF_SIGNAL);
  await Bun.sleep(5_000);
}
if (name === "codex" && stage === "model" && process.env.FAKE_CODEX_TURN_FAILED) {
  console.log(JSON.stringify({type:"thread.started",thread_id:"t1"}));
  if (process.env.FAKE_CODEX_AGENT_MESSAGE) {
    console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:process.env.FAKE_CODEX_AGENT_MESSAGE}}));
  }
  console.log(JSON.stringify({type:"turn.failed",error:{message:process.env.FAKE_CODEX_TURN_FAILED}}));
  process.exit(Number(process.env.FAKE_CODEX_TURN_FAILED_EXIT ?? "0"));
}
if (name === "codex" && stage === "model" && process.env.FAKE_CODEX_RECOVERED_ERROR === "1") {
  console.log(JSON.stringify({type:"error",message:"stream error: reconnecting"}));
}
if (name === "grok" && stage === "model" && process.env.FAKE_GROK_FREE_USAGE === "1") {
  console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"I inspected authentication handling."}]}}));
  console.log(JSON.stringify({type:"result",subtype:"error_during_execution",is_error:true,errors:["You\u2019ve reached your free Grok Build usage limit for now. Get SuperGrok for much higher limits, or try again later: https://grok.com/supergrok?referrer=grok-build"]}));
  process.exit(Number(process.env.FAKE_GROK_FREE_USAGE_EXIT ?? "0"));
}
if (name === "claude" && stage === "model" && process.env.FAKE_CLAUDE_API_ERROR === "1") {
  console.log(JSON.stringify({
    type:"result",
    subtype:"success",
    is_error:true,
    api_error_status:Number(process.env.FAKE_CLAUDE_API_ERROR_STATUS ?? "429"),
    terminal_reason:process.env.FAKE_CLAUDE_TERMINAL_REASON ?? "api_error",
    result:process.env.FAKE_CLAUDE_RESULT_TEXT ?? "You've hit your session limit \u00b7 resets 4pm (America/New_York)",
  }));
  process.exit(Number(process.env.FAKE_CLAUDE_API_ERROR_EXIT ?? "1"));
}
if (name === "devin" && stage === "model" && process.env.FAKE_DEVIN_STDERR) {
  console.error(process.env.FAKE_DEVIN_STDERR);
  process.exit(Number(process.env.FAKE_DEVIN_EXIT ?? "1"));
}
if (name === "cursor-agent" && stage === "model" && process.env.FAKE_CURSOR_STDERR) {
  if (process.env.FAKE_CURSOR_STDOUT_RESULT === "1") {
    console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"CURSOR_OK"}));
  }
  console.error(process.env.FAKE_CURSOR_STDERR);
  process.exit(Number(process.env.FAKE_CURSOR_EXIT ?? "1"));
}
if (name === "claude") {
  console.log(JSON.stringify({result:"CLAUDE_OK",session_id:"c1",usage:{input_tokens:10,output_tokens:2},total_cost_usd:0.01,modelUsage:{[reportedModel]:{}}}));
} else if (name === "codex") {
  console.log(JSON.stringify({type:"thread.started",thread_id:"o1"}));
  console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"CODEX_OK"}}));
  console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:20,cached_input_tokens:5,output_tokens:3,reasoning_output_tokens:1}}));
} else {
  console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"progress"}]}}));
  console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"GROK_OK",session_id:"g1",usage:{input_tokens:30,output_tokens:4,total_tokens:34},total_cost_usd:0.02,modelUsage:{[model + "-build"]:{}}}));
}
if (process.env.FAKE_MODEL_EXITING_PATH) {
  writeFileSync(process.env.FAKE_MODEL_EXITING_PATH, String(process.pid));
}
if (process.env.FAKE_MODEL_EXIT) {
  process.exit(Number(process.env.FAKE_MODEL_EXIT));
}
`;

function makeExecutable(name: string): void {
  const path = join(bin, name);
  writeFileSync(path, fake);
  chmodSync(path, 0o755);
}

function options(provider: Provider, suffix: string = provider): RunnerOptions {
  const parent = provider === "codex" ? "claude" : "codex";
  const model =
    provider === "claude"
      ? "fable"
      : provider === "codex"
        ? "gpt-5.6-sol"
        : "grok-4.7";
  return {
    parent,
    provider,
    model,
    effort: provider === "grok" ? "xhigh" : "max",
    mode: "read-only",
    promptPath: join(scratch, "prompt.md"),
    cwd: scratch,
    outputPath: join(scratch, `${suffix}.out`),
    receiptPath: join(scratch, `${suffix}.receipt.json`),
    timeoutMs: null,
    apiSpend: null,
  };
}

function receipt(path: string): RunnerReceipt {
  return JSON.parse(readFileSync(path, "utf8")) as RunnerReceipt;
}

function runnerArgs(input: RunnerOptions): string[] {
  const args = [
    join(import.meta.dir, "pstack-runner"),
    "--parent", input.parent,
    "--provider", input.provider,
    "--model", input.model,
    "--effort", input.effort,
    "--mode", input.mode,
    "--prompt", input.promptPath,
    "--cwd", input.cwd,
    "--output", input.outputPath,
    "--receipt", input.receiptPath,
  ];
  if (input.timeoutMs !== null) {
    args.push("--timeout", String(input.timeoutMs / 1_000));
  }
  return args;
}

async function waitFor(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (existsSync(path)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for ${path}`);
}

async function exitWithin(child: Bun.Subprocess, milliseconds: number): Promise<number> {
  const result = await Promise.race([
    child.exited,
    Bun.sleep(milliseconds).then(() => null),
  ]);
  if (result !== null) return result;
  child.kill("SIGKILL");
  await child.exited;
  throw new Error(`runner did not exit within ${milliseconds}ms`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await Bun.sleep(10);
  }
  throw new Error(`timed out waiting for process ${pid} to exit`);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-runner-test-"));
  bin = join(scratch, "bin");
  mkdirSync(bin);
  writeFileSync(join(scratch, "prompt.md"), "Return the marker.");
  for (const name of ["claude", "codex", "grok", "devin", "cursor-agent"]) makeExecutable(name);
  previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${dirname(process.execPath)}:${previousPath ?? ""}`;
  delete process.env.FAKE_NETWORK_TEST_URL;
  delete process.env.FAKE_NETWORK_LOG_PATH;
  delete process.env.FAKE_TIMEOUT;
  delete process.env.FAKE_INVALID_MODEL;
  delete process.env.FAKE_CANCEL;
  delete process.env.FAKE_CANCEL_STAGE;
  delete process.env.FAKE_IGNORE_SIGNAL;
  delete process.env.FAKE_PREFLIGHT_DELAY_MS;
  delete process.env.FAKE_MODEL_DELAY_MS;
  delete process.env.FAKE_STARTED_PATH;
  delete process.env.FAKE_TERMINATED_PATH;
  delete process.env.FAKE_PREFLIGHT_STARTED_PATH;
  delete process.env.FAKE_MODEL_STARTED_PATH;
  delete process.env.FAKE_MODEL_EXITING_PATH;
  delete process.env.FAKE_MODEL_EXIT;
  delete process.env.FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT;
  delete process.env.FAKE_GROK_UNAUTH;
  delete process.env.FAKE_GROK_TRANSIENT_UNAUTH_PATH;
  delete process.env.FAKE_GROK_PREFLIGHT_LOG_PATH;
  delete process.env.FAKE_GROK_MISSING_MODEL;
  delete process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS;
  delete process.env.FAKE_DESCENDANT_PID_PATH;
  delete process.env.FAKE_SELF_SIGNAL;
  delete process.env.FAKE_QUOTA_STDERR;
  delete process.env.FAKE_GENERIC_429;
  delete process.env.FAKE_QUOTA_RESULT;
  delete process.env.FAKE_QUOTA_TEXT;
  delete process.env.FAKE_QUOTA_WORDS_STDERR;
  delete process.env.FAKE_CODEX_LOGIN_STATUS;
  delete process.env.FAKE_CODEX_TURN_FAILED;
  delete process.env.FAKE_CODEX_TURN_FAILED_EXIT;
  delete process.env.FAKE_CODEX_AGENT_MESSAGE;
  delete process.env.FAKE_CODEX_RECOVERED_ERROR;
  delete process.env.FAKE_GROK_FREE_USAGE;
  delete process.env.FAKE_GROK_FREE_USAGE_EXIT;
  delete process.env.FAKE_CURSOR_EXIT;
  delete process.env.FAKE_CURSOR_STDOUT_RESULT;
  delete process.env.FAKE_CURSOR_STDERR;
  delete process.env.FAKE_DEVIN_EXIT;
  delete process.env.FAKE_DEVIN_STDERR;
  delete process.env.FAKE_CLAUDE_API_ERROR_EXIT;
  delete process.env.FAKE_CLAUDE_RESULT_TEXT;
  delete process.env.FAKE_CLAUDE_TERMINAL_REASON;
  delete process.env.FAKE_CLAUDE_API_ERROR_STATUS;
  delete process.env.FAKE_CLAUDE_API_ERROR;
  delete process.env.CURSOR_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_AWS_API_KEY;
  delete process.env.CLAUDE_CODE_USE_BEDROCK;
  delete process.env.CLAUDE_CODE_USE_VERTEX;
  delete process.env.CLAUDE_CODE_USE_FOUNDRY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_CUSTOM_HEADERS;
  delete process.env.XAI_API_KEY;
});

afterEach(() => {
  process.env.PATH = previousPath;
  delete process.env.FAKE_NETWORK_TEST_URL;
  delete process.env.FAKE_NETWORK_LOG_PATH;
  delete process.env.FAKE_TIMEOUT;
  delete process.env.FAKE_INVALID_MODEL;
  delete process.env.FAKE_CANCEL;
  delete process.env.FAKE_CANCEL_STAGE;
  delete process.env.FAKE_IGNORE_SIGNAL;
  delete process.env.FAKE_PREFLIGHT_DELAY_MS;
  delete process.env.FAKE_MODEL_DELAY_MS;
  delete process.env.FAKE_STARTED_PATH;
  delete process.env.FAKE_TERMINATED_PATH;
  delete process.env.FAKE_PREFLIGHT_STARTED_PATH;
  delete process.env.FAKE_MODEL_STARTED_PATH;
  delete process.env.FAKE_MODEL_EXITING_PATH;
  delete process.env.FAKE_MODEL_EXIT;
  delete process.env.FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT;
  delete process.env.FAKE_GROK_UNAUTH;
  delete process.env.FAKE_GROK_TRANSIENT_UNAUTH_PATH;
  delete process.env.FAKE_GROK_PREFLIGHT_LOG_PATH;
  delete process.env.FAKE_GROK_MISSING_MODEL;
  delete process.env.FAKE_DESCENDANT_HOLDS_PIPES_MS;
  delete process.env.FAKE_DESCENDANT_PID_PATH;
  delete process.env.FAKE_SELF_SIGNAL;
  delete process.env.FAKE_QUOTA_STDERR;
  delete process.env.FAKE_GENERIC_429;
  delete process.env.FAKE_QUOTA_RESULT;
  delete process.env.FAKE_QUOTA_TEXT;
  delete process.env.FAKE_QUOTA_WORDS_STDERR;
  delete process.env.FAKE_CODEX_LOGIN_STATUS;
  delete process.env.FAKE_CODEX_TURN_FAILED;
  delete process.env.FAKE_CODEX_TURN_FAILED_EXIT;
  delete process.env.FAKE_CODEX_AGENT_MESSAGE;
  delete process.env.FAKE_CODEX_RECOVERED_ERROR;
  delete process.env.FAKE_GROK_FREE_USAGE;
  delete process.env.FAKE_GROK_FREE_USAGE_EXIT;
  delete process.env.FAKE_CURSOR_EXIT;
  delete process.env.FAKE_CURSOR_STDOUT_RESULT;
  delete process.env.FAKE_CURSOR_STDERR;
  delete process.env.FAKE_DEVIN_EXIT;
  delete process.env.FAKE_DEVIN_STDERR;
  delete process.env.FAKE_CLAUDE_API_ERROR_EXIT;
  delete process.env.FAKE_CLAUDE_RESULT_TEXT;
  delete process.env.FAKE_CLAUDE_TERMINAL_REASON;
  delete process.env.FAKE_CLAUDE_API_ERROR_STATUS;
  delete process.env.FAKE_CLAUDE_API_ERROR;
  delete process.env.CURSOR_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.ANTHROPIC_AWS_API_KEY;
  delete process.env.CLAUDE_CODE_USE_BEDROCK;
  delete process.env.CLAUDE_CODE_USE_VERTEX;
  delete process.env.CLAUDE_CODE_USE_FOUNDRY;
  delete process.env.ANTHROPIC_BASE_URL;
  delete process.env.ANTHROPIC_CUSTOM_HEADERS;
  delete process.env.XAI_API_KEY;
  rmSync(scratch, { recursive: true, force: true });
});

describe("runLane", () => {
  for (const provider of ["claude", "codex", "grok"] as const) {
    it(`executes and receipts the ${provider} external lane`, async () => {
      const input = options(provider);
      const result = await runLane(input);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(input.outputPath, "utf8")).toContain(
        provider.toUpperCase()
      );
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "complete",
        provider,
        model: input.model,
        modelVerified: provider !== "codex",
        modelEvidence: provider === "codex" ? "pinned-argv" : "provider-report",
        preflight: { status: provider === "claude" ? "not-run" : "passed" },
      });
      if (provider === "claude") {
        expect(receipt(input.receiptPath).reportedModel).toBe("claude-fable-9-9");
      }
    });
  }

  it("records Codex's exact argv without fabricating a reported model", async () => {
    const input = options("codex");
    const result = await runLane(input);
    expect(result.exitCode).toBe(0);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      model: "gpt-5.6-sol",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: "pinned-argv",
    });
  });

  it("receipts every additional supported external family", async () => {
    const cases = [
      {
        provider: "claude" as const,
        model: "sonnet",
        reportedModel: "claude-sonnet-9-9",
      },
      {
        provider: "codex" as const,
        model: "gpt-6-astra",
        reportedModel: null,
      },
      {
        provider: "codex" as const,
        model: "gpt-5.6-luna",
        reportedModel: null,
      },
      {
        provider: "codex" as const,
        model: "gpt-5.6-terra",
        reportedModel: null,
      },
    ];
    for (const [index, { provider, model, reportedModel }] of cases.entries()) {
      const input = {
        ...options(provider, `supported-family-${index}`),
        model,
        effort: "high" as const,
      };
      expect((await runLane(input)).exitCode).toBe(0);
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "complete",
        provider,
        model,
        effort: "high",
        reportedModel,
        modelVerified: provider === "claude",
        modelEvidence: provider === "claude"
          ? "provider-report"
          : "pinned-argv",
      });
    }
  });

  it("keeps unproven invocation model wording as an ordinary child failure", async () => {
    process.env.FAKE_INVALID_MODEL = "1";
    const input = options("codex");
    const result = await runLane(input);
    expect(result.exitCode).toBe(70);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "child-failed",
      model: "gpt-5.6-sol",
      reportedModel: null,
      modelVerified: false,
      modelEvidence: null,
      failurePhase: "invocation",
      processStarted: true,
    });
    expect(receipt(input.receiptPath).error?.evidence).toContain(
      "The requested model is not supported with this account."
    );
  });

  it("retries a contradictory Grok authentication preflight before running the model", async () => {
    const transientMarker = join(scratch, "grok-transient-unauth.seen");
    const preflightLog = join(scratch, "grok-transient-unauth.log");
    process.env.FAKE_GROK_TRANSIENT_UNAUTH_PATH = transientMarker;
    process.env.FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-transient-model.started");
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-transient-unauth");
    const result = await runLane(input);

    expect(result.exitCode).toBe(0);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\nattempt\n");
    expect(existsSync(modelStarted)).toBe(true);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      preflight: { status: "passed" },
    });
    expect(receipt(input.receiptPath).preflight.evidence).toContain(
      "You are not authenticated."
    );
    expect(receipt(input.receiptPath).preflight.evidence).toContain(
      "attempt 2 passed"
    );
  }, 10_000);

  it("classifies Grok authentication failure after two consecutive preflights", async () => {
    process.env.FAKE_GROK_UNAUTH = "1";
    const preflightLog = join(scratch, "grok-unauthenticated.log");
    process.env.FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-model.started");
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-unauthenticated");
    const result = await runLane(input);

    expect(result.exitCode).toBe(77);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\nattempt\n");
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "unauthenticated",
      preflight: { status: "failed" },
    });
    expect(receipt(input.receiptPath).preflight.evidence).toContain(
      "attempt 2 failed"
    );
    expect(
      normalizeReceiptEvent(receipt(input.receiptPath), {
        parent: input.parent,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        mode: input.mode,
        apiSpend: "unset",
      }).status
    ).toBe("route-unavailable");
  }, 10_000);

  it("counts the Grok retry delay against the wrapper deadline", async () => {
    const transientMarker = join(scratch, "grok-deadline-unauth.seen");
    const preflightLog = join(scratch, "grok-deadline-unauth.log");
    process.env.FAKE_GROK_TRANSIENT_UNAUTH_PATH = transientMarker;
    process.env.FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-deadline-model.started");
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = {
      ...options("grok", "grok-preflight-retry-deadline"),
      timeoutMs: 700,
    };
    const result = await runLane(input);
    const recorded = receipt(input.receiptPath);

    expect(result.exitCode).toBe(124);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(existsSync(modelStarted)).toBe(false);
    expect(recorded).toMatchObject({
      status: "timed-out",
      preflight: { status: "timed-out" },
    });
    expect(recorded.preflight.evidence).toContain("You are not authenticated.");
    expect(recorded.elapsedMs).toBeLessThan(1_200);
  });

  it("cancels during the Grok retry delay without starting another preflight", async () => {
    const transientMarker = join(scratch, "grok-cancel-unauth.pid");
    const preflightLog = join(scratch, "grok-cancel-unauth.log");
    const input = options("grok", "grok-preflight-retry-cancelled");
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_GROK_TRANSIENT_UNAUTH_PATH: transientMarker,
        FAKE_GROK_PREFLIGHT_LOG_PATH: preflightLog,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(transientMarker);
    await waitForExit(Number(readFileSync(transientMarker, "utf8")));
    await Bun.sleep(200);
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 2_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      preflight: { status: "cancelled" },
      error: {
        message: "launcher received SIGTERM during authentication preflight retry delay",
      },
    });
  });

  it("does not retry a Grok preflight with a missing model", async () => {
    process.env.FAKE_GROK_MISSING_MODEL = "1";
    const preflightLog = join(scratch, "grok-missing-model.log");
    process.env.FAKE_GROK_PREFLIGHT_LOG_PATH = preflightLog;
    const modelStarted = join(scratch, "grok-missing-model.started");
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = options("grok", "grok-missing-model");
    const result = await runLane(input);

    expect(result.exitCode).toBe(69);
    expect(readFileSync(preflightLog, "utf8")).toBe("attempt\n");
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "unavailable-model",
      preflight: { status: "failed" },
    });
  });

  it("kills a timed-out child and preserves a failure receipt", async () => {
    process.env.FAKE_TIMEOUT = "1";
    const input = { ...options("claude"), timeoutMs: 30 };
    const result = await runLane(input);
    expect(result.exitCode).toBe(124);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath).status).toBe("timed-out");
  });

  it("does not spawn the model when preflight exhausts the wrapper deadline", async () => {
    const modelStarted = join(scratch, "deadline-model.started");
    const input = { ...options("codex", "preflight-deadline"), timeoutMs: 300 };
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_PREFLIGHT_DELAY_MS: "1000",
        FAKE_MODEL_STARTED_PATH: modelStarted,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(124);
    await Promise.all([stdout, stderr]);
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      signal: "SIGTERM",
      preflight: { status: "timed-out" },
    });
  });

  it("lets a delayed wrapper lane finish when timeout is omitted", async () => {
    const input = options("claude", "unbounded-default");
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: { ...process.env, FAKE_MODEL_DELAY_MS: "400" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 3_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      signal: null,
    });
    expect(receipt(input.receiptPath).elapsedMs).toBeGreaterThanOrEqual(400);
  });

  it("keeps a very long explicit deadline without timer overflow", async () => {
    const input = {
      ...options("claude", "long-runtime-deadline"),
      timeoutMs: 2_147_483_648,
    };
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: { ...process.env, FAKE_MODEL_DELAY_MS: "100" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 2_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "complete",
      signal: null,
      exitCode: 0,
    });
  });

  it("counts wrapper import and parsing time against an explicit deadline", async () => {
    const preflightStarted = join(scratch, "expired-preflight.started");
    const modelStarted = join(scratch, "expired-model.started");
    process.env.FAKE_PREFLIGHT_STARTED_PATH = preflightStarted;
    process.env.FAKE_MODEL_STARTED_PATH = modelStarted;
    const input = { ...options("claude", "expired-at-entry"), timeoutMs: 100 };
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await main(
      runnerArgs(input).slice(1),
      Date.now() - 1_000,
      {
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
      }
    );

    expect(exitCode).toBe(124);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain('"status":"timed-out"');
    expect(existsSync(preflightStarted)).toBe(false);
    expect(existsSync(modelStarted)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "timed-out",
      preflight: { status: "not-run", argv: [] },
    });
  });

  it("spends one explicit deadline across preflight and model execution", async () => {
    process.env.FAKE_PREFLIGHT_DELAY_MS = "3000";
    process.env.FAKE_MODEL_DELAY_MS = "6000";
    const input = { ...options("codex"), timeoutMs: 8_000 };
    const result = await runLane(input);
    const recorded = receipt(input.receiptPath);

    expect(result.exitCode).toBe(124);
    expect(recorded.status).toBe("timed-out");
    expect(recorded.preflight.status).toBe("passed");
    expect(recorded.elapsedMs).toBeLessThan(10_000);
  }, 12_000);

  it("bounds a descendant-held pipe by the explicit deadline without fabricating a signal", async () => {
    const descendantPidPath = join(scratch, "deadline-descendant.pid");
    const input = { ...options("claude", "deadline-drain"), timeoutMs: 4_000 };
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_DESCENDANT_HOLDS_PIPES_MS: "15000",
        FAKE_DESCENDANT_PID_PATH: descendantPidPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    try {
      expect(await exitWithin(runner, 8_000)).toBe(124);
      await Promise.all([stdout, stderr]);
      const recorded = receipt(input.receiptPath);
      expect(recorded).toMatchObject({
        status: "timed-out",
        exitCode: 0,
        signal: null,
        preflight: { status: "not-run" },
      });
      expect(recorded.elapsedMs).toBeLessThan(8_000);
    } finally {
      if (existsSync(descendantPidPath)) {
        const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
        if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
      }
    }
  }, 12_000);

  it("does not claim a signal was sent to an already signal-reaped child", async () => {
    const descendantPidPath = join(scratch, "signalled-descendant.pid");
    const input = { ...options("claude", "signalled-drain"), timeoutMs: 4_000 };
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_DESCENDANT_HOLDS_PIPES_MS: "15000",
        FAKE_DESCENDANT_PID_PATH: descendantPidPath,
        FAKE_SELF_SIGNAL: "SIGTERM",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    try {
      expect(await exitWithin(runner, 8_000)).toBe(124);
      await Promise.all([stdout, stderr]);
      expect(receipt(input.receiptPath)).toMatchObject({
        status: "timed-out",
        exitCode: 143,
        signal: null,
        preflight: { status: "not-run" },
      });
    } finally {
      if (existsSync(descendantPidPath)) {
        const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
        if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
      }
    }
  }, 12_000);

  it("lets manual cancellation end a post-exit pipe drain without a default timeout", async () => {
    const descendantPidPath = join(scratch, "cancel-descendant.pid");
    const modelExiting = join(scratch, "cancel-model.exiting");
    const input = options("claude", "cancel-drain");
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_DESCENDANT_HOLDS_PIPES_MS: "5000",
        FAKE_DESCENDANT_PID_PATH: descendantPidPath,
        FAKE_MODEL_EXITING_PATH: modelExiting,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(modelExiting);
    await waitForExit(Number(readFileSync(modelExiting, "utf8")));
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 2_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      exitCode: 0,
      signal: null,
      preflight: { status: "not-run" },
      error: { message: "launcher received SIGTERM after child exited" },
    });

    const descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
  });

  it("clears a losing long-deadline timer when the shipped wrapper succeeds", async () => {
    const input = { ...options("claude", "long-deadline"), timeoutMs: 60_000 };
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();

    expect(await exitWithin(runner, 3_000)).toBe(0);
    await Promise.all([stdout, stderr]);
    expect(receipt(input.receiptPath).status).toBe("complete");
  });

  it("cancels a preflight with SIGINT and writes a terminal receipt", async () => {
    const input = options("codex", "preflight-cancelled");
    const started = join(scratch, "preflight-child.started");
    const terminated = join(scratch, "preflight-child.terminated");
    const isolatedRunner = join(scratch, "isolated-runner");
    cpSync(import.meta.dir, isolatedRunner, { recursive: true });
    const runner = Bun.spawn([
      process.execPath,
      join(isolatedRunner, "pstack-runner"),
      ...runnerArgs(input).slice(1),
    ], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_CANCEL_STAGE: "preflight",
        FAKE_STARTED_PATH: started,
        FAKE_TERMINATED_PATH: terminated,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    runner.kill("SIGINT");

    expect(await exitWithin(runner, 3_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGINT");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGINT",
      preflight: { status: "cancelled" },
    });
  });

  it("reaps the child and exits after repeated cancellation with a long deadline", async () => {
    const input = { ...options("codex", "repeated-cancel"), timeoutMs: 60_000 };
    const started = join(scratch, "repeated-child.started");
    const terminated = join(scratch, "repeated-child.terminated");
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_CANCEL: "1",
        FAKE_IGNORE_SIGNAL: "1",
        FAKE_STARTED_PATH: started,
        FAKE_TERMINATED_PATH: terminated,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    const childPid = Number(readFileSync(started, "utf8"));
    runner.kill("SIGTERM");
    await Bun.sleep(100);
    runner.kill("SIGTERM");

    expect(await exitWithin(runner, 4_000)).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGTERM");
    expect(processIsAlive(childPid)).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGTERM",
    });
  });

  it("forwards cancellation, preserves its receipt, and permits a new attempt", async () => {
    const input = options("codex", "cancelled");
    const started = join(scratch, "cancelled-child.started");
    const terminated = join(scratch, "cancelled-child.terminated");
    const env = {
      ...process.env,
      FAKE_CANCEL: "1",
      FAKE_STARTED_PATH: started,
      FAKE_TERMINATED_PATH: terminated,
    };
    const runner = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(runner.stdout).text();
    const stderr = new Response(runner.stderr).text();
    await waitFor(started);
    runner.kill("SIGTERM");

    expect(await runner.exited).toBe(130);
    await Promise.all([stdout, stderr]);
    expect(readFileSync(terminated, "utf8")).toBe("SIGTERM");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath)).toMatchObject({
      status: "cancelled",
      signal: "SIGTERM",
      exitCode: 0,
      error: { message: "launcher received SIGTERM; signal was sent to child" },
    });

    const samePaths = Bun.spawn([process.execPath, ...runnerArgs(input)], {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sameStdout = new Response(samePaths.stdout).text();
    const sameStderr = new Response(samePaths.stderr).text();
    expect(await samePaths.exited).toBe(64);
    await Promise.all([sameStdout, sameStderr]);
    expect(receipt(input.receiptPath).status).toBe("cancelled");

    const retry = options("codex", "cancelled-retry");
    const result = await runLane(retry);
    expect(result.exitCode).toBe(0);
    expect(receipt(retry.receiptPath).status).toBe("complete");
  });

  it("reports a missing CLI without fabricating output", async () => {
    process.env.PATH = join(scratch, "empty-bin");
    mkdirSync(process.env.PATH);
    const input = options("grok");
    const result = await runLane(input);
    expect(result.exitCode).toBe(69);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(receipt(input.receiptPath).status).toBe("unavailable-cli");
    expect(
      normalizeReceiptEvent(receipt(input.receiptPath), {
        parent: input.parent,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        mode: input.mode,
        apiSpend: "unset",
      }).status
    ).toBe("route-unavailable");
  });

  it("runs simultaneous same-provider lanes only into their unique paths", async () => {
    const first = options("grok", "first");
    const second = options("grok", "second");
    const results = await Promise.all([runLane(first), runLane(second)]);
    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(first.outputPath).not.toBe(second.outputPath);
    expect(receipt(first.receiptPath).sessionId).toBe("g1");
    expect(receipt(second.receiptPath).sessionId).toBe("g1");
  });

  it("refuses a second writer for an already-reserved path", async () => {
    const input = options("claude");
    writeFileSync(input.outputPath, "owned");
    await expect(runLane(input)).rejects.toThrow();
    expect(readFileSync(input.outputPath, "utf8")).toBe("owned");
    expect(existsSync(input.receiptPath)).toBe(false);
  });

  it("terminalizes catchable failures after reserving output paths", async () => {
    const unreadable = options("claude", "unreadable-prompt");
    chmodSync(unreadable.promptPath, 0o000);
    const unreadableRunner = Bun.spawn([process.execPath, ...runnerArgs(unreadable)], {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const unreadableStdout = new Response(unreadableRunner.stdout).text();
    const unreadableStderr = new Response(unreadableRunner.stderr).text();
    expect(await unreadableRunner.exited).toBe(70);
    await Promise.all([unreadableStdout, unreadableStderr]);
    chmodSync(unreadable.promptPath, 0o600);

    const preservedReceipt = readFileSync(unreadable.receiptPath, "utf8");
    expect(statSync(unreadable.receiptPath).size).toBeGreaterThan(0);
    expect(existsSync(unreadable.outputPath)).toBe(false);
    expect(receipt(unreadable.receiptPath)).toMatchObject({
      status: "child-failed",
      preflight: { status: "not-run" },
      error: { message: "launcher failed after reserving output paths" },
    });

    const samePaths = Bun.spawn([process.execPath, ...runnerArgs(unreadable)], {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const sameStdout = new Response(samePaths.stdout).text();
    const sameStderr = new Response(samePaths.stderr).text();
    expect(await samePaths.exited).toBe(64);
    await Promise.all([sameStdout, sameStderr]);
    expect(readFileSync(unreadable.receiptPath, "utf8")).toBe(preservedReceipt);

    const spawnFailure = options("codex", "spawn-failure");
    const modelStarted = join(scratch, "spawn-failure-model.started");
    const spawnRunner = Bun.spawn([process.execPath, ...runnerArgs(spawnFailure)], {
      cwd: scratch,
      env: {
        ...process.env,
        FAKE_REMOVE_EXECUTABLE_AFTER_PREFLIGHT: "1",
        FAKE_MODEL_STARTED_PATH: modelStarted,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const spawnStdout = new Response(spawnRunner.stdout).text();
    const spawnStderr = new Response(spawnRunner.stderr).text();
    expect(await spawnRunner.exited).toBe(70);
    await Promise.all([spawnStdout, spawnStderr]);
    expect(existsSync(modelStarted)).toBe(false);
    expect(existsSync(spawnFailure.outputPath)).toBe(false);
    expect(receipt(spawnFailure.receiptPath)).toMatchObject({
      status: "child-failed",
      preflight: { status: "passed" },
    });

    makeExecutable("claude");
    const retry = options("claude", "post-reservation-retry");
    expect((await runLane(retry)).exitCode).toBe(0);
    expect(receipt(retry.receiptPath).status).toBe("complete");
  });

  it("rejects same-provider recursion", async () => {
    const input = { ...options("claude"), parent: "claude" as const };
    await expect(runLane(input)).rejects.toThrow("native to parent");
  });

  it("rejects versioned Claude families before they can stay pinned", async () => {
    for (const [model, alias] of [
      ["claude-fable-9-9", "fable"],
      ["claude-opus-9", "opus"],
      ["claude-sonnet-9-9", "sonnet"],
    ] as const) {
      const input = { ...options("claude", `versioned-${alias}`), model };
      await expect(runLane(input)).rejects.toThrow(
        `normalize it to ${alias} before invoking the runner`
      );
      expect(existsSync(input.outputPath)).toBe(false);
      expect(existsSync(input.receiptPath)).toBe(false);
    }
  });
});

describe("backend-recovery receipt evidence", () => {
  it("records the explicit deadline on every receipt", async () => {
    const plain = options("claude", "no-deadline");
    expect((await runLane(plain)).exitCode).toBe(0);
    expect(receipt(plain.receiptPath).timeoutMs).toBeNull();

    process.env.FAKE_TIMEOUT = "1";
    const bounded = { ...options("claude", "with-deadline"), timeoutMs: 500 };
    const result = await runLane(bounded);
    expect(result.receipt.status).toBe("timed-out");
    expect(result.receipt.timeoutMs).toBe(500);
    expect(
      normalizeReceiptEvent(result.receipt, {
        parent: bounded.parent,
        provider: bounded.provider,
        model: bounded.model,
        effort: bounded.effort,
        mode: bounded.mode,
        apiSpend: "unset",
      }).status
    ).toBe("deadline-exceeded");
  });

  it("maps a generic 429 child failure to terminal-failure, never quota", async () => {
    process.env.FAKE_GENERIC_429 = "1";
    const input = options("claude", "generic-429");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.terminalSuccess).toBe(false);
    const event = normalizeReceiptEvent(result.receipt, {
      parent: input.parent,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      mode: input.mode,
      apiSpend: "unset",
    });
    expect(event.status).toBe("terminal-failure");
  });

  it("keeps generated stdout auth prose plus a generic terminal failure as child-failed", async () => {
    process.env.FAKE_CODEX_AGENT_MESSAGE =
      "authentication required for the app under test";
    process.env.FAKE_CODEX_TURN_FAILED = "generic backend error";
    process.env.FAKE_CODEX_TURN_FAILED_EXIT = "1";
    const input = options("codex", "generated-auth-prose");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.failurePhase).toBe("invocation");
    expect(result.receipt.processStarted).toBe(true);
    expect(result.receipt.terminalSuccess).toBe(false);
    expect(result.receipt.error?.evidence).toContain(
      "authentication required for the app under test"
    );
    const event = normalizeReceiptEvent(result.receipt, {
      parent: input.parent,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      mode: input.mode,
      apiSpend: "unset",
    });
    expect(event.status).toBe("terminal-failure");
    const attempts = [
      { descriptor: "codex:gpt-5.6-sol@max", attempt: { kind: "descriptor", provider: "codex", model: "gpt-5.6-sol", effort: "max" }, exhaustionGroup: "codex", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
      { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
    ] as const;
    const events = [{ attemptIndex: 0, status: event.status, processStarted: event.processStarted }];
    expect(
      nextAttempt(
        { id: "how explorer#1", fallback: { on: ["route-unavailable"] }, attempts: [...attempts] },
        events,
        new Set(),
        "read-only"
      )
    ).toMatchObject({ kind: "stop", reason: "not-eligible" });
    expect(
      nextAttempt(
        { id: "how explorer#1", fallback: { on: ["route-unavailable", "terminal-failure"] }, attempts: [...attempts] },
        events,
        new Set(),
        "read-only"
      )
    ).toMatchObject({ kind: "launch", attemptIndex: 1 });
  });

  it("never classifies quoted or logged stderr auth and model wording as a route failure", async () => {
    for (const [index, line] of [
      'Error: invocation failed; upstream log ended with "unauthenticated: invalid api key"',
      'Error: backend rejected the request; log said "model not supported"',
      "Error: authentication required for the app under test",
    ].entries()) {
      process.env.FAKE_DEVIN_STDERR = line;
      const input = { ...options("devin", `devin-quoted-${index}`), model: "swe-2", effort: "high" as const };
      const result = await runLane(input);
      expect(result.receipt.status, line).toBe("child-failed");
      expect(result.receipt.failurePhase, line).toBe("invocation");
      const event = normalizeReceiptEvent(result.receipt, {
        parent: input.parent,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        mode: input.mode,
        apiSpend: "unset",
      });
      expect(event.status, line).toBe("terminal-failure");
      expect(
        nextAttempt(
          {
            id: "how explorer#1",
            fallback: { on: ["route-unavailable"] },
            attempts: [
              { descriptor: "devin:swe-2@high", attempt: { kind: "descriptor", provider: "devin", model: "swe-2", effort: "high" }, exhaustionGroup: "devin", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
              { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
            ],
          },
          [{ attemptIndex: 0, status: event.status, processStarted: event.processStarted }],
          new Set(),
          "read-only"
        ),
        line
      ).toMatchObject({ kind: "stop", reason: "not-eligible" });
    }
  });

  it("never advances a broad chain on a successful final result with a nonzero exit", async () => {
    process.env.FAKE_MODEL_EXIT = "1";
    const input = options("codex", "conflicted-success");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.terminalSuccess).toBe(true);
    const event = normalizeReceiptEvent(result.receipt, {
      parent: input.parent,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      mode: input.mode,
      apiSpend: "unset",
    });
    expect(event.status).toBe("failed");
    const broadLane: LanePolicy = {
      id: "how explorer#1",
      fallback: { on: ["usage-exhausted", "route-unavailable", "terminal-failure", "deadline-exceeded"] },
      attempts: [
        { descriptor: "codex:gpt-5.6-sol@max", attempt: { kind: "descriptor", provider: "codex", model: "gpt-5.6-sol", effort: "max" }, exhaustionGroup: "codex", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
        { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
      ],
    };
    expect(
      nextAttempt(broadLane, [{ attemptIndex: 0, status: event.status }], new Set(), "read-only")
    ).toMatchObject({ kind: "stop", reason: "not-eligible" });
  });

  it("normalizes a launcher-programming failure as ineligible, not a backend failure", async () => {
    const unreadable = options("claude", "normalize-launcher-failure");
    chmodSync(unreadable.promptPath, 0o000);
    const launcher = Bun.spawn([process.execPath, ...runnerArgs(unreadable)], {
      cwd: scratch,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([
      new Response(launcher.stdout).text(),
      new Response(launcher.stderr).text(),
    ]);
    expect(await launcher.exited).toBe(70);
    chmodSync(unreadable.promptPath, 0o600);
    const event = normalizeReceiptEvent(receipt(unreadable.receiptPath), {
      parent: unreadable.parent,
      provider: unreadable.provider,
      model: unreadable.model,
      effort: unreadable.effort,
      mode: unreadable.mode,
      apiSpend: "unset",
    });
    expect(event.status).toBe("failed");
  });
});

describe("childEnvironment", () => {
  it("removes only inherited runtime identity needed to avoid nested detection", () => {
    const source = {
      PATH: "/bin",
      CODEX_THREAD_ID: "codex",
      CODEX_CI: "1",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      KEEP_ME: "yes",
    };
    expect(childEnvironment("claude", source)).toEqual({
      PATH: "/bin",
      CLAUDECODE: "1",
      CLAUDE_CODE_CHILD_SESSION: "1",
      KEEP_ME: "yes",
    });
    expect(childEnvironment("codex", source)).toEqual({
      PATH: "/bin",
      CODEX_THREAD_ID: "codex",
      CODEX_CI: "1",
      KEEP_ME: "yes",
    });
    expect(childEnvironment("grok", source)).toEqual({
      PATH: "/bin",
      KEEP_ME: "yes",
    });
  });
});

describe("usage exhaustion and billing guard", () => {
  const codexQuotaMessage =
    "You\u2019ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.";

  it("does not treat a model-shaped quota envelope from auth preflight as exhaustion", async () => {
    process.env.FAKE_CODEX_LOGIN_STATUS = JSON.stringify({ type: "turn.failed", error: { message: codexQuotaMessage } });
    const input = options("codex", "preflight-quota-envelope");
    const result = await runLane(input);
    expect(result.receipt.status).not.toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("preflight");
    expect(result.receipt.processStarted).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("classifies the canonical codex terminal quota diagnostic on a nonzero exit", async () => {
    process.env.FAKE_CODEX_TURN_FAILED = codexQuotaMessage;
    process.env.FAKE_CODEX_TURN_FAILED_EXIT = "1";
    const input = options("codex", "quota-nonzero");
    const result = await runLane(input);
    expect(result.exitCode).toBe(75);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("invocation");
    expect(result.receipt.processStarted).toBe(true);
    expect(result.receipt.terminalSuccess).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
    expect(
      normalizeReceiptEvent(result.receipt, {
        parent: input.parent,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        mode: input.mode,
        apiSpend: "unset",
      }).status
    ).toBe("usage-exhausted");
  });

  it("classifies a zero-exit codex turn.failed quota event", async () => {
    process.env.FAKE_CODEX_TURN_FAILED = codexQuotaMessage;
    const input = options("codex", "quota-result");
    const result = await runLane(input);
    expect(result.exitCode).toBe(75);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("postprocess");
    expect(result.receipt.processStarted).toBe(true);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("keeps a codex terminal failure without a quota diagnostic as an ordinary failure", async () => {
    process.env.FAKE_CODEX_TURN_FAILED = "rate limit exceeded: 429 Too Many Requests";
    const input = options("codex", "quota-nonquota");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.failurePhase).toBe("postprocess");
  });

  it("does not reclassify a recovered codex stream that ends in turn.completed", async () => {
    process.env.FAKE_CODEX_RECOVERED_ERROR = "1";
    const input = options("codex", "quota-recovered");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("complete");
    expect(existsSync(input.outputPath)).toBe(true);
  });

  it("classifies the canonical grok free-usage terminal result", async () => {
    process.env.FAKE_GROK_FREE_USAGE = "1";
    const input = options("grok", "quota-grok");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("postprocess");

    process.env.FAKE_GROK_FREE_USAGE_EXIT = "1";
    const nonzero = options("grok", "quota-grok-nonzero");
    const nonzeroResult = await runLane(nonzero);
    expect(nonzeroResult.receipt.status).toBe("usage-exhausted");
    expect(nonzeroResult.receipt.failurePhase).toBe("invocation");
  });

  it("reproduces the captured Claude quota envelope as usage-exhausted exit 75", async () => {
    process.env.FAKE_CLAUDE_API_ERROR = "1";
    const input = options("claude", "claude-quota-real");
    const result = await runLane(input);
    expect(result.exitCode).toBe(75);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("invocation");
    expect(result.receipt.processStarted).toBe(true);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("classifies the same Claude envelope at zero exit through postprocess", async () => {
    process.env.FAKE_CLAUDE_API_ERROR = "1";
    process.env.FAKE_CLAUDE_API_ERROR_EXIT = "0";
    const input = options("claude", "claude-quota-zero-exit");
    const result = await runLane(input);
    expect(result.exitCode).toBe(75);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("postprocess");
    expect(result.receipt.processStarted).toBe(true);
  });

  it("keeps a Claude api_error without a canonical quota diagnostic as an ordinary failure", async () => {
    process.env.FAKE_CLAUDE_API_ERROR = "1";
    process.env.FAKE_CLAUDE_RESULT_TEXT = "Request rejected (429) \u00b7 slow down";
    const input = options("claude", "claude-429-nonquota");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.failurePhase).toBe("invocation");

    process.env.FAKE_CLAUDE_API_ERROR_STATUS = "500";
    const other = options("claude", "claude-500");
    const otherResult = await runLane(other);
    expect(otherResult.receipt.status).toBe("child-failed");
  });

  it("classifies the source-derived Devin quota stderr contract on a nonzero exit", async () => {
    process.env.FAKE_DEVIN_STDERR =
      "Error: Quota exhausted: You've reached your monthly usage limit. Wait for the limit to reset next month.";
    const input = { ...options("devin", "devin-quota"), model: "swe-2", effort: "high" as const };
    const result = await runLane(input);
    expect(result.exitCode).toBe(75);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("invocation");
    expect(result.receipt.processStarted).toBe(true);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("keeps Devin rate-limit, auth, and admin-pause stderr as ordinary failures", async () => {
    for (const [index, line] of [
      "Error: Rate limited: retry after 30 seconds",
      "Error: Authentication required: Sign in again to continue",
      "Error: An admin paused usage on your account. Ask them to resume it to continue.",
      "Error: Authentication required: usage quota has been exhausted",
      "Error: Rate limited: Quota exhausted: temporary burst",
      "Error: upstream call failed: usage quota has been exhausted",
      "Error: Rate limited: retry later\nError: Quota exhausted: usage quota has been exhausted",
    ].entries()) {
      process.env.FAKE_DEVIN_STDERR = line;
      const input = { ...options("devin", `devin-nonquota-${index}`), model: "swe-2", effort: "high" as const };
      const result = await runLane(input);
      expect(result.receipt.status, line).toBe("child-failed");
      expect(result.receipt.failurePhase, line).toBe("invocation");
    }
  });

  it("classifies the source-derived Cursor quota stderr contract on a nonzero exit", async () => {
    process.env.FAKE_CURSOR_STDERR =
      "ActionRequiredError: You've hit your usage limit for Opus. Upgrade your plan or wait for your limit to reset.";
    const input = { ...options("cursor", "cursor-quota"), model: "composer-2.5", effort: "default" as const };
    const result = await runLane(input);
    expect(result.exitCode).toBe(75);
    expect(result.receipt.status).toBe("usage-exhausted");
    expect(result.receipt.failurePhase).toBe("invocation");
    expect(result.receipt.processStarted).toBe(true);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("keeps non-quota and contradictory Cursor stderr as ordinary failures", async () => {
    for (const [index, line] of [
      "ActionRequiredError: Upgrade to Pro to use this model",
      "ActionRequiredError: login required\nActionRequiredError: You've hit your usage limit for Opus",
      "ActionRequiredError: You've hit your usage limitless plan",
    ].entries()) {
      process.env.FAKE_CURSOR_STDERR = line;
      const input = { ...options("cursor", `cursor-nonquota-${index}`), model: "composer-2.5", effort: "default" as const };
      const result = await runLane(input);
      expect(result.receipt.status, line).toBe("child-failed");
      expect(result.receipt.failurePhase, line).toBe("invocation");
    }
  });

  it("fails an unimplemented provider before launching instead of silently disabling fallback", async () => {
    const input = {
      ...options("claude", "unimplemented-provider"),
      provider: "newprovider" as Provider,
    };
    await expect(runLane(input)).rejects.toThrow("no quota adapter implemented");
    expect(existsSync(input.outputPath)).toBe(false);
    expect(existsSync(input.receiptPath)).toBe(false);
  });

  it("blocks unverifiable Grok subscription routing before starting a model", async () => {
    const started = join(scratch, "grok-billing-model-started");
    process.env.FAKE_MODEL_STARTED_PATH = started;
    const result = await runLane({ ...options("grok", "grok-deny-unknown-auth"), apiSpend: "deny" });
    expect(result.receipt.status).toBe("billing-policy-blocked");
    expect(result.receipt.processStarted).toBe(false);
    expect(existsSync(started)).toBe(false);
  });

  it("keeps an unsubstantiated structured error envelope as an ordinary failure", async () => {
    process.env.FAKE_QUOTA_STDERR = "1";
    const nonzero = options("claude", "quota-nonzero-unsubstantiated");
    const nonzeroResult = await runLane(nonzero);
    expect(nonzeroResult.receipt.status).toBe("child-failed");
    delete process.env.FAKE_QUOTA_STDERR;
    process.env.FAKE_QUOTA_RESULT = "1";
    const zeroExit = options("claude", "quota-result-unsubstantiated");
    const zeroExitResult = await runLane(zeroExit);
    expect(zeroExitResult.receipt.status).toBe("child-failed");
    expect(zeroExitResult.receipt.failurePhase).toBe("postprocess");
  });

  it("never treats quota words in successful model text as exhaustion", async () => {
    process.env.FAKE_QUOTA_TEXT = "1";
    const input = options("claude", "quota-words");
    const result = await runLane(input);
    expect(result.exitCode).toBe(0);
    expect(result.receipt.status).toBe("complete");
    expect(readFileSync(input.outputPath, "utf8")).toContain("quota");
  });

  it("never treats quota words in plain stderr text as exhaustion", async () => {
    process.env.FAKE_QUOTA_WORDS_STDERR = "1";
    const input = options("claude", "quota-plain");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.exitCode).toBe(70);
  });

  it("keeps a generic 429 as an ordinary child failure", async () => {
    process.env.FAKE_GENERIC_429 = "1";
    const input = options("claude", "generic-429");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("child-failed");
    expect(result.receipt.failurePhase).toBe("invocation");
  });

  it("records the legacy apiSpend policy when the flag is omitted", async () => {
    const input = options("codex", "legacy-spend");
    const result = await runLane(input);
    expect(result.receipt.apiSpend).toBe("legacy");
  });

  it("starts only the Claude task and leaves its network available", async () => {
    const requests: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      requests.push(new URL(request.url).pathname);
      return new Response("fixture");
    } });
    process.env.FAKE_NETWORK_TEST_URL = `http://127.0.0.1:${server.port}`;
    process.env.FAKE_NETWORK_LOG_PATH = join(scratch, "network.log");
    try {
      const input = { ...options("claude", "offline-preflight"), apiSpend: "deny" as const };
      const result = await runLane(input);
      expect(result.receipt.status).toBe("complete");
      expect(requests).toEqual(["/model"]);
      expect(readFileSync(process.env.FAKE_NETWORK_LOG_PATH, "utf8")).toBe("model:true\n");
      expect(result.receipt.preflight).toEqual({
        argv: [], status: "not-run",
        evidence: "authentication deferred to invocation; billing route unverified",
      });
      expect(result.receipt.argv[0]).toBe(join(bin, "claude"));
    } finally {
      await server.stop(true);
    }
  });

  it.skipIf(process.platform !== "darwin")("runs Claude inside an existing macOS sandbox without nesting another", async () => {
    const input = options("claude", "nested-preflight");
    const modelStarted = join(scratch, "model-started");
    const child = Bun.spawn([
      "/usr/bin/sandbox-exec", "-p", "(version 1)(allow default)",
      process.execPath, ...runnerArgs(input),
    ], { env: { ...process.env, FAKE_MODEL_STARTED_PATH: modelStarted }, stdout: "pipe", stderr: "pipe" });
    const [exitCode] = await Promise.all([exitWithin(child, 5000), new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exitCode).toBe(0);
    const result = receipt(input.receiptPath);
    expect(result.status).toBe("complete");
    expect(result.processStarted).toBe(true);
    expect(result.preflight.argv).toEqual([]);
    expect(existsSync(modelStarted)).toBe(true);
  });

  it("blocks a known ambient API credential under subscription-only policy before any process", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fixture";
    process.env.FAKE_PREFLIGHT_STARTED_PATH = join(scratch, "preflight-started");
    process.env.FAKE_MODEL_STARTED_PATH = join(scratch, "model-started");
    const input = { ...options("claude", "deny-key"), apiSpend: "deny" as const };
    const result = await runLane(input);
    expect(result.exitCode).toBe(78);
    expect(result.receipt.status).toBe("billing-policy-blocked");
    expect(result.receipt.failurePhase).toBe("preflight");
    expect(result.receipt.processStarted).toBe(false);
    expect(result.receipt.apiSpend).toBe("deny");
    expect(result.receipt.error?.message).toContain("ANTHROPIC_API_KEY");
    expect(result.receipt.error?.message).not.toContain("sk-ant-test-fixture");
    expect(existsSync(join(scratch, "preflight-started"))).toBe(false);
    expect(existsSync(join(scratch, "model-started"))).toBe(false);
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("blocks a second provider's ambient API credential under deny", async () => {
    process.env.XAI_API_KEY = "xai-test-fixture";
    const input = { ...options("grok", "deny-xai"), apiSpend: "deny" as const };
    const result = await runLane(input);
    expect(result.receipt.status).toBe("billing-policy-blocked");
    expect(result.receipt.processStarted).toBe(false);
  });

  it("blocks known Claude alternate-auth and routing controls under deny", async () => {
    for (const [index, name] of [
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_AWS_API_KEY",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "ANTHROPIC_BASE_URL",
    ].entries()) {
      process.env[name] = "1";
      const input = { ...options("claude", `deny-claude-route-${index}`), apiSpend: "deny" as const };
      const result = await runLane(input);
      expect(result.receipt.status, name).toBe("billing-policy-blocked");
      expect(result.receipt.processStarted).toBe(false);
      delete process.env[name];
    }
  });

  it("reports Claude authentication errors from invocation without claiming an auth preflight", async () => {
    process.env.FAKE_CLAUDE_API_ERROR = "1";
    process.env.FAKE_CLAUDE_API_ERROR_STATUS = "401";
    process.env.FAKE_CLAUDE_RESULT_TEXT = "Not logged in. Please run /login";
    const input = { ...options("claude", "claude-auth-error"), apiSpend: "deny" as const };
    const result = await runLane(input);
    expect(result.receipt).toMatchObject({
      status: "child-failed", failurePhase: "invocation", processStarted: true,
      preflight: { status: "not-run", argv: [] },
    });
    expect(result.receipt.error?.evidence).toContain("Please run /login");
    expect(existsSync(input.outputPath)).toBe(false);
  });

  it("requires ChatGPT auth for codex under deny", async () => {
    const input = { ...options("codex", "deny-codex-chatgpt"), apiSpend: "deny" as const };
    expect((await runLane(input)).receipt.status).toBe("complete");

    process.env.FAKE_CODEX_LOGIN_STATUS = "Logged in using an API key";
    const blocked = { ...options("codex", "deny-codex-apikey"), apiSpend: "deny" as const };
    const result = await runLane(blocked);
    expect(result.receipt.status).toBe("billing-policy-blocked");
    expect(result.receipt.processStarted).toBe(false);
    delete process.env.FAKE_CODEX_LOGIN_STATUS;

    const approved = { ...options("codex", "approved-codex-apikey"), apiSpend: "approved" as const };
    process.env.FAKE_CODEX_LOGIN_STATUS = "Logged in using an API key";
    expect((await runLane(approved)).receipt.status).toBe("complete");
    delete process.env.FAKE_CODEX_LOGIN_STATUS;
  });

  it("permits the same lane with an explicit approved policy and records it", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fixture";
    const input = { ...options("claude", "approved-key"), apiSpend: "approved" as const };
    const result = await runLane(input);
    expect(result.receipt.status).toBe("complete");
    expect(result.receipt.apiSpend).toBe("approved");
  });

  it("keeps the legacy route when an ambient key is present without the flag", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-fixture";
    const input = options("claude", "legacy-key");
    const result = await runLane(input);
    expect(result.receipt.status).toBe("complete");
    expect(result.receipt.apiSpend).toBe("legacy");
  });
});
