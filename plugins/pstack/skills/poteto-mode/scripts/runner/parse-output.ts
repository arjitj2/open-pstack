import type {
  NormalizedUsage,
  ParsedOutput,
  Provider,
} from "./types.ts";
import {
  concreteModelMatchesRollingAlias,
  isRollingClaudeAlias,
} from "./model-aliases.ts";
import { ProviderTerminalError } from "./provider-failure.ts";
import { antigravityEvents, antigravitySuccessfulResult } from "./antigravity.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizedUsage(value: unknown): NormalizedUsage | null {
  const usage = object(value);
  if (usage === null) return null;
  const result: NormalizedUsage = {
    inputTokens: finiteNumber(usage.input_tokens),
    cachedInputTokens: finiteNumber(
      usage.cached_input_tokens ?? usage.cache_read_input_tokens
    ),
    cacheCreationInputTokens: finiteNumber(
      usage.cache_creation_input_tokens ?? usage.cache_write_input_tokens
    ),
    outputTokens: finiteNumber(usage.output_tokens),
    reasoningTokens: finiteNumber(
      usage.reasoning_tokens ?? usage.reasoning_output_tokens
    ),
    totalTokens: finiteNumber(usage.total_tokens),
  };
  return Object.values(result).some((entry) => entry !== undefined)
    ? result
    : null;
}

function modelFromUsage(
  value: unknown,
  provider: Provider,
  requestedModel: string
): string | null {
  const usage = object(value);
  if (usage === null) return null;
  const models = Object.keys(usage);
  return models.find((model) =>
    reportedModelMatches(provider, requestedModel, model)
  )
    ?? models[0]
    ?? null;
}

function parseClaude(stdout: string, requestedModel: string): ParsedOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("claude did not emit valid JSON");
  }
  const value = object(raw);
  if (value === null) throw new Error("claude emitted a non-object result");

  if (value.is_error === true) {
    throw new ProviderTerminalError("claude", "claude reported an error result", value);
  }
  const text = nullableString(value.result);
  if (text === null) throw new Error("claude result did not contain final text");

  return {
    text,
    reportedModel: modelFromUsage(value.modelUsage, "claude", requestedModel),
    sessionId: nullableString(value.session_id ?? value.sessionId),
    usage: normalizedUsage(value.usage),
    costUsd: finiteNumber(value.total_cost_usd) ?? null,
  };
}

function parseGrok(stdout: string, requestedModel: string): ParsedOutput {
  let result: JsonObject | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("grok emitted a non-JSON event");
    }
    const event = object(raw);
    if (event?.type === "result") result = event;
  }

  if (result === null) throw new Error("grok result did not contain a terminal event");
  if (result.is_error === true || result.subtype !== "success") {
    throw new ProviderTerminalError("grok", "grok reported an error result", result);
  }
  const text = nullableString(result.result);
  if (text === null) throw new Error("grok result did not contain final text");

  return {
    text,
    reportedModel: modelFromUsage(result.modelUsage, "grok", requestedModel),
    sessionId: nullableString(result.session_id),
    usage: normalizedUsage(result.usage),
    costUsd: finiteNumber(result.total_cost_usd) ?? null,
  };
}

function parseCodex(stdout: string): ParsedOutput {
  let text: string | null = null;
  let usage: NormalizedUsage | null = null;
  let sessionId: string | null = null;
  // The last terminal event decides the outcome: a turn.completed after an
  // earlier turn.failed or stream `error` event means the turn recovered, and
  // nonterminal events never terminalize the result.
  let terminal: JsonObject | null = null;

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("codex emitted a non-JSON event");
    }
    const event = object(raw);
    if (event === null) continue;
    if (event.type === "thread.started") {
      sessionId = nullableString(event.thread_id) ?? sessionId;
    }
    if (event.type === "item.completed") {
      const item = object(event.item);
      if (item?.type === "agent_message") {
        text = nullableString(item.text) ?? text;
      }
    }
    if (event.type === "turn.completed") {
      usage = normalizedUsage(event.usage) ?? usage;
      terminal = null;
    }
    if (event.type === "turn.failed" || event.type === "error") {
      terminal = event;
    }
  }

  if (terminal !== null) {
    const detail = terminal.type === "turn.failed" ? object(terminal.error) : terminal;
    throw new ProviderTerminalError(
      "codex",
      nullableString(detail?.message) ?? "codex reported a failed turn",
      terminal
    );
  }
  if (text === null) throw new Error("codex result did not contain a final agent message");
  return {
    text,
    reportedModel: null,
    sessionId,
    usage,
    costUsd: null,
  };
}

function parseCursor(stdout: string): ParsedOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("cursor did not emit valid JSON");
  }
  const value = object(raw);
  if (value === null || value.type !== "result") {
    throw new Error("cursor did not emit a terminal result envelope");
  }
  if (value.subtype !== "success" || value.is_error !== false) {
    throw new ProviderTerminalError("cursor", "cursor did not report a successful result", value);
  }
  const text = nullableString(value.result);
  if (text === null || text.trim().length === 0) throw new Error("cursor result did not contain final text");
  const usage = object(value.usage);
  return {
    text,
    reportedModel: nullableString(value.model),
    sessionId: nullableString(value.session_id),
    usage: normalizedUsage(usage === null ? null : {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_input_tokens: usage.cacheReadTokens,
      cache_creation_input_tokens: usage.cacheWriteTokens,
    }),
    costUsd: finiteNumber(value.total_cost_usd) ?? null,
  };
}

function parseAntigravity(stdout: string): ParsedOutput {
  const events = antigravityEvents(stdout);
  const first = events[0];
  const last = events.at(-1);
  const init = first?.event === "init" ? object(first.init) : null;
  const result = last?.event === "result" ? object(last.result) : null;
  if (init === null || nullableString(first?.conversation_id) === null) {
    throw new Error("antigravity stream did not begin with init");
  }
  if (events.filter((event) => event.event === "init").length !== 1 ||
      events.filter((event) => event.event === "result").length !== 1 || result === null) {
    throw new Error("antigravity stream did not end with one result");
  }
  if (events.some((event) => event.event === "error") || result.num_turns !== 1) {
    throw new Error("antigravity stream did not contain one completed turn");
  }
  if (result.conversation_id !== first?.conversation_id) {
    throw new Error("antigravity conversation id changed");
  }
  if (!antigravitySuccessfulResult(result)) {
    throw new ProviderTerminalError("antigravity", "antigravity did not report a successful result", result);
  }
  const usage = object(result.usage);
  return {
    text: (result.response as string).trim(),
    reportedModel: nullableString(init.model),
    sessionId: first.conversation_id as string,
    usage: normalizedUsage(usage === null ? null : {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      thinking_tokens: usage.thinking_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      total_tokens: usage.total_tokens,
      reasoning_tokens: usage.thinking_tokens,
      cached_input_tokens: usage.cache_read_tokens,
    }),
    costUsd: null,
  };
}

export function parseProviderOutput(
  provider: Provider,
  stdout: string,
  stderr: string,
  requestedModel: string
): ParsedOutput {
  switch (provider) {
    case "antigravity":
      return parseAntigravity(stdout);
    case "devin": {
      if (/^warning: rejected a tool call that requires confirmation\./im.test(stderr)) {
        throw new Error("devin could not approve a tool in non-interactive mode");
      }
      let exported: JsonObject | null;
      try {
        exported = object(JSON.parse(stdout));
      } catch {
        throw new Error("devin export is not valid JSON");
      }
      if (exported?.schema_version !== "ATIF-v1.7" || !Array.isArray(exported.steps)) {
        throw new Error("devin export has an unsupported schema");
      }
      const last = object(exported.steps.at(-1));
      const calls = last?.tool_calls;
      if (last?.source !== "agent" ||
          (calls !== undefined && (!Array.isArray(calls) || calls.length !== 0)) ||
          typeof last.message !== "string" || last.message.trim().length === 0) {
        throw new Error("devin export did not end with a final agent response");
      }
      const text = last.message.trim();
      return { text, reportedModel: null, sessionId: null, usage: null, costUsd: null };
    }
    case "cursor":
      return parseCursor(stdout);
    case "claude":
      return parseClaude(stdout, requestedModel);
    case "codex":
      return parseCodex(stdout);
    case "grok":
      return parseGrok(stdout, requestedModel);
  }
}

export function reportedModelMatches(
  provider: Provider,
  requested: string,
  reported: string | null
): boolean {
  if (reported === null) return false;
  if (provider === "cursor" || provider === "antigravity") return reported === requested;
  if (provider === "claude" && isRollingClaudeAlias(requested)) {
    return concreteModelMatchesRollingAlias(requested, reported);
  }
  if (reported === requested || reported.startsWith(`${requested}-`)) {
    return true;
  }
  return false;
}
