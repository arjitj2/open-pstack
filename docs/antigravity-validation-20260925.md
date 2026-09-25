# Antigravity worker validation

Candidate version: **1.6.0**, package Git tree `92947fa71b274333525c34703d69832717828358`. Tracked in [issue #29](https://github.com/arjitj2/open-pstack/issues/29). This candidate is not released; Claude Code validation remains blocked.

The adapter supports optional exact `antigravity:<slug>@default` assignments through `agy`. Read-only workers use a private agent directory. Writers use file tools in their assigned dedicated worktree; the parent runs tests. Both modes require an explicit API-spend choice. Model evidence records the pinned CLI argument because `init.model` echoes the request. No canonical quota failure is classified yet.

## Checks

- 444 Bun tests passed, including billing guards, stream rejection, model and tool audits, collisions, symlink rejection, and timeout/cancellation cleanup.
- Strict TypeScript checks, static invariants, plugin validation, manifest parsing, 26 maintenance tests, and the seven-entry maintenance ledger passed.
- The full Bun suite used the bundled Node runtime because the local Homebrew Node binary cannot load `libsimdjson.29`. Typechecking used `bun --bun run typecheck`.

## Live behavior

The installed `agy` executable had SHA-256 `42e76bedafb5896bc6a6eefb61902162f6ba08ddf59efd3357767102e3a59a0c`. Tests requested `gemini-3.1-pro-high`, default effort, and `apiSpend: deny`. Every run used fresh fixture and receipt paths with no implicit timeout or model substitution.

| Surface | Action | Observed result |
| --- | --- | --- |
| Checkout runner | Read a generated marker, then copy it through a file-only writer and read it back | Both receipts complete, exit 0; file contents matched; temporary agent files/directories removed. |
| Fresh Codex CLI session | Discover the separately installed `pstack@pstack-antigravity-validation` candidate, read its dispatch reference, and run both modes through its installed runner | Both receipts complete, exit 0; parent inspected results; independent readback and cleanup check passed. |
| Fresh Claude Code session | Load the same candidate via supported `--plugin-dir` and invoke the installed skill | Candidate skills appeared in the init event, but OAuth authentication failed before skill invocation or worker execution. This is not a behavior pass. |

Codex's installed package was compared file-for-file against the candidate before execution, excluding generated `node_modules`. The 187-file SHA-256 manifest digest was `c4c7dacd0a5c8c80ca9c48b5e490b24820b8a1fa84b9ee2aebc8f839eaa49175`. The test used a distinct marketplace identity, without replacing the user's normal Pstack installation. Claude's session-local plugin copy came from the same frozen candidate.

The first checkout attempt exposed an argument parsing failure: bare `--print` consumed `--output-format`. The adapter now passes `--print=`; regression coverage and subsequent real read/write runs passed. The failed attempt is retained as evidence rather than counted as a pass.

Receipts use `modelEvidence: "pinned-argv"` and `modelVerified: false`; they do not independently prove the backend model. The test script's literal surface label says “checkout CLI”; the parent transcript and installed runner command establish the separate Codex installed-host result above. Setup's interactive save workflow was not exercised by these targeted worker tests.

Local transcripts, receipts, fixture bytes, command records, and the candidate manifest are retained under `~/open-pstack-verification/antigravity-20260925`. The public record omits account and session details. Claude authentication must be restored and the exact candidate tested there before merge, tag, release, or rollout.
