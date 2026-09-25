# Open Pstack, maintained by Arjit

This Open Pstack distribution lets Codex and Claude Code coordinate coding work across the AI subscriptions you already have. Arjit Jaiswal maintains it as an intelligent model router built around Pstack's engineering workflows.

Supported worker providers are **Anthropic Claude, OpenAI Codex, xAI Grok, Devin (SWE-2 and SWE-1.6), and Cursor**. Codex and Claude Code are the supported parent apps.

`setup-pstack` checks provider and model access, asks about subscriptions it cannot verify, and recommends models for implementation, investigation, and review. You approve the assignments and backup chains during setup. Pstack routes workers to those models and automatically uses approved backups when the saved policy allows recovery. It tells you what failed and which model is taking over, and inspects and preserves partial work before continuing.

This repository maintains its own provider integrations, recovery behavior, and tested releases while tracking Cursor's Pstack directly. It builds on Lauren Tan's original Pstack and Eric Litman's Open Pstack port, with their attribution preserved.

See [release evidence and recovery limits](docs/compatibility.md), [why use this distribution](docs/distribution.md), [release history and Cursor baselines](docs/releases.md), and [upstream status](UPSTREAM.md).

[![CI](https://github.com/arjitj2/open-pstack/actions/workflows/ci.yml/badge.svg)](https://github.com/arjitj2/open-pstack/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/arjitj2/open-pstack)](https://github.com/arjitj2/open-pstack/releases/latest)
[![MIT license](https://img.shields.io/github/license/arjitj2/open-pstack)](LICENSE)

## Why use this distribution

Choose based on where you run Pstack and how you want to use your model subscriptions:

- **Cursor’s original Pstack** is Lauren Tan’s engineering workflow for Cursor. It assigns work to models available inside Cursor. Use it when Cursor is your parent app.
- **Eric Litman’s Open Pstack** brings those workflows to Codex and Claude Code, with Claude, Codex, and Grok workers. It provides the foundation for this distribution.
- **This distribution** adds Devin and Cursor CLI workers, subscription-aware model recommendations, setup that checks only the providers you select, and automatic recovery through your approved backup chains. It tracks Cursor directly and publishes its own tested releases, without waiting for Eric’s port to incorporate changes.

Read [why this distribution exists](docs/distribution.md) for its relationship to Cursor’s original and Eric’s port. The [release history](docs/releases.md) records the Cursor content incorporated in each release.

Routing follows the role assignments you approve. Setup recommends a mix based on task fit and confirmed access. The saved policy controls which models run and when a backup can take over.

Recovery can cover recognized quota limits, unavailable routes, terminal backend failures, and explicitly configured deadlines. Existing configurations remain quota-only until a broader policy is saved. A quiet worker is not assumed to have failed; an exhausted parent or a chain with no safe, approved backup cannot recover automatically. See [tested behavior and limits](docs/compatibility.md).

## Supported parent apps and worker providers

The **parent** is the app where you start a task. It coordinates the work and keeps your tools and conversation context. A **worker** is a model it delegates a bounded task to.

| Worker provider | From a Codex parent | From a Claude Code parent |
| --- | --- | --- |
| OpenAI / Codex | Native Codex subagent | External `codex` CLI |
| Anthropic / Claude | External `claude` CLI | Native Claude Code subagent |
| xAI / Grok | External `grok` CLI | External `grok` CLI |
| Devin SWE-2 / SWE-1.6 | External `devin` CLI | External `devin` CLI |
| Cursor models | External `cursor-agent` CLI | External `cursor-agent` CLI |

**This distribution supports Codex and Claude Code as parents.** Grok, Devin, and Cursor are worker providers here. For Cursor as your parent app, use [Cursor's original Pstack](https://github.com/cursor/plugins/tree/main/pstack). Provider availability does not guarantee access to every model: setup checks the exact models you select.

External workers use their own authentication and do not inherit the parent's MCP connections. Why and Reflect stay native so they retain those tools. See [compatibility](docs/compatibility.md) for supported models, permissions, and tested routes.

## What pstack does

pstack is a plugin for coding agents. It is not a new model or a hosted service. It gives your agent engineering rules, step-by-step workflows for different kinds of work, focused skills, and small local tools.

The normal entry point is `poteto-mode`. You give it a task in plain language. It then:

- reads the task and chooses a workflow that fits;
- learns how the current system works before changing it;
- compares designs when the choice matters;
- favors small, simple changes over extra machinery;
- asks several models to challenge important decisions when useful;
- runs the code and checks real behavior instead of stopping at “the tests pass”; and
- carries the work through review, continuous integration (CI), and a ready-to-merge pull request when asked.

![How pstack routes a task through focused skills, real-app proof, and a review-ready pull request](assets/pstack-workflow.png)

pstack does not ask you to trust an agent on day one. It helps the agent leave evidence you can inspect. Start with supervised work. Let it run more work in parallel only after its checks have earned that trust in your own repositories.

## Install

Start with a current Claude Code or Codex installation. Install and sign in to the command-line tools for the external providers you choose; unused providers are optional. [Bun](https://bun.sh) runs Pstack's local routing tools. Setup checks access before saving your model choices.

Open the [latest release](https://github.com/arjitj2/open-pstack/releases/latest) and copy its tag. Replace `<release-tag>` in the commands below with that tag, including its leading `v`. Pinning a release keeps your installation on a tested package.

### Claude Code

Run these commands inside Claude Code:

```text
/plugin marketplace add arjitj2/open-pstack#<release-tag>
/plugin install pstack@open-pstack
/reload-plugins
```

### Codex

Run these commands in your shell:

```shell
codex plugin marketplace add arjitj2/open-pstack --ref <release-tag>
codex plugin add pstack@open-pstack
```

Turn on Codex subagents in `~/.codex/config.toml` so pstack can compare work in parallel:

```toml
[features]
multi_agent = true
```

Start a new Codex task after installation so it can discover the new skills and setting.

## Get started

Configure your model access once for each parent app you use. Then start a task. Repository-specific verification is a separate step below.

### 1. Set up the models

In Claude Code, run:

```text
/pstack:setup-pstack
```

In the Codex app, type `/` and select `pstack:setup-pstack` from the skill list. You can also mention the skill with `$pstack:setup-pstack`. In Codex CLI, use `/skills` or type `$pstack:setup-pstack`. Asking for the skill by name works too; the words “Use pstack” are not required. See OpenAI's [slash commands](https://learn.chatgpt.com/docs/reference/slash-commands) and [skill invocation](https://learn.chatgpt.com/docs/build-skills#how-chatgpt-and-codex-use-skills).

Setup discovers the models you can run, asks about subscriptions it cannot verify, and recommends assignments for each role. It shows which models will run natively and which will use external workers, then asks before saving. Included subscription access and permission for metered API spending are recorded separately; unknown remaining capacity stays unknown.

You can save an ordered backup chain for each role, with up to three attempts. During a run, Pstack follows those approved choices and reports substitutions. Recovery depends on the installed release and saved policy; see [recovery support and validation](docs/compatibility.md). If a failed worker may have changed files, the parent inspects and preserves that work before continuing in a fresh workspace. An unsafe or ambiguous result stops that lane with a checkpoint.

Only selected providers need to pass setup. You can mix providers across implementation, investigation, and review or keep the configuration small. See the [model matrix](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#model-matrix) for supported models and effort levels.

Setup also migrates older versioned Fable, Opus, and Sonnet entries to rolling aliases while preserving role assignments and effort. Run setup after an update to persist that migration.

### 2. Use poteto-mode

Start any task that needs careful engineering with `poteto-mode`.

In Claude Code:

```text
/pstack:poteto-mode Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

In the Codex app, type `/`, select `pstack:poteto-mode`, and add your task. A skill mention also works in Codex:

```text
$pstack:poteto-mode Add saved filters to search. Keep the design simple, verify it in the real app, and open a pull request.
```

For that feature, poteto-mode should first understand how search works today. It should decide how the data should be represented before writing code, implement the smallest complete version, run the feature the way a user would, review the result, and prepare the pull request.

The skill name is `poteto-mode`, spelled with an “e”. Claude Code also loads this distribution's startup instruction for non-trivial engineering work. In Codex, select the skill explicitly or add a standing instruction if you want it used by default. Model setup saves routing preferences; it does not install an always-on Codex workflow instruction.

That is the main workflow. The other skills are there when poteto-mode needs them or when you want to call one directly.

### 3. Add verification for your repository

`setup-pstack` verifies model access, saves your approved model sheet and parent integration, reads them back, and runs a small worker-and-reviewer smoke test. It does **not** create an app feature map or schedule repository maintenance.

For a repository without a repeatable way to test real behavior, invoke `pstack:create-verification-skill`. It inspects how the app starts and can be driven, creates a project-local verification skill, and seeds a feature map with the first few user-facing features. Each entry describes how to reach the feature, exercise it, and recognize success. The generated skill must prove one mapped feature live before handoff; that initial map is a starting point, not a claim of complete coverage.

Use `pstack:maintain-verification-skill` as the app changes. It checks the map against source and live behavior and can propose a PR correcting drift. These skills work through the same picker or mention mechanism described above. Use `/pstack:create-verification-skill` and `/pstack:maintain-verification-skill` in Claude Code.

This release includes the creation and maintenance workflows, but no automatic feature-map maintenance schedule. Recurring upkeep must be configured separately in your parent app or another scheduler. Installing Pstack does not silently start background jobs.

## Useful skills

| Skill | Use it when |
| --- | --- |
| `how` | You want a clear explanation of how part of the system works. |
| `why` | You want evidence for why the system was built that way. |
| `architect` | A change crosses a function or module boundary and the design needs to be settled first. |
| `arena` | You want several complete attempts, followed by a comparison of their best parts. |
| `interrogate` | You want different models to try to break a design or diff. |
| `create-verification-skill` | Your project has no repeatable way for an agent to prove real behavior. |
| `maintain-verification-skill` | The project's verification instructions no longer match the product. |
| `babysit` | A pull request needs CI failures and review comments handled until it is ready. |
| `reflect` | A hard task is finished and its lessons should improve the next run. |

Plugin skills include `pstack:` in their name. In Claude Code, invoke `/pstack:architect`. In Codex, select `pstack:architect` from the skill picker or mention `$pstack:architect`. See the [technical reference](docs/reference.md) for the full list.

## Models and token use

Some pstack workflows use one model. Skills such as `architect`, `arena`, and `interrogate` can run several models in parallel. Each model run uses the access configured for its native app or external CLI: included subscription capacity or explicitly approved API spending.

`setup-pstack` lets you choose the models, one requested effort per assigned model family, and how many run in parallel. Choose role assignments first; setup checks only the models those roles use. Unused providers need no CLI or subscription. If a selected model fails, repair its availability or explicitly change the affected roles before saving. A model from the app you are using runs inside that app. Other models run through their own command-line tools. Open Pstack does not quietly replace a failed model with a weaker one.

## Learn from the original

Lauren's [pstack guide](https://github.com/cursor/plugins/tree/main/pstack/docs/guide) walks through a real task, verification, and longer unattended runs. It uses Cursor's interface, but the ideas are the same. Use the translated skill invocations above in Claude Code or Codex.

This repository also keeps:

- [the original README](README-UPSTREAM.md), unchanged;
- [the technical reference](docs/reference.md) for every skill, dependency, and Claude Code or Codex detail;
- [the upstream sync record](UPSTREAM.md) and update process;
- [the change record](CHANGES.md) for every adaptation; and
- [the attribution record](NOTICE.md) for pstack and the imported Cursor Team Kit skills.

## How releases track Cursor’s Pstack

This distribution has its own release numbers. Each release records the Cursor Pstack version and exact source commit it incorporates, along with adaptations and exclusions. Find those details in the [release history](docs/releases.md), [release notes](https://github.com/arjitj2/open-pstack/releases), and [upstream sync record](UPSTREAM.md).

Scheduled checks detect changes in Cursor’s original Pstack and prepare proposals. Adoption work reviews those changes, adapts them to the shared Codex and Claude Code skill tree, and validates affected behavior in the real parent apps before release. Pending changes remain visible until they are adopted, adapted, or excluded with a reason. Detection does not imply immediate inclusion.

Provider discovery, model routing, and recovery evolve independently in this distribution. Useful fixes from Eric’s port and other sources are reviewed separately. See the [maintenance policy](docs/fork-maintenance.md) for the process and release gates.

## Contributing

Fixes for Claude Code or Codex and help bringing over new pstack releases are welcome. Search [GitHub Issues](https://github.com/arjitj2/open-pstack/issues) before opening a new issue. For larger behavior changes, explain why the change belongs in Open Pstack instead of Lauren's original project.

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [UPSTREAM.md](UPSTREAM.md) before changing content brought over from Lauren's pstack. Pull requests must keep one shared skill tree for Claude Code and Codex and pass the repository's tests, type checks, plugin validation, and static checks.

## License

MIT. pstack was created by Lauren Tan. Open Pstack builds on Michael Denyer's [pstack-claude](https://github.com/michael-denyer/pstack-claude) port and includes attributed MIT-licensed work from Cursor Team Kit and Superpowers. See [NOTICE.md](NOTICE.md) and the preserved license files for details.
