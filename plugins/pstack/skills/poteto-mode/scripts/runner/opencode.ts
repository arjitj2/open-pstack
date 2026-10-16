import { openCodeShellUnchanged, type OpenCodeShell } from "./opencode-shell.ts";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { execFileSync } from "node:child_process";
import { type Effort, type NormalizedUsage, type OpenCodeProviderConfig, type ParsedOutput, type RunnerOptions, UsageError } from "./types.ts";

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type OpenCodeContract = "v1" | "v2";
export const OPENCODE_V1_MINIMUM = "1.18.29";
export const OPENCODE_SUPPORTED_RANGE = ">=1.18.29 <3.0.0 stable";
export const OPENCODE_TESTED_VERSIONS = ["1.18.32", "2.0.0", "2.0.25", "2.0.26", "2.0.27"] as const;
export const OPENCODE_CHATGPT_SUBSCRIPTION_MODEL = "openai/gpt-6.1-sol";
export const OPENCODE_CHATGPT_ENDPOINT = "https://chatgpt.com/backend-api/codex";

export interface OpenCodeVersion {
  readonly contract: OpenCodeContract;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly text: string;
}
export type OpenCodeSelection =
  | { readonly kind: "supported"; readonly version: OpenCodeVersion }
  | { readonly kind: "unsupported"; readonly message: string };

// Native banners are either bare (`1.18.32`) or prefixed (`opencode v2.0.27`);
// the presentation form is independent of major. Prereleases and trailing
// noise are rejected because the contracts are only proven on stable releases.
export function openCodeSelectVersion(stdout: string): OpenCodeSelection {
  const banner = stdout.trim();
  const match = /^(?:opencode v)?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(banner);
  const parts = match?.slice(1, 4).map(Number);
  if (parts === undefined || !parts.every(Number.isSafeInteger)) {
    return { kind: "unsupported", message: `Cannot verify OpenCode's version. Install ${OPENCODE_SUPPORTED_RANGE} and check opencode --version.` };
  }
  const [major, minor, patch] = parts;
  const text = `${major}.${minor}.${patch}`;
  if (major === 1) {
    if (minor < 18 || (minor === 18 && patch < 29)) {
      return { kind: "unsupported", message: `OpenCode ${text} is too old. Upgrade to ${OPENCODE_V1_MINIMUM} or newer for GPT-6 OAuth model support.` };
    }
    return { kind: "supported", version: { contract: "v1", major, minor, patch, text } };
  }
  if (major === 2) return { kind: "supported", version: { contract: "v2", major, minor, patch, text } };
  return { kind: "unsupported", message: `OpenCode ${text} uses an unsupported major contract. Install ${OPENCODE_SUPPORTED_RANGE}; tested ${OPENCODE_TESTED_VERSIONS.join(", ")}.` };
}

export function validateOpenCodeModel(model: string, effort: Effort): void {
  if (effort !== "default") throw new UsageError("OpenCode requires default effort; unverified variants can silently use defaults");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)+$/.test(model) || model.split("/").some(part => part.toLowerCase() === "auto")) {
    throw new UsageError("OpenCode requires an exact native provider/model ID");
  }
}

export type OpenCodeFunding =
  | { readonly kind: "native-auth"; readonly apiSpend: "approved" }
  | { readonly kind: "chatgpt-subscription"; readonly apiSpend: "deny"; readonly model: typeof OPENCODE_CHATGPT_SUBSCRIPTION_MODEL };

// Header values and apiKey settings can appear at provider, model, and variant
// level in the V2 schema, so the whole entry is searched.
function credentialKey(value: unknown): string | null {
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (key === "apiKey" || key === "headers") return key;
    const nested = credentialKey(child);
    if (nested !== null) return nested;
  }
  return null;
}

export function parseOpenCodeProviderConfig(text: string, model: string): OpenCodeProviderConfig {
  let document: JsonObject | null;
  try { document = object(JSON.parse(text)); } catch { document = null; }
  if (document === null) throw new UsageError("--opencode-provider-config must be a JSON object mapping provider ID to one OpenCode V2 provider entry");
  const providerID = model.split("/")[0];
  if (!Object.hasOwn(document, providerID)) throw new UsageError(`--opencode-provider-config has no entry for provider ${JSON.stringify(providerID)} in model ${model}`);
  const entry = object(document[providerID]);
  if (entry === null) throw new UsageError(`--opencode-provider-config entry ${JSON.stringify(providerID)} must be a JSON object`);
  const key = credentialKey(entry);
  if (key !== null) throw new UsageError(`--opencode-provider-config entry ${JSON.stringify(providerID)} must not contain ${key}; keep credentials out of the file and name the key's environment variable in env`);
  return { providerID, entry };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = object(value);
  if (record === null) return JSON.stringify(value);
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
export function openCodeProviderConfigReceipt(config: OpenCodeProviderConfig): { readonly providerID: string; readonly sha256: string } {
  return { providerID: config.providerID, sha256: createHash("sha256").update(canonicalJson(config.entry)).digest("hex") };
}

export function openCodeFunding(options: RunnerOptions): OpenCodeFunding | null {
  if (options.opencodeProviderConfig !== undefined && (options.provider !== "opencode" || options.apiSpend !== "approved" || options.opencodeChatgptSubscription)) {
    throw new UsageError("--opencode-provider-config requires provider opencode with ordinary native authentication (--api-spend approved) and cannot be combined with --opencode-chatgpt-subscription");
  }
  if (options.opencodeChatgptSubscription) {
    if (options.provider !== "opencode" || options.apiSpend !== "deny" || options.model !== OPENCODE_CHATGPT_SUBSCRIPTION_MODEL || options.effort !== "default") {
      throw new UsageError(`--opencode-chatgpt-subscription requires provider opencode, --api-spend deny, default effort, and exact model ${OPENCODE_CHATGPT_SUBSCRIPTION_MODEL}`);
    }
    return { kind: "chatgpt-subscription", apiSpend: "deny", model: OPENCODE_CHATGPT_SUBSCRIPTION_MODEL };
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

function openCodeWorktreeRoot(options: RunnerOptions): void {
  if (options.mode !== "isolated-write") return;
  let root: string;
  try { root = execFileSync("git", ["-C", options.cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { throw new UsageError("OpenCode isolated-write requires a Git worktree root"); }
  if (realpathSync(root) !== realpathSync(options.cwd)) throw new UsageError("OpenCode isolated-write cwd must be the Git worktree root");
}

function v1ToolOutputGlob(env: NodeJS.ProcessEnv): string {
  return join(env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "tool-output", "*");
}
interface V1PermissionRule {
  readonly permission: string;
  readonly pattern: string;
  readonly action: "allow" | "deny";
}
function v1Permissions(options: RunnerOptions, env: NodeJS.ProcessEnv, shell?: OpenCodeShell): readonly V1PermissionRule[] {
  return [
    { permission: "*", pattern: "*", action: "deny" },
    ...["read", "glob", "grep"].map(permission => ({ permission, pattern: "*", action: "allow" as const })),
    ...(options.mode === "isolated-write" ? [{ permission: "edit", pattern: "*", action: "allow" as const }] : []),
    ...(shell ? [{ permission: "bash", pattern: "*", action: "allow" as const }] : []),
    { permission: "external_directory", pattern: "*", action: "deny" },
    { permission: "external_directory", pattern: v1ToolOutputGlob(env), action: "deny" },
  ];
}

export function openCodeV1Config(options: RunnerOptions, env: NodeJS.ProcessEnv = process.env, shell?: OpenCodeShell): object {
  openCodeWorktreeRoot(options);
  const permission: Record<string, Record<string, string>> = {};
  for (const rule of v1Permissions(options, env, shell)) (permission[rule.permission] ??= {})[rule.pattern] = rule.action;
  return {
    $schema: "https://opencode.ai/config.json",
    model: options.model, small_model: options.model,
    default_agent: openCodeAgent(options), share: "disabled", autoupdate: false,
    lsp: false, formatter: false, compaction: { auto: false, prune: false },
    agent: { [openCodeAgent(options)]: { mode: "primary", model: options.model, permission } },
  };
}

interface PermissionRule {
  readonly action: string;
  readonly resource: string;
  readonly effect: "allow" | "deny";
}
function v2Permissions(options: RunnerOptions, env: NodeJS.ProcessEnv, shell?: OpenCodeShell): readonly PermissionRule[] {
  const data = env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return [
    { action: "*", resource: "*", effect: "deny" },
    ...["read", "glob", "grep"].map(action => ({ action, resource: "*", effect: "allow" as const })),
    ...(options.mode === "isolated-write" ? [
      { action: "edit", resource: "*", effect: "allow" as const },
      ...[".git", ".git/*", "*/.git", "*/.git/*", join(options.cwd, ".git"), join(options.cwd, ".git", "*")].map(resource => ({ action: "edit", resource, effect: "deny" as const })),
    ] : []),
    ...(shell ? [{ action: "shell", resource: "*", effect: "allow" as const }] : []),
    { action: "external_directory", resource: "*", effect: "deny" },
    { action: "external_directory", resource: join(data, "opencode", "tool-output", "*"), effect: "deny" },
  ];
}

export function openCodeV2Config(options: RunnerOptions, env: NodeJS.ProcessEnv = process.env, shell?: OpenCodeShell) {
  openCodeWorktreeRoot(options);
  const separator = options.model.indexOf("/");
  const model = { providerID: options.model.slice(0, separator), model: options.model.slice(separator + 1) };
  const subscription = openCodeFunding(options)?.kind === "chatgpt-subscription";
  const custom = options.opencodeProviderConfig;
  const providers = subscription ? { openai: { settings: { baseURL: OPENCODE_CHATGPT_ENDPOINT, transport: "http" } } }
    : custom !== undefined ? { [custom.providerID]: custom.entry } : null;
  return {
    ...(providers !== null ? { providers } : {}),
    ...(shell ? { shell: shell.executable } : {}),
    model, default_agent: openCodeAgent(options), share: "disabled", update: "disable",
    snapshots: false, lsp: false, formatter: false, compaction: { auto: false }, warming: false,
    plugins: ["-*", "opencode.models.dev", subscription ? "opencode.provider.openai" : "opencode.provider.*",
      ...(providers !== null ? ["opencode.config.provider"] : []),
      ...(shell ? ["opencode.config.shell", "opencode.tool.shell"] : []),
      "opencode.config.agent", "opencode.config.compaction", "opencode.config.formatter", "opencode.config.snapshot",
      ...["read", "glob", "grep", ...(options.mode === "isolated-write" ? ["edit", "write"] : [])].map(tool => `opencode.tool.${tool}`)],
    agents: { [openCodeAgent(options)]: { mode: "primary", model, permissions: v2Permissions(options, env, shell) } },
  };
}

const OPENCODE_SUBSCRIPTION_ENV_ALLOWLIST = ["PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SystemRoot", "WINDIR", "PATHEXT", "HOME", "USERPROFILE", "XDG_DATA_HOME"] as const;

function openCodeBaseEnvironment(options: RunnerOptions, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const subscription = openCodeFunding(options)?.kind === "chatgpt-subscription";
  const env: NodeJS.ProcessEnv = subscription ? {} : { ...inherited };
  if (subscription) {
    for (const key of OPENCODE_SUBSCRIPTION_ENV_ALLOWLIST) if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  for (const key of Object.keys(env)) if (key.startsWith("OPENCODE_")) delete env[key];
  return env;
}

export function openCodeProbeEnvironment(options: RunnerOptions, inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const root = openCodeDirectory(options);
  return { ...openCodeBaseEnvironment(options, inherited), PWD: options.cwd, XDG_CONFIG_HOME: join(root, "xdg"), OPENCODE_TEST_HOME: join(root, "home") };
}

export function openCodeEnvironment(options: RunnerOptions, inherited: NodeJS.ProcessEnv, contract: OpenCodeContract): NodeJS.ProcessEnv {
  const subscription = openCodeFunding(options)?.kind === "chatgpt-subscription";
  const root = openCodeDirectory(options);
  const env: NodeJS.ProcessEnv = { ...openCodeBaseEnvironment(options, inherited), XDG_CONFIG_HOME: join(root, "xdg"), OPENCODE_TEST_HOME: join(root, "home") };
  if (contract === "v1") {
    return {
      ...env,
      OPENCODE_CONFIG: join(root, "opencode.json"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "1", OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_AUTOCOMPACT: "1", OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
      ...(subscription ? { NO_COLOR: "1" } : {}),
    };
  }
  return {
    ...env, PWD: options.cwd,
    ...(subscription ? { XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp") } : {}),
    OPENCODE_CONFIG_DIR: openCodeConfigDirectory(options), OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_FILEWATCHER_DISABLE: "1",
  };
}

interface OpenCodeAttemptBase {
  readonly funding: OpenCodeFunding;
  readonly shell?: OpenCodeShell;
  readonly environment: NodeJS.ProcessEnv;
}
export interface OpenCodeV1Attempt extends OpenCodeAttemptBase {
  readonly contract: "v1";
  readonly version: OpenCodeVersion;
  readonly configPath: string;
  readonly config: ReturnType<typeof openCodeV1Config>;
}
export interface OpenCodeV2Attempt extends OpenCodeAttemptBase {
  readonly contract: "v2";
  readonly version: OpenCodeVersion;
  readonly configDirectory: string;
  readonly config: ReturnType<typeof openCodeV2Config>;
}
export type OpenCodeAttempt = OpenCodeV1Attempt | OpenCodeV2Attempt;

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function openCodeAttempt(options: RunnerOptions, inherited: NodeJS.ProcessEnv, version: OpenCodeVersion, shell?: OpenCodeShell): OpenCodeAttempt | null {
  const funding = openCodeFunding(options);
  if (funding === null) return null;
  if (shell && options.mode !== "isolated-write") throw new UsageError("Read-only OpenCode workers cannot use a shell sandbox");
  const environment = { ...openCodeEnvironment(options, inherited, version.contract), ...(shell ? { SHELL: shell.executable } : {}) };
  return freeze(version.contract === "v1"
    ? { contract: "v1" as const, version, funding, environment, shell, configPath: join(openCodeDirectory(options), "opencode.json"), config: openCodeV1Config(options, environment, shell) }
    : { contract: "v2" as const, version, funding, environment, shell, configDirectory: openCodeConfigDirectory(options), config: openCodeV2Config(options, environment, shell) });
}

export function openCodeFilesUnchanged(attempt: OpenCodeAttempt): boolean {
  try {
    if (attempt.shell && !openCodeShellUnchanged(attempt.shell)) return false;
    if (attempt.contract === "v1") {
      const file = lstatSync(attempt.configPath);
      return file.isFile() && !file.isSymbolicLink()
        && isDeepStrictEqual(JSON.parse(readFileSync(attempt.configPath, "utf8")), attempt.config);
    }
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

// V1 `debug config` prints the merged effective configuration. Verify it as a
// subset: the pinned model/agent/permission map must appear exactly, provider
// overrides must stay empty, and no MCP server may be enabled.
function openCodeV1PreflightPassed(stdout: string, attempt: OpenCodeV1Attempt): boolean {
  const config = object(JSON.parse(stdout));
  const expected = attempt.config as JsonObject;
  const name = String(expected.default_agent);
  if (config === null || config.model !== expected.model || config.small_model !== expected.small_model ||
      config.default_agent !== name || config.share !== "disabled" ||
      config.autoupdate !== false || config.lsp !== false || config.formatter !== false ||
      object(config.compaction)?.auto !== false || object(config.compaction)?.prune !== false) return false;
  if (config.provider !== undefined && Object.keys(object(config.provider) ?? { invalid: true }).length !== 0) return false;
  if (config.mcp !== undefined) {
    const mcp = object(config.mcp);
    if (mcp === null || Object.values(mcp).some(value => object(value)?.enabled !== false)) return false;
  }
  const agent = object(object(config.agent)?.[name]);
  if (agent === null || agent.mode !== "primary" || agent.model !== expected.model ||
      Object.keys(agent).some(key => !["mode", "model", "permission", "options"].includes(key)) ||
      (agent.options !== undefined && Object.keys(object(agent.options) ?? { invalid: true }).length !== 0)) return false;
  const expectedAgent = object(object(expected.agent)?.[name]);
  return JSON.stringify(agent.permission) === JSON.stringify(expectedAgent?.permission);
}

export function openCodePreflightPassed(stdout: string, attempt: OpenCodeAttempt): boolean {
  try {
    if (attempt.contract === "v1") return openCodeV1PreflightPassed(stdout, attempt) && openCodeFilesUnchanged(attempt);
    return isDeepStrictEqual(JSON.parse(stdout), [
      { type: "document", path: join(attempt.configDirectory, "opencode.json"), info: attempt.config },
      { type: "directory", path: attempt.configDirectory },
    ]) && openCodeFilesUnchanged(attempt);
  } catch { return false; }
}

export function openCodeOAuthPreflightPassed(stdout: string): boolean {
  try {
    const value: unknown = JSON.parse(stdout);
    if (!Array.isArray(value) || value.length !== 1) return false;
    const integration = object(value[0]);
    if (integration?.id !== "openai" || !Array.isArray(integration.connections) || integration.connections.length !== 1) return false;
    const connection = object(integration.connections[0]);
    return connection?.type === "credential" && connection.method === "oauth";
  } catch { return false; }
}

// V1 `auth list` prints a human-readable credentials block rather than JSON.
// The block is a capability contract: parse the whole known structure and fail
// closed on any deviation. The recognized grammar is a `Credentials <path>`
// header, exactly one `OpenAI oauth` entry, and a `1 credential[s]` footer,
// each line optionally prefixed by the native frame glyphs. Anything else —
// extra entries, API or well-known credentials, environment sections,
// duplicate or split blocks, unexpected text — blocks before model execution.
// This trusts a normal native login; it cannot attest a hostile credential
// store or a concurrent auth replacement between preflight and invocation.
const OPENCODE_V1_AUTH_FRAME = /^[┌└│●](?: +|$)/;
const OPENCODE_V1_AUTH_LIST_LIMIT = 16_384;
function openCodeV1AuthStreamStatus(stream: string): "invalid" | "empty" | "valid" {
  if (stream.length > OPENCODE_V1_AUTH_LIST_LIMIT) return "invalid";
  const stripped = stream.replace(/\r\n?/g, "\n").replace(/\x1b\[[0-9;]*m/g, "");
  if (/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(stripped)) return "invalid";
  const content: string[] = [];
  for (const raw of stripped.split("\n")) {
    let line = raw.trim();
    if (line.length === 0) continue;
    const frame = OPENCODE_V1_AUTH_FRAME.exec(line);
    if (frame !== null) line = line.slice(frame[0].length).trim();
    if (line.length === 0) continue;
    content.push(line);
  }
  if (content.length === 0) return stripped.trim() === "" ? "empty" : "invalid";
  const [header, entry, footer, ...rest] = content;
  return rest.length === 0
    && /^Credentials +\S[^\r\n]*$/.test(header)
    && entry === "OpenAI oauth"
    && (footer === "1 credentials" || footer === "1 credential") ? "valid" : "invalid";
}
export function openCodeV1OAuthListPassed(stdout: string, stderr: string): boolean {
  const statuses = [openCodeV1AuthStreamStatus(stdout), openCodeV1AuthStreamStatus(stderr)];
  return statuses.filter(status => status === "valid").length === 1 && !statuses.includes("invalid");
}

export type OpenCodeStream =
  | { readonly kind: "identified"; readonly sessionId: string; readonly assistants: readonly { readonly id: string; readonly finish: string | null }[] }
  | { readonly kind: "error"; readonly envelope: JsonObject }
  | { readonly kind: "incomplete"; readonly reason: string };

export function inspectOpenCodeStream(stdout: string): OpenCodeStream {
  const incomplete = (reason: string): OpenCodeStream => ({ kind: "incomplete", reason });
  const assistants = new Map<string, { id: string; finish: string | null }>();
  const parts = new Map<string, { messageId: string; type: string; callId: string | null; finish: JsonObject | null }>();
  const starts = new Map<string, string>();
  const finishes = new Map<string, string>();
  let sessionId: string | null = null;
  let terminalError: JsonObject | null = null;
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let event: JsonObject | null;
    try { event = object(JSON.parse(line)); } catch { return incomplete("OpenCode emitted non-JSON output"); }
    if (event === null) return incomplete("OpenCode emitted a non-object event");
    if (event.type === "error") {
      const error = object(event.error);
      if (error === null || string(error.message ?? object(error.data)?.message) === null || typeof event.sessionID !== "string" || (sessionId !== null && event.sessionID !== sessionId)) return incomplete("OpenCode emitted an invalid error");
      terminalError ??= event;
      continue;
    }
    const session = string(event.sessionID);
    if (session === null || (sessionId !== null && sessionId !== session)) return incomplete("OpenCode emitted missing or mixed sessions");
    sessionId = session;
    const type = string(event.type);
    if (type === null || !["step_start", "step_finish", "text", "tool_use", "reasoning"].includes(type)) return incomplete("OpenCode emitted an unsupported event");
    const part = object(event.part);
    const id = string(type === "tool_use" ? part?.partID : part?.id);
    const messageId = string(part?.messageID);
    if (part === null || id === null || messageId === null || part.sessionID !== sessionId) return incomplete("OpenCode emitted an invalid part identity");
    const previous = parts.get(id);
    if (previous !== undefined && (previous.messageId !== messageId || previous.type !== type || (type === "tool_use" && previous.callId !== part.id))) return incomplete("OpenCode emitted conflicting part identities");
    let assistant = assistants.get(messageId);
    if (assistant === undefined) { assistant = { id: messageId, finish: null }; assistants.set(messageId, assistant); }
    if (type === "step_start") {
      if (starts.has(messageId) && starts.get(messageId) !== id) return incomplete("OpenCode emitted multiple starts for one assistant");
      starts.set(messageId, id);
    }
    if (type === "text" && typeof part.text !== "string") return incomplete("OpenCode text part has no text");
    if (type === "tool_use" && string(part.id) === null) return incomplete("OpenCode tool part has no call identity");
    if (type === "step_finish") {
      const reason = string(part.reason);
      if (finishes.has(messageId) && finishes.get(messageId) !== id) return incomplete("OpenCode emitted multiple finishes for one assistant");
      finishes.set(messageId, id);
      if (reason === null || (assistant.finish !== null && assistant.finish !== reason) || (previous?.finish !== null && previous?.finish !== undefined && !isDeepStrictEqual(previous.finish, part))) return incomplete("OpenCode emitted conflicting finishes");
      assistant.finish = reason;
    }
    parts.set(id, { messageId, type, callId: type === "tool_use" ? string(part.id) : null, finish: type === "step_finish" ? part : null });
  }
  if (terminalError !== null) return { kind: "error", envelope: terminalError };
  return sessionId !== null && assistants.size > 0
    ? { kind: "identified", sessionId, assistants: [...assistants.values()] }
    : incomplete("OpenCode emitted no session identity");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function matchesModel(value: unknown, expected: string): boolean {
  const model = object(value);
  return model !== null && `${model.providerID}/${model.id}` === expected && (model.variant === undefined || model.variant === "default");
}

export function parseOpenCodeExport(stdout: string, stream: Extract<OpenCodeStream, { kind: "identified" }>, expected: { cwd: string; prompt: string; agent: string; model: string; started: number }): OpenCodeTranscript {
  const incomplete = (reason: string): OpenCodeTranscript => ({ kind: "incomplete", reason });
  let document: JsonObject | null;
  try { document = object(JSON.parse(stdout)); } catch { return incomplete("OpenCode session export was not valid JSON"); }
  const info = object(document?.info);
  const time = object(info?.time);
  if (info === null || info.id !== stream.sessionId || info.parentID !== undefined || info.fork !== undefined || info.revert !== undefined || object(info.location)?.directory !== expected.cwd || info.agent !== expected.agent || !matchesModel(info.model, expected.model) || !finite(time?.created) || time.created < expected.started || !finite(time.updated) || time.updated < time.created || !finite(time.idle) || info.outcome !== "succeeded" || !Array.isArray(document?.messages)) return incomplete("OpenCode session export did not match the fresh attempt");
  const ids = new Set<string>();
  let previousEnd = time.created;
  const assistants: JsonObject[] = [];
  let userSeen = false;
  let idle: JsonObject | null = null;
  for (const value of document.messages) {
    const message = object(value);
    const id = string(message?.id);
    const created = object(message?.time)?.created;
    if (message === null || id === null || ids.has(id) || !finite(created) || created < previousEnd || idle !== null) return incomplete("OpenCode session export had invalid message identities or order");
    ids.add(id);
    previousEnd = created;
    switch (message.type) {
      case "agent-switched":
        if (userSeen || message.agent !== expected.agent) return incomplete("OpenCode session export changed its agent");
        break;
      case "model-switched":
        if (userSeen || !matchesModel(message.model, expected.model)) return incomplete("OpenCode session export changed its model");
        break;
      case "user":
        if (userSeen || message.text !== expected.prompt || [message.files, message.agents, message.skills].some(items => items !== undefined && (!Array.isArray(items) || items.length !== 0))) return incomplete("OpenCode session export did not match the prompt");
        userSeen = true;
        break;
      case "assistant": {
        const completed = object(message.time)?.completed;
        if (!userSeen || message.agent !== expected.agent || !matchesModel(message.model, expected.model) || !finite(completed) || completed < created || !["stop", "tool-calls"].includes(String(message.finish)) || message.error !== undefined || message.retry !== undefined || !Array.isArray(message.content)) return incomplete("OpenCode session export had an unsettled assistant");
        for (const item of message.content) {
          const content = object(item);
          if (content === null) return incomplete("OpenCode session export had invalid content");
          if (content.type === "text" || content.type === "reasoning") {
            if (typeof content.text !== "string") return incomplete("OpenCode session export had invalid text");
          } else if (content.type === "tool") {
            const state = object(content.state);
            const toolTime = object(content.time);
            if (string(content.id) === null || !finite(toolTime?.created) || !finite(toolTime.completed) || toolTime.completed < toolTime.created || toolTime.completed > completed || (state?.status !== "completed" && state?.status !== "error")) return incomplete("OpenCode session export had an unsettled tool");
          } else return incomplete("OpenCode session export had unsupported content");
        }
        previousEnd = completed;
        assistants.push(message);
        break;
      }
      case "idle":
        if (!userSeen || assistants.length === 0 || message.outcome !== "succeeded") return incomplete("OpenCode session export had no succeeded idle");
        idle = message;
        break;
      default: return incomplete("OpenCode session export had unsupported records");
    }
  }
  const final = assistants.at(-1);
  if (final === undefined || idle === null || final.id !== stream.assistants.at(-1)?.id || final.finish !== "stop" || !Array.isArray(final.content)) return incomplete("OpenCode session export had no matching final stop");
  let observedIndex = 0;
  for (const message of assistants) {
    const observed = stream.assistants[observedIndex];
    if (observed?.id === message.id) {
      if (observed.finish !== null && observed.finish !== message.finish) return incomplete("OpenCode stream and export finishes disagreed");
      observedIndex++;
    }
  }
  if (observedIndex !== stream.assistants.length) return incomplete("OpenCode stream and export assistants disagreed");
  const completed = object(final.time)?.completed;
  const idleCreated = object(idle.time)?.created;
  if (!finite(completed) || !finite(idleCreated) || idleCreated < completed || time.idle < idleCreated || time.updated < completed) return incomplete("OpenCode session export idle preceded completion");
  const texts: string[] = [];
  for (const value of final.content) {
    const content = object(value);
    if (content?.type === "tool") return incomplete("OpenCode final assistant contained a tool");
    if (content?.type === "text" && typeof content.text === "string") texts.push(content.text);
  }
  const text = texts.join("\n").trim();
  if (!text) return incomplete("OpenCode final assistant had no text");
  const tokens = object(info.tokens);
  const cache = object(tokens?.cache);
  const fields = { inputTokens: tokens?.input, outputTokens: tokens?.output, reasoningTokens: tokens?.reasoning, cachedInputTokens: cache?.read, cacheCreationInputTokens: cache?.write };
  const usage: Record<string, number> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && !finite(value)) return incomplete("OpenCode session export had invalid usage");
    if (finite(value)) usage[key] = value;
  }
  if (info.cost !== undefined && !finite(info.cost)) return incomplete("OpenCode session export had invalid cost");
  return { kind: "complete", output: { text, sessionId: stream.sessionId, reportedModel: null, usage: Object.keys(usage).length ? usage : null, costUsd: finite(info.cost) ? info.cost : null } };
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
    const id = string(event.type === "tool_use" ? part?.partID ?? part?.id : part?.id);
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
