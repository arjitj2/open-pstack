# Devin read-only execution investigation

Tracks [issue 30](https://github.com/arjitj2/open-pstack/issues/30). Candidate version 1.5.1 is not approved for release.

## Reproduced behavior

The installed pstack 1.5.0 runner used Devin CLI 3000.11.3, revision `9c803229faa4`, with `devin:swe-2@high`, read-only access, and API spending denied. Every call omitted a runtime timeout.

A request to read the first README heading completed. A request to inspect the external-worker subsystem exited with child status zero after about ten seconds, but the ATIF export ended with `exec`, `exec`, and `read` tool calls. The runner correctly returned `malformed-output` and exit 65. Explicitly requesting `exec` to run `pwd` produced the same nonfinal-export failure.

Adding a prompt prefix that prohibited shell execution did not fix the original assignment. Its export ended with `exec`, `read`, `read`, and `find_file_by_name`. That proposed fix was discarded.

The adapter denied `exec` through permission rules but left it available for model selection. Devin terminated the noninteractive turn when the selected tool was denied. The installed CLI changelog documents the separate `disabled_tools` configuration field under v3000.10.21, September 10, 2026, at `share/devin/docs/changelog/stable.mdx`. The candidate disables `exec` for readers and preserves every existing permission denial. Writers retain sandboxed execution.

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

Installed-candidate validation from both Codex and Claude Code remains outstanding. Keep the pull request in draft. No personal plugin installation or saved model sheet was changed. No merge, tag, or release was performed.

Sanitized runner outcomes are recorded in [devin-read-only-20260925.json](devin-read-only-20260925.json).
