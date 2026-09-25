import type { Provider } from "./types.ts";
import { antigravityEvents, antigravitySuccessfulResult } from "./antigravity.ts";

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

// Canonical Codex terminal quota diagnostics (normalized). Only the
// UsageLimitReached/QuotaExceeded Display strings count — UsageNotIncluded is
// an entitlement gate, RateLimitExceeded is retryable, and
// ServerOverloaded/SessionBudgetExceeded are not account quota. Source
// provenance for every adapter lives in references/provider-dispatch.md.
const CODEX_QUOTA_DIAGNOSTICS = [
  "you've hit your usage limit",
  "your workspace is out of credits.",
  "you hit your spend cap set",
  "quota exceeded. check your plan and billing details.",
] as const;

// Codex continues these diagnostics with "." or " " ("usage limit. Visit ...",
// "spend cap set by ..."); anything else is an unproven continuation.
const CODEX_DIAGNOSTIC_SEPARATORS = [".", " "] as const;

function normalizeDiagnosticText(message: string): string {
  return message.trim().toLowerCase().replaceAll("’", "'");
}

function beginsWithDiagnostic(
  text: string,
  diagnostic: string,
  separators: readonly string[]
): boolean {
  if (!text.startsWith(diagnostic)) return false;
  const rest = text.slice(diagnostic.length);
  return (
    rest.length === 0 ||
    separators.some((separator) => rest.startsWith(separator))
  );
}

function stderrLines(stderr: string): string[] {
  return stderr
    .replaceAll(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .split("\n")
    .map((line) => line.replaceAll("\r", "").trim())
    .filter((line) => line.length > 0);
}

// A caller-provided terminal envelope is trusted: a recognizably successful
// terminal frame means the attempt did not die of exhaustion and must veto any
// channel diagnostic. A result envelope counts only through the provider's
// declared success subtype — a bare is_error:false object proves nothing.
function isSuccessfulTerminalEnvelope(value: unknown): boolean {
  const event = object(value);
  if (event === null) return false;
  if (event.type === "turn.completed") return true;
  if (event.type === "result") {
    return event.subtype === "success" && event.is_error !== true;
  }
  return false;
}

// Only these source-proven Codex wrappers may expose a diagnostic after their
// ": " boundary: exec retries surface the final failure as
// "stream disconnected after retries: {message}". Any other "{context}: "
// prefix (authentication, rate limit, model) is unproven, so a wrapped
// diagnostic inside it never classifies. Quoted or embedded occurrences still
// do not match.
const CODEX_MESSAGE_WRAPPERS = ["stream disconnected after retries: "] as const;

function isCodexQuotaMessage(message: string): boolean {
  const normalized = normalizeDiagnosticText(message);
  const segments = [normalized];
  for (const wrapper of CODEX_MESSAGE_WRAPPERS) {
    if (normalized.startsWith(wrapper)) {
      segments.push(normalized.slice(wrapper.length));
    }
  }
  return segments.some((segment) =>
    CODEX_QUOTA_DIAGNOSTICS.some((diagnostic) =>
      beginsWithDiagnostic(segment, diagnostic, CODEX_DIAGNOSTIC_SEPARATORS)
    )
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

// The backend `subscription:free-usage-exhausted` code maps uniquely to this
// message; the terminal error shape is {type:"result",
// subtype:"error_during_execution", is_error:true, errors:[message]}.
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

// Every adapter sees the same process outcome: the raw captures, the child
// exit code, and — only when the caller already parsed a trusted terminal
// envelope (a thrown ProviderTerminalError) — that envelope. An adapter reads
// only the channels its provider protocol actually carries; unrecognized
// input stays UNKNOWN and never triggers fallback.
export interface ProviderProcessOutcome {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly terminalEnvelope?: unknown;
}

interface QuotaAdapter {
  classify(outcome: ProviderProcessOutcome): TerminalClassification;
  succeeded(outcome: ProviderProcessOutcome): boolean;
}

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

const codexAdapter: QuotaAdapter = {
  classify(outcome) {
    if (outcome.terminalEnvelope !== undefined) {
      const event = object(outcome.terminalEnvelope);
      if (event === null || (event.type !== "turn.failed" && event.type !== "error")) {
        return UNKNOWN;
      }
      const terminal = codexTerminalEvent([event]);
      return terminal === null ? UNKNOWN : classifyCodexTerminal(terminal);
    }
    const terminal = codexTerminalEvent(jsonObjects(outcome.stdout));
    return terminal === null ? UNKNOWN : classifyCodexTerminal(terminal);
  },
  succeeded(outcome) {
    const events =
      outcome.terminalEnvelope !== undefined
        ? [object(outcome.terminalEnvelope)].filter(
            (event): event is JsonObject => event !== null
          )
        : jsonObjects(outcome.stdout);
    return codexTerminalEvent(events)?.kind === "completed";
  },
};

const grokAdapter: QuotaAdapter = {
  classify(outcome) {
    if (outcome.terminalEnvelope !== undefined) {
      const event = object(outcome.terminalEnvelope);
      return event === null ? UNKNOWN : classifyGrokResult(event);
    }
    const result = grokTerminalResult(jsonObjects(outcome.stdout));
    return result === null ? UNKNOWN : classifyGrokResult(result);
  },
  succeeded(outcome) {
    if (outcome.terminalEnvelope !== undefined) {
      return isSuccessfulTerminalEnvelope(outcome.terminalEnvelope);
    }
    const result = grokTerminalResult(jsonObjects(outcome.stdout));
    return result !== null && isSuccessfulTerminalEnvelope(result);
  },
};

// Claude's terminal quota proof is the complete errored api_error result
// envelope (verified against a captured real exhaustion); subtype alone or a
// bare 429 never classify, and a later successful result supersedes. The
// composer renders `You've hit your ${name}${tail}` and
// `You're out of usage credits${tail}` where tail is empty or begins " · ",
// so that separator or end-of-text is the only proven diagnostic boundary.
// Unproven names, `errors`-carrying subtypes, entitlement/seat-tier text, and
// non-429 api_error frames fail closed.
const CLAUDE_QUOTA_DIAGNOSTICS = [
  "you've hit your session limit",
  "you've hit your weekly limit",
  "you've hit your opus limit",
  "you've hit your sonnet limit",
  "you've hit your fable limit",
  "you've hit your usage credit limit",
  "you've hit your usage limit",
  "you've hit your limit",
  "you've hit your team's shared budget",
  "you've hit your monthly spend limit",
  "you've hit your org's monthly spend limit",
  "you've hit your org's monthly usage limit",
  "you're out of usage credits",
] as const;

const CLAUDE_DIAGNOSTIC_SEPARATORS = [" \u00b7 "] as const;

function isClaudeQuotaDiagnostic(message: string): boolean {
  const normalized = normalizeDiagnosticText(message);
  return CLAUDE_QUOTA_DIAGNOSTICS.some((diagnostic) =>
    beginsWithDiagnostic(normalized, diagnostic, CLAUDE_DIAGNOSTIC_SEPARATORS)
  );
}

function classifyClaudeResult(result: JsonObject): TerminalClassification {
  if (
    result.type !== "result" ||
    result.is_error !== true ||
    result.terminal_reason !== "api_error" ||
    result.api_error_status !== 429 ||
    typeof result.result !== "string" ||
    !isClaudeQuotaDiagnostic(result.result)
  ) {
    return UNKNOWN;
  }
  return {
    status: "usage-exhausted",
    code: "claude_usage_limit_exceeded",
    evidence: JSON.stringify(result).slice(0, 2_000),
  };
}

function claudeTerminalResult(events: readonly JsonObject[]): JsonObject | null {
  let result: JsonObject | null = null;
  for (const event of events) {
    if (event.type === "result") result = event;
  }
  return result;
}

const claudeAdapter: QuotaAdapter = {
  classify(outcome) {
    if (outcome.terminalEnvelope !== undefined) {
      const event = object(outcome.terminalEnvelope);
      return event === null ? UNKNOWN : classifyClaudeResult(event);
    }
    const result = claudeTerminalResult(jsonObjects(outcome.stdout));
    return result === null ? UNKNOWN : classifyClaudeResult(result);
  },
  succeeded(outcome) {
    if (outcome.terminalEnvelope !== undefined) {
      return isSuccessfulTerminalEnvelope(outcome.terminalEnvelope);
    }
    const result = claudeTerminalResult(jsonObjects(outcome.stdout));
    return result !== null && isSuccessfulTerminalEnvelope(result);
  },
};

// Devin `--print` failures surface as one stderr `Error: <Display>` frame at
// a nonzero exit. The quota contract is exactly `Error: Quota exhausted:
// <canonical>` or `Error: <canonical>`: the `Quota exhausted:` prefix alone
// can wrap unrelated detail, a canonical sentence nested inside another
// Display (auth, rate, transport) is not the top-level frame, and multiple
// `Error:` frames are ambiguous. A trusted successful terminal envelope
// vetoes; Devin has no proven stdout result protocol (the ATIF transcript is
// a separate export file), so an envelope can only veto, never prove quota.
const DEVIN_QUOTA_PREFIX = "quota exhausted:";
const DEVIN_CAP_SENTENCES = [
  "you've reached your monthly usage limit. wait for the limit to reset next month.",
  "your organization has reached its monthly usage limit. ask an account admin to raise it, or wait for the limit to reset next month.",
  "usage quota has been exhausted",
] as const;

function isDevinQuotaDetail(detail: string): boolean {
  const inner = detail.startsWith(DEVIN_QUOTA_PREFIX)
    ? detail.slice(DEVIN_QUOTA_PREFIX.length).trim()
    : detail;
  return (DEVIN_CAP_SENTENCES as readonly string[]).some(
    (sentence) => inner === sentence
  );
}

const devinAdapter: QuotaAdapter = {
  succeeded(outcome) {
    return (
      outcome.terminalEnvelope !== undefined &&
      isSuccessfulTerminalEnvelope(outcome.terminalEnvelope)
    );
  },
  classify(outcome) {
    if (
      outcome.terminalEnvelope !== undefined &&
      isSuccessfulTerminalEnvelope(outcome.terminalEnvelope)
    ) {
      return UNKNOWN;
    }
    if (outcome.exitCode === null || outcome.exitCode === 0) return UNKNOWN;
    const frames = stderrLines(outcome.stderr).filter((line) =>
      line.startsWith("Error:")
    );
    if (frames.length !== 1) return UNKNOWN;
    const detail = normalizeDiagnosticText(frames[0].slice("Error:".length));
    if (!isDevinQuotaDetail(detail)) return UNKNOWN;
    return {
      status: "usage-exhausted",
      code: "devin_quota_exhausted",
      evidence: outcome.stderr.trim().slice(0, 2_000),
    };
  },
};

// Cursor's headless error path prints a single `ClassError: <message>`
// frame on stderr and exits nonzero; success writes a result envelope on
// stdout. FREE_USER_USAGE_LIMIT and PRO_USER_USAGE_LIMIT share
// ActionRequiredError with rate-limit, login, payment, and pro-only errors,
// so the class alone proves nothing: exactly one error frame is required
// (multiple frames are contradictory) and its message must begin with the
// documented cap diagnostic at a separator boundary. A successful stdout
// result envelope or trusted terminal envelope vetoes; invented structured
// codes and generic upgrade/rate/auth strings never classify.
const CURSOR_QUOTA_DIAGNOSTIC = "you've hit your usage limit";
const CURSOR_DIAGNOSTIC_SEPARATORS = [" ", "."] as const;
const CURSOR_ERROR_CLASS = "ActionRequiredError:";
const CURSOR_ERROR_FRAME = /^\S*Error:/;

const cursorAdapter: QuotaAdapter = {
  succeeded(outcome) {
    if (
      outcome.terminalEnvelope !== undefined &&
      isSuccessfulTerminalEnvelope(outcome.terminalEnvelope)
    ) {
      return true;
    }
    for (const event of jsonObjects(outcome.stdout)) {
      if (
        event.type === "result" &&
        event.subtype === "success" &&
        event.is_error === false
      ) {
        return true;
      }
    }
    return false;
  },
  classify(outcome) {
    if (
      outcome.terminalEnvelope !== undefined &&
      isSuccessfulTerminalEnvelope(outcome.terminalEnvelope)
    ) {
      return UNKNOWN;
    }
    if (outcome.exitCode === null || outcome.exitCode === 0) return UNKNOWN;
    for (const event of jsonObjects(outcome.stdout)) {
      if (
        event.type === "result" &&
        event.subtype === "success" &&
        event.is_error === false
      ) {
        return UNKNOWN;
      }
    }
    const frames = stderrLines(outcome.stderr).filter((line) =>
      CURSOR_ERROR_FRAME.test(line)
    );
    if (frames.length !== 1) return UNKNOWN;
    const frame = frames[0];
    if (!frame.startsWith(CURSOR_ERROR_CLASS)) return UNKNOWN;
    const detail = normalizeDiagnosticText(
      frame.slice(CURSOR_ERROR_CLASS.length)
    );
    if (
      !beginsWithDiagnostic(
        detail,
        CURSOR_QUOTA_DIAGNOSTIC,
        CURSOR_DIAGNOSTIC_SEPARATORS
      )
    ) {
      return UNKNOWN;
    }
    return {
      status: "usage-exhausted",
      code: "cursor_usage_limit_exceeded",
      evidence: frame.slice(0, 2_000),
    };
  },
};

const antigravityAdapter: QuotaAdapter = {
  classify() { return UNKNOWN; },
  succeeded(outcome) {
    if (outcome.terminalEnvelope !== undefined) return antigravitySuccessfulResult(outcome.terminalEnvelope);
    try {
      const events = antigravityEvents(outcome.stdout);
      const final = events.at(-1);
      return final?.event === "result" && antigravitySuccessfulResult(final.result);
    } catch { return false; }
  },
};

const QUOTA_ADAPTERS: Readonly<Record<Provider, QuotaAdapter>> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  grok: grokAdapter,
  devin: devinAdapter,
  cursor: cursorAdapter,
  antigravity: antigravityAdapter,
};

export class QuotaAdapterNotImplementedError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(
      `no quota adapter implemented for provider ${JSON.stringify(provider)}`
    );
    this.name = "QuotaAdapterNotImplementedError";
    this.provider = provider;
  }
}

function adapterFor(provider: Provider): QuotaAdapter {
  // An adversarial or future provider name ("toString", "__proto__", ...)
  // must not resolve through Object.prototype: require an own registry entry
  // with a callable classifier.
  const adapter: QuotaAdapter | undefined = Object.prototype.hasOwnProperty.call(
    QUOTA_ADAPTERS,
    provider
  )
    ? QUOTA_ADAPTERS[provider]
    : undefined;
  if (
    adapter === undefined ||
    typeof adapter.classify !== "function" ||
    typeof adapter.succeeded !== "function"
  ) {
    throw new QuotaAdapterNotImplementedError(provider);
  }
  return adapter;
}

export function assertQuotaAdapter(provider: Provider): void {
  adapterFor(provider);
}

export function classifyProcessOutcome(
  provider: Provider,
  outcome: ProviderProcessOutcome
): TerminalClassification {
  return adapterFor(provider).classify(outcome);
}

export function hasTerminalSuccess(
  provider: Provider,
  outcome: ProviderProcessOutcome
): boolean {
  return adapterFor(provider).succeeded(outcome);
}

export function classifyTerminalEnvelope(
  provider: Provider,
  envelope: unknown
): TerminalClassification {
  return adapterFor(provider).classify({
    stdout: "",
    stderr: "",
    exitCode: 0,
    terminalEnvelope: envelope,
  });
}

// Only credential/control names are reported. Provider-managed overage and
// account billing limits remain outside this local route guard.
const API_CREDENTIAL_ENV: Readonly<Record<Provider, readonly string[]>> = {
  claude: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_AWS_API_KEY"],
  codex: ["OPENAI_API_KEY"],
  grok: ["XAI_API_KEY", "GROK_CODE_XAI_API_KEY"],
  devin: ["DEVIN_API_KEY"],
  cursor: ["CURSOR_API_KEY"],
  antigravity: ["GEMINI_API_KEY"],
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
  antigravity: ["GOOGLE_GEMINI_BASE_URL", "AGY_ADC_AUTH"],
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
  if (provider === "antigravity") {
    for (const [name, value] of Object.entries(env)) {
      if (name.startsWith("AGY_GATEWAY_") && truthy(value)) return name;
    }
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
    case "antigravity":
      return null;
  }
}
