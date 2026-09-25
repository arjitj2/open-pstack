# OpenCode worker verification

Candidate: pstack 1.6.0. Tested CLI: OpenCode 1.4.0. Date: 2026-09-25.

## Observed CLI behavior

The installed OpenCode CLI ran against a loopback inference fixture. The fixture returned deterministic tool calls; OpenCode itself executed the tools and emitted its JSON event stream. The runner's effective-config preflight ran without modification. A test-only wrapper injected the local inference backend for execution after preflight. This checks CLI integration, not authenticated provider routing or support for custom provider configuration.

| Action | Observed result |
| --- | --- |
| Read a file in a temporary Git worktree | Tool result contained the expected file content; runner accepted the final response. |
| Write a file in an isolated writer worktree | Exact expected file content was created; runner accepted the final response. |
| Attempt a write in read-only mode | No file was created. |
| Attempt a write outside the writer worktree | No file was created. |
| Inspect offered tools | Shell and subagent tools were absent. |
| Inspect effective configuration with hostile project configuration | Project configuration was excluded. |
| Inspect effective configuration with managed overrides | Managed configuration could override agent permissions and enable MCP; the runner rejects these effective configurations before inference. |

Temporary fixture directories were resolved to canonical paths. On macOS, passing a `/var` alias for a `/private/var` worktree can cause OpenCode to deny an otherwise in-worktree operation.

The implementation was checked against [OpenCode v1.4.0 source](https://github.com/anomalyco/opencode/tree/98325dcdc6a566de6b7ab42cc87af544bed3658d/packages/opencode). Tests cover final-response parsing, incomplete and malformed streams, configuration rejection, model selection, spend policy, and runner lifecycle behavior.

## Authenticated parent follow-up

Claude Code loaded candidate commit `e8889e80d505dd37c408cd0eca5f192c2642489e` through its session-local plugin loader. Its startup event identified pstack 1.6.0 at the candidate path and exposed the installed skills. The parent invoked the skill and runner with `--api-spend deny`. The resulting receipt recorded `billing-policy-blocked`, `processStarted: false`, and no executable or worker output. All 187 tracked plugin files matched the candidate commit. This proves parent discovery and the negative billing path, not successful OpenCode inference.

Codex initially discovered its existing 1.5.0 cache despite a marketplace source override. Installing through the supported marketplace commands in a dedicated test profile produced a separate 1.6.0 cache. All 187 tracked plugin files matched the candidate. A fresh authenticated parent discovered that installed skill and produced the same `billing-policy-blocked`, `processStarted: false` receipt. The personal plugin installation and model sheet were unchanged.

## Release gate still pending

Neither an authenticated OpenCode worker launched from an installed Claude parent nor one launched from an installed Codex parent has been verified with this exact candidate. OpenCode still reported zero credentials on the follow-up check. Claude reported active first-party Pro authentication and Codex reported ChatGPT authentication. No paid worker inference was performed. The pull request remains a draft until both affected parent surfaces pass the repository's installed-candidate gate.

OpenCode permissions are an application boundary, not an OS sandbox. Its path checks are lexical; a trusted worktree is required because symlinks can point outside it. Configuration preflight and execution are separate processes; trusted startup configuration must remain unchanged between them. Initial support uses built-in providers and native authentication, requires explicit API-spend approval, and excludes ambient custom providers and external auth plugins.
