import { isRecord } from "./boundary.ts";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStore,
  type OpenStoreOptions,
  type Store,
} from "./store.ts";

export const SCRIPT = join(import.meta.dir, "orch.ts");
const directories: string[] = [];
const handles: Store[] = [];

export interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orch-test-"));
  directories.push(directory);
  return directory;
}

export function useStore(
  directory: string,
  options?: OpenStoreOptions
): Store {
  const store = openStore(directory, options);
  handles.push(store);
  return store;
}

export async function initializedStore(): Promise<{
  readonly directory: string;
  readonly store: Store;
}> {
  const directory = await makeDirectory();
  const store = useStore(directory);
  await store.init();
  return { directory, store };
}

export function git({
  args,
  repo,
}: {
  args: readonly string[];
  repo: string;
}): string {
  const result = Bun.spawnSync(["git", "-C", repo, ...args]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString()}`
    );
  }
  return result.stdout.toString().trim();
}

export interface GitStack {
  readonly repo: string;
  readonly mergedSha: string;
  readonly closedSha: string;
  readonly openSha: string;
  readonly draftSha: string;
}

export async function makeGitStack(directory: string): Promise<GitStack> {
  const repo = join(directory, "repo");
  await mkdir(repo);
  git({ repo, args: ["init", "--initial-branch=main"] });
  git({ repo, args: ["config", "user.name", "Orch Test"] });
  git({ repo, args: ["config", "user.email", "orch@example.com"] });
  await writeFile(join(repo, "main.txt"), "main\n");
  git({ repo, args: ["add", "."] });
  git({ repo, args: ["commit", "-m", "main"] });

  const branches = [
    "stack/merged",
    "stack/closed",
    "stack/open",
    "stack/draft",
  ];
  for (const [index, branch] of branches.entries()) {
    git({ repo, args: ["checkout", "-b", branch] });
    await writeFile(join(repo, `stack-${index}.txt`), `${branch}\n`);
    git({ repo, args: ["add", "."] });
    git({ repo, args: ["commit", "-m", branch] });
  }
  git({ repo, args: ["checkout", "stack/open"] });

  return {
    repo,
    mergedSha: git({ repo, args: ["rev-parse", "stack/merged"] }),
    closedSha: git({ repo, args: ["rev-parse", "stack/closed"] }),
    openSha: git({ repo, args: ["rev-parse", "stack/open"] }),
    draftSha: git({ repo, args: ["rev-parse", "stack/draft"] }),
  };
}

export const BASE_REPO = "acme/service";

export type GhPrState = "open" | "draft" | "merged" | "closed";

export interface GhPrSpec {
  readonly number: number;
  readonly state: GhPrState;
  readonly head: string;
  readonly base: string;
  readonly sha: string;
  readonly owner?: string;
  readonly headRepo?: string;
}

export function ghPr(spec: GhPrSpec): Record<string, unknown> {
  const crossRepository = spec.headRepo !== undefined;
  return {
    number: spec.number,
    state: spec.state === "draft" ? "OPEN" : spec.state.toUpperCase(),
    headRefName: spec.head,
    baseRefName: spec.base,
    headRefOid: spec.sha,
    headRepositoryOwner: { login: spec.owner ?? "acme" },
    headRepository: {
      name: spec.headRepo ?? BASE_REPO.split("/")[1],
      nameWithOwner: "",
    },
    isCrossRepository: crossRepository,
  };
}

export function ghRows(specs: readonly GhPrSpec[]): string {
  return `${JSON.stringify(specs.map(ghPr))}\n`;
}

export function prFile(kind: "head" | "base", branch: string): string {
  return `${kind}-${branch.replace(/[/.]/g, "_")}.json`;
}

export function chainPulls(
  stack: GitStack
): Readonly<Record<string, string>> {
  return {
    [prFile("head", "stack/open")]: ghRows([
      {
        number: 11,
        state: "open",
        head: "stack/open",
        base: "stack/closed",
        sha: stack.openSha,
      },
    ]),
    [prFile("head", "stack/closed")]: ghRows([
      {
        number: 13,
        state: "closed",
        head: "stack/closed",
        base: "stack/merged",
        sha: stack.closedSha,
      },
    ]),
    [prFile("head", "stack/merged")]: ghRows([
      {
        number: 10,
        state: "merged",
        head: "stack/merged",
        base: "main",
        sha: stack.mergedSha,
      },
    ]),
    [prFile("base", "stack/open")]: ghRows([
      {
        number: 14,
        state: "draft",
        head: "stack/draft",
        base: "stack/open",
        sha: stack.draftSha,
      },
      {
        number: 15,
        state: "closed",
        head: "stack/abandoned",
        base: "stack/open",
        sha: "f".repeat(40),
      },
    ]),
    [prFile("base", "stack/draft")]: "[]\n",
  };
}

const FAKE_GH_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
fixture="__FIXTURE__"
if [ "$(pwd -P)" != "__REPO__" ]; then
  printf 'gh ran outside the fixture repo: %s\\n' "$(pwd -P)" >&2
  exit 2
fi
printf '%s\\n' "$*" >> "$fixture/calls.txt"
case "\${1:-} \${2:-}" in
  "repo view")
    if [ "\${3:-}" != "__BASE_REPO__" ] && [ "\${3:-}" != "--json" ]; then
      printf 'gh repo view got wrong repository: %s\\n' "\${3:-}" >&2
      exit 2
    fi
    cat "$fixture/repo-view.json"
    ;;
  "pr list")
    shift 2
    head=""
    base=""
    repo=""
    state=""
    limit=""
    fields=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --head) head="$2"; shift 2 ;;
        --base) base="$2"; shift 2 ;;
        --repo) repo="$2"; shift 2 ;;
        --state) state="$2"; shift 2 ;;
        --limit) limit="$2"; shift 2 ;;
        --json) fields="$2"; shift 2 ;;
        *) printf 'unexpected gh arg: %s\\n' "$1" >&2; exit 2 ;;
      esac
    done
    if [ "$repo" != "__BASE_REPO__" ]; then
      printf 'gh pr list missing canonical --repo: %s\\n' "$repo" >&2
      exit 2
    fi
    if [ "$state" != "all" ] || [ "$limit" != "1000" ]; then
      printf 'gh pr list missing --state all or --limit 1000\\n' >&2
      exit 2
    fi
    case "$fields" in
      *number*state*headRefName*baseRefName*headRefOid*headRepositoryOwner*headRepository*isCrossRepository*) ;;
      *) printf 'gh pr list missing fields: %s\\n' "$fields" >&2; exit 2 ;;
    esac
    case "$head" in
      *:*) printf 'gh --head rejected owner:branch form: %s\\n' "$head" >&2; exit 2 ;;
    esac
    if [ -n "$head" ] && [ -n "$base" ]; then
      printf 'gh pr list got both --head and --base\\n' >&2
      exit 2
    fi
    if [ -n "$head" ]; then
      key="head-$(printf '%s' "$head" | tr '/.' '__')"
    elif [ -n "$base" ]; then
      key="base-$(printf '%s' "$base" | tr '/.' '__')"
    else
      printf 'gh pr list missing --head or --base\\n' >&2
      exit 2
    fi
    file="$fixture/$key.json"
    if [ -f "$file" ]; then
      cat "$file"
    else
      printf '[]\\n'
    fi
    ;;
  *)
    printf 'unexpected gh arguments: %s\\n' "$*" >&2
    exit 2
    ;;
esac
`;

export async function withFakeGh<T>({
  directory,
  files = {},
  operation,
}: {
  directory: string;
  files?: {
    readonly repoView?: string;
    readonly pulls?: Readonly<Record<string, string>>;
  };
  operation: (callsPath: string) => Promise<T>;
}): Promise<T> {
  const fixture = join(directory, "gh");
  const bin = join(directory, "bin");
  const callsPath = join(fixture, "calls.txt");
  await mkdir(fixture, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(callsPath, "");
  await writeFile(
    join(fixture, "repo-view.json"),
    files.repoView ??
      `${JSON.stringify({
        nameWithOwner: BASE_REPO,
        defaultBranchRef: { name: "main" },
      })}\n`
  );
  const catalogue = new Map<number, Record<string, unknown>>();
  for (const contents of Object.values(files.pulls ?? {})) {
    let rows: unknown;
    try { rows = JSON.parse(contents); } catch { continue; }
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (isRecord(row) && typeof row.number === "number" && !catalogue.has(row.number)) {
        catalogue.set(row.number, row);
      }
    }
  }
  const rows = [...catalogue.values()];
  const defaults = new Map<string, readonly Record<string, unknown>[]>();
  for (const row of rows) {
    if (typeof row.headRefName === "string") {
      defaults.set(prFile("head", row.headRefName), rows.filter(candidate => candidate.headRefName === row.headRefName));
    }
    if (typeof row.baseRefName === "string") {
      defaults.set(prFile("base", row.baseRefName), rows.filter(candidate => candidate.baseRefName === row.baseRefName));
    }
  }
  for (const [name, rows] of defaults) {
    await writeFile(join(fixture, name), JSON.stringify(rows));
  }
  for (const [name, contents] of Object.entries(files.pulls ?? {})) {
    await writeFile(join(fixture, name), contents);
  }
  const gh = join(bin, "gh");
  await writeFile(
    gh,
    FAKE_GH_SCRIPT.replaceAll("__FIXTURE__", fixture)
      .replaceAll("__REPO__", realpathSync(join(directory, "repo")))
      .replaceAll("__BASE_REPO__", BASE_REPO)
  );
  await chmod(gh, 0o755);

  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  try {
    return await operation(callsPath);
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
  }
}

export function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): RunResult {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], {
    env,
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

export async function cleanupFixtures(): Promise<void> {
  for (const store of handles.splice(0).reverse()) {
    await store.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
}
