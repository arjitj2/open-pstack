import { type AccessMode, type Effort, type RunnerOptions, UsageError } from "./types.ts";

export function validateCursorModel(model: string, effort: Effort): void {
  if (effort !== "default") throw new UsageError("Cursor requires default effort; select reasoning variants by their exact model slug");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model) || model.toLowerCase() === "auto") {
    throw new UsageError("Cursor requires an exact model slug from cursor-agent models, not auto");
  }
}

export function cursorConfigDirectory(options: RunnerOptions): string {
  return `${options.receiptPath}.cursor-config`;
}

export function cursorConfig(mode: AccessMode): object {
  return {
    version: 1,
    editor: { vimMode: false },
    permissions: {
      allow: [],
      deny: [
        "Mcp(*:*)", "WebFetch(*)",
        ...(mode === "read-only" ? ["Write(**)", "Shell(*)"] : []),
      ],
    },
  };
}
