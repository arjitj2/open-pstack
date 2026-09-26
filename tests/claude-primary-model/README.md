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

Live installed-parent evidence is recorded separately after candidate verification. Synthetic checks do not replace those live runs.
