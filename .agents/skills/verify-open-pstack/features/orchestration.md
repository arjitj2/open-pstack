# Orchestration bookkeeping

The orchestrate CLI lets an operator persist work-unit progress and consume worker notifications across sessions.

## Sub-features

- `orch-unit`: add, update, and reopen a work unit.
- `orch-inbox`: peek without consuming, drain, and confirm the inbox is empty.

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

## Gotchas

- Never omit both `--store` and `ORCH_STORE`, and never point them at an active program's store.
- `status` writes `status.md`; it is not a read-only doctor.
- Do not use `--force` to steal another process's lock.
- Frontier operations need Graphite/GitHub and are outside this local smoke.
