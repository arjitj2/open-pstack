import { describe, expect, it } from "bun:test";
import { parseProviderOutput, reportedModelMatches } from "./parse-output.ts";

describe("parseProviderOutput", () => {
  it("extracts Claude text, model, usage, cost, and session", () => {
    const parsed = parseProviderOutput(
      "claude",
      JSON.stringify({
        result: "CLAUDE_OK",
        session_id: "claude-session",
        usage: { input_tokens: 10, output_tokens: 3 },
        total_cost_usd: 0.05,
        modelUsage: { "claude-fable-9-9": { inputTokens: 10 } },
      }),
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

  it("selects the requested Claude model when usage includes a side model", () => {
    const parsed = parseProviderOutput(
      "claude",
      JSON.stringify({
        result: "CLAUDE_OK",
        modelUsage: {
          "claude-haiku-4-5-20251001": {},
          "claude-fable-9-9": {},
        },
      }),
      "",
      "fable"
    );
    expect(parsed.reportedModel).toBe("claude-fable-9-9");
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
    ).toThrow("valid JSON");
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
          result: "",
          is_error: true,
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
