import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { openCodeFunding } from "./opencode.ts";
import { main, parseArgs } from "./cli.ts";

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

describe("runner --progress flag", () => {
  it("leaves progress unset by default", () => {
    expect(parseArgs(argv())?.progressPath).toBeNull();
  });

  it("resolves an explicit progress path", () => {
    expect(
      parseArgs(argv(["--progress", "lane.progress.json"]))?.progressPath
    ).toBe(join(process.cwd(), "lane.progress.json"));
  });
});

describe("runner status subcommand", () => {
  const io = () => {
    const captured = {
      out: "",
      err: "",
      stdout: (value: string) => {
        captured.out += value;
      },
      stderr: (value: string) => {
        captured.err += value;
      },
    };
    return captured;
  };

  it("routes status before the strict run-lane parser", async () => {
    const captured = io();
    const code = await main(
      ["status", "--progress", "missing.progress.json", "--receipt", "missing.receipt.json"],
      0,
      captured
    );
    expect(code).toBe(0);
    expect(captured.out).toContain("L1 unknown:");
  });

  it("rejects unpaired progress and receipt arguments", async () => {
    const captured = io();
    const code = await main(
      ["status", "--progress", "only.progress.json"],
      0,
      captured
    );
    expect(code).toBe(64);
    expect(captured.err).toContain("--progress");
  });
});

describe("runner explicit OpenCode ChatGPT subscription flag", () => {
  const subscriptionArgs = () => argv().map((value,index,values) => values[index-1] === "--provider" ? "opencode" : values[index-1] === "--model" ? "openai/gpt-6.1-sol" : values[index-1] === "--effort" ? "default" : value);
  it("preserves the explicit flag and denied spend", () => {
    expect(parseArgs([...subscriptionArgs(),"--opencode-chatgpt-subscription","--api-spend","deny"])).toMatchObject({opencodeChatgptSubscription:true,apiSpend:"deny"});
  });
  for(const extra of [[],["--api-spend","approved"]]) it("rejects incompatible subscription funding", () => {
    expect(() => { const opts = parseArgs([...subscriptionArgs(),"--opencode-chatgpt-subscription",...extra]); if (opts !== null) openCodeFunding(opts); }).toThrow();
  });
});
