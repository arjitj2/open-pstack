import { readFileSync } from "node:fs";
import {
  ACCESS_MODES,
  PARENTS,
  PROVIDERS,
  WORKER_CONTRACT_MODES,
  UsageError,
  type AccessMode,
  type Parent,
  type Provider,
  type WorkerContractMode,
} from "../runner/types.ts";
import {
  interpretWorkerResult,
  prepareAssignment,
} from "./worker-contract.ts";
import {
  OperationLedgerError,
  readLedger,
  recordOperation,
  writeLedger,
  type OperationInput,
} from "./operations.ts";
import {
  PARENT_OPERATION_KINDS,
  type ParentOperationKind,
} from "../runner/types.ts";

const HELP = `Usage: pstack-worker-contract <command> [options]

Commands:
  prepare --parent <claude|codex> --provider <provider> --route <native|external> \
          --mode <read-only|isolated-write> --contract <legacy|strict> [--host-verified]
      Print the prepared assignment or the unsupported-capability verdict as
      JSON. A strict contract reports "unsupported" with the missing
      capabilities when the route cannot carry it; --host-verified asserts
      the caller already probed the host control (the installed claude CLI
      advertising --restricted and --permission-prompts) for the claude
      external route. This command never launches a worker.
  interpret --response <file>
      Parse one worker final response and print the typed outcome as JSON:
      complete, needs-parent-operation, or failed with a malformed handoff.
      Permission interruptions come only from provider-owned evidence, never
      from this boundary.
  op-record --ledger <file> --id <op id> --task <task id> --checkpoint <checkpoint id> \
            --kind <commit-checkpoint|run-checks> --state <pending|complete|rejected> \
            [--expected <json>] [--result <json>]
      Record or transition one parent operation. Repeating an identical call
      is idempotent; a pending record may transition to complete or rejected;
      contradictory reuse of an id, or a different id for the same task,
      checkpoint, and kind, is an ambiguous duplicate that exits nonzero.
  op-status --ledger <file>
      Print the recorded operations and the pending set as JSON.

This helper renders contracts, parses worker output, and keeps the operation
ledger. It never runs the recorded operation itself: the parent performs
each operation with its own arguments and records the verdict here.
`;

interface Io {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

const defaultIo: Io = {
  stdout: (value) => process.stdout.write(value),
  stderr: (value) => process.stderr.write(value),
};

function optionValue(name: string, argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${name} requires a value`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  name: string,
  value: string,
  allowed: T
): T[number] {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new UsageError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function jsonValue(name: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${name} is not valid JSON`);
  }
}

function commandPrepare(argv: readonly string[], io: Io): number {
  let parent: string | undefined;
  let provider: string | undefined;
  let route: string | undefined;
  let mode: string | undefined;
  let contract: string | undefined;
  let hostVerified = false;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--parent":
        parent = optionValue("--parent", argv, i);
        i += 1;
        break;
      case "--provider":
        provider = optionValue("--provider", argv, i);
        i += 1;
        break;
      case "--route":
        route = optionValue("--route", argv, i);
        i += 1;
        break;
      case "--mode":
        mode = optionValue("--mode", argv, i);
        i += 1;
        break;
      case "--contract":
        contract = optionValue("--contract", argv, i);
        i += 1;
        break;
      case "--host-verified":
        hostVerified = true;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (parent === undefined) throw new UsageError("--parent is required");
  if (provider === undefined) throw new UsageError("--provider is required");
  if (route === undefined) throw new UsageError("--route is required");
  if (mode === undefined) throw new UsageError("--mode is required");
  if (route !== "native" && route !== "external") {
    throw new UsageError("--route must be native or external");
  }
  const result = prepareAssignment(
    {
      parent: oneOf("--parent", parent, PARENTS) as Parent,
      provider: oneOf("--provider", provider, PROVIDERS) as Provider,
      route,
      access: oneOf("--mode", mode, ACCESS_MODES) as AccessMode,
      contract: (contract === undefined
        ? "legacy"
        : oneOf("--contract", contract, WORKER_CONTRACT_MODES)) as WorkerContractMode,
    },
    hostVerified
  );
  io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

function commandInterpret(argv: readonly string[], io: Io): number {
  let response: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--response":
        response = optionValue("--response", argv, i);
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (response === undefined) throw new UsageError("--response is required");
  let text: string;
  try {
    text = readFileSync(response, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(`cannot read response ${response}: ${message}`);
  }
  const outcome = interpretWorkerResult({
    delivered: true,
    finalText: text,
    denial: null,
  });
  io.stdout(`${JSON.stringify(outcome, null, 2)}\n`);
  return 0;
}

function commandOpRecord(argv: readonly string[], io: Io): number {
  let ledgerPath: string | undefined;
  let id: string | undefined;
  let task: string | undefined;
  let checkpoint: string | undefined;
  let kind: string | undefined;
  let state: string | undefined;
  let expected: unknown = {};
  let result: unknown = undefined;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--ledger":
        ledgerPath = optionValue("--ledger", argv, i);
        i += 1;
        break;
      case "--id":
        id = optionValue("--id", argv, i);
        i += 1;
        break;
      case "--task":
        task = optionValue("--task", argv, i);
        i += 1;
        break;
      case "--checkpoint":
        checkpoint = optionValue("--checkpoint", argv, i);
        i += 1;
        break;
      case "--kind":
        kind = optionValue("--kind", argv, i);
        i += 1;
        break;
      case "--state":
        state = optionValue("--state", argv, i);
        i += 1;
        break;
      case "--expected":
        expected = jsonValue("--expected", optionValue("--expected", argv, i));
        i += 1;
        break;
      case "--result":
        result = jsonValue("--result", optionValue("--result", argv, i));
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (ledgerPath === undefined) throw new UsageError("--ledger is required");
  if (id === undefined) throw new UsageError("--id is required");
  if (task === undefined) throw new UsageError("--task is required");
  if (checkpoint === undefined) throw new UsageError("--checkpoint is required");
  if (kind === undefined) throw new UsageError("--kind is required");
  if (state === undefined) throw new UsageError("--state is required");
  if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
    throw new UsageError("--expected must be a JSON object");
  }
  const input: OperationInput = {
    id,
    task,
    checkpoint,
    kind: oneOf("--kind", kind, PARENT_OPERATION_KINDS) as ParentOperationKind,
    state: oneOf("--state", state, ["pending", "complete", "rejected"] as const) as OperationInput["state"],
    expected: expected as Record<string, unknown>,
    result,
  };
  const ledger = readLedger(ledgerPath);
  const outcome = recordOperation(ledger, input, new Date().toISOString());
  writeLedger(ledgerPath, ledger);
  io.stdout(`${JSON.stringify(outcome, null, 2)}\n`);
  return 0;
}

function commandOpStatus(argv: readonly string[], io: Io): number {
  let ledgerPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    switch (argv[i]) {
      case "--ledger":
        ledgerPath = optionValue("--ledger", argv, i);
        i += 1;
        break;
      default:
        throw new UsageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (ledgerPath === undefined) throw new UsageError("--ledger is required");
  const ledger = readLedger(ledgerPath);
  io.stdout(
    `${JSON.stringify(
      {
        operations: ledger.operations,
        pending: ledger.operations.filter((entry) => entry.state === "pending").map((entry) => entry.id),
      },
      null,
      2
    )}\n`
  );
  return 0;
}

export function main(argv: readonly string[], io: Io = defaultIo): number {
  try {
    const command = argv[0];
    if (command === undefined || command === "--help" || command === "-h") {
      io.stdout(HELP);
      return 0;
    }
    if (command === "prepare") return commandPrepare(argv.slice(1), io);
    if (command === "interpret") return commandInterpret(argv.slice(1), io);
    if (command === "op-record") return commandOpRecord(argv.slice(1), io);
    if (command === "op-status") return commandOpStatus(argv.slice(1), io);
    throw new UsageError(`unknown command: ${command}`);
  } catch (error) {
    if (error instanceof OperationLedgerError) {
      io.stderr(`invalid operation:\n${error.message}\n`);
      return 65;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`error: ${message}\n`);
    io.stderr(HELP);
    return 64;
  }
}
