import type { Provider } from "./types.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export class ProviderTerminalError extends Error {
  readonly provider: Provider;
  readonly envelope: unknown;
  constructor(provider: Provider, message: string, envelope: unknown) {
    super(message);
    this.name = "ProviderTerminalError";
    this.provider = provider;
    this.envelope = envelope;
  }
}

// Codex evidence (first-party source):
//   - codex-rs/exec/src/exec_events.rs @f8c6026c: terminal stream events are
//     `turn.failed` (TurnFailedEvent { error: ThreadErrorEvent }) and `error`
//     (ThreadErrorEvent, "unrecoverable error emitted directly by the event
//     stream"). ThreadErrorEvent carries `message: String` only — there is NO
//     machine code field.
//   - codex-rs/protocol/src/error.rs @9d8de196: the details that translate to
//     CodexErrorInfo::UsageLimitExceeded are UsageLimitReached and
//     QuotaExceeded; their Display strings are the canonical terminal quota
//     diagnostics below. UsageNotIncluded is an entitlement/upgrade gate, not
//     exhaustion of available capacity, and RateLimitExceeded is retryable,
//     while ServerOverloaded/SessionBudgetExceeded are not account quota — all
//     deliberately excluded.
// Grok evidence (first-party source, xai-org/grok-build @f0e3be11):
//   - crates/codegen/xai-grok-shell/src/sampling/error.rs: the backend
//     `subscription:free-usage-exhausted` code maps uniquely to
//     FREE_USAGE_USER_MESSAGE, the canonical diagnostic below.
//   - crates/codegen/xai-grok-pager/src/headless/reducer/messages/mod.rs: the
//     streaming-messages-json terminal error is emitted as
//     {type:"result", subtype:"error_during_execution", is_error:true,
//     errors:[message]}.

// Canonical terminal quota diagnostics (lowercased, ASCII-apostrophe
// normalized). A turn.failed/error message counts as quota only when one of
// these starts the message or starts the text immediately after a ": "
// boundary — matching the optional "{prefix}: {message}" wrapping Codex applies
// when surfacing the error. Quoted or embedded occurrences do not match.
const CODEX_QUOTA_DIAGNOSTICS = [
  // UsageLimitReached family (all plan/promo/limit-name variants share these
  // stems, including the workspace credits and spend-cap variants).
  "you've hit your usage limit",
  "your workspace is out of credits.",
  "you hit your spend cap set",
  // QuotaExceeded
  "quota exceeded. check your plan and billing details.",
] as const;

function normalizeDiagnosticText(message: string): string {
  return message.trim().toLowerCase().replaceAll("’", "'");
}

function isCodexQuotaMessage(message: string): boolean {
  const normalized = normalizeDiagnosticText(message);
  const segments = [normalized];
  let index = normalized.indexOf(": ");
  while (index >= 0) {
    segments.push(normalized.slice(index + 2));
    index = normalized.indexOf(": ", index + 2);
  }
  return segments.some((segment) =>
    CODEX_QUOTA_DIAGNOSTICS.some((diagnostic) => segment.startsWith(diagnostic))
  );
}

interface CodexTerminal {
  readonly kind: "failed" | "completed";
  readonly message: string | null;
  readonly event: JsonObject;
}

// The last terminal event in a Codex exec stream decides the outcome: a
// turn.completed after an earlier error means the turn recovered, and item
// events (including agent_message text) are generated content, never errors.
function codexTerminalEvent(events: readonly JsonObject[]): CodexTerminal | null {
  let terminal: CodexTerminal | null = null;
  for (const event of events) {
    if (event.type === "turn.failed") {
      const error = object(event.error);
      terminal = {
        kind: "failed",
        message: typeof error?.message === "string" ? error.message : null,
        event,
      };
    } else if (event.type === "error") {
      terminal = {
        kind: "failed",
        message: typeof event.message === "string" ? event.message : null,
        event,
      };
    } else if (event.type === "turn.completed") {
      terminal = { kind: "completed", message: null, event };
    }
  }
  return terminal;
}

const GROK_FREE_USAGE_MESSAGE = normalizeDiagnosticText(
  "You\u2019ve reached your free Grok Build usage limit for now. Get SuperGrok for much higher limits, or try again later: https://grok.com/supergrok?referrer=grok-build"
);

function grokTerminalResult(events: readonly JsonObject[]): JsonObject | null {
  let result: JsonObject | null = null;
  for (const event of events) {
    if (event.type === "result") result = event;
  }
  return result;
}

function jsonObjects(text: string): JsonObject[] {
  const candidates: JsonObject[] = [];
  const tryParse = (value: string): void => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    try {
      const parsed = object(JSON.parse(trimmed));
      if (parsed !== null) candidates.push(parsed);
    } catch {
    }
  };
  tryParse(text);
  for (const line of text.split("\n")) tryParse(line);
  return candidates;
}

export interface TerminalClassification {
  readonly status: "usage-exhausted" | null;
  readonly code: string | null;
  readonly evidence: string;
}

const UNKNOWN: TerminalClassification = { status: null, code: null, evidence: "" };

function classifyCodexTerminal(terminal: CodexTerminal): TerminalClassification {
  if (terminal.kind === "completed" || terminal.message === null) return UNKNOWN;
  if (!isCodexQuotaMessage(terminal.message)) return UNKNOWN;
  return {
    status: "usage-exhausted",
    code: "codex_usage_limit_exceeded",
    evidence: JSON.stringify(terminal.event).slice(0, 2_000),
  };
}

function classifyGrokResult(result: JsonObject): TerminalClassification {
  if (
    result.type !== "result" ||
    result.subtype !== "error_during_execution" ||
    result.is_error !== true ||
    !Array.isArray(result.errors)
  ) {
    return UNKNOWN;
  }
  const quota = result.errors.some(
    (entry) =>
      typeof entry === "string" &&
      normalizeDiagnosticText(entry) === GROK_FREE_USAGE_MESSAGE
  );
  if (!quota) return UNKNOWN;
  return {
    status: "usage-exhausted",
    code: "grok_free_usage_exhausted",
    evidence: JSON.stringify(result).slice(0, 2_000),
  };
}

export function classifyTerminalEnvelope(
  provider: Provider,
  envelope: unknown
): TerminalClassification {
  const event = object(envelope);
  if (event === null) return UNKNOWN;
  switch (provider) {
    case "codex": {
      if (event.type === "turn.failed" || event.type === "error") {
        const terminal = codexTerminalEvent([event]);
        return terminal === null ? UNKNOWN : classifyCodexTerminal(terminal);
      }
      return UNKNOWN;
    }
    case "grok":
      return classifyGrokResult(event);
    default:
      return UNKNOWN;
  }
}

export function classifyTerminalOutput(
  provider: Provider,
  stdout: string,
  stderr: string
): TerminalClassification {
  // The verified structured protocol stream for both supported providers is
  // stdout; stderr is diagnostics and can never override a stdout terminal.
  const events = jsonObjects(stdout);
  switch (provider) {
    case "codex": {
      const terminal = codexTerminalEvent(events);
      return terminal === null ? UNKNOWN : classifyCodexTerminal(terminal);
    }
    case "grok": {
      const result = grokTerminalResult(events);
      return result === null ? UNKNOWN : classifyGrokResult(result);
    }
    default:
      return UNKNOWN;
  }
}

// Only credential/control names are reported. Provider-managed overage and
// account billing limits remain outside this local route guard.
const API_CREDENTIAL_ENV: Readonly<Record<Provider, readonly string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_AWS_API_KEY"],
  codex: ["OPENAI_API_KEY"],
  grok: ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"],
  devin: ["DEVIN_API_KEY"],
  cursor: ["CURSOR_API_KEY"],
};

// Provider-selection and gateway switches: count only when set to a truthy
// value, since these are boolean/endpoint controls rather than secrets. They
// are documented first-party controls that route Claude traffic off the
// subscription surface (Bedrock/Vertex/Foundry selection, custom base URL or
// headers).
const API_ROUTE_ENV: Readonly<Record<Provider, readonly string[]>> = {
  claude: [
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_CUSTOM_HEADERS",
  ],
  codex: [],
  grok: [],
  devin: ["DEVIN_API_URL"],
  cursor: ["CURSOR_API_ENDPOINT"],
};

function truthy(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized !== "0" && normalized !== "false" && normalized !== "no";
}

export function apiCredentialTakeover(
  provider: Provider,
  env: NodeJS.ProcessEnv
): string | null {
  for (const name of API_CREDENTIAL_ENV[provider]) {
    if ((env[name]?.trim().length ?? 0) > 0) return name;
  }
  for (const name of API_ROUTE_ENV[provider]) {
    if (truthy(env[name])) return name;
  }
  return null;
}

// Grok's login banner and sampling use different credential precedence:
// xai-org/grok-build cli_models.rs @f0e3be11. A banner cannot rule out BYOK.
// Devin/Cursor retain their ordinary account checks with isolated config and
// guarded environment inputs; neither exposes an independent billing verdict.
export interface SubscriptionAuthVerdict {
  readonly compatible: boolean;
  readonly reason: string;
}

function claudeAuthVerdict(stdout: string): SubscriptionAuthVerdict {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return { compatible: false, reason: "claude auth status did not return JSON" };
  }
  const value = object(raw);
  if (value === null || value.loggedIn !== true) {
    return { compatible: false, reason: "claude auth status does not report a login" };
  }
  const authMethod = typeof value.authMethod === "string" ? value.authMethod : null;
  const apiProvider = typeof value.apiProvider === "string" ? value.apiProvider : null;
  if (authMethod !== "claude.ai") {
    return {
      compatible: false,
      reason: authMethod === null
        ? "claude auth status did not expose authMethod; cannot confirm subscription auth"
        : `claude authMethod ${JSON.stringify(authMethod)} is not the subscription surface`,
    };
  }
  if (apiProvider !== "firstParty") {
    return {
      compatible: false,
      reason: apiProvider === null
        ? "claude auth status did not expose apiProvider; cannot confirm first-party auth"
        : `claude apiProvider ${JSON.stringify(apiProvider)} is not first-party`,
    };
  }
  return { compatible: true, reason: "claude.ai first-party subscription auth" };
}

function codexAuthVerdict(stdout: string, stderr: string): SubscriptionAuthVerdict {
  const combined = `${stdout}\n${stderr}`.trim();
  if (/api[-\s]?key/i.test(combined)) {
    return { compatible: false, reason: "codex is authenticated with an API key" };
  }
  if (/^logged in using chatgpt\.?$/i.test(combined)) {
    return { compatible: true, reason: "ChatGPT subscription auth" };
  }
  return {
    compatible: false,
    reason: "codex login status did not confirm ChatGPT subscription auth",
  };
}

export function subscriptionAuthEvidence(
  provider: Provider,
  preflightStdout: string,
  preflightStderr: string
): SubscriptionAuthVerdict | null {
  switch (provider) {
    case "claude":
      return claudeAuthVerdict(preflightStdout);
    case "codex":
      return codexAuthVerdict(preflightStdout, preflightStderr);
    case "grok":
      return {
        compatible: false,
        reason: "Grok per-model BYOK credentials can override session auth; subscription-only routing cannot be verified",
      };
    case "devin":
    case "cursor":
      return null;
  }
}
