export const PARENTS = ["claude", "codex"] as const;
export const PROVIDERS = ["claude", "codex", "grok", "devin", "cursor"] as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const ACCESS_MODES = ["read-only", "isolated-write"] as const;

export type Parent = (typeof PARENTS)[number];
export type Provider = (typeof PROVIDERS)[number];
export type Effort = (typeof EFFORTS)[number] | "default";
export type AccessMode = (typeof ACCESS_MODES)[number];

export interface RunnerOptions {
  readonly parent: Parent;
  readonly provider: Provider;
  readonly model: string;
  readonly effort: Effort;
  readonly mode: AccessMode;
  readonly promptPath: string;
  readonly cwd: string;
  readonly outputPath: string;
  readonly receiptPath: string;
  readonly timeoutMs: number | null;
  readonly apiSpend: ApiSpendMode | null;
}

export const RECEIPT_STATUSES = [
  "complete",
  "cancelled",
  "unavailable-cli",
  "unauthenticated",
  "unavailable-model",
  "usage-exhausted",
  "billing-policy-blocked",
  "timed-out",
  "child-failed",
  "malformed-output",
] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export type FailurePhase = "preflight" | "invocation" | "postprocess";

export const API_SPEND_MODES = ["deny", "approved"] as const;
export type ApiSpendMode = (typeof API_SPEND_MODES)[number];
export type ReceiptApiSpend = ApiSpendMode | "legacy";

export interface NormalizedUsage {
  readonly inputTokens?: number;
  readonly cachedInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
}

export interface ParsedOutput {
  readonly text: string;
  readonly reportedModel: string | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
}

export interface RunnerReceipt {
  readonly schemaVersion: 1;
  readonly status: ReceiptStatus;
  readonly parent: Parent;
  readonly provider: Provider;
  readonly model: string;
  readonly effort: Effort;
  readonly mode: AccessMode;
  readonly cwd: string;
  readonly promptPath: string;
  readonly outputPath: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly elapsedMs: number;
  readonly executable: string | null;
  readonly preflight: {
    readonly argv: readonly string[];
    readonly status: "passed" | "failed" | "timed-out" | "cancelled" | "not-run";
    readonly evidence: string;
  };
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly reportedModel: string | null;
  readonly modelVerified: boolean;
  readonly modelEvidence: "provider-report" | "pinned-argv" | null;
  readonly sessionId: string | null;
  readonly usage: NormalizedUsage | null;
  readonly costUsd: number | null;
  readonly error: {
    readonly message: string;
    readonly evidence: string;
  } | null;
  readonly failurePhase: FailurePhase | null;
  readonly processStarted: boolean;
  readonly apiSpend: ReceiptApiSpend;
  // The explicit launcher deadline when one was supplied, or null. Absent on
  // receipts written before this field existed.
  readonly timeoutMs?: number | null;
  // True when a trusted terminal success shape was observed alongside the
  // failure (for example a final successful result with a nonzero exit). The
  // conflict is preserved here so a retry is never authorized on top of it.
  readonly terminalSuccess?: boolean;
}

export class UsageError extends Error {}
