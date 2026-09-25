import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AccessMode, type Effort, type RunnerOptions, UsageError } from "./types.ts";

export const ANTIGRAVITY_READ_TOOLS = ["view_file", "list_dir", "grep_search"] as const;
export const ANTIGRAVITY_WRITE_TOOLS = ["write_to_file", "replace_file_content", "multi_replace_file_content"] as const;

export interface AntigravityLaneFiles {
  readonly directory: string;
  readonly agentName: string;
  readonly agentPath: string;
  readonly childCwd: string;
}

export interface AntigravityCreatedFiles {
  readonly files: AntigravityLaneFiles;
  assertUnchanged(): void;
  cleanup(): void;
}

export function validateAntigravityModel(model: string, effort: Effort): void {
  if (effort !== "default") throw new UsageError("Antigravity requires default effort; choose an exact effort-embedded model slug");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model) || model.toLowerCase() === "auto") {
    throw new UsageError("Antigravity requires an exact slug from agy models, not auto");
  }
}

export function antigravityLaneFiles(options: RunnerOptions): AntigravityLaneFiles {
  const agentName = `pstack-${createHash("sha256").update(options.receiptPath).digest("hex").slice(0, 16)}`;
  const childCwd = options.mode === "read-only" ? `${options.receiptPath}.antigravity` : options.cwd;
  const directory = join(childCwd, ".agents", "agents");
  return { directory, agentName, agentPath: join(directory, `${agentName}.md`), childCwd };
}

export function antigravityTools(mode: AccessMode): readonly string[] {
  return mode === "read-only"
    ? ANTIGRAVITY_READ_TOOLS
    : [...ANTIGRAVITY_READ_TOOLS, ...ANTIGRAVITY_WRITE_TOOLS];
}

export function antigravityAgentDefinition(name: string, mode: AccessMode): string {
  const tools = antigravityTools(mode).join(", ");
  return `---\nname: ${name}\ndescription: One pstack assigned lane\ntools: [${tools}]\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\n---\nWork only on the assigned task. Do not delegate, run commands, use network tools, or change this agent definition.\n`;
}

export function createAntigravityLaneFiles(options: RunnerOptions): AntigravityCreatedFiles {
  const files = antigravityLaneFiles(options);
  if (options.mode === "isolated-write" && !lstatSync(files.childCwd).isDirectory()) {
    throw new UsageError("Antigravity writer cwd must be a real directory");
  }
  const root = join(files.childCwd, ".agents");
  const createdDirectories: string[] = [];
  const definition = antigravityAgentDefinition(files.agentName, options.mode);
  let identity: { dev: number; ino: number } | null = null;
  try {
    if (options.mode === "read-only") {
      mkdirSync(files.childCwd, { mode: 0o700 });
      createdDirectories.push(files.childCwd);
    }
    for (const directory of [root, files.directory]) {
      try {
        mkdirSync(directory, { mode: 0o700 });
        createdDirectories.push(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !lstatSync(directory).isDirectory()) throw error;
      }
    }
    writeFileSync(files.agentPath, definition, { flag: "wx", mode: 0o600 });
    const stat = lstatSync(files.agentPath);
    identity = { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    for (const directory of createdDirectories.reverse()) {
      try { rmdirSync(directory); } catch {}
    }
    throw error;
  }
  const assertUnchanged = (): void => {
    if (identity === null) throw new Error("antigravity agent definition is missing");
    const stat = lstatSync(files.agentPath);
    if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino ||
        readFileSync(files.agentPath, "utf8") !== definition) {
      throw new Error("antigravity agent definition changed during execution");
    }
  };
  return {
    files,
    assertUnchanged,
    cleanup() {
      if (options.mode === "read-only") {
        rmSync(files.childCwd, { recursive: true, force: true });
        return;
      }
      try {
        assertUnchanged();
        rmSync(files.agentPath);
      } catch {}
      for (const directory of createdDirectories.reverse()) {
        try { rmdirSync(directory); } catch {}
      }
    },
  };
}

export function antigravityStdin(prompt: string, cwd: string, mode: AccessMode): string {
  const instruction = mode === "read-only"
    ? `Inspect the assigned workspace at ${cwd}. Do not write files.`
    : `Edit only the assigned dedicated worktree at ${cwd}. File tools only; the parent runs tests.`;
  return `${JSON.stringify({ event: "user", message: { content: `${instruction}\n\n${prompt}` } })}\n`;
}

export function antigravitySettingsPath(home: string = homedir()): string {
  return join(home, ".gemini", "antigravity-cli", "settings.json");
}

export function antigravitySettingsTakeover(path: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return "Antigravity settings.json unreadable";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "Antigravity settings.json malformed";
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Antigravity settings.json malformed";
  }
  const settings = parsed as Record<string, unknown>;
  if (Object.hasOwn(settings, "modelProvider")) return "Antigravity settings.json modelProvider";
  if (Object.hasOwn(settings, "modelConfigOverrides")) return "Antigravity settings.json modelConfigOverrides";
  return null;
}

export type AntigravityEvent = Record<string, unknown>;

export function antigravityEvents(stdout: string): AntigravityEvent[] {
  const events: AntigravityEvent[] = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new Error("antigravity emitted a non-JSON event"); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
        typeof (parsed as Record<string, unknown>).event !== "string") {
      throw new Error("antigravity emitted a non-object event");
    }
    events.push(parsed as AntigravityEvent);
  }
  return events;
}

export function antigravitySuccessfulResult(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.status === "SUCCESS" && typeof result.response === "string" &&
    result.response.trim().length > 0 && !Object.hasOwn(result, "denied_actions");
}

export function auditAntigravityStream(stdout: string, files: AntigravityLaneFiles, mode: AccessMode, requestedModel: string): void {
  const events = antigravityEvents(stdout);
  const first = events[0];
  const init = first?.event === "init" && first.init !== null && typeof first.init === "object" && !Array.isArray(first.init)
    ? first.init as Record<string, unknown> : null;
  if (init?.model !== requestedModel || init?.agent !== files.agentName) {
    throw new Error("antigravity init did not match the requested model and agent");
  }
  const allowed = new Set(antigravityTools(mode));
  for (const [index, event] of events.entries()) {
    if (index > 0 && event.event === "init") throw new Error("antigravity emitted more than one init");
    if (event.event !== "step_update") continue;
    const step = event.step_update;
    if (step === null || typeof step !== "object" || Array.isArray(step)) throw new Error("antigravity emitted a malformed step");
    const detail = step as Record<string, unknown>;
    if (detail.step_type === "tool" && (typeof detail.tool_name !== "string" || !allowed.has(detail.tool_name))) {
      throw new Error("antigravity used a tool outside its assigned allowlist");
    }
  }
}
