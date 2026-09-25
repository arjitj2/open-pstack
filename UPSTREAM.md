# Upstream synchronization

Arjit Jaiswal maintains this distribution directly against Cursor Pstack. Eric Litman's Open Pstack remains an advisory source of fixes and the historical basis of this port. See the [maintenance policy](docs/fork-maintenance.md).

open-pstack tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack) while adapting Cursor-specific primitives for Claude Code and Codex.

## Current sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `12d587dfb20741cafc376c42c696c5f6e2a64487` |
| Upstream version | `0.15.5` |
| open-pstack version | `1.7.0` |

The table records the packaged version and its incorporated Cursor content, with the exclusions below. Version 1.7.0 is an OpenCode worker candidate with installed-parent validation recorded in `docs/opencode-worker-verification.md`. Detecting or reviewing newer Cursor commits does not advance this baseline. `README-UPSTREAM.md` preserves the upstream pstack README verbatim. `CHANGES.md` and `NOTICE.md` describe the adaptations and provenance.

See [release history](docs/releases.md) for the incorporated Cursor version and commit of each distribution release. Our release numbers are independent of Cursor and Eric’s port.

## Upstream-only exclusions

- Commits `799151d` and `6fecddb` add and relocate `make-bot-ui`. It depends on Cursor routines, webhook events, and UI primitives that Claude Code and Codex do not share.
- Four `disable-model-invocation: true` lines from `73f8be4` are not applied to `how`, `why`, `unslop`, or `typescript-best-practices`. Poteto-mode invokes those skills by name, and the flag blocks that route on Claude Code.
- The `23a56e2` default-model hunks for `bug-fix`, `perf-issue`, and `hillclimb` are not applied, and the equivalent hunks in `889ec4b` and `70b2dc8` carry the same exclusion. The first-run defaults for those roles stay on `codex:gpt-5.6-sol@max` for cost. Existing user assignments take precedence.
- The Claude manifest does not take the logo field from `efa2a53` because Claude Code has no schema for it. The shared asset is exposed through the Codex manifest instead.

## Pending source changes

The [maintenance issue](https://github.com/arjitj2/open-pstack/issues/1) and direct Cursor proposal PRs show outstanding changes. The committed [decision ledger](maintenance/upstream-ledger.json) distinguishes adopted, adapted, excluded, and pending commits. Each final disposition needs a reason and evidence. Pending rows stay visible after the review cursor advances. The committed changes through `12d587df` have passed installed-parent validation. Their decisions and evidence are documented in [docs/cursor-adoption-20260924.md](docs/cursor-adoption-20260924.md).

## Check for changes

The repository already names Cursor's repository as the `cursor` remote in the maintainer checkout. A fresh clone can add it once:

```shell
git remote add cursor https://github.com/cursor/plugins.git
```

Fetch and inspect only commits that touched pstack after the recorded sync point:

```shell
git fetch cursor main
git log --oneline 12d587dfb20741cafc376c42c696c5f6e2a64487..cursor/main -- pstack
git diff --stat 12d587dfb20741cafc376c42c696c5f6e2a64487..cursor/main -- pstack
```

No output means the tracked pstack tree has not changed. The daily workflow performs this comparison directly against Cursor and proposes metadata for review. It does not import or execute upstream code.

## Incorporate a change

1. Create or update a GitHub issue in `arjitj2/open-pstack` and branch from current `main`.
2. Read each upstream pstack commit in order. Bring over its intent and content, then apply only the Claude Code and Codex substitutions documented in `CHANGES.md`.
3. Keep one shared `plugins/pstack/skills/` tree. Put harness translation in the existing `codex-tools.md` and provider routing in `provider-dispatch.md`; do not fork a skill per harness.
4. Update the decision ledger with the disposition, reason, and evidence. Update the incorporated baseline only after every earlier pending change has a final decision and the adopted content is validated. Update the affected provenance rows in `NOTICE.md` and preserve `README-UPSTREAM.md` at the incorporated source revision.
5. Run CI-equivalent checks locally, then run the installed Claude Code and Codex behavioral lanes required by the changed surface. Unit tests alone are not a release gate.
6. Merge the reviewed PR before tagging the next open-pstack release.

Cursor's version and open-pstack's version are independent. Cursor's version identifies the imported content; open-pstack's version identifies the cross-harness distribution.
