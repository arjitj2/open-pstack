# Claude preflight refresh loss on macOS

Claude 2.1.282 reproduces the complete logout sequence through Pstack's exact `--setting-sources '' auth status --json` command when the fabricated configuration needs startup migrations. The status process consumes a one-use refresh token and exits before persisting its replacement. The following print invocation receives `invalid_grant`, blanks the primary credential record, and a final status check reports `loggedIn: false`.

The draft 1.7.1 candidate runs only the macOS status preflight under `/usr/bin/sandbox-exec` with outbound network access denied. It retains the existing authentication JSON, subscription-only verdict, ambient API-credential checks, and normal network access for the model invocation. Pstack does not read, copy, reconcile, or repair credentials. Track the work in [issue 38](https://github.com/arjitj2/open-pstack/issues/38) and [draft PR 41](https://github.com/arjitj2/open-pstack/pull/41).

## Reproduction and controls

The [cold-config matrix](refresh-loss-2.1.282.json) uses the unchanged installed native Claude 2.1.282 binary, SHA256 `fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4`. All credentials, account metadata, and network responses are fabricated. Each case starts with an expired credential, `migrationVersion: 0`, and 1 MiB of fabricated configuration padding to make the startup race observable.

| Preflight | Mock refresh delay | Subsequent task | Final authentication |
| --- | --- | --- | --- |
| Original command | 0, 0.5, 3 seconds | Reuses the consumed token; primary tokens become blank | Logged out in all three cases |
| Outbound network denied | 0, 0.5, 3 seconds | Refreshes the original token and saves its replacement | Logged in in all three cases |

The protected status checks left the original fabricated token pair intact and sent no refresh request. Their following tasks saved replacement tokens. The mock then rejects inference with HTTP 400, so print exits nonzero by design. This proves refresh persistence and authentication state, not successful model inference. No remote inference occurs.

The [earlier warm-config matrix](results-2.1.282.json) remains useful negative evidence: 18 status calls with migrations already complete sent no refresh request, while three print controls saved replacements. That fixture omitted the triggering startup work. It also established that a primary JSON record with blank token fields hides a valid fallback, whereas an absent record or empty bytes permits fallback. The newer sequence reproduces how refresh rejection can produce those blank fields.

These synthetic timings establish a failure mechanism. They do not establish which startup condition caused a particular real-world logout or show that a user's configuration has the fixture's size or migration state.

## Candidate and limits

The candidate wraps the resolved absolute Claude executable with this macOS policy:

```text
(version 1)(allow default)(deny network-outbound)
```

Only preflight receives the wrapper. Its actual argv appears in the receipt. Missing sandbox support, profile rejection, and launch failure stop the lane; there is no unprotected retry. macOS rejects nested sandbox application, so a parent already running inside a sandbox can lose Claude-lane availability. That limitation is deliberate fail-closed behavior and requires installed-parent validation. Other operating systems retain their existing preflight.

The fixture combines the candidate's network restriction with its stricter credential-isolation policy in one sandbox. It removes the mock loopback exception for preflight. A broad deny appended alongside that specific allow would not test the candidate restriction. Nested sandbox application cannot be used to combine the two policies on this host.

Two runner regression tests separately exercise the actual candidate wrapper using a fake provider: its preflight cannot reach a local HTTP server while its task can, and a refused nested sandbox never starts the task. Existing billing tests still reject API credentials, alternate routes, missing auth fields, and non-subscription methods.

Managed remote-settings behavior remains unverified: an offline status check and a later online task could observe different policy state. The existing setting-source and authentication checks remain intact, but these fixtures do not prove billing equivalence for changing enterprise policy. Neither installed Claude-parent nor installed Codex-parent behavior has passed the exact-candidate gate. The PR stays draft; this candidate is not merged, released, or rolled out.

The alternative persistent stream-json prototype preserved refresh when it proceeded to a task, but initialization was not a persistence barrier: EOF and `get_usage` could still abandon refresh. `--max-turns 0` still attempted inference. These alternatives are not part of the candidate.

[Upstream issue 95822](https://github.com/anthropics/claude-code/issues/95822) reports short-command refresh abandonment. Installed-source inspection found an unawaited startup OAuth population call and a direct process exit in auth-status; runtime evidence above confirms their interaction. [Issue 93051](https://github.com/anthropics/claude-code/issues/93051) describes the blank-record fallback behavior. The fixture does not emulate actual Keychain locks, prompts, sleep, or every concurrent-writer condition.

## Run the isolated fixture

Run on macOS with Python 3, Bash, OpenSSL, and `sandbox-exec`. Pass an explicit installed Claude executable and a new evidence directory:

```sh
python3 maintenance/claude-auth-repro/verify.py \
  --claude /absolute/path/to/claude \
  --refresh-loss \
  --output /absolute/path/to/new-evidence-directory
```

Omit `--refresh-loss` to run the earlier 25-case warm-config matrix. Raw stdout and stderr stay in the evidence directory; `results.json` contains compact observations. A protected case fails verification if preflight consumes a refresh token, changes the original token pair, or prevents the following task from refreshing and remaining logged in. Original-command outcomes remain observations so a future upstream fix is not hidden.

For one protected sequence:

```sh
python3 maintenance/claude-auth-repro/reproduce.py \
  --claude /absolute/path/to/claude \
  --cold-config --offline-preflight --follow-print --delay 3
```

Each case uses a new temporary home, configuration directory, and file-backed primary store. A mock `security` executable accepts only the fabricated fixture account and service and never forwards to the system executable. The local OAuth mock consumes each fabricated refresh token once and rejects reuse.

The research sandbox denies the system `security` executable, all Mach service lookups, Keychains paths, and the real home except for reading the selected binary. Network access is restricted to the exact loopback mock port, or denied entirely during protected preflight. The proxy has no forwarding code. The certificate is trusted only through the child environment. No global proxy, certificate trust, authentication, or settings are changed.

Before Claude starts, the same research sandbox must read a normal fabricated canary and fail to read a fabricated `Keychains/canary`. No real Keychain content is used to test denial. Temporary files and debug logs are retained. There is no system credential cleanup.

## Verification record

The six-case cold matrix ran on September 25, 2026. All six cases passed the credential-isolation preconditions. All three original sequences ended logged out; all three protected sequences preserved subsequent authentication. Runner regression tests failed before the implementation and passed after it, alongside the subscription-only guard tests.

Packaged behavior changes from 1.7.0 to the draft 1.7.1 candidate. All 491 Bun tests, strict typecheck, static invariants, documentation checks, and sandboxed Claude plugin validation passed. Outstanding parent-validation evidence is recorded in the PR. Verification uses Codex's bundled Node through a command-local PATH because the default Homebrew Node cannot load a shared library. No system runtime configuration was changed.
