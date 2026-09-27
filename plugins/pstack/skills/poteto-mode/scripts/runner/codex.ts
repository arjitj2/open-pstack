type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export type CodexTerminal =
  | { readonly kind: "completed"; readonly event: JsonObject }
  | { readonly kind: "failed"; readonly message: string | null; readonly event: JsonObject };

type CompletedCodexTerminal = Extract<CodexTerminal, { kind: "completed" }>;
type FailedCodexTerminal = Extract<CodexTerminal, { kind: "failed" }>;

export type CodexAssessment =
  | {
      readonly kind: "accepted";
      readonly terminal: CompletedCodexTerminal;
      readonly text: string;
      readonly sessionId: string | null;
    }
  | { readonly kind: "failed"; readonly terminal: FailedCodexTerminal }
  | {
      readonly kind: "rejected";
      readonly terminal: CodexTerminal | null;
      readonly reason: string;
    };

export function codexTerminalEvent(
  events: readonly JsonObject[]
): CodexTerminal | null {
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
      terminal = { kind: "completed", event };
    }
  }
  return terminal;
}

function terminalObjects(text: string): JsonObject[] {
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

export function assessCodexTranscript(stdout: string): CodexAssessment {
  const terminal = codexTerminalEvent(terminalObjects(stdout));

  let nonJson = false;
  let fault: string | null = null;
  const fail = (reason: string): void => {
    if (fault === null) fault = reason;
  };
  let framed = false;
  let implicit = false;
  let open = false;
  let turnText: string | undefined;
  let finalText: string | undefined;
  let finalEvent: JsonObject | null = null;
  let sessionId: string | null = null;

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      nonJson = true;
      continue;
    }
    const event = object(raw);
    if (event === null) {
      fail("codex emitted a non-object event");
      continue;
    }
    if (event.type === "thread.started") {
      const id =
        typeof event.thread_id === "string" && event.thread_id.length > 0
          ? event.thread_id
          : null;
      if (id !== null) {
        if (sessionId !== null && sessionId !== id) {
          fail("codex reported conflicting thread IDs");
        } else {
          sessionId = id;
        }
      }
    } else if (event.type === "turn.started") {
      if (open) {
        fail("codex started a turn inside an unfinished turn");
      } else if (implicit) {
        fail("codex mixed framed and unframed turn activity");
      } else {
        framed = true;
        open = true;
        turnText = undefined;
        finalEvent = null;
        finalText = undefined;
      }
    } else if (event.type === "turn.completed" || event.type === "turn.failed") {
      if (framed && !open) {
        fail("codex emitted a turn event outside an open turn");
      } else {
        if (!open) implicit = true;
        if (event.type === "turn.completed") {
          finalEvent = event;
          finalText = turnText;
        } else {
          finalEvent = null;
          finalText = undefined;
        }
        open = false;
        turnText = undefined;
      }
    } else if (
      typeof event.type === "string" &&
      event.type.startsWith("item.")
    ) {
      const item = object(event.item);
      if (event.type === "item.completed" && item?.type === "error") continue;
      if (framed && !open) {
        fail("codex emitted an item event outside an open turn");
      } else {
        if (!open) {
          implicit = true;
          open = true;
          turnText = undefined;
        }
        if (event.type === "item.completed") {
          if (item?.type === "agent_message") {
            turnText =
              typeof item.text === "string" ? item.text : undefined;
          }
        }
      }
    }
  }

  if (nonJson) {
    return {
      kind: "rejected",
      terminal,
      reason: "codex emitted a non-JSON event",
    };
  }
  if (terminal?.kind === "failed") {
    return { kind: "failed", terminal };
  }
  if (fault !== null) {
    return { kind: "rejected", terminal, reason: fault };
  }
  if (open) {
    return {
      kind: "rejected",
      terminal,
      reason: "codex final turn did not complete",
    };
  }
  if (finalEvent === null) {
    return {
      kind: "rejected",
      terminal,
      reason: "codex did not complete a turn",
    };
  }
  if (
    typeof finalText !== "string" ||
    finalText.trim().length === 0
  ) {
    return {
      kind: "rejected",
      terminal,
      reason: "codex result did not contain a final agent message",
    };
  }
  return {
    kind: "accepted",
    terminal: { kind: "completed", event: finalEvent },
    text: finalText,
    sessionId,
  };
}
