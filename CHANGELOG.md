# Changelog

This file records what each version of the Open Pstack package changed. Versions `1.4.1-arjit.1` and later belong to Arjit Jaiswal's independently maintained distribution. Earlier versions come from Eric Litman's Open Pstack and the pstack-claude port that Michael Denyer started. They are summarized under [Inherited history](#inherited-history).

Entries describe package versions. Published release checkpoints have tag links; installation follows `main` unless pinned. Validation belongs to the linked pull requests. Older reports remain available through immutable links.

## 1.10.2 enables worker local checks

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Issue #103](https://github.com/arjitj2/open-pstack/issues/103). [PR #104](https://github.com/arjitj2/open-pstack/pull/104). Tag [v1.10.2](https://github.com/arjitj2/open-pstack/releases/tag/v1.10.2).

Writers receive tool-specific guidance and check their changes before returning. External Claude writers use sandboxed Bash for local checks, with no unsandboxed retry. File-only providers retain parent check handoffs. Parent acceptance and Git ownership remain separate from worker reports.

## 1.10.1 fixes the documented receipt-normalization command

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Issue #99](https://github.com/arjitj2/open-pstack/issues/99). [PR #100](https://github.com/arjitj2/open-pstack/pull/100). Tag [v1.10.1](https://github.com/arjitj2/open-pstack/releases/tag/v1.10.1).

Provider-dispatch instructions invoke the executable policy wrapper so normalization returns a receipt event or rejects invalid input. Regression tests execute the documented command and check its output and rejection behavior.

## 1.10.0 adds opt-in Codex startup routing

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Issue #88](https://github.com/arjitj2/open-pstack/issues/88). [PR #92](https://github.com/arjitj2/open-pstack/pull/92). Tag [v1.10.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.10.0).

Codex can route engineering requests into Pstack through an optional plugin hook, enabled through its native `/hooks` trust controls. Startup, resume, clear, and compaction reuse the shared routing instruction. A routing-only setup request leaves model assignments and spending permissions unchanged.

## 1.9.1 packages license texts and credits the Open Pstack port

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Issue #82](https://github.com/arjitj2/open-pstack/issues/82). Tag [v1.9.1](https://github.com/arjitj2/open-pstack/releases/tag/v1.9.1).

The packaged plugin now ships full copies of `LICENSE`, `NOTICE.md`, and both `LICENSES/` texts alongside the skills, so an installed plugin carries the upstream licenses and attribution record instead of pointing back at the repository root. The included-sources table credits Eric Litman's Open Pstack port alongside the Cursor, Cursor Team Kit, and Superpowers sources, and `tests/skill-collision-repro.sh` fails if the packaged copies drift from the canonical files.

Published with an explicit maintainer exception for the outstanding Claude Code validation. The [release notes](https://github.com/arjitj2/open-pstack/releases/tag/v1.9.1) identify the checks that remain unverified.

## 1.9.0 exposes external worker lifecycle progress

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [PR #71](https://github.com/arjitj2/open-pstack/pull/71). Tag [v1.9.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.9.0).

External lanes accept an optional `--progress` path: an exclusively reserved, private, atomically replaced lifecycle snapshot carrying the derived phase, last-observed direct-child state, content-free byte activity, and cancellation facts. `pstack-runner status` reads explicit progress/receipt pairs, probes launcher identity by process start time, and prints one coalesced line or bounded JSON per lane. Terminal outcomes still come only from the receipt; a finished marker without a valid receipt reports `unknown`, and an absent or reused launcher pid reports `interrupted` rather than active. Receipts, parsing, cancellation, deadlines, cleanup, and recovery policy are unchanged.

Published with an explicit maintainer exception for the outstanding Claude Code validation. The [release notes](https://github.com/arjitj2/open-pstack/releases/tag/v1.9.0) identify the checks that remain unverified.

## 1.8.6 gives workers a shared parent-owned Git contract

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Issue #57](https://github.com/arjitj2/open-pstack/issues/57). Tag [v1.8.6](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.6).

Native and external workers now receive the same parent-owned Git and handoff instructions. The runner distinguishes delivered handoffs from task completion, while the parent can validate a scoped checkpoint and record an idempotent operation before continuing a blocked execution. Same-route continuation requires explicit saved policy and parent inspection evidence. Strict confinement reports unsupported on every route until a live runtime boundary is proven; the default legacy contract remains prompt guidance.

Published with an explicit maintainer exception for the outstanding Claude Code validation. The [release notes](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.6) identify the checks that remain unverified.

## 1.8.5 bounds failure-receipt diagnostics

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [PR #68](https://github.com/arjitj2/open-pstack/pull/68). Tag [v1.8.5](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.5).

Failure receipts persist a bounded provider-aware diagnostic instead of truncated raw output: launcher notes, canonical quota codes, selected terminal fields and structural capture counts. Intermediate prompts, reasoning, tool IO, narration, unknown envelope fields, and arbitrary stderr are excluded from persisted diagnostics. Retained terminal result or error text can still quote task content. Routing, quota, timeout, cancellation, and cleanup semantics are unchanged.

## 1.8.4 requires Codex final-turn completion

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [PR #58](https://github.com/arjitj2/open-pstack/pull/58). Tag [v1.8.4](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.4).

Codex workers publish output only when the final turn completes with valid text and consistent available framing. A shared assessment preserves recovery from intermediate errors and keeps protocol completion as a replay veto when output validation or process exit fails.

## 1.8.3 disables inherited Devin refusal fallback

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [PR #56](https://github.com/arjitj2/open-pstack/pull/56). Tag [v1.8.3](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.3).

The runner removes inherited `DEVIN_REFUSAL_FALLBACK` from Devin child environments. That inherited variable can no longer enable model substitution outside the assigned route. The parent environment, pinned model, billing controls, and permissions are unchanged.

## 1.8.2 verifies Claude's primary model

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Issue #45](https://github.com/arjitj2/open-pstack/issues/45). Tag [v1.8.2](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.2).

Claude workers verify the model from main-conversation assistant events. A requested model that appears only in helper usage no longer passes verification. Missing or conflicting primary evidence fails closed, and generic failure receipts omit the verbose transcript. See the [verification recipe and evidence](tests/claude-primary-model/README.md).

## 1.8.1 omits Claude authentication-status probes

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #41](https://github.com/arjitj2/open-pstack/pull/41). Tag [v1.8.1](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.1).

Claude workers and setup skip the separate auth-status command because startup refresh can consume a token without saving its replacement. Authentication happens in the task. Known API environment guards and the empty settings-source list under `apiSpend: deny` remain, but Claude billing type is explicitly unverified. Other providers retain their checks. See [the recorded exception](https://github.com/arjitj2/open-pstack/issues/38) and [reproduction](tests/claude-auth-repro/README.md).

## 1.8.0 accepts newly available provider models

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #46](https://github.com/arjitj2/open-pstack/pull/46). Tag [v1.8.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.8.0).

Supported external providers accept new model IDs without an Open Pstack release. Setup checks the selected ID through the provider's listing where available and a live probe. The model matrix supplies recommendations rather than an allowlist. Same-parent Claude models without a shipped native lane run through the external CLI, and Devin accepts exact model UIDs at default effort.

Evidence: [installed-parent validation](https://github.com/arjitj2/open-pstack/blob/ee45fe02edfdad335bc4297747043df3257ef766/docs/model-discovery-verification.md) and [recorded results](https://github.com/arjitj2/open-pstack/blob/ee45fe02edfdad335bc4297747043df3257ef766/docs/evidence/model-discovery-20260926.json).

## 1.7.0 adds optional OpenCode workers

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #32](https://github.com/arjitj2/open-pstack/pull/32). Tag [v1.7.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.7.0).

Claude Code and Codex parents can assign an OpenCode worker with an exact `opencode:<provider>/<model>@default` descriptor. Existing assignments and the default panel do not change. OpenCode routes need explicit API-spend approval because the runner cannot prove subscription-only billing. The runner requires OpenCode 1.18.29 or newer.

Read-only workers inspect files. Writers edit their assigned Git worktree. Both modes deny shell commands, recursive dispatch, web tools, skills, and MCP tools. Each attempt uses private configuration and checks the effective configuration before inference. These are OpenCode permission checks, not an OS sandbox. Receipts record the pinned model argument. Unknown quota errors do not trigger a fallback.

Evidence: [OpenCode worker verification](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/opencode-worker-verification.md), covering installed Claude Code and Codex parents running the exact candidate.

## 1.6.1 fixes Devin read-only tool selection

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #31](https://github.com/arjitj2/open-pstack/pull/31). Tag [v1.6.1](https://github.com/arjitj2/open-pstack/releases/tag/v1.6.1).

Read-only Devin workers now disable the `exec` tool. Previously the model could select that tool, which the permissions denied, and the turn ended without a final answer. Writers keep sandboxed execution. Existing permission denials and final-answer checks are unchanged.

Evidence: the [Devin read-only investigation](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-read-only-20260925.md), with sanitized [runner outcomes](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-read-only-20260925.json), [parent results](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-parent-validation-20260925.json), and [final candidate results](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/docs/devin-merge-validation-20260925.json).

## 1.6.0 adds optional Antigravity workers

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/12d587dfb20741cafc376c42c696c5f6e2a64487/pstack). [Pull request #33](https://github.com/arjitj2/open-pstack/pull/33). Tag [v1.6.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.6.0).

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
