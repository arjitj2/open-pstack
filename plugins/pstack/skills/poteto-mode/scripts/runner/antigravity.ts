import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createWriterBoundary, type WriterBoundary } from "./antigravity-policy.ts";
import { type AccessMode, type Effort, OutputValidationError, type RunnerOptions, UsageError } from "./types.ts";

export const ANTIGRAVITY_READ_TOOLS = ["view_file", "list_dir", "grep_search"] as const;
export const ANTIGRAVITY_COMMAND_TOOLS = ["run_command", "manage_task"] as const;
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
  verifySettlement(conversationId: string): void;
  cleanup(): void;
}

export function antigravityWriterVersion(stdout: string): string | null {
  const version = stdout.trim();
  const match = /^1\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version);
  return match !== null && match.slice(1).every(part => Number.isSafeInteger(Number(part))) ? version : null;
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
    : [...ANTIGRAVITY_READ_TOOLS, ...ANTIGRAVITY_WRITE_TOOLS, ...ANTIGRAVITY_COMMAND_TOOLS];
}

export function antigravityAgentDefinition(name: string, mode: AccessMode): string {
  const tools = antigravityTools(mode).join(", ");
  return `---\nname: ${name}\ndescription: One pstack assigned lane\ntools: [${tools}]\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: ${mode === "read-only" ? "off" : "sandbox"}\n---\nWork only on the assigned task. Do not delegate, use network tools, or change this agent definition or workspace hooks. ${mode === "read-only" ? "Do not run commands." : "Run suitable checks in the sandbox. Prefer foreground commands; use manage_task or native completion to collect background exit results. Stop on denial without retry or workaround."}\n`;
}

export function createAntigravityLaneFiles(options: RunnerOptions): AntigravityCreatedFiles {
  const files = antigravityLaneFiles(options);
  if (options.mode === "isolated-write" && (!lstatSync(files.childCwd).isDirectory() || realpathSync(files.childCwd) !== files.childCwd)) {
    throw new UsageError("Antigravity writer cwd must be a real directory");
  }
  const root = join(files.childCwd, ".agents");
  const createdDirectories: { path: string; dev: number; ino: number }[] = [];
  const rememberDirectory = (path: string): void => {
    const stat = lstatSync(path);
    createdDirectories.push({ path, dev: stat.dev, ino: stat.ino });
  };
  const ownsDirectory = (directory: typeof createdDirectories[number]): boolean => {
    try {
      const stat = lstatSync(directory.path);
      return stat.isDirectory() && stat.dev === directory.dev && stat.ino === directory.ino;
    } catch { return false; }
  };
  const removeDirectories = (): string[] => {
    const lost: string[] = [];
    for (const directory of [...createdDirectories].reverse()) {
      if (!ownsDirectory(directory)) { lost.push(directory.path); continue; }
      try { rmdirSync(directory.path); } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || (error.code !== "ENOTEMPTY" && error.code !== "EEXIST")) lost.push(directory.path);
      }
    }
    return lost;
  };
  const definition = antigravityAgentDefinition(files.agentName, options.mode);
  let identity: { dev: number; ino: number } | null = null;
  let preparation: { kind: "read-only" } | { kind: "writer"; boundary: WriterBoundary } = { kind: "read-only" };
  let cleaned = false;
  try {
    if (options.mode === "read-only") {
      mkdirSync(files.childCwd, { mode: 0o700 });
      rememberDirectory(files.childCwd);
    }
    for (const directory of [root, files.directory]) {
      try {
        mkdirSync(directory, { mode: 0o700 });
        rememberDirectory(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !lstatSync(directory).isDirectory()) throw error;
      }
    }
    writeFileSync(files.agentPath, definition, { flag: "wx", mode: 0o600 });
    const stat = lstatSync(files.agentPath);
    identity = { dev: stat.dev, ino: stat.ino };
    if (options.mode === "isolated-write") preparation = { kind: "writer", boundary: createWriterBoundary({ root: files.childCwd, agentPath: files.agentPath, model: options.model, tools: antigravityTools(options.mode), writeTools: ANTIGRAVITY_WRITE_TOOLS }) };
  } catch (error) {
    if (identity !== null) {
      const stat = lstatSync(files.agentPath);
      if (stat.isFile() && stat.dev === identity.dev && stat.ino === identity.ino && readFileSync(files.agentPath, "utf8") === definition) rmSync(files.agentPath);
    }
    const lost = removeDirectories();
    if (lost.length) throw new AggregateError([error], `Antigravity preparation failed and directory ownership was lost: ${lost.join(", ")}`);
    throw error;
  }
  const assertUnchanged = (): void => {
    if (options.mode === "isolated-write" && createdDirectories.some(directory => !ownsDirectory(directory))) throw new OutputValidationError("Antigravity workspace directory ownership changed");
    if (identity === null) throw new OutputValidationError("antigravity agent definition is missing");
    const stat = lstatSync(files.agentPath);
    if (!stat.isFile() || stat.dev !== identity.dev || stat.ino !== identity.ino ||
        readFileSync(files.agentPath, "utf8") !== definition) {
      throw new OutputValidationError("antigravity agent definition changed during execution");
    }
  };
  return {
    files,
    assertUnchanged() { assertUnchanged(); if (preparation.kind === "writer") preparation.boundary.assertUnchanged(); },
    verifySettlement(conversationId) { assertUnchanged(); if (preparation.kind === "writer") preparation.boundary.verifySettlement(conversationId); },
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      if (options.mode === "read-only") {
        rmSync(files.childCwd, { recursive: true, force: true });
        return;
      }
      let failure: unknown = null;
      try { if (preparation.kind === "writer") preparation.boundary.cleanup(); } catch (error) { failure = error; }
      try {
        assertUnchanged();
        rmSync(files.agentPath);
      } catch (error) { failure ??= error; }
      const lost = removeDirectories();
      if (lost.length) failure ??= new OutputValidationError(`Antigravity cleanup lost directory ownership: ${lost.join(", ")}`);
      if (failure !== null) throw failure;
    },
  };
}

export function antigravityStdin(prompt: string, cwd: string, mode: AccessMode): string {
  const instruction = mode === "read-only"
    ? `Inspect the assigned workspace at ${cwd}. Do not write files.`
    : `Edit only the assigned dedicated worktree at ${cwd}.`;
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
    try { parsed = JSON.parse(line); } catch { throw new OutputValidationError("antigravity emitted a non-JSON event"); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
        typeof (parsed as Record<string, unknown>).event !== "string") {
      throw new OutputValidationError("antigravity emitted a non-object event");
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
    throw new OutputValidationError("antigravity init did not match the requested model and agent");
  }
  const allowed = new Set(antigravityTools(mode));
  for (const [index, event] of events.entries()) {
    if (index > 0 && event.event === "init") throw new OutputValidationError("antigravity emitted more than one init");
    if (event.event !== "step_update") continue;
    const step = event.step_update;
    if (step === null || typeof step !== "object" || Array.isArray(step)) throw new OutputValidationError("antigravity emitted a malformed step");
    const detail = step as Record<string, unknown>;
    if (detail.step_type === "tool" && (typeof detail.tool_name !== "string" || !allowed.has(detail.tool_name))) {
      throw new OutputValidationError("antigravity used a tool outside its assigned allowlist");
    }
  }
}
