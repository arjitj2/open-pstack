import { describe, expect, it } from "bun:test";
import {
  apiCredentialTakeover,
  classifyTerminalEnvelope,
  classifyTerminalOutput,
  subscriptionAuthEvidence,
} from "./provider-failure.ts";

// Canonical terminal quota diagnostic emitted by Codex
// (codex-rs/protocol/src/error.rs @9d8de196, UsageLimitReached for a
// Pro/ProLite plan, wrapped in a turn.failed event per
// codex-rs/exec/src/exec_events.rs @f8c6026c). The event carries message only;
// the CLI does not emit a machine code.
const CODEX_QUOTA_MESSAGE =
  "You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.";

describe("codex terminal quota classification", () => {
  it("recognizes the canonical Codex quota diagnostic on a failed turn", () => {
    for (const message of [
      CODEX_QUOTA_MESSAGE,
      "Quota exceeded. Check your plan and billing details.",
      "Your workspace is out of credits. Add credits to continue.",
      "You hit your spend cap set by the owner of your workspace. Ask an owner to increase your spend cap to continue.",
      `stream disconnected after retries: ${CODEX_QUOTA_MESSAGE}`,
    ]) {
      const stream = JSON.stringify({ type: "turn.failed", error: { message } });
      const result = classifyTerminalOutput("codex", stream, "");
      expect(result.status, message).toBe("usage-exhausted");
      expect(result.code).toBe("codex_usage_limit_exceeded");
    }
  });

  it("recognizes a quota diagnostic in an unrecoverable stream error event", () => {
    const stream = JSON.stringify({ type: "error", message: CODEX_QUOTA_MESSAGE });
    expect(classifyTerminalOutput("codex", stream, "").status).toBe("usage-exhausted");
  });

  it("lets a final turn.completed win over an earlier failed or error event", () => {
    const completed = JSON.stringify({ type: "turn.completed", usage: {} });
    for (const earlier of [
      JSON.stringify({ type: "turn.failed", error: { message: CODEX_QUOTA_MESSAGE } }),
      JSON.stringify({ type: "error", message: CODEX_QUOTA_MESSAGE }),
    ]) {
      expect(
        classifyTerminalOutput("codex", `${earlier}\n${completed}`, "").status
      ).toBeNull();
    }
  });

  it("never lets stderr JSON override or substitute for the stdout protocol stream", () => {
    const failed = JSON.stringify({ type: "turn.failed", error: { message: CODEX_QUOTA_MESSAGE } });
    const completed = JSON.stringify({ type: "turn.completed", usage: {} });
    expect(
      classifyTerminalOutput("codex", completed, failed).status
    ).toBeNull();
    expect(
      classifyTerminalOutput("codex", "", failed).status
    ).toBeNull();
  });

  it("ignores generated text, nested JSON, and nonterminal events entirely", () => {
    const generated = JSON.stringify({
      type: "item.completed",
      item: {
        type: "agent_message",
        text: JSON.stringify({ code: "insufficient_quota" }),
      },
    });
    expect(classifyTerminalOutput("codex", generated, "").status).toBeNull();

    const proseQuota = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: CODEX_QUOTA_MESSAGE },
    });
    const done = JSON.stringify({ type: "turn.completed", usage: {} });
    expect(classifyTerminalOutput("codex", `${proseQuota}\n${done}`, "").status).toBeNull();

    const itemError = JSON.stringify({
      type: "item.completed",
      item: { type: "error", message: CODEX_QUOTA_MESSAGE },
    });
    expect(classifyTerminalOutput("codex", itemError, "").status).toBeNull();
  });

  it("refuses quoted, generic, and non-quota terminal messages", () => {
    for (const message of [
      `"${CODEX_QUOTA_MESSAGE}"`,
      `{"message":"${CODEX_QUOTA_MESSAGE}"}`,
      "rate limit exceeded: 429 Too Many Requests",
      "Selected model is at capacity. Please try a different model.",
      "shared rollout token budget exhausted",
      "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
      "turn aborted. Something went wrong? Hit `/feedback` to report the issue.",
      "insufficient_quota",
      "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
    ]) {
      const stream = JSON.stringify({ type: "turn.failed", error: { message } });
      expect(
        classifyTerminalOutput("codex", stream, "").status,
        message
      ).toBeNull();
    }
    expect(
      classifyTerminalOutput("codex", "You exceeded your current quota", "").status
    ).toBeNull();
    expect(
      classifyTerminalOutput("codex", "", "HTTP 429 too many requests").status
    ).toBeNull();
  });

  it("classifies the same envelope from a zero-exit terminal error result", () => {
    const envelope = { type: "turn.failed", error: { message: CODEX_QUOTA_MESSAGE } };
    const result = classifyTerminalEnvelope("codex", envelope);
    expect(result.status).toBe("usage-exhausted");
    expect(result.code).toBe("codex_usage_limit_exceeded");
    expect(
      classifyTerminalEnvelope("codex", {
        type: "turn.failed",
        error: { message: "aborted" },
      }).status
    ).toBeNull();
  });
});

const GROK_FREE_USAGE_MESSAGE =
  "You\u2019ve reached your free Grok Build usage limit for now. Get SuperGrok for much higher limits, or try again later: https://grok.com/supergrok?referrer=grok-build";

describe("grok terminal quota classification", () => {
  it("recognizes the canonical free-usage diagnostic on an error result", () => {
    const result = {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: [GROK_FREE_USAGE_MESSAGE],
    };
    for (const classification of [
      classifyTerminalEnvelope("grok", result),
      classifyTerminalOutput("grok", JSON.stringify(result), ""),
    ]) {
      expect(classification.status).toBe("usage-exhausted");
      expect(classification.code).toBe("grok_free_usage_exhausted");
    }
    const prefixed = JSON.stringify({ type: "assistant", message: { content: [] } });
    expect(
      classifyTerminalOutput("grok", `${prefixed}\n${JSON.stringify(result)}`, "").status
    ).toBe("usage-exhausted");
  });

  it("lets a later successful result supersede an earlier quota error", () => {
    const earlier = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      errors: [GROK_FREE_USAGE_MESSAGE],
    });
    const success = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
    });
    expect(
      classifyTerminalOutput("grok", `${earlier}\n${success}`, "").status
    ).toBeNull();
  });

  it("refuses generated content, quoted, generic, and wrong-position diagnostics", () => {
    const generated = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: `The error was: ${GROK_FREE_USAGE_MESSAGE}`,
    });
    expect(classifyTerminalOutput("grok", generated, "").status).toBeNull();

    for (const result of [
      { type: "result", subtype: "error_during_execution", is_error: true, errors: [`"${GROK_FREE_USAGE_MESSAGE}"`] },
      { type: "result", subtype: "error_during_execution", is_error: true, errors: [`note: ${GROK_FREE_USAGE_MESSAGE}`] },
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["HTTP 429 too many requests"] },
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["HTTP 403 forbidden"] },
      { type: "result", subtype: "error_during_execution", is_error: true, errors: ["insufficient_quota"] },
      { type: "result", subtype: "error_max_turns", is_error: true, errors: [GROK_FREE_USAGE_MESSAGE] },
      { type: "result", subtype: "error_during_execution", is_error: false, errors: [GROK_FREE_USAGE_MESSAGE] },
      { type: "error", subtype: "error_during_execution", is_error: true, errors: [GROK_FREE_USAGE_MESSAGE] },
    ]) {
      expect(
        classifyTerminalEnvelope("grok", result).status,
        JSON.stringify(result)
      ).toBeNull();
      expect(
        classifyTerminalOutput("grok", JSON.stringify(result), "").status,
        JSON.stringify(result)
      ).toBeNull();
    }
    expect(classifyTerminalOutput("grok", GROK_FREE_USAGE_MESSAGE, "").status).toBeNull();
  });
});

describe("other providers have no substantiated quota envelope", () => {
  it("keeps structured quota-looking envelopes as ordinary failures", () => {
    for (const [provider, envelope] of [
      ["claude", { is_error: true, errors: [JSON.stringify({ type: "error", error: { type: "insufficient_quota" } })] }],
      ["cursor", { type: "result", subtype: "error_during_execution", is_error: true }],
      ["devin", { error: { code: "quota_exhausted" } }],
    ] as const) {
      expect(
        classifyTerminalEnvelope(provider, envelope).status,
        provider
      ).toBeNull();
      expect(
        classifyTerminalOutput(provider, JSON.stringify(envelope), "").status,
        provider
      ).toBeNull();
    }
  });
});

describe("ambient credential and routing takeover guard", () => {
  it("names ambient API credential takeover without exposing values", () => {
    expect(apiCredentialTakeover("cursor", { CURSOR_API_KEY: "secret" })).toBe(
      "CURSOR_API_KEY"
    );
    expect(apiCredentialTakeover("cursor", { CURSOR_API_KEY: "   " })).toBeNull();
    expect(apiCredentialTakeover("claude", { ANTHROPIC_API_KEY: "secret" })).toBe(
      "ANTHROPIC_API_KEY"
    );
    expect(apiCredentialTakeover("codex", { ANTHROPIC_API_KEY: "secret" })).toBeNull();
    expect(apiCredentialTakeover("grok", { XAI_API_KEY: "secret" })).toBe(
      "XAI_API_KEY"
    );
    expect(apiCredentialTakeover("grok", { GROK_CODE_XAI_API_KEY: "secret" })).toBe(
      "GROK_CODE_XAI_API_KEY"
    );
    expect(apiCredentialTakeover("devin", {})).toBeNull();
  });

  it("covers known Claude alternate-auth and provider-selection controls", () => {
    for (const env of [
      { ANTHROPIC_AUTH_TOKEN: "token" },
      { ANTHROPIC_AWS_API_KEY: "key" },
      { CLAUDE_CODE_USE_BEDROCK: "1" },
      { CLAUDE_CODE_USE_VERTEX: "true" },
      { CLAUDE_CODE_USE_FOUNDRY: "yes" },
      { ANTHROPIC_BASE_URL: "https://gateway.example" },
      { ANTHROPIC_CUSTOM_HEADERS: "x: y" },
    ]) {
      expect(apiCredentialTakeover("claude", env), JSON.stringify(env)).not.toBeNull();
    }
    for (const env of [
      { CLAUDE_CODE_USE_BEDROCK: "0" },
      { CLAUDE_CODE_USE_VERTEX: "false" },
      { CLAUDE_CODE_USE_FOUNDRY: "  " },
      { ANTHROPIC_BASE_URL: "" },
    ]) {
      expect(apiCredentialTakeover("claude", env), JSON.stringify(env)).toBeNull();
    }
    expect(
      apiCredentialTakeover("codex", { CLAUDE_CODE_USE_BEDROCK: "1" })
    ).toBeNull();
  });
});

describe("subscription auth evidence", () => {
  const claudeSubscription = JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    apiProvider: "firstParty",
    subscriptionType: "pro",
  });

  it("accepts first-party claude.ai auth and rejects API/helper/alternate/unknown auth", () => {
    expect(
      subscriptionAuthEvidence("claude", claudeSubscription, "")
    ).toMatchObject({ compatible: true });
    for (const stdout of [
      JSON.stringify({ loggedIn: true, authMethod: "apiKey", apiProvider: "firstParty" }),
      JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock" }),
      JSON.stringify({ loggedIn: true, authMethod: "apiKeyHelper", apiProvider: "firstParty" }),
      JSON.stringify({ loggedIn: true }),
      JSON.stringify({ loggedIn: false }),
      "not json",
    ]) {
      const verdict = subscriptionAuthEvidence("claude", stdout, "");
      expect(verdict?.compatible, stdout).toBe(false);
    }
  });

  it("distinguishes ChatGPT auth from API-key auth for codex", () => {
    expect(
      subscriptionAuthEvidence("codex", "Logged in using ChatGPT", "")
    ).toMatchObject({ compatible: true });
    for (const stdout of [
      "Logged in using an API key",
      "Logged in",
      "Logged in using ChatGPT but see https://example.com",
      "Logged in using ChatGPT\nextra diagnostic line",
      "mention of chatgpt is not a status line",
      "Logged in using ChatGPT\nwarning: api key fallback configured",
    ]) {
      expect(
        subscriptionAuthEvidence("codex", stdout, "")?.compatible,
        stdout
      ).toBe(false);
    }
    expect(
      subscriptionAuthEvidence("codex", "", "Logged in using an API key")?.compatible
    ).toBe(false);
  });

  it("reports no separate auth-method evidence for devin and cursor", () => {
    for (const provider of ["devin", "cursor"] as const) {
      expect(subscriptionAuthEvidence(provider, "Logged in", "")).toBeNull();
    }
  });
});

it("blocks Grok subscription-only routing despite a logged-in banner", () => {
  expect(subscriptionAuthEvidence("grok", "Logged in as subscriber\ngrok-4.7", ""))
    .toMatchObject({ compatible: false });
});

it("blocks custom Devin and Cursor endpoints without exposing their values", () => {
  expect(apiCredentialTakeover("devin", { DEVIN_API_URL: "https://alternate.invalid" })).toBe("DEVIN_API_URL");
  expect(apiCredentialTakeover("cursor", { CURSOR_API_ENDPOINT: "alternate.invalid" })).toBe("CURSOR_API_ENDPOINT");
});
