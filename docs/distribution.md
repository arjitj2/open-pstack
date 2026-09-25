# Why use this distribution

Use this distribution when you want **Codex or Claude Code to coordinate work across your Claude, Codex, Grok, Devin, and Cursor accounts**, recommend a model mix from the access you have, and continue through approved backups when a worker fails. It maintains provider integrations and releases independently while incorporating Cursor’s Pstack workflows.

Use [Cursor’s original Pstack](https://github.com/cursor/plugins/tree/main/pstack) when you want those workflows inside Cursor, using the models available there. [Eric Litman’s Open Pstack](https://github.com/ericlitman/open-pstack) is the earlier port to Codex and Claude Code, with Claude, Codex, and Grok workers. This distribution builds on that port and adds the capabilities below.

## Compare the three distributions

This comparison covers **our `1.5.0`**, **Eric’s `1.4.1`**, and **Cursor Pstack `0.15.5`**. It describes Pstack’s shipped setup and routing, not every feature or recovery mechanism that the host applications might provide.

| Capability | This distribution 1.5.0 | Eric’s Open Pstack 1.4.1 | Cursor Pstack 0.15.5 |
| --- | --- | --- | --- |
| Parent app where you start work | Codex or Claude Code | Codex or Claude Code | Cursor |
| Worker access | Claude, Codex, Grok, Devin SWE-2/SWE-1.6, and Cursor CLI | Claude, Codex, and Grok | Model slugs available to Cursor’s native subagents |
| Setup and subscriptions | Discovers provider/model access, asks about unverified subscriptions, recommends role assignments, and records API-spend permission separately | Configures and probes the baseline provider/model panel | Detects available Cursor models and saves role assignments and a reasoning budget |
| Missing providers | Only selected providers must pass setup | Baseline provider panel must pass | Uses models available in the Cursor session |
| Worker recovery in Pstack | Saved, approved backup chains and failure policies, with visible notices and partial-work inspection | Explicit failures; no automatic provider substitution | No external-provider backup-chain contract in the upstream setup skill |
| Cursor content incorporated | 0.15.5, with documented adaptations and exclusions | 0.15.1, with documented adaptations and exclusions | Original 0.15.5 content |
| Update process | Direct Cursor monitoring, adaptation, review, real-host checks, and independent releases | Its own documented Cursor sync and release process | Source of the original workflows |

The main additions over Eric’s port are **more worker providers, setup based on your actual subscriptions and selected routes, and automatic approved backups**. Direct Cursor tracking also lets this distribution adopt updates without waiting for another port’s release. It does not guarantee that every Cursor change is included immediately.

All three share the Pstack engineering approach. More providers do not guarantee better code. External workers use their own authentication and do not inherit the parent’s MCP connections. A provider appearing in the table does not guarantee access to every model on every subscription. See [supported routes and validation](compatibility.md).

Recovery follows saved choices and API-spend permissions. A quiet worker is not assumed to have failed. An exhausted parent, unsafe partial work, or the absence of a safe approved backup can still stop progress. The [recovery evidence](compatibility.md#version-141-arjit5-worker-recovery-validation) records what was tested and its limits.

## Sources and release history

- Our [1.5.0 provider contract](https://github.com/arjitj2/open-pstack/blob/v1.5.0/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) and [setup workflow](https://github.com/arjitj2/open-pstack/blob/v1.5.0/plugins/pstack/skills/setup-pstack/SKILL.md).
- Eric’s [1.4.1 provider contract](https://github.com/ericlitman/open-pstack/blob/v1.4.1/plugins/pstack/skills/poteto-mode/references/provider-dispatch.md), [setup workflow](https://github.com/ericlitman/open-pstack/blob/v1.4.1/plugins/pstack/skills/setup-pstack/SKILL.md), and [Cursor baseline and sync policy](https://github.com/ericlitman/open-pstack/blob/v1.4.1/UPSTREAM.md).
- Cursor’s [0.15.5 setup workflow](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/skills/setup-pstack/SKILL.md) and [original README](https://github.com/cursor/plugins/blob/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack/README.md).

Our [release history](releases.md) records the exact incorporated Cursor commit and exclusions for every release. A detected update or proposal is not a released feature. Changes must be adapted and tested before publication under the [maintenance policy](fork-maintenance.md).

## Attribution and migration

Lauren Tan created Pstack at Cursor. This distribution builds on Eric Litman’s Open Pstack and the earlier Claude port by Michael Denyer. The original licenses and [attribution](../NOTICE.md) remain part of the repository.

The `pstack:` skill names and `open-pstack` marketplace name stay the same when migrating. Follow the [migration instructions](fork-maintenance.md#install-or-migrate). Installing this distribution does not replace your model choices.
