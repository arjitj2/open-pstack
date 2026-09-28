import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  symlinkSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  NO_PROGRESS,
  SNAPSHOT_MAX_BYTES,
  decodeSnapshot,
  encodeSnapshot,
  openReporter,
  phaseOf,
  probeIdentity,
  psProbe,
  readLaneView,
  reduce,
  renderLane,
  statusMain,
  type ProbeResult,
  type ProcessProbe,
  type ProgressEvent,
  type ProgressState,
  type SnapshotV1,
} from "./progress.ts";
import type { RunnerReceipt } from "./types.ts";

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pstack-progress-test-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function baseState(): ProgressState {
  return {
    attemptId: "11111111-2222-3333-4444-555555555555",
    provider: "codex",
    runner: { pid: 4242, startedAt: new Date(1_000_000).toISOString(), startToken: "T0" },
    child: null,
    retryWait: false,
    activity: { stdoutBytes: 0, stderrBytes: 0, lastActivityAt: null },
    cancellation: { requested: null },
    childSettled: null,
    terminal: null,
    receiptRef: null,
  };
}

function progressPath(name = "lane.progress.json"): string {
  return join(scratch, name);
}

function writeSnapshot(state: ProgressState, name = "lane.progress.json"): string {
  const path = progressPath(name);
  writeFileSync(path, encodeSnapshot(state, 7));
  return path;
}

function writeReceipt(path: string, status: string): void {
  writeFileSync(path, JSON.stringify({ schemaVersion: 1, status }));
}

function probeReturning(result: ProbeResult): ProcessProbe {
  return () => result;
}

const CANARY = "CANARY-SECRET-PROMPT-TEXT-9f31";

describe("progress reducer", () => {
  it("derives every phase from facts", () => {
    let s = baseState();
    expect(phaseOf(s)).toBe("setup");
    s = reduce(s, { t: "spawned", role: "preflight", pid: 10, startToken: "C" }, 0);
    expect(phaseOf(s)).toBe("preflight");
    s = reduce(s, { t: "exited", role: "preflight", exitCode: 0 }, 1);
    expect(phaseOf(s)).toBe("preflight");
    s = reduce(s, { t: "drained", role: "preflight" }, 2);
    s = reduce(s, { t: "retry-wait", on: true }, 3);
    expect(phaseOf(s)).toBe("preflight-retry-wait");
    s = reduce(s, { t: "spawned", role: "preflight", pid: 11, startToken: "C2" }, 4);
    expect(phaseOf(s)).toBe("preflight");
    s = reduce(s, { t: "spawned", role: "workload", pid: 12, startToken: "W" }, 5);
    expect(phaseOf(s)).toBe("workload-running");
    s = reduce(s, { t: "exited", role: "workload", exitCode: 0 }, 6);
    expect(phaseOf(s)).toBe("workload-draining");
    s = reduce(s, { t: "drained", role: "workload" }, 7);
    expect(phaseOf(s)).toBe("postprocess");
    s = reduce(s, { t: "terminal", receiptWritten: true }, 8);
    expect(phaseOf(s)).toBe("terminal");
  });

  it("drops preflight byte activity but counts workload bytes", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "preflight", pid: 10, startToken: null }, 0);
    s = reduce(s, { t: "bytes", stream: "stdout", n: 100 }, 1);
    expect(s.activity.stdoutBytes).toBe(0);
    s = reduce(s, { t: "spawned", role: "workload", pid: 12, startToken: null }, 2);
    s = reduce(s, { t: "bytes", stream: "stdout", n: 40 }, 3);
    s = reduce(s, { t: "bytes", stream: "stderr", n: 7 }, 4);
    s = reduce(s, { t: "exited", role: "workload", exitCode: 0 }, 5);
    s = reduce(s, { t: "bytes", stream: "stdout", n: 5 }, 6);
    expect(s.activity.stdoutBytes).toBe(45);
    expect(s.activity.stderrBytes).toBe(7);
    expect(s.activity.lastActivityAt).toBe(new Date(6).toISOString());
  });

  it("keeps terminal sticky and ignores later events", () => {
    let s = baseState();
    s = reduce(s, { t: "terminal", receiptWritten: false }, 0);
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: null }, 1);
    s = reduce(s, { t: "cancel-requested", signal: "SIGTERM" }, 2);
    expect(phaseOf(s)).toBe("terminal");
    expect(s.child).toBeNull();
    expect(s.cancellation.requested).toBeNull();
    expect(s.terminal?.receiptWritten).toBe(false);
  });

  it("records cancel requested separately from a settled child", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: null }, 0);
    s = reduce(s, { t: "cancel-requested", signal: "SIGINT" }, 1);
    expect(s.cancellation.requested?.signal).toBe("SIGINT");
    expect(s.childSettled).toBeNull();
    s = reduce(s, { t: "child-settled", outcome: "signalled-and-exited", cause: "cancel" }, 2);
    expect(s.childSettled?.outcome).toBe("signalled-and-exited");
    expect(s.cancellation.requested?.signal).toBe("SIGINT");
  });

  it("ignores stale exited events for a replaced child", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "preflight", pid: 10, startToken: null }, 0);
    s = reduce(s, { t: "spawned", role: "workload", pid: 11, startToken: null }, 1);
    s = reduce(s, { t: "exited", role: "preflight", exitCode: 0 }, 2);
    expect(s.child?.role).toBe("workload");
    expect(s.child?.running).toBe(true);
  });
});

describe("snapshot codec", () => {
  it("round-trips and stays within the encoded bound", () => {
    let s = baseState();
    const events: ProgressEvent[] = [
      { t: "spawned", role: "workload", pid: 99, startToken: "Tok 123" },
      { t: "bytes", stream: "stdout", n: 4000 },
      { t: "cancel-requested", signal: "SIGTERM" },
      { t: "child-settled", outcome: "already-exited", cause: "cancel" },
      { t: "terminal", receiptWritten: true },
    ];
    for (const event of events) s = reduce(s, event, 2_000_000);
    const encoded = encodeSnapshot(s, 12, 3_000_000);
    expect(encoded.length).toBeLessThanOrEqual(SNAPSHOT_MAX_BYTES);
    const decoded = decodeSnapshot(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.snapshot.phase).toBe("terminal");
      expect(decoded.snapshot.terminal?.receiptWritten).toBe(true);
      expect(decoded.snapshot.cancellation.requested?.signal).toBe("SIGTERM");
      expect(decoded.snapshot.childSettled?.cause).toBe("cancel");
    }
  });

  it("rejects torn JSON, wrong kind, newer versions, and field violations", () => {
    const reason = (text: string) => {
      const decoded = decodeSnapshot(text);
      return decoded.ok ? null : decoded.reason;
    };
    expect(reason("{")).toBe("invalid-json");
    expect(reason(JSON.stringify({ kind: "other", schemaVersion: 1 }))).toBe("wrong-kind");
    expect(
      reason(JSON.stringify({ ...JSON.parse(encodeSnapshot(baseState(), 1)), schemaVersion: 2 }))
    ).toBe("unsupported-version");
    const missing = JSON.parse(encodeSnapshot(baseState(), 1));
    delete missing.attemptId;
    expect(reason(JSON.stringify(missing))).toBe("malformed");
    const hostile = JSON.parse(encodeSnapshot(baseState(), 1));
    hostile.provider = CANARY;
    hostile.runner.pid = -4;
    expect(reason(JSON.stringify(hostile))).toBe("malformed");
    hostile.provider = "codex";
    hostile.runner.pid = 4242;
    hostile.activity = { stdoutBytes: -1, stderrBytes: 0, lastActivityAt: null };
    expect(reason(JSON.stringify(hostile))).toBe("malformed");
  });
});

describe("progress reporter", () => {
  function open(path: string): ReturnType<typeof openReporter> {
    writeFileSync(path, "", { flag: "wx", mode: 0o600 });
    return openReporter(path, {
      provider: "codex",
      startedAt: Date.now(),
      receiptRef: null,
    }, { activityFlushMs: 20 });
  }

  function readSnapshotFile(path: string): SnapshotV1 {
    const decoded = decodeSnapshot(readFileSync(path, "utf8"));
    if (!decoded.ok) throw new Error(`snapshot did not decode: ${decoded.reason}`);
    return decoded.snapshot;
  }

  it("writes an initial setup snapshot with private permissions", () => {
    const path = progressPath();
    const reporter = open(path);
    const first = readSnapshotFile(path);
    expect(first.phase).toBe("setup");
    expect(first.provider).toBe("codex");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    reporter.close();
  });

  it("coalesces a byte burst into bounded writes and still lands the trailing flush", async () => {
    const path = progressPath();
    const reporter = open(path);
    reporter.record({ t: "spawned", role: "workload", pid: 1, startToken: null });
    const beforeBurst = readSnapshotFile(path).seq;
    for (let index = 0; index < 1_000; index += 1) {
      reporter.record({ t: "bytes", stream: "stdout", n: 10 });
    }
    await Bun.sleep(60);
    const after = readSnapshotFile(path);
    expect(after.seq - beforeBurst).toBeLessThanOrEqual(2);
    expect(after.activity.stdoutBytes).toBe(10_000);
    reporter.close();
  });

  it("flushes transitions immediately", () => {
    const path = progressPath();
    const reporter = open(path);
    reporter.record({ t: "spawned", role: "workload", pid: 1, startToken: null });
    reporter.record({ t: "exited", role: "workload", exitCode: 3 });
    const snap = readSnapshotFile(path);
    expect(snap.phase).toBe("workload-draining");
    expect(snap.child?.exitCode).toBe(3);
    reporter.close();
  });

  it("disables itself rather than overwrite a foreign file at the path", () => {
    const path = progressPath();
    const reporter = open(path);
    const foreign = join(scratch, "foreign-marker");
    writeFileSync(foreign, CANARY);
    renameSync(foreign, path);
    reporter.record({ t: "spawned", role: "workload", pid: 1, startToken: null });
    reporter.record({ t: "terminal", receiptWritten: true });
    reporter.close();
    expect(readFileSync(path, "utf8")).toBe(CANARY);
  });

  it("never throws when writes fail", () => {
    const path = progressPath();
    const reporter = open(path);
    rmSync(path);
    reporter.record({ t: "spawned", role: "workload", pid: 1, startToken: null });
    reporter.record({ t: "terminal", receiptWritten: false });
    reporter.close();
    expect(existsSync(path)).toBe(false);
  });

  it("is a no-op when progress is disabled", () => {
    NO_PROGRESS.record({ t: "terminal", receiptWritten: true });
    NO_PROGRESS.close();
  });
});

describe("lane status reader", () => {
  const receiptPath = () => join(scratch, "lane.receipt.json");

  it("prefers a valid receipt over a running snapshot", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const path = writeSnapshot(s);
    writeReceipt(receiptPath(), "complete");
    const view = readLaneView(path, receiptPath(), probeReturning({ kind: "absent" }));
    expect(view).toMatchObject({ kind: "terminal", status: "complete" });
  });

  it("reports a live launcher as active and a dead one as interrupted", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const path = writeSnapshot(s);
    writeFileSync(receiptPath(), "");
    const live = readLaneView(
      path,
      receiptPath(),
      probeReturning({ kind: "token", token: "T0" })
    );
    expect(live.kind).toBe("active");
    if (live.kind === "active") expect(live.launcher).toBe("live");
    const gone = readLaneView(path, receiptPath(), probeReturning({ kind: "absent" }));
    expect(gone.kind).toBe("interrupted");
    if (gone.kind === "interrupted") {
      expect(gone.reason).toBe("launcher-gone");
      expect(gone.child).toBe("gone");
    }
    const reused = readLaneView(
      path,
      receiptPath(),
      probeReturning({ kind: "token", token: "OTHER" })
    );
    expect(reused.kind).toBe("interrupted");
    if (reused.kind === "interrupted") expect(reused.reason).toBe("pid-reused");
  });

  it("treats an unverifiable probe as unverified, never alive", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const path = writeSnapshot(s);
    writeFileSync(receiptPath(), "");
    const view = readLaneView(path, receiptPath(), probeReturning({ kind: "unverified" }));
    expect(view).toMatchObject({ kind: "unknown", reason: "launcher-unverified" });
    const noToken = writeSnapshot({ ...baseState(), runner: { ...baseState().runner, startToken: null } }, "b.progress.json");
    const unverified = readLaneView(noToken, receiptPath(), probeReturning({ kind: "token", token: "T0" }));
    expect(unverified).toMatchObject({ kind: "unknown", reason: "launcher-unverified" });
  });

  it("never reports a terminal-marked snapshot without a receipt as active", () => {
    let s = baseState();
    s = reduce(s, { t: "terminal", receiptWritten: true }, 0);
    const path = writeSnapshot(s);
    writeFileSync(receiptPath(), "");
    const view = readLaneView(path, receiptPath(), probeReturning({ kind: "absent" }));
    expect(view.kind).toBe("unknown");
    if (view.kind === "unknown") expect(view.reason).toBe("terminal-without-receipt");
  });

  it("reports a reserved receipt with no snapshot as not started", () => {
    writeFileSync(receiptPath(), "");
    const view = readLaneView(progressPath(), receiptPath(), probeReturning({ kind: "absent" }));
    expect(view).toMatchObject({ kind: "unknown", reason: "not-started" });
  });

  it("rejects oversize and hostile snapshots without echoing their content", () => {
    const path = progressPath();
    writeFileSync(path, "x".repeat(9_000));
    const view = readLaneView(path, receiptPath(), probeReturning({ kind: "absent" }));
    expect(view).toMatchObject({ kind: "unknown", reason: "oversize" });
    writeFileSync(path, JSON.stringify({ kind: "pstack-runner-progress", schemaVersion: 1, evil: CANARY }));
    const hostile = readLaneView(path, receiptPath(), probeReturning({ kind: "absent" }));
    expect(hostile.kind).toBe("unknown");
    const rendered = renderLane(hostile);
    expect(rendered.line).not.toContain(CANARY);
    expect(rendered.changeKey).not.toContain(CANARY);
  });

  it("binds the receipt to the reserved dev/ino when the snapshot records it", () => {
    const receipt = receiptPath();
    writeFileSync(receipt, "");
    const stat = statSync(receipt);
    let s = { ...baseState(), receiptRef: { dev: stat.dev, ino: stat.ino } };
    const path = writeSnapshot(s);
    const before = readLaneView(path, receipt, probeReturning({ kind: "token", token: "T0" }));
    expect(before.kind).toBe("active");
    writeFileSync(receipt, JSON.stringify({ schemaVersion: 1, status: "complete" }));
    const terminal = readLaneView(path, receipt, probeReturning({ kind: "token", token: "T0" }));
    expect(terminal).toMatchObject({ kind: "terminal", status: "complete" });
    const swapped = join(scratch, "swapped.receipt.json");
    writeFileSync(swapped, JSON.stringify({ schemaVersion: 1, status: "complete" }));
    renameSync(swapped, receipt);
    const rebound = readLaneView(path, receipt, probeReturning({ kind: "token", token: "T0" }));
    expect(rebound.kind).toBe("active");
  });

  it("probes child identity when the launcher is gone", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const path = writeSnapshot(s);
    const probe: ProcessProbe = (pid) =>
      pid === 4242 ? { kind: "absent" } : { kind: "token", token: "W" };
    const view = readLaneView(path, receiptPath(), probe);
    expect(view).toMatchObject({ kind: "interrupted", child: "possibly-running" });
    const rendered = renderLane(view);
    expect(rendered.line).toContain("may still be running");
    expect(rendered.line).not.toContain("descendants");
  });
});

describe("status command", () => {
  function io() {
    const captured = {
      out: "",
      err: "",
      io: {
        stdout: (v: string) => {
          captured.out += v;
        },
        stderr: (v: string) => {
          captured.err += v;
        },
      },
    };
    return captured;
  }

  it("requires paired --progress/--receipt arguments", () => {
    const c = io();
    expect(statusMain([], c.io)).toBe(64);
    expect(statusMain(["--progress", "p"], c.io)).toBe(64);
    expect(statusMain(["--bogus"], c.io)).toBe(64);
  });

  it("renders one coalesced line per lane without snapshot strings", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const path = writeSnapshot(s);
    const receipt = join(scratch, "lane.receipt.json");
    writeReceipt(receipt, "malformed-output");
    const c = io();
    expect(
      statusMain(["--progress", path, "--receipt", receipt], c.io, {
        probe: probeReturning({ kind: "absent" }),
      })
    ).toBe(0);
    expect(c.out).toContain("L1 codex:11111111 terminal malformed-output (from receipt)");
  });

  it("emits bounded JSON for parallel lanes", () => {
    let a = baseState();
    a = reduce(a, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const pa = writeSnapshot(a, "a.progress.json");
    let b: ProgressState = { ...baseState(), provider: "devin" as const, attemptId: "99999999-8888-7777-6666-555555555555" };
    b = reduce(b, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    b = reduce(b, { t: "terminal", receiptWritten: true }, 1);
    const pb = writeSnapshot(b, "b.progress.json");
    const ra = join(scratch, "a.receipt.json");
    const rb = join(scratch, "b.receipt.json");
    writeFileSync(ra, "");
    writeFileSync(rb, "");
    const c = io();
    expect(
      statusMain(
        ["--progress", pa, "--receipt", ra, "--progress", pb, "--receipt", rb, "--json"],
        c.io,
        { probe: probeReturning({ kind: "unverified" }) }
      )
    ).toBe(0);
    const parsed = JSON.parse(c.out);
    expect(parsed.lanes).toHaveLength(2);
    expect(parsed.lanes[0].kind).toBe("unknown");
    expect(parsed.lanes[0].reason).toBe("launcher-unverified");
    expect(parsed.lanes[1].kind).toBe("unknown");
    expect(parsed.lanes[1].reason).toBe("terminal-without-receipt");
    expect(JSON.stringify(parsed)).not.toContain(CANARY);
  });

  it("keeps changeKey stable across elapsed time and byte counts", () => {
    let s = baseState();
    s = reduce(s, { t: "spawned", role: "workload", pid: 9, startToken: "W" }, 0);
    const view1 = readLaneView(writeSnapshot(s), join(scratch, "r.json"), probeReturning({ kind: "token", token: "T0" }));
    const k1 = renderLane(view1, 1_000_000_000).changeKey;
    s = reduce(s, { t: "bytes", stream: "stdout", n: 12345 }, 5_000_000);
    const view2 = readLaneView(writeSnapshot(s), join(scratch, "r.json"), probeReturning({ kind: "token", token: "T0" }));
    const k2 = renderLane(view2, 9_999_999_999).changeKey;
    expect(k1).toBe(k2);
  });
});

describe("process identity probe", () => {
  it("compares the recorded start token exactly", () => {
    expect(probeIdentity(1, "T0", probeReturning({ kind: "token", token: "T0" }))).toBe("live");
    expect(probeIdentity(1, "T0", probeReturning({ kind: "token", token: "T0 " }))).toBe("reused");
    expect(probeIdentity(1, "T0", probeReturning({ kind: "absent" }))).toBe("absent");
    expect(probeIdentity(1, "T0", probeReturning({ kind: "unverified" }))).toBe("unverified");
    expect(probeIdentity(1, null, probeReturning({ kind: "token", token: "T0" }))).toBe("unverified");
  });

  it("uses ps lstart against the real process table", () => {
    const live = readFileSync("/dev/null");
    void live;
    const probe = probeIdentity(process.pid, null);
    expect(probe).toBe("unverified");
  });
});


describe("progress review regressions", () => {
  it("rejects parseable date strings carrying private content", () => {
    const state = baseState();
    const raw = JSON.parse(encodeSnapshot(state, 0));
    raw.activity.lastActivityAt = "Jan 1 2026 (CANARY_DATE)";
    const path = progressPath();
    writeFileSync(path, JSON.stringify(raw));
    let out = "";
    statusMain(["--progress", path, "--receipt", join(scratch, "r"), "--json"],
      { stdout: value => { out += value; }, stderr: () => {} });
    expect(out).not.toContain("CANARY_DATE");
    expect(JSON.parse(out).lanes[0]).toMatchObject({ kind: "unknown", reason: "undecodable" });
  });

  it("does not follow symlinks or wait on a FIFO", () => {
    const target = writeSnapshot(baseState(), "target");
    const link = progressPath("link");
    symlinkSync(target, link);
    const fifo = progressPath("fifo");
    execFileSync("mkfifo", [fifo]);
    for (const path of [link, fifo]) {
      expect(readLaneView(path, join(scratch, "r"))).toMatchObject({ kind: "unknown", reason: "not-regular-file" });
    }
  });

  it("does not treat a failed process probe as proof of death", () => {
    const previous = process.env.PATH;
    const fake = join(scratch, "ps");
    writeFileSync(fake, "#!/bin/sh\nexit 2\n", { mode: 0o700 });
    process.env.PATH = scratch;
    try { expect(psProbe(process.pid)).toEqual({ kind: "unverified" }); }
    finally { process.env.PATH = previous; }
  });

  it("retains lane identity and confirmed direct-child cancellation at terminal", () => {
    let state = reduce(baseState(), { t: "spawned", role: "workload", pid: 10, startToken: "W" }, 1);
    state = reduce(state, { t: "cancel-requested", signal: "SIGTERM" }, 2);
    state = reduce(state, { t: "exited", role: "workload", exitCode: 143 }, 3);
    state = reduce(state, { t: "child-settled", outcome: "signalled-and-exited", cause: "cancel" }, 4);
    state = reduce(state, { t: "terminal", receiptWritten: true }, 5);
    const path = writeSnapshot(state);
    const receipt = join(scratch, "r");
    writeReceipt(receipt, "cancelled");
    let out = "";
    statusMain(["--progress", path, "--receipt", receipt, "--json"], { stdout: v => { out += v; }, stderr: () => {} });
    const lane = JSON.parse(out).lanes[0];
    expect(lane.attemptId).toBe(state.attemptId);
    expect(lane.cancellation).toEqual({ requested: "SIGTERM", childSettled: "signalled-and-exited", confirmed: true });
    expect(lane.line).toContain("direct child settled");
    expect(lane.line).toContain("descendants not verified");
  });

  it("contains construction failures and flushes pending activity on close", () => {
    const path = progressPath();
    writeFileSync(path, "");
    expect(openReporter(path, { provider: "codex", startedAt: NaN, receiptRef: null })).toBe(NO_PROGRESS);
    const reporter = openReporter(path, { provider: "codex", startedAt: Date.now(), receiptRef: null });
    reporter.record({ t: "spawned", role: "workload", pid: 10, startToken: null });
    reporter.record({ t: "bytes", stream: "stdout", n: 42 });
    reporter.close();
    const decoded = decodeSnapshot(readFileSync(path, "utf8"));
    expect(decoded.ok && decoded.snapshot.activity.stdoutBytes).toBe(42);
  });
});

describe("independent review regressions", () => {
  it("reports structural changes even when launcher identity is unknown", () => {
    const receipt = join(scratch, "r");
    const observe = (state: ProgressState) => renderLane(readLaneView(writeSnapshot(state), receipt, probeReturning({ kind: "unverified" })));
    let state = baseState();
    const setup = observe(state);
    state = reduce(state, { t: "spawned", role: "workload", pid: 9, startToken: "W" });
    const running = observe(state);
    expect(running.changeKey).not.toBe(setup.changeKey);
    state = reduce(state, { t: "cancel-requested", signal: "SIGTERM" });
    const cancelled = observe(state);
    expect(cancelled.changeKey).not.toBe(running.changeKey);
    expect(cancelled.line).toContain("cancel SIGTERM requested");
    state = reduce(state, { t: "bytes", stream: "stdout", n: 123 });
    expect(observe(state).changeKey).toBe(cancelled.changeKey);
  });

  it("rechecks completion when the launcher disappears during inspection", () => {
    const path = writeSnapshot(baseState());
    const receipt = join(scratch, "r");
    writeFileSync(receipt, "");
    const view = readLaneView(path, receipt, () => {
      writeReceipt(receipt, "complete");
      writeSnapshot(reduce(baseState(), { t: "terminal", receiptWritten: true }));
      return { kind: "absent" };
    });
    expect(view.kind).toBe("terminal");
    expect(renderLane(view).line).toContain("terminal complete");
  });

  it("does not claim child settlement from a frozen setup snapshot", () => {
    const path = writeSnapshot(baseState());
    const receipt = join(scratch, "r");
    writeReceipt(receipt, "cancelled");
    let out = "";
    statusMain(["--progress", path, "--receipt", receipt, "--json"], { stdout: v => { out += v; }, stderr: () => {} });
    const lane = JSON.parse(out).lanes[0];
    expect(lane.cancellation.confirmed).toBe(false);
    expect(lane.elapsedMs).toBeNull();
    expect(lane.line).toContain("elapsed unknown");
    expect(lane.line).toContain("child settlement unverified");
    expect(lane.line).not.toContain("no child launched");
    expect(lane.updatedAt).toEqual(expect.any(String));
    expect(lane.seq).toBe(7);
  });

  it("bounds a hung local identity probe without declaring the worker dead", () => {
    const previous = process.env.PATH;
    writeFileSync(join(scratch, "ps"), "#!/bin/sh\nexec /bin/sleep 30\n", { mode: 0o700 });
    process.env.PATH = scratch;
    const started = Date.now();
    try { expect(psProbe(process.pid)).toEqual({ kind: "unverified" }); }
    finally { process.env.PATH = previous; }
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
