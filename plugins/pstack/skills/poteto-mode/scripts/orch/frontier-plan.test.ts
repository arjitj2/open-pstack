import { describe, expect, it } from "bun:test";
import {
  planFrontier,
  type GitHubContext,
  type GitHubGraph,
  type GitHubPullRequest,
} from "./frontier-github.ts";

const context: GitHubContext = {
  checkout: ".",
  baseRepo: "acme/service",
  trunk: "main",
  trunkSource: "repository-default",
};

function graph(rows: readonly GitHubPullRequest[]): GitHubGraph {
  const branches = [...new Set(rows.map(row => row.branch))];
  return {
    heads: new Map(branches.map(branch => [branch, rows.filter(row => row.branch === branch)])),
    children: new Map(branches.map(branch => [branch, rows.filter(row => row.base === branch)])),
  };
}

const spine: readonly GitHubPullRequest[] = [
  { kind: "same-repository", pr: 10, state: "MERGED", branch: "a", base: "main", owner: "acme", headSha: "a".repeat(40) },
  { kind: "same-repository", pr: 13, state: "CLOSED", branch: "b", base: "a", owner: "acme", headSha: "b".repeat(40) },
  { kind: "same-repository", pr: 11, state: "OPEN", branch: "c", base: "b", owner: "acme", headSha: "c".repeat(40) },
  { kind: "same-repository", pr: 14, state: "OPEN", branch: "d", base: "c", owner: "acme", headSha: "d".repeat(40) },
];

describe("frontier planning", () => {
  it("retains one terminal-spanning active spine from every submitted member", () => {
    for (const current of ["a", "b", "c", "d"]) {
      expect(planFrontier({ context, current, graph: graph(spine) }).map(row => row.pr)).toEqual([10, 13, 11, 14]);
    }
  });

  it("uses the same repository identity despite unrelated same-named fork heads", () => {
    const rows: readonly GitHubPullRequest[] = [
      ...spine,
      { kind: "cross-repository", pr: 77, state: "OPEN", branch: "c", base: "main", owner: "alice", headRepo: "alice/service", headSha: "c".repeat(40) },
    ];
    for (const current of ["a", "b", "c", "d"]) {
      expect(planFrontier({ context, current, graph: graph(rows) }).map(row => row.pr)).toEqual([10, 13, 11, 14]);
    }
  });

  it("rejects a reachable fork below terminal history", () => {
    const rows: readonly GitHubPullRequest[] = [
      ...spine.slice(0, 2),
      { kind: "cross-repository", pr: 77, state: "OPEN", branch: "foreign", base: "b", owner: "alice", headRepo: "alice/service", headSha: "c".repeat(40) },
    ];
    expect(() => planFrontier({ context, current: "a", graph: graph(rows) })).toThrow("fork");
  });

  it("rejects a base observation whose child head response is absent", () => {
    const observed = graph(spine);
    const heads = new Map(observed.heads);
    heads.delete("d");
    expect(() => planFrontier({ context, current: "c", graph: { ...observed, heads } })).toThrow("changed during discovery");
  });

  it("rejects contradictory metadata across queries", () => {
    const observed = graph(spine);
    const children = new Map(observed.children);
    children.set("c", [
      { kind: "same-repository", pr: 14, state: "MERGED", branch: "d", base: "c", owner: "acme", headSha: "d".repeat(40) },
    ]);
    expect(() => planFrontier({ context, current: "c", graph: { ...observed, children } })).toThrow("changed during discovery");
  });
});
