# OpenCode worker verification

Candidate: pstack 1.7.0. Tested CLI: OpenCode 1.18.32. Date: 2026-09-25.

Verified plugin tree: `0954134834bfa7a818916f9cf56ff01aeebb4af8` (`plugins/pstack`). All 189 tracked plugin files were compared before and after the parent runs. Both installations contained these exact bytes.

## Authenticated parent results

Each parent discovered the candidate skill, read its provider-dispatch instructions, and launched one `openai/gpt-6-sol@default` worker with explicit spending approval. The worker read `input.txt`, wrote identical contents to `output.txt`, and returned the fixture content. The parent did not create either the worker output file or its answer file. Receipt contents, file bytes, and the returned answer were independently checked after both parent sessions exited.

| Parent surface | Candidate loading | Observed result |
| --- | --- | --- |
| Claude Code print session | Supported session-local `--plugin-dir`; startup event identified pstack 1.7.0 and exposed its skills | `complete`, exact file and answer matches, 15.738 seconds |
| Codex CLI exec session | Supported marketplace installation in a dedicated test profile; fresh session discovered the installed 1.7.0 skill | `complete`, exact file and answer matches, 12.837 seconds |

Both receipts pin `openai/gpt-6-sol`, record `pinned-argv` model evidence, and report zero provider cost. The event stream does not independently report model identity. No runner timeout or alternate-model fallback was used. Claude remained alive until its worker settled. Personal plugin installations and model sheets were unchanged.

Receipts and parent transcripts are retained locally; the tables above record the observed outcomes without publishing personal filesystem paths. The dedicated Codex profile's temporary authentication link was removed after verification.

## Permission and protocol checks

The installed 1.18.32 CLI accepted the adapter configuration. A separate effective-agent check enabled only read/glob/grep for read-only mode and retained the explicit external-directory denies. Source review used [release commit 545f51d](https://github.com/anomalyco/opencode/tree/545f51d26cc39a907d2867492d498d9607ea5fa4/packages/opencode).

A loopback inference fixture exercised the real CLI's tools and event stream. The unmodified effective-config preflight ran first; a test-only wrapper injected the local inference backend during execution. This fixture is distinct from the authenticated parent results above.

| Fixture action | Observed result |
| --- | --- |
| Read a worktree file | Tool result contained the expected bytes; final response accepted. |
| Write a worktree file | Exact expected contents created; final response accepted. |
| Attempt a write in read-only mode | No file created. |
| Attempt a direct write outside the writer worktree | No file created. |
| Inspect offered tools | Shell and recursive dispatch absent. |

All four transcripts completed. Earlier hostile-config checks established that project configuration was excluded and incompatible managed permissions or enabled MCP entries were rejected before inference. Tests cover version rejection, model selection, billing denial, configuration rejection, cancellation, explicit deadlines, malformed streams, and final-response extraction. The final candidate passed 489 Bun tests, strict typechecks, static invariants, and plugin validation.

## Upgrade requirement and earlier failures

OpenCode 1.4.0 advertised models that the account rejected. Four explicitly approved attempts with `gpt-5.3-codex` and `gpt-5.4` produced service errors and no output fixture. The initial Claude parent also ended while its worker was backgrounded; its receipt recorded cancellation. Those attempts did not qualify as success-path validation.

OpenCode [1.18.29 fixed GPT-6 OAuth model discovery](https://github.com/anomalyco/opencode/releases/tag/v1.18.29). Upgrading to 1.18.32 preserved the OAuth login, exposed current models, and enabled the successful checks above. The runner now requires stable OpenCode 1.18.29 or newer and gives an upgrade message before configuration inspection or inference. This version check retains the shared cancellation/deadline behavior; billing denial still prevents any CLI startup.

OpenCode permissions are application checks, not an OS sandbox. Its lexical paths can follow symlinks outside a worktree. Use trusted worktrees and startup configuration. Preflight and execution are separate processes; configuration must remain unchanged between them. Initial support uses built-in providers and native authentication, requires explicit spending approval, and excludes ambient custom providers and external auth plugins.

## Review corrections

The final 1.7.0 candidate includes main’s Antigravity support and Devin read-only fix. Copilot’s two findings were reproduced before fixing them. Effective-config validation now also requires `compaction.prune === false`, and the standalone plan checker accepts exact OpenCode descriptors including nested paths and Bedrock colons. Invalid descriptor forms still fail. Both authenticated parent checks above were repeated after these fixes against the recorded plugin tree.
