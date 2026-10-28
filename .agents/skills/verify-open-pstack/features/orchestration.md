# Orchestration bookkeeping

The orchestrate CLI lets an operator persist work-unit progress and consume worker notifications across sessions.

## Sub-features

- `orch-unit`: add, update, and reopen a work unit.
- `orch-inbox`: peek without consuming, drain, and confirm the inbox is empty.
- `orch-frontier`: resolve the GitHub pull request base chain into `frontier.json`. Covered by the `orch` test suite's fake-`gh` PATH fixture against a real local git stack; that is a labeled boundary check, not live GitHub integration.
- `orch-frontier-refresh`: plan the complete discovered graph, retaining linear terminal bridges and rejecting competing active paths before persisting, retain published heads for terminal PRs, and require explicit `--allow-empty` intent before replacing active work with empty or terminal-only discovery.
- `orch-report-freshness`: read live PR state, head and checks, then match the verdict to that head before a checkpoint report.
- `orch-worker-failure`: require concrete failure evidence before cancellation and apply saved recovery policy after terminal confirmation.

## How to get to it (user POV)

Run `bun plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts` with `--store` or `ORCH_STORE`. This is the bookkeeping tool used by the Orchestrate playbook, not a substitute for running that parent workflow.

## Driving it with the Bun CLI

Preconditions: Launch and Doctor passed; `$VERIFY_SCRATCH/store` does not exist. Commands below explicitly select the disposable store.

```bash
capture orch-init bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json init
capture orch-add bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json unit add verify-smoke --track verification
capture orch-set bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json unit set verify-smoke --state complete
capture orch-get bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json unit get verify-smoke
capture orch-push bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json inbox push verifier verify-smoke complete
capture orch-peek bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json inbox drain --peek
capture orch-count-before bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json inbox count
capture orch-drain bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json inbox drain
capture orch-count-after bun "$VERIFY_TOOLS/orch/orch.ts" --store "$VERIFY_SCRATCH/store" --json inbox count
capture orch-assert python3 - <<'PY'
import json, os, pathlib
e = pathlib.Path(os.environ['VERIFY_EVIDENCE'])
def read(name):
    return json.loads((e / (name + '.stdout')).read_text())
unit = read('orch-get')
assert (unit['id'], unit['track'], unit['state']) == ('verify-smoke', 'verification', 'complete')
assert read('orch-count-before')['count'] == 1
assert read('orch-count-after')['count'] == 0
assert read('orch-peek') == read('orch-drain')
assert len(read('orch-drain')) == 1
assert read('orch-drain')[0]['unit'] == 'verify-smoke'
store = pathlib.Path(os.environ['VERIFY_SCRATCH']) / 'store'
rows = list(store.rglob('*.tsv'))
assert any('verify-smoke\tverification\tcomplete' in p.read_text() for p in rows)
print('PASS: unit persisted; peek retained one notification; drain consumed it')
PY
```

All commands must exit zero. `orch-get` is a fresh process that sees the saved state; the TSV assertion checks the stored side effect. Cleanup copies the entire store into evidence before deleting scratch. After Cleanup, require `orch-assert.stdout` and `scratch-final/store` to remain.

### Drive a bounded checkpoint from each installed parent

Install the exact candidate in separate Codex and Claude test profiles. Load `poteto-mode` and its Orchestrate playbook through each parent.
Limit the request to the checkpoint and liveness phase. Do not start a complete program or modify a public PR.

Use a disposable store, an explicit GitHub base repository and the selected stack checkout. Retain all commands and actual tool results.

1. Seed a unit and a supplied obsolete ledger verdict for a controlled PR. Label the verdict as fixture data.
2. Request a checkpoint report. Observe `gh pr view` and `gh pr checks` against the explicit base repository.
3. Observe `orch ledger check <pr> <live-head>`. An obsolete verdict must not verify the current head, even when checks pass.
4. Observe the unit update and guarded frontier recomputation from the selected stack checkout. Read both records again to confirm persistence.
5. Give the parent separate quiet and repeatedly failing process fixtures with retained handles. Require a decision from actual process and error evidence.
6. Confirm the quiet fixture remains active. Missing output, pushes or side effects alone must not trigger cancellation.
7. For a cancelled failing fixture, confirm terminal state before the postmortem or recovery. Retain its output and inbox pointer.
8. Exercise the actual model-policy CLI with a clearly labelled permission-interruption fixture. Confirm its decision without launching a recovery invocation.

Record loading evidence separately from execution evidence. A Claude `Skill` event establishes native loading. Codex registration, prompts and file reads provide indirect loading evidence.
These bounded cases do not prove full-program autonomy, real provider-agent cancellation, automatic selection or universal liveness detection.
A supplied permission state does not prove a real provider denial. An unreadable live PR or failed frontier recomputation must remain unverified.

## Gotchas

- Never omit both `--store` and `ORCH_STORE`, and never point them at an active program's store.
- `status` writes `status.md`; it is not a read-only doctor.
- Do not use `--force` to steal another process's lock.
- Frontier operations walk the GitHub PR base chain through `gh` and resolve the target from GitHub CLI checkout context, with `--base-repo <owner/name>` or `ORCH_BASE_REPO` as an override. The shipped proof is the fake-`gh` test boundary; they are outside this local smoke.
