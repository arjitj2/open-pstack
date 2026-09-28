import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, linkSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateCheckpoint } from "./checkpoint.ts";
import type { HandoffRequest } from "../runner/types.ts";

let scratch: string;
let repo: string;
let head: string;

function git(...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
}

function request(files: string[] = ["ordinary.txt"]): HandoffRequest {
  return { task: "issue-57", checkpoint: "cp-1", operation: "commit-checkpoint", files, checks: [], summary: "checkpoint" };
}

function validate(files: string[] = ["ordinary.txt"], allowedFiles = ["ordinary.txt"]): ReturnType<typeof validateCheckpoint> {
  return validateCheckpoint({ repository: repo, request: request(files), task: "issue-57", checkpoint: "cp-1", allowedFiles, allowedChecks: [], expectedHead: head });
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "pstack-checkpoint-")));
  repo = join(scratch, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "--separate-git-dir", join(scratch, "control"), repo]);
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(repo, "ordinary.txt"), "one\n");
  git("add", "--", "ordinary.txt");
  git("commit", "-m", "base");
  head = git("rev-parse", "HEAD");
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

describe("parent checkpoint validation", () => {
  it("binds exact parent scope, HEAD, file bytes, and mode without executing a command", () => {
    const first = validate();
    expect(first.head).toBe(head);
    expect(first.files).toEqual(["ordinary.txt"]);
    expect(git("rev-parse", "HEAD")).toBe(head);
    writeFileSync(join(repo, "ordinary.txt"), "two\n");
    expect(validate().digest).not.toBe(first.digest);
    const second = validate().digest;
    chmodSync(join(repo, "ordinary.txt"), 0o755);
    expect(validate().digest).not.toBe(second);
    expect(() => validateCheckpoint({ repository: repo, request: request(), task: "issue-57", checkpoint: "cp-1", allowedFiles: ["ordinary.txt"], allowedChecks: [], expectedHead: "wrong" })).toThrow(/HEAD differs/);
  });

  it("rejects metadata, symlink and hardlink paths despite allowlisting", () => {
    expect(() => validate([".git"], [".git"])).toThrow();
    symlinkSync(join(scratch, "control", "config"), join(repo, "meta-link"));
    expect(() => validate(["meta-link"], ["meta-link"])).toThrow();
    linkSync(join(scratch, "control", "config"), join(repo, "meta-hardlink"));
    expect(() => validate(["meta-hardlink"], ["meta-hardlink"])).toThrow();
    expect(readFileSync(join(scratch, "control", "config"), "utf8")).toContain("Fixture");
  });

  it("rejects wrong task, unapproved files and duplicate entries", () => {
    expect(() => validate(["ordinary.txt"], [])).toThrow(/allowlist/);
    expect(() => validate(["ordinary.txt", "ordinary.txt"], ["ordinary.txt"])).toThrow(/repeats/);
    expect(() => validateCheckpoint({ repository: repo, request: request(), task: "other", checkpoint: "cp-1", allowedFiles: ["ordinary.txt"], allowedChecks: [], expectedHead: head })).toThrow(/task or checkpoint/);
  });
});
