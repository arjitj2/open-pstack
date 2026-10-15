import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { UsageError } from "./types.ts";

export interface OpenCodeShell {
  readonly directory: string;
  readonly executable: string;
  readonly files: Readonly<Record<string, string>>;
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createOpenCodeShell(cwd: string): OpenCodeShell {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new UsageError("OpenCode shell writers require macOS or Linux with Anthropic sandbox-runtime dependencies available");
  }
  const runtime = resolve(dirname(fileURLToPath(import.meta.resolve("@anthropic-ai/sandbox-runtime"))), "cli.js");
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pstack-opencode-shell-")));
  try {
    const root = realpathSync(cwd);
    const inside = relative(root, directory);
    if (inside !== ".." && !inside.startsWith("../") && !isAbsolute(inside)) {
      throw new UsageError("OpenCode shell policy must be outside the assigned worktree; use an external system temporary directory");
    }
    const control = join(directory, "control");
    const temporary = join(directory, "tmp");
    const cache = join(directory, "cache");
    for (const path of [control, temporary, cache]) mkdirSync(path, { mode: 0o700 });
    const settings = join(control, "sandbox.json");
    const executable = join(control, "bash");
    const literal = (path: string) => ({ path, literal: true });
    const files = {
      [settings]: JSON.stringify({
        network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: false, allowAllUnixSockets: false },
        filesystem: {
          disabled: false, denyRead: [],
          allowWrite: [root, temporary, cache].map(literal),
          denyWrite: [control, join(root, ".git")].map(literal),
        },
        enableWeakerNestedSandbox: false,
      }),
      [executable]: `#!/bin/sh\nset -eu\n[ "$#" -eq 2 ] && [ "$1" = '-c' ] || exit 64\nunset BASH_ENV ENV\nexport TMPDIR=${quote(temporary)} TMP=${quote(temporary)} TEMP=${quote(temporary)} XDG_CACHE_HOME=${quote(cache)}\nexec ${quote(process.execPath)} ${quote(runtime)} --settings ${quote(settings)} -c "$2"\n`,
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(path, content, { flag: "wx", mode: path === executable ? 0o700 : 0o600 });
    return Object.freeze({ directory, executable, files: Object.freeze(files) });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function openCodeShellUnchanged(shell: OpenCodeShell): boolean {
  try {
    return Object.entries(shell.files).every(([path, expected]) => {
      const stat = lstatSync(path);
      return stat.isFile() && !stat.isSymbolicLink() && (path !== shell.executable || (stat.mode & 0o111) !== 0) && readFileSync(path, "utf8") === expected;
    });
  } catch { return false; }
}
