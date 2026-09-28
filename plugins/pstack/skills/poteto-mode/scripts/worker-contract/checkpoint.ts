import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { HandoffRequest } from "../runner/types.ts";
import { checkpointFileIssues, gitMetadataRoots } from "./git-metadata.ts";

export class CheckpointError extends Error {}

function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function gitRead(repo: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

// This validates a request; it never executes a worker-authored operation.
// The parent must recheck the digest and expected HEAD immediately before its
// own fixed Git operation, since validation cannot lock the worktree.
export function validateCheckpoint(input: {
  readonly repository: string;
  readonly request: HandoffRequest;
  readonly task: string;
  readonly checkpoint: string;
  readonly allowedFiles: readonly string[];
  readonly allowedChecks: readonly string[];
  readonly expectedHead: string;
}): { readonly head: string; readonly digest: string; readonly files: readonly string[]; readonly checks: readonly string[] } {
  const root = realpathSync(input.repository);
  if (gitRead(root, ["rev-parse", "--show-toplevel"]) !== root) {
    throw new CheckpointError("repository must be the canonical worktree root");
  }
  const gitDir = realpathSync(gitRead(root, ["rev-parse", "--absolute-git-dir"]));
  const commonDir = realpathSync(gitRead(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  const metadataRoots = gitMetadataRoots(root);
  if (!metadataRoots.includes(gitDir) || !metadataRoots.includes(commonDir)) {
    throw new CheckpointError("repository Git metadata pointers are inconsistent");
  }
  const head = gitRead(root, ["rev-parse", "HEAD"]);
  if (head !== input.expectedHead) throw new CheckpointError("repository HEAD differs from expected head");
  const request = input.request;
  if (request.task !== input.task || request.checkpoint !== input.checkpoint) {
    throw new CheckpointError("handoff task or checkpoint differs from the parent assignment");
  }
  if (new Set(request.files).size !== request.files.length || new Set(request.checks).size !== request.checks.length) {
    throw new CheckpointError("handoff repeats a file or check");
  }
  if (request.files.some((path) => !input.allowedFiles.includes(path)) ||
      request.checks.some((check) => !input.allowedChecks.includes(check))) {
    throw new CheckpointError("handoff requests a file or check outside the parent allowlist");
  }
  if (request.operation === "commit-checkpoint" && request.files.length === 0) {
    throw new CheckpointError("commit checkpoint requires at least one file");
  }
  if (request.operation === "run-checks" && request.checks.length === 0) {
    throw new CheckpointError("run-checks requires at least one allowed check");
  }
  const pathIssues = checkpointFileIssues(root, request.files);
  if (pathIssues.length > 0) throw new CheckpointError(pathIssues.join("; "));
  const hash = createHash("sha256");
  const entries: { path: string; mode: number; size: number; content: string }[] = [];
  for (const path of request.files) {
    const candidate = resolve(root, path);
    if (!inside(root, candidate) || candidate === root ||
        path.split("/").some((part) => part === ".git" || part === ".." || part === "." || part === "")) {
      throw new CheckpointError(`unsafe checkpoint path: ${path}`);
    }
    const metadata = lstatSync(candidate);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      throw new CheckpointError(`checkpoint file must be a regular unlinked file: ${path}`);
    }
    const canonical = realpathSync(candidate);
    if (!inside(root, canonical) || inside(gitDir, canonical) || inside(commonDir, canonical)) {
      throw new CheckpointError(`checkpoint path escapes the worktree or enters Git metadata: ${path}`);
    }
    const contents = readFileSync(candidate);
    entries.push({
      path, mode: metadata.mode & 0o777, size: contents.length,
      content: createHash("sha256").update(contents).digest("hex"),
    });
  }
  hash.update(JSON.stringify({
    version: 1, task: request.task, checkpoint: request.checkpoint,
    operation: request.operation, head, checks: request.checks, entries,
  }));
  return { head, digest: hash.digest("hex"), files: request.files, checks: request.checks };
}
