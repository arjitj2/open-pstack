# About this distribution

Arjit Jaiswal maintains this distribution of Pstack for Codex and Claude Code. Lauren Tan created Pstack at Cursor. This repository builds on Eric Litman's Open Pstack and the earlier Claude port by Michael Denyer. The original licenses and [attribution](../NOTICE.md) remain part of the repository.

Choose this distribution when you want Codex or Claude Code to coordinate work across the providers you already use. If Cursor is your parent application, use [Cursor's original Pstack](https://github.com/cursor/plugins/tree/main/pstack).

## What differs

This historical comparison describes `v1.4.1-arjit.4` and Eric's Open Pstack `1.4.1`. For the current release's subscription-aware routing and automatic recovery, see [compatibility and release evidence](compatibility.md).

| Capability | This distribution | Open Pstack 1.4.1 |
| --- | --- | --- |
| Codex and Claude Code parent applications | Supported | Supported |
| Devin SWE-2 and SWE-1.6 external workers | Optional | Not included |
| Cursor CLI external workers | Optional | Not included |
| Setup checks only assigned providers | Supported | Requires the baseline provider panel |
| Optional Sonnet, Astra, Luna, and Terra assignments | Included | Not included |
| Recorded Cursor content baseline | 0.15.5 | 0.15.1 |

Both distributions share much of the same engineering workflow. Additional provider support is not a claim that every model produces better code. Provider authentication, subscription limits, and available models remain the provider's responsibility.

## Independent maintenance

This repository makes its own compatibility, review, and release decisions. It checks Cursor directly, prepares update proposals, and publishes outstanding changes. Eric's repository remains a source of useful fixes and historical credit, not an update dependency.

An update proposal is not a release. Changes to prompts can alter behavior even when no executable code changes. They must be adapted and tested before they reach a stable package. The [maintenance policy](fork-maintenance.md) explains review targets and release gates.

Keep the existing `pstack:` skill names and `open-pstack` marketplace name when migrating. Follow the [migration instructions](fork-maintenance.md#install-or-migrate). Installing the distribution does not replace your model choices.
