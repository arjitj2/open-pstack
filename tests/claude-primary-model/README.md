# Claude primary-model verification

Issue [45](https://github.com/arjitj2/open-pstack/issues/45) concerns model identity in Claude worker receipts. Per-model usage includes helper calls, so a matching usage key cannot establish which model answered the main task.

The protocol investigation used Claude Code 2.1.282. A real `stream-json --verbose` probe returned main assistant events with `parent_tool_use_id: null`, a session ID, and `message.model: "claude-opus-5-5"`. Its terminal result retained text, usage, and cost. Claude's [headless documentation](https://code.claude.com/docs/en/headless#follow-subagent-messages) describes the ownership field and distinguishes main messages from subagent messages.

The regression test `rejects result-only Claude usage as primary-model evidence` failed before the fix. The parser returned `claude-opus-4-6` from the mixed usage map instead of rejecting missing primary evidence. This was a synthetic reproduction of ambiguous accounting, not an observed backend model substitution.

## Repeat the synthetic runner checks

Run the checks through the candidate installed in the parent being tested:

```sh
python3 tests/claude-primary-model/verify-fixtures.py \
  --runner /absolute/path/to/installed/pstack/skills/poteto-mode/scripts/runner/pstack-runner \
  --parent codex \
  --evidence /absolute/path/to/new/evidence-directory
```

Repeat with `--parent claude` and its installed candidate path. The fixture replaces only the Claude executable at the provider boundary. It performs no inference and leaves personal configuration untouched. It verifies that valid primary evidence survives helper usage, while helper-only matches, usage-only results, and conflicting primary models fail without an output file. It also checks that rejected completed turns retain the no-replay signal and that failure receipts omit transcript contents.

Synthetic checks do not replace the live installed-parent runs recorded below.

## Installed-parent validation on September 26, 2026

The [sanitized evidence](installed-parent-1.8.2.json) records candidate 1.8.2, package tree `c853591c6ecbe29db61bd1e1847b09931e51d6eb`. All 191 packaged files matched the source and both isolated installations before and after execution.

Both parents invoked the installed setup availability workflow and then executed the synthetic checks through that same installed runner. Codex ran a real external `claude:opus@high` worker, which reported `claude-opus-5-5`. Claude Code ran a real external `claude:claude-haiku-4-5-20251001@low` worker. Each receipt recorded verified provider-report evidence and the stream flags. Each output matched its input file byte for byte on independent readback. Both parent processes exited zero.

All four synthetic cases passed in each parent. The valid primary with helper usage completed; the helper-only match, usage-only result, and conflicting primary models failed with exit 65 and no output file. Completed malformed responses retained `terminalSuccess: true`. No intermediate transcript marker appeared in failure receipts. These synthetic cases do not claim an actual backend model substitution.

The final candidate passed 531 Bun tests, strict typechecking, static invariants, plugin validation, documentation and ledger checks, 27 maintenance tests, and 16 documentation-checker tests. The first full run hit the host's broken Homebrew Node installation; a command-local bundled Node path resolved those eight environment failures. The writer's nested-sandbox test limitation did not recur in the parent run. No global runtime settings changed.

Independent review found no blocking correctness defect. A suggested fallback to raw non-JSON stdout was declined because truncated transcript lines could contain private content; recognized terminal-result diagnostics remain intact. Normal plugin installations and model sheets were not changed. The temporary Codex authentication link was removed after validation.
