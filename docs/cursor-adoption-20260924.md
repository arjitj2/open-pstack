# Cursor Pstack catch-up through 0.15.5

The `1.4.1-arjit.3` release incorporates applicable changes between Cursor commits `f8abeddd1862dc73704e3d719dd73df0d51b8c71` and `12d587dfb20741cafc376c42c696c5f6e2a64487`. The audit identified 45 changed paths: seven matched the previous source, 35 contained port adaptations, and three were distribution-specific.

The shared package passed installed-host validation in Codex and Claude Code. The ledger records the final adaptations and `UPSTREAM.md` advances the incorporated baseline to `12d587df`.

## Source decisions

| Source commit | Decision | Result |
| --- | --- | --- |
| `f5bdd682` | Adapted | Adopt operator-neutral wording and new-information status reports. Retain host standing orders and evidence-based cancellation. |
| `889ec4b6` | Adapted | Preserve the documented Sol defaults for bug fixes, performance work, and hillclimbing. Refresh the source README. Existing assignments override defaults. |
| `5bf2b154` | Adapted | Apply budget ceilings to the loaded configuration. Unlimited preserves efforts; other choices never raise a lower effort. Preserve models, aliases, fixed-effort providers, and lane order. |
| `70b2dc8b` | Adapted | Adopt the Opus, Sol, and Grok first-run panel, round-based verification, child tracking, and compatible workflow updates. Retain provider dispatch and guarded merges. |
| `b42effe0` | Adapted | Refresh the upstream README verbatim. Cursor-only guide files remain excluded. |
| `b0b9c7a0` | Adapted | Trim repeated prose while retaining provider contracts and mandatory verification gates. Independent review found no additional regression in this guidance. |
| `12d587df` | Adapted | Resolve configured roles consistently, clarify owner review responsibilities, and reject unresolved placeholders and malformed worker-descriptor syntax in plans. Exclude raw Cursor task fields and model fallback. |

## Provider adaptations

The first-run panel uses `codex:gpt-5.6-sol@max`, `grok:grok-4.7@xhigh`, and `claude:opus@max` in matrix order. Fable remains opt-in. Why and Reflect retain inherited roles because external workers lack the parent's connected tools.

Grok Build CLI advertises `grok-4.7`. Cursor's `fast` suffix is not a Grok CLI model or effort. A listing does not prove authenticated execution, so setup still probes every selected route. Unassigned providers require no credentials or probes. Installation does not rewrite user assignments.

A budget proposes a configuration change. Setup can propose SWE-2 high under a large budget because SWE-2 has no xhigh effort, but must show that change before confirmation. An unsupported stored descriptor remains invalid. Failed probes never cause model or effort substitution.

## Preserved exclusions

Cursor-only manifests, guides, `make-bot-ui`, direct task fields, and expected-runtime cancellation remain excluded. The distribution retains its shared skill tree, selected-provider setup, transactional writes, captured-SHA leases, queue disarming, and expected-head merge checks. Existing `UPSTREAM.md` exclusions remain in force.

The historical merge-probe fixture is unchanged. This catch-up does not rewrite its expected counts or turn absent add/delete cases into passing checks.

## Validation

Run Bun tests, strict typechecks, maintenance tests, static invariants, and manifest validation. The plan regression rejects unresolved placeholders, malformed descriptor syntax, and raw Cursor selectors while accepting a filled provider-qualified descriptor. This is a structural plan check; it does not validate provider/model/effort compatibility or account availability. Setup and provider dispatch own those checks.

The package at `5a6384df3fcf227c33b4bec98c73075cc67fdb64`, tree `66b2384d5c6421388d8c1b95da1de3d5e645db98`, passed real installed Codex and Claude checks. The checks covered budget selection, effort preservation, fixed-effort mappings, confirmed save/readback, native delegation, and an independent post-save judge. Mapping-only cases kept unprobed selected routes as blockers and left configuration unchanged.

[PR #9](https://github.com/arjitj2/open-pstack/pull/9) records the exact candidate and independent review. Codex CLI 0.154.0 and Claude Code 2.1.281 were used. Eight Claude cases passed after subscription access was restored. One case needed a recorded evidence-label correction, with its original transcript preserved. Native Claude transcripts report Opus 5.5; the requested effort is evidenced by the installed agent definition, not hidden model reasoning. Tests restored the captured `.2` installation, removed temporary Claude plugins, and verified unchanged global model settings.
