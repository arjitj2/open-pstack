export const ROLLING_CLAUDE_ALIASES = ["fable", "opus", "sonnet"] as const;
export type RollingClaudeAlias = (typeof ROLLING_CLAUDE_ALIASES)[number];

const CLAUDE_REVISION_RE = /^claude-([a-z]+)-[0-9]+(?:-[0-9]+)*$/;

export function isRollingClaudeAlias(model: string): model is RollingClaudeAlias {
  return (ROLLING_CLAUDE_ALIASES as readonly string[]).includes(model);
}

export function claudeRevisionFamily(model: string): string | null {
  return CLAUDE_REVISION_RE.exec(model)?.[1] ?? null;
}

export function versionedClaudeAlias(model: string): RollingClaudeAlias | null {
  const family = claudeRevisionFamily(model);
  return family !== null && isRollingClaudeAlias(family) ? family : null;
}

export function concreteModelMatchesRollingAlias(
  requested: string,
  reported: string
): boolean {
  const prefix = `claude-${requested}-`;
  return reported.startsWith(prefix) && /^[0-9]+(?:-[0-9]+)*$/.test(reported.slice(prefix.length));
}
