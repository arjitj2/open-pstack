import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { type Effort, type NormalizedUsage, type ParsedOutput, type RunnerOptions, UsageError } from "./types.ts";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export const OPENCODE_TESTED_VERSION = "2.0.26";
export const OPENCODE_PUBLIC_FREE_MODEL = "opencode/nemotron-3-ultra-free";

export function openCodeVersionError(stdout: string): string | null {
  return stdout.trim() === `opencode v${OPENCODE_TESTED_VERSION}` ? null
    : `Cannot verify OpenCode's tested V2 contract. Install OpenCode ${OPENCODE_TESTED_VERSION} and check opencode --version.`;
}

export function validateOpenCodeModel(model: string, effort: Effort): void {
  if (effort !== "default") throw new UsageError("OpenCode requires default effort; unverified variants can silently use defaults");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)+$/.test(model) || model.split("/").some(part => part.toLowerCase() === "auto")) {
    throw new UsageError("OpenCode requires an exact native provider/model ID");
  }
}

export type OpenCodeFunding =
  | { readonly kind: "native-auth"; readonly apiSpend: "approved" }
  | { readonly kind: "public-free"; readonly apiSpend: "deny"; readonly model: typeof OPENCODE_PUBLIC_FREE_MODEL };

export function openCodeFunding(options: RunnerOptions): OpenCodeFunding | null {
  if (options.opencodePublicFree) {
    if (options.provider !== "opencode" || options.apiSpend !== "deny" || options.model !== OPENCODE_PUBLIC_FREE_MODEL) {
      throw new UsageError(`--opencode-public-free requires provider opencode, --api-spend deny, and exact model ${OPENCODE_PUBLIC_FREE_MODEL}`);
    }
    return { kind: "public-free", apiSpend: "deny", model: OPENCODE_PUBLIC_FREE_MODEL };
  }
  return options.provider === "opencode" && options.apiSpend === "approved" ? { kind: "native-auth", apiSpend: "approved" } : null;
}

export function openCodeDirectory(options: RunnerOptions): string {
  return `${options.receiptPath}.opencode-config`;
}
export function openCodeConfigDirectory(options: RunnerOptions): string {
  return join(openCodeDirectory(options), "config");
}
export function openCodeAgent(options: RunnerOptions): string {
  return `pstack-${createHash("sha256").update(options.receiptPath).digest("hex").slice(0, 24)}`;
}
interface PermissionRule {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny";
}
function permissions(options: RunnerOptions, env: NodeJS.ProcessEnv): readonly PermissionRule[] {
  const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return [
    { action: "*", resource: "*", effect: "deny" },
    ...["read", "glob", "grep"].map(action => ({ action, resource: "*", effect: "allow" as const })),
    ...(options.mode === "isolated-write" ? [
      { action: "edit", resource: "*", effect: "allow" as const },
      ...[".git", ".git/*", "*/.git", "*/.git/*", join(options.cwd, ".git"), join(options.cwd, ".git", "*")].map(resource => ({ action: "edit", resource, effect: "deny" as const })),
    ] : []),
    { action: "external_directory", resource: "*", effect: "deny" },
    { action: "external_directory", resource: join(data, "opencode", "tool-output", "*"), effect: "deny" },
  ];
}

export function openCodeConfig(options: RunnerOptions, env: NodeJS.ProcessEnv = process.env) {
  if (options.mode === "isolated-write") {
    let root: string;
    try { root = execFileSync("git", ["-C", options.cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
    catch { throw new UsageError("OpenCode isolated-write requires a Git worktree root"); }
    if (realpathSync(root) !== realpathSync(options.cwd)) throw new UsageError("OpenCode isolated-write cwd must be the Git worktree root");
  }
  const separator = options.model.indexOf("/");
  const model = { providerID: options.model.slice(0, separator), model: options.model.slice(separator + 1) };
  return {
    model, default_agent: openCodeAgent(options), share: "disabled", update: "disable",
    snapshots: false, lsp: false, formatter: false, compaction: { auto: false }, warming: false,
    plugins: ["-*", "opencode.models.dev", openCodeFunding(options)?.kind === "public-free" ? "opencode.provider.opencode" : "opencode.provider.*",
      "opencode.config.agent", "opencode.config.compaction", "opencode.config.formatter", "opencode.config.snapshot",
      ...["read", "glob", "grep", ...(options.mode === "isolated-write" ? ["edit", "write"] : [])].map(tool => `opencode.tool.${tool}`)],
    agents: { [openCodeAgent(options)]: { mode: "primary", model, permissions: permissions(options, env) } },
  };
}

export function openCodeEnvironment(options: RunnerOptions, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const anonymous = openCodeFunding(options)?.kind === "public-free";
  const env: NodeJS.ProcessEnv = anonymous ? {} : { ...inherited };
  if (anonymous) for (const key of ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SystemRoot", "WINDIR", "PATHEXT"]) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  for (const key of Object.keys(env)) if (key.startsWith("OPENCODE_")) delete env[key];
  const root = openCodeDirectory(options);
  return {
    ...env, PWD: options.cwd,
    ...(anonymous ? {
      HOME: join(root, "home"), USERPROFILE: join(root, "home"),
      XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"),
      TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
    } : {}),
    XDG_CONFIG_HOME: join(root, "xdg"), OPENCODE_TEST_HOME: join(root, "home"),
    OPENCODE_CONFIG_DIR: openCodeConfigDirectory(options), OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_FILEWATCHER_DISABLE: "1",
  };
}

export interface OpenCodeAttempt {
  readonly funding: OpenCodeFunding;
  readonly configDirectory: string;
  readonly config: ReturnType<typeof openCodeConfig>;
  readonly environment: NodeJS.ProcessEnv;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function openCodeAttempt(options: RunnerOptions, inherited: NodeJS.ProcessEnv): OpenCodeAttempt | null {
  const funding = openCodeFunding(options);
  if (funding === null) return null;
  const environment = openCodeEnvironment(options, inherited);
  return freeze({ funding, environment, configDirectory: openCodeConfigDirectory(options), config: openCodeConfig(options, environment) });
}

export function openCodePreflightPassed(stdout: string, attempt: OpenCodeAttempt): boolean {
  try {
    const expected = [
      { type: "document", path: join(attempt.configDirectory, "opencode.json"), info: attempt.config },
      { type: "directory", path: attempt.configDirectory },
    ];
    if (!isDeepStrictEqual(JSON.parse(stdout), expected)) return false;
    if (!lstatSync(attempt.configDirectory).isDirectory() || lstatSync(attempt.configDirectory).isSymbolicLink()) return false;
    const names = readdirSync(attempt.configDirectory).sort();
    if (!isDeepStrictEqual(names, ["opencode.json", "service.json"])) return false;
    for (const name of names) {
      const path = join(attempt.configDirectory, name);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return false;
      const wanted = name === "opencode.json" ? attempt.config : { disabled: true };
      if (!isDeepStrictEqual(JSON.parse(readFileSync(path, "utf8")), wanted)) return false;
    }
    return true;
  } catch { return false; }
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
    if (event.type === "error") {
      const error = object(event.error);
      if (error === null || string(error.message ?? object(error.data)?.message) === null) return incomplete("OpenCode emitted an invalid error");
      const session = string(event.sessionID);
      if (typeof event.sessionID !== "string" || (sessionId !== null && session !== sessionId)) return incomplete("OpenCode emitted mixed error sessions");
      terminalError ??= event;
      continue;
    }
    const session = string(event.sessionID);
    if (session === null || (sessionId !== null && sessionId !== session)) return incomplete("OpenCode emitted missing or mixed sessions");
    sessionId = session;
    if (terminalError !== null) return { kind: "error", envelope: terminalError };
    if (!["step_start", "step_finish", "text", "tool_use", "reasoning"].includes(String(event.type))) return incomplete("OpenCode emitted an unsupported event");
    const part = object(event.part);
    const id = string(event.type === "tool_use" ? part?.partID : part?.id);
    const messageID = string(part?.messageID);
    if (part === null || id === null || messageID === null || part.sessionID !== sessionId) return incomplete("OpenCode emitted an invalid part identity");
    if (currentId !== messageID) {
      if (messages.has(messageID)) return incomplete("OpenCode returned to an earlier message");
      const previous = currentId === null ? undefined : messages.get(currentId);
      if (previous !== undefined && (previous.startId === null || previous.reason === null)) return incomplete("OpenCode left an incomplete earlier message");
      if (event.type !== "step_start") return incomplete("OpenCode message did not start with a step");
      currentId = messageID;
      messages.set(messageID, { text: new Map(), finishes: new Map(), tools: false, startId: null, reason: null });
    }
    const message = messages.get(messageID)!;
    if (message.reason !== null && !(event.type === "step_finish" && message.finishes.has(id) && isDeepStrictEqual(message.finishes.get(id), part))) {
      return incomplete("OpenCode emitted an ambiguous reconciliation trailer");
    }
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
      if (string(part.id) === null) return incomplete("OpenCode tool part has no call identity");
      message.tools = true;
    } else if (event.type === "step_finish") {
      message.reason = string(part.reason);
      if (message.reason === null) return incomplete("OpenCode finish has no reason");
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
