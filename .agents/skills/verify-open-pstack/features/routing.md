# Routing policy

Users inspect how a saved role resolves, while the parent owns execution and any approved fallback.

## Sub-features

- `routing-resolve`: read the configured lane chains without dispatch.
- `claude-primary-model`: verify the main Claude assistant model independently of helper usage.
- `devin-refusal-fallback`: exclude inherited provider-side fallback from an assigned Devin lane.
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

### Claude primary-model evidence

For a change to Claude output parsing, install the candidate in both parents and invoke setup's availability phase. Use an external Claude descriptor in each parent so both exercise the parser. An exact Haiku ID without a native agent definition can exercise the external route from Claude Code. Preserve the installed tree identity, parent tool transcript, runner receipt, and independent output-file check.

Expect `stream-json` and `--verbose` in argv, `modelVerified: true`, and `modelEvidence: "provider-report"`. The reported model must come from main assistant events. A real probe establishes execution; a synthetic stream fixture establishes rejection behavior. Keep those claims separate.

From each installed parent, run the [synthetic boundary checks](../../../../tests/claude-primary-model/verify-fixtures.py) with `--runner` pointing at that parent's installed runner, `--parent` matching the parent, and a fresh `--evidence` directory. The fixture covers valid primary plus helper usage, requested model used only by a helper, usage-only output, and conflicting primary models. Rejected cases must leave no output file and preserve the terminal-success veto against replay. Failure receipts must omit the private transcript marker.

### Devin refusal-fallback isolation

Install the exact candidate in isolated Codex and Claude Code sessions. In each parent, invoke `pstack:setup-pstack` for the selected Devin availability probe only. Retain the frozen approved model sheet and use its model, effort, and API-spend policy. Do not save a new sheet.

Set `DEVIN_REFUSAL_FALLBACK` to a synthetic value in the test parent's environment. Put a transparent recorder before the real Devin executable on that session's `PATH`. The recorder must abort before invoking Devin if the variable reaches it. Otherwise, record only the variable's absence, the requested model argument, and the temporary permission configuration, then forward the original arguments and environment to the real executable. Do not record credentials or the full environment.

Have the parent launch the installed runner without unsetting the synthetic variable. Ask the read-only worker to return a unique marker from a file, then independently compare the output with that file. Retain the parent skill invocation, installed-tree identity, boundary records, receipt, and output. Expect the control to be absent from preflight and workload, the assigned model to remain pinned, and the permission configuration to retain its deny rules. Devin receipts must still report `modelEvidence: "pinned-argv"`, `modelVerified: false`, and the saved API-spend policy.

Run the Devin Bun regressions for absent, blank, and nonblank controls, unchanged parent input, and descendant inheritance at the synthetic executable boundary. Capture `devin --version` and `devin acp --help` to confirm the current CLI's fallback contract. These synthetic tests prove environment propagation. The real marker probe proves ordinary execution from each installed parent. Neither requires inducing a refusal or executing a backup model.

## Gotchas

- Resolve is read-only and launches no providers; it cannot prove authentication, spending controls, or successful execution.
- Use the [provider dispatch route rules](../../../../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#native-lanes); same-provider identity alone does not establish a native Claude lane.
- A missing fallback-policy line means quota-only recovery. Generic failure is not quota exhaustion.
- Each real external attempt needs fresh output and receipt paths. Retain failed receipts and partial work; no implicit timeout or substitution is allowed.
