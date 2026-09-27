import { describe, expect, it } from "bun:test";
import { parseProviderOutput } from "./parse-output.ts";
import type { NormalizedUsage } from "./types.ts";
import {
  ProviderTerminalError,
  classifyProcessOutcome,
  hasTerminalSuccess,
  type ProviderProcessOutcome,
} from "./provider-failure.ts";

const QUOTA =
  "You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again later.";

const thread = (id?: unknown) =>
  id === undefined
    ? { type: "thread.started" }
    : { type: "thread.started", thread_id: id };
const start = { type: "turn.started" };
const message = (text: unknown) => ({
  type: "item.completed",
  item: { type: "agent_message", text },
});
const tool = {
  type: "item.completed",
  item: { type: "command_execution", aggregated_output: "tool" },
};
const diagnostic = {
  type: "item.completed",
  item: { type: "error", message: "Ignoring malformed agent role definition" },
};
const itemStarted = { type: "item.started", item: { type: "agent_message" } };
const complete = (usage?: unknown) =>
  usage === undefined
    ? { type: "turn.completed" }
    : { type: "turn.completed", usage };
const failed = (message = "generic backend error") => ({
  type: "turn.failed",
  error: { message },
});
const errorEvent = (message = "transient stream error") => ({ type: "error", message });

interface TranscriptCase {
  readonly name: string;
  readonly events: readonly (Record<string, unknown> | string)[];
  readonly stdout?: string;
  readonly parse: "accept" | "reject" | "fail";
  readonly text?: string;
  readonly sessionId?: string | null;
  readonly usage?: NormalizedUsage | null;
  readonly reason?: string;
  readonly terminalSuccess: boolean;
  readonly quota: "usage-exhausted" | null;
}

const cases: readonly TranscriptCase[] = [
  {
    name: "error item inside a turn preserves its final text",
    events: [start, message("answer"), diagnostic, complete()],
    parse: "accept",
    text: "answer",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "startup error items do not open an implicit turn",
    events: [thread("t1"), diagnostic, diagnostic, start, tool, message("answer"), complete()],
    parse: "accept",
    text: "answer",
    sessionId: "t1",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "error item after completion does not open a new turn",
    events: [start, message("answer"), complete(), diagnostic],
    parse: "accept",
    text: "answer",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "error items alone are not completed work",
    events: [thread("t1"), diagnostic],
    parse: "reject",
    terminalSuccess: false,
    quota: null,
  },
  {
    name: "error item in a new turn cannot reuse earlier text",
    events: [start, message("old"), complete(), start, diagnostic, complete()],
    parse: "reject",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "minimal unframed message and completion",
    events: [message("answer"), complete()],
    parse: "accept",
    text: "answer",
    sessionId: null,
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "framed thread, turn, message, completion with usage",
    events: [
      thread("t1"),
      start,
      message("answer"),
      complete({ input_tokens: 7, output_tokens: 2 }),
    ],
    parse: "accept",
    text: "answer",
    sessionId: "t1",
    usage: { inputTokens: 7, outputTokens: 2 },
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "thread.started without a thread_id is allowed",
    events: [thread(), message("answer"), complete()],
    parse: "accept",
    text: "answer",
    sessionId: null,
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "recovered top-level error before completion",
    events: [errorEvent("stream error: reconnecting"), thread("t1"), message("answer"), complete()],
    parse: "accept",
    text: "answer",
    sessionId: "t1",
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "top-level error inside a turn does not reset its text",
    events: [thread("t1"), start, message("answer"), errorEvent(), complete()],
    parse: "accept",
    text: "answer",
    sessionId: "t1",
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "failed turn followed by a later completed turn with new text",
    events: [message("A"), failed(), message("B"), complete()],
    parse: "accept",
    text: "B",
    sessionId: null,
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "framed failed turn followed by a new completed turn",
    events: [thread("t1"), start, message("A"), failed(), start, message("B"), complete({ output_tokens: 4 })],
    parse: "accept",
    text: "B",
    sessionId: "t1",
    usage: { outputTokens: 4 },
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "multiple turns report the final turn's usage only",
    events: [message("A"), complete({ input_tokens: 3 }), message("B"), complete({ output_tokens: 9 })],
    parse: "accept",
    text: "B",
    sessionId: null,
    usage: { outputTokens: 9 },
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "final turn without usage does not reuse an earlier turn's",
    events: [message("A"), complete({ input_tokens: 3 }), message("B"), complete()],
    parse: "accept",
    text: "B",
    sessionId: null,
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "two framed turns",
    events: [start, message("A"), complete(), start, message("B"), complete()],
    parse: "accept",
    text: "B",
    sessionId: null,
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "unknown event object types are ignored",
    events: [message("answer"), { type: "turn.context", a: 1 }, complete(), { type: "future" }],
    parse: "accept",
    text: "answer",
    sessionId: null,
    usage: null,
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "item-only stream (issue reproduction)",
    events: [message("unfinished-answer")],
    parse: "reject",
    reason: "did not complete",
    terminalSuccess: false,
    quota: null,
  },
  {
    name: "thread and message without a terminal event",
    events: [thread("t1"), message("answer")],
    parse: "reject",
    reason: "did not complete",
    terminalSuccess: false,
    quota: null,
  },
  {
    name: "empty stream",
    events: [],
    stdout: "",
    parse: "reject",
    terminalSuccess: false,
    quota: null,
  },
  {
    name: "tool-only turn",
    events: [tool, complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "turn.completed alone",
    events: [complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "later empty completed turn invalidates earlier text",
    events: [message("A"), complete(), complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "explicit blank final message invalidates earlier text",
    events: [message("A"), message("  "), complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "explicit empty final message invalidates earlier text",
    events: [message("A"), message(""), complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "non-string final message invalidates earlier text",
    events: [message("A"), message(42), complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "non-JSON line rejects a completed stream",
    events: [message("answer"), "not json", complete()],
    parse: "reject",
    reason: "non-JSON event",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "non-object JSON line rejects a completed stream",
    events: [message("answer"), "42", complete()],
    parse: "reject",
    reason: "non-object",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "JSON array line rejects a completed stream",
    events: [message("answer"), "[1,2]", complete()],
    parse: "reject",
    reason: "non-object",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "pretty-printed terminal JSON rejects but keeps the veto",
    events: [],
    stdout: JSON.stringify(
      { type: "turn.completed", usage: { input_tokens: 1 } },
      null,
      2
    ),
    parse: "reject",
    reason: "non-JSON event",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "unframed dangling item after completion",
    events: [message("A"), complete(), message("B")],
    parse: "reject",
    reason: "did not complete",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "unframed dangling item.started after completion",
    events: [message("A"), complete(), itemStarted],
    parse: "reject",
    reason: "did not complete",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "framed later turn left unfinished",
    events: [start, message("A"), complete(), start, message("B")],
    parse: "reject",
    reason: "did not complete",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "framed item activity outside an open turn",
    events: [start, message("A"), complete(), message("B")],
    parse: "reject",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "nested turn.started",
    events: [start, message("A"), start, message("B"), complete()],
    parse: "reject",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "mixed framed and unframed activity",
    events: [message("A"), complete(), start, message("B"), complete()],
    parse: "reject",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "two different thread IDs",
    events: [thread("a"), message("answer"), thread("b"), complete()],
    parse: "reject",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "failed turn closes its text segment",
    events: [message("A"), failed(), complete()],
    parse: "reject",
    reason: "final agent message",
    terminalSuccess: true,
    quota: null,
  },
  {
    name: "final failed quota turn is a typed failure",
    events: [thread("t1"), message("A"), failed(QUOTA)],
    parse: "fail",
    terminalSuccess: false,
    quota: "usage-exhausted",
  },
  {
    name: "quota error event after completion terminalizes failed",
    events: [message("A"), complete(), errorEvent(QUOTA)],
    parse: "fail",
    terminalSuccess: false,
    quota: "usage-exhausted",
  },
  {
    name: "malformed-first precedence over a failed quota turn",
    events: ["garbage", failed(QUOTA)],
    parse: "reject",
    reason: "non-JSON event",
    terminalSuccess: false,
    quota: "usage-exhausted",
  },
];

function stream(row: TranscriptCase): string {
  return (
    row.stdout ??
    row.events
      .map((event) =>
        typeof event === "string" ? event : JSON.stringify(event)
      )
      .join("\n")
  );
}

function outcome(stdout: string): ProviderProcessOutcome {
  return { stdout, stderr: "", exitCode: 0 };
}

describe("codex transcript assessment", () => {
  for (const row of cases) {
    it(`${row.name}`, () => {
      const stdout = stream(row);
      let parsed: ReturnType<typeof parseProviderOutput> | null = null;
      let error: unknown = null;
      try {
        parsed = parseProviderOutput("codex", stdout, "", "gpt-5.6-sol");
      } catch (caught) {
        error = caught;
      }

      if (row.parse === "accept") {
        expect(error, row.name).toBeNull();
        expect(parsed).not.toBeNull();
        expect(parsed?.text).toBe(row.text);
        expect(parsed?.sessionId).toBe(row.sessionId ?? null);
        expect(parsed?.reportedModel).toBeNull();
        expect(parsed?.costUsd).toBeNull();
        if (row.usage === null || row.usage === undefined) {
          expect(parsed?.usage).toBeNull();
        } else {
          expect(parsed?.usage).toMatchObject(row.usage);
        }
      } else if (row.parse === "reject") {
        expect(error, row.name).toBeInstanceOf(Error);
        expect(error, row.name).not.toBeInstanceOf(ProviderTerminalError);
        if (row.reason !== undefined) {
          expect(String(error)).toContain(row.reason);
        }
      } else {
        expect(error, row.name).toBeInstanceOf(ProviderTerminalError);
      }

      expect(
        hasTerminalSuccess("codex", outcome(stdout)),
        `${row.name} terminalSuccess`
      ).toBe(row.terminalSuccess);
      if (row.parse === "accept") {
        expect(row.terminalSuccess, `${row.name} accepted ⇒ completed`).toBe(
          true
        );
      }

      expect(
        classifyProcessOutcome("codex", outcome(stdout)).status,
        `${row.name} quota`
      ).toBe(row.quota);
    });
  }
});
