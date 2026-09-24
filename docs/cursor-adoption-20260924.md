# Cursor Pstack catch-up through 0.15.5

The `1.4.1-arjit.3` candidate incorporates applicable changes between Cursor commits `f8abeddd1862dc73704e3d719dd73df0d51b8c71` and `12d587dfb20741cafc376c42c696c5f6e2a64487`. The audit identified 45 changed paths: seven matched the previous source, 35 contained port adaptations, and three were distribution-specific.

These decisions remain proposed until installed-host validation passes. The ledger keeps all seven entries pending, and `UPSTREAM.md` still identifies the tested `.2` release. A candidate version is not a published release.

## Source decisions

| Source commit | Proposed decision | Result |
| --- | --- | --- |
| `f5bdd682` | Adapted | Adopt operator-neutral wording and new-information status reports. Retain host standing orders and evidence-based cancellation. |
| `889ec4b6` | Adapted | Preserve the documented Sol defaults for bug fixes, performance work, and hillclimbing. Refresh the source README. Existing assignments override defaults. |
| `5bf2b154` | Adapted | Apply budget ceilings to the loaded configuration. Unlimited preserves efforts; other choices never raise a lower effort. Preserve models, aliases, fixed-effort providers, and lane order. |
| `70b2dc8b` | Adapted | Adopt the Opus, Sol, and Grok first-run panel, round-based verification, child tracking, and compatible workflow updates. Retain provider dispatch and guarded merges. |
| `b42effe0` | Adopted for mapped content | Refresh the upstream README verbatim. Cursor-only guide files remain excluded. |
| `b0b9c7a0` | Adapted | Trim repeated prose while retaining provider contracts and mandatory verification gates. Independent review found no additional regression in this guidance. |
| `12d587df` | Adapted | Resolve configured roles consistently, clarify owner review responsibilities, and reject unresolved or malformed worker descriptors in plans. Exclude raw Cursor task fields and model fallback. |

## Provider adaptations

The first-run panel uses `codex:gpt-5.6-sol@max`, `grok:grok-4.7@xhigh`, and `claude:opus@max` in matrix order. Fable remains opt-in. Why and Reflect retain inherited roles because external workers lack the parent's connected tools.

Grok Build CLI advertises `grok-4.7`. Cursor's `fast` suffix is not a Grok CLI model or effort. A listing does not prove authenticated execution, so setup still probes every selected route. Unassigned providers require no credentials or probes. Installation does not rewrite user assignments.

A budget proposes a configuration change. Setup can propose SWE-2 high under a large budget because SWE-2 has no xhigh effort, but must show that change before confirmation. An unsupported stored descriptor remains invalid. Failed probes never cause model or effort substitution.

## Preserved exclusions

Cursor-only manifests, guides, `make-bot-ui`, direct task fields, and expected-runtime cancellation remain excluded. The distribution retains its shared skill tree, selected-provider setup, transactional writes, captured-SHA leases, queue disarming, and expected-head merge checks. Existing `UPSTREAM.md` exclusions remain in force.

The historical merge-probe fixture is unchanged. This catch-up does not rewrite its expected counts or turn absent add/delete cases into passing checks.

## Validation

Run Bun tests, strict typechecks, maintenance tests, static invariants, and manifest validation. The plan regression rejects unresolved placeholders, malformed descriptors, and raw Cursor selectors while accepting a filled provider-qualified descriptor.

Before release, install the exact candidate in Codex and Claude. Exercise budgets, effort preservation, fixed-effort mappings, confirmation and saved configuration, native delegation, independent post-save judging, and unavailable selected routes leaving configuration unchanged. Restore the captured installation and model files afterward.

The pull request records the exact candidate and observed results. Claude execution currently returns an account error stating that its organization has disabled subscription access for Claude Code. Login status alone does not satisfy the live gate. This candidate remains a draft until that validation passes.
