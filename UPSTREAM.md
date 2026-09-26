# Upstream synchronization

Arjit Jaiswal maintains this distribution directly against [Cursor's Pstack](https://github.com/cursor/plugins/tree/main/pstack). [Eric Litman's Open Pstack](https://github.com/ericlitman/open-pstack) is the historical basis of this port and remains an advisory source of fixes. Its releases do not control this distribution's updates.

This page records the current Cursor baseline and the maintainer procedure for reviewing, adopting, and releasing upstream changes.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `12d587dfb20741cafc376c42c696c5f6e2a64487` |
| Upstream version | `0.15.5` |
| open-pstack version | `1.8.0` |

The table records the packaged version on `main` and the Cursor content it incorporates, minus the exclusions below. Detecting or reviewing a newer Cursor commit does not advance this baseline. Cursor's version identifies the imported content. The open-pstack version identifies the cross-harness package, and its numbers are independent of Cursor and Eric's port.

The upstream README at this baseline is [cursor/plugins `pstack/README.md` @ 12d587df](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/README.md). [CHANGELOG.md](CHANGELOG.md) records the baseline of each release, and [NOTICE.md](NOTICE.md) records provenance.

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The `23a56e2` default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` are not applied, and the equivalent hunks in `889ec4b` and `70b2dc8` carry the same exclusion. The first-run defaults for those roles stay on `codex:gpt-5.6-sol@max` for cost. Existing user assignments take precedence.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The Codex manifest exposes the shared asset instead.

Earlier exclusions include Cursor's Benny automation, tutorial and sticky-mode UI, Cursor-only agent metadata, and Team Kit tools covered by host built-ins or bundled skills. The [historical port record](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/reference.md#whats-deliberately-not-ported) records those source revisions.

## Port adaptations

Both parent apps load the same `plugins/pstack/skills/` tree through their own plugin manifests. Claude Code also loads a SessionStart instruction that routes engineering tasks into `poteto-mode`. Codex users invoke the skill explicitly or add a standing instruction.

When incorporating Cursor content, translate harness primitives at the existing boundaries:

| Cursor assumption | Port equivalent |
| --- | --- |
| `Task`, `generalPurpose`, and a per-call readonly flag | Claude `Agent`, `general-purpose`, and the access mode assigned by the parent |
| `AskQuestion` | Claude `AskUserQuestion` |
| Built-in `/babysit` | The bundled `babysit` skill; poteto-mode uses its Babysit playbook |
| `/create-skill` | `plugin-dev:skill-development` |
| Team Kit `control-cli` / `control-ui` | Claude built-in `run` / `verify` |
| Cursor cloud workers | Local background workers in isolated worktrees |
| Cursor transcript and skill paths | The corresponding host's transcript and skill locations |
| Cursor model selectors | Provider-qualified descriptors resolved by the parent |

[`codex-tools.md`](plugins/pstack/skills/poteto-mode/references/codex-tools.md) defines the Claude-to-Codex tool mapping. [`provider-dispatch.md`](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) owns native/external routing, models, permissions, billing, and recovery. Use those references when porting; do not add a second harness-specific skill tree. [NOTICE.md](NOTICE.md) identifies the imported components and port-authored work.

## Decision ledger

[`maintenance/upstream-ledger.json`](maintenance/upstream-ledger.json) records every Cursor `pstack/` commit after the incorporated baseline. Each entry has one status:

- `pending`: catalogued but not yet decided.
- `adopted`: taken as written.
- `adapted`: taken with Claude Code and Codex changes.
- `excluded`: deliberately not taken.

Every final status needs a `reason` and an `evidence` link. `reviewed_through` is the last Cursor commit catalogued. It can move past commits that are still pending, and those entries stay listed until someone records a decision. The [maintenance issue](https://github.com/arjitj2/open-pstack/issues/1) reports the pending backlog.

## How automation proposes changes

The scheduled [catalog workflow](.github/workflows/upstream-sync.yml) runs daily. It compares Cursor `main` with `reviewed_through`. When `pstack/` has new commits, it opens one proposal pull request whose only change is `maintenance/upstream-ledger.json`: `reviewed_through` advances and each new commit appears as `pending`. The pull request body summarizes the proposal and links each source commit at its pinned Cursor URL. The workflow never imports or runs upstream code, never changes `plugins/`, and never merges.

A separate [validation workflow](.github/workflows/sync-candidate.yml) runs from trusted `main` with read-only credentials. It rebuilds the proposal with `fork-maintenance.py check-candidate`, confirms that the pull request head matches that rebuild exactly, and attaches the result as a commit status. If `main` advances, the old result no longer applies.

The weekly [report workflow](.github/workflows/upstream-health.yml) updates the maintenance issue. It flags aging pending commits for review. Skill Markdown counts as behavior; the classification is a review prompt, not proof of a defect.

Merging a proposal records the commits as pending. It does not adopt them.

## Review upstream changes locally

To add Cursor as a remote in a fresh clone, run:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch the source and compare it with the incorporated baseline:

```shell
git fetch cursor main
python3 scripts/upstream-audit.py --port HEAD --upstream cursor/main
```

The audit reads the baseline from the sync table and prints JSON. Changed paths are classified as matching the target, unchanged since the baseline, diverged, absent, or requiring distribution review. Blob equality is evidence, not approval. An empty `changes` list means the tracked upstream tree has not changed.

To preview the proposal that automation would open, run:

```shell
python3 scripts/fork-maintenance.py preview --base "$(git rev-parse HEAD)" --target "$(git rev-parse cursor/main)"
```

The preview prints the proposal body and the commit and branch that automation would create. It changes no files, refs, or GitHub state. To write the proposed ledger for inspection, add `--out-dir <dir>`. Use a directory outside the checkout. That option exports only `maintenance/upstream-ledger.json`.

To check the committed ledger, run:

```shell
python3 scripts/fork-maintenance.py check-ledger
```

## Adopt a change

1. Create or update a GitHub issue in `arjitj2/open-pstack` and branch from current `main`.
2. Read each pending upstream commit in order. Bring over its intent and content, then apply only the Claude Code and Codex substitutions listed under [Port adaptations](#port-adaptations).
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in `codex-tools.md` and provider routing in `provider-dispatch.md`. Do not fork a skill per harness.
4. In the ledger, set each decided commit to `adopted`, `adapted`, or `excluded`, with a `reason` and an `evidence` link to the pull request. Keep existing entries. Update the affected provenance rows in `NOTICE.md`.
5. Advance the `Commit` and `Upstream version` rows above only when every earlier pending commit has a final decision and the adopted content is validated.
6. Bump the package version when packaged behavior changes. Update the `open-pstack version` row above, both plugin manifests, and `.claude-plugin/marketplace.json` together. `tests/skill-collision-repro.sh` checks that the four values match. `.agents/plugins/marketplace.json` has no version field.
7. Add a `CHANGELOG.md` entry for the new version with its Cursor baseline and pull request.
8. Run the checks in [CONTRIBUTING.md](CONTRIBUTING.md#validate-a-change). Install the exact candidate and test the changed behavior in every affected parent app, as [AGENTS.md](AGENTS.md) requires. Keep the pull request in draft until that evidence is recorded.
9. Merge with a server-enforced expected-head guard after review findings are addressed and required checks pass.

Do not merge the original contribution pull requests in Eric's repository as part of this work. Consider new fixes from that repository separately.

## Publish a release

`main` is the installation source, so a merged change reaches new installs before any tag exists. [AGENTS.md](AGENTS.md) owns that policy. A tag marks a tested checkpoint that users can pin or roll back to.

1. Confirm the release commit is on `main` and its `plugins/pstack` tree matches the tested candidate.
2. Create a new, unique `vMAJOR.MINOR.PATCH` tag. Use a major version for incompatible behavior or configuration changes, a minor version for compatible features, and a patch version for compatible fixes. Never move or rename a published tag, including `v1.4.1-arjit.*`.
3. Write release notes that name the Cursor version and commit from the sync table, the distribution changes, the validation evidence, known limits, and the previous tested tag. Link the tag-pinned `UPSTREAM.md` for adaptations and exclusions. Use the incorporated baseline, never `reviewed_through`.
4. Record the tag in [CHANGELOG.md](CHANGELOG.md).

A repository change that leaves the plugin package unchanged needs no new version or tag.

## Recover an interrupted check

1. Open [Actions](https://github.com/arjitj2/open-pstack/actions) and read the failed run.
2. Correct the reported cause, then rerun the workflow or start it with `workflow_dispatch`.
3. If the run reports an ownership or divergence error on a proposal branch, resolve that error. Do not reset or force-push a shared branch. A retry keeps human edits to an existing proposal, and a closed unmerged proposal is reported instead of silently recreated.

The workflows need GitHub Actions enabled and permission to create pull requests. GitHub can delay scheduled runs or disable schedules in an inactive public repository. If reports stop, check the workflow status and turn on failed-run notifications in your GitHub settings.
