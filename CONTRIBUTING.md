# Contribute to Open Pstack

Arjit Jaiswal maintains this distribution. It is not an official Cursor, OpenAI, Anthropic, xAI, Cognition, Google, or OpenCode product. Report problems with the packaged port and propose changes in [this repository's issues](https://github.com/arjitj2/open-pstack/issues). Search existing issues first. Pull requests for documentation and maintenance tooling are welcome.

## Report a problem

Include:

- the installed Pstack version and the source your installation follows (`main`, a tag, or a commit);
- the parent app and its version;
- the provider CLI and its version, if a worker is involved;
- the requested model and effort;
- the steps that reproduce the problem, what you expected, and the error you saw.

Remove credentials and private prompts. Do not attach authentication tokens or raw conversation exports.

To test an unreleased change, use a separate installation or a disposable workspace, and keep a copy of your model configuration.

[UPSTREAM.md](UPSTREAM.md#decision-ledger) explains how to review pending Cursor changes.

## Change the repository

Read [AGENTS.md](AGENTS.md) and [UPSTREAM.md](UPSTREAM.md) before editing. Keep one shared skill tree for Codex and Claude Code. Preserve upstream licenses and credit. Record intentional differences from Cursor in the [decision ledger](maintenance/upstream-ledger.json). Each fact has one owner in the [documentation ownership](AGENTS.md#documentation-ownership) map. Update that owner and link to it from other pages.

## Development tools

[Bun](https://bun.sh) runs the packaged TypeScript tools and tests. Node runs `check-plan.mjs`; Python 3 runs repository maintenance scripts and their tests. Install dependencies with `bun install --frozen-lockfile` in `plugins/pstack/skills/poteto-mode/scripts/`.

GitHub workflows need an authenticated `gh` CLI. The worktree audit additionally uses `jq` and `rg`. Install and authenticate provider CLIs only for the worker routes you test.

Skill-authoring workflows in Claude Code use `plugin-dev:skill-development`. Install that optional plugin with `/plugin marketplace add anthropics/claude-plugins-official`, then `/plugin install plugin-dev@claude-plugins-official`. It is not declared as a hard dependency because local plugin-directory loading cannot resolve cross-marketplace dependencies. See the [original dependency change](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/CHANGES.md#093--dependency-declaration-removed).

## Validate a change

Run the checks in [.github/workflows/ci.yml](.github/workflows/ci.yml): Bun tests, strict typechecking, maintenance tests, manifest parsing, documentation checks, and static invariants. Run `claude plugin validate ./plugins/pstack` for plugin validation and `python3 scripts/check-docs.py` for the documentation checks.

For changes to packaged skills, agents, manifests, or runner behavior, install the exact candidate and exercise the changed behavior from every affected parent app. Record the installed version, action, observed result, and limits in the pull request. Keep the pull request in draft until that evidence is available. The [verify-open-pstack skill](.agents/skills/verify-open-pstack/SKILL.md) has recipes for each feature.

For documentation and maintenance tooling that leave the plugin tree unchanged, show that the tree is unchanged and demonstrate the changed command or workflow. Do not claim provider validation that was not needed or not performed.

[`tests/skill-collision-repro.sh`](tests/skill-collision-repro.sh) checks skill metadata, version mirrors, model aliases, and default-panel consistency. Its behavioral mode checks real Claude Code skill invocation.

Keep test results, transcripts, and generated proposal files outside the checkout. Put validation evidence in the pull request.

Keep tests and proposal validation separate from jobs with write permissions. New automation must handle retries without overwriting human edits or claiming that unreviewed content has shipped.
