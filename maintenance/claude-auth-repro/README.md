# Claude auth diagnosis on 2.1.282

The auth-status refresh-loss report did not reproduce in 18 isolated trials on macOS. A different reported failure did reproduce: a primary credential record with blank token fields hides a valid fallback file. Neither result establishes the cause of any particular user's recurring logouts. Track the unresolved diagnosis in [issue 38](https://github.com/arjitj2/open-pstack/issues/38).

## Observed behavior

The [recorded matrix](results-2.1.282.json) uses the installed native Claude 2.1.282 binary, SHA256 `fcfd837103965c64de34a6b9b94370d77a347ea71819715a27d5f0ef01775ea4`. All credentials, account metadata, and network responses are fabricated. The CLI itself is unchanged.

| Action | Fixture | Runs | Observation |
| --- | --- | --- | --- |
| `auth status --json` | Expired by 60 seconds, expires in 120 seconds, or expires in 3600 seconds; mock delays of 0, 0.5, or 3 seconds | 18 | Exit 0, first-party subscription login reported, no refresh request reached the mock |
| Print control | Expired token; mock delays of 0, 0.5, and 3 seconds | 3 | A refresh reached the mock and its replacement was saved before exit |
| `auth status --json` | Primary record has blank access and refresh fields; fallback contains an unexpired credential | 1 | Exit 1, `loggedIn: false`, `authMethod: none` |
| `auth status --json` | Primary record is empty bytes or absent; same valid fallback | 2 | Exit 0, `loggedIn: true`, `authMethod: claude.ai` |
| `auth status --json` | Fabricated API key and subscription credential both present | 1 | Reports `claude.ai` and `firstParty` alongside `apiKeySource: ANTHROPIC_API_KEY` |

The print control terminates naturally after the local mock rejects inference with HTTP 400. That exit is expected. It proves refresh persistence through the mock storage boundary, not a successful model call. No remote inference occurs.

The API-key observation explains why Pstack's environment guard must remain alongside its method/provider check. Auth-status fields alone do not exclude an ambient API credential. The existing runner tests cover that rejection before provider startup.

## Source evidence and limits

[Upstream issue 95822](https://github.com/anthropics/claude-code/issues/95822) reports that short-lived commands can abandon startup refreshes. Inspection of the installed 2.1.282 executable found an unawaited OAuth population call during init and a direct process exit in the auth-status handler. That structure motivates the test. It does not prove that this invocation reaches a destructive refresh. In this matrix, it did not.

[Upstream issue 93051](https://github.com/anthropics/claude-code/issues/93051) describes a zeroed primary record hiding a fallback credential. The fabricated zeroed record reproduces that selection behavior. The test does not reproduce the event that originally zeroed a record, including lock, sleep, refresh rejection, or concurrent-writer conditions.

[Claude 2.1.281 release notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.281) announce a fix for credential writes deleting entries while macOS Keychain is locked. The tested binary is newer. This fixture does not exercise actual Keychain locking.

Storage process timing, OS services, and network behavior differ under the fixture. The mock does not emulate Keychain locks, access controls, or system prompts. A passing control proves that the fixture can refresh and persist; absence of a refresh in auth-status does not disprove the upstream report under other conditions.

No Pstack mitigation follows from these results. Removing the preflight loses billing evidence. A delay or retry is unsupported by this reproduction. Reading, repairing, or reconciling credentials would add a token manager. A required setup-token would change the normal login experience. Pstack's packaged tree and subscription guard remain unchanged.

## Run the isolated fixture

Run from a checkout on macOS with Python 3, Bash, OpenSSL, and `sandbox-exec`. Pass an explicit installed Claude executable. Choose a new output directory for every matrix.

```sh
python3 maintenance/claude-auth-repro/verify.py \
  --claude /absolute/path/to/claude \
  --output /absolute/path/to/new-evidence-directory
```

The matrix writes raw stdout and stderr plus a compact `results.json`. It fails if the fixture cannot run, auth output is malformed, or a print control cannot save its replacement. Other outcomes remain observations so a newer CLI can reproduce or fix a failure without the harness hiding it.

For one case:

```sh
python3 maintenance/claude-auth-repro/reproduce.py \
  --claude /absolute/path/to/claude \
  --store zeroed --expires-in 3600
```

Each case uses a new temporary home, configuration directory, and file-backed primary credential store. A mock `security` executable accepts only the generated fixture account and service. It never forwards to the system executable. The local OAuth mock consumes each fabricated refresh token once and rejects reuse.

The sandbox denies the system `security` executable, all Mach service lookups, Keychains paths, and the real home except for reading the selected binary. Network access is restricted to the exact loopback proxy port. The proxy has no forwarding code. It answers only mock OAuth requests and rejects inference. The certificate is trusted only through the child environment; no global proxy, certificate trust, authentication, or settings are changed.

Before Claude starts, the same sandbox must read a normal fabricated canary and fail to read a fabricated `Keychains/canary` file. No real Keychain content is used to test denial. The test retains temporary files and debug logs for inspection; it does not perform system credential cleanup.

## Maintenance verification

The final matrix ran on September 25, 2026. All 25 cases passed the fixture's isolation preconditions. The three refresh controls saved replacements; the other outcomes appear in the table above.

The packaged plugin tree is unchanged from the branch base. This is maintenance tooling, so there is no changed installed-parent behavior to validate and no version bump. The checkout CLI doctor, strict typecheck, static invariants, manifest parsing, and sandboxed Claude plugin validation passed. The final Bun run passed 489 tests with zero failures. An earlier concurrent run failed one Grok deadline timing test; a full rerun passed after the matrix completed.

The machine's default Node executable failed to load a Homebrew shared library. Verification used Codex's bundled Node through a command-local PATH. No system runtime configuration was changed.
