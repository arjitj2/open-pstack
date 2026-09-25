import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { type Effort, type NormalizedUsage, type ParsedOutput, type RunnerOptions, UsageError } from "./types.ts";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function validateOpenCodeModel(model: string, effort: Effort): void {
  if (effort !== "default") throw new UsageError("OpenCode requires default effort; unverified variants can silently use defaults");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)+$/.test(model) || model.split("/").some(part => part.toLowerCase() === "auto")) {
    throw new UsageError("OpenCode requires an exact provider/model ID from opencode models");
  }
}

export function openCodeDirectory(options: RunnerOptions): string {
  return `${options.receiptPath}.opencode-config`;
}
export function openCodeAgent(options: RunnerOptions): string {
  return `pstack-${createHash("sha256").update(options.receiptPath).digest("hex").slice(0, 24)}`;
}
function toolOutputGlob(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "tool-output", "*");
}
interface PermissionRule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: "allow" | "deny";
}
function permissions(options: RunnerOptions, env: NodeJS.ProcessEnv): readonly PermissionRule[] {
  return [
    { permission: "*", pattern: "*", action: "deny" },
    ...["read", "glob", "grep"].map(permission => ({ permission, pattern: "*", action: "allow" as const })),
    ...(options.mode === "isolated-write" ? [{ permission: "edit", pattern: "*", action: "allow" as const }] : []),
    { permission: "external_directory", pattern: "*", action: "deny" },
    { permission: "external_directory", pattern: toolOutputGlob(env), action: "deny" },
  ];
}

export function openCodeConfig(options: RunnerOptions, env: NodeJS.ProcessEnv = process.env): object {
  if (options.mode === "isolated-write") {
    let root: string;
    try { root = execFileSync("git", ["-C", options.cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { throw new UsageError("OpenCode isolated-write requires a Git worktree root"); }
    if (realpathSync(root) !== realpathSync(options.cwd)) throw new UsageError("OpenCode isolated-write cwd must be the Git worktree root");
  }
  const permission: Record<string, Record<string, string>> = {};
  for (const rule of permissions(options, env)) (permission[rule.permission] ??= {})[rule.pattern] = rule.action;
  return {
    model: options.model, small_model: options.model,
    default_agent: openCodeAgent(options), share: "disabled", autoupdate: false,
    lsp: false, formatter: false, compaction: { auto: false, prune: false },
    agent: { [openCodeAgent(options)]: { mode: "primary", model: options.model, permission } },
  };
}

export function openCodeEnvironment(options: RunnerOptions, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...inherited };
  for (const key of Object.keys(env)) if (key.startsWith("OPENCODE_")) delete env[key];
  return {
    ...env,
    XDG_CONFIG_HOME: join(openCodeDirectory(options), "xdg"),
    OPENCODE_TEST_HOME: join(openCodeDirectory(options), "home"),
    OPENCODE_CONFIG: join(openCodeDirectory(options), "opencode.json"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
  };
}

export function openCodePreflightPassed(stdout: string, options: RunnerOptions, env: NodeJS.ProcessEnv): boolean {
  let config: JsonObject | null;
  try { config = object(JSON.parse(stdout)); } catch { return false; }
  if (config === null || config.model !== options.model || config.small_model !== options.model ||
      config.default_agent !== openCodeAgent(options) || config.share !== "disabled" ||
      config.autoupdate !== false || config.lsp !== false || config.formatter !== false ||
      object(config.compaction)?.auto !== false) return false;
  if (config.provider !== undefined && Object.keys(object(config.provider) ?? { invalid: true }).length !== 0) return false;
  if (config.mcp !== undefined) {
    const mcp = object(config.mcp);
    if (mcp === null || Object.values(mcp).some(value => object(value)?.enabled !== false)) return false;
  }
  const agent = object(object(config.agent)?.[openCodeAgent(options)]);
  if (agent === null || agent.mode !== "primary" || agent.model !== options.model ||
      Object.keys(agent).some(key => !["mode", "model", "permission", "options"].includes(key)) ||
      (agent.options !== undefined && Object.keys(object(agent.options) ?? { invalid: true }).length !== 0)) return false;
  const expected: Record<string, Record<string, string>> = {};
  for (const rule of permissions(options, env)) (expected[rule.permission] ??= {})[rule.pattern] = rule.action;
  return JSON.stringify(agent.permission) === JSON.stringify(expected);
}

export type OpenCodeTranscript =
  | { readonly kind: "complete"; readonly output: ParsedOutput }
  | { readonly kind: "error"; readonly envelope: JsonObject }
  | { readonly kind: "incomplete"; readonly reason: string };

interface Message {
  readonly text: Map<string, string>;
  readonly finishes: Map<string, JsonObject>;
  tools: boolean;
  startId: string | null;
  reason: string | null;
}

export function parseOpenCodeTranscript(stdout: string): OpenCodeTranscript {
  const incomplete = (reason: string): OpenCodeTranscript => ({ kind: "incomplete", reason });
  const messages = new Map<string, Message>();
  let sessionId: string | null = null;
  let currentId: string | null = null;
  let terminalError: JsonObject | null = null;
  let lastEventType: string | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: JsonObject | null;
    try { event = object(JSON.parse(line)); } catch { return incomplete("OpenCode emitted non-JSON output"); }
    if (event === null) return incomplete("OpenCode emitted a non-object event");
    lastEventType = string(event.type);
    const session = string(event.sessionID);
    if (session === null || (sessionId !== null && sessionId !== session)) return incomplete("OpenCode emitted missing or mixed sessions");
    sessionId = session;
    if (event.type === "error") { terminalError = event; continue; }
    if (terminalError !== null) return { kind: "error", envelope: terminalError };
    if (!["step_start", "step_finish", "text", "tool_use", "reasoning"].includes(String(event.type))) return incomplete("OpenCode emitted an unsupported event");
    const part = object(event.part);
    const id = string(part?.id);
    const messageID = string(part?.messageID);
    if (part === null || id === null || messageID === null || part.sessionID !== sessionId) return incomplete("OpenCode emitted an invalid part identity");
    if (currentId !== messageID) {
      if (messages.has(messageID)) return incomplete("OpenCode returned to an earlier message");
      currentId = messageID;
      messages.set(messageID, { text: new Map(), finishes: new Map(), tools: false, startId: null, reason: null });
    }
    const message = messages.get(messageID)!;
    if (event.type === "step_start") {
      if (message.startId !== null && message.startId !== id) return incomplete("OpenCode emitted multiple steps in one message");
      if (message.startId === null) {
        message.startId = id;
        message.reason = null;
      }
    } else if (event.type === "text") {
      if (typeof part.text !== "string") return incomplete("OpenCode text part has no text");
      message.text.set(id, part.text);
    } else if (event.type === "tool_use") {
      message.tools = true;
    } else if (event.type === "step_finish") {
      message.reason = string(part.reason);
      message.finishes.set(id, part);
    }
  }
  if (terminalError !== null) return { kind: "error", envelope: terminalError };
  const final = currentId === null ? undefined : messages.get(currentId);
  const text = final === undefined ? "" : [...final.text.values()].join("\n").trim();
  if (final === undefined || final.startId === null || lastEventType !== "step_finish" || final.reason !== "stop" || final.tools || text.length === 0) return incomplete("OpenCode did not end with final text and a tool-free stop");
  const usage: Record<string, number> = {};
  let cost: number | null = null;
  for (const message of messages.values()) for (const part of message.finishes.values()) {
    const tokens = object(part.tokens);
    const cache = object(tokens?.cache);
    const fields = { inputTokens: tokens?.input, outputTokens: tokens?.output, reasoningTokens: tokens?.reasoning, totalTokens: tokens?.total, cachedInputTokens: cache?.read, cacheCreationInputTokens: cache?.write };
    for (const [key, value] of Object.entries(fields)) if (typeof value === "number" && Number.isFinite(value) && value >= 0) usage[key] = (usage[key] ?? 0) + value;
    if (typeof part.cost === "number" && Number.isFinite(part.cost) && part.cost >= 0) cost = (cost ?? 0) + part.cost;
  }
  return { kind: "complete", output: { text, sessionId, reportedModel: null, usage: Object.keys(usage).length === 0 ? null : usage as NormalizedUsage, costUsd: cost } };
}
