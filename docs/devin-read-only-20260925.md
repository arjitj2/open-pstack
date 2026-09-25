# Devin read-only execution investigation

Tracks [issue 30](https://github.com/arjitj2/open-pstack/issues/30). Candidate version 1.5.1 passed installed-parent validation. It remains unmerged and unreleased.

## Reproduced behavior

The installed pstack 1.5.0 runner used Devin CLI 3000.11.3, revision `9c803229faa4`, with `devin:swe-2@high`, read-only access, and API spending denied. Every call omitted a runtime timeout.

A request to read the first README heading completed. A request to inspect the external-worker subsystem exited with child status zero after about ten seconds, but the ATIF export ended with `exec`, `exec`, and `read` tool calls. The runner correctly returned `malformed-output` and exit 65. Explicitly requesting `exec` to run `pwd` produced the same nonfinal-export failure.

Adding a prompt prefix that prohibited shell execution did not fix the original assignment. Its export ended with `exec`, `read`, `read`, and `find_file_by_name`. That proposed fix was discarded.

The adapter denied `exec` through permission rules but left it available for model selection. Devin terminated the noninteractive turn when the selected tool was denied. The installed CLI changelog documents the separate `disabled_tools` configuration field under v3000.10.21, September 10, 2026, at `share/devin/docs/changelog/stable.mdx`. The candidate disables `exec` for readers and preserves every existing permission denial. Writers retain sandboxed execution.

## Adapter boundary

Read-only is the shared `AccessMode` already used by every provider. `commands.ts` maps it to Codex's read-only sandbox, Claude's plan mode and restricted tools, Grok's plan mode and read-only sandbox, and Cursor's ask mode plus shell/write denials. `devin.ts` owns Devin's temporary configuration and translates the same mode into supported CLI settings.

This fix makes Devin's advertised tools agree with its existing permissions. It does not add a new mode, alter parent routing, relax permission enforcement, or change completion parsing. Devin's existing read-only contract remains file inspection and search, without shell execution.

## Evidence handling

The first heading and explicit-shell probes used the installed runner directly. The original exploration, guidance experiment, and configuration experiment used the same installed runner through a transparent executable observer. The observer forwarded arguments and exit status to the real Devin binary, then retained only each ATIF step's source and tool names before the runner removed its private export. It retained no messages, reasoning, tool arguments, observations, credentials, or system context. The configuration experiment additionally inserted only `disabled_tools: ["exec"]` into the runner-owned temporary config.

The assigned exploration prompt asked for an architectural explanation of descriptor parsing, setup selection, dispatch, private configuration, permissions, billing preflight, output parsing, terminal classification, model evidence, and policy normalization. It required reading AGENTS.md and UPSTREAM.md and prohibited edits or delegation. It was the same prompt used by the failed OpenCode investigation, with a separate working directory.

## Configuration experiment result

With only `disabled_tools: ["exec"]` added to the temporary configuration, the same original exploration completed in 374.393 seconds. Its final answer contained 13,916 characters. The sanitized export had 22 steps, 40 `read` calls, five `find_file_by_name` calls, six `grep` calls, one `skill` call, and no `exec` calls. The final agent step contained no tool calls. The runner returned `complete` and exit zero. This was an installed 1.5.0 runner with an instrumented configuration, not a 1.5.1 parent installation.

The 1.5.1 checkout runner then completed a smaller repository-discovery request in 18.385 seconds. Its final answer correctly identified the README heading and all 19 runner-directory files. The observer captured tool names without modifying the candidate configuration.

The 1.5.1 checkout writer completed in 13.352 seconds using sandboxed `exec`. A separate read verified that its `proof.txt` contained exactly `DEVIN_WRITER_OK` and a newline.

## Separate writer transport failure

The earlier isolated writer ran for about three and a half hours before cancellation. Its log contains inference stream timeouts, connection resets, and later stream-creation failures. Its progress output shows successful file inspection before those failures. This evidence does not establish a writer permission or configuration defect. No writer transport workaround, runtime timeout, model fallback, or permission expansion is included.

## Verification status

The full suite passed with 430 Bun tests and zero failures. Strict typechecking, static invariants, 26 maintenance tests, and Claude plugin validation passed. The test regression is committed before the configuration change. The local default Node binary had a missing Homebrew simdjson library; tests used Node 24 on PATH and typechecking used Bun.

The exact candidate package passed in both real parents on September 25, 2026. Candidate commit `bb27ff77139ef83bf6bd86470518d9bcbf7b28ac` has plugin tree `dc2d8a00f45118752e1e38433aed2dc7e1836874`. All 185 package files matched before and after execution in both installations.

- Claude Code 2.1.282 loaded 1.5.1 through its supported session-local `--plugin-dir`, invoked `pstack:how`, and dispatched the candidate runner. The original exploration completed in 313.572 seconds with a 15,471-character final answer.
- Codex CLI 0.154.0 used a separately named local marketplace installation of 1.5.1. Its parent read the candidate's How skill and dispatch reference, then ran that installed runner. The same exploration completed in 317.738 seconds with a 15,555-character final answer. The session skill catalog still named the normal 1.5.0 installation, so this validates the explicitly selected installed candidate runner, not automatic skill-catalog refresh.

Both parents read their completed receipts and worker output before returning final answers. Both receipts record `complete`, exit zero, `apiSpend: deny`, and `timeoutMs: null`. Model evidence remains pinned argv, not a provider-reported identity. No executable observer or configuration shim was used in these parent tests.

The first Claude attempt could not authenticate because its OAuth session had expired. Its existing browser login refreshed the session. The first authenticated parent exited immediately after starting its background worker, which cancelled that worker. That receipt remains preserved. The successful retry kept the parent active until the worker finished. Neither failed attempt counts as a pass.

The temporary Codex plugin and marketplace registration were removed after validation. Hash checks confirmed the normal installed package and saved model files were unchanged. Claude's candidate was session-local. No merge, tag, or release was performed. [Sanitized parent evidence](devin-parent-validation-20260925.json) records the successful attempts and package identity.

Sanitized runner outcomes are recorded in [devin-read-only-20260925.json](devin-read-only-20260925.json).
