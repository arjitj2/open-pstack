# Claude auth-status refresh loss

The draft 1.7.1 candidate omits Claude's separate authentication-status command from worker dispatch and setup on every platform. Authentication happens in the actual task. The runner retains `apiSpend`, known API environment guards, and `--setting-sources ''` under `deny`. Claude receipts explicitly record preflight as `not-run` and billing route as unverified. Other providers keep their checks.

This deliberately removes the assertion that Claude is using subscription authentication. Saved funding remains user-reported, and managed configuration or other unsupported routes can still affect billing. It is not a zero-charge guarantee. The candidate adds no network wrapper, credential inspection, or credential repair.

The decision is tracked in [issue 38](https://github.com/arjitj2/open-pstack/issues/38) and [draft PR 41](https://github.com/arjitj2/open-pstack/pull/41), linked to [upstream issue 95822](https://github.com/anthropics/claude-code/issues/95822). Revisit the exception only when a supported, side-effect-free check can establish the billing route without risking refresh persistence. Verify that behavior with the reproduction and installed-parent tests before restoring a check.

## Reproduction and evidence

Native Claude 2.1.282 reproduces the complete logout sequence through the former `--setting-sources '' auth status --json` command. A fabricated expired credential, `migrationVersion: 0`, and 1 MiB of synthetic configuration padding trigger startup refresh. Status consumes a one-use refresh token and exits before saving its replacement. The following print invocation gets `invalid_grant`, blanks the primary credential, and a final status reports logged out.

The [original cold-config matrix](refresh-loss-2.1.282.json) reproduces this at mock response delays of 0, 0.5, and 3 seconds. Its offline-status controls preserve subsequent authentication. These controls describe an investigated alternative, not the shipped fix: the network wrapper was removed because skipping the hazardous command avoids that extra mechanism and its nested-sandbox limitation.

The [revised runner matrix](runner-without-status-2.1.282.json) executes the actual candidate runner with the unchanged native Claude binary. At all three response delays, the task saves the replacement token; no separate status command runs. The receipt has empty preflight argv, `not-run`, and explicit unverified billing evidence. An additional fabricated API-key case blocks before Claude starts and sends no refresh request.

The mock rejects inference with HTTP 400. These runs prove refresh persistence and runner behavior, not successful model inference. No remote inference occurs. Binary SHA256: `fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4`.

The [earlier warm-config matrix](results-2.1.282.json) remains negative evidence: 18 status calls with migrations complete sent no refresh request, while three print controls saved replacements. That fixture missed the startup trigger. It also showed that blank primary token fields hide a valid fallback, whereas absent records or empty bytes permit fallback; [upstream issue 93051](https://github.com/anthropics/claude-code/issues/93051) describes that behavior.

These synthetic conditions establish a failure mechanism, not the cause of a particular user's logout. They do not establish the user's configuration size or migration state, or emulate actual Keychain locks, sleep, and every concurrent-writer condition. An investigated stream-json process also was not a persistence barrier: EOF after initialization could still abandon refresh. That alternative is not implemented.

## Run the isolated fixture

On macOS, use Python 3, Bash, OpenSSL, Bun, and `sandbox-exec`. Pass explicit executables:

```sh
python3 maintenance/claude-auth-repro/reproduce.py \
  --claude /absolute/path/to/claude \
  --runner plugins/pstack/skills/poteto-mode/scripts/runner/pstack-runner \
  --bun /absolute/path/to/bun \
  --cold-config --delay 3
```

Repeat with delays 0 and 0.5; add `--route api` for the ambient-key blocking control. Output includes the runner receipt, mock events, and whether the replacement was saved. To repeat the historical status/offline-status comparison:

```sh
python3 maintenance/claude-auth-repro/verify.py \
  --claude /absolute/path/to/claude \
  --refresh-loss --output /absolute/path/to/new-evidence-directory
```

Omit `--refresh-loss` for the earlier warm-config matrix. Raw stdout and stderr remain in the evidence directory. Historical original-command outcomes remain observations so a future upstream fix is visible.

Every case uses a temporary home, configuration directory, and fabricated file-backed primary store. A mock `security` executable accepts only the fabricated account and service; it never forwards to system security. A local OAuth mock consumes each fabricated refresh token once and rejects reuse.

The research sandbox denies the system security executable, all Mach service lookups, Keychains paths, and the real home except for reading the explicitly selected Claude and Bun binaries. It allows network access only to the exact loopback mock port. The proxy cannot forward requests. Certificate trust is limited to the child environment. A normal fabricated canary must be readable and a fabricated `Keychains/canary` must be denied before the runner starts. No real Keychain content is read to test denial. Temporary files are retained; no system authentication or settings are changed or cleaned up.

## Validation and release gate

On September 25, 2026, all 490 Bun tests passed, including regression tests that reject unexpected Claude status calls, preserve task networking, and cover cancellation, invocation auth failure, and ambient API blocking. The new regressions failed before the implementation. Strict typecheck, static invariants, documentation checks, and sandboxed plugin validation also passed.

Version 1.7.1 remains a draft candidate. Neither the installed Claude-parent nor installed Codex-parent surface has passed the exact-candidate gate. The native runner fixture proves only that CLI boundary; it does not replace parent skill discovery, setup decisions, or live model execution. No merge, release, or rollout is authorized before those gates pass. Validation uses a command-local bundled Node path because the default Homebrew Node is broken; no global runtime configuration changes were made.
