import { afterEach, describe, expect, it } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BASE_REPO,
  chainPulls,
  cleanupFixtures,
  ghRows,
  git,
  initializedStore,
  makeGitStack,
  prFile,
  withFakeGh,
} from "./frontier-fixture.ts";

afterEach(cleanupFixtures);

type FixtureStack = Awaited<ReturnType<typeof makeGitStack>>;
type FixtureStore = Awaited<ReturnType<typeof initializedStore>>["store"];

async function expectSetRejected({
  directory,
  store,
  stack,
  pulls,
  error,
}: {
  readonly directory: string;
  readonly store: FixtureStore;
  readonly stack: FixtureStack;
  readonly pulls: Readonly<Record<string, string>>;
  readonly error: string;
}): Promise<void> {
  const before = await readFile(
    join(directory, "frontier.json"),
    "utf8"
  );
  await withFakeGh({
    directory,
    files: { pulls },
    operation: async () => {
      await expect(
        store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
      ).rejects.toThrow(error);
    },
  });
  expect(
    await readFile(join(directory, "frontier.json"), "utf8")
  ).toBe(before);
}

describe("frontier topology boundaries", () => {
  it("rejects a selected open child missing from its later base response", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    await expectSetRejected({
      directory, store, stack,
      pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/closed")]: ghRows([]),
      },
      error: "changed during discovery",
    });
  });

  it("retains the same terminal chain from each submitted checkout", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const pulls = {
      ...chainPulls(stack),
      [prFile("base", "stack/merged")]: ghRows([
        { number: 13, state: "closed", head: "stack/closed", base: "stack/merged", sha: stack.closedSha },
      ]),
      [prFile("base", "stack/closed")]: ghRows([
        { number: 11, state: "open", head: "stack/open", base: "stack/closed", sha: stack.openSha },
      ]),
    };
    await withFakeGh({ directory, files: { pulls }, operation: async () => {
      const first = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
      for (const branch of ["stack/merged", "stack/closed", "stack/open", "stack/draft"]) {
        git({ repo: stack.repo, args: ["checkout", branch] });
        const refreshed = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        expect(refreshed.prs).toEqual(first.prs);
      }
    } });
  });

  it("retains active descendants when a child branch also has closed history", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["checkout", "-b", "stack/further", "stack/draft"] });
    await writeFile(join(stack.repo, "further.txt"), "Further fixture unit\n");
    git({ repo: stack.repo, args: ["add", "further.txt"] });
    git({ repo: stack.repo, args: ["commit", "-m", "Further fixture unit"] });
    const furtherSha = git({ repo: stack.repo, args: ["rev-parse", "HEAD"] });
    git({ repo: stack.repo, args: ["checkout", "stack/open"] });
    await withFakeGh({
      directory,
      files: { pulls: {
        ...chainPulls(stack),
        [prFile("head", "stack/draft")]: ghRows([
          { number: 14, state: "open", head: "stack/draft", base: "stack/open", sha: stack.draftSha },
        ]),
        [prFile("base", "stack/open")]: ghRows([
          { number: 14, state: "open", head: "stack/draft", base: "stack/open", sha: stack.draftSha },
          { number: 15, state: "closed", head: "stack/draft", base: "stack/open", sha: "f".repeat(40) },
        ]),
        [prFile("base", "stack/draft")]: ghRows([
          { number: 16, state: "open", head: "stack/further", base: "stack/draft", sha: furtherSha },
        ]),
      } },
      operation: async () => {
        const first = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        expect(first.prs.map(row => row.pr)).toEqual([10, 13, 11, 14, 16]);
        git({ repo: stack.repo, args: ["checkout", "stack/draft"] });
        const second = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        expect(second.prs).toEqual(first.prs);
      },
    });
  });

  it("ignores obsolete terminal aliases above a deeper reused branch", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["checkout", "-b", "stack/further", "stack/draft"] });
    await writeFile(join(stack.repo, "further.txt"), "Further fixture unit\n");
    git({ repo: stack.repo, args: ["add", "further.txt"] });
    git({ repo: stack.repo, args: ["commit", "-m", "Further fixture unit"] });
    const furtherSha = git({ repo: stack.repo, args: ["rev-parse", "HEAD"] });
    const pulls = {
      ...chainPulls(stack),
      [prFile("head", "stack/draft")]: ghRows([
        { number: 14, state: "open", head: "stack/draft", base: "stack/open", sha: stack.draftSha },
        { number: 25, state: "closed", head: "stack/draft", base: "stack/closed", sha: "f".repeat(40) },
      ]),
      [prFile("base", "stack/closed")]: ghRows([
        { number: 11, state: "open", head: "stack/open", base: "stack/closed", sha: stack.openSha },
        { number: 25, state: "closed", head: "stack/draft", base: "stack/closed", sha: "f".repeat(40) },
      ]),
      [prFile("base", "stack/draft")]: ghRows([
        { number: 26, state: "open", head: "stack/further", base: "stack/draft", sha: furtherSha },
      ]),
    };
    await withFakeGh({ directory, files: { pulls }, operation: async () => {
      for (const branch of ["stack/closed", "stack/open", "stack/draft", "stack/further"]) {
        git({ repo: stack.repo, args: ["checkout", branch] });
        const frontier = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        expect(frontier.prs.map(row => row.pr)).toEqual([10, 13, 11, 14, 26]);
      }
    } });
  });

  it("does not erase a populated frontier from trunk without explicit intent", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    await withFakeGh({
      directory,
      files: { pulls: chainPulls(stack) },
      operation: async () => {
        await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        const before = await readFile(join(directory, "frontier.json"), "utf8");
        git({ repo: stack.repo, args: ["checkout", "main"] });
        await expect(
          store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO })
        ).rejects.toThrow("--allow-empty");
        expect(await readFile(join(directory, "frontier.json"), "utf8")).toBe(before);
        const cleared = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
          allowEmpty: true,
        });
        expect(cleared.generation).toBe(2);
        expect(cleared.prs).toEqual([]);
        expect(cleared.lowestUnmerged).toBeNull();
      },
    });
  });

  it("retains terminal ancestors already included in the selected chain", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    await withFakeGh({
      directory,
      files: { pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/merged")]: ghRows([
          { number: 13, state: "closed", head: "stack/closed", base: "stack/merged", sha: stack.closedSha },
        ]),
        [prFile("base", "stack/closed")]: ghRows([
          { number: 11, state: "open", head: "stack/open", base: "stack/closed", sha: stack.openSha },
        ]),
      } },
      operation: async () => {
        const frontier = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        expect(frontier.prs.map(row => row.pr)).toEqual([10, 13, 11, 14]);
        expect(frontier.lowestUnmerged).toBe(11);
      },
    });
  });

  it("rejects a lone open sibling beside a selected terminal ancestor", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    await expectSetRejected({
      directory, store, stack,
      pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/merged")]: ghRows([
          { number: 13, state: "closed", head: "stack/closed", base: "stack/merged", sha: stack.closedSha },
          { number: 16, state: "open", head: "stack/side", base: "stack/merged", sha: stack.draftSha },
        ]),
      },
      error: "stack is not linear: branches stack/closed, stack/side all target stack/merged",
    });
  });

  it("terminates a closed historical branch cycle without inventing active work", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    await withFakeGh({
      directory,
      files: { pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/abandoned")]: ghRows([
          { number: 23, state: "closed", head: "stack/gone", base: "stack/abandoned", sha: "c".repeat(40) },
        ]),
        [prFile("base", "stack/gone")]: ghRows([
          { number: 24, state: "closed", head: "stack/abandoned", base: "stack/gone", sha: "d".repeat(40) },
        ]),
      } },
      operation: async () => {
        const frontier = await store.frontier.set({ repo: stack.repo, baseRepo: BASE_REPO });
        expect(frontier.prs.map(row => row.pr)).toEqual([10, 13, 11, 14]);
      },
    });
  });

  it("rejects an open sibling on a non-trunk ancestor below the checkout", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const pulls = {
      ...chainPulls(stack),
      [prFile("base", "stack/closed")]: ghRows([
        {
          number: 11,
          state: "open",
          head: "stack/open",
          base: "stack/closed",
          sha: stack.openSha,
        },
        {
          number: 16,
          state: "open",
          head: "stack/side",
          base: "stack/closed",
          sha: stack.draftSha,
        },
      ]),
    };
    const error =
      "stack is not linear: branches stack/open, stack/side all target stack/closed";

    await expectSetRejected({
      directory,
      store,
      stack,
      pulls,
      error,
    });
    git({ repo: stack.repo, args: ["checkout", "stack/closed"] });
    await expectSetRejected({
      directory,
      store,
      stack,
      pulls,
      error,
    });
  });

  it("rejects an open fork sibling on a non-trunk ancestor below the checkout", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await expectSetRejected({
      directory,
      store,
      stack,
      pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/closed")]: ghRows([
          {
            number: 11,
            state: "open",
            head: "stack/open",
            base: "stack/closed",
            sha: stack.openSha,
          },
          {
            number: 78,
            state: "open",
            head: "stack/side",
            base: "stack/closed",
            sha: stack.draftSha,
            owner: "alice",
            headRepo: "service",
          },
        ]),
      },
      error: "PR #78 has head alice/service:stack/side in a fork",
    });
    expect((await store.frontier.show()).generation).toBe(0);
  });

  it("reports fork ancestry when a parent branch has only fork pull requests", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await expectSetRejected({
      directory,
      store,
      stack,
      pulls: {
        ...chainPulls(stack),
        [prFile("head", "stack/closed")]: ghRows([
          {
            number: 19,
            state: "open",
            head: "stack/closed",
            base: "stack/merged",
            sha: stack.closedSha,
            owner: "alice",
            headRepo: "service",
          },
        ]),
      },
      error: "PR #19 has head alice/service:stack/closed in a fork",
    });
    expect((await store.frontier.show()).generation).toBe(0);
  });

  it("rejects a competing active path behind a closed child", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await expectSetRejected({
      directory,
      store,
      stack,
      pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/open")]: ghRows([
          { number: 14, state: "draft", head: "stack/draft", base: "stack/open", sha: stack.draftSha },
          {
            number: 15,
            state: "closed",
            head: "stack/abandoned",
            base: "stack/open",
            sha: "f".repeat(40),
          },
        ]),
        [prFile("base", "stack/abandoned")]: ghRows([
          {
            number: 20,
            state: "open",
            head: "stack/stranded",
            base: "stack/abandoned",
            sha: "e".repeat(40),
          },
        ]),
      },
      error:
        "stack is not linear: branches stack/abandoned, stack/draft all target stack/open",
    });
    expect((await store.frontier.show()).generation).toBe(0);
  });

  it("rejects a competing active path behind multiple terminal links", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await expectSetRejected({
      directory,
      store,
      stack,
      pulls: {
        ...chainPulls(stack),
        [prFile("base", "stack/open")]: ghRows([
          { number: 14, state: "draft", head: "stack/draft", base: "stack/open", sha: stack.draftSha },
          {
            number: 15,
            state: "closed",
            head: "stack/abandoned",
            base: "stack/open",
            sha: "f".repeat(40),
          },
        ]),
        [prFile("base", "stack/abandoned")]: ghRows([
          {
            number: 21,
            state: "merged",
            head: "stack/abandoned-2",
            base: "stack/abandoned",
            sha: "d".repeat(40),
          },
        ]),
        [prFile("base", "stack/abandoned-2")]: ghRows([
          {
            number: 22,
            state: "open",
            head: "stack/stranded",
            base: "stack/abandoned-2",
            sha: "e".repeat(40),
          },
        ]),
      },
      error:
        "stack is not linear: branches stack/abandoned, stack/draft all target stack/open",
    });
    expect((await store.frontier.show()).generation).toBe(0);
  });

  it("ignores a terminal child with no open descendants", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          ...chainPulls(stack),
          [prFile("base", "stack/abandoned")]: ghRows([
            {
              number: 23,
              state: "closed",
              head: "stack/gone",
              base: "stack/abandoned",
              sha: "c".repeat(40),
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

  it("uses the published head for a terminal member whose local branch is pruned", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    const published = "b".repeat(40);

    await withFakeGh({
      directory,
      files: {
        pulls: {
          [prFile("head", "stack/open")]: ghRows([
            {
              number: 11,
              state: "open",
              head: "stack/open",
              base: "stack/ghost",
              sha: stack.openSha,
            },
          ]),
          [prFile("head", "stack/ghost")]: ghRows([
            {
              number: 9,
              state: "merged",
              head: "stack/ghost",
              base: "main",
              sha: published,
            },
          ]),
        },
      },
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
        });
        expect(frontier.prs).toEqual([
          {
            pr: 9,
            branches: "stack/ghost",
            sha: published,
            state: "MERGED",
          },
          {
            pr: 11,
            branches: "stack/open",
            sha: stack.openSha,
            state: "OPEN",
          },
        ]);
      },
    });
  });

  it("still requires a local branch for open chain members", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);
    git({ repo: stack.repo, args: ["branch", "-D", "stack/draft"] });

    await expectSetRejected({
      directory,
      store,
      stack,
      pulls: chainPulls(stack),
      error: "local branch stack/draft is missing",
    });
    expect((await store.frontier.show()).generation).toBe(0);
  });

  it("matches --head-owner case-insensitively", async () => {
    const { directory, store } = await initializedStore();
    const stack = await makeGitStack(directory);

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
        },
      },
      operation: async () => {
        const frontier = await store.frontier.set({
          repo: stack.repo,
          baseRepo: BASE_REPO,
          headOwner: "ACME",
        });
        expect(frontier.prs.map((row) => row.pr)).toEqual([
          10, 13, 11, 14,
        ]);
        expect(frontier.resolution?.headOwner).toBe("ACME");
      },
    });
  });
});
