# open-pstack

This is Arjit Jaiswal's independently maintained distribution. Cursor is the content source; other ports are advisory sources of fixes.

Track all durable work in this repository's GitHub Issues. Do not create a parallel Linear queue. Read `UPSTREAM.md` before changing upstream-derived content.

Cursor's `cursor/plugins/pstack` tree is the content upstream. Keep one shared skill tree for Claude Code and Codex; adapt harness primitives at the existing mapping boundaries instead of forking skills or adding compatibility layers. The parent harness freezes the model sheet for a run and owns every provider-routing decision. Children do not detect or reroute themselves.

The default branch `main` is the public installation source and must remain ready for users. Keep unfinished package changes on PR branches. Validate changed behavior before merge, and bump the plugin version when packaged behavior changes, including shared skills and provider instructions. A version string is an update signal, not a barrier that hides unversioned changes from new installs. GitHub release tags document tested checkpoints and provide rollback; they are not an installation prerequisite.

Before opening a pull request, run the Bun tests, strict typecheck, static invariants, and plugin validation.

For changes to Open Pstack, invoke the project-local [verify-open-pstack skill](.agents/skills/verify-open-pstack/SKILL.md) before declaring the work complete, whether or not the user names it or uses poteto-mode. Read its feature map, run the recipes covering the affected behavior, and retain the evidence. Report blocked or unmapped paths as unverified; a CLI check does not replace installed-parent verification. For documentation or maintenance-only changes, use the maintenance evidence requirements below.

Nothing merges, tags, releases, or rolls out until the exact candidate is installed and the changed behavior passes a live test from the real user surface in every affected harness. Unit tests, validators, source inspection, and self-reports do not satisfy this gate. Record the installed version, surface, action, and observed result in the pull request template. A pull request without that evidence remains a draft.

For documentation or maintenance-only changes, prove that the packaged plugin tree is unchanged and exercise the changed CLI or GitHub workflow. There is no affected parent installation in that case. Record the actual maintenance evidence instead of repeating unchanged provider tests.

Do not add an implicit runtime timeout or a weaker-model fallback. The only permitted substitution is a saved `primary -> fallback` chain in the model sheet on a terminal outcome the sheet's `# fallback` policy authorizes (`usage-exhausted` only when no policy line is saved), per `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md`; anything else remains a dropout.

## Default delivery workflow

For repository changes, carry the work through validation, public PR review, and squash merge without waiting for another user prompt. An explicit request to stop at a draft, review, or unmerged branch overrides this default.

1. Use `create-public-facing-pr` to publish a focused PR with a concise description and verification evidence. Keep unrelated changes in separate PRs.
2. Request Copilot review and use `address-copilot-review` to assess every finding, verify and push appropriate fixes, publish replies, and resolve addressed threads. Confirm replies are submitted rather than pending. If Copilot is unavailable or quota-limited, record that fact; do not treat it as an approval or wait indefinitely.
3. Run the project-local [verify-open-pstack skill](.agents/skills/verify-open-pstack/SKILL.md) against the final candidate. Complete the applicable installed-parent or maintenance checks above and record observed results in the PR. Revalidate behavior affected by review fixes.
4. Once required checks and applicable validation pass and review findings are addressed, squash merge the PR using a server-enforced expected-head SHA. Verify the resulting merge into `main`.

Proceed autonomously through routine fixes and retries justified by evidence. Existing validation gates and explicit restrictions on credentials, spending, or other actions still apply. When a required check cannot run, document the concrete blocker, complete independent work, and leave the affected PR unmerged. Do not replace a missing live test with a unit-test or source-inspection claim. Tags, releases, and installation changes outside validation require their own task scope.

## Documentation ownership

Each maintained fact has one owner. When behavior changes, update the owner in the same change; everywhere else, link rather than restate. Dated records and history sections are frozen snapshots. Never edit them to track current state. `python3 scripts/check-docs.py` enforces the objective parts of this table; passing proves structure, not that all prose is current.

| Fact | Owner |
| --- | --- |
| Fresh install steps | `README.md` (`## Install`) |
| Supported parent and provider IDs | `plugins/pstack/skills/poteto-mode/scripts/runner/types.ts` (`PARENTS`, `PROVIDERS`), rendered by the README provider table |
| Models, defaults, permissions, billing | `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md` |
| Cursor baseline | `UPSTREAM.md` sync table |
| Package version | plugin manifests, mirrored in the `UPSTREAM.md` sync table and checked by `check-ledger` |
| Skill purpose and invocation | each packaged `SKILL.md`; README lists common entry points |
| Release history | `docs/releases.md` |
| Install-source policy | `docs/fork-maintenance.md` (`### Keep main ready for users`) |
| Validation evidence | dated records and the frozen `## Validation history` block in `docs/compatibility.md` |
