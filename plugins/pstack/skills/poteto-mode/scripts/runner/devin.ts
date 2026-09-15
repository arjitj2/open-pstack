import { UsageError, type Effort, type RunnerOptions } from "./types.ts";

export function devinModel(model: string, effort: Effort): string {
  if (model === "swe-2" && ["medium", "high", "max"].includes(effort)) {
    return `swe-2-${effort}`;
  }
  if (model === "swe-1.6" && effort === "default") return "swe-1-6";
  throw new UsageError(
    "Devin supports swe-2 at medium/high/max or swe-1.6 at default effort"
  );
}

export function devinConfigPath(options: RunnerOptions): string {
  return `${options.receiptPath}.devin-config.json`;
}

export function devinConfig(options: RunnerOptions) {
  return {
    subagents_enabled: false,
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
        "mcp__*", "fetch",
        ...(options.mode === "read-only" ? ["exec", "edit", "write", "Write(**)"] : []),
      ],
    },
  };
}
