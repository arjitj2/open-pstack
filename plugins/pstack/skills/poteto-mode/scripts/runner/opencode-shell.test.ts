import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeShell, openCodeShellUnchanged, type OpenCodeShell } from "./opencode-shell.ts";

setDefaultTimeout(30_000);
const owned: string[] = [];
function fixture(): { root: string; shell: OpenCodeShell } {
  const root = mkdtempSync(join(tmpdir(), "pstack-shell-test-"));
  owned.push(root);
  const shell = createOpenCodeShell(root);
  owned.push(shell.directory);
  return { root, shell };
}
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }); });

it("detects changed, missing and non-executable control files", () => {
  const { shell } = fixture();
  expect(openCodeShellUnchanged(shell)).toBe(true);
  chmodSync(shell.executable, 0o600);
  expect(openCodeShellUnchanged(shell)).toBe(false);
  chmodSync(shell.executable, 0o700);
  const policy = Object.keys(shell.files).find(path => path.endsWith(".json"))!;
  writeFileSync(policy, "{}");
  expect(openCodeShellUnchanged(shell)).toBe(false);
  writeFileSync(policy, shell.files[policy]);
  expect(openCodeShellUnchanged(shell)).toBe(true);
  unlinkSync(policy);
  expect(openCodeShellUnchanged(shell)).toBe(false);
});

describe.skipIf(process.platform !== "darwin")("OpenCode shell OS boundary", () => {
  async function command(shell: OpenCodeShell, root: string, text: string) {
    const child = Bun.spawn([shell.executable, "-c", text], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exit, stdout, stderr };
  }
  it("runs checks and preserves a failing command's exit status", async () => {
    const { root, shell } = fixture();
    expect((await command(shell, root, "printf passed > result")).exit).toBe(0);
    expect(readFileSync(join(root, "result"), "utf8")).toBe("passed");
    expect((await command(shell, root, "exit 7")).exit).toBe(7);
  });
  it("denies outside, symlink, child and policy writes", async () => {
    const { root, shell } = fixture();
    const outside = join(shell.directory, "outside");
    writeFileSync(outside, "unchanged");
    symlinkSync(outside, join(root, "link"));
    for (const text of [
      `printf changed > '${outside}'`,
      "printf changed > link",
      `/bin/sh -c \"printf changed > '${outside}'\"`,
      `printf changed > '${shell.executable}'`,
    ]) expect((await command(shell, root, text)).exit).not.toBe(0);
    expect(readFileSync(outside, "utf8")).toBe("unchanged");
    expect(openCodeShellUnchanged(shell)).toBe(true);
  });
  it("refuses nested Seatbelt startup without executing the command", async () => {
    const { root, shell } = fixture();
    const child = Bun.spawn(["/usr/bin/sandbox-exec", "-p", "(version 1) (allow default)", shell.executable, "-c", "printf bypass > bypass"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exit, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(exit).not.toBe(0);
    expect(stderr).toContain("sandbox_apply");
    expect(existsSync(join(root, "bypass"))).toBe(false);
  });
  it("refuses missing required policy without executing the command", async () => {
    const { root, shell } = fixture();
    unlinkSync(Object.keys(shell.files).find(path => path.endsWith(".json"))!);
    expect((await command(shell, root, "printf bypass > bypass")).exit).not.toBe(0);
    expect(existsSync(join(root, "bypass"))).toBe(false);
  });
});
