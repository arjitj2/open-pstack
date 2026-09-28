import { describe, expect, it } from "bun:test";
import { parseProviderOutput, reportedModelMatches } from "./parse-output.ts";
import { ProviderToolDeniedError } from "./provider-failure.ts";

const CLAUDE_SESSION = "claude-session";

function claudeInit(model = "fable", session: unknown = CLAUDE_SESSION): string {
  return JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: session,
    model,
  });
}

function claudeAssistant(
  model: unknown,
  parent: unknown = null,
  session: unknown = CLAUDE_SESSION
): string {
  return JSON.stringify({
    type: "assistant",
    session_id: session,
    parent_tool_use_id: parent,
    message: {
      role: "assistant",
      model,
      content: [{ type: "text", text: "ok" }],
    },
  });
}

function claudeResult(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "CLAUDE_OK",
    session_id: CLAUDE_SESSION,
    ...extra,
  });
}

describe("parseProviderOutput", () => {
  it("rejects result-only Claude usage as primary-model evidence", () => {
    expect(() => parseProviderOutput("claude", JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "MAIN_RESPONSE",
      session_id: CLAUDE_SESSION,
      modelUsage: {
        "claude-sonnet-4-6": { outputTokens: 100 },
        "claude-opus-4-6": { outputTokens: 1 },
      },
    }), "", "opus")).toThrow("primary assistant model");
  });

  it("extracts Claude text, primary model, usage, cost, and session from a stream", () => {
    const parsed = parseProviderOutput(
      "claude",
      [
        claudeInit(),
        claudeAssistant("claude-fable-9-9"),
        claudeAssistant("claude-fable-9-9"),
        claudeResult({
          usage: { input_tokens: 10, output_tokens: 3 },
          total_cost_usd: 0.05,
          modelUsage: { "claude-fable-9-9": { inputTokens: 10 } },
        }),
      ].join("\n"),
      "",
      "fable"
    );
    expect(parsed).toMatchObject({
      text: "CLAUDE_OK",
      reportedModel: "claude-fable-9-9",
      sessionId: "claude-session",
      usage: { inputTokens: 10, outputTokens: 3 },
      costUsd: 0.05,
    });
  });

  it("extracts Codex JSONL without inventing a provider-reported model", () => {
    const parsed = parseProviderOutput(
      "codex",
      [
        JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "CODEX_OK" },
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: {
            input_tokens: 20,
            cached_input_tokens: 4,
            output_tokens: 5,
            reasoning_output_tokens: 2,
          },
        }),
      ].join("\n"),
      "model: gpt-5.6-sol\nreasoning effort: max\n",
      "gpt-5.6-sol"
    );
    expect(parsed).toMatchObject({
      text: "CODEX_OK",
      reportedModel: null,
      sessionId: "codex-session",
      usage: {
        inputTokens: 20,
        cachedInputTokens: 4,
        outputTokens: 5,
        reasoningTokens: 2,
      },
    });
  });

  it("accepts Grok's reported build suffix", () => {
    const parsed = parseProviderOutput(
      "grok",
      [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "progress" }] },
        }),
        JSON.stringify({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "GROK_OK",
          session_id: "grok-session",
          usage: {
            input_tokens: 30,
            cache_read_input_tokens: 6,
            output_tokens: 7,
            reasoning_tokens: 3,
            total_tokens: 43,
          },
          total_cost_usd: 0.02,
          modelUsage: { "grok-4.7-build": {} },
        }),
      ].join("\n"),
      "",
      "grok-4.7"
    );
    expect(parsed.text).toBe("GROK_OK");
    expect(parsed.reportedModel).toBe("grok-4.7-build");
    expect(reportedModelMatches("grok", "grok-4.7", parsed.reportedModel)).toBe(
      true
    );
  });

  it("verifies a valid Claude primary that reports alongside helpers", () => {
    const parsed = parseProviderOutput(
      "claude",
      [
        claudeInit(),
        claudeAssistant("claude-haiku-4-5-20251001", "toolu_helper_1"),
        claudeAssistant("claude-fable-9-9"),
        claudeResult({
          modelUsage: {
            "claude-haiku-4-5-20251001": {},
            "claude-fable-9-9": {},
          },
        }),
      ].join("\n"),
      "",
      "fable"
    );
    expect(parsed.reportedModel).toBe("claude-fable-9-9");
    expect(
      reportedModelMatches("claude", "fable", parsed.reportedModel)
    ).toBe(true);
  });

  it("does not let helper Claude events or modelUsage prove the requested model", () => {
    const parsed = parseProviderOutput(
      "claude",
      [
        claudeInit("opus"),
        claudeAssistant("claude-sonnet-9-9"),
        claudeAssistant("claude-opus-9", "toolu_helper_1"),
        claudeResult({
          modelUsage: {
            "claude-sonnet-9-9": {},
            "claude-opus-9": {},
          },
        }),
      ].join("\n"),
      "",
      "opus"
    );
    expect(parsed.reportedModel).toBe("claude-sonnet-9-9");
    expect(
      reportedModelMatches("claude", "opus", parsed.reportedModel)
    ).toBe(false);
  });

  it("rejects a Claude stream with helper-only or missing primary evidence", () => {
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          claudeAssistant("claude-fable-9-9", "toolu_helper_1"),
          claudeResult({ modelUsage: { "claude-fable-9-9": {} } }),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("primary assistant model");
    // init.model echoes the request; it is not a provider report
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeInit(), claudeResult()].join("\n"),
        "",
        "fable"
      )
    ).toThrow("primary assistant model");
  });

  it("rejects Claude streams reporting multiple primary models", () => {
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          claudeAssistant("claude-fable-9-9"),
          claudeAssistant("claude-opus-9"),
          claudeResult(),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("multiple primary models");
  });

  it("rejects Claude assistant events with ambiguous ownership, foreign sessions, or missing models", () => {
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          JSON.stringify({
            type: "assistant",
            session_id: CLAUDE_SESSION,
            message: { role: "assistant", model: "claude-fable-9-9" },
          }),
          claudeResult(),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("owner");
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeAssistant("claude-fable-9-9", 5), claudeResult()].join("\n"),
        "",
        "fable"
      )
    ).toThrow("owner");
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          claudeAssistant("claude-fable-9-9", null, "other-session"),
          claudeResult(),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("another session");
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeAssistant(undefined), claudeResult()].join("\n"),
        "",
        "fable"
      )
    ).toThrow("did not report a model");
  });

  it("rejects malformed or unterminated Claude streams", () => {
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeAssistant("claude-fable-9-9"), "not-json", claudeResult()].join(
          "\n"
        ),
        "",
        "fable"
      )
    ).toThrow("malformed stream event");
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeAssistant("claude-fable-9-9"), "42", claudeResult()].join("\n"),
        "",
        "fable"
      )
    ).toThrow("malformed stream event");
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeAssistant("claude-fable-9-9")].join("\n"),
        "",
        "fable"
      )
    ).toThrow("terminal result");
    expect(() =>
      parseProviderOutput(
        "claude",
        [claudeAssistant("claude-fable-9-9"), claudeResult(), claudeInit()].join(
          "\n"
        ),
        "",
        "fable"
      )
    ).toThrow("exactly one result");
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          claudeAssistant("claude-fable-9-9"),
          claudeResult(),
          claudeResult(),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("exactly one result");
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          claudeAssistant("claude-fable-9-9"),
          claudeResult({ session_id: undefined }),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("session");
    expect(() =>
      parseProviderOutput(
        "claude",
        [
          claudeAssistant("claude-fable-9-9"),
          claudeResult({ result: undefined }),
        ].join("\n"),
        "",
        "fable"
      )
    ).toThrow("final text");
  });

  it("requires explicit Claude success without classifying malformed results as terminal errors", async () => {
    const { ProviderTerminalError } = await import("./provider-failure.ts");
    for (const fields of [{ subtype: "error_during_execution" }, { is_error: undefined }, { is_error: "false" }]) {
      const parse = () => parseProviderOutput("claude", [
        claudeAssistant("claude-fable-9-9"), claudeResult(fields),
      ].join("\n"), "", "fable");
      expect(parse).toThrow("explicit success");
      try {
        parse();
      } catch (error) {
        expect(error).not.toBeInstanceOf(ProviderTerminalError);
      }
    }
  });

  it("matches only concrete Claude revisions from the requested rolling family", () => {
    expect(reportedModelMatches("claude", "fable", "claude-fable-9-9")).toBe(true);
    expect(reportedModelMatches("claude", "opus", "claude-opus-9")).toBe(true);
    expect(reportedModelMatches("claude", "sonnet", "claude-sonnet-9-9")).toBe(true);
    expect(reportedModelMatches("claude", "fable", "claude-opus-9")).toBe(false);
    expect(reportedModelMatches("claude", "sonnet", "claude-opus-9")).toBe(false);
    expect(reportedModelMatches("claude", "sonnet", "claude-sonnet-beta")).toBe(false);
    expect(reportedModelMatches("claude", "fable", "claude-fable-beta")).toBe(false);
    expect(reportedModelMatches("claude", "fable", "fable")).toBe(false);
    expect(reportedModelMatches("claude", "fable", "fable-preview")).toBe(false);
    expect(reportedModelMatches("grok", "fable", "claude-fable-9-9")).toBe(false);
  });

  it("matches new Claude family revisions without accepting another family", () => {
    expect(reportedModelMatches("claude", "haiku", "claude-haiku-4-5")).toBe(true);
    expect(reportedModelMatches("claude", "haiku", "claude-haiku-4-5-1")).toBe(true);
    expect(reportedModelMatches("claude", "haiku", "claude-sonnet-4-5")).toBe(false);
    expect(reportedModelMatches("claude", "haiku", "claude-haiku-beta")).toBe(false);
    expect(reportedModelMatches("claude", "haiku", "haiku")).toBe(true);
    expect(reportedModelMatches("claude", "haiku", "claude-haiku")).toBe(false);
  });

  it("accepts exact future model IDs without interpreting their spelling as an alias", () => {
    expect(reportedModelMatches("claude", "nova", "nova")).toBe(true);
    expect(reportedModelMatches("claude", "nova2", "claude-nova2-1-0")).toBe(true);
    expect(reportedModelMatches("claude", "nova-pro", "claude-nova-pro-2-1")).toBe(true);
    expect(reportedModelMatches("claude", "nova-pro", "claude-nova-pro-beta")).toBe(false);
    expect(reportedModelMatches("claude", "nova-pro", "claude-other-2-1")).toBe(false);
  });

  it("keeps exact Claude IDs exact instead of widening them", () => {
    expect(reportedModelMatches("claude", "claude-haiku-4-5", "claude-haiku-4-5")).toBe(true);
    expect(reportedModelMatches("claude", "claude-haiku-4-5", "claude-haiku-4-6")).toBe(false);
    expect(reportedModelMatches("claude", "claude-haiku-4-5", "claude-opus-4-5")).toBe(false);
  });

  it("rejects malformed or textless responses", () => {
    expect(() =>
      parseProviderOutput("claude", "not-json", "", "fable")
    ).toThrow("terminal result");
    expect(() =>
      parseProviderOutput(
        "codex",
        JSON.stringify({ type: "turn.completed" }),
        "",
        "gpt-5.6-sol"
      )
    ).toThrow("final agent message");
  });
});

describe("structured provider terminal errors", () => {
  it("throws a typed terminal error carrying Claude's error envelope", async () => {
    const { ProviderTerminalError } = await import("./provider-failure.ts");
    expect(() =>
      parseProviderOutput(
        "claude",
        JSON.stringify({
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "",
          errors: [
            JSON.stringify({
              type: "error",
              error: { type: "insufficient_quota", message: "quota exhausted" },
            }),
          ],
        }),
        "",
        "opus"
      )
    ).toThrow(ProviderTerminalError);
  });

  it("lets Claude's terminal error result win over stream structure faults", async () => {
    const { ProviderTerminalError } = await import("./provider-failure.ts");
    const envelope = {
      type: "result",
      subtype: "success",
      is_error: true,
      api_error_status: 429,
      terminal_reason: "api_error",
      result: "You've hit your session limit \u00b7 resets 4pm",
      session_id: "claude-session",
    };
    expect(() =>
      parseProviderOutput(
        "claude",
        ["not-json", JSON.stringify(envelope), claudeAssistant("claude-opus-9")].join(
          "\n"
        ),
        "",
        "opus"
      )
    ).toThrow(ProviderTerminalError);
    try {
      parseProviderOutput(
        "claude",
        JSON.stringify(envelope),
        "",
        "opus"
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(
        (error as InstanceType<typeof ProviderTerminalError>).envelope
      ).toEqual(envelope);
    }
  });

  it("throws a typed terminal error carrying Codex's failed-turn envelope", async () => {
    const { ProviderTerminalError } = await import("./provider-failure.ts");
    try {
      parseProviderOutput(
        "codex",
        [
          JSON.stringify({ type: "thread.started", thread_id: "t1" }),
          JSON.stringify({
            type: "turn.failed",
            error: { code: "usage_limit_reached", message: "usage limit reached" },
          }),
        ].join("\n"),
        "",
        "gpt-5.6-sol"
      );
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderTerminalError);
      const envelope = (error as InstanceType<typeof ProviderTerminalError>).envelope as {
        error?: { code?: string };
      };
      expect(envelope.error?.code).toBe("usage_limit_reached");
    }
  });

  it("keeps malformed output untyped", () => {
    expect(() => parseProviderOutput("claude", "not json", "", "opus")).not.toThrow(
      "usage-exhausted"
    );
    expect(() =>
      parseProviderOutput("cursor", "null", "", "composer-2.5")
    ).toThrow("terminal result envelope");
  });
});

describe("provider-owned tool denial evidence", () => {
  it("classifies Devin's headless rejection frame as verified denial evidence", () => {
    const stderr =
      "warning: rejected a tool call that requires confirmation. Running in non-interactive mode. Use --permission-mode dangerous to auto-approve all tools.";
    try {
      parseProviderOutput("devin", "", stderr, "swe-2");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderToolDeniedError);
      const denied = error as InstanceType<typeof ProviderToolDeniedError>;
      expect(denied.denial.verified).toBe(true);
      expect(denied.denial.tool).toBeNull();
      expect(denied.denial.requestedAction).toBeNull();
      expect(denied.receiptStatus).toBe("malformed-output");
    }
  });

  it("does not treat unrelated devin stderr as denial evidence", () => {
    expect(() =>
      parseProviderOutput("devin", "", "some ordinary warning", "swe-2")
    ).not.toThrow(ProviderToolDeniedError);
  });

  it("classifies antigravity denied_actions as verified denial evidence", () => {
    const stream = [
      JSON.stringify({ event: "init", conversation_id: "c1", init: { model: "gemini-3.1-pro-high" } }),
      JSON.stringify({ event: "result", conversation_id: "c1", result: { conversation_id: "c1", num_turns: 1, denied_actions: [{ tool: "run_command", action: "git commit" }], response: "", is_error: true } }),
    ].join("\n");
    try {
      parseProviderOutput("antigravity", stream, "", "gemini-3.1-pro-high");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderToolDeniedError);
      const denied = error as InstanceType<typeof ProviderToolDeniedError>;
      expect(denied.denial.verified).toBe(true);
      expect(denied.denial.cause).toBe("unknown");
      expect(denied.denial.evidence).toBe("antigravity_denied_actions_present");
      expect(denied.receiptStatus).toBe("child-failed");
    }
  });

  it("does not convert empty or malformed Antigravity denials into permission recovery", () => {
    for (const actions of [null, [], [null], ["guard"]]) {
      const stream = [
        JSON.stringify({ event: "init", conversation_id: "c1", init: { model: "gemini-3.1-pro-high" } }),
        JSON.stringify({ event: "result", conversation_id: "c1", result: { conversation_id: "c1", num_turns: 1, denied_actions: actions, response: "", is_error: true } }),
      ].join("\n");
      expect(() => parseProviderOutput("antigravity", stream, "", "gemini-3.1-pro-high"))
        .toThrow();
    }
    const guarded = [
      JSON.stringify({ event: "init", conversation_id: "c1", init: { model: "gemini-3.1-pro-high" } }),
      JSON.stringify({ event: "result", conversation_id: "c1", result: { conversation_id: "c1", num_turns: 1, denied_actions: [{ reason: "safety_guard" }], response: "", is_error: true } }),
    ].join("\n");
    try {
      parseProviderOutput("antigravity", guarded, "", "gemini-3.1-pro-high");
      throw new Error("expected denial");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderToolDeniedError);
      expect((error as ProviderToolDeniedError).denial.cause).toBe("unknown");
    }
  });
});
