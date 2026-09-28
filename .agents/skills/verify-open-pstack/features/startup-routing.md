# Startup routing

The plugin bundles a `SessionStart` hook for each parent. Claude Code loads it through `hooks/hooks.json`; Codex loads `hooks/codex-hooks.json` through the manifest's explicit `hooks` entry and skips it until the user trusts the exact hook definition in `/hooks`.

## Sub-features

- `startup-descriptor`: each host's registration selects the right sources and routes to the shared emitter.
- `startup-emission`: the shipped command prints the exact shared routing text on stdout.
- `startup-opt-in`: Codex routing is inactive until the hook is trusted; disabling a trusted hook turns it off.
- `startup-routing-only`: a routing-only setup request changes no model bytes.

## How to get to it (user POV)

Install the plugin, open `/hooks` in Codex CLI, review the pstack `SessionStart` entry, and trust it to opt in; disable the same entry to opt out. `pstack:setup-pstack` offers this as an independent optional choice on a Codex parent.

## Driving it with the parent apps and shell

Preconditions: Launch and Doctor passed. `python3 tests/test-session-start.py` covers the packaged contract in CI: it executes the real `command` strings from both descriptors through `run-hook.cmd` and asserts the exact emitted text, matcher coverage, manifest override, repeated emission, and that model files and preference state remain unchanged.

```bash
capture session-start-tests python3 "$VERIFY_REPO/tests/test-session-start.py"
```

For the installed candidate, use a dedicated Codex profile and the [installation](installation.md) candidate-identity steps first. Inspect its global and project instructions, custom developer instructions, and other hooks. Remove any standing Pstack routing mandate from this dedicated fixture before testing. Keep any model-only configuration needed to preserve the assigned providers and spending policy. Record those instruction sources with the evidence; do not paste the hook instruction into the user prompt or fixture instructions.

Use a plain request such as "Add a --format json option to this report command and cover both output formats." Seed a small local command for the task. Observe the actual installed skill read or invocation, not only a final claim that Pstack was used. Compare fresh tasks with the hook untrusted, trusted and enabled, and disabled. Keep every other instruction source identical.

- **Contract listing (works unauthenticated):** in the dedicated Codex profile, confirm the pstack `SessionStart` entry resolves to the plugin's `hooks/codex-hooks.json` and reports untrusted state. A listed `enabled` flag alongside an untrusted status means inactive until trusted, not running.
- **Injection and routing (needs an authenticated parent):** trust the hook in `/hooks`, start a fresh root task, and observe the delivered developer context and the parent's actual `pstack:poteto-mode` skill selection for a non-trivial engineering request. Exercise a pure question and a trivial edit (stay lightweight), an explicit "skip poteto-mode" instruction (overrides), and `resume`, `clear`, and `compact` re-delivery. Disable the hook and confirm a fresh task no longer routes while `$pstack:poteto-mode` still works by name.
- **Claude regression:** install the same candidate in a dedicated Claude Code profile and confirm `startup`, `clear`, and `compact` still inject the shared text and a non-trivial request still selects `pstack:poteto-mode`.
- **Model-file invariance:** snapshot `~/.codex/pstack-models.md` and the `pstack:models` block in `~/.codex/AGENTS.md` before and after enabling, disabling, and a routing-only setup request; expect byte-identical files and no probes.

## Gotchas

- Trust is recorded against the exact hook definition hash; a changed descriptor or command marks the hook for review again. Do not treat a previously trusted install as proof for the current candidate.
- The hook has no persistent session cache: `compact` (including mid-turn auto-compaction) must re-deliver the text.
- `--dangerously-bypass-hook-trust` runs untrusted hooks for one invocation; it is a deliberate bypass, not normal opt-in evidence.
- `commandWindows` is a documented schema field, but Windows execution of the packaged command is unverified until exercised on a real Windows host; record it separately.
- The dedicated Codex test profile may lack authentication. Contract listing and local emission still count; skill selection, context injection, and override behavior then remain unverified and the pull request stays a draft.

Disabling a hook cannot retract context already delivered to an open chat. Test opt-out in a fresh chat and test a direct user override separately. Record unavailable lifecycle actions as unverified instead of substituting synthetic event input.
