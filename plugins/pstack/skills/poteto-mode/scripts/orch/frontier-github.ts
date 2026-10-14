import { execFileSync } from "node:child_process";
import {
  UserError,
  isRecord,
  isUnknownArray,
} from "./boundary.ts";
import type {
  FrontierPr,
  FrontierPrState,
  GitHubResolution,
} from "./store.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function frontierPrStateOrNull(
  value: unknown
): FrontierPrState | null {
  switch (value) {
    case "OPEN":
    case "MERGED":
    case "CLOSED":
      return value;
    default:
      return null;
  }
}

const GITHUB_PULL_REQUEST_LIMIT = 1000;
const GITHUB_PULL_REQUEST_FIELDS = [
  "number",
  "state",
  "headRefName",
  "baseRefName",
  "headRefOid",
  "headRepositoryOwner",
  "headRepository",
  "isCrossRepository",
].join(",");

interface GitHubContext {
  readonly checkout: string;
  readonly baseRepo: string;
  readonly trunk: string;
  readonly trunkSource: "explicit" | "repository-default";
  readonly headOwner?: string;
}

interface PullRequestFields {
  readonly pr: number;
  readonly state: FrontierPrState;
  readonly branch: string;
  readonly base: string;
  readonly owner: string;
  readonly headSha: string;
}

type GitHubPullRequest = PullRequestFields &
  (
    | { readonly kind: "same-repository" }
    | { readonly kind: "cross-repository"; readonly headRepo: string }
  );

type SameRepositoryPullRequest = Extract<
  GitHubPullRequest,
  { kind: "same-repository" }
>;
type CrossRepositoryPullRequest = Extract<
  GitHubPullRequest,
  { kind: "cross-repository" }
>;

type PullRequestQuery =
  | { readonly kind: "head"; readonly branch: string }
  | { readonly kind: "base"; readonly branch: string };

function runTool({
  command,
  args,
  repo,
}: {
  command: string;
  args: readonly string[];
  repo: string;
}): string {
  try {
    return execFileSync(command, args, {
      cwd: repo,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    throw new UserError(
      `${command} ${args.join(" ")} failed: ${errorMessage(error)}`
    );
  }
}

function runGit({
  args,
  repo,
}: {
  args: readonly string[];
  repo: string;
}): string {
  return runTool({ command: "git", args, repo }).trim();
}

function gitHubRepository({
  checkout,
  baseRepo,
}: {
  checkout: string;
  baseRepo?: string;
}): {
  readonly baseRepo: string;
  readonly defaultBranch: string | null;
} {
  const command = `gh repo view ${baseRepo ?? "(checkout context)"}`;
  const raw = runTool({
    command: "gh",
    args: [
      "repo",
      "view",
      ...(baseRepo === undefined ? [] : [baseRepo]),
      "--json",
      "nameWithOwner,defaultBranchRef",
    ],
    repo: checkout,
  });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UserError(`${command} output is not valid JSON`);
  }
  const ref = isRecord(value) ? value.defaultBranchRef : undefined;
  if (
    !isRecord(value) ||
    typeof value.nameWithOwner !== "string" ||
    ! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.nameWithOwner) ||
    (ref !== null &&
      (!isRecord(ref) ||
        typeof ref.name !== "string" ||
        ref.name.length === 0))
  ) {
    throw new UserError(`${command} output has invalid repository metadata`);
  }
  if (baseRepo !== undefined && value.nameWithOwner.toLowerCase() !== baseRepo.toLowerCase()) {
    throw new UserError(
      `gh repo view resolved ${baseRepo} to a different repository ${value.nameWithOwner}; pass that repository explicitly if it is intended`
    );
  }
  return {
    baseRepo: value.nameWithOwner,
    defaultBranch:
      isRecord(ref) && typeof ref.name === "string" ? ref.name : null,
  };
}

function resolveGitHubContext({
  checkout,
  baseRepo,
  trunk,
  headOwner,
}: {
  checkout: string;
  baseRepo?: string;
  trunk?: string;
  headOwner?: string;
}): GitHubContext {
  if (baseRepo !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(baseRepo)) {
    throw new UserError(
      "--base-repo must name a GitHub repository as owner/name"
    );
  }
  const repository = gitHubRepository({ checkout, baseRepo });
  if (trunk !== undefined) {
    return {
      checkout,
      baseRepo: repository.baseRepo,
      trunk,
      trunkSource: "explicit",
      ...(headOwner === undefined ? {} : { headOwner }),
    };
  }
  if (repository.defaultBranch === null) {
    throw new UserError(
      `repository ${repository.baseRepo} has no default branch; pass --trunk`
    );
  }
  return {
    checkout,
    baseRepo: repository.baseRepo,
    trunk: repository.defaultBranch,
    trunkSource: "repository-default",
    ...(headOwner === undefined ? {} : { headOwner }),
  };
}

function parseGitHubPullRequest(
  row: unknown,
  command: string
): GitHubPullRequest {
  const owner =
    isRecord(row) && isRecord(row.headRepositoryOwner)
      ? row.headRepositoryOwner.login
      : undefined;
  const state = isRecord(row) ? frontierPrStateOrNull(row.state) : null;
  if (
    !isRecord(row) ||
    typeof row.number !== "number" ||
    !Number.isSafeInteger(row.number) ||
    row.number < 1 ||
    state === null ||
    typeof row.headRefName !== "string" ||
    row.headRefName.length === 0 ||
    typeof row.baseRefName !== "string" ||
    row.baseRefName.length === 0 ||
    typeof row.headRefOid !== "string" ||
    !/^[0-9a-f]{40,64}$/i.test(row.headRefOid) ||
    typeof owner !== "string" ||
    owner.length === 0 ||
    typeof row.isCrossRepository !== "boolean"
  ) {
    throw new UserError(`${command} output has an invalid PR row`);
  }
  const fields: PullRequestFields = {
    pr: row.number,
    state,
    branch: row.headRefName,
    base: row.baseRefName,
    owner,
    headSha: row.headRefOid,
  };
  if (!row.isCrossRepository) {
    return { ...fields, kind: "same-repository" };
  }
  // gh leaves headRepository.nameWithOwner empty on pr rows; the fork
  // identity is headRepositoryOwner.login plus headRepository.name.
  const headRepoName = isRecord(row.headRepository)
    ? row.headRepository.name
    : undefined;
  if (typeof headRepoName !== "string" || headRepoName.length === 0) {
    throw new UserError(
      `${command} output has a pull request with missing head repository metadata`
    );
  }
  return {
    ...fields,
    kind: "cross-repository",
    headRepo: `${owner}/${headRepoName}`,
  };
}

function listPullRequests({
  context,
  query,
}: {
  context: GitHubContext;
  query: PullRequestQuery;
}): readonly GitHubPullRequest[] {
  const flag = query.kind === "head" ? "--head" : "--base";
  const command = `gh pr list ${flag} ${query.branch}`;
  const raw = runTool({
    command: "gh",
    args: [
      "pr",
      "list",
      "--repo",
      context.baseRepo,
      flag,
      query.branch,
      "--state",
      "all",
      "--limit",
      String(GITHUB_PULL_REQUEST_LIMIT),
      "--json",
      GITHUB_PULL_REQUEST_FIELDS,
    ],
    repo: context.checkout,
  });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new UserError(`${command} output is not valid JSON`);
  }
  if (!isUnknownArray(value)) {
    throw new UserError(`${command} output is not a JSON array`);
  }
  if (value.length >= GITHUB_PULL_REQUEST_LIMIT) {
    throw new UserError(
      `${command} returned ${value.length} pull requests at the --limit ${GITHUB_PULL_REQUEST_LIMIT} cap; the result may be truncated, so no frontier was written`
    );
  }
  return value.map((row) => {
    const pr = parseGitHubPullRequest(row, command);
    const field = query.kind === "head" ? pr.branch : pr.base;
    if (field !== query.branch) {
      throw new UserError(
        `${command} output returned a pull request whose ${query.kind} is ${field}`
      );
    }
    return pr;
  });
}

function ownerMatches(
  context: GitHubContext,
  row: GitHubPullRequest
): boolean {
  return context.headOwner === undefined ||
    row.owner.toLowerCase() === context.headOwner.toLowerCase();
}

function forkPullRequestError(
  row: CrossRepositoryPullRequest
): UserError {
  return new UserError(
    `PR #${row.pr} has head ${row.headRepo}:${row.branch} in a fork; GitHub base refs do not identify fork-local stack parents, so fork stacks need an explicit ordered ancestry contract this command does not support yet. No frontier was written; resolve from a same-repository submitted base chain. --prs only checks discovery and cannot supply that ancestry.`
  );
}

function requireSinglePullRequest<T extends GitHubPullRequest>({
  rows,
  context,
  branch,
  hint,
}: {
  rows: readonly T[];
  context: GitHubContext;
  branch: string;
  hint: string;
}): T {
  const opens = rows.filter((row) => row.state === "OPEN");
  const row =
    opens.length === 1
      ? opens[0]
      : rows.length === 1
        ? rows[0]
        : undefined;
  if (row !== undefined) {
    return row;
  }
  if (rows.length === 0) {
    throw new UserError(
      `branch ${branch} has no pull request in ${context.baseRepo}; if this is the stack root, pass --trunk; otherwise submit it with gh pr create or resolve from a fully submitted chain`
    );
  }
  throw new UserError(
    `branch ${branch} matches multiple pull requests in ${context.baseRepo} (${rows
      .map((item) => `#${item.pr}`)
      .join(", ")}); the chain walk needs exactly one, so ${hint}`
  );
}

interface GitHubGraph {
  readonly heads: ReadonlyMap<string, readonly GitHubPullRequest[]>;
  readonly children: ReadonlyMap<string, readonly GitHubPullRequest[]>;
}

function discoverGraph(context: GitHubContext, current: string): GitHubGraph {
  const heads = new Map<string, readonly GitHubPullRequest[]>();
  const children = new Map<string, readonly GitHubPullRequest[]>();
  const observed = new Map<number, GitHubPullRequest>();
  const pending = [current];
  const remember = (rows: readonly GitHubPullRequest[]): void => {
    for (const row of rows) {
      const prior = observed.get(row.pr);
      if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(row)) {
        throw new UserError(`PR #${row.pr} changed during discovery; retry before writing the frontier`);
      }
      observed.set(row.pr, row);
    }
  };
  while (pending.length > 0) {
    const branch = pending.pop();
    if (branch === undefined || branch === context.trunk || heads.has(branch)) {
      continue;
    }
    const headRows = listPullRequests({ context, query: { kind: "head", branch } });
    const baseRows = listPullRequests({ context, query: { kind: "base", branch } });
    remember(headRows);
    remember(baseRows);
    heads.set(branch, headRows);
    children.set(branch, baseRows);
    for (const row of headRows) {
      if (row.kind === "same-repository") pending.push(row.base);
    }
    for (const row of baseRows) {
      if (row.kind === "same-repository") pending.push(row.branch);
    }
  }
  return { heads, children };
}

function planFrontier({
  context, current, graph,
}: {
  context: GitHubContext;
  current: string;
  graph: GitHubGraph;
}): readonly SameRepositoryPullRequest[] {
  const candidates = new Map<string, readonly SameRepositoryPullRequest[]>();
  const selected = new Map<string, SameRepositoryPullRequest>();
  for (const [branch, rows] of graph.heads) {
    const sameRepositoryRows = rows.filter(
      (row): row is SameRepositoryPullRequest => row.kind === "same-repository"
    );
    candidates.set(branch, sameRepositoryRows);
    const opens = sameRepositoryRows.filter(row => row.state === "OPEN");
    const row = opens.length === 1 ? opens[0] : sameRepositoryRows.length === 1 ? sameRepositoryRows[0] : undefined;
    if (row !== undefined) selected.set(branch, row);
  }
  const required = (branch: string, first = false): SameRepositoryPullRequest => {
    const rows = first
      ? (graph.heads.get(branch) ?? []).filter(row => ownerMatches(context, row))
      : candidates.get(branch) ?? [];
    if (rows.length === 0) {
      const fork = (graph.heads.get(branch) ?? []).find(
        (row): row is CrossRepositoryPullRequest => row.kind === "cross-repository"
      );
      if (fork !== undefined) throw forkPullRequestError(fork);
    }
    const row = requireSinglePullRequest({
      rows, context, branch,
      hint: first ? "clarify the branch's PR history or pass --head-owner" : "clarify the branch's PR history",
    });
    if (row.kind === "cross-repository") throw forkPullRequestError(row);
    return row;
  };
  const active = new Set<string>();
  for (const [branch, rows] of candidates) {
    if (rows.some(row => row.state === "OPEN")) active.add(branch);
  }
  for (;;) {
    const before = active.size;
    for (const branch of active) {
      const row = selected.get(branch);
      const bases = row === undefined ? candidates.get(branch) ?? [] : [row];
      for (const candidate of bases) {
        if (candidate.base !== context.trunk) active.add(candidate.base);
      }
    }
    if (active.size === before) break;
  }
  const canonicalChildren = (branch: string): readonly SameRepositoryPullRequest[] => {
    const branches = new Set<string>();
    for (const [head, rows] of candidates) {
      if (!active.has(head)) continue;
      const row = selected.get(head);
      const possible = row === undefined ? rows : [row];
      if (possible.some(candidate => candidate.base === branch)) branches.add(head);
    }
    return [...branches].sort().map(head => required(head));
  };
  const first = required(current, true);
  const chain: SameRepositoryPullRequest[] = [first];
  const seenBranches = new Set<string>([current]);
  const seenPrs = new Set<number>([first.pr]);
  const add = (row: SameRepositoryPullRequest, prepend: boolean): void => {
    if (seenBranches.has(row.branch)) {
      throw new UserError(`pull request base chain loops at branch ${row.branch}`);
    }
    if (seenPrs.has(row.pr)) {
      throw new UserError(`pull request base chain repeats PR #${row.pr}`);
    }
    seenBranches.add(row.branch);
    seenPrs.add(row.pr);
    if (prepend) chain.unshift(row); else chain.push(row);
  };
  let bottom = first;
  while (bottom.base !== context.trunk) {
    const parent = required(bottom.base);
    add(parent, true);
    bottom = parent;
  }
  let tip = first;
  for (;;) {
    const children = canonicalChildren(tip.branch);
    if (children.length > 1) {
      throw new UserError(`stack is not linear: branches ${children.map(row => row.branch).join(", ")} all target ${tip.branch}`);
    }
    const child = children[0];
    if (child === undefined) break;
    add(child, false);
    tip = child;
  }
  for (const [index, parent] of chain.entries()) {
    const rows = graph.children.get(parent.branch) ?? [];
    const fork = rows.find((row): row is CrossRepositoryPullRequest => row.kind === "cross-repository" && row.state === "OPEN" && ownerMatches(context, row));
    if (fork !== undefined) throw forkPullRequestError(fork);
    const expected = chain[index + 1];
    const children = canonicalChildren(parent.branch);
    const competing = children.find(row => row.pr !== expected?.pr);
    if (competing !== undefined) {
      throw new UserError(`stack is not linear: branches ${[expected?.branch ?? parent.branch, competing.branch].sort().join(", ")} all target ${parent.branch}`);
    }
    if (expected !== undefined && !rows.some(row => row.pr === expected.pr)) {
      throw new UserError(`PR #${expected.pr} changed during discovery; retry before writing the frontier`);
    }
  }
  return chain;
}

function currentBranch(repo: string): string {
  const branch = runGit({ args: ["branch", "--show-current"], repo });
  if (branch.length === 0) {
    throw new UserError(
      `${repo} has a detached HEAD; check out the stack's current branch`
    );
  }
  return branch;
}

function branchSha({
  branch,
  repo,
}: {
  branch: string;
  repo: string;
}): string {
  const ref = `refs/heads/${branch}^{commit}`;
  let sha: string;
  try {
    sha = runGit({ args: ["rev-parse", "--verify", ref], repo });
  } catch {
    throw new UserError(
      `local branch ${branch} is missing; resolve the frontier from the stacker's checkout that carries every chain branch`
    );
  }
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    throw new UserError(`git rev-parse ${ref} returned an invalid SHA`);
  }
  return sha;
}

export function resolveFrontier({
  checkout,
  baseRepo,
  trunk,
  headOwner,
}: {
  checkout: string;
  baseRepo?: string;
  trunk?: string;
  headOwner?: string;
}): {
  readonly prs: readonly FrontierPr[];
  readonly resolution: GitHubResolution;
} {
  const context = resolveGitHubContext({
    checkout,
    baseRepo,
    trunk,
    headOwner,
  });
  const resolution: GitHubResolution = {
    kind: "github-base-chain",
    baseRepo: context.baseRepo,
    trunk: context.trunk,
    trunkSource: context.trunkSource,
    ...(context.headOwner === undefined
      ? {}
      : { headOwner: context.headOwner }),
  };
  const current = currentBranch(context.checkout);
  if (current === context.trunk) {
    return { prs: [], resolution };
  }
  const graph = discoverGraph(context, current);
  const chain = planFrontier({ context, current, graph });
  const prs = chain.map((row) => {
    const sha = row.state === "OPEN"
      ? branchSha({ branch: row.branch, repo: context.checkout })
      : row.headSha;
    if (
      row.state === "OPEN" &&
      sha.toLowerCase() !== row.headSha.toLowerCase()
    ) {
      throw new UserError(
        `local branch ${row.branch} head ${sha} differs from PR #${row.pr} published head ${row.headSha}; push the local commits or resolve from the stacker's checkout`
      );
    }
    return { pr: row.pr, branches: row.branch, sha, state: row.state };
  });
  return { prs, resolution };
}
