import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

export function cursorConfig(mode: AccessMode, configPath: string = cursorUserConfigPath()): object {
  const network = cursorTransport(configPath);
  return {
    version: 1,
    ...(network === undefined ? {} : { network }),
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

export function cursorHasApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CURSOR_API_KEY?.trim().length ?? 0) > 0;
}

export function cursorUserConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  userHome: string = homedir(),
  cwd: string = process.cwd()
): string {
  const directory = env.CURSOR_CONFIG_DIR?.trim()
    ? env.CURSOR_CONFIG_DIR
    : env.XDG_CONFIG_HOME?.trim()
      ? join(env.XDG_CONFIG_HOME, "cursor")
      : join(userHome, ".cursor");
  return resolve(cwd, directory, "cli-config.json");
}

function cursorTransport(configPath: string): { useHttp1ForAgent: boolean } | undefined {
  let contents: string;
  try {
    contents = readFileSync(configPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let config: unknown;
  try {
    config = JSON.parse(contents);
  } catch {
    throw new UsageError(`Cursor global configuration is not valid JSON: ${configPath}`);
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) return undefined;
  const network = (config as { network?: unknown }).network;
  if (network === null || typeof network !== "object" || Array.isArray(network)) return undefined;
  const useHttp1ForAgent = (network as { useHttp1ForAgent?: unknown }).useHttp1ForAgent;
  return typeof useHttp1ForAgent === "boolean" ? { useHttp1ForAgent } : undefined;
}
