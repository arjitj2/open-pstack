# Routing policy

Users inspect how a saved role resolves, while the parent owns execution and any approved fallback.

## Sub-features

- `routing-resolve`: read the configured lane chains without dispatch.
- `routing-live`: observe the exact approved descriptor and terminal outcome in a parent workflow.
- `routing-recovery`: verify saved fallback transitions with authentic terminal evidence.

## How to get to it (user POV)

Run the shipped `pstack-model-policy resolve` CLI for a named role, or invoke a parent workflow that dispatches that role. Configure assignments through `pstack:setup-pstack`.

## Driving it with the Bun CLI and parent apps

Preconditions: Launch and Doctor passed. The checkout's `AGENTS.md` contains the model sheet; if it does not, report the missing fixture instead of inventing a configuration. Read `plugins/pstack/skills/poteto-mode/references/provider-dispatch.md` before any live dispatch.

```bash
capture routing-sheet-before shasum -a 256 "$VERIFY_REPO/AGENTS.md"
capture routing-resolve "$VERIFY_TOOLS/model-policy/pstack-model-policy" resolve --sheet "$VERIFY_REPO/AGENTS.md" --role 'how explorer' --parent codex
capture routing-sheet-after shasum -a 256 "$VERIFY_REPO/AGENTS.md"
capture routing-unchanged diff -u "$VERIFY_EVIDENCE/routing-sheet-before.stdout" "$VERIFY_EVIDENCE/routing-sheet-after.stdout"
```

- **Inspect:** expect exit zero and JSON `status: resolved` with lane descriptors matching the saved `how explorer` row. Inspect authorization and route fields; successful parsing alone does not mean an executable route. `unconfigured` is an unmet precondition for this recipe.
- **Live dispatch:** run the direct How entry in [workflows](workflows.md). Compare actual native launch metadata or external runner receipt with the resolved descriptor, parent, model, effort, access mode, and saved API-spend fact. Retain the final terminal outcome and output.
- **Recovery:** follow the saved fallback-chain scenario in `tests/setup-selected-providers.md`. Require authentic terminal evidence, a visible failure/substitution notice, and any required writer inspection before the exact saved next attempt. A synthetic event passed to the `next` CLI proves a decision only, not a provider failure or parent recovery.

## Gotchas

- Resolve is read-only and launches no providers; it cannot prove authentication, spending controls, or successful execution.
- Use the [provider dispatch route rules](../../../../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#native-lanes); same-provider identity alone does not establish a native Claude lane.
- A missing fallback-policy line means quota-only recovery. Generic failure is not quota exhaustion.
- Each real external attempt needs fresh output and receipt paths. Retain failed receipts and partial work; no implicit timeout or substitution is allowed.
