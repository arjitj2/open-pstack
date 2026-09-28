import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Resolve every Git metadata root that protects repository state for a
// worktree at `cwd`: the gitdir itself, plus the shared common dir for a
// linked worktree (where refs, objects, and hooks live). Returns [] when
// `cwd` has no `.git` entry. Every returned path is a real path — symlink
// and `.git`-pointer indirection is already resolved.
export function gitMetadataRoots(cwd: string): string[] {
  const dotgit = join(cwd, ".git");
  if (!existsSync(dotgit)) return [];
  const roots = new Set<string>();
  if (statSync(dotgit).isDirectory()) {
    const gitdir = realpathSync(dotgit);
    roots.add(gitdir);
    addCommonDir(gitdir, roots);
  } else {
    // A `.git` pointer file: "gitdir: <path>" for linked worktrees and
    // submodules.
    const match = /^gitdir:[ \t]*(.+)$/m.exec(readFileSync(dotgit, "utf8"));
    if (match === null) return [];
    const gitdir = resolve(cwd, match[1].trim());
    if (!existsSync(gitdir)) return [];
    const real = realpathSync(gitdir);
    roots.add(real);
    addCommonDir(real, roots);
  }
  return [...roots];
}

function addCommonDir(gitdir: string, roots: Set<string>): void {
  const pointer = join(gitdir, "commondir");
  if (!existsSync(pointer)) return;
  const target = readFileSync(pointer, "utf8").trim();
  if (target.length === 0) return;
  const resolved = resolve(gitdir, target);
  if (existsSync(resolved)) roots.add(realpathSync(resolved));
}

// Validate that a checkpoint's declared files stay inside the worktree and
// outside every resolved metadata root. A symlink that escapes the worktree
// fails even when the declared path looks relative; missing files are judged
// by their deepest existing ancestor.
export function checkpointFileIssues(
  cwd: string,
  files: readonly string[]
): string[] {
  const issues: string[] = [];
  const root = realpathSync(cwd);
  const metadata = gitMetadataRoots(cwd);
  for (const file of files) {
    if (typeof file !== "string" || file.length === 0) {
      issues.push("checkpoint file entry is empty");
      continue;
    }
    if (isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) {
      issues.push(`${file} is an absolute path`);
      continue;
    }
    if (file.split("/").some((segment) => segment === "..")) {
      issues.push(`${file} escapes the worktree`);
      continue;
    }
    const target = resolve(root, file);
    let probe = target;
    while (!existsSync(probe) && probe.length > root.length) {
      const parent = dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    const realTarget = existsSync(probe)
      ? join(realpathSync(probe), relative(probe, target))
      : target;
    if (realTarget !== root && !realTarget.startsWith(`${root}${sep}`)) {
      issues.push(`${file} resolves outside the worktree`);
      continue;
    }
    // The `.git` entry itself — directory or worktree pointer file — is part
    // of the control surface even when the resolved gitdir lives elsewhere.
    if (realTarget === join(root, ".git")) {
      issues.push(`${file} resolves inside Git metadata`);
      continue;
    }
    for (const gitdir of metadata) {
      if (realTarget === gitdir || realTarget.startsWith(`${gitdir}${sep}`)) {
        issues.push(`${file} resolves inside Git metadata`);
        break;
      }
    }
  }
  return issues;
}
