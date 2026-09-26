import { readFileSync } from "node:fs";
import { UsageError, type Effort, type RunnerOptions } from "./types.ts";

export function devinModel(model: string, effort: Effort): string {
  if (model === "swe-2" && ["medium", "high", "max"].includes(effort)) {
    return `swe-2-${effort}`;
  }
  if (model === "swe-1.6" && effort === "default") return "swe-1-6";
  if (effort === "default") return model;
  if (model === "swe-2" || model === "swe-1.6") {
    throw new UsageError(
      "Devin supports swe-2 at medium/high/max or swe-1.6 at default effort"
    );
  }
  throw new UsageError(
    `Devin has no separate effort flag; pass an exact CLI model UID as devin:<uid>@default (got ${model}@${effort})`
  );
}

export function devinConfigPath(options: RunnerOptions): string {
  return `${options.receiptPath}.devin-config.json`;
}

export function devinExportDirectory(options: RunnerOptions): string {
  return `${options.receiptPath}.devin-export`;
}

export function devinExportPath(options: RunnerOptions): string {
  return `${devinExportDirectory(options)}/turn.json`;
}

export function devinPromptPath(options: RunnerOptions): string {
  return options.mode === "isolated-write"
    ? `${devinExportDirectory(options)}/prompt.md`
    : options.promptPath;
}

export function devinWriterPrompt(prompt: string): string {
  return "Execution constraints for this Devin worker:\n" +
    "You are running non-interactively in an isolated-write workspace. " +
    "Direct write and edit tools are disabled and terminate the run if attempted. " +
    "Use sandboxed exec for ALL file creation, modification, and testing, including the first file operation. " +
    "Do not request permissions or use direct write/edit tools. " +
    "Keep all changes inside the assigned working directory.\n\nAssigned task:\n" + prompt;
}

export function readDevinExport(options: RunnerOptions): string {
  try {
    return readFileSync(devinExportPath(options), "utf8");
  } catch {
    throw new Error("devin did not produce a readable export");
  }
}

export function devinConfig(options: RunnerOptions) {
  return {
    shell: { setup_complete: true },
    subagents_enabled: false,
    disabled_tools: options.mode === "read-only" ? ["exec"] : [],
    auto_update: false,
    notify: "never",
    read_config_from: {
      agents_standard: false,
      cursor: false,
      windsurf: false,
      claude: false,
      copilot: false,
      opencode: false,
      zed: false,
    },
    permissions: {
      deny: [
        "mcp__*", "fetch", "edit", "write",
        ...(options.mode === "read-only" ? ["exec", "Write(**)"] : []),
      ],
    },
  };
}
