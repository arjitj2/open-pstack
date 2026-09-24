import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLLING_CLAUDE_ALIASES } from "./model-aliases.ts";
import { EFFORTS, type Effort } from "./types.ts";

const PLUGIN_ROOT = join(import.meta.dir, "../../../..");
const DISPATCH_PATH = join(
  PLUGIN_ROOT,
  "skills/poteto-mode/references/provider-dispatch.md"
);
const SETUP_PATH = join(PLUGIN_ROOT, "skills/setup-pstack/SKILL.md");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");

const MATRIX_HEADER = [
  "Family",
  "Upstream pstack choice",
  "Provider",
  "Model",
  "Default effort",
  "Selectable efforts",
  "Claude-native agent stem",
  "First-run active",
] as const;

const FAMILY_ORDER = [
  "fable",
  "sol",
  "grok",
  "opus",
  "sonnet",
  "astra",
  "luna",
  "terra",
] as const;
const PROVIDERS = ["claude", "codex", "grok"] as const;
const DESCRIPTOR_RE =
  /(claude|codex|grok):[a-z0-9.-]+@(low|medium|high|xhigh|max)/g;
const PANEL_ROLES = [
  "arena runners",
  "arena cross-judge pool",
  "architect runners",
  "interrogate reviewers",
] as const;
const SHEET_ROLES = [
  "feature, refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment and prose",
  "hardest tasks",
  "how explorer",
  "how explainer",
  "why investigators, synthesizer",
  "reflect tooling, judgment, divergent, synthesizer",
  "arena runners",
  "arena cross-judge pool",
  "swarm workers",
  "architect runners",
  "interrogate reviewers",
] as const;
const SETUP_SECTION_ORDER = [
  "### 2. Load current state",
  "### 3. Ask the reasoning budget",
  "### 4. Select role assignments",
  "### 5. Validate and choose assigned efforts",
  "### 6. Probe the assigned routes",
  "### 7. Render the selected role map",
  "### 8. Confirm and commit",
] as const;
const BUDGET_LABELS = [
  "unlimited — keep max",
  "large — xhigh reasoning",
  "medium — high reasoning",
  "small — medium reasoning",
] as const;

interface MatrixRow {
  family: string;
  upstreamChoice: string;
  provider: string;
  model: string;
  defaultEffort: Effort;
  selectableEfforts: Effort[];
  claudeNativeAgentStem: string | null;
  firstRunActive: boolean;
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    throw new Error(`matrix row must be a pipe table: ${line}`);
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replaceAll("`", ""));
}

function isSeparator(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function asEffort(value: string): Effort {
  if ((EFFORTS as readonly string[]).includes(value)) {
    return value as Effort;
  }
  throw new Error(`not an effort: ${value}`);
}

function parseModelMatrix(markdown: string): MatrixRow[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "## Model matrix");
  if (start < 0) {
    throw new Error("missing ## Model matrix");
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      end = i;
      break;
    }
  }
  const table = lines
    .slice(start + 1, end)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  if (table.length !== 10) {
    throw new Error(
      `model matrix must be header, separator, and 8 data rows, got ${table.length}`
    );
  }
  const header = splitRow(table[0]);
  if (header.join("|") !== MATRIX_HEADER.join("|")) {
    throw new Error(`unexpected matrix header: ${header.join(" | ")}`);
  }
  if (!isSeparator(splitRow(table[1]))) {
    throw new Error("matrix header separator missing");
  }
  return table.slice(2).map((line) => {
    const cells = splitRow(line);
    if (cells.length !== MATRIX_HEADER.length) {
      throw new Error(`matrix row has ${cells.length} cells: ${line}`);
    }
    const [
      family,
      upstreamChoice,
      provider,
      model,
      defaultEffortRaw,
      selectableRaw,
      stemRaw,
      firstRunActiveRaw,
    ] = cells;
    if (!(PROVIDERS as readonly string[]).includes(provider)) {
      throw new Error(`invalid provider: ${provider}`);
    }
    const selectableEfforts = selectableRaw.split(/\s+/).map(asEffort);
    const claudeNativeAgentStem = stemRaw === "-" ? null : stemRaw;
    if (claudeNativeAgentStem !== null && !/^[a-z0-9-]+$/.test(claudeNativeAgentStem)) {
      throw new Error(`invalid Claude-native agent stem: ${stemRaw}`);
    }
    if ((provider === "claude") !== (claudeNativeAgentStem !== null)) {
      throw new Error(`${family} stem must be present iff provider is claude`);
    }
    const defaultEffort = asEffort(defaultEffortRaw);
    if (!selectableEfforts.includes(defaultEffort)) {
      throw new Error(`${family} default effort is not selectable`);
    }
    if (firstRunActiveRaw !== "yes" && firstRunActiveRaw !== "no") {
      throw new Error(`${family} First-run active must be yes or no`);
    }
    return {
      family,
      upstreamChoice,
      provider,
      model,
      defaultEffort,
      selectableEfforts,
      claudeNativeAgentStem,
      firstRunActive: firstRunActiveRaw === "yes",
    };
  });
}

function defaultDescriptors(rows: MatrixRow[]): string[] {
  return rows.filter((row) => row.firstRunActive).map(
    (row) => `${row.provider}:${row.model}@${row.defaultEffort}`
  );
}

function parseFrontmatter(text: string): {
  fields: Record<string, string>;
  body: string;
} {
  if (!text.startsWith("---\n")) {
    throw new Error("missing frontmatter");
  }
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new Error("unterminated frontmatter");
  }
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const idx = line.indexOf(": ");
    if (idx < 0) {
      throw new Error(`bad frontmatter line: ${line}`);
    }
    fields[line.slice(0, idx)] = line.slice(idx + 2);
  }
  return { fields, body: text.slice(end + 5) };
}

function firstRunSheet(setup: string): string {
  const match = setup.match(
    /```markdown\n(# pstack model configuration\n[\s\S]*?)```/
  );
  if (!match) {
    throw new Error("setup-pstack is missing the first-run sheet fence");
  }
  return match[1];
}

describe("model matrix", () => {
  const rows = parseModelMatrix(readFileSync(DISPATCH_PATH, "utf8"));
  const setup = readFileSync(SETUP_PATH, "utf8");
  const defaultPanel = defaultDescriptors(rows);

  it("owns the effort universe and first-run defaults", () => {
    expect([...EFFORTS]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(rows.map((row) => row.family)).toEqual([...FAMILY_ORDER]);
    for (const row of rows) {
      expect(row.upstreamChoice.length).toBeGreaterThan(0);
      expect(row.model.length).toBeGreaterThan(0);
      expect(row.selectableEfforts.length).toBeGreaterThan(0);
      expect(row.selectableEfforts).toEqual(
        EFFORTS.filter((effort) => row.selectableEfforts.includes(effort))
      );
    }
    expect(
      rows.map((row) => [
        row.family,
        row.provider,
        row.model,
        row.defaultEffort,
        row.claudeNativeAgentStem,
        row.firstRunActive,
      ])
    ).toEqual([
      ["fable", "claude", "fable", "max", "fable", false],
      ["sol", "codex", "gpt-5.6-sol", "max", null, true],
      ["grok", "grok", "grok-4.7", "xhigh", null, true],
      ["opus", "claude", "opus", "max", "opus", true],
      ["sonnet", "claude", "sonnet", "high", "sonnet", false],
      ["astra", "codex", "gpt-6-astra", "high", null, false],
      ["luna", "codex", "gpt-5.6-luna", "high", null, false],
      ["terra", "codex", "gpt-5.6-terra", "high", null, false],
    ]);
    expect(
      rows.filter((row) => row.firstRunActive).map((row) => row.family)
    ).toEqual(["sol", "grok", "opus"]);
    expect(
      rows.filter((row) => row.provider === "claude").map((row) => row.model)
    ).toEqual([...ROLLING_CLAUDE_ALIASES]);
  });

  it("ships exactly the declared Claude-native frontier agents", () => {
    const expected = new Set<string>();
    const familyBodies = new Map<string, string>();
    for (const row of rows) {
      const stem = row.claudeNativeAgentStem;
      if (stem === null) {
        continue;
      }
      for (const effort of row.selectableEfforts) {
        const name = `pstack-${stem}-${effort}`;
        expected.add(`${name}.md`);
        const text = readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8");
        const { fields, body } = parseFrontmatter(text);
        expect(fields).toEqual({
          name,
          description: `Native Claude lane for pstack roles configured as ${row.provider}:${row.model}@${effort}.`,
          model: row.model,
          effort,
          background: "true",
          disallowedTools: "Agent, Task",
        });
        const prior = familyBodies.get(stem);
        if (prior === undefined) {
          familyBodies.set(stem, body);
        } else {
          expect(body).toBe(prior);
        }
      }
    }
    const declaredCount = rows.reduce(
      (count, row) =>
        count +
        (row.claudeNativeAgentStem === null
          ? 0
          : row.selectableEfforts.length),
      0
    );
    expect(expected.size).toBe(declaredCount);
    const shipped = readdirSync(AGENTS_DIR)
      .filter((name) => name.startsWith("pstack-") && name.endsWith(".md"))
      .sort();
    expect(shipped).toEqual([...expected].sort());
  });

  it("keeps setup's first-run default panel copy aligned with the matrix", () => {
    const sheet = firstRunSheet(setup);
    const roles = sheet
      .split("\n")
      .filter((line) => line.includes(": ") && !line.startsWith("#"))
      .map((line) => line.slice(0, line.indexOf(": ")));
    expect(roles).toEqual([...SHEET_ROLES]);
    const byFamily = new Map<string, MatrixRow>(
      rows.map((row) => [`${row.provider}:${row.model}`, row])
    );
    for (const descriptor of sheet.match(DESCRIPTOR_RE) ?? []) {
      const at = descriptor.lastIndexOf("@");
      const key = descriptor.slice(0, at);
      const effort = descriptor.slice(at + 1);
      const row = byFamily.get(key);
      if (row === undefined) {
        throw new Error(`unknown first-run descriptor: ${descriptor}`);
      }
      expect(row.firstRunActive).toBe(true);
      expect(effort).toBe(row.defaultEffort);
    }
    const expectedPanel = defaultPanel.join(", ");
    for (const role of PANEL_ROLES) {
      const line = sheet
        .split("\n")
        .find((entry) => entry.startsWith(`${role}:`));
      if (line === undefined) {
        throw new Error(`missing first-run panel row: ${role}`);
      }
      expect(line).toBe(`${role}: ${expectedPanel}`);
    }
  });

  it("keeps setup's fail-closed reconfiguration order", () => {
    let previous = -1;
    for (const heading of SETUP_SECTION_ORDER) {
      const current = setup.indexOf(heading);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
    expect(setup).toContain("Do not invent precedence.");
    expect(setup).toContain("resolve them through an explicit matrix family or alias replacement before probing or writing.");
    expect(setup).toContain("A failed probe writes nothing.");
    expect(setup).toContain("Probe each distinct assigned `provider:model@effort` pair once");
    expect(setup).toContain("There is no requirement to assign every matrix family.");
    expect(setup).toContain("all required assigned-pair and inherited native-route probes pass");
    expect(setup).toContain("starts with `claude-fable-`, `claude-opus-`, or `claude-sonnet-`");
    expect(setup).toContain("preserving the provider, effort, role, and lane order");
    expect(setup).toContain("Show any rolling-alias migrations");
    expect(setup).toContain("Every documented role remains present.");
    expect(setup).toContain("An effort-only rerun preserves each role's family and lane order.");
    expect(setup).toContain("<!-- pstack:models:begin -->");
    expect(setup).toContain("<!-- pstack:models:end -->");
  });

  it("preserves Architect's candidate minimum without requiring provider diversity", () => {
    expect(setup).toContain("Keep at least two entries in `architect runners`, at least one entry in every other panel");
    expect(setup).toContain("`architect runners: inherit-parent, inherit-parent` launches two independent candidates");
    expect(setup).toContain("ask for an explicit replacement or another entry before probing or writing");
    expect(setup).toContain("do not deduplicate repeated entries");
    expect(setup).toContain("at least two structurally distinct design candidates before synthesis");
  });

  it("preserves selected-provider and inherited-route setup guards", () => {
    expect(setup).toContain("Materialize any missing documented role row");
    expect(setup).toContain("An unassigned family is optional");
    expect(setup).toContain("even when there are no explicit model pairs");
    expect(setup).toContain("the parent answering the marker itself does not count");
    expect(setup).toContain("restore every snapshot");
    expect(setup).toContain("byte-identical sheet and integration content");
  });

  it("bounds native probes and smoke while retaining external concurrency", () => {
    const probes = setup.slice(setup.indexOf("### 6."), setup.indexOf("### 7."));
    const smoke = setup.slice(setup.indexOf("### 10."));
    expect(probes).toContain("observe the available native agent slots");
    expect(probes).toContain("Drain each completed handle and release its slot");
    expect(probes).toContain("run native probes conservatively one at a time");
    expect(probes).toContain("Launch external probes in the background concurrently");
    expect(probes).toContain("Never use a timeout or fallback to clear a slot");
    expect(smoke).toContain("Observe available native slots again");
    expect(smoke).toContain("release their slots before subsequent waves");
    expect(smoke).toContain("Launch every external process in the background concurrently");
    expect(smoke).toContain("Wait for all candidates to finish and verify their results before launching the independent judge");
  });

  it("binds Claude-native dispatch to the matrix mapping", () => {
    const dispatch = readFileSync(DISPATCH_PATH, "utf8");
    const nativeStart = dispatch.indexOf("## Native lanes");
    const externalStart = dispatch.indexOf("## External lanes");
    expect(nativeStart).toBeGreaterThan(-1);
    expect(externalStart).toBeGreaterThan(nativeStart);
    const nativeLanes = dispatch.slice(nativeStart, externalStart);
    expect(nativeLanes).toContain(
      "match the descriptor's `(provider, model)` to one model-matrix row"
    );
    expect(nativeLanes).toContain("`pstack-<stem>-<effort>`");
  });

  it("normalizes old rolling-family pins before any runtime route", () => {
    const dispatch = readFileSync(DISPATCH_PATH, "utf8");
    const normalizationStart = dispatch.indexOf("## Read-time normalization");
    const parentStart = dispatch.indexOf("## The parent owns the route");
    expect(normalizationStart).toBeGreaterThan(-1);
    expect(parentStart).toBeGreaterThan(normalizationStart);
    const normalization = dispatch.slice(normalizationStart, parentStart);
    expect(normalization).toContain("replace that model component in memory");
    expect(normalization).toContain("Never pass the versioned predecessor to Claude.");
    expect(normalization).toContain("without writing user files");
    expect(normalization).toContain("`/setup-pstack` will rewrite it");
    expect(normalization).toContain(
      "runner rejects a missed Fable, Opus, or Sonnet version pin"
    );
  });

  it("keeps the reasoning budget contract aligned with the matrix", () => {
    const budget = setup.slice(
      setup.indexOf("### 3."),
      setup.indexOf("### 4.")
    );
    for (const label of BUDGET_LABELS) {
      expect(budget).toContain(`\`${label}\``);
    }
    expect(budget).toContain("the ladder `max` > `xhigh` > `high` > `medium` > `low`");
    expect([...EFFORTS].reverse().join("` > `")).toBe(
      "max` > `xhigh` > `high` > `medium` > `low"
    );
    for (const [label, target] of [
      ["unlimited — keep max", "max"],
      ["large — xhigh reasoning", "xhigh"],
      ["medium — high reasoning", "high"],
      ["small — medium reasoning", "medium"],
    ] as const) {
      expect(budget).toContain(`\`${label}\``);
      expect(EFFORTS).toContain(target);
    }
    expect(budget).toContain("highest selectable effort at or below the target");
    expect(budget).toContain("Aliases and fixed-`default` families");
    for (const alias of ["inherit-parent", "auto"]) {
      expect(budget).toContain(`\`${alias}\``);
    }
    expect(setup).toContain("the sheet's `# budget` line as the recorded budget choice");
    expect(setup).toContain("`# budget: <label> (<target effort>)`");
    const sheet = firstRunSheet(setup);
    expect(sheet).toContain("# budget: unlimited (max)");
  });
});
