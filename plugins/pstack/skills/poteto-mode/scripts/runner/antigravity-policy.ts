import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OutputValidationError, UsageError } from "./types.ts";

export class AntigravityPolicyError extends UsageError {
  constructor(readonly source: string, readonly key: string) {
    super(`Antigravity unsupported policy ${source}: ${key}; disable this customization before running a writer`);
  }
}

type Identity = { kind: "absent" } | { kind: "present"; dev: number; ino: number; digest: string };
type Source = { path: string; identity: Identity };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const code = (error: unknown): unknown => object(error) ? error.code : undefined;
const within = (root: string, path: string): boolean => { const part = relative(root, path); return part === "" || (!part.startsWith("..") && !isAbsolute(part)); };
function policyIdentity(path: string): Identity {
  try {
    realAncestry(path);
    const stat = lstatSync(path);
    if (!stat.isFile() && !stat.isDirectory()) throw new UsageError(`Antigravity policy source must not be a symlink: ${path}`);
    return { kind: "present", dev: stat.dev, ino: stat.ino, digest: createHash("sha256").update(stat.isFile() ? readFileSync(path) : JSON.stringify(readdirSync(path).sort())).digest("hex") };
  } catch (error) { if (code(error) === "ENOENT") return { kind: "absent" }; throw error; }
}
function realAncestry(path: string): void {
  let current = resolve(path);
  while (true) {
    try { if (lstatSync(current).isSymbolicLink()) throw new UsageError(`Antigravity policy ancestry must be real: ${current}`); } catch (error) { if (code(error) !== "ENOENT") throw error; }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
function json(path: string): Record<string, unknown> {
  try {
    realAncestry(path);
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (object(value)) return value;
  } catch { throw new UsageError(`Antigravity cannot establish policy from ${path}; remove unsupported or unreadable configuration`); }
  throw new UsageError(`Antigravity malformed policy: ${path}`);
}
function rejectKey(path: string, key: string): never { throw new AntigravityPolicyError(path, key); }
function captureSources(root: string, home: string, env: NodeJS.ProcessEnv): Source[] {
  for (const key of Object.keys(env)) {
    if ((key.startsWith("AGY_") && key !== "AGY_ADC_AUTH" && !key.startsWith("AGY_GATEWAY_") && !key.startsWith("AGY_LLM_GATEWAY_") && !(key === "AGY_CLI_DISABLE_AUTO_UPDATE" && env[key] === "true")) || /^(ANTIGRAVITY|GEMINI_CLI)_/.test(key)) rejectKey("environment", key);
  }
  const sources: Source[] = [];
  const capture = (path: string): Identity => { const identity = policyIdentity(path); sources.push({ path, identity }); return identity; };
  const settings = join(home, ".gemini/antigravity-cli/settings.json");
  if (capture(settings).kind === "present") {
    for (const [key, value] of Object.entries(json(settings))) {
      if (key === "modelProvider" || key === "modelConfigOverrides") continue;
      if (key === "trustedWorkspaces" && Array.isArray(value) && value.every(item => typeof item === "string")) continue;
      rejectKey(settings, key);
    }
  }
  for (const path of [join(home, ".gemini/config/config.json"), join(home, ".gemini/config/hooks.json")]) {
    if (capture(path).kind === "present") for (const key of Object.keys(json(path))) rejectKey(path, key);
  }
  const project = join(home, ".gemini/config/projects/default-cli-project.json");
  if (capture(project).kind === "absent") throw new UsageError(`Antigravity requires an established default project at ${project}; create the default CLI project before running a writer`);
  const value = json(project);
  for (const key of Object.keys(value)) if (!["id", "name", "projectResources"].includes(key)) rejectKey(project, key);
  if (value.id !== "default-cli-project" || typeof value.name !== "string" || !object(value.projectResources) || Object.keys(value.projectResources).length !== 0) rejectKey(project, "id/name/projectResources");
  for (const path of [join(home, ".gemini/config/plugins"), join(home, ".gemini/antigravity-cli/plugins"), join(root, ".agents/plugins")]) {
    if (capture(path).kind === "absent") continue;
    realAncestry(path);
    if (!lstatSync(path).isDirectory()) rejectKey(path, "plugin root");
    for (const entry of readdirSync(path)) {
      const catalog = join(path, entry);
      if (path !== join(root, ".agents/plugins") || entry !== "marketplace.json") rejectKey(path, entry);
      capture(catalog);
      const catalogValue = json(catalog);
      if (catalogValue.name !== "open-pstack" || !Array.isArray(catalogValue.plugins) || Object.keys(catalogValue).some(key => !["name", "interface", "plugins"].includes(key))) rejectKey(catalog, "catalog shape");
    }
  }
  return sources;
}
export interface WriterBoundary {
  assertUnchanged(): void;
  verifySettlement(conversationId: string): void;
  cleanup(): void;
}
export function createWriterBoundary(input: { root: string; agentPath: string; model: string; tools: readonly string[]; writeTools: readonly string[]; home?: string; env?: NodeJS.ProcessEnv }): WriterBoundary {
  const root = realpathSync(input.root);
  const home = realpathSync(input.home ?? homedir());
  realAncestry(root);
  realAncestry(home);
  const sources = captureSources(root, home, input.env ?? process.env);
  const hookPath = join(root, ".agents/hooks.json");
  if (policyIdentity(hookPath).kind !== "absent") throw new AntigravityPolicyError(hookPath, "existing workspace hooks");
  const directory = mkdtempSync(join(home, ".pstack-antigravity-"));
  const controlIdentity = lstatSync(directory);
  const assertControl = (): void => {
    const current = lstatSync(directory);
    if (!current.isDirectory() || current.dev !== controlIdentity.dev || current.ino !== controlIdentity.ino) throw new OutputValidationError(`Antigravity external control ownership changed: ${directory}`);
  };
  const owned: Source[] = [];
  const controls: { path: string; dev: number; ino: number }[] = [];
  const controlOwned = (control: typeof controls[number]): boolean => {
    const stat = lstatSync(control.path);
    return stat.isFile() && stat.dev === control.dev && stat.ino === control.ino;
  };
  let cleaned = false;
  const assertSources = (): void => {
    assertControl();
    for (const source of [...sources, ...owned]) if (JSON.stringify(policyIdentity(source.path)) !== JSON.stringify(source.identity)) throw new OutputValidationError(`Antigravity policy source changed: ${source.path}`);
  };
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    assertControl();
    const lost: string[] = [];
    for (const source of [...owned].reverse()) {
      try {
        if (JSON.stringify(policyIdentity(source.path)) !== JSON.stringify(source.identity)) { lost.push(source.path); continue; }
        unlinkSync(source.path);
      } catch { lost.push(source.path); }
    }
    for (const control of controls) {
      try { if (controlOwned(control)) unlinkSync(control.path); else lost.push(control.path); } catch (error) { if (code(error) !== "ENOENT") lost.push(control.path); }
    }
    try { assertControl(); rmdirSync(directory); } catch { lost.push(directory); }
    if (lost.length) throw new OutputValidationError(`Antigravity cleanup lost ownership: ${lost.join(", ")}`);
  };
  const writeOwned = (path: string, content: string): void => { writeFileSync(path, content, { flag: "wx", mode: 0o600 }); owned.push({ path, identity: policyIdentity(path) }); };
  try {
    for (const writable of [root, realpathSync(tmpdir()), join(home, ".cache"), join(home, "Library/Caches")]) if (within(writable, directory)) throw new UsageError("Antigravity external control would be inside a writable root");
    writeOwned(join(directory, "guard.mjs"), readFileSync(fileURLToPath(new URL("./antigravity-guard.mjs", import.meta.url)), "utf8"));
    for (const [name, content] of [["state.json", JSON.stringify({ conversationId: null })], ["idle", "0"], ["denied", "0"]]) {
      const path = join(directory, name);
      writeFileSync(path, content, { flag: "wx", mode: 0o600 });
      const stat = lstatSync(path); controls.push({ path, dev: stat.dev, ino: stat.ino });
    }
    sources.push({ path: input.agentPath, identity: policyIdentity(input.agentPath) });
    const quote = (word: string): string => `'${word.replaceAll("'", "'\\''")}'`;
    const command = `${quote(process.execPath)} ${quote(join(directory, "guard.mjs"))}`;
    const hook = (stage: string) => ({ type: "command", command: `${command} ${stage}` });
    writeOwned(hookPath, JSON.stringify({ pstack: { SessionStart: [hook("start")], PreToolUse: [{ matcher: input.tools.join("|"), hooks: [hook("pre")] }], PostToolUse: [{ matcher: input.tools.join("|"), hooks: [hook("post")] }], Stop: [hook("stop")] } }));
    sources.push({ path: hookPath, identity: policyIdentity(hookPath) });
    writeOwned(join(directory, "policy.json"), JSON.stringify({ root, model: input.model, tools: input.tools, writeTools: input.writeTools, protected: [input.agentPath, hookPath], sources, controls: Object.fromEntries(controls.map(control => [control.path.slice(directory.length + 1), { dev: control.dev, ino: control.ino }])) }));
    assertSources();
  } catch (error) {
    try { cleanup(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], "Antigravity writer preparation failed and cleanup lost ownership"); }
    throw error;
  }
  return {
    assertUnchanged: assertSources,
    verifySettlement(conversationId) {
      assertSources();
      if (controls.some(control => !controlOwned(control))) throw new OutputValidationError("Antigravity guard state ownership changed");
      const value: unknown = JSON.parse(readFileSync(join(directory, "state.json"), "utf8"));
      if (!object(value) || value.conversationId !== conversationId || readFileSync(join(directory, "idle"), "utf8") !== "1" || readFileSync(join(directory, "denied"), "utf8") !== "0") throw new OutputValidationError("Antigravity guard did not prove an idle, bound, denial-free session");
    },
    cleanup,
  };
}
