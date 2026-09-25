import { cursorHasApiKey } from "./cursor.ts";
import { antigravityLaneFiles } from "./antigravity.ts";
import type {
  AccessMode,
  Effort,
  Provider,
  RunnerOptions,
} from "./types.ts";

import { devinConfigPath, devinExportPath, devinModel, devinPromptPath } from "./devin.ts";

export interface CommandSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly stdin: "prompt" | "prompt-ndjson" | "none";
  readonly cwd?: string;
}

export function preflightCommand(provider: Provider, apiSpend: RunnerOptions["apiSpend"] = null): CommandSpec {
  switch (provider) {
    case "devin":
      return { command: "devin", args: ["auth", "status"], stdin: "none" };
    case "cursor":
      return {
        command: "cursor-agent",
        args: cursorHasApiKey() ? ["--version"] : ["status", "--format", "json"],
        stdin: "none",
      };
    case "claude":
      return {
        command: "claude",
        args: [...(apiSpend === "deny" ? ["--setting-sources", ""] : []), "auth", "status", "--json"],
        stdin: "none",
      };
    case "codex":
      return {
        command: "codex",
        args: ["login", "status"],
        stdin: "none",
      };
    case "grok":
      return { command: "grok", args: ["models"], stdin: "none" };
    case "antigravity":
      return { command: "agy", args: ["models"], stdin: "none" };
  }
}

function claudeDeniedTools(mode: AccessMode): string {
  const always = ["Agent", "Task", "WebSearch", "WebFetch"];
  const readonly = ["Edit", "Write", "NotebookEdit"];
  return [...always, ...(mode === "read-only" ? readonly : [])].join(",");
}

function claudeTools(mode: AccessMode): string {
  return mode === "read-only"
    ? "Read,Grep,Glob,Bash"
    : "Read,Write,Edit,Grep,Glob,Bash";
}

function codexSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace-write";
}

function grokSandbox(mode: AccessMode): string {
  return mode === "read-only" ? "read-only" : "workspace";
}

function grokTools(mode: AccessMode): string {
  const readonly = ["read_file", "grep", "list_dir", "run_terminal_cmd"];
  return [...readonly, ...(mode === "isolated-write" ? ["search_replace"] : [])].join(",");
}

function permissionMode(mode: AccessMode): string {
  return mode === "read-only" ? "plan" : "acceptEdits";
}

function effortOverride(effort: Effort): string {
  return `model_reasoning_effort=${JSON.stringify(effort)}`;
}

export function invocationCommand(options: RunnerOptions): CommandSpec {
  switch (options.provider) {
    case "antigravity": {
      const files = antigravityLaneFiles(options);
      return {
        command: "agy",
        args: [
          "--print=", "--output-format", "stream-json", "--input-format", "stream-json",
          "--model", options.model, "--agent", files.agentName, "--sandbox",
          ...(options.mode === "read-only"
            ? ["--disable-slash-commands", "--add-dir", options.cwd]
            : ["--mode", "accept-edits"]),
        ],
        stdin: "prompt-ndjson",
        cwd: files.childCwd,
      };
    }
    case "devin":
      return {
        command: "devin",
        args: [
          "--config",
          devinConfigPath(options),
          "--model",
          devinModel(options.model, options.effort),
          ...(options.mode === "isolated-write"
            ? ["--sandbox"]
            : ["--permission-mode", "auto"]),
          "--respect-workspace-trust",
          "false",
          "--prompt-file",
          devinPromptPath(options),
          "--export",
          devinExportPath(options),
          "--print",
        ],
        stdin: "none",
      };
    case "cursor":
      return {
        command: "cursor-agent",
        args: [
          "--print", "--output-format", "json", "--trust",
          "--model", options.model,
          "--workspace", options.cwd,
          "--sandbox", "enabled",
          ...(options.mode === "read-only" ? ["--mode", "ask"] : []),
        ],
        stdin: "prompt",
      };
    case "claude":
      return {
        command: "claude",
        args: [
          "-p",
          "--model",
          options.model,
          "--effort",
          options.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--setting-sources",
          options.apiSpend === "deny" ? "" : "project",
          "--strict-mcp-config",
          "--tools",
          claudeTools(options.mode),
          "--no-session-persistence",
          "--disable-slash-commands",
          "--disallowed-tools",
          claudeDeniedTools(options.mode),
          "--output-format",
          "json",
        ],
        stdin: "prompt",
      };
    case "codex":
      return {
        command: "codex",
        args: [
          "exec",
          "--model",
          options.model,
          "--config",
          effortOverride(options.effort),
          "--sandbox",
          codexSandbox(options.mode),
          "--cd",
          options.cwd,
          "--skip-git-repo-check",
          "--ephemeral",
          "--disable",
          "plugins",
          "--disable",
          "multi_agent",
          "--disable",
          "hooks",
          "--disable",
          "memories",
          "--json",
          "-",
        ],
        stdin: "prompt",
      };
    case "grok":
      return {
        command: "grok",
        args: [
          "--prompt-file",
          options.promptPath,
          "--model",
          options.model,
          "--reasoning-effort",
          options.effort,
          "--permission-mode",
          permissionMode(options.mode),
          "--sandbox",
          grokSandbox(options.mode),
          "--tools",
          grokTools(options.mode),
          "--disallowed-tools",
          "Agent,search_tool,use_tool",
          "--output-format",
          "streaming-messages-json",
          "--cwd",
          options.cwd,
          "--no-subagents",
          "--disable-web-search",
          "--verbatim",
        ],
        stdin: "none",
      };
  }
}
