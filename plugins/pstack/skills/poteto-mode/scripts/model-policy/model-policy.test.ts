import { describe, expect, it } from "bun:test";
import {
  ModelPolicyError,
  assertCompleteSheet,
  nextAttempt,
  parseSheet,
  renderSheet,
  resolveRole,
  validateSheet,
  type LanePolicy,
} from "./model-policy.ts";

const FIRST_RUN = `# pstack model configuration

Provider-qualified per-role choices.

# budget: unlimited (max)

feature, refactoring: grok:grok-4.7@xhigh
bug-fix: codex:gpt-5.6-sol@max
perf-issue: codex:gpt-5.6-sol@max
hillclimb: codex:gpt-5.6-sol@max
judgment and prose: claude:opus@max
hardest tasks: claude:opus@max
how explorer: grok:grok-4.7@xhigh
how explainer: claude:opus@max
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
arena cross-judge pool: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
swarm workers: grok:grok-4.7@xhigh
architect runners: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
interrogate reviewers: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max
`;

function parse(text: string) {
  return parseSheet(text);
}

describe("model sheet parser", () => {
  it("parses a legacy single-attempt sheet with no fallback permission", () => {
    const model = parse(FIRST_RUN);
    expect(model.budget).toBe("unlimited (max)");
    expect(model.rows).toHaveLength(15);
    const feature = model.rows.find((row) => row.spec.header === "feature, refactoring");
    expect(feature?.seats).toHaveLength(1);
    expect(feature?.seats[0].attempts).toHaveLength(1);
    const arena = model.rows.find((row) => row.spec.header === "arena runners");
    expect(arena?.seats).toHaveLength(3);
    for (const seat of arena?.seats ?? []) expect(seat.attempts).toHaveLength(1);
  });

  it("parses comma-bearing role headers before the right-hand side", () => {
    const model = parse(FIRST_RUN);
    const why = model.rows.find((row) => row.spec.header === "why investigators, synthesizer");
    expect(why?.spec.roles).toEqual(["why investigators", "synthesizer"]);
    const reflect = model.rows.find(
      (row) => row.spec.header === "reflect tooling, judgment, divergent, synthesizer"
    );
    expect(reflect?.spec.roles).toEqual([
      "reflect tooling",
      "judgment",
      "divergent",
      "synthesizer",
    ]);
  });

  it("parses an ordered attempt chain per seat and preserves order", () => {
    const text = FIRST_RUN.replace(
      "feature, refactoring: grok:grok-4.7@xhigh",
      "feature, refactoring: grok:grok-4.7@xhigh -> codex:gpt-5.6-sol@high -> devin:swe-2@medium"
    );
    const model = parse(text);
    const row = model.rows.find((entry) => entry.spec.header === "feature, refactoring");
    expect(row?.seats[0].attempts.map((attempt) =>
      attempt.kind === "descriptor" ? `${attempt.provider}:${attempt.model}@${attempt.effort}` : attempt.alias
    )).toEqual([
      "grok:grok-4.7@xhigh",
      "codex:gpt-5.6-sol@high",
      "devin:swe-2@medium",
    ]);
  });

  it("rejects a fourth attempt, duplicates, and same-provider chains", () => {
    const feature = "feature, refactoring: ";
    for (const [name, rhs] of [
      ["four attempts", "grok:grok-4.7@xhigh -> codex:gpt-5.6-sol@high -> devin:swe-2@medium -> cursor:composer-2.5@default"],
      ["duplicate attempt", "grok:grok-4.7@xhigh -> grok:grok-4.7@xhigh"],
      ["same provider", "grok:grok-4.7@xhigh -> grok:grok-4.7@high"],
      ["two parent aliases", "inherit-parent -> auto"],
    ] as const) {
      expect(() => parse(FIRST_RUN.replace(`${feature}grok:grok-4.7@xhigh`, `${feature}${rhs}`)), name)
        .toThrow(ModelPolicyError);
    }
  });

  it("rejects fallback chains on native-only why/reflect roles", () => {
    const text = FIRST_RUN.replace(
      "why investigators, synthesizer: inherit-parent",
      "why investigators, synthesizer: inherit-parent -> grok:grok-4.7@xhigh"
    );
    expect(() => parse(text)).toThrow(/live MCP surface/);
  });

  it("rejects extra seats on single-model roles", () => {
    const text = FIRST_RUN.replace(
      "bug-fix: codex:gpt-5.6-sol@max",
      "bug-fix: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh"
    );
    expect(() => parse(text)).toThrow(/exactly one seat/);
  });

  it("rejects unknown role rows, bad descriptors, and bad efforts", () => {
    for (const line of [
      "typo role: grok:grok-4.7@xhigh",
      "bug-fix: gpt-5.6-sol@max",
      "bug-fix: codex:gpt-5.6-sol@ludicrous",
      "bug-fix: codex:gpt 5.6@max",
      "bug-fix:",
    ]) {
      expect(() => parse(`${line}\n`), line).toThrow(ModelPolicyError);
    }
  });

  it("round-trips a canonical sheet byte-identically and stably", () => {
    const model = parse(FIRST_RUN);
    const rendered = renderSheet(model);
    expect(rendered).toBe(FIRST_RUN);
    expect(renderSheet(parse(rendered))).toBe(rendered);
  });

  it("round-trips chained rows and access metadata", () => {
    const text = FIRST_RUN.replace(
      "# budget: unlimited (max)",
      `# budget: large (xhigh)\n# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user","plan":"ChatGPT Pro","note":"reported by user","observedAt":"2026-09-24"}`
    ).replace(
      "how explorer: grok:grok-4.7@xhigh",
      "how explorer: grok:grok-4.7@xhigh -> codex:gpt-5.6-sol@high"
    );
    const model = parse(text);
    expect(model.access).toHaveLength(1);
    expect(model.access[0]).toMatchObject({
      provider: "codex",
      funding: "included",
      capacity: "high",
      apiSpend: "deny",
      provenance: "user",
      plan: "ChatGPT Pro",
    });
    const rendered = renderSheet(model);
    expect(rendered).toBe(text);
    expect(renderSheet(parse(rendered))).toBe(rendered);
  });

  it("rejects malformed access metadata without blocking unrelated rows", () => {
    for (const access of [
      `# access: not-json`,
      `# access: {"provider":"codex"}`,
      `# access: {"provider":"codex","funding":"free","capacity":"high","apiSpend":"deny","provenance":"user"}`,
      `# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user","extra":1}`,
      `# access: {"provider":"wat","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}`,
    ]) {
      expect(() => parse(FIRST_RUN.replace("# budget: unlimited (max)", `# budget: unlimited (max)\n${access}`)), access)
        .toThrow(ModelPolicyError);
    }
  });

  it("rejects a second access record for one provider", () => {
    const one = `# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}`;
    const two = `# access: {"provider":"codex","funding":"metered","capacity":"unknown","apiSpend":"approved","provenance":"provider"}`;
    expect(() => parse(FIRST_RUN.replace("# budget: unlimited (max)", `# budget: unlimited (max)\n${one}\n${two}`)))
      .toThrow(/more than one access record/);
  });

  it("requires all 15 role rows and the architect minimum before a write", () => {
    const model = parse(FIRST_RUN);
    expect(() => assertCompleteSheet(model)).not.toThrow();
    const missing = FIRST_RUN.split("\n").filter((line) => !line.startsWith("hillclimb:")).join("\n");
    expect(() => assertCompleteSheet(parse(missing))).toThrow(/missing required role row: hillclimb/);
    const thin = FIRST_RUN.replace(
      "architect runners: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max",
      "architect runners: codex:gpt-5.6-sol@max"
    );
    expect(() => assertCompleteSheet(parse(thin))).toThrow(/at least 2 seats/);
  });

  it("resolves a role into lanes with exhaustion groups and routes", () => {
    const text = FIRST_RUN.replace(
      "# budget: unlimited (max)",
      `# budget: unlimited (max)\n# access: {"provider":"grok","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}\n# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}`
    ).replace(
      "how explorer: grok:grok-4.7@xhigh",
      "how explorer: grok:grok-4.7@xhigh -> inherit-parent"
    );
    const model = parse(text);
    const policy = resolveRole(model, "how explorer", "codex");
    expect(policy?.lanes).toHaveLength(1);
    const lane = policy?.lanes[0];
    expect(lane?.id).toBe("how explorer#1");
    expect(lane?.attempts.map((attempt) => [attempt.descriptor, attempt.route, attempt.exhaustionGroup, attempt.authorization.state])).toEqual([
      ["grok:grok-4.7@xhigh", "external", "grok", "allowed"],
      ["inherit-parent", "native", "codex", "allowed"],
    ]);
  });

  it("resolves leaf roles to their shared row", () => {
    const model = parse(FIRST_RUN);
    expect(resolveRole(model, "feature", "claude")?.header).toBe("feature, refactoring");
    expect(resolveRole(model, "refactoring", "claude")?.header).toBe("feature, refactoring");
    expect(resolveRole(model, "how explorer", "claude")?.header).toBe("how explorer");
    expect(resolveRole(model, "nonexistent", "claude")).toBeNull();
  });

  it("rejects a chain whose fallback resolves to the parent's account", () => {
    const text = FIRST_RUN.replace(
      "# budget: unlimited (max)",
      `# budget: unlimited (max)\n# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}\n# access: {"provider":"claude","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}`
    ).replace(
      "how explorer: grok:grok-4.7@xhigh",
      "how explorer: codex:gpt-5.6-sol@max -> inherit-parent"
    );
    const model = parse(text);
    expect(() => resolveRole(model, "how explorer", "codex")).toThrow(/codex account/);
    expect(() => resolveRole(model, "how explorer", "claude")).not.toThrow();
  });

  it("applies access-fact apiSpend to resolved attempts", () => {
    const text = FIRST_RUN.replace(
      "# budget: unlimited (max)",
      `# budget: unlimited (max)\n# access: {"provider":"grok","funding":"included","capacity":"standard","apiSpend":"approved","provenance":"user"}`
    );
    const policy = resolveRole(parse(text), "how explorer", "claude");
    expect(policy?.lanes[0].attempts[0].apiSpend).toBe("approved");
    expect(resolveRole(parse(FIRST_RUN), "how explorer", "claude")?.lanes[0].attempts[0].apiSpend).toBe("unset");
  });
});

describe("model sheet separators", () => {
  it("rejects empty seats instead of silently filtering them", () => {
    for (const row of [
      "swarm workers: inherit-parent,, inherit-parent",
      "swarm workers: inherit-parent,",
      "swarm workers: ,inherit-parent",
      "arena runners: codex:gpt-5.6-sol@max,, grok:grok-4.7@xhigh",
    ]) {
      expect(() => parse(`${row}\n`), row).toThrow(/empty seat/);
    }
  });

  it("parses documented rows with a bare colon or tab separator", () => {
    for (const row of [
      "swarm workers:inherit-parent",
      "swarm workers:\tinherit-parent",
      "swarm workers:  inherit-parent",
    ]) {
      const model = parse(`${row}\n`);
      expect(model.rows, row).toHaveLength(1);
      expect(model.rows[0].seats[0].attempts).toEqual([
        { kind: "alias", alias: "inherit-parent" },
      ]);
    }
  });

  it("still reports colon-separated rows with unknown headers", () => {
    expect(() => parse("typo role: grok:grok-4.7@xhigh\n")).toThrow(
      /unknown role row header/
    );
    expect(() => parse("typo role:\tgrok:grok-4.7@xhigh\n")).toThrow(
      /unknown role row header/
    );
  });
});

describe("chain funding authorization", () => {
  const ACCESS = {
    grokIncluded: '# access: {"provider":"grok","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}',
    grokMeteredDenied: '# access: {"provider":"grok","funding":"metered","capacity":"standard","apiSpend":"deny","provenance":"user"}',
    grokMeteredApproved: '# access: {"provider":"grok","funding":"metered","capacity":"standard","apiSpend":"approved","provenance":"user"}',
    grokUnknown: '# access: {"provider":"grok","funding":"unknown","capacity":"unknown","apiSpend":"deny","provenance":"provider"}',
    codexIncluded: '# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}',
    devinIncluded: '# access: {"provider":"devin","funding":"included","capacity":"standard","apiSpend":"deny","provenance":"user"}',
    devinUnknown: '# access: {"provider":"devin","funding":"unknown","capacity":"unknown","apiSpend":"deny","provenance":"provider"}',
  } as const;

  function sheetWith(row: string, access: readonly string[]): string {
    return FIRST_RUN.replace(
      "# budget: unlimited (max)",
      ["# budget: unlimited (max)", ...access].join("\n")
    ).replace("swarm workers: grok:grok-4.7@xhigh", row);
  }

  it("rejects a multi-attempt chain when any attempt lacks an access fact", () => {
    const model = parse(
      sheetWith("swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high", [
        ACCESS.grokIncluded,
      ])
    );
    expect(() => resolveRole(model, "swarm workers", "codex")).toThrow(
      /no access fact for provider devin|confirmed funding/
    );
    const bare = parse(
      sheetWith("swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high", [])
    );
    expect(() => resolveRole(bare, "swarm workers", "codex")).toThrow(
      /confirmed funding/
    );
  });

  it("authorizes included and metered-approved routes, never unknown funding", () => {
    const authorized = resolveRole(
      parse(
        sheetWith("swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high", [
          ACCESS.grokIncluded,
          ACCESS.devinIncluded,
        ])
      ),
      "swarm workers",
      "codex"
    );
    expect(authorized?.lanes[0].attempts.map((attempt) => attempt.authorization.state)).toEqual([
      "allowed",
      "allowed",
    ]);

    const metered = resolveRole(
      parse(
        sheetWith("swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high", [
          ACCESS.grokMeteredApproved,
          ACCESS.devinIncluded,
        ])
      ),
      "swarm workers",
      "codex"
    );
    expect(metered?.lanes[0].attempts[0]).toMatchObject({
      authorization: { state: "allowed" },
      apiSpend: "approved",
      funding: "metered",
    });

    const unknown = resolveRole(
      parse(
        sheetWith("swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high", [
          ACCESS.grokUnknown,
          ACCESS.devinUnknown,
        ])
      ),
      "swarm workers",
      "codex"
    );
    for (const attempt of unknown?.lanes[0].attempts ?? []) {
      expect(attempt.authorization).toMatchObject({ state: "blocked" });
      if (attempt.authorization.state === "blocked") {
        expect(attempt.authorization.reason).toContain("unknown");
      }
    }

    const denied = resolveRole(
      parse(
        sheetWith("swarm workers: grok:grok-4.7@xhigh -> devin:swe-2@high", [
          ACCESS.grokMeteredDenied,
          ACCESS.devinIncluded,
        ])
      ),
      "swarm workers",
      "codex"
    );
    expect(denied?.lanes[0].attempts[0].authorization.state).toBe("blocked");
    expect(denied?.lanes[0].attempts[1].authorization.state).toBe("allowed");
  });

  it("uses the parent provider's access fact for native aliases", () => {
    const policy = resolveRole(
      parse(
        sheetWith("swarm workers: inherit-parent -> grok:grok-4.7@xhigh", [
          ACCESS.codexIncluded,
          ACCESS.grokMeteredApproved,
        ])
      ),
      "swarm workers",
      "codex"
    );
    const [alias, external] = policy?.lanes[0].attempts ?? [];
    expect(alias).toMatchObject({
      exhaustionGroup: "codex",
      route: "native",
      apiSpend: "deny",
      funding: "included",
      authorization: { state: "allowed" },
    });
    expect(external).toMatchObject({
      exhaustionGroup: "grok",
      apiSpend: "approved",
      authorization: { state: "allowed" },
    });
  });

  it("keeps legacy single-attempt rows authorized without policy, and only legacy", () => {
    const legacy = resolveRole(parse(FIRST_RUN), "how explorer", "claude");
    expect(legacy?.lanes[0].attempts[0]).toMatchObject({
      authorization: { state: "allowed" },
      apiSpend: "unset",
      funding: "unset",
      exhaustionGroup: "grok",
    });
    const unknown = resolveRole(
      parse(
        FIRST_RUN.replace(
          "# budget: unlimited (max)",
          `# budget: unlimited (max)\n${ACCESS.grokUnknown}`
        )
      ),
      "how explorer",
      "claude"
    );
    expect(unknown?.lanes[0].attempts[0].authorization.state).toBe("blocked");
  });

  it("requires an access fact for every configured route once a sheet is policy-enabled", () => {
    const model = parse(
      sheetWith("swarm workers: grok:grok-4.7@xhigh", [ACCESS.codexIncluded])
    );
    expect(() => resolveRole(model, "swarm workers", "codex")).toThrow(
      /no access fact for provider grok/
    );
    const alias = parse(
      sheetWith("swarm workers: inherit-parent", [ACCESS.codexIncluded])
    );
    expect(() => resolveRole(alias, "swarm workers", "claude")).toThrow(
      /no access fact for provider claude/
    );
    expect(
      resolveRole(alias, "swarm workers", "codex")?.lanes[0].attempts[0]
    ).toMatchObject({ authorization: { state: "allowed" }, apiSpend: "deny" });
  });
});

describe("nextAttempt decision", () => {
  const lane: LanePolicy = {
    id: "how explorer#1",
    attempts: [
      { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
      { descriptor: "codex:gpt-5.6-sol@high", attempt: { kind: "descriptor", provider: "codex", model: "gpt-5.6-sol", effort: "high" }, exhaustionGroup: "codex", funding: "included", apiSpend: "deny", route: "external", authorization: { state: "allowed" } },
      { descriptor: "inherit-parent", attempt: { kind: "alias", alias: "inherit-parent" }, exhaustionGroup: "claude", funding: "unset", apiSpend: "unset", route: "native", authorization: { state: "allowed" } },
    ],
  };

  it("launches the primary, stops on success, and advances on exhaustion", () => {
    expect(nextAttempt(lane, [], new Set(), "read-only")).toMatchObject({ kind: "launch", attemptIndex: 0 });
    expect(nextAttempt(lane, [
      { attemptIndex: 0, status: "complete" },
      { attemptIndex: 99, status: "usage-exhausted", processStarted: false },
    ], new Set(["grok"]), "read-only")).toMatchObject({ kind: "stop", reason: "complete" });
    expect(nextAttempt(lane, [{ attemptIndex: 0, status: "complete" }], new Set(), "read-only"))
      .toMatchObject({ kind: "stop", reason: "complete" });
    expect(nextAttempt(lane, [{ attemptIndex: 0, status: "usage-exhausted", processStarted: true }], new Set(["grok"]), "read-only"))
      .toMatchObject({ kind: "launch", attemptIndex: 1 });
  });

  it("skips attempts on accounts exhausted elsewhere in the run", () => {
    const decision = nextAttempt(
      lane,
      [{ attemptIndex: 0, status: "usage-exhausted", processStarted: false }],
      new Set(["grok", "codex"]),
      "read-only"
    );
    expect(decision).toMatchObject({ kind: "launch", attemptIndex: 2 });
  });

  it("stops when the chain is exhausted and never replays an attempt", () => {
    const decision = nextAttempt(
      lane,
      [
        { attemptIndex: 0, status: "usage-exhausted", processStarted: true },
        { attemptIndex: 1, status: "usage-exhausted", processStarted: true },
        { attemptIndex: 2, status: "usage-exhausted", processStarted: true },
      ],
      new Set(["grok", "codex", "claude"]),
      "read-only"
    );
    expect(decision).toMatchObject({ kind: "stop", reason: "chain-exhausted" });
  });

  it("never advances on an ineligible failure", () => {
    for (const status of ["failed"] as const) {
      expect(nextAttempt(lane, [{ attemptIndex: 0, status }], new Set(), "read-only"))
        .toMatchObject({ kind: "stop", reason: "not-eligible" });
    }
  });

  it("stops a started or unknown writer for inspection instead of replaying", () => {
    for (const processStarted of [true, undefined]) {
      const decision = nextAttempt(
        lane,
        [{ attemptIndex: 0, status: "usage-exhausted", processStarted }],
        new Set(["grok"]),
        "isolated-write"
      );
      expect(decision, String(processStarted)).toMatchObject({ kind: "inspect", reason: "started-writer" });
    }
  });

  it("advances a writer only when exhaustion is proved before process start", () => {
    const decision = nextAttempt(
      lane,
      [{ attemptIndex: 0, status: "usage-exhausted", processStarted: false }],
      new Set(["grok"]),
      "isolated-write"
    );
    expect(decision).toMatchObject({ kind: "launch", attemptIndex: 1 });
  });

  it("stops on an unauthorized next candidate instead of skipping to a later model", () => {
    const blockedLane: LanePolicy = {
      id: "swarm workers#1",
      attempts: [
        { descriptor: "grok:grok-4.7@xhigh", attempt: { kind: "descriptor", provider: "grok", model: "grok-4.7", effort: "xhigh" }, exhaustionGroup: "grok", funding: "unknown", apiSpend: "deny", route: "external", authorization: { state: "blocked", reason: "funding unknown" } },
        lane.attempts[1],
      ],
    };
    expect(nextAttempt(blockedLane, [], new Set(), "read-only"))
      .toMatchObject({ kind: "stop", reason: "unauthorized" });
    expect(
      nextAttempt(
        blockedLane,
        [{ attemptIndex: 1, status: "usage-exhausted", processStarted: true }],
        new Set(["codex"]),
        "read-only"
      )
    ).toMatchObject({ kind: "stop", reason: "unauthorized" });
  });

  it("advances only on prior usage-exhaustion, never past missing permission", () => {
    const sheet = `# access: {"provider":"grok","funding":"unknown","capacity":"unknown","apiSpend":"deny","provenance":"provider"}\n# access: {"provider":"codex","funding":"included","capacity":"high","apiSpend":"deny","provenance":"user"}\nswarm workers: grok:grok-4.7@xhigh -> inherit-parent\n`;
    const policy = resolveRole(parseSheet(sheet), "swarm workers", "codex");
    expect(nextAttempt(policy!.lanes[0], [], new Set(), "read-only"))
      .toMatchObject({ kind: "stop", reason: "unauthorized" });
  });
});

describe("validateSheet", () => {
  const FACT = (provider: string, funding: string = "included") =>
    `# access: {"provider":"${provider}","funding":"${funding}","capacity":"high","apiSpend":"deny","provenance":"user"}`;

  const FULL_FACTS = [FACT("grok"), FACT("codex"), FACT("claude")].join("\n");

  function sheetWith(facts: string, replacements: readonly (readonly [string, string])[] = []): string {
    let text = FIRST_RUN.replace(
      "# budget: unlimited (max)",
      ["# budget: unlimited (max)", facts].filter((line) => line.length > 0).join("\n")
    );
    for (const [from, to] of replacements) text = text.replace(from, to);
    return text;
  }

  it("accepts a complete policy sheet with authorized facts for every route", () => {
    const model = parse(sheetWith(FULL_FACTS));
    for (const parent of ["claude", "codex"] as const) {
      expect(() => validateSheet(model, parent), parent).not.toThrow();
    }
  });

  it("requires access facts when validating a newly written sheet", () => {
    const model = parse(FIRST_RUN);
    expect(() => validateSheet(model, "claude")).toThrow(/setup requires access facts/);
  });

  it("rejects a policy-enabled sheet missing a fact for a configured route", () => {
    const model = parse(sheetWith([FACT("codex"), FACT("claude")].join("\n")));
    expect(() => validateSheet(model, "claude")).toThrow(/no access fact for provider grok/);
  });

  it("rejects routes whose facts leave them unauthorized", () => {
    const model = parse(
      sheetWith([FACT("grok", "unknown"), FACT("codex"), FACT("claude")].join("\n"))
    );
    expect(() => validateSheet(model, "claude")).toThrow(/not authorized/);
    expect(() => validateSheet(model, "claude")).toThrow(/funding is unknown/);
  });

  it("rejects a fallback that resolves to the parent's own account", () => {
    const model = parse(
      sheetWith(FULL_FACTS, [
        ["how explorer: grok:grok-4.7@xhigh", "how explorer: codex:gpt-5.6-sol@max -> inherit-parent"],
      ])
    );
    expect(() => validateSheet(model, "codex")).toThrow(/codex account/);
    expect(() => validateSheet(model, "claude")).not.toThrow();
  });

  it("collects completeness and resolution issues together", () => {
    const thin = sheetWith(FULL_FACTS, [
      ["architect runners: codex:gpt-5.6-sol@max, grok:grok-4.7@xhigh, claude:opus@max", "architect runners: codex:gpt-5.6-sol@max"],
    ]);
    const missing = thin.split("\n").filter((line) => !line.startsWith("hillclimb:")).join("\n");
    expect(() => validateSheet(parse(missing), "claude")).toThrow(
      /missing required role row: hillclimb[\s\S]*at least 2 seats|at least 2 seats[\s\S]*missing required role row: hillclimb/
    );
  });
});
