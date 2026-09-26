# New-model support verification — 2026-09-26

The 1.8.0 candidate accepts available model IDs outside the recommendation matrix on supported providers. This record covers setup, routing, exact selection, and saved-configuration preservation for [PR #46](https://github.com/arjitj2/open-pstack/pull/46).

## Candidate and surfaces

Code commit: `9ae752fe95ceb3a86e90a5bca2ddfd832795eb99`. The 191 packaged files in both test installations match the candidate. The SHA-256 of the sorted JSON file-hash map is `1e1e2fe6772fc50d38b949b330b15957be27eb94ab11578eb6564862546bd70e`. [Machine-readable evidence](evidence/model-discovery-20260926.json) retains those hashes, receipt fields, native launch records, and readback results. Later documentation-only commits preserve that package tree.

- Codex CLI 0.154.0: a dedicated `CODEX_HOME`, supported local marketplace installation, fresh setup session, and disposable sheet plus `AGENTS.md`.
- Claude Code 2.1.282: a separate candidate copy loaded with the supported session-only `--plugin-dir` control, actual `Skill` invocation of `pstack:setup-pstack`, and disposable sheet plus `CLAUDE.md`.
- Bun 1.4.0; Node 24.21.0 for checks. The machine's default Node 25 binary could not load its Homebrew simdjson library; the test commands used the working runtime without modifying the shared installation.

Personal sheets and plugin installations were preserved. Test-driver confirmation authorized only the displayed, unchanged fixture proposals. External probes used existing included access with `apiSpend: deny`.

## Observed behavior

| Parent | Selected descriptor | Observed route and result |
| --- | --- | --- |
| Codex | `codex:gpt-5.5@high` | Native child; host metadata records the exact model and effort; marker and smoke result correct. |
| Codex | `devin:swe-2-high@default` | External CLI; exact UID pinned in argv; marker and smoke result correct. |
| Claude Code | `claude:claude-haiku-4-5-20251001@low` | External CLI from the Claude parent; provider report matches the requested ID; marker and smoke result correct. |
| Claude Code | `devin:swe-2-high@default` | External CLI; exact UID pinned in argv; marker and smoke result correct. |
| Both | `inherit-parent` | Independent native children with model argument omitted; marker and smoke results correct. |

Setup preserved all 15 role rows, efforts, access facts, lane order, and absence of fallback policy. Each parent stopped before saving for confirmation. Both targets in each fixture read back byte-identical to the confirmed proposal and original bytes. Each smoke ran three candidates, followed by a separate inherited reviewer; the reviewer pool intentionally had no cross-provider diversity.

Both independent reviewers passed their three smoke outputs. Codex's reviewer also checked the saved files, host model/effort events, and Devin receipts; it reported no findings.

For the selected-provider failure case, setup in each parent proposed only `devin:pstack-nonexistent-model-44@default` for `feature, refactoring`. Policy parsing accepted the syntax, then the real provider returned `Unknown model`, child exit 1. Setup wrote neither target, launched no substitute, and retained the failed receipt. Both parents preserved the saved files byte-for-byte.

## Checks and review

- 518 Bun tests pass, including exact UID passthrough, unknown Claude aliases, reported-model mismatch, shared routing, legacy pin migration, nested-session environment isolation, and CRLF agent files.
- Strict typecheck, static invariants, documentation checks, ledger coverage, and plugin validation pass.
- Independent `claude:opus@high` code review reported no remaining introduced bugs after review fixes; provider report was `claude-opus-5-5`.
- Copilot review was requested and recorded by GitHub, but quota exhaustion prevented review. No inline findings or pending owner replies exist.

## Limits and unexercised cases

This proves the named available model selections, not entitlement to every provider model. The fresh Codex profile rejected a `gpt-6-sol` controller before setup began; it is an account-availability failure, not a successful selected-model test. The disposable positive fixture explicitly selected available `gpt-5.5` instead. No runtime fallback was added.

Devin evidence proves the requested UID in CLI argv, not backend identity. Claude's pre-existing ambiguity when `modelUsage` contains helper models is tracked in [issue #45](https://github.com/arjitj2/open-pstack/issues/45); token-count heuristics were not added as identity proof. Model and effort receipts do not establish hidden reasoning depth or guarantee account billing behavior.

The unchanged write-rollback, exhausted-quota recovery, new-provider onboarding, and additional provider-account combinations were not rerun live. Existing automated coverage remains; these are not new live claims.

Raw transcripts, receipt files, fixture bytes, test logs, review reports, and the append-only decision trail are retained locally under `~/open-pstack-verification-model-discovery-20260925`. The committed JSON contains selected non-secret evidence fields and raw-receipt hashes; it omits auth records and full provider conversations.
