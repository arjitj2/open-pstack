import { parseArgs as parseNodeArgs } from "node:util";
import { resolvedOptions, runLane } from "./run.ts";
import {
  ACCESS_MODES,
  API_SPEND_MODES,
  EFFORTS,
  PARENTS,
  PROVIDERS,
  type AccessMode,
  type ApiSpendMode,
  type Effort,
  type Parent,
  type Provider,
  type RunnerOptions,
  UsageError,
} from "./types.ts";

const HELP = `Usage: pstack-runner --parent <claude|codex> --provider <claude|codex|grok|devin|cursor|antigravity|opencode> \\
  --model <slug> --effort <level> --mode <read-only|isolated-write> \\
  --prompt <file> --cwd <dir> --output <file> --receipt <file> [--timeout <seconds>]
  [--api-spend <deny|approved>]

Runs exactly one external model lane. A call on the parent's own provider is
rejected when a shipped native lane covers that model and effort; other model
IDs run through this launcher. Output and receipt
paths must not already exist. There is no implicit timeout. Pass --timeout only
when the user or task supplies a real deadline; it is one end-to-end launcher
deadline shared by setup, preflight, and model execution.

--api-spend deny blocks before execution when a known ambient API credential
or provider-selection control (for example CURSOR_API_KEY, ANTHROPIC_API_KEY,
ANTHROPIC_AUTH_TOKEN, ANTHROPIC_AWS_API_KEY, or Claude's Bedrock/Vertex/Foundry
and base-URL routing variables) could take the lane off a subscription-only
route. Claude skips auth-status because startup refresh can invalidate login;
authentication is deferred to invocation and its billing route is unverified.
Codex additionally requires ChatGPT authentication from login status. Grok
is blocked under deny because per-model BYOK can override session auth.
Devin and Cursor use bounded environment/endpoint guards, ordinary account
checks, and isolated runner configuration. Antigravity requires an explicit
--api-spend choice; deny checks known environment routes and settings.json.
--api-spend approved
explicitly authorizes the paid route and records it in the receipt. Omitting
the flag preserves the legacy behavior for configurations written before
billing policy existed. OpenCode is new and requires explicit --api-spend approved;
subscription routing is unproven. It requires provider/model and default effort.
Read-only permits file inspection; isolated-write requires a Git worktree root
and additionally permits edits. Neither mode permits shell commands. OpenCode
tool permissions are not an OS sandbox. The guard covers known ambient credential and routing
takeover plus observable auth evidence only; provider-managed overage,
on-demand credits, or account billing controls are not guaranteed locally.
`;

interface Io {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: Io = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function oneOf<T extends string>(
  name: string,
  value: string | undefined,
  choices: readonly T[]
): T {
  if (value === undefined || !choices.includes(value as T)) {
    throw new UsageError(`${name} must be one of: ${choices.join(", ")}`);
  }
  return value as T;
}

function required(name: string, value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    throw new UsageError(`${name} is required`);
  }
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseArgs(argv: readonly string[]): RunnerOptions | null {
  let parsed: ReturnType<typeof parseNodeArgs>;
  try {
    parsed = parseNodeArgs({
      args: [...argv],
      allowPositionals: false,
      strict: true,
      options: {
        parent: { type: "string" },
        provider: { type: "string" },
        model: { type: "string" },
        effort: { type: "string" },
        mode: { type: "string" },
        prompt: { type: "string" },
        cwd: { type: "string" },
        output: { type: "string" },
        receipt: { type: "string" },
        timeout: { type: "string" },
        "api-spend": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (parsed.values.help) return null;
  const mode = oneOf(
    "mode",
    stringValue(parsed.values.mode),
    ACCESS_MODES
  ) as AccessMode;
  const timeoutValue = stringValue(parsed.values.timeout);
  const timeoutSeconds = timeoutValue === undefined ? null : Number(timeoutValue);
  if (
    timeoutSeconds !== null &&
    (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
  ) {
    throw new UsageError("timeout must be a number greater than zero");
  }
  const apiSpendValue = stringValue(parsed.values["api-spend"]);
  const apiSpend = apiSpendValue === undefined
    ? null
    : (oneOf("api-spend", apiSpendValue, API_SPEND_MODES) as ApiSpendMode);
  return resolvedOptions({
    parent: oneOf("parent", stringValue(parsed.values.parent), PARENTS) as Parent,
    provider: oneOf("provider", stringValue(parsed.values.provider), PROVIDERS) as Provider,
    model: required("model", stringValue(parsed.values.model)),
    effort: oneOf("effort", stringValue(parsed.values.effort), [...EFFORTS, "default"]) as Effort,
    mode,
    promptPath: required("prompt", stringValue(parsed.values.prompt)),
    cwd: required("cwd", stringValue(parsed.values.cwd)),
    outputPath: required("output", stringValue(parsed.values.output)),
    receiptPath: required("receipt", stringValue(parsed.values.receipt)),
    timeoutMs: timeoutSeconds === null ? null : timeoutSeconds * 1_000,
    apiSpend,
  });
}

export async function main(
  argv: readonly string[],
  startedAt: number = Date.now(),
  io: Io = defaultIo
): Promise<number> {
  try {
    const options = parseArgs(argv);
    if (options === null) {
      io.stdout(HELP);
      return 0;
    }
    const result = await runLane(options, startedAt);
    const rendered = `${JSON.stringify(result.receipt)}\n`;
    if (result.exitCode === 0) io.stdout(rendered);
    else io.stderr(rendered);
    return result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    io.stderr(HELP);
    return 64;
  }
}
