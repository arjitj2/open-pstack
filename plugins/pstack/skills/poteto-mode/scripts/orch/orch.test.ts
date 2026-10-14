import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NotFoundError,
  UserError,
  openStore,
  parseVerdict,
  type OpenStoreOptions,
  type Store,
} from "./store.ts";

const SCRIPT = join(import.meta.dir, "orch.ts");
const directories: string[] = [];
const handles: Store[] = [];

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "orch-test-"));
  directories.push(directory);
  return directory;
}

function useStore(
  directory: string,
  options?: OpenStoreOptions
): Store {
  const store = openStore(directory, options);
  handles.push(store);
  return store;
}

async function initializedStore(): Promise<{
  readonly directory: string;
  readonly store: Store;
}> {
  const directory = await makeDirectory();
  const store = useStore(directory);
  await store.init();
  return { directory, store };
}

function git({
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

interface GitStack {
  readonly repo: string;
  readonly mergedSha: string;
  readonly closedSha: string;
  readonly openSha: string;
  readonly draftSha: string;
}

async function makeGitStack(directory: string): Promise<GitStack> {
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

const BASE_REPO = "acme/service";

type GhPrState = "open" | "draft" | "merged" | "closed";

interface GhPrSpec {
  readonly number: number;
  readonly state: GhPrState;
  readonly head: string;
  readonly base: string;
  readonly sha: string;
  readonly owner?: string;
  readonly headRepo?: string;
}

function ghPr(spec: GhPrSpec): Record<string, unknown> {
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

function ghRows(specs: readonly GhPrSpec[]): string {
  return `${JSON.stringify(specs.map(ghPr))}\n`;
}

function prFile(kind: "head" | "base", branch: string): string {
  return `${kind}-${branch.replaceAll("/", "_")}.json`;
}

function chainPulls(stack: GitStack): Readonly<Record<string, string>> {
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
    if [ "\${3:-}" != "__BASE_REPO__" ]; then
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

async function withFakeGh<T>({
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

function runCli(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env
): RunResult {
  const result = Bun.spawnSync([process.execPath, SCRIPT, ...args], { env });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

afterEach(async () => {
  for (const store of handles.splice(0).reverse()) {
    await store.close();
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Store", () => {
  it("initializes an idempotent plain-file store and releases its lock", async () => {
    const directory = await makeDirectory();
    const store = useStore(directory);

    expect(await store.init()).toEqual({ store: directory });
    const firstUnits = await readFile(join(directory, "units.tsv"), "utf8");
    const firstLedger = await readFile(
      join(directory, "ledger.tsv"),
      "utf8"
    );

    expect(await store.init()).toEqual({ store: directory });
    expect(await readFile(join(directory, "units.tsv"), "utf8")).toBe(
      firstUnits
    );
    expect(await readFile(join(directory, "ledger.tsv"), "utf8")).toBe(
      firstLedger
    );
    expect((await readdir(directory)).sort()).toEqual([
      ".orch.lock",
      "frontier.json",
      "gates.md",
      "inbox",
      "ledger.tsv",
      "preferences.md",
      "units.tsv",
    ]);

    await store.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("composes unit add, set, get, list, and counts", async () => {
    const { store } = await initializedStore();

    expect(
      await store.units.add({
        id: "u1",
        track: "build",
        brief: "briefs/u1.md",
      })
    ).toMatchObject({ id: "u1", state: "pending" });
    expect(
      await store.units.add({ id: "=SUM(A1)", track: "+build" })
    ).toMatchObject({ id: "'=SUM(A1)", track: "'+build" });

    const updated = await store.units.set({
      id: "u1",
      state: "done",
      branch: "poteto/u1",
      pr: 184530,
      sha: "abc123",
    });
    expect(updated).toEqual({
      id: "u1",
      track: "build",
      state: "done",
      branch: "poteto/u1",
      pr: "184530",
      sha: "abc123",
      brief: "briefs/u1.md",
    });
    expect(await store.units.get("u1")).toEqual(updated);
    expect(
      await store.units.list({ state: "done", track: "build" })
    ).toEqual([updated]);
    expect(await store.units.counts()).toEqual({ done: 1, pending: 1 });
    await expect(
      store.units.add({ id: "u1", track: "build" })
    ).rejects.toThrow("unit u1 already exists");
    await expect(
      store.units.set({ id: "missing", state: "done" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("records, replaces, checks, and summarizes typed ledger verdicts", async () => {
    const { store } = await initializedStore();

    try {
      await store.ledger.check({ pr: 184530, sha: "abc123" });
      throw new Error("expected ledger check to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(NotFoundError);
      if (error instanceof NotFoundError) {
        expect(error.output).toEqual({
          compact: "NOT-VERIFIED",
          json: {
            pr: "184530",
            sha: "abc123",
            verdict: "NOT-VERIFIED",
          },
        });
      }
    }
    expect(() => parseVerdict("looks-good")).toThrow("verdict must be");

    const recorded = await store.ledger.record({
      pr: 184530,
      sha: "abc123",
      verdict: "unit-test-verified",
      evidence: "reports/verify.md",
      verifier: "sol",
    });
    expect(await store.ledger.check({ pr: 184530, sha: "abc123" })).toEqual(
      recorded
    );
    expect(await store.ledger.summary()).toEqual({
      "unit-test-verified": 1,
    });

    await store.ledger.record({
      pr: 184530,
      sha: "abc123",
      verdict: "live-ui-verified",
      evidence: "reports/live.md",
    });
    expect(await store.ledger.summary()).toEqual({
      "live-ui-verified": 1,
    });
  });

  it("pushes, peeks, and atomically drains inbox pointers", async () => {
    const { directory, store } = await initializedStore();

    const first = await store.inbox.push({
      agent: "worker-1",
      unit: "u1",
      status: "done",
      report: "reports/u1.md",
    });
    expect(first.pointer).toMatchObject({ unit: "u1", status: "done" });
    expect(first.filename).toEndWith(".tsv");
    await store.inbox.push({
      agent: "worker-2",
      unit: "u2",
      status: "failed",
    });

    expect(await store.inbox.count()).toBe(2);
    expect(await store.inbox.peek()).toHaveLength(2);
    expect(await store.inbox.count()).toBe(2);
    expect(await store.inbox.drain()).toHaveLength(2);
    expect(await store.inbox.count()).toBe(0);
    expect(await readdir(join(directory, "inbox"))).toEqual([]);
    expect(
      (await readdir(directory)).filter((name) =>
        name.startsWith(".inbox-drain-")
      )
    ).toEqual([]);
  });

  it("replaces a stale lock whose holder pid is dead", async () => {
    const { directory } = await initializedStore();
    const exited = Bun.spawn(["true"]);
    await exited.exited;
    await writeFile(join(directory, ".orch.lock"), `${exited.pid}\n`);

    const stale: string[] = [];
    const recovered = useStore(directory, {
      onStaleLock: (holder) => stale.push(holder),
    });
    expect(
      await recovered.units.add({ id: "u1", track: "build" })
    ).toMatchObject({ id: "u1" });
    expect(stale).toEqual([String(exited.pid)]);
    await recovered.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("blocks a writer and steals the pid lock only with force", async () => {
    const { directory, store } = await initializedStore();
    await store.close();
    await writeFile(join(directory, ".orch.lock"), `${process.pid}\n`);

    const blocked = useStore(directory);
    await expect(
      blocked.units.add({ id: "u1", track: "build" })
    ).rejects.toThrow(`store lock held by pid ${process.pid}`);

    const stolen: string[] = [];
    const forced = useStore(directory, {
      force: true,
      onLockStolen: (holder) => stolen.push(holder),
    });
    expect(
      await forced.units.add({ id: "u1", track: "build" })
    ).toMatchObject({ id: "u1" });
    expect(stolen).toEqual([String(process.pid)]);
    await forced.close();
    expect(await readdir(directory)).not.toContain(".orch.lock");
  });

  it("parks gates, stores standing orders, and renders status", async () => {
    const { directory, store } = await initializedStore();
    await store.units.add({ id: "u1", track: "build" });
    expect(
      await store.gates.park({
        id: "release",
        question: "Ship now?",
        options: "ship,wait",
        defaultAnswer: "wait",
      })
    ).toMatchObject({ kind: "open", id: "release" });
    expect(
      await store.standing.add({ line: "Never force push." })
    ).toEqual({ number: 1, line: "Never force push." });

    const first = await store.status.render();
    expect(first.changed).toBe("first render");
    expect(first.summary.openGateIds).toEqual(["release"]);
    expect(await readFile(join(directory, "status.md"), "utf8")).toContain(
      "| release | open | Ship now? |"
    );
    expect((await store.status.render()).changed).toBe("no derived changes");

    expect(
      await store.gates.resolve({ id: "release", answer: "ship" })
    ).toMatchObject({ kind: "resolved", answer: "ship" });
    expect((await store.status.render()).changed).toBe("open gates 1->0");
    expect(await store.gates.list()).toEqual([]);
    expect(await store.standing.show()).toEqual([
      { number: 1, line: "Never force push." },
    ]);
  });

  it("resolves the GitHub base chain and validates an optional pin", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: { pulls: chainPulls(stack) },
      operation: async () => {
        expect(
          await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).toEqual({
          generation: 1,
          prs: [
            {
              pr: 10,
              branches: "stack/merged",
              sha: stack.mergedSha,
              state: "MERGED",
            },
            {
              pr: 13,
              branches: "stack/closed",
              sha: stack.closedSha,
              state: "CLOSED",
            },
            {
              pr: 11,
              branches: "stack/open",
              sha: stack.openSha,
              state: "OPEN",
            },
            {
              pr: 14,
              branches: "stack/draft",
              sha: stack.draftSha,
              state: "OPEN",
            },
          ],
          lowestUnmerged: 11,
          resolution: {
            kind: "github-base-chain",
            baseRepo: BASE_REPO,
            trunk: "main",
            trunkSource: "repository-default",
          },
        });
        expect(
          (
            await store.frontier.set({
              repo: stack.repo,
              baseRepo: BASE_REPO,
              prs: [10, 13, 11, 14],
            })
          ).generation
        ).toBe(2);
        expect((await store.frontier.show()).generation).toBe(2);
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [10, 11, 12],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: missing from resolved chain: 12; extra in resolved chain: 13,14"
        );
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [13, 10, 11, 14],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: order differs: expected 13,10,11,14; resolved 10,13,11,14"
        );
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [10, 10],
          })
        ).rejects.toThrow("--prs must not contain duplicates");
        expect((await store.frontier.show()).generation).toBe(2);
      },
    });
  });

  it("sends the canonical repository on every pull request query", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: { pulls: chainPulls(stack) },
      operation: async (callsPath) => {
        await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        const calls = (await readFile(callsPath, "utf8")).trim().split("\n");
        expect(calls[0]).toBe(
          `repo view ${BASE_REPO} --json nameWithOwner,defaultBranchRef`
        );
        const prCalls = calls.slice(1);
        expect(prCalls.length).toBeGreaterThan(0);
        for (const call of prCalls) {
          expect(call).toContain(`--repo ${BASE_REPO}`);
          expect(call).toContain("--state all");
          expect(call).toContain("--limit 1000");
          expect(call).toContain("--json");
        }
        expect(
          prCalls.some((call) => call.includes("--head stack/open"))
        ).toBe(true);
        expect(
          prCalls.some((call) => call.includes("--base stack/open"))
        ).toBe(true);
      },
    });
  });

  it("writes an empty frontier on the trunk branch", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["checkout", "main"] });

    await withFakeGh({
      directory,
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
        });
        expect(frontier.prs).toEqual([]);
        expect(frontier.lowestUnmerged).toBeNull();
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [1],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: missing from resolved chain: 1"
        );
        expect((await store.frontier.show()).generation).toBe(1);
      },
    });
  });

  it("honors an explicit trunk over the repository default", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        repoView: `${JSON.stringify({
          nameWithOwner: BASE_REPO,
          defaultBranchRef: null,
        })}\n`,
        pulls: chainPulls(stack),
      },
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
          trunk: "stack/closed",
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([11, 14]);
        expect(frontier.resolution).toEqual({
          kind: "github-base-chain",
          baseRepo: BASE_REPO,
          trunk: "stack/closed",
          trunkSource: "explicit",
        });
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `repository ${BASE_REPO} has no default branch`
        );
      },
    });
  });

  it("selects the head pull request by actual owner", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const pulls = {
      ...chainPulls(stack),
      [prFile("head", "stack/open")]: ghRows([
        {
          number: 11,
          state: "open",
          head: "stack/open",
          base: "stack/closed",
          sha: stack.openSha,
        },
        {
          number: 77,
          state: "open",
          head: "stack/open",
          base: "stack/closed",
          sha: stack.openSha,
          owner: "alice",
          headRepo: "service",
        },
      ]),
    };

    await withFakeGh({
      directory,
      files: { pulls },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("matches multiple pull requests");
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
          headOwner: "acme",
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([10, 13, 11, 14]);
        expect(frontier.resolution?.headOwner).toBe("acme");
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            headOwner: "alice",
          })
        ).rejects.toThrow("fork");
        expect((await store.frontier.show()).generation).toBe(1);
      },
    });
  });

  it("rejects a selected fork pull request before writing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 77,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: stack.openSha,
              owner: "alice",
              headRepo: "service",
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("fork");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a reachable fork child before writing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("base", "stack/open")]: ghRows([
            {
              number: 78,
              state: "open",
              head: "stack/draft",
              base: "stack/open",
              sha: stack.draftSha,
              owner: "alice",
              headRepo: "service",
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("fork");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a nonlinear stack and preserves the old frontier", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("base", "stack/open")]: ghRows([
            {
              number: 14,
              state: "draft",
              head: "stack/draft",
              base: "stack/open",
              sha: stack.draftSha,
            },
            {
              number: 16,
              state: "open",
              head: "stack/other",
              base: "stack/open",
              sha: stack.draftSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "stack is not linear: branches stack/draft, stack/other all target stack/open"
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a base chain that loops", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/closed")]: ghRows([
            {
              number: 13,
              state: "open",
              head: "stack/closed",
              base: "stack/open",
              sha: stack.closedSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "pull request base chain loops at branch stack/open"
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a base chain that repeats a pull request", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/merged")]: ghRows([
            {
              number: 11,
              state: "merged",
              head: "stack/merged",
              base: "main",
              sha: stack.mergedSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("pull request base chain repeats PR #11");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a saturated pull request listing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const saturated = ghRows(
      Array.from({ length: 1000 }, (_, index) => ({
        number: index + 1,
        state: "open" as const,
        head: "stack/open",
        base: "stack/closed",
        sha: stack.openSha,
      }))
    );

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: saturated,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("may be truncated");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects local head drift from the published pull request head", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const published = "a".repeat(40);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: published,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `local branch stack/open head ${stack.openSha} differs from PR #11 published head ${published}`
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("requires a local branch for every chain member", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/ghost",
              sha: stack.openSha,
            },
          ]),
          [prFile("head", "stack/ghost")]: ghRows([
            {
              number: 9,
              state: "merged",
              head: "stack/ghost",
              base: "main",
              sha: "b".repeat(40),
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("local branch stack/ghost is missing");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("names the missing pull request when a chain branch has none", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `branch stack/open has no pull request in ${BASE_REPO}`
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("prefers the single open pull request over stale closed ones", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 99,
              state: "closed",
              head: "stack/open",
              base: "main",
              sha: stack.openSha,
            },
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: stack.openSha,
            },
          ]),
        },
      },
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([
          10, 13, 11, 14,
        ]);
      },
    });
  });

  it("rejects multiple pull requests on one branch", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: stack.openSha,
            },
            {
              number: 99,
              state: "open",
              head: "stack/open",
              base: "main",
              sha: stack.openSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `branch stack/open matches multiple pull requests in ${BASE_REPO} (#11, #99)`
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a detached HEAD before writing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["checkout", stack.openSha] });

    await withFakeGh({
      directory,
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("detached HEAD");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects malformed GitHub output loudly", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: { repoView: "this line is not JSON\n" },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `gh repo view ${BASE_REPO} output is not valid JSON`
        );
      },
    });

    await withFakeGh({
      directory,
      files: {
        repoView: `${JSON.stringify({
          nameWithOwner: "acme/other",
          defaultBranchRef: { name: "main" },
        })}\n`,
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("different repository acme/other");
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: "this line is not JSON\n",
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "gh pr list --head stack/open output is not valid JSON"
        );
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: `${JSON.stringify([
            { number: 11, state: "OPEN" },
          ])}\n`,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "gh pr list --head stack/open output has an invalid PR row"
        );
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: `${JSON.stringify([
            {
              number: 11,
              state: "OPEN",
              headRefName: "stack/other",
              baseRefName: "main",
              headRefOid: stack.openSha,
              headRepositoryOwner: { login: "acme" },
              headRepository: { name: "service", nameWithOwner: "" },
              isCrossRepository: false,
            },
          ])}\n`,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("whose head is stack/other");
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: `${JSON.stringify([
            {
              number: 77,
              state: "OPEN",
              headRefName: "stack/open",
              baseRefName: "stack/closed",
              headRefOid: stack.openSha,
              headRepositoryOwner: { login: "alice" },
              headRepository: null,
              isCrossRepository: true,
            },
          ])}\n`,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("missing head repository metadata");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("requires an owner/name base repository", async () => {
    const { store } = await initializedStore();
    const directory = await makeDirectory();
    const stack = await makeGitStack(directory);
    await expect(
      store.frontier.set({ repo: stack.repo, baseRepo: "not a repo" })
    ).rejects.toThrow("owner/name");
  });

  it("rejects malformed TSV, verdict, frontier, and inbox data", async () => {
    const { directory, store } = await initializedStore();

    await writeFile(join(directory, "units.tsv"), "wrong\n");
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has an invalid header"
    );
    await writeFile(
      join(directory, "units.tsv"),
      "id\ttrack\tstate\tbranch\tpr\tsha\tbrief\nshort\trow\n"
    );
    await expect(store.units.list()).rejects.toThrow(
      "units.tsv has a malformed row"
    );

    await writeFile(
      join(directory, "ledger.tsv"),
      "pr\tsha\tverdict\tevidence\tverifier\tts\n1\tsha\tinvalid\treport\tme\tnow\n"
    );
    await expect(store.ledger.summary()).rejects.toThrow(
      "ledger.tsv has invalid verdict invalid"
    );

    await writeFile(join(directory, "frontier.json"), '{"generation":"1"}\n');
    await expect(store.frontier.show()).rejects.toThrow(
      "frontier.json has an invalid shape"
    );

    await writeFile(
      join(directory, "frontier.json"),
      `${JSON.stringify({
        generation: 1,
        prs: [],
        lowestUnmerged: null,
        resolution: { kind: "unknown-forge" },
      })}\n`
    );
    await expect(store.frontier.show()).rejects.toThrow(
      "frontier.json has an invalid resolution"
    );

    await writeFile(join(directory, "inbox", "bad.tsv"), "too\tshort\n");
    await expect(store.inbox.peek()).rejects.toThrow(
      "inbox pointer bad.tsv is malformed"
    );
  });

  it("rejects operations after close", async () => {
    const { store } = await initializedStore();
    await store.close();
    await expect(store.units.list()).rejects.toThrow("store is closed");
    await expect(store.status.render()).rejects.toBeInstanceOf(UserError);
  });
});

describe("orch CLI", () => {
  it("prints commander help and rejects invalid parsing with exit 1", async () => {
    const help = runCli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("Commands:");
    expect(help.stdout).toContain("unit");
    expect(help.stdout).toContain("ledger");

    const frontierHelp = runCli(["frontier", "set", "--help"]);
    expect(frontierHelp.code).toBe(0);
    expect(frontierHelp.stdout).toContain("--repo <dir>");
    expect(frontierHelp.stdout).toContain("--base-repo <owner/name>");
    expect(frontierHelp.stdout).toContain("--trunk <branch>");
    expect(frontierHelp.stdout).toContain("--head-owner <login>");
    expect(frontierHelp.stdout).toContain("--prs <n,...>");

    const directory = await makeDirectory();
    const invalid = runCli(["--store", directory, "unit", "add", "u1"]);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("required option '--track <track>'");

    const missingBaseRepo = runCli([
      "--store",
      directory,
      "frontier",
      "set",
      "--repo",
      directory,
    ]);
    expect(missingBaseRepo.code).toBe(1);
    expect(missingBaseRepo.stderr).toContain("--base-repo");
  });

  it("accepts ORCH_STORE and emits complete JSON", async () => {
    const directory = await makeDirectory();
    const env = { ...process.env, ORCH_STORE: directory };
    expect(runCli(["init"], env).code).toBe(0);

    const added = runCli(
      ["unit", "add", "u1", "--track", "build", "--json"],
      env
    );
    expect(added.code).toBe(0);
    expect(JSON.parse(added.stdout)).toEqual({
      id: "u1",
      track: "build",
      state: "pending",
      branch: "",
      pr: "",
      sha: "",
      brief: "",
    });
  });

  it("maps user and not-found outcomes to the preserved exit codes", async () => {
    const directory = await makeDirectory();
    expect(runCli(["--store", directory, "init"]).code).toBe(0);

    const missingRepo = runCli([
      "--store",
      directory,
      "frontier",
      "set",
      "--base-repo",
      BASE_REPO,
    ]);
    expect(missingRepo.code).toBe(1);
    expect(missingRepo.stderr).toContain(
      "set --repo <dir> or ORCH_REPO"
    );

    const userError = runCli([
      "--store",
      directory,
      "unit",
      "add",
      "",
      "--track",
      "build",
    ]);
    expect(userError.code).toBe(1);
    expect(userError.stderr).toContain("unit id must not be empty");

    const missingUnit = runCli([
      "--store",
      directory,
      "unit",
      "get",
      "missing",
    ]);
    expect(missingUnit.code).toBe(2);
    expect(missingUnit.stderr).toContain("unit missing not found");

    const missingLedger = runCli([
      "--store",
      directory,
      "--json",
      "ledger",
      "check",
      "184530",
      "abc123",
    ]);
    expect(missingLedger.code).toBe(2);
    expect(JSON.parse(missingLedger.stdout)).toEqual({
      pr: "184530",
      sha: "abc123",
      verdict: "NOT-VERIFIED",
    });
    expect(missingLedger.stderr).toBe("");
  });
});
