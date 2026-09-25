# Initial verification

Tracked in https://github.com/arjitj2/open-pstack/issues/26.

Executed the generated Launch, Doctor, orchestration Drive, and Cleanup blocks in one Bash session on 2026-09-25. Checkout: `6dee2ee14f48c8643598b4301bc5a588371c0d59`; packaged version: `1.5.0`; Bun: `1.4.0`. The only source additions are this project-local skill and map.

The full local transcript is retained under `$HOME/open-pstack-verification.LlzqDA`, including the executed recipe, command output and exit codes, and final store under `scratch-final/store`. The portable observed results are recorded below.

- `orch-unit`, checkout Bun CLI: created `verify-smoke`, set its state to `complete`, reopened it in a new CLI process, and confirmed the stored TSV row. Passed.
- `orch-inbox`, checkout Bun CLI: pushed one notification, peeked, confirmed count stayed at one, drained the same notification, and confirmed count became zero. Passed.
- Cleanup: disposable scratch removed; doctor output, assertion output, and copied store survived. Passed.
- Package equality: before/after tracked-file indexes match, `git diff --exit-code HEAD -- plugins/pstack` is empty, and no untracked nonignored package files were added. Passed. Installed dependencies are ignored.
- Existing static invariants and `claude plugin validate plugins/pstack` passed.
- The Claude plugin validator does not accept a standalone project-skill directory: it reports no plugin manifest. The skill's frontmatter, required sections, five feature contracts, and local links were checked separately.

Installation/discovery, setup, engineering workflows, and routing were mapped but not exercised. No provider was launched, no personal installation or model sheet was changed, and no release qualification is claimed. Before publication, `bun run test` passed all 428 tests, `bun run typecheck` passed, all 26 fork-maintenance tests passed, and the maintenance ledger and four JSON manifests validated. Static invariants and plugin validation also passed again.

## Observed CLI results

All commands below exited zero. The full arguments and assertions are in [the orchestration recipe](features/orchestration.md).

| Action | Observed result |
| --- | --- |
| `unit get verify-smoke` after `unit set` | `id: verify-smoke`, `track: verification`, `state: complete` |
| Read the stored TSV | Contains `verify-smoke\tverification\tcomplete` |
| `inbox drain --peek`, then `inbox count` | One notification retained; `{"count":1}` |
| `inbox drain`, then `inbox count` | Same notification returned; `{"count":0}` |
| Run recipe assertions | `PASS: unit persisted; peek retained one notification; drain consumed it` |
| Cleanup and evidence checks | Scratch absent; doctor output, assertions, and copied store present |
