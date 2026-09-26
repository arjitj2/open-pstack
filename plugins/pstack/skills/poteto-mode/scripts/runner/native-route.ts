import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { versionedClaudeAlias } from "./model-aliases.ts";
import { EFFORTS, type Effort, type Parent, type Provider } from "./types.ts";

const PLUGIN_AGENTS_DIR = join(import.meta.dir, "..", "..", "..", "..", "agents");
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;

function nativeAgentSelection(path: string): { name: string; model: string; effort: string } {
  const stem = basename(path, ".md");
  const fail = (detail: string): never => {
    throw new Error(`shipped native agent ${path} is malformed: ${detail}`);
  };
  const match = FRONTMATTER_RE.exec(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
  const body =
    match === null
      ? fail("missing or unterminated frontmatter block")
      : match[1];
  const fields = new Map<string, string>();
  for (const line of body.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) fail(`line ${JSON.stringify(line)} is not a key: value pair`);
    fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  const name = fields.get("name") ?? fail("frontmatter requires name");
  const model = fields.get("model") || fail("frontmatter requires model");
  const effort = fields.get("effort") || fail("frontmatter requires effort");
  if (name !== stem) fail(`frontmatter name ${name} does not match the file name ${stem}`);
  if (!(EFFORTS as readonly string[]).includes(effort)) fail(`unknown effort ${effort}`);
  if (fields.get("background") !== "true") fail("native lanes keep background: true");
  return { name, model, effort };
}

function nativeClaudeLanes(agentsDir: string): Map<string, string> {
  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    throw new Error(`cannot inspect shipped native agents at ${agentsDir}`);
  }
  const lanes = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.startsWith("pstack-") || !entry.endsWith(".md")) continue;
    const selection = nativeAgentSelection(join(agentsDir, entry));
    const key = `${selection.model}\0${selection.effort}`;
    const existing = lanes.get(key);
    if (existing !== undefined) {
      throw new Error(
        `shipped native agents ${existing} and ${selection.name} both select ${selection.model}@${selection.effort}`
      );
    }
    lanes.set(key, selection.name);
  }
  return lanes;
}

export function nativeClaudeAgent(
  model: string,
  effort: Effort,
  agentsDir: string = PLUGIN_AGENTS_DIR
): string | null {
  return nativeClaudeLanes(agentsDir).get(`${model}\0${effort}`) ?? null;
}

export function nativeLane(
  parent: Parent,
  descriptor: { provider: Provider; model: string; effort: Effort },
  agentsDir: string = PLUGIN_AGENTS_DIR
): string | null {
  if (descriptor.provider !== parent) return null;
  if (parent === "codex") return "spawn_agent";
  return nativeClaudeAgent(versionedClaudeAlias(descriptor.model) ?? descriptor.model, descriptor.effort, agentsDir);
}
