import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { parseArgs } from "./cli.ts";

function argv(extra: readonly string[] = []): string[] {
  return [
    "--parent",
    "claude",
    "--provider",
    "codex",
    "--model",
    "gpt-5.6-sol",
    "--effort",
    "max",
    "--mode",
    "read-only",
    "--prompt",
    join(process.cwd(), "prompt.md"),
    "--cwd",
    process.cwd(),
    "--output",
    join(process.cwd(), "output.md"),
    "--receipt",
    join(process.cwd(), "receipt.json"),
    ...extra,
  ];
}

describe("runner CLI parsing", () => {
  it("does not invent a timeout", () => {
    expect(parseArgs(argv())?.timeoutMs).toBeNull();
  });

  it("honors an explicit positive timeout", () => {
    expect(parseArgs(argv(["--timeout", "5400"]))?.timeoutMs).toBe(5_400_000);
  });

  it("rejects a non-positive timeout", () => {
    expect(() => parseArgs(argv(["--timeout", "0"]))).toThrow(
      "greater than zero"
    );
  });
});

describe("runner --api-spend flag", () => {
  it("leaves billing policy unset for legacy calls", () => {
    expect(parseArgs(argv())?.apiSpend).toBeNull();
  });

  it("accepts explicit deny and approved modes", () => {
    expect(parseArgs(argv(["--api-spend", "deny"]))?.apiSpend).toBe("deny");
    expect(parseArgs(argv(["--api-spend", "approved"]))?.apiSpend).toBe("approved");
  });

  it("rejects an unrecognized spend mode", () => {
    expect(() => parseArgs(argv(["--api-spend", "maybe"]))).toThrow("api-spend");
  });
});
