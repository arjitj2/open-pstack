import { afterEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BASE_REPO,
  chainPulls,
  cleanupFixtures,
  ghRows,
  git,
  initializedStore,
  makeDirectory,
  makeGitStack,
  prFile,
  withFakeGh,
} from "./frontier-fixture.ts";

afterEach(cleanupFixtures);

describe("frontier resolution", () => {
  it("resolves the GitHub base chain and validates an optional pin", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: { pulls: chainPulls(stack) },
      operation: async () => {
        expect(
          await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).toEqual({
          generation: 1,
          prs: [
            {
              pr: 10,
              branches: "stack/merged",
              sha: stack.mergedSha,
              state: "MERGED",
            },
            {
              pr: 13,
              branches: "stack/closed",
              sha: stack.closedSha,
              state: "CLOSED",
            },
            {
              pr: 11,
              branches: "stack/open",
              sha: stack.openSha,
              state: "OPEN",
            },
            {
              pr: 14,
              branches: "stack/draft",
              sha: stack.draftSha,
              state: "OPEN",
            },
          ],
          lowestUnmerged: 11,
          resolution: {
            kind: "github-base-chain",
            baseRepo: BASE_REPO,
            trunk: "main",
            trunkSource: "repository-default",
          },
        });
        expect(
          (
            await store.frontier.set({
              repo: stack.repo,
              baseRepo: BASE_REPO,
              prs: [10, 13, 11, 14],
            })
          ).generation
        ).toBe(2);
        expect((await store.frontier.show()).generation).toBe(2);
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [10, 11, 12],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: missing from resolved chain: 12; extra in resolved chain: 13,14"
        );
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [13, 10, 11, 14],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: order differs: expected 13,10,11,14; resolved 10,13,11,14"
        );
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [10, 10],
          })
        ).rejects.toThrow("--prs must not contain duplicates");
        expect((await store.frontier.show()).generation).toBe(2);
      },
    });
  });

  it("sends the canonical repository on every pull request query", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: { pulls: chainPulls(stack) },
      operation: async (callsPath) => {
        await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        const calls = (await readFile(callsPath, "utf8")).trim().split("\n");
        expect(calls[0]).toBe(
          `repo view ${BASE_REPO} --json nameWithOwner,defaultBranchRef`
        );
        const prCalls = calls.slice(1);
        expect(prCalls.length).toBeGreaterThan(0);
        for (const call of prCalls) {
          expect(call).toContain(`--repo ${BASE_REPO}`);
          expect(call).toContain("--state all");
          expect(call).toContain("--limit 1000");
          expect(call).toContain("--json");
        }
        expect(
          prCalls.some((call) => call.includes("--head stack/open"))
        ).toBe(true);
        expect(
          prCalls.some((call) => call.includes("--base stack/open"))
        ).toBe(true);
      },
    });
  });

  it("writes an empty frontier on the trunk branch", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["checkout", "main"] });

    await withFakeGh({
      directory,
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
        });
        expect(frontier.prs).toEqual([]);
        expect(frontier.lowestUnmerged).toBeNull();
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            prs: [1],
          })
        ).rejects.toThrow(
          "frontier pin mismatch: missing from resolved chain: 1"
        );
        expect((await store.frontier.show()).generation).toBe(1);
      },
    });
  });

  it("honors an explicit trunk over the repository default", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        repoView: `${JSON.stringify({
          nameWithOwner: BASE_REPO,
          defaultBranchRef: null,
        })}\n`,
        pulls: chainPulls(stack),
      },
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
          trunk: "stack/closed",
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([11, 14]);
        expect(frontier.resolution).toEqual({
          kind: "github-base-chain",
          baseRepo: BASE_REPO,
          trunk: "stack/closed",
          trunkSource: "explicit",
        });
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `repository ${BASE_REPO} has no default branch`
        );
      },
    });
  });

  it("selects the head pull request by actual owner", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const pulls = {
      ...chainPulls(stack),
      [prFile("head", "stack/open")]: ghRows([
        {
          number: 11,
          state: "open",
          head: "stack/open",
          base: "stack/closed",
          sha: stack.openSha,
        },
        {
          number: 77,
          state: "open",
          head: "stack/open",
          base: "stack/closed",
          sha: stack.openSha,
          owner: "alice",
          headRepo: "service",
        },
      ]),
    };

    await withFakeGh({
      directory,
      files: { pulls },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("matches multiple pull requests");
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
          headOwner: "acme",
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([10, 13, 11, 14]);
        expect(frontier.resolution?.headOwner).toBe("acme");
        await expect(
          store.frontier.set({
            repo: stack.repo,
            baseRepo: BASE_REPO,
            headOwner: "alice",
          })
        ).rejects.toThrow("fork");
        expect((await store.frontier.show()).generation).toBe(1);
      },
    });
  });

  it("rejects a selected fork pull request before writing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 77,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: stack.openSha,
              owner: "alice",
              headRepo: "service",
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("fork");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a reachable fork child before writing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("base", "stack/open")]: ghRows([
            {
              number: 78,
              state: "open",
              head: "stack/draft",
              base: "stack/open",
              sha: stack.draftSha,
              owner: "alice",
              headRepo: "service",
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("fork");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a nonlinear stack and preserves the old frontier", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("base", "stack/open")]: ghRows([
            {
              number: 14,
              state: "draft",
              head: "stack/draft",
              base: "stack/open",
              sha: stack.draftSha,
            },
            {
              number: 16,
              state: "open",
              head: "stack/other",
              base: "stack/open",
              sha: stack.draftSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "stack is not linear: branches stack/draft, stack/other all target stack/open"
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a base chain that loops", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/closed")]: ghRows([
            {
              number: 13,
              state: "open",
              head: "stack/closed",
              base: "stack/open",
              sha: stack.closedSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "pull request base chain loops at branch stack/open"
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a base chain that repeats a pull request", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/merged")]: ghRows([
            {
              number: 11,
              state: "merged",
              head: "stack/merged",
              base: "main",
              sha: stack.mergedSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("pull request base chain repeats PR #11");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a saturated pull request listing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const saturated = ghRows(
      Array.from({ length: 1000 }, (_, index) => ({
        number: index + 1,
        state: "open" as const,
        head: "stack/open",
        base: "stack/closed",
        sha: stack.openSha,
      }))
    );

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: saturated,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("may be truncated");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects local head drift from the published pull request head", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const published = "a".repeat(40);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: published,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `local branch stack/open head ${stack.openSha} differs from PR #11 published head ${published}`
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("names the missing pull request when a chain branch has none", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `branch stack/open has no pull request in ${BASE_REPO}`
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("prefers the single open pull request over stale closed ones", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 99,
              state: "closed",
              head: "stack/open",
              base: "main",
              sha: stack.openSha,
            },
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: stack.openSha,
            },
          ]),
        },
      },
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([
          10, 13, 11, 14,
        ]);
      },
    });
  });

  it("rejects multiple pull requests on one branch", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/closed",
              sha: stack.openSha,
            },
            {
              number: 99,
              state: "open",
              head: "stack/open",
              base: "main",
              sha: stack.openSha,
            },
          ]),
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `branch stack/open matches multiple pull requests in ${BASE_REPO} (#11, #99)`
        );
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects a detached HEAD before writing", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["checkout", stack.openSha] });

    await withFakeGh({
      directory,
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("detached HEAD");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("rejects malformed GitHub output loudly", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: { repoView: "this line is not JSON\n" },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          `gh repo view ${BASE_REPO} output is not valid JSON`
        );
      },
    });

    await withFakeGh({
      directory,
      files: {
        repoView: `${JSON.stringify({
          nameWithOwner: "acme/other",
          defaultBranchRef: { name: "main" },
        })}\n`,
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("different repository acme/other");
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: "this line is not JSON\n",
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "gh pr list --head stack/open output is not valid JSON"
        );
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: `${JSON.stringify([
            { number: 11, state: "OPEN" },
          ])}\n`,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow(
          "gh pr list --head stack/open output has an invalid PR row"
        );
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: `${JSON.stringify([
            {
              number: 11,
              state: "OPEN",
              headRefName: "stack/other",
              baseRefName: "main",
              headRefOid: stack.openSha,
              headRepositoryOwner: { login: "acme" },
              headRepository: { name: "service", nameWithOwner: "" },
              isCrossRepository: false,
            },
          ])}\n`,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("whose head is stack/other");
      },
    });

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: `${JSON.stringify([
            {
              number: 77,
              state: "OPEN",
              headRefName: "stack/open",
              baseRefName: "stack/closed",
              headRefOid: stack.openSha,
              headRepositoryOwner: { login: "alice" },
              headRepository: null,
              isCrossRepository: true,
            },
          ])}\n`,
        },
      },
      operation: async () => {
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("missing head repository metadata");
        expect((await store.frontier.show()).generation).toBe(0);
      },
    });
  });

  it("requires an owner/name base repository", async () => {
    const { store } = await initializedStore();
    const directory = await makeDirectory();
    const stack = await makeGitStack(directory);
    await expect(
      store.frontier.set({ repo: stack.repo, baseRepo: "not a repo" })
    ).rejects.toThrow("owner/name");
  });
});
