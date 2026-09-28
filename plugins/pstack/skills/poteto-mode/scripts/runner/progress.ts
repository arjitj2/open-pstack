import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  readSync,
  fstatSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  PROVIDERS,
  RECEIPT_STATUSES,
  type Provider,
  type ReceiptStatus,
} from "./types.ts";

export const PROGRESS_KIND = "pstack-runner-progress";
export const SNAPSHOT_MAX_BYTES = 4_096;
export const SNAPSHOT_READ_LIMIT = 8_192;
export const RECEIPT_READ_LIMIT = 262_144;
export const ACTIVITY_FLUSH_MS = 5_000;

export type ChildRole = "preflight" | "workload";

export const PHASES = [
  "setup",
  "preflight",
  "preflight-retry-wait",
  "workload-running",
  "workload-draining",
  "postprocess",
  "terminal",
] as const;
export type Phase = (typeof PHASES)[number];

export type CancellationSignal = "SIGINT" | "SIGTERM";
export type SettledOutcome = "signalled-and-exited" | "already-exited";
export type SettledCause = "cancel" | "deadline";

interface ChildProgress {
  readonly role: ChildRole;
  readonly pid: number;
  readonly startToken: string | null;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly drained: boolean;
}

export interface ProgressState {
  readonly attemptId: string;
  readonly provider: Provider;
  readonly runner: {
    readonly pid: number;
    readonly startedAt: string;
    readonly startToken: string | null;
  };
  readonly child: ChildProgress | null;
  readonly retryWait: boolean;
  readonly activity: {
    readonly stdoutBytes: number;
    readonly stderrBytes: number;
    readonly lastActivityAt: string | null;
  };
  readonly cancellation: {
    readonly requested: { readonly signal: CancellationSignal; readonly at: string } | null;
  };
  readonly childSettled: {
    readonly outcome: SettledOutcome;
    readonly cause: SettledCause;
    readonly at: string;
  } | null;
  readonly terminal: { readonly at: string; readonly receiptWritten: boolean } | null;
  readonly receiptRef: { readonly dev: number; readonly ino: number } | null;
}

export type ProgressEvent =
  | { readonly t: "spawned"; readonly role: ChildRole; readonly pid: number; readonly startToken: string | null }
  | { readonly t: "exited"; readonly role: ChildRole; readonly exitCode: number }
  | { readonly t: "drained"; readonly role: ChildRole }
  | { readonly t: "bytes"; readonly stream: "stdout" | "stderr"; readonly n: number }
  | { readonly t: "retry-wait"; readonly on: boolean }
  | { readonly t: "cancel-requested"; readonly signal: CancellationSignal }
  | { readonly t: "child-settled"; readonly outcome: SettledOutcome; readonly cause: SettledCause }
  | { readonly t: "terminal"; readonly receiptWritten: boolean };

export function phaseOf(state: ProgressState): Phase {
  if (state.terminal !== null) return "terminal";
  if (state.retryWait) return "preflight-retry-wait";
  if (state.child === null) return "setup";
  if (state.child.role === "preflight") return "preflight";
  if (state.child.running) return "workload-running";
  return state.child.drained ? "postprocess" : "workload-draining";
}

export function reduce(
  state: ProgressState,
  event: ProgressEvent,
  now: number = Date.now()
): ProgressState {
  if (state.terminal !== null) return state;
  const at = new Date(now).toISOString();
  switch (event.t) {
    case "spawned":
      return {
        ...state,
        retryWait: false,
        child: {
          role: event.role,
          pid: event.pid,
          startToken: event.startToken,
          running: true,
          exitCode: null,
          drained: false,
        },
      };
    case "exited":
      if (state.child === null || state.child.role !== event.role || !state.child.running) {
        return state;
      }
      return {
        ...state,
        child: { ...state.child, running: false, exitCode: event.exitCode },
      };
    case "drained":
      if (state.child === null || state.child.role !== event.role || state.child.running) {
        return state;
      }
      return { ...state, child: { ...state.child, drained: true } };
    case "bytes":
      if (state.child === null || state.child.role !== "workload" || event.n <= 0) {
        return state;
      }
      return {
        ...state,
        activity: {
          stdoutBytes: state.activity.stdoutBytes + (event.stream === "stdout" ? event.n : 0),
          stderrBytes: state.activity.stderrBytes + (event.stream === "stderr" ? event.n : 0),
          lastActivityAt: at,
        },
      };
    case "retry-wait":
      return { ...state, retryWait: event.on };
    case "cancel-requested":
      if (state.cancellation.requested !== null) return state;
      return {
        ...state,
        cancellation: { requested: { signal: event.signal, at } },
      };
    case "child-settled":
      return {
        ...state,
        childSettled: { outcome: event.outcome, cause: event.cause, at },
      };
    case "terminal":
      return { ...state, terminal: { at, receiptWritten: event.receiptWritten } };
  }
}

export interface SnapshotV1 extends ProgressState {
  readonly schemaVersion: 1;
  readonly kind: typeof PROGRESS_KIND;
  readonly seq: number;
  readonly updatedAt: string;
  readonly phase: Phase;
}

export function encodeSnapshot(
  state: ProgressState,
  seq: number,
  now: number = Date.now()
): string {
  const snapshot: SnapshotV1 = {
    schemaVersion: 1,
    kind: PROGRESS_KIND,
    seq,
    updatedAt: new Date(now).toISOString(),
    phase: phaseOf(state),
    ...state,
  };
  return JSON.stringify(snapshot);
}

export type DecodeFailure =
  | "invalid-json"
  | "wrong-kind"
  | "unsupported-version"
  | "malformed";

export type DecodeResult =
  | { readonly ok: true; readonly snapshot: SnapshotV1 }
  | { readonly ok: false; readonly reason: DecodeFailure };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isIso = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isToken = (value: unknown): value is string | null =>
  value === null ||
  (typeof value === "string" && value.length <= 128 && /^[\x20-\x7e]*$/.test(value));
const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const oneOfStrings = (value: unknown, choices: readonly string[]): boolean =>
  typeof value === "string" && choices.includes(value);

function validChild(child: unknown): child is ChildProgress {
  if (!isObject(child)) return false;
  return (
    oneOfStrings(child.role, ["preflight", "workload"]) &&
    isCount(child.pid) &&
    (child.pid as number) > 0 &&
    isToken(child.startToken) &&
    typeof child.running === "boolean" &&
    (child.exitCode === null || isCount(child.exitCode)) &&
    typeof child.drained === "boolean"
  );
}

export function decodeSnapshot(text: string): DecodeResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }
  if (!isObject(value)) return { ok: false, reason: "malformed" };
  if (value.kind !== PROGRESS_KIND) return { ok: false, reason: "wrong-kind" };
  if (value.schemaVersion !== 1) return { ok: false, reason: "unsupported-version" };
  const s = value;
  const ok =
    isUuid(s.attemptId) &&
    isCount(s.seq) &&
    isIso(s.updatedAt) &&
    oneOfStrings(s.phase, PHASES) &&
    oneOfStrings(s.provider, PROVIDERS) &&
    isObject(s.runner) &&
    isCount(s.runner.pid) &&
    (s.runner.pid as number) > 0 &&
    isIso(s.runner.startedAt) &&
    isToken(s.runner.startToken) &&
    (s.child === null || validChild(s.child)) &&
    typeof s.retryWait === "boolean" &&
    isObject(s.activity) &&
    isCount(s.activity.stdoutBytes) &&
    isCount(s.activity.stderrBytes) &&
    (s.activity.lastActivityAt === null || isIso(s.activity.lastActivityAt)) &&
    isObject(s.cancellation) &&
    (s.cancellation.requested === null ||
      (isObject(s.cancellation.requested) &&
        oneOfStrings(s.cancellation.requested.signal, ["SIGINT", "SIGTERM"]) &&
        isIso(s.cancellation.requested.at))) &&
    (s.childSettled === null ||
      (isObject(s.childSettled) &&
        oneOfStrings(s.childSettled.outcome, ["signalled-and-exited", "already-exited"]) &&
        oneOfStrings(s.childSettled.cause, ["cancel", "deadline"]) &&
        isIso(s.childSettled.at))) &&
    (s.terminal === null ||
      (isObject(s.terminal) &&
        isIso(s.terminal.at) &&
        typeof s.terminal.receiptWritten === "boolean")) &&
    (s.receiptRef === null ||
      (isObject(s.receiptRef) && isCount(s.receiptRef.dev) && isCount(s.receiptRef.ino)));
  if (!ok) return { ok: false, reason: "malformed" };
  return { ok: true, snapshot: s as unknown as SnapshotV1 };
}

export type ProbeResult =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unverified" };

export type ProcessProbe = (pid: number) => ProbeResult;

export const psProbe: ProcessProbe = (pid) => {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      maxBuffer: 256,
      timeout: 1_000,
      killSignal: "SIGKILL",
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length === 0) throw new Error("No process-start token");
    return { kind: "token", token: out };
  } catch {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return { kind: "absent" };
    }
    return { kind: "unverified" };
  }
};

function observeStartToken(pid: number, observed: (token: string) => void): () => void {
  let stopped = false;
  let child: Bun.Subprocess<"ignore", "pipe", "ignore"> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = (): void => {
    stopped = true;
    clearImmediate(scheduled);
    if (timer !== null) clearTimeout(timer);
    try { if (child !== null && child.exitCode === null) child.kill("SIGKILL"); } catch {}
    void reader?.cancel().catch(() => {});
  };
  const scheduled = setImmediate(() => {
    if (stopped) return;
    void (async () => {
      try {
        child = Bun.spawn(["ps", "-p", String(pid), "-o", "lstart="], {
          stdin: "ignore", stdout: "pipe", stderr: "ignore",
          env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
        });
        child.unref();
        timer = setTimeout(stop, 1_000);
        timer.unref();
        reader = child.stdout.getReader();
        let bytes = Buffer.alloc(0);
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (bytes.length + chunk.value.byteLength > 256) return;
          bytes = Buffer.concat([bytes, chunk.value]);
        }
        const exitCode = await child.exited;
        const token = bytes.toString("utf8").trim();
        if (!stopped && exitCode === 0 && token.length > 0 && isToken(token)) observed(token);
      } catch {
      } finally {
        stop();
      }
    })();
  });
  scheduled.unref();
  return stop;
}

export type IdentityVerdict = "live" | "absent" | "reused" | "unverified";

export function probeIdentity(
  pid: number,
  recordedToken: string | null,
  probe: ProcessProbe = psProbe
): IdentityVerdict {
  if (recordedToken === null) return "unverified";
  const result = probe(pid);
  switch (result.kind) {
    case "absent":
      return "absent";
    case "unverified":
      return "unverified";
    case "token":
      return result.token === recordedToken ? "live" : "reused";
  }
}

export interface ProgressReporter {
  readonly attemptId: string;
  record(event: ProgressEvent): void;
  close(): void;
}

export const NO_PROGRESS: ProgressReporter = {
  attemptId: "00000000-0000-0000-0000-000000000000",
  record() {},
  close() {},
};

export interface ProgressInit {
  readonly provider: Provider;
  readonly startedAt: number;
  readonly receiptRef: { readonly dev: number; readonly ino: number } | null;
}

export interface ReporterDeps {
  readonly now?: () => number;
  readonly activityFlushMs?: number;
}

function fileIdentity(path: string): { dev: number; ino: number } | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return null;
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
}

export function openReporter(path: string, init: ProgressInit, deps: ReporterDeps = {}): ProgressReporter {
  try {
    return createReporter(path, init, deps);
  } catch {
    return NO_PROGRESS;
  }
}

function createReporter(
  path: string,
  init: ProgressInit,
  deps: ReporterDeps = {}
): ProgressReporter {
  const now = deps.now ?? (() => Date.now());
  const flushMs = deps.activityFlushMs ?? ACTIVITY_FLUSH_MS;
  let state: ProgressState = {
    attemptId: randomUUID(),
    provider: init.provider,
    runner: {
      pid: process.pid,
      startedAt: new Date(init.startedAt).toISOString(),
      startToken: null,
    },
    child: null,
    retryWait: false,
    activity: { stdoutBytes: 0, stderrBytes: 0, lastActivityAt: null },
    cancellation: { requested: null },
    childSettled: null,
    terminal: null,
    receiptRef: init.receiptRef,
  };
  let owned = fileIdentity(path);
  let seq = 0;
  let lastWriteAt = 0;
  let pendingActivity = false;
  let disabled = owned === null;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopRunnerProbe = (): void => {};
  let stopChildProbe = (): void => {};

  const clearPendingTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = (): void => {
    if (disabled || closed) return;
    try {
      const encoded = encodeSnapshot(state, ++seq, now());
      if (encoded.length > SNAPSHOT_MAX_BYTES) {
        disabled = true;
        return;
      }
      const temporary = join(
        dirname(path),
        `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
      );
      let tempIdentity: { dev: number; ino: number } | null = null;
      let temporaryCreated = false;
      try {
        const descriptor = openSync(temporary, "wx", 0o600);
        temporaryCreated = true;
        try {
          writeSync(descriptor, encoded);
          const stat = fstatSync(descriptor);
          tempIdentity = { dev: stat.dev, ino: stat.ino };
        } finally {
          closeSync(descriptor);
        }
        const current = fileIdentity(path);
        if (
          owned === null ||
          current === null ||
          current.dev !== owned.dev ||
          current.ino !== owned.ino
        ) {
          disabled = true;
          return;
        }
        renameSync(temporary, path);
        owned = tempIdentity;
        lastWriteAt = now();
        pendingActivity = false;
      } finally {
        try {
          if (temporaryCreated) unlinkSync(temporary);
        } catch {
        }
      }
    } catch {
      disabled = true;
    }
  };

  const armActivityTimer = (): void => {
    if (timer !== null || disabled || closed) return;
    const wait = Math.max(1, flushMs - (now() - lastWriteAt));
    timer = setTimeout(() => {
      timer = null;
      if (pendingActivity) flush();
    }, wait);
    timer.unref?.();
  };

  const reporter: ProgressReporter = {
    attemptId: state.attemptId,
    record(event: ProgressEvent): void {
      if (disabled || closed) return;
      try {
        state = reduce(state, event, now());
        if (event.t === "spawned") {
          stopChildProbe();
          stopChildProbe = observeStartToken(event.pid, (token) => {
            if (disabled || closed || state.terminal !== null || state.child?.pid !== event.pid || !state.child.running) return;
            state = { ...state, child: { ...state.child, startToken: token } };
            flush();
          });
        } else if (event.t === "exited" || event.t === "terminal") {
          stopChildProbe();
          if (event.t === "terminal") stopRunnerProbe();
        }
        if (event.t === "bytes") {
          pendingActivity = true;
          if (now() - lastWriteAt >= flushMs) flush();
          else armActivityTimer();
        } else {
          clearPendingTimer();
          pendingActivity = false;
          flush();
        }
      } catch {
        disabled = true;
      }
    },
    close(): void {
      if (closed) return;
      stopRunnerProbe();
      stopChildProbe();
      clearPendingTimer();
      if (pendingActivity) flush();
      closed = true;
    },
  };
  flush();
  if (!disabled) {
    stopRunnerProbe = observeStartToken(process.pid, (token) => {
      if (disabled || closed || state.terminal !== null) return;
      state = { ...state, runner: { ...state.runner, startToken: token } };
      flush();
    });
  }
  return reporter;
}

export type LaneView =
  | {
      readonly kind: "terminal";
      readonly status: ReceiptStatus;
      readonly snapshot: SnapshotV1 | null;
    }
  | {
      readonly kind: "active";
      readonly launcher: "live";
      readonly snapshot: SnapshotV1;
    }
  | {
      readonly kind: "interrupted";
      readonly reason: "launcher-gone" | "pid-reused";
      readonly child:
        | "possibly-running"
        | "gone"
        | "reused"
        | "unverified"
        | "exited"
        | "none";
      readonly snapshot: SnapshotV1;
    }
  | {
      readonly kind: "unknown";
      readonly reason:
        | "missing"
        | "not-started"
        | "not-regular-file"
        | "oversize"
        | "undecodable"
        | "terminal-without-receipt"
        | "launcher-unverified";
      readonly receiptWritten?: boolean;
      readonly snapshot: SnapshotV1 | null;
    };

type BoundedRead =
  | { kind: "ok"; text: string }
  | { kind: "missing" | "not-regular-file" | "oversize" | "undecodable" };

function readBounded(path: string, limit: number, ref?: { dev: number; ino: number } | null): BoundedRead {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: "not-regular-file" };
    if (ref != null && (stat.dev !== ref.dev || stat.ino !== ref.ino)) return { kind: "undecodable" };
    if (stat.size > limit) return { kind: "oversize" };
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    return length > limit ? { kind: "oversize" } : { kind: "ok", text: buffer.toString("utf8", 0, length) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { kind: code === "ENOENT" ? "missing" : code === "ELOOP" ? "not-regular-file" : "undecodable" };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readReceiptStatus(receiptPath: string, ref: { dev: number; ino: number } | null): { status: ReceiptStatus | null; exists: boolean } {
  const file = readBounded(receiptPath, RECEIPT_READ_LIMIT, ref);
  if (file.kind !== "ok") return { status: null, exists: file.kind !== "missing" };
  try {
    const parsed: unknown = JSON.parse(file.text);
    if (isObject(parsed) && (parsed.schemaVersion === 1 || parsed.schemaVersion === 2) && oneOfStrings(parsed.status, RECEIPT_STATUSES)) {
      return { status: parsed.status as ReceiptStatus, exists: true };
    }
  } catch {}
  return { status: null, exists: true };
}

function readSnapshot(progressPath: string):
  | { kind: "ok"; snapshot: SnapshotV1 }
  | { kind: "missing" | "not-regular-file" | "oversize" | "undecodable" } {
  const file = readBounded(progressPath, SNAPSHOT_READ_LIMIT);
  if (file.kind !== "ok") return file;
  const decoded = decodeSnapshot(file.text);
  return decoded.ok ? { kind: "ok", snapshot: decoded.snapshot } : { kind: "undecodable" };
}

export function readLaneView(
  progressPath: string,
  receiptPath: string,
  probe: ProcessProbe = psProbe
): LaneView {
  const snap = readSnapshot(progressPath);
  const receipt = readReceiptStatus(
    receiptPath,
    snap.kind === "ok" ? snap.snapshot.receiptRef : null
  );

  if (receipt.status !== null) {
    return {
      kind: "terminal",
      status: receipt.status,
      snapshot: snap.kind === "ok" ? snap.snapshot : null,
    };
  }
  if (snap.kind === "missing") {
    return {
      kind: "unknown",
      reason: receipt.exists ? "not-started" : "missing",
      snapshot: null,
    };
  }
  if (snap.kind !== "ok") {
    return { kind: "unknown", reason: snap.kind, snapshot: null };
  }
  let snapshot = snap.snapshot;
  if (snapshot.terminal !== null) {
    return {
      kind: "unknown",
      reason: "terminal-without-receipt",
      receiptWritten: snapshot.terminal.receiptWritten,
      snapshot,
    };
  }
  const launcher = probeIdentity(snapshot.runner.pid, snapshot.runner.startToken, probe);
  if (launcher === "live") return { kind: "active", launcher, snapshot };
  if (launcher === "unverified") return { kind: "unknown", reason: "launcher-unverified", snapshot };
  const finalSnapshot = readSnapshot(progressPath);
  if (finalSnapshot.kind === "ok" && finalSnapshot.snapshot.attemptId === snapshot.attemptId) {
    snapshot = finalSnapshot.snapshot;
  }
  const finalReceipt = readReceiptStatus(receiptPath, snapshot.receiptRef);
  if (finalReceipt.status !== null) return { kind: "terminal", status: finalReceipt.status, snapshot };
  if (snapshot.terminal !== null) {
    return { kind: "unknown", reason: "terminal-without-receipt", receiptWritten: snapshot.terminal.receiptWritten, snapshot };
  }
  let child: "possibly-running" | "gone" | "reused" | "unverified" | "exited" | "none";
  const observed = snapshot.child;
  if (observed === null) {
    child = "none";
  } else if (!observed.running) {
    child = "exited";
  } else {
    switch (probeIdentity(observed.pid, observed.startToken, probe)) {
      case "live":
        child = "possibly-running";
        break;
      case "absent":
        child = "gone";
        break;
      case "reused":
        child = "reused";
        break;
      case "unverified":
        child = "unverified";
        break;
    }
  }
  return {
    kind: "interrupted",
    reason: launcher === "absent" ? "launcher-gone" : "pid-reused",
    child,
    snapshot,
  };
}

function duration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(rest).padStart(2, "0")}s`;
  return `${rest}s`;
}

function byteCount(value: number): string {
  if (value >= 1_048_576) return `${Math.round(value / 1_048_576)} MB`;
  if (value >= 1_024) return `${Math.round(value / 1_024)} KB`;
  return `${value} B`;
}

export interface RenderedLane {
  readonly line: string;
  readonly changeKey: string;
}

export function renderLane(view: LaneView, now: number = Date.now()): RenderedLane {
  const snapshot = "snapshot" in view ? view.snapshot : null;
  const parts: string[] = [];
  let key = view.kind;

  if (view.kind === "terminal") {
    parts.push(`terminal ${view.status} (from receipt)`);
    if (snapshot !== null) {
      parts.push(snapshot.terminal === null ? "elapsed unknown" :
        `elapsed ${duration(Date.parse(snapshot.terminal.at) - Date.parse(snapshot.runner.startedAt))}`);
      if (view.status === "cancelled") {
        parts.push(snapshot.terminal === null ? "cancellation recorded, child settlement unverified" :
          snapshot.child === null ? "cancellation confirmed, no child launched" :
          snapshot.childSettled !== null && !snapshot.child.running ? "cancellation confirmed, direct child settled" : "cancellation recorded, child settlement unverified");
        parts.push("descendants not verified");
      }
    }
    key += `|${view.status}|${snapshot?.terminal !== null && snapshot?.terminal !== undefined}|${snapshot?.child?.running ?? ""}|${snapshot?.childSettled?.outcome ?? ""}`;
    return { line: parts.join(" "), changeKey: key };
  }
  if (view.kind === "unknown") {
    const detail =
      view.reason === "launcher-unverified"
        ? `launcher identity unverified; last observed ${snapshot?.phase ?? "setup"}`
        : view.reason === "terminal-without-receipt"
        ? view.receiptWritten === false
          ? "runner exited without a receipt"
          : "runner marked finished but the receipt is unreadable"
        : view.reason === "not-started"
          ? "receipt reserved, no progress yet"
          : view.reason === "missing"
            ? "no progress or receipt yet"
            : `progress unreadable (${view.reason})`;
    parts.push(`unknown: ${detail}`, "not a failure verdict");
    key += `|${view.reason}|${view.receiptWritten ?? ""}`;
    if (snapshot !== null && view.reason === "launcher-unverified") {
      const child = snapshot.child;
      parts.push(`elapsed ${duration(now - Date.parse(snapshot.runner.startedAt))}`);
      if (child !== null) parts.push(child.running ? "last observed direct child running" : "last observed direct child exited");
      const requested = snapshot.cancellation.requested;
      if (requested !== null) parts.push(`cancel ${requested.signal} requested, confirmation requires receipt`, "descendants not verified");
      parts.push("backend progress unknown; quiet is not failure");
      key += `|${snapshot.phase}|${child?.running ?? ""}|${child?.exitCode ?? ""}|${child?.drained ?? ""}|${requested?.signal ?? ""}|${snapshot.childSettled?.outcome ?? ""}`;
    }
    return { line: parts.join(" "), changeKey: key };
  }
  if (view.kind === "interrupted") {
    parts.push(
      `interrupted: launcher ${view.reason === "launcher-gone" ? "gone" : "pid reused"}`,
      `last phase ${snapshot?.phase ?? "setup"}`
    );
    if (view.child === "possibly-running") {
      parts.push("direct child may still be running");
    } else if (view.child !== "none") {
      parts.push(`direct child ${view.child}`);
    }
    parts.push("not a failure verdict");
    key += `|${view.reason}|${view.child}|${snapshot?.phase ?? ""}`;
    return { line: parts.join(" · "), changeKey: key };
  }

  const s = snapshot;
  const phase = s?.phase ?? "setup";
  const elapsed = s === null ? null : now - Date.parse(s.runner.startedAt);
  parts.push(phase + (elapsed === null ? "" : ` ${duration(elapsed)}`));
  if (s?.child != null) {
    parts.push(
      s.child.running
        ? "last observed direct child running"
        : `child exited ${s.child.exitCode ?? "?"}${s.child.drained ? "" : ", pipe open"}`
    );
  }
  if (s !== null) {
    if (s.activity.lastActivityAt === null) {
      parts.push("no output observed yet");
    } else {
      const ago = now - Date.parse(s.activity.lastActivityAt);
      const total = s.activity.stdoutBytes + s.activity.stderrBytes;
      parts.push(`last output ${duration(ago)} ago (${byteCount(total)})`);
    }
  }
  parts.push("runner present");
  const requested = s?.cancellation.requested ?? null;
  const settled = s?.childSettled ?? null;
  if (requested !== null) {
    parts.push(
      settled === null
        ? `cancel ${requested.signal} requested, unconfirmed`
        : settled.outcome === "signalled-and-exited"
          ? "cancel requested, direct child signalled and exited"
          : "cancel requested, child had already exited"
    );
    parts.push("descendants not verified");
  } else if (settled !== null) {
    parts.push(
      settled.outcome === "signalled-and-exited"
        ? "deadline: direct child signalled and exited"
        : "deadline: child had already exited"
    );
  }
  parts.push("backend progress unknown; quiet is not failure");
  key += `|${phase}|${s?.child?.running ?? ""}|${s?.child?.exitCode ?? ""}|${s?.child?.drained ?? ""}|${view.launcher}|${requested?.signal ?? ""}|${settled?.outcome ?? ""}|${settled?.cause ?? ""}`;
  return { line: parts.join(" · "), changeKey: key };
}

export interface StatusIo {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface StatusDeps {
  readonly probe?: ProcessProbe;
  readonly now?: () => number;
}

const STATUS_USAGE =
  "Usage: pstack-runner status --progress <file> --receipt <file> [--progress <file> --receipt <file> ...] [--json]\n";

function laneJson(
  index: number,
  view: LaneView,
  rendered: RenderedLane,
  now: number
): Record<string, unknown> {
  const snapshot = "snapshot" in view ? view.snapshot : null;
  const base: Record<string, unknown> = {
    lane: index + 1,
    provider: snapshot?.provider ?? null,
    attemptId: snapshot?.attemptId ?? null,
    kind: view.kind,
    updatedAt: snapshot?.updatedAt ?? null,
    seq: snapshot?.seq ?? null,
    line: rendered.line,
    changeKey: `${snapshot?.attemptId ?? index + 1}|${rendered.changeKey}`,
    elapsedMs: snapshot === null || (view.kind === "terminal" && snapshot.terminal === null)
      ? null
      : Math.max(0, Date.parse(snapshot.terminal?.at ?? new Date(now).toISOString()) - Date.parse(snapshot.runner.startedAt)),
    cancellation: snapshot === null ? null : {
      requested: snapshot.cancellation.requested?.signal ?? null,
      childSettled: snapshot.childSettled?.outcome ?? null,
      confirmed: snapshot.terminal !== null && view.kind === "terminal" && view.status === "cancelled" &&
        (snapshot.child === null || (!snapshot.child.running && snapshot.childSettled !== null)),
    },
  };
  switch (view.kind) {
    case "terminal":
      return { ...base, status: view.status };
    case "unknown":
      return {
        ...base,
        reason: view.reason,
        receiptWritten: view.receiptWritten ?? null,
        phase: snapshot?.phase ?? null,
      };
    case "interrupted":
      return {
        ...base,
        reason: view.reason,
        child: view.child,
        phase: snapshot?.phase ?? null,
      };
    case "active": {
      const s = view.snapshot;
      return {
        ...base,
        phase: s.phase,
        launcher: view.launcher,
        retryWait: s.retryWait,
        child:
          s.child === null
            ? null
            : {
                role: s.child.role,
                running: s.child.running,
                exitCode: s.child.exitCode,
                drained: s.child.drained,
              },
        activity: {
          stdoutBytes: s.activity.stdoutBytes,
          stderrBytes: s.activity.stderrBytes,
          lastActivityAt: s.activity.lastActivityAt,
        },
        cancellation: {
          requested: s.cancellation.requested === null
            ? null
            : { signal: s.cancellation.requested.signal },
          childSettled: s.childSettled === null
            ? null
            : { outcome: s.childSettled.outcome, cause: s.childSettled.cause },
        },
      };
    }
  }
}

export function statusMain(
  argv: readonly string[],
  io: StatusIo,
  deps: StatusDeps = {}
): number {
  const progressPaths: string[] = [];
  const receiptPaths: string[] = [];
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--progress" || arg === "--receipt") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        io.stderr(`error: ${arg} requires a value\n${STATUS_USAGE}`);
        return 64;
      }
      (arg === "--progress" ? progressPaths : receiptPaths).push(value);
      index += 1;
    } else {
      io.stderr(`error: unknown status argument\n${STATUS_USAGE}`);
      return 64;
    }
  }
  if (progressPaths.length === 0 || progressPaths.length !== receiptPaths.length) {
    io.stderr(`error: status needs an equal number of --progress and --receipt pairs\n${STATUS_USAGE}`);
    return 64;
  }
  const probe = deps.probe ?? psProbe;
  const now = deps.now?.() ?? Date.now();
  const lanes = progressPaths.map((progressPath, index) => {
    const view = readLaneView(progressPath, receiptPaths[index], probe);
    const rendered = renderLane(view, now);
    return { view, rendered };
  });
  if (json) {
    io.stdout(
      `${JSON.stringify({
        schemaVersion: 1,
        lanes: lanes.map((lane, index) => laneJson(index, lane.view, lane.rendered, now)),
      })}\n`
    );
  } else {
    for (const [index, lane] of lanes.entries()) {
      const snapshot = "snapshot" in lane.view ? lane.view.snapshot : null;
      const label = snapshot === null
        ? `L${index + 1}`
        : `L${index + 1} ${snapshot.provider}:${snapshot.attemptId.slice(0, 8)}`;
      io.stdout(`${label} ${lane.rendered.line}\n`);
    }
  }
  return 0;
}
