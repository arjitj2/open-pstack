# Changelog

This file records what each version of the Open Pstack package changed. Versions `1.4.1-arjit.1` and later belong to Arjit Jaiswal's independently maintained distribution. Earlier versions come from Eric Litman's Open Pstack and the pstack-claude port that Michael Denyer started. They are summarized under [Inherited history](#inherited-history).

Entries describe package versions. Published release checkpoints have tag links; installation follows `main` unless pinned. Validation belongs to the linked pull requests. Older reports remain available through immutable links.

## 1.8.0 accepts newly available provider models

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #46](https://github.com/arjitj2/open-pstack/pull/46).

Supported external providers accept new model IDs without an Open Pstack release. Setup checks the selected ID through the provider's listing where available and a live probe. The model matrix supplies recommendations rather than an allowlist. Same-parent Claude models without a shipped native lane run through the external CLI, and Devin accepts exact model UIDs at default effort.

Evidence: [installed-parent validation](https://github.com/arjitj2/open-pstack/blob/ee45fe02edfdad335bc4297747043df3257ef766/docs/model-discovery-verification.md) and [recorded results](https://github.com/arjitj2/open-pstack/blob/ee45fe02edfdad335bc4297747043df3257ef766/docs/evidence/model-discovery-20260926.json).

## 1.7.0 adds optional OpenCode workers

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #32](https://github.com/arjitj2/open-pstack/pull/32).

Claude Code and Codex parents can assign an OpenCode worker with an exact `opencode:<provider>/<model>@default` descriptor. Existing assignments and the default panel do not change. OpenCode routes need explicit API-spend approval because the runner cannot prove subscription-only billing. The runner requires OpenCode 1.18.29 or newer.

Read-only workers inspect files. Writers edit their assigned Git worktree. Both modes deny shell commands, recursive dispatch, web tools, skills, and MCP tools. Each attempt uses private configuration and checks the effective configuration before inference. These are OpenCode permission checks, not an OS sandbox. Receipts record the pinned model argument. Unknown quota errors do not trigger a fallback.

Evidence: [OpenCode worker verification](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/opencode-worker-verification.md), covering installed Claude Code and Codex parents running the exact candidate.

## 1.6.1 fixes Devin read-only tool selection

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #31](https://github.com/arjitj2/open-pstack/pull/31).

Read-only Devin workers now disable the `exec` tool. Previously the model could select that tool, which the permissions denied, and the turn ended without a final answer. Writers keep sandboxed execution. Existing permission denials and final-answer checks are unchanged.

Evidence: the [Devin read-only investigation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-read-only-20260925.md), with sanitized [runner outcomes](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-read-only-20260925.json), [parent results](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-parent-validation-20260925.json), and [final candidate results](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-merge-validation-20260925.json).

## 1.6.0 adds optional Antigravity workers

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #33](https://github.com/arjitj2/open-pstack/pull/33).

Both parents can assign `antigravity:<agy-model-slug>@default` routes through `agy`. The default panel does not change. Workers use a bounded set of file tools. Writers work in their assigned worktree, and the parent runs tests. Every attempt needs a saved API-spend choice. Denial blocks known environment billing routes and unverified provider overrides in Antigravity settings. Quota failures are not yet classified. Receipts record the pinned model argument because Antigravity echoes the requested model.

Evidence: [Antigravity worker validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/antigravity-validation-20260925.md) and the [earlier Antigravity summary](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#antigravity-workers).

## 1.5.0 starts independent release numbering

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). Tag [v1.5.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.5.0). [Pull request #15](https://github.com/arjitj2/open-pstack/pull/15).

The distribution adopts its own version sequence and records each release's Cursor baseline. The package changes only the manifest versions. Worker code and skills are unchanged from 1.4.1-arjit.5.

After this release, the README made `main` the installation source ([#25](https://github.com/arjitj2/open-pstack/pull/25)), and the repository added its verification skill ([#27](https://github.com/arjitj2/open-pstack/pull/27)). Neither change affected the package. The [initial verification results](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/.agents/skills/verify-open-pstack/VERIFICATION.md) are preserved with that history.

Evidence: [1.5.0 packaging validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#version-150-packaging-validation).

## 1.4.1-arjit.5 recovers worker failures through approved backups

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). Tag [v1.4.1-arjit.5](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.5). [Pull request #13](https://github.com/arjitj2/open-pstack/pull/13).

Every provider has a quota adapter. A saved recovery policy can cover recognized usage limits, unavailable routes, terminal backend failures, and explicit deadlines. Existing model sheets stay quota-only until you save a broader policy.

When a worker fails, the parent checks the receipt, reports the failure and the approved backup, and continues without asking. If a writer had started, the parent inspects and preserves its partial work and continues in a fresh workspace. Cancellation, billing blocks, conflicting success evidence, unsafe work, and exhausted chains stop the lane. There is no implicit timeout, and an exhausted parent cannot recover itself.

Evidence: [1.4.1-arjit.5 recovery validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#version-141-arjit5-worker-recovery-validation).

## 1.4.1-arjit.4 adds subscription-aware setup and approved fallbacks

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). Tag [v1.4.1-arjit.4](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.4). [Pull request #11](https://github.com/arjitj2/open-pstack/pull/11).

Each role in the model sheet can list an ordered chain of up to three attempts, such as `primary -> fallback`. A single descriptor authorizes no fallback. `# access:` lines record each provider's funding facts and a binding `apiSpend` choice, without credentials or prices.

The new `pstack-model-policy` helper validates sheets and decides each attempt from the frozen sheet and the lane's history. The parent advances to a fallback only on a proven `usage-exhausted` receipt. At this version, the runner recognized exhaustion only in exact Codex and Grok diagnostics. A `billing-policy-blocked` receipt stops launches that the saved `apiSpend` choice does not allow.

Setup detects installed CLIs, sign-in state, and models, asks only for the subscription and spending facts it cannot detect, and recommends assignments and fallbacks. It probes every saved candidate and shows the complete change before writing.

Evidence: [subscription-aware setup validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#earlier-subscription-aware-setup-validation).

## 1.4.1-arjit.3 adapts Cursor Pstack through 0.15.5

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). Tag [v1.4.1-arjit.3](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.3). [Pull request #9](https://github.com/arjitj2/open-pstack/pull/9).

This version adapts the seven Cursor commits from `f8abedd` through `12d587df`:

- Skill prose uses operator-neutral wording, and the audit tick reports status in chat only for new information.
- Setup asks for a reasoning budget and caps requested effort without raising a lower effort.
- The first-run panel becomes `claude:opus@max`, `codex:gpt-5.6-sol@max`, and `grok:grok-4.7@xhigh`. Fable becomes an opt-in family.
- Autopilot and Shipping verify each code-ready round and track spawned children.
- Repeated instructions are trimmed, and the plan checker rejects unfilled placeholders and raw Cursor model selectors.

`bug-fix`, `perf-issue`, and `hillclimb` stay on `codex:gpt-5.6-sol@max`. Upstream's expected-runtime stand-down is not adopted because it is an implicit timeout.

With this version, the repository started tracking Cursor directly through a decision ledger and metadata-only proposals ([#6](https://github.com/arjitj2/open-pstack/pull/6), [#8](https://github.com/arjitj2/open-pstack/pull/8)). [Pull request #7](https://github.com/arjitj2/open-pstack/pull/7) catalogued these seven commits.

Evidence: the [Cursor adoption record](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/cursor-adoption-20260924.md) and [catch-up validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#cursor-catch-up-validation).

## 1.4.1-arjit.2 adds optional model families

Cursor baseline: [0.15.1](https://github.com/cursor/plugins/tree/f8abeddd1862dc73704e3d719dd73df0d51b8c71/pstack). Tag [v1.4.1-arjit.2](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.2). [Pull request #4](https://github.com/arjitj2/open-pstack/pull/4).

This version ports Ted Mader's Sonnet, Astra, Luna, and Terra support from ericlitman/open-pstack PR #55 (`ae37a16`). Sonnet uses a rolling Claude alias with native agents at five efforts. Astra, Luna, and Terra use exact Codex models. Native setup probes run only as many at once as the parent has capacity for. Selected-provider setup and the Devin and Cursor routes are unchanged, and the default panel does not change.

Evidence: [provider validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#earlier-provider-validation).

## 1.4.1-arjit.1 adds Devin and Cursor workers and selected-provider setup

Cursor baseline: [0.15.1](https://github.com/cursor/plugins/tree/f8abeddd1862dc73704e3d719dd73df0d51b8c71/pstack). Tag [v1.4.1-arjit.1](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.1). [Pull request #2](https://github.com/arjitj2/open-pstack/pull/2).

This is the first release of this distribution.

- Devin workers run from either parent. SWE-2 supports `medium`, `high`, and `max`. SWE-1.6 uses `default`. Read-only workers deny shell and writes. Writers use Devin's sandboxed shell in their worktree.
- Cursor workers run through `cursor-agent` with an exact model slug and `@default`, using private per-run permissions.
- Setup chooses roles first and probes only the assigned model families. You do not need every provider in the default panel. Architect needs at least two independent runner entries, which can use the same model.

Evidence: [provider validation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/compatibility.md#earlier-provider-validation).

## Inherited history

Earlier versions belong to the pstack-claude and Open Pstack ports on which this distribution builds. The [inherited change log](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/CHANGES.md#141-syncs-to-cursor-pstack-0151) preserves their entries and per-skill port audit. The [Cursor 0.15.0 sync plan](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/plans/upstream-0.15.0.md) remains available as historical evidence. See [NOTICE.md](NOTICE.md) for attribution.
