import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkpointFileIssues, gitMetadataRoots } from "./git-metadata.ts";

const GIT = Bun.which("git");
const itGit = GIT === null ? it.skip : it;

let scratch = "";
let repo = "";

async function git(...args: string[]): Promise<string> {
  const child = Bun.spawn([GIT!, "-C", repo, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function gitIn(dir: string, ...args: string[]): Promise<string> {
  const child = Bun.spawn([GIT!, "-C", dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-gitmeta-test-"));
  repo = join(scratch, "repo");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("gitMetadataRoots", () => {
  itGit("resolves a normal repository gitdir and its shared state", async () => {
    mkdirSync(repo);
    await gitIn(repo, "init", "-q");
    const roots = gitMetadataRoots(repo);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBe(realpathSync(join(repo, ".git")));
    expect(existsSync(join(roots[0], "objects"))).toBe(true);
  });

  it("returns empty outside any worktree", () => {
    expect(gitMetadataRoots(scratch)).toEqual([]);
  });

  itGit("resolves the linked gitdir and common dir for a shared worktree", async () => {
    mkdirSync(repo);
    await gitIn(repo, "init", "-q");
    writeFileSync(join(repo, "seed.txt"), "seed");
    await gitIn(repo, "add", "seed.txt");
    await gitIn(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "seed");
    const linked = join(scratch, "linked");
    await gitIn(repo, "worktree", "add", "-q", linked);

    const roots = gitMetadataRoots(linked);
    expect(roots.length).toBe(2);
    const [gitdir, commondir] = roots;
    // The worktree gitdir lives under the primary repo's .git/worktrees/<name>
    // and its commondir file points back at the shared .git directory.
    expect(readFileSync(join(gitdir, "commondir"), "utf8").trim().length).toBeGreaterThan(0);
    expect(commondir).toBe(realpathSync(join(repo, ".git")));
    expect(existsSync(join(commondir, "objects"))).toBe(true);
    // Checkpoint files inside either root are flagged.
    expect(checkpointFileIssues(linked, [".git", "x"])).toEqual(
      expect.arrayContaining([expect.stringContaining("Git metadata")])
    );
  });
});

describe("checkpointFileIssues", () => {
  itGit("accepts ordinary worktree files and flags metadata writes", async () => {
    mkdirSync(repo);
    await gitIn(repo, "init", "-q");
    writeFileSync(join(repo, "src.ts"), "export {};\n");
    mkdirSync(join(repo, "pkg"));
    writeFileSync(join(repo, "pkg", "mod.ts"), "export {};\n");
    expect(checkpointFileIssues(repo, ["src.ts", "pkg/mod.ts", "new-file.txt"])).toEqual([]);
    for (const file of [
      ".git",
      ".git/config",
      ".git/hooks/pre-commit",
      ".git/refs/heads/main",
    ]) {
      expect(checkpointFileIssues(repo, [file]), file).toEqual([
        expect.stringContaining("Git metadata"),
      ]);
    }
  });

  itGit("flags absolute paths, traversal, and symlink escapes", async () => {
    mkdirSync(repo);
    await gitIn(repo, "init", "-q");
    const outside = join(scratch, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "x");
    symlinkSync(outside, join(repo, "link-out"));

    expect(checkpointFileIssues(repo, ["link-out/secret.txt"])).toEqual([
      expect.stringContaining("outside the worktree"),
    ]);
    expect(checkpointFileIssues(repo, ["/etc/passwd"])).toEqual([
      expect.stringContaining("absolute"),
    ]);
    expect(checkpointFileIssues(repo, ["../outside/secret.txt"])).toEqual([
      expect.stringContaining("escapes"),
    ]);
    // A symlink that stays inside the worktree is fine.
    mkdirSync(join(repo, "inner"));
    writeFileSync(join(repo, "inner", "f.txt"), "x");
    symlinkSync(join(repo, "inner"), join(repo, "link-in"));
    expect(checkpointFileIssues(repo, ["link-in/f.txt"])).toEqual([]);
    // A symlink that lands inside .git is metadata, not an escape.
    symlinkSync(join(repo, ".git"), join(repo, "link-git"));
    expect(checkpointFileIssues(repo, ["link-git/config"])).toEqual([
      expect.stringContaining("Git metadata"),
    ]);
  });

  itGit("leaves repository state untouched and tolerates local pushes", async () => {
    mkdirSync(repo);
    await gitIn(repo, "init", "-q");
    writeFileSync(join(repo, "a.txt"), "a");
    await gitIn(repo, "add", "a.txt");
    await gitIn(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "a");
    const headBefore = await gitIn(repo, "rev-parse", "HEAD");
    const statusBefore = await gitIn(repo, "status", "--porcelain");

    // Inspection is read-only: roots and file checks never mutate the repo.
    gitMetadataRoots(repo);
    expect(checkpointFileIssues(repo, ["a.txt", ".git/config"])).toHaveLength(1);
    expect(await gitIn(repo, "rev-parse", "HEAD")).toBe(headBefore);
    expect(await gitIn(repo, "status", "--porcelain")).toBe(statusBefore);

    // A safe push to a local file:// remote still works; the helpers do not
    // interfere with ordinary repository operations.
    const remote = join(scratch, "remote.git");
    await gitIn(scratch, "init", "-q", "--bare", remote);
    await gitIn(repo, "push", "-q", remote, "HEAD:refs/heads/main");
    expect((await gitIn(remote, "rev-parse", "refs/heads/main"))).toBe(headBefore);
  });
});
