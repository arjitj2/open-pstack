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
  baseRepo: string;
}): {
  readonly baseRepo: string;
  readonly defaultBranch: string | null;
} {
  const command = `gh repo view ${baseRepo}`;
  const raw = runTool({
    command: "gh",
    args: [
      "repo",
      "view",
      baseRepo,
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
    value.nameWithOwner.length === 0 ||
    (ref !== null &&
      (!isRecord(ref) ||
        typeof ref.name !== "string" ||
        ref.name.length === 0))
  ) {
    throw new UserError(`${command} output has invalid repository metadata`);
  }
  if (value.nameWithOwner.toLowerCase() !== baseRepo.toLowerCase()) {
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
  baseRepo: string;
  trunk?: string;
  headOwner?: string;
}): GitHubContext {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(baseRepo)) {
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
      `branch ${branch} has no pull request in ${context.baseRepo}; open one with gh pr create, or resolve the frontier from a branch whose chain is fully submitted`
    );
  }
  throw new UserError(
    `branch ${branch} matches multiple pull requests in ${context.baseRepo} (${rows
      .map((item) => `#${item.pr}`)
      .join(", ")}); the chain walk needs exactly one, so ${hint}`
  );
}

function headPullRequest({
  context,
  branch,
}: {
  context: GitHubContext;
  branch: string;
}): GitHubPullRequest {
  const rows = listPullRequests({
    context,
    query: { kind: "head", branch },
  }).filter((row) => ownerMatches(context, row));
  return requireSinglePullRequest({
    rows,
    context,
    branch,
    hint: "clarify the branch's PR history or pass --head-owner",
  });
}

function sameRepositoryParentPullRequest({
  context,
  branch,
}: {
  context: GitHubContext;
  branch: string;
}): SameRepositoryPullRequest {
  const candidates = listPullRequests({
    context,
    query: { kind: "head", branch },
  });
  const rows = candidates.filter(
    (row): row is SameRepositoryPullRequest =>
      row.kind === "same-repository"
  );
  if (rows.length === 0) {
    const fork = candidates.find(
      (row): row is CrossRepositoryPullRequest =>
        row.kind === "cross-repository"
    );
    if (fork !== undefined) {
      throw forkPullRequestError(fork);
    }
  }
  return requireSinglePullRequest({
    rows,
    context,
    branch,
    hint: "clarify the branch's PR history",
  });
}

function rejectStrandedDescendants({
  context,
  terminal,
  knownBranches,
}: {
  context: GitHubContext;
  terminal: {
    readonly branch: string;
    readonly pr: number;
    readonly state: "CLOSED" | "MERGED";
  };
  knownBranches: ReadonlySet<string>;
}): void {
  const pending = [terminal.branch];
  const visited = new Set(knownBranches);
  while (pending.length > 0) {
    const branch = pending.pop();
    if (branch === undefined || visited.has(branch)) {
      continue;
    }
    visited.add(branch);
    const rows = listPullRequests({
      context,
      query: { kind: "base", branch },
    });
    for (const row of rows) {
      if (row.state === "OPEN") {
        if (row.kind === "cross-repository") {
          throw forkPullRequestError(row);
        }
        throw new UserError(
          `open PR #${row.pr} on branch ${row.branch} descends from ${terminal.state.toLowerCase()} PR #${terminal.pr} on branch ${terminal.branch}; retarget the active descendants or resolve from their submitted chain. No frontier was written.`
        );
      }
      if (row.kind === "same-repository") {
        pending.push(row.branch);
      }
    }
  }
}

function openChild({
  context,
  branch,
  knownBranches,
}: {
  context: GitHubContext;
  branch: string;
  knownBranches: ReadonlySet<string>;
}): SameRepositoryPullRequest | undefined {
  const rows = listPullRequests({
    context,
    query: { kind: "base", branch },
  });
  const opens = rows.filter((row) => row.state === "OPEN");
  const fork = opens.find(
    (row): row is CrossRepositoryPullRequest =>
      row.kind === "cross-repository"
  );
  if (fork !== undefined) {
    throw forkPullRequestError(fork);
  }
  const children = opens.filter(
    (row): row is SameRepositoryPullRequest =>
      row.kind === "same-repository" && ownerMatches(context, row)
  );
  if (children.length > 1) {
    throw new UserError(
      `stack is not linear: branches ${children
        .map((row) => row.branch)
        .join(", ")} all target ${branch}`
    );
  }
  const submittedBranches = new Set([
    ...knownBranches,
    ...children.map((row) => row.branch),
  ]);
  for (const row of rows) {
    if (row.state !== "OPEN" && row.kind === "same-repository") {
      rejectStrandedDescendants({
        context,
        terminal: { branch: row.branch, pr: row.pr, state: row.state },
        knownBranches: submittedBranches,
      });
    }
  }
  return children[0];
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
  baseRepo: string;
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
  const visitedBranches = new Set<string>([current]);
  const visitedPrs = new Set<number>();
  const first = headPullRequest({ context, branch: current });
  if (first.kind === "cross-repository") {
    throw forkPullRequestError(first);
  }
  visitedPrs.add(first.pr);
  const chain: SameRepositoryPullRequest[] = [first];
  let bottom = first;
  while (bottom.base !== context.trunk) {
    if (visitedBranches.has(bottom.base)) {
      throw new UserError(
        `pull request base chain loops at branch ${bottom.base}`
      );
    }
    visitedBranches.add(bottom.base);
    const parent = sameRepositoryParentPullRequest({ context, branch: bottom.base });
    if (visitedPrs.has(parent.pr)) {
      throw new UserError(
        `pull request base chain repeats PR #${parent.pr}`
      );
    }
    visitedPrs.add(parent.pr);
    chain.unshift(parent);
    bottom = parent;
  }
  const knownBranches = new Set([context.trunk, ...visitedBranches]);
  for (let index = 0; index < chain.length - 1; index += 1) {
    const parent = chain[index];
    const selected = chain[index + 1];
    if (parent === undefined || selected === undefined) {
      throw new UserError("incomplete resolved base chain");
    }
    const child = openChild({ context, branch: parent.branch, knownBranches });
    if (child !== undefined &&
        (child.pr !== selected.pr || child.branch !== selected.branch)) {
      throw new UserError(
        `stack is not linear: branch ${child.branch} also targets ${parent.branch}, alongside selected branch ${selected.branch}`
      );
    }
    if (child !== undefined &&
        (child.state !== selected.state || child.headSha.toLowerCase() !== selected.headSha.toLowerCase())) {
      throw new UserError(`PR #${selected.pr} changed during discovery; retry before writing the frontier`);
    }
  }
  let tip = current;
  for (;;) {
    const child = openChild({ context, branch: tip, knownBranches });
    if (child === undefined) {
      break;
    }
    if (visitedBranches.has(child.branch)) {
      throw new UserError(
        `pull request base chain loops at branch ${child.branch}`
      );
    }
    if (visitedPrs.has(child.pr)) {
      throw new UserError(
        `pull request base chain repeats PR #${child.pr}`
      );
    }
    visitedBranches.add(child.branch);
    knownBranches.add(child.branch);
    visitedPrs.add(child.pr);
    chain.push(child);
    tip = child.branch;
  }
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
