# open-pstack technical reference

This page covers runtime integration, dependencies, and differences from upstream. For the plain-English introduction and quick start, see the [main README](../README.md).

[Poteto](https://x.com/poteto)'s [pstack](https://github.com/cursor/plugins/tree/main/pstack), adapted to run in Claude Code and Codex without Cursor. One shared skill tree serves both harnesses; the [README provider table](../README.md#supported-parent-apps-and-worker-providers) lists the supported worker-provider lanes. [UPSTREAM.md](../UPSTREAM.md) owns the current Cursor sync point and [release history](releases.md) owns what each distribution release incorporated.

Original by Lauren Tan. Arjit Jaiswal maintains this distribution, building on [Eric Litman's Open Pstack](https://github.com/ericlitman/open-pstack) and Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude) port and retains its history and MIT attribution. It imports seven MIT-licensed skills from [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit): `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, `what-did-i-get-done`.

> if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence.

This is not a verbatim copy. Skill bodies have been edited so every Cursor-specific primitive resolves to its Claude Code or Codex equivalent — see [Differences from upstream](#differences-from-upstream) for the full list. The exhaustive per-skill audit lives in [CHANGES.md](../CHANGES.md); license attribution lives in [NOTICE.md](../NOTICE.md); the upstream README is preserved verbatim at [README-UPSTREAM.md](../README-UPSTREAM.md).

## Install

### Claude Code

This repo ships as a Claude Code marketplace containing one plugin (`pstack`). Follow the [installation instructions](../README.md#install).

The plugin auto-fires through a `SessionStart` hook on startup, `/clear`, and post-compact. The hook injects a small mandate that routes non-trivial engineering work into `poteto-mode`; the full skill loads only when invoked. Dispatched subagents ignore the mandate, and explicit user instructions take precedence. To opt out, delete `hooks/hooks.json` from the installed copy at `~/.claude/plugins/cache/open-pstack/pstack/<version>/hooks/hooks.json`; a plugin update restores it.

### Codex

The same plugin carries a `.codex-plugin/plugin.json` manifest and a root `.agents/plugins/marketplace.json`. Install it through the Codex marketplace per the [README](../README.md#install), which also enables the multi-agent setting the parallel-subagent skills need.

Codex discovers the plugin skills under the `pstack` namespace, so they list as `pstack:poteto-mode`, `pstack:tdd`, and so on. The namespace comes from `plugins/pstack/.codex-plugin/plugin.json`.

For local plugin development, you can clone the repository and link its skills directly:

```shell
git clone https://github.com/arjitj2/open-pstack
cd open-pstack
for s in plugins/pstack/skills/*/; do ln -s "$PWD/$s" ~/.agents/skills/"$(basename "$s")"; done
```

The marketplace install is the normal user path. Direct links are only for testing a checkout before publishing it. Remove the linked skill directories when the test is over.

## Layout

```text
.
├── .claude-plugin/marketplace.json   # Claude Code marketplace manifest (repo root)
├── .agents/plugins/marketplace.json  # Codex marketplace manifest (repo root)
├── plugins/pstack/                   # the plugin itself
│   ├── .claude-plugin/plugin.json    # Claude Code manifest
│   ├── .codex-plugin/plugin.json     # Codex manifest (skills: ./skills/)
│   ├── skills/                       # skills shared by Claude Code and Codex
│   │   ├── poteto-mode/references/{codex-tools,provider-dispatch}.md  # tool + provider routing
│   │   └── poteto-mode/scripts/      # bun/bash/node tooling: watch-pr, orch, runner, model-policy, check-plan.mjs, worktree-audit.sh
│   ├── hooks/                        # SessionStart auto-fire: injects the poteto-mode mandate (Claude Code only)
│   └── agents/                       # Claude subagents, including native Fable, Opus, and Sonnet lanes at each selectable effort
├── tests/skill-collision-repro.sh    # native-skill package invariants and Claude invocation checks
├── LICENSE                           # pstack upstream MIT
├── LICENSE-cursor-team-kit           # cursor-team-kit upstream MIT
├── LICENSE-superpowers               # superpowers upstream MIT (hook runner)
├── NOTICE.md                         # attribution table
├── UPSTREAM.md                       # current Cursor sync point and update procedure
├── CHANGES.md                        # per-skill substitution audit
├── README.md                         # plain-English introduction and quick start
└── docs/reference.md                 # this technical reference
```

Plugin-internal `skills/<name>/` path references in the docs below are relative to `plugins/pstack/`.

## Running on Codex

The Codex build shares one `skills/` tree with the Claude Code build. Nothing is forked or generated. Two narrow references keep runtime translation separate: `codex-tools.md` maps harness primitives and `provider-dispatch.md` maps model providers. pstack otherwise keeps the upstream Claude-native prose and adds a one-line Platform note to each skill that names a Claude primitive, so the port stays in lockstep with upstream sync.

- **Skill invocation.** Codex loads `SKILL.md` natively. There is no `Skill` tool. In the Codex app, type `/` and pick `pstack:poteto-mode`, or mention `$pstack:poteto-mode`. Codex CLI supports `/skills` and `$` mentions. Asking for the skill by name is also valid. See the [official slash-command reference](https://learn.chatgpt.com/docs/reference/slash-commands).
- **Package surface.** The native `skills/` tree is the only workflow source. The plugin ships no `commands/` layer and does not link prompts into `~/.codex/prompts/`. Codex would migrate such files into duplicate source-command skills while loading the native skill tree. The `principle-*` leaves declare `user-invocable: false`. Claude keeps them out of its user picker; Codex 0.149.0 currently shows them despite that metadata ([historical ericlitman/open-pstack#8](https://github.com/ericlitman/open-pstack/issues/8)).
- **Tool and built-in mapping.** Claude tool names and built-in skills resolve through [`codex-tools.md`](../plugins/pstack/skills/poteto-mode/references/codex-tools.md). Model execution resolves separately through [`provider-dispatch.md`](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md), so Codex can keep Sol native while invoking Claude and Grok externally.
- **Subagents.** The `Agent` tool maps to Codex `spawn_agent` / `wait_agent`, enabled by `multi_agent = true`. Parallel fan-out is multiple `spawn_agent` calls in one turn. If the native Codex lane is unavailable, use explicit host metadata to record `route-unavailable` and consult the saved policy; record a dropout only when no approved continuation is available; external Claude and Grok lanes still run, and no provider is silently substituted. There is no `poteto-agent` subagent type on Codex; route ad-hoc subagents by dispatching a `spawn_agent` told to read `poteto-mode` first.
- **Auto-fire.** This distribution's bundled `hooks/` SessionStart script targets Claude Code. In Codex, select `pstack:poteto-mode` explicitly or add a standing instruction to `~/.codex/AGENTS.md` for default routing. `setup-pstack` writes the model block, not that workflow instruction.
- **Models.** The [provider dispatch contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) owns model choices, defaults, permissions, billing guards, and recovery. Setup writes the model sheet; the parent freezes it for a run and owns routing.

Earlier installed Claude Code and Codex validation covered skill discovery under `pstack`, the former four-family panel through the native/external route table, long-running handles without a default timeout, and cross-judging only after every candidate was terminal. Current release evidence is recorded in [compatibility and release evidence](compatibility.md), including the [Cursor adoption report](cursor-adoption-20260924.md) and subscription-routing validation. The `principle-*` leaves remain available for `poteto-mode` to read by path. Claude honors their `user-invocable: false` metadata; Codex 0.149.0 does not ([historical ericlitman/open-pstack#8](https://github.com/ericlitman/open-pstack/issues/8)).

## Dependencies

Nothing is declared in `plugin.json`. Install the one companion plugin yourself:

- **`plugin-dev`** (from the `claude-plugins-official` marketplace) — the rewiring routes skill-authoring tasks (in `automate-me`, `reflect`, `poteto-mode`) to the `plugin-dev:skill-development` skill:

  ```shell
  /plugin marketplace add anthropics/claude-plugins-official
  /plugin install plugin-dev@claude-plugins-official
  ```

  Until 0.9.2 this was a `dependencies` entry in `plugin.json`. The desktop app's `--plugin-dir` load mode can never resolve cross-marketplace dependencies and hard-disables the whole plugin, so 0.9.3 removed the declaration — full mechanism in the 0.9.3 entry of [CHANGES.md](../CHANGES.md). Without `plugin-dev` installed, only the skill-authoring routes degrade; everything else works.

Not declared as deps, but referenced in skill bodies:

- **`run`, `verify`, `loop`** — Claude Code CLI built-ins (ship with the binary, always available).
- **`gh` (GitHub CLI).** This is the default forge for every stack playbook and a system-level requirement of the standalone `babysit` skill. Install it with [`brew install gh`](https://cli.github.com) and authenticate with `gh auth login`. If Origin's `origin` CLI is installed and can resolve the repository, the stack playbooks use it instead. Only the Orchestrate playbook and its `scripts/orch` frontier tooling still require `gt`.
- **`bun`** — runs the vendored `skills/poteto-mode/scripts/` tooling (`watch-pr`, `orch`, `runner`, `model-policy`). Install via [`brew install oven-sh/bun/bun`](https://bun.sh). `bootstrap.ts` installs dependencies for `watch-pr` and `orch`; the runner and model-policy helper use only Bun and Node built-ins, so they launch directly without an install/re-exec layer.
- **`node`** — runs `skills/poteto-mode/scripts/check-plan.mjs`. The checker uses only Node built-ins and does not need Bun.
- **Provider CLIs.** Install and authenticate only the providers assigned in your model sheet. The [README provider table](../README.md#supported-parent-apps-and-worker-providers) names each CLI.
- **`jq` and `rg` (ripgrep)** — only for `scripts/worktree-audit.sh` (the Worktree cleanup playbook). Without them the audit still runs but blanks its PR and LAST_CHAT columns, so it warns on stderr rather than returning a table that looks complete.

No third-party plugins. The harsher-critique escape hatch lives in the bundled `thermo-nuclear-code-quality-review` skill (imported from cursor-team-kit), not in an external plugin.

## Skills

The packaged skills live under [`plugins/pstack/skills/`](../plugins/pstack/skills/), one directory per skill; each `SKILL.md` carries its own description, which is the authority for what it does and when to use it. The [README](../README.md#useful-skills) summarizes the common entry points.

Claude Code exposes each native skill with a `/pstack:` prefix, such as `/pstack:poteto-mode`. In Codex, ask for the namespaced skill, such as `pstack:poteto-mode`.

## Subagents

`poteto-agent` is adapted for Claude Code: `generalPurpose` becomes `general-purpose`, and the unsupported `is_background` frontmatter field is removed. On Claude Code, spawn it with `subagent_type: "poteto-agent"`. On Codex, follow the native delegation mapping in `codex-tools.md`.

`comment-sicko` is the read-only comment reviewer the `no-comments` skill spawns. Upstream names it `Comment Sicko`; the port renames it to `comment-sicko` so the name is a valid `subagent_type`. Invoke it through `/no-comments`, not directly.

Fable, Opus, and Sonnet each ship at `low`, `medium`, `high`, `xhigh`, and `max`. Names are `pstack-<stem>-<effort>`. `pstack-fable-max` and `pstack-opus-xhigh` remain. Each file selects the rolling family alias and requested effort, runs in the background, and denies nested Agent/Task dispatch. pstack dispatches them from provider-qualified descriptors; they are not user-facing workflows.

## Differences from upstream

The port is editorial, not mechanical. Anywhere upstream pstack assumed Cursor-specific primitives, this port substitutes the Claude Code equivalent so refs actually resolve. Two prior ports ([v1truv1us/ai-eng-system](https://github.com/v1truv1us/ai-eng-system), [Evan-Kim2028/agent-fleet](https://github.com/Evan-Kim2028/agent-fleet)) stop at namespacing — they vendor pstack under `pstack/` and leave the Cursor refs intact. This port does the content surgery.

### What's added

- **`skills/babysit/`** — Claude Code analog of Cursor's closed-source `/babysit` built-in. Wraps `gh pr view` / `gh pr checks` / `gh run view --log-failed` plus the `loop` skill for pacing. Independently authored; workflow informed by Cursor's public `/babysit` behavior — not a copy of Cursor's implementation. Since the v0.14.2 sync, poteto-mode routes PR-status requests to the ported `playbooks/babysit.md` instead, and this skill is the standalone `/babysit` entry point.
- **`skills/deslop/`** — imported verbatim from `cursor-team-kit`. Cleans AI tells out of diffs before commit.
- **`skills/thermo-nuclear-code-quality-review/`** — imported verbatim from `cursor-team-kit`.
- **`skills/make-pr-easy-to-review/`** — imported verbatim from `cursor-team-kit`. Composes with `opening-a-pr` and `babysit`.
- **`skills/fix-ci/`** — imported verbatim from `cursor-team-kit`. Narrower CI-fix primitive that `babysit` can route to.
- **`skills/fix-merge-conflicts/`** — imported verbatim from `cursor-team-kit`. Pairs with `babysit` step 5.
- **`skills/get-pr-comments/`** — imported verbatim from `cursor-team-kit`. Primitive for `babysit` step 4 and `reflect`.
- **`skills/what-did-i-get-done/`** — imported verbatim from `cursor-team-kit`. Commit summary over a chosen period.

### What's substituted in skill bodies

| Upstream (Cursor) | This port (Claude Code) |
| --- | --- |
| `Task` tool, `subagent_type: generalPurpose`, `readonly: false/true` | `Agent` tool with model selection, requested effort, and `disallowedTools`; access mode is assigned by the parent, with writers isolated in worktrees |
| `AskQuestion` tool | `AskUserQuestion` tool |
| Cursor's built-in `/loop` | Claude Code's built-in `loop` skill |
| Cursor's built-in `/babysit` | `babysit` skill bundled in this plugin. From v0.14.0 upstream routes PR-status requests inside poteto-mode to `playbooks/babysit.md` instead; the port does the same, and `/babysit` stays the standalone entry point |
| Cursor's built-in `/create-skill` | `plugin-dev:skill-development` skill |
| `cursor-team-kit` `control-cli` (CLI/TUI driver) | Claude Code's `run` skill |
| `cursor-team-kit` `control-ui` (browser/Electron driver) | Claude Code's `verify` skill |
| Transcripts at `~/.cursor/projects/*/` or `agent-transcripts/` | `~/.claude/projects/<encoded-cwd>/*.jsonl` (where `<encoded-cwd>` is the workspace cwd with `/` → `-`) |
| Skill paths `.cursor/skills/`, `~/.cursor/plugins/` | `.claude/skills/`, `~/.claude/plugins/` |
| MCP discovery via Cursor's `mcps/` directory | Tool list at top of system prompt (`mcp__<server>__<name>` entries), or `.mcp.json`, or `claude mcp list` |
| Cursor cloud agents (`environment: "cloud"`, `cloud_base_branch`) | Local background subagents (`run_in_background: true`), isolated by git worktree |
| Cursor's `/goal` (standing objective across turns) | The program objective written into the run's standing orders and restated in the todolist |
| The Cursor agent store (path in the system prompt) | `~/.claude/orchestrate/<project-slug>/`, which survives the session restarts a multi-day program expects |
| Model rule `~/.cursor/rules/pstack-models.mdc` | Override sheet `~/.claude/pstack-models.md`, included from `CLAUDE.md` |
| Multi-model panels (arena, architect, interrogate) | Provider dispatch restores the upstream frontier panel as portable provider-qualified descriptors. Same-provider lanes stay native; external lanes use the bundled runner. Exact defaults and optional-provider descriptors live in the [dispatch contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#model-matrix). |

### Cross-vendor dispatch

The earlier port collapsed panels to Claude-only models. The bundled runner restores cross-provider panels through provider CLIs. The parent supplies each external worker with a complete task. The [provider dispatch contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) defines route selection and recovery.
### What's deliberately kept

- The `poteto-agent` subagent ID and all references to it.
- `run_in_background: true` on Agent calls (Claude Code supports it).
- `/loop`, `/deslop`, `/babysit` slash references in skill bodies — they all resolve in Claude Code now.
- The principle/playbook structure and upstream principle prose, except the local correctness edits in `principle-attack-the-premise` and `principle-test-behavior-not-implementation`.

### What's deliberately not ported

- **`automations/benny/`** (upstream `0452e08`, the only pstack change between `e46364b` and v0.10.0) — a dormant Slack issue-triage and reproduce-and-fix automation pack built on Cursor's event-triggered automations. It registers no slash skills even upstream, so excluding it changes nothing about the ported plugin's behavior. Porting it would require Cursor's event-trigger runtime, Slack, and tracker plumbing that Open Pstack does not provide.
- **`docs/guide/`** (upstream `02c03a9`, `0b7ef5b`, `424829e`) — the ten-chapter usage tutorial and its six screenshots (2.3 MB). It teaches pstack through Cursor's UI, sticky mode, and cloud agents, so a faithful port would be a rewrite rather than a sync, and none of it ships as skill content. Read it upstream at [cursor/plugins/pstack/docs/guide](https://github.com/cursor/plugins/tree/main/pstack/docs/guide); the concepts map through the substitution table above.
- **`make-bot-ui`** (upstream `799151d`, relocated by `6fecddb`) uses Cursor routines, webhook events, hosted bot state, and Cursor UI primitives that have no shared Claude Code and Codex mapping. A provider-specific rewrite would be a separate feature, not an upstream sync.
- **Solo code defaults** (upstream `23a56e2` and again `889ec4b`/`70b2dc8`) move `bug-fix`, `perf-issue`, and `hillclimb` off GPT-5.6 Sol. Open Pstack keeps these frequent delegated code roles on `codex:gpt-5.6-sol@max` because the alternatives cost much more per task.
- **Sticky mode** (upstream `#144`) — Cursor-only `mode`/`icon`/`color`/`reminder` frontmatter with no Claude Code equivalent. The port's 0.9.5 SessionStart hook is the analog and already carries the non-trivial / trivial / opt-out logic.
- **`is_background: true` on `poteto-agent`** (upstream `99559f2`) — Cursor names this key differently. Claude-native frontier definitions use `background: true`; ad-hoc `poteto-agent` calls remain background dispatches at the call site.
- **`cursor-team-kit` beyond the seven imported skills** — the rest either duplicate Claude Code built-ins (`verify-this` → the `verify` skill and built-in verification discipline; `check-compiler-errors` → LSP diagnostics; `control-cli`/`control-ui` → `run`/`verify`, already the substitution targets) or overlap skills this port ships (`loop-on-ci`, `review-and-ship`, `weekly-review` vs `babysit`, `fix-ci`, `make-pr-easy-to-review`, `what-did-i-get-done`). `pr-review-canvas` is Cursor-UI-specific.

### Forking note

Editing skill bodies forks this from upstream. Re-syncing to a future pstack release means re-applying the substitution table. The full re-port recipe is in [CHANGES.md](../CHANGES.md).

## Provider options

### Optional Antigravity workers

`antigravity:<exact-model-slug>@default` starts `agy` from either parent; workers expose file tools only and the parent runs tests. See the [dispatch contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#optional-antigravity-models) and [compatibility and live evidence](compatibility.md#antigravity-workers) for permissions, billing guards, and cleanup.

### Optional Cursor workers

`cursor:<exact-model-slug>@default` starts `cursor-agent` from either parent; read-only lanes use ask mode and writers need a dedicated workspace. See the [dispatch contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#optional-cursor-models) for the full contract.

### Optional model families

Beyond the first-run panel, the [model matrix](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#model-matrix) lists additional opt-in families for role assignment.

## License

MIT. Three upstream LICENSE files are preserved:

- [LICENSE](../LICENSE) — pstack (Lauren Tan)
- [LICENSE-cursor-team-kit](../LICENSE-cursor-team-kit) — Cursor (covers the seven imported Cursor Team Kit skills listed in NOTICE.md)
- [LICENSE-superpowers](../LICENSE-superpowers) — superpowers, Jesse Vincent (covers the vendored `hooks/run-hook.cmd`)
