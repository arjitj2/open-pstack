# Provider dispatch

pstack model choices are provider-qualified descriptors:

```text
<provider>:<model>@<effort>
```

## Model matrix

| Family | Upstream pstack choice | Provider | Model | Default effort | Selectable efforts | Claude-native agent stem | First-run active |
|---|---|---|---|---|---|---|---|
| fable | - | claude | fable | max | low medium high xhigh max | fable | no |
| sol | gpt-5.6-sol-max | codex | gpt-5.6-sol | max | low medium high xhigh max | - | yes |
| grok | grok-4.7-xhigh-fast | grok | grok-4.7 | xhigh | low medium high xhigh max | - | yes |
| opus | claude-opus-5-5-max | claude | opus | max | low medium high xhigh max | opus | yes |
| sonnet | - | claude | sonnet | high | low medium high xhigh max | sonnet | no |
| astra | - | codex | gpt-6-astra | high | low medium high xhigh max | - | no |
| luna | - | codex | gpt-5.6-luna | high | low medium high xhigh max | - | no |
| terra | - | codex | gpt-5.6-terra | high | low medium high xhigh max | - | no |

For the model matrix, the allowed effort universe is exactly `low`, `medium`, `high`, `xhigh`, `max`. A `-` in Upstream pstack choice means the portable build added that family. First run activates only rows whose First-run active cell is `yes`, in matrix order, and uses each active row's Default effort. Later runs derive the active family set from the non-alias descriptors in the normalized final role map. No separate active-family setting exists. A Claude-native agent stem of `-` means the family has no Claude-native agent. Otherwise the shipped agent name is `pstack-<stem>-<effort>`.

The matrix records recommended defaults and effort guidance. It is not an allowlist. Use the provider's current model listing where available and probe the exact selected model and effort. A listing alone does not prove account access. Claude and Codex models can be checked through the current host's capabilities and actual execution without matching a matrix row.

A runner receipt keeps the requested model in `model` and the provider's report in `reportedModel`. For the legacy rolling aliases `fable`, `opus`, and `sonnet`, verification requires a numeric revision from the same family. Other IDs can match the provider report directly or with a hyphenated revision suffix, and new aliases can match a numeric `claude-<requested-family>-<revision>` report without a package update. A report naming a different family fails verification. Exact IDs outside the legacy migration rules pass through unchanged.

## Optional Devin models

Devin is an external provider from either parent, not a parent harness. These opt-in families do not change the three-model default panel.

| Family | Provider | Model | Default effort | Selectable efforts | CLI model UID |
|---|---|---|---|---|---|
| swe-2 | devin | swe-2 | high | medium high max | swe-2-<effort> |
| swe-1.6 | devin | swe-1.6 | default | default | swe-1-6 |

Use descriptors such as `devin:swe-2@high` or `devin:swe-1.6@default`. `default` records that SWE-1.6 has no selectable effort; it is also used for Cursor slugs without a separate effort flag. An explicit or stored SWE-2 descriptor with unsupported `low` or `xhigh` is invalid. Never clamp it during dispatch or after a failed probe. Setup may propose a supported effort below a user-requested budget ceiling for an already valid descriptor, but must show the change and obtain confirmation before saving. The runner maps these legacy descriptors to the exact CLI UID shown above.

For any other selected model, save `devin:<uid>@default`. Discover exact UIDs in `families[].variants[].model_uid` from `devin models list --format json`. The runner passes the selected UID to `--model` unchanged. Effort is part of that UID, so a non-`default` effort on an unmapped ID is invalid. `devin:swe-2@default` passes `swe-2` itself. Do not guess variant suffixes. If discovery is unavailable or its output format changes, retain an explicitly selected ID and let the probe establish whether it runs.

Install and sign in to [Devin CLI](https://docs.devin.ai/cli). Inspect `devin models list --format json` and probe each selected pair: listing a model does not prove the account can execute it. An upgrade-required response is an unavailable-model failure, never permission to substitute another model.

The runner uses `--print` and a private temporary `--config` file, deleted after completion or failure. It disables recursive subagents and imports from other tools, and denies MCP and fetch calls. Read-only lanes deny edit, write, and shell execution; use them for file inspection, not test execution. They also disable `exec` so the model cannot select the denied tool. Writer lanes leave `exec` enabled. Writer lanes use `--sandbox` in the dedicated worktree and perform edits and tests through sandboxed `exec`. Direct `edit`/`write` tools are denied in both modes: they run outside Devin's OS sandbox and can require interactive confirmation even with scoped write grants. The adapter prefixes each writer task with these execution constraints in a private prompt copy, preserving the assigned prompt and its receipt path. File-tool-only prompts are unsupported. Devin's own project configuration, rules, plugins, and hooks can still load; this is not a clean-room execution environment. Do not assign an untrusted checkout or rely on this adapter to isolate startup hooks. Verify effective permission behavior in the target CLI before release.

The temporary config marks shell onboarding complete. The runner requests a private ATIF-v1.7 conversation export and accepts only a final agent step with a nonempty message and no tool calls. A progress message followed by denied or pending tools cannot count as completion, even if Devin exits zero without stderr. Only the final message is returned; system context, reasoning, and tool observations are never copied into output or receipts. The export directory is private and removed after every outcome. The adapter continues to use `pinned-argv` model evidence rather than treating the export's display model name as verified identity; model-report, session, usage, and cost fields remain null.

## Optional Cursor models

Cursor is an external provider from both parents. Install and authenticate `cursor-agent`, run `cursor-agent models`, and choose an exact available slug as `cursor:<slug>@default` (for example, `cursor:composer-2.5@default` when listed). `default` means no separate effort flag is available; select any reasoning variant by its exact model slug. Do not translate Claude/Codex/Grok slugs into Cursor slugs or use Cursor's `auto` selector. Model availability and subscription limits remain Cursor's responsibility. Adding a Cursor lane does not alter the three baseline families.

## Optional OpenCode models

OpenCode is an external worker provider from both parents. It is not a parent app in this distribution. Install `opencode`, authenticate through its native CLI, and select an exact ID from `opencode models`. Save `opencode:<provider>/<model>@default`. Additional model path segments are preserved. `auto`, missing or empty segments, and non-default efforts are invalid. The runner omits `--variant` because OpenCode does not reject every unavailable variant. The three baseline families and existing assignments do not change.

This route requires explicit `apiSpend: approved` authorization. Both `deny` and omitted legacy authorization return `billing-policy-blocked` before CLI startup. OpenCode can route through several upstream providers and credentials, and the adapter cannot prove subscription-only billing. An OAuth login or advertised model does not establish a free route. Never read or copy credential files or infer spending permission. Setup probes each selected exact model after authorization.

The initial adapter supports built-in providers and native OpenCode authentication. It excludes ambient custom provider definitions and external auth plugins. Each attempt creates an exclusive `<receipt>.opencode-config` directory with mode 0700 and a config file with mode 0600. The runner isolates `XDG_CONFIG_HOME` and `OPENCODE_TEST_HOME`, clears inherited `OPENCODE_*` overrides, and keeps the real home and native authentication data location. It disables project configuration, external skills, automatic updates, compaction, LSP, and formatters. Both CLI calls use `--pure`, which disables external plugins while retaining internal auth plugins. The named primary agent is unique to the receipt path. The configured model and `small_model` both match the assignment, and a fixed session title avoids automatic title generation.

Preflight first requires `opencode --version` to report a stable version of at least 1.18.29. Older versions predate the GPT-6 OAuth model-filtering fix. An old or malformed version stops with an upgrade message before configuration inspection or inference. The version check shares the caller's deadline and cancellation handling. Preflight then runs `opencode --pure debug config` in the assigned directory with the same environment as inference. It checks the exact named agent permissions and model, rejects variants and extra agent options, and checks the model, small model, disabled sharing, compaction, LSP, formatters, and absence of enabled MCP servers or custom providers. Raw configuration output is never written into receipts because it may contain secrets. This check does not prove authentication or model availability. Only a completed model response establishes execution.

Read-only permits read, glob, and grep. Isolated-write additionally permits edits and requires `cwd` to be the Git worktree root, checked through real paths. Pass a canonical absolute working directory because OpenCode's own external-directory checks compare paths. Both modes deny shell commands, recursive tasks, web tools, skills, questions, and MCP calls. The external-directory permission denies paths that OpenCode considers outside its project or worktree; it is not an independent filesystem boundary. The parent runs builds and tests. These are CLI tool permissions, not an OS sandbox. OpenCode uses lexical path checks, so an allowed path can reach a symlink target outside the worktree. Use trusted workspaces, trusted symlinks, and trusted OpenCode installations. Remote account configuration, wellknown configuration, and managed configuration can still load at CLI startup. Preflight rejects incompatible effective settings before inference but cannot undo startup side effects or guarantee settings will not change between processes.

Invocation uses `opencode run --pure --format json --model <provider/model> --agent <attempt-agent> --dir <cwd> --title pstack-worker` with the prompt on stdin. It never resumes a session or adds an implicit deadline. JSON events must end with nonempty text and a matching `step_finish` whose reason is `stop`, in a final message with no tools. A later step or error invalidates an earlier stop. The parser rejects mixed sessions, malformed streams, tool-only output, and truncation. It deduplicates text and usage parts, preserves the observed session ID, and records `pinned-argv` model evidence. OpenCode emits no model report in this stream. Unknown quota errors, including generic 429s, remain ordinary failures and do not trigger quota fallback. Private configuration is removed on completion, failure, explicit timeout, or handled cancellation; preexisting paths are preserved.

The protocol and configuration behavior were inspected in [OpenCode source at 98325dc](https://github.com/anomalyco/opencode/tree/98325dcdc6a566de6b7ab42cc87af544bed3658d/packages/opencode/src), including `cli/cmd/run.ts`, `config/config.ts`, `config/paths.ts`, `agent/agent.ts`, and `session/prompt.ts`. The initial protocol inspection used OpenCode 1.4.0. The adapter now requires OpenCode 1.18.29 or newer; the current local CLI is 1.18.32. Installed-parent validation is a separate release gate.

## Optional Antigravity models

Antigravity is an opt-in external worker from either parent. Install and sign in to `agy`, inspect `agy models`, and use an exact listed slug such as `antigravity:gemini-3.1-pro-high@default`. The slug already contains the available reasoning variant; the runner does not pass `--effort`, and `auto` is invalid. Hosted Claude models remain Antigravity routes for access, receipts, and exhaustion grouping. It does not change the default panel. Every Antigravity attempt requires an explicit saved `apiSpend` choice, including on legacy sheets.

## Model sheet grammar

The model sheet is the only persisted routing source. Each line assigns one or more role names before the first `: ` and the seat list after it. Role names themselves contain commas (`feature, refactoring`, `why investigators, synthesizer`, `reflect tooling, judgment, divergent, synthesizer`), so the header is matched against the documented role list before the right-hand side is split.

On the right-hand side, commas and arrows have different meanings and are never interchangeable:

- `,` separates independent panel seats. Each seat runs one candidate concurrently; the seat count is the fan-out count and repeated entries are not deduplicated.
- `->` separates ordered attempts within one seat: `primary -> fallback` (one or two fallbacks, for example `primary -> fallback1 -> fallback2`). A single descriptor is a one-attempt chain and authorizes no fallback.

```text
feature, refactoring: grok:grok-4.7@xhigh -> codex:gpt-5.6-sol@high
how explorer: grok:grok-4.7@xhigh
```

A chain is bounded at three attempts. Duplicates and a second attempt on the same provider are invalid: each provider route uses that CLI's current account, so another model on the same provider cannot recover exhausted capacity. An alias and a descriptor on the parent provider use that same parent route. Why and Reflect rows keep every attempt on `inherit-parent` or `auto` because they require the parent's live MCP surface. Legacy single-attempt rows remain valid and authorize exactly one attempt.

`# access: <JSON>` comment lines record one access fact per provider: `provider`, `funding` (`included`, `metered`, `unknown`), `capacity` (`standard`, `high`, `unknown`), `apiSpend` (`deny`, `approved`), `provenance` (`user`, `provider`), plus optional display-only `plan`, `note`, and `observedAt` strings. Funding, capacity, and the optional fields explain recommendations; they are advisory and never treated as durable entitlement. `apiSpend` is binding authorization: pass its exact saved `deny` or `approved` value on every policy-enabled external attempt. The sheet contains no credentials or account selector. The provider name conservatively groups exhaustion under the CLI's current account.

The installed helper `skills/poteto-mode/scripts/model-policy/pstack-model-policy` is the policy boundary. It parses and decides; it never probes providers, reads credentials, or launches anything. Setup validates the complete candidate, including authorization for every row:

```text
pstack-model-policy validate --sheet <candidate-file> --parent <claude|codex>
```

At runtime, first copy the active sheet's exact bytes to a unique run-local file. Keep that frozen copy and the original parent value for the whole run; never reread the live sheet between attempts. `resolve` gives an inspection view of a role's lane chains:

```text
pstack-model-policy resolve --sheet <frozen-sheet> --role "<role>" --parent <claude|codex>
```

A missing sheet or a missing role in a legacy sheet returns `status: "unconfigured"`: use the calling skill’s documented default as one attempt, with no fallback permission. A sheet containing access metadata, an ordered chain, or a `# fallback` declaration is policy-enabled; a missing requested role is an error, so defaults cannot bypass its saved permissions. Unreadable or malformed sheets also fail instead of selecting defaults.

Before **every** attempt, including each primary, ask `next` for the decision for that zero-based lane:

```text
pstack-model-policy next --sheet <frozen-sheet> --role "<role>" --parent <claude|codex> --state <lane-state.json> --lane 0
```

The parent owns `<lane-state.json>` with this exact shape:

```json
{"events":[{"attemptIndex":0,"status":"usage-exhausted","processStarted":false}],"exhaustedGroups":["grok"],"access":"read-only"}
```

`events` retains every earlier attempt for that lane in order. Both `attemptIndex` and `--lane` are zero-based; event `status` is one of `complete`, `usage-exhausted`, `route-unavailable`, `terminal-failure`, `deadline-exceeded`, or `failed` (`failed` covers every outcome the saved policy cannot advance, including cancellation and billing blocks), `processStarted` is included when known, `receiptPath` preserves the runner receipt, and a writer event may carry `inspection:{"state","evidenceRef"}` recording the parent's verdict. Events normally come from `pstack-model-policy normalize`, which reads the actual receipt and checks it against the frozen sheet attempt. `exhaustedGroups` is the run's accumulated provider list and must be carried into every lane state. `access` is `read-only` or `isolated-write`. A `launch` decision supplies the only authorized attempt to route. A `stop` decision ends the lane; in particular, an unauthorized route stops and is never skipped to reach a later descriptor. An `inspect` decision preserves a writer for review. After each terminal attempt, retain its receipt or native transcript, append its event, add a provider only after supported exhaustion evidence, and call `next` again. The caller also passes the selected provider's saved `apiSpend` value to every external launch and retains all histories and group failures. Skills must not duplicate this decision logic by splitting model-sheet prose themselves.

## Read-time normalization

Normalize configured descriptors before matching them to the matrix or choosing a route. If a provider-qualified Claude model starts with `claude-fable-`, `claude-opus-`, or `claude-sonnet-` and its remaining revision contains only digits and hyphens, replace that model component in memory with `fable`, `opus`, or `sonnet`. Preserve provider, effort, role, and lane order. Use only the normalized descriptor for native dispatch or runner argv. Never pass the versioned predecessor to Claude.

This read-time rule makes an older installed sheet use the latest family revision immediately without writing user files. Once per parent run, report that the persisted sheet is stale and that `/setup-pstack` will rewrite it after its normal probes and confirmation. Versioned Claude IDs outside the three migration families are ordinary exact IDs and pass through unchanged. The external runner rejects a missed Fable, Opus, or Sonnet version pin instead of silently executing it.

`fast` is part of Cursor's Grok selector, not a Grok Build CLI model or effort flag. Upstream's current Grok default `grok-4.7-xhigh-fast` names that selector; the portable Grok route pins `grok-4.7`, as advertised by Grok Build CLI. A model listing does not prove authenticated execution; setup still probes every selected route. The first-run Grok effort is `xhigh`. Update the pin only when `grok` CLI reports a newer model.

## The parent owns the route

The top-level harness freezes the sheet once and asks the helper for each attempt decision. A child receives an assigned provider, model, effort, access mode, prompt, working directory, and output path. A child never detects the harness, chooses a provider, or launches another model. Environment markers may corroborate the top-level harness before fan-out, but nested processes inherit parent markers and must not use them for routing.

| Parent | `claude:*` | `codex:*` | `grok:*` | `devin:*` | `cursor:*` | `antigravity:*` | `opencode:*` |
|---|---|---|---|---|---|---|---|
| Claude Code | native `Agent` when a shipped lane covers it, else external runner | external runner | external runner | external runner | external runner | external runner | external runner |
| Codex | external runner | native `spawn_agent` | external runner | external runner | external runner | external runner | external runner |

`inherit-parent` and `auto` remain aliases. They use the parent's current model and effort through its native subagent primitive. In a panel they still consume one lane, but they reduce provider diversity; say so in the synthesis record.

## Native lanes

Native dispatch avoids a second CLI startup and its base context.

- Claude Code: the shipped `agents/pstack-*.md` definitions are the native capability. A `claude:<model>@<effort>` descriptor is native exactly when a shipped agent's frontmatter `model` and `effort` match it; dispatch that lane through the matching `pstack-<stem>-<effort>` agent, which selects the model alias, effort, and `background: true`. `pstack-fable-max` and `pstack-opus-xhigh` remain in that set. Any other Claude model on a Claude parent — an unlisted family alias or an exact ID — uses the external runner with the model passed unchanged. Pass the complete task, grounding paths, access mode, and unique output location in the `Agent` prompt. Retain the task handle and drain it only after fan-out.
- Codex: call `spawn_agent` with the descriptor's model and `reasoning_effort`, the complete task, grounding paths, access mode, and unique output location. Use an isolated worktree for a writer. Codex subagents already run concurrently.

Send a same-provider descriptor to the external runner only when no shipped native lane covers that exact model and effort; the runner rejects a same-provider call a native lane covers because that route is cheaper and already available. A Codex parent always covers `codex:*` natively. Policy resolution and runner validation share this route decision. An external route still requires successful authorization, authentication, and execution. Choose the route before launching the attempt; do not retry a failed native attempt through the external CLI.

## External lanes

The launcher lives at `skills/poteto-mode/scripts/runner/pstack-runner` under the installed plugin. The parent writes the complete candidate prompt to a unique file, creates a unique output directory or worktree, and invokes the launcher directly. Do not put another agent in front of it.

```text
pstack-runner \
  --parent <claude|codex> \
  --provider <claude|codex|grok|devin|cursor|antigravity|opencode> \
  --model <real CLI model> \
  --effort <low|medium|high|xhigh|max|default> \
  --mode <read-only|isolated-write> \
  --prompt <unique prompt file> \
  --cwd <repository or dedicated worktree> \
  --output <unique final-response file> \
  --receipt <unique receipt file> \
  [--api-spend <deny|approved>] \
  [--timeout <seconds>]
```

Pass arguments as an argv array or quote every path. Never interpolate prompt text into a shell command. For every external attempt resolved from a policy-enabled sheet, pass that provider's saved `apiSpend` value; omit `--api-spend` only when executing an untouched legacy sheet with no access metadata and no fallback chains. The launcher checks the assigned CLI and preflights authentication where supported (Claude defers authentication to invocation), invokes the model exactly once, disables recursive agents and ambient skill dispatch where the CLI supports it, restricts the built-in tool surface, and records the exact provider/model/effort flags. External lanes do not receive the parent's MCP surface. Keep MCP-dependent Why and Reflect roles on `inherit-parent` or `auto`. The launcher never falls back.

Claude has no separate authentication preflight on any platform. Do not run `claude auth status` during setup or worker dispatch: its short-lived process can consume a refresh token and exit before saving the replacement ([upstream issue 95822](https://github.com/anthropics/claude-code/issues/95822)). The actual task handles authentication. Receipts record `preflight.status: not-run` and an unverified billing route. Known API environment checks remain, but Claude's account billing type is not asserted. See [the exception and conditions for revisiting it](https://github.com/arjitj2/open-pstack/issues/38).

Grok authentication preflight has one bounded retry. If the first `grok models` result would be classified as unauthenticated, the runner waits five seconds and tries the same preflight once more. A second failure is terminal. The delay and second attempt share the runner's absolute deadline and cancellation latch, and the receipt keeps evidence from both attempts. Model execution is never retried.

The parent tool sandbox still governs whether a subscribed child CLI can reach its credentials and network. Run setup's live probe from the actual parent profile. A blocked external CLI is a loud dropout, not a reason to elevate permissions or substitute a model silently.

The parent invocation must itself be resumable background work:

- Claude Code: call the launcher through a Bash tool invocation with `run_in_background: true` and retain its task ID. A foreground Bash tool call has an automatic ten-minute ceiling even when the runner's own timeout is longer. Shelling out with `&` and losing the task handle is not equivalent.
- Codex: run the launcher in a persistent exec session that returns a session ID, then wait or poll that handle. Do not hold one foreground tool call open for the model's full runtime.

Start the background process, continue launching the other lanes, then drain their handles. Native and external lanes belong in the same fan-out phase.

The runner and its preflight have no implicit timeout. Do not invent a duration from role, mode, or a convenient round number; real implementation lanes can run for 90 minutes or much longer. Pass `--timeout` only when the user, an external service deadline, or a measured task contract supplies a real bound. That value starts at wrapper entry, before module loading and argument parsing, and remains one absolute deadline across setup, preflight, model execution, and output capture. It is never a fresh allowance per child, and long waits are armed in runtime-safe chunks without shortening the supplied deadline. Otherwise supervise liveness through the retained background task/session handle and cancel manually only on evidence that the run is dead. Cancel through that retained handle so the runner receives SIGINT or SIGTERM, sends it to an active child when one remains, stops waiting on inherited output pipes, removes the empty output reservation, and writes a `cancelled` receipt. Preserve that receipt; a retry is a new attempt with new unique output and receipt paths. Unchanged running state is not a dropout, and Claude's ten-minute foreground ceiling is never a reason to terminate a healthy lane.

Read-only mode maps to Claude plan mode with project-only settings and an explicit tool list, Codex's read-only sandbox, and Grok plan mode plus its `read-only` sandbox and read-oriented tool list. Grok's built-in read-only profile deliberately keeps its own state and system temporary directories writable, so point a read-only Grok lane at the actual checkout rather than a worktree under `/tmp`, `/var/tmp`, or the host's temporary directory. `isolated-write` maps to Claude `acceptEdits` with project-only settings, Codex `workspace-write`, and Grok `acceptEdits` plus its `workspace` sandbox and write-capable tool list. Give every writer only a dedicated worktree or output directory. Never route a writer into the primary checkout.

Cursor uses the explicit `cursor-agent` executable, not `agent` (which can name another CLI). For stored OAuth credentials, preflight requires `cursor-agent status --format json` to return `isAuthenticated: true`. With a nonblank `CURSOR_API_KEY`, preflight checks `cursor-agent --version` only and records that authentication is deferred to the real model invocation; Cursor status does not report API-key authentication. The key stays in the environment. Authentication failures from execution fail the lane. Setup always performs a real model probe because preflight alone does not prove model access. The runner sends the prompt through stdin, pins `--model`, requests a successful JSON terminal result, and uses `--workspace` with `--sandbox enabled`. Read-only adds `--mode ask` and denies `Write(**)` and `Shell(*)`; it cannot run shell-based tests. Writers use the sandbox in their dedicated workspace without `--force` or `--yolo`.

Each Cursor attempt exclusively creates a private `<receipt>.cursor-config` directory (0700) containing `cli-config.json` (0600), sets `CURSOR_CONFIG_DIR` for preflight and execution, and removes that directory on completion, failure, timeout, or handled cancellation. Existing paths are never overwritten or removed. The temporary permissions deny `Mcp(*:*)` and `WebFetch(*)`; no user configuration is edited and no credentials are copied. Cursor's authentication storage is separate from this configuration directory. Before overriding the directory, the runner reads the original global configuration (`CURSOR_CONFIG_DIR`, otherwise `XDG_CONFIG_HOME/cursor`, otherwise `~/.cursor`) and preserves only a boolean `network.useHttp1ForAgent`, needed by some proxies. It never copies permissions, hooks, credentials, endpoints, or other settings. An unreadable or malformed existing configuration fails the lane instead of silently losing its transport setting.

Cursor's CLI currently exposes no supported switch to disable recursive subagents, project rules, skills, plugins, or hooks. The runner passes `--trust` for the assigned workspace so headless execution can start; this may authorize project startup hooks. Use only trusted workspaces and keep the parent-owned assignment in the prompt. These settings are not a clean-room guarantee, and the receipt does not prove that project hooks or every descendant were sandboxed. Cursor's native child tools also differ from the parent's tools; MCP-dependent work must stay native. See Cursor's [configuration](https://cursor.com/docs/cli/reference/configuration), [permissions](https://cursor.com/docs/cli/reference/permissions), and [output format](https://cursor.com/docs/cli/reference/output-format) contracts.

Antigravity preflights with `agy models`; a listed slug proves discovery, while authentication and execution remain subject to the real attempt. The runner sends one stream-json user message over stdin, pins `--model` and a unique `--agent`, enables `--sandbox`, and audits the final stream. Read-only launches from an exclusively created private directory beside the receipt, adds the assigned checkout with `--add-dir`, and declares only `view_file`, `list_dir`, and `grep_search`. Writers launch from their assigned **dedicated worktree** and temporarily create an exclusive `.agents/agents/<unique-name>.md` there. They use `--mode accept-edits` with only those read tools plus `write_to_file`, `replace_file_content`, and `multi_replace_file_content`. `--disable-slash-commands` is used only for read-only lanes because combining it with `--mode` disables the requested mode. Neither mode exposes shell, command status, web, MCP, or subagent tools; file-only writers cannot run tests, so the parent runs them. The runner removes its temporary agent definition after the attempt and never edits global configuration. Use trusted workspaces because project hooks and CLI history can still run or persist. The receipt does not prove all descendants were terminated.

Under `apiSpend: deny`, Antigravity blocks known environment billing routes (`GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL`, `AGY_ADC_AUTH`, and set `AGY_GATEWAY_*` keys), an unreadable or malformed `~/.gemini/antigravity-cli/settings.json`, and settings containing `modelProvider` or `modelConfigOverrides`. Only key names appear in receipts. This is a route guard, not a claim that provider account overage cannot occur. `apiSpend: approved` permits the selected account route.

Every concurrent external lane needs distinct prompt, output, and receipt paths. The launcher reserves output and receipt paths exclusively and refuses to overwrite them.

## Completion and dropouts

Success requires all of these:

1. Exit status `0`.
2. Receipt status `complete`.
3. Either `modelVerified: true` with `modelEvidence: "provider-report"`, or a Codex, Devin, Cursor, or OpenCode receipt with `reportedModel: null`, `modelVerified: false`, and `modelEvidence: "pinned-argv"`, or an Antigravity receipt with its requested slug echoed in `reportedModel`, `modelVerified: false`, and `modelEvidence: "pinned-argv"`. Antigravity's `init.model` must exactly match the request but merely echoes the CLI override; it does not verify the backend model. Claude model-report matching follows the alias and exact-ID rules in [Model matrix](#model-matrix). For pinned-argv evidence, verify the receipt provider, model, and effort match the assignment and its argv pins the expected CLI model. Codex, Cursor, and OpenCode pin the assigned model directly; Cursor, Antigravity, and OpenCode require `effort: "default"`; Devin uses the exact UID mapping in Optional Devin models (for example, `swe-2@high` pins `--model swe-2-high`).
4. A non-empty output file.

The receipt also carries elapsed time, token usage when the CLI exposes it, and cost when available. Cursor returns session IDs and may return token usage; missing model identity, usage, or cost stays null. Keep it with the arena or review artifacts so parent-harness comparisons are evidence-based.

Any missing CLI, failed login, unavailable model, explicit timeout, cancellation, catchable post-reservation launcher failure, non-zero child exit, malformed result, or model mismatch is a receipt-bearing dropout. Record it and apply the calling skill's existing dropout policy. A `cancelled` receipt proves that the runner received the signal; its `signal` field is non-null only when the runner sent that signal to a still-active direct CLI child, and remains null when cancellation only stopped a post-exit pipe drain. The provider CLI owns any processes it starts beneath that direct child; the receipt does not claim a process-tree kill. Do not delete or overwrite the receipt. Never substitute the parent model, retry another provider, or reinterpret an external descriptor as a native model slug — the only permitted second attempt is the saved chain below.

Start native and external lanes in the same fan-out phase, then wait for all of them before judging. A judge must not read candidate paths while their owners are still writing.

## Saved fallback and backend recovery

The runner and native tool envelopes classify failures; the helper owns every routing decision. A sheet may declare one saved recovery policy:

```
# fallback: {"on":["usage-exhausted","route-unavailable","terminal-failure","deadline-exceeded"]}
```

The `on` list is a closed union over exactly those four policy outcomes, with no duplicates and no unknown keys; a second `# fallback:` line anywhere in the sheet (preamble, between rows, or footer) is malformed and rejected. A sheet without the line keeps quota-only behavior — `{"on":["usage-exhausted"]}` — so existing sheets advance only on proven exhaustion. Declaring the line makes the sheet policy-enabled in the same sense as saved access facts and chains: required role rows must be present rather than defaulting, and every configured route needs an access fact. The policy declares which terminal outcomes *may* advance; it never adds an attempt, a provider, a model, an effort, or an `apiSpend` approval beyond what the saved chain already authorizes. Setup may recommend a broader policy on a new sheet and must show its effect in the candidate; it never edits an existing sheet's policy without explicit acceptance.

The receipt boundary is deterministic: `bun scripts/model-policy/cli.ts normalize --sheet <path> --role <role> --parent <p> --lane <n> --attempt <i> --receipt <path> --mode <read-only|isolated-write>` reads the actual runner receipt, checks that its parent/provider/model/effort match the frozen sheet's attempt `i` on lane `n`, that its recorded access mode equals the requested `--mode` and its recorded `apiSpend` equals the attempt's saved access fact, checks internal consistency (a not-started receipt can only fail in preflight, a preflight failure cannot be started, postprocess requires a clean exit), and prints the policy `AttemptOutcome` (plus the receipt path as evidence) or exits nonzero. Agents never reimplement the mapping. The total mapping over receipt statuses:

| Receipt status | Policy outcome | Gate |
|---|---|---|
| `complete` | `complete` | — |
| `usage-exhausted` | `usage-exhausted` | — |
| `unavailable-cli`, `unavailable-model`, `unauthenticated` | `route-unavailable` | — |
| `child-failed`, `malformed-output` | `terminal-failure` | direct child settled (recorded `exitCode` or signal) and `terminalSuccess: false` recorded by the runner |
| `timed-out` | `deadline-exceeded` | receipt carries an explicit `timeoutMs` and a settled owned process |
| `cancelled`, `billing-policy-blocked` | `failed` | always terminal; never advances |
| any started failure with no settled child evidence (launcher/programming catch, including a missing quota adapter) | `failed` | not a backend failure |
| any started or unknown-start nonquota failure with no recorded `terminalSuccess: false` assessment | `failed` | missing evidence cannot authorize broader recovery; proved-not-started preflight route or deadline failures need no workload-success assessment |
| any status with `terminalSuccess: true` | `failed` | a valid final success is never replayed |

`timeoutMs` on a receipt records only an explicit `--timeout` deadline; absent and `null` never qualify. A `terminalSuccess` receipt flag records the runner's verdict on whether a provider-protocol final success (a real terminal success envelope, not a bare `is_error:false` object) was observed even when the process exited nonzero or stderr disagreed — success precedence wins and the seat is finished, not retried. A completed worker whose output reports failing project tests is completed work, not a backend failure. Live silence is never terminal: without a terminal receipt there is no event and no fallback.

Missing executables and failed authentication/model preflights can produce `route-unavailable`. After a workload starts, unproven authentication or model wording in stdout or stderr is a `child-failed` outcome, governed by `terminal-failure`; generated task prose and quoted logs cannot authorize a route-only fallback. Source-backed quota classification and terminal-success precedence still apply.

An explicit `inspection.state: "unsafe"` vetoes continuation regardless of access mode or whether the workload started. The started-writer rule determines when inspection is required; it never overrides an unsafe verdict already recorded by the parent.

Native lanes have no runner receipt. A native event may be recorded only from explicit host terminal metadata (for example a structured tool-envelope capacity failure); there is no helper that verifies host-side records, so the parent attests them and `normalize` refuses native aliases and native-routed descriptors rather than parsing generated prose.

Writer inspection: an `isolated-write` attempt whose receipt cannot prove `processStarted: false` returns `inspect` instead of advancing, because external side effects cannot be ruled out. The parent then autonomously inspects the diff, output, and tool effects — never a user prompt — and records `inspection: {"state":"clear","evidenceRef":"<what was inspected>"}` or `{"state":"unsafe","evidenceRef":"<reason>"}` on the event before calling `next` again. `clear` permits only the next authorized descriptor; `unsafe` stops the lane; a missing or malformed inspection cannot bypass the check and `evidenceRef` is the parent's attestation, not something the helper verified. An approved later writer attempt runs in a fresh worktree from a reviewed immutable continuation snapshot that preserves completed safe work; the failed worktree and receipt are preserved untouched and writers never overlap.

Every registered provider implements a typed quota adapter (`scripts/runner/provider-failure.ts`): the registry is total over `PROVIDERS`, so a new provider without an adapter fails compilation, and a runtime lookup with no implementation throws an explicit error instead of silently disabling fallback. `usage-exhausted` is emitted only for these implemented external protocols:

- Claude: the last stdout result envelope — or the trusted terminal envelope behind a typed parse error — carries `type: "result"`, `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: 429`, and a `result` string beginning with a canonical rejected-limit diagnostic: `You've hit your session limit`, `You've hit your weekly limit`, `You've hit your Opus limit`, `You've hit your Sonnet limit`, `You've hit your Fable limit`, `You've hit your usage credit limit`, `You've hit your usage limit`, `You've hit your limit`, `You've hit your team's shared budget`, `You've hit your monthly spend limit`, `You've hit your org's monthly spend limit`, `You've hit your org's monthly usage limit`, or `You're out of usage credits`. The diagnostic must end the message or continue at the ` · ` separator the composer appends; arbitrary continuations fail closed. The complete errored api_error frame is required: `subtype: "success"` alone or a bare 429 never classify, and a later successful result supersedes an earlier error.
- Codex: the final stdout protocol outcome is a terminal `turn.failed.error.message` or unrecoverable `error.message` beginning with a pinned canonical diagnostic: `You've hit your usage limit`, `Your workspace is out of credits.`, `You hit your spend cap set`, or `Quota exceeded. Check your plan and billing details.` The diagnostic must end the message or continue at `.` or ` `. Only the proven `stream disconnected after retries: ` retry wrapper may precede it; an `Authentication required:`, rate-limit, model, or any other unproven `{context}: ` prefix never exposes a diagnostic. A plan-upgrade/UsageNotIncluded message is an entitlement failure, not exhaustion. Stderr cannot override a later successful stdout `turn.completed`.
- Grok: the last terminal JSON record has `type: "result"`, `subtype: "error_during_execution"`, `is_error: true`, and an `errors` array containing exactly `You’ve reached your free Grok Build usage limit for now. Get SuperGrok for much higher limits, or try again later: https://grok.com/supergrok?referrer=grok-build`. A later terminal success supersedes an earlier error.
- Devin: a nonzero exit plus exactly one stderr `Error:` frame whose top-level Display is `Quota exhausted: <canonical>` or a bare canonical cap sentence — `You've reached your monthly usage limit. Wait for the limit to reset next month.`, `Your organization has reached its monthly usage limit. Ask an account admin to raise it, or wait for the limit to reset next month.`, or `usage quota has been exhausted`. A `Quota exhausted:` prefix with unproven detail, a canonical sentence nested inside another `Error:` Display (authentication, rate-limit, transport), more than one `Error:` frame, `Rate limited:`/`Authentication required:`/`An admin paused usage on your account` shapes, model errors, and agent stdout prose all fail closed. A trusted successful terminal envelope vetoes the stderr diagnostic; Devin has no proven stdout result protocol — the ATIF transcript is a separate export file — so an envelope can only veto, never prove quota, and there is no postprocess quota path.
- OpenCode: no proven quota diagnostic is mapped. All errors remain unknown to the quota classifier. A shared transcript parser detects terminal success; a generic 429 or quota words never authorize fallback.
- Cursor: a nonzero exit, no successful stdout result envelope, and exactly one stderr `<Class>Error:` frame that is `ActionRequiredError:` whose message begins `You've hit your usage limit` at a separator boundary (end of line, space, or period). Usage-limit, rate-limit, login, payment, and pro-only errors share the ActionRequiredError class, so the class alone is not proof; multiple error frames are contradictory and fail closed, and ANSI styling/CRLF endings are normalized on the frame only. A trusted successful terminal envelope vetoes; errored envelopes carry no proven quota channel. Do not invent structured error codes the CLI does not emit.
- Antigravity: no canonical terminal quota envelope is proven. Its adapter returns UNKNOWN even for quota-sounding text or HTTP 429; no `usage-exhausted` receipt is emitted until captured protocol evidence supports one. A final `SUCCESS` with a nonempty response and no `denied_actions` still takes precedence over a conflicting exit code so the completed attempt is never replayed.

Diagnostics hidden behind unresolved build constants, entitlement or seat-tier messages, unproven error shapes, and every failure outside these contracts are not quota: they get the normal receipt status and saved-policy handling above, so an authorized broad policy can still recover them while quota-only sheets treat them as terminal. A native lane may classify only an explicit capacity failure from the parent host's structured tool envelope. Never infer exhaustion from model prose, generated output, or a human-readable transcript. Generic 429 or 403 errors, `resource_exhausted`, authentication or model-access failures, task failures, timeouts, malformed output, and unrecognized provider shapes are not exhaustion; cancellations and billing-policy blocks stay terminal `failed` under every policy.

Classification evidence comes from read-only inspection of installed first-party artifacts and upstream sources; no credential files were read. "Observed" means exercised live or captured from a real run; "derived" means read from source/artifacts but not yet captured live.

| Provider | Evidence | Observed vs derived |
|---|---|---|
| Claude | `~/.local/share/claude/versions/2.1.281` SHA256 `a922981f6f3b55a251ef9f9dbaa0621a5f99cbcb5ca67f8a797476ccfc83f626`; the composer renders `You've hit your ${name}${tail}` and `You're out of usage credits${tail}` with tails empty or beginning ` · `; the canonical name set above is source-proven. | Verified against a real captured exhaustion: `{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"terminal_reason":"api_error","result":"You've hit your session limit · resets 4pm (America/New_York)"}` at exit 1. |
| Devin | `~/.local/share/devin/cli/_versions/current/bin/devin` SHA256 `f3fb3868c38c83826951ce71b803d5ad7d7d402eaa56f6dc9bca7a14cbfa5de7`: error Display templates carry the exact `Quota exhausted: ` prefix distinct from `Rate limited: ` and `Authentication required: `, and the cap sentences appear verbatim in the binary. | Source-derived, not captured live; only the `Error: <display>` stderr framing was exercised (via `Error: Unknown model: ...`). |
| Cursor | `~/.local/share/cursor-agent/versions/2026.09.23-86fc751/` `index.js` SHA256 `6daeddfe3327a7efd21f1e69ef7b970ad90869ca785e2089e1d32f4de2de62f6` and `711.index.js` SHA256 `141bae738b2128eba6a5f5e468f41ff16c5d5aaaf7a7c5407719221274b0c95b`: `FREE_USER_USAGE_LIMIT` (9) and `PRO_USER_USAGE_LIMIT` (10) map into ActionRequiredError alongside rate-limit, login, payment, and pro-only errors; the headless catch prints `String(error)` to stderr and exits 1; success writes `{type:"result",subtype:"success",is_error:false}`. | Source-derived, not captured live; the displayed cap form is corroborated by Cursor forum reports. |
| Codex | `codex-rs/exec/src/exec_events.rs` @`f8c6026c` (terminal `turn.failed`/`error` events carry `message` only — no machine code) and `codex-rs/protocol/src/error.rs` @`9d8de196` (UsageLimitReached/QuotaExceeded Display strings; UsageNotIncluded is an entitlement gate, RateLimitExceeded retryable, ServerOverloaded/SessionBudgetExceeded not account quota). | Source-derived. |
| Grok | `xai-org/grok-build` @`f0e3be11` `crates/codegen/xai-grok-shell/src/sampling/error.rs` (backend `subscription:free-usage-exhausted` maps uniquely to the canonical message) and `crates/codegen/xai-grok-pager/src/headless/reducer/messages/mod.rs` (the terminal `{type:"result",subtype:"error_during_execution",is_error:true,errors:[...]}` shape). | Source-derived. |

New provider or vendor output shapes fail closed until their own evidence lands.

The receipt's additive `failurePhase` (`preflight`, `invocation`, `postprocess`) and `processStarted` fields record how far the attempt got. `processStarted: false` proves no model or assigned workload invocation launched; authentication preflight may already have invoked the provider CLI. Anything else means the workload may have begun.

Before replacing a failed worker, publish a brief progress notice in user-visible message text, not only in private thinking or tool logs. The notice must name the exact failed descriptor, the observed cause, and the next approved descriptor or action. For a writer, announce inspection and preservation first, then announce continuation after a clear verdict. Do not ask the user to select a replacement or approve an already authorized backup. Keep unrelated healthy lanes running. Summarize the observed cause without copying sensitive logs.

The parent loop, applied per seat through `next`:

1. Call `next` with the frozen sheet and current lane state. Launch only its `launch` decision, with a fresh output/receipt path and the saved `apiSpend` policy. `stop` ends the seat; `inspect` pauses a writer for review.
2. On success, retain the evidence and finish the seat.
3. On a terminal outcome the sheet's saved policy authorizes, retain the event (normalize the actual receipt through the boundary above; native lanes need explicit host terminal metadata), add its provider to the run's exhausted groups only for `usage-exhausted`, and call `next` again. The helper may skip an attempt only because that provider group is already exhausted, and it enforces the skipped route's authorization before skipping. Chains remain finite — at most three attempts — and each attempt runs at most once.
4. On any outcome the policy does not authorize, retain the evidence and apply the calling skill's existing dropout rule. Do not advance to a fallback. `complete` ends the seat; `failed` is always terminal.
5. When the chain is exhausted, checkpoint only the blocked lane; unrelated healthy lanes and independent parent work continue.
6. Report the configured primary, every attempted or exhaustion-skipped descriptor and its observed cause (for example "authentication check failed" — describe only what the receipt shows, never invented account state), the actual successful descriptor, and actual provider diversity. A recovered success supersedes earlier attempt errors in the final report. Never describe a fallback's output as the primary's.

Writer lanes are stricter: an `isolated-write` attempt whose receipt cannot prove `processStarted: false` stops for autonomous parent inspection — never a failure-time permission question — because external side effects cannot be ruled out. A proved-not-started writer can advance directly; a started writer continues automatically only after the parent records `inspection.state: "clear"` with an `evidenceRef` covering the diff, output, and tool effects. An `unsafe` verdict stops the lane; missing inspection keeps it in `inspect` and cannot advance. Each later attempt is a fresh writer in a new worktree from a reviewed immutable continuation snapshot that preserves completed safe work, and every failed worktree and receipt is retained untouched. Read-only attempts still need fresh exclusive output and receipt paths but may reuse the checkout.

A fallback not present in the confirmed sheet requires user approval through setup; nothing searches for a closer model, retries in place, or lets a child reroute itself. If the parent account itself exhausts, the controller cannot recover itself; checkpoint and report instead of pretending worker fallback keeps the parent alive.

## Billing and credential guard

Provider-observed facts (`provenance: "provider"`) do not authorize dispatch. Binding funding and API-spend choices require operator confirmation and `provenance: "user"`; setup retains provider plan details as advisory metadata.

The runner accepts `--api-spend <deny|approved>` and records it in the receipt. `approved` explicitly authorizes a metered API route. `deny` performs bounded route checks and writes a `billing-policy-blocked` receipt (exit 78, `failurePhase: "preflight"`, `processStarted: false`) when a known API route is present or required subscription-auth evidence cannot be established. Every external attempt from a policy-enabled sheet passes the exact saved value; omission preserves legacy behavior for preexisting providers only on an untouched sheet with no access metadata and no chains. OpenCode has no legacy exemption.

The bounded check covers known environment inputs without printing or persisting their values: nonblank Claude API/auth variables, `OPENAI_API_KEY`, `XAI_API_KEY`, `GROK_CODE_XAI_API_KEY`, `DEVIN_API_KEY`, and `CURSOR_API_KEY`, `DEVIN_API_URL` and `CURSOR_API_ENDPOINT` route overrides, plus enabled Claude Bedrock, Vertex, Foundry, base-URL, and custom-header controls. Claude does not inspect auth-status method/provider fields; its billing route remains unverified. Codex uses the exact known `codex login status` form and gives API evidence precedence over ChatGPT login evidence. Devin and Cursor have environment-guard coverage plus their ordinary account login checks and isolated runner configuration. Grok is blocked under `deny`: its models login banner cannot establish subscription routing because per-model BYOK takes precedence over OAuth. Claude uses an empty settings-source list for invocation under `deny`, preventing user/project/local settings from injecting API credentials; managed policies still apply. OpenCode blocks `deny` and omitted legacy policy before CLI startup because subscription routing is unproven. The guard reads no credential files and changes no ambient authentication.

This is a narrow route guard, not a zero-charge promise. Provider-managed on-demand credits or overage can still apply under OAuth, and unsupported authentication arrangements can remain unknown. Use the provider account's billing controls for hard limits.
