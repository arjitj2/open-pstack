---
name: setup-pstack
description: Configure pstack's provider-qualified models, per-family requested effort, and parent-owned routes per role. Verifies only the assigned native and external model lanes before writing the override sheet. Use for /setup-pstack, "configure pstack models", or changing pstack's model choices.
---

# Setup pstack

Configure one portable model sheet for the current parent harness. Read [`provider-dispatch.md`](../poteto-mode/references/provider-dispatch.md) before probing or writing anything. Its model matrix, descriptor grammar, and route table are the contract. Choose one requested effort per assigned matrix family. Do not add a second configuration file, a runtime resolver, or a weaker-model fallback.

Claude Code writes `~/.claude/pstack-models.md` and loads it from `~/.claude/CLAUDE.md` with:

```text
@~/.claude/pstack-models.md
```

Codex writes `~/.codex/pstack-models.md`. Codex has no `@` include, so mirror the sheet's exact bytes inside one bounded block in `~/.codex/AGENTS.md` and retain the sheet as the editable source of truth:

```text
<!-- pstack:models:begin -->
<exact contents of ~/.codex/pstack-models.md>
<!-- pstack:models:end -->
```

## Steps

### 1. Establish the parent

Use the harness and tool surface running this skill: Claude Code or Codex. Environment markers may corroborate that top-level answer, but do not launch a child and ask it to detect where it came from. Record the parent because the same descriptor takes a different route in each harness.

### 2. Load current state

Read the current parent-specific sheet when it exists. Before matrix validation, normalize only the rolling-alias predecessors that earlier pstack releases generated. A provider-qualified Claude model is migratable when its model component starts with `claude-fable-` or `claude-opus-` and the remaining revision contains only digits and hyphens. Replace that component in memory with `fable` or `opus`, preserving the provider, effort, role, and lane order. Record each original and normalized descriptor for the confirmation in step 7. This migration is valid loaded state and does not require a separate operator choice.

Treat the normalized values as current role-to-family assignments. Overlay those rows on the complete first-run role map in step 7. Materialize any missing documented role row from that map on the next successful write. A duplicate or unknown role row is inconsistent state; report it and resolve it before probing. A bare host-native slug from an older sheet is also invalid because it does not say which provider owns it. A versioned Claude model outside the two migration families remains inconsistent state. If the sheet is missing, use the complete first-run role map and the model matrix's Default effort cells.

### 3. Select role assignments

Show the normalized complete role map, the model matrix, and this parent's routes. Ask whether to keep the assignments or change named roles. Preserve current assignments by default; on a first run, explain that the example uses all four families but none is mandatory. The operator can replace named lanes with a matrix family, `inherit-parent`, or `auto`, or remove named entries from a panel. A request to omit a provider must resolve every occurrence, including single-model roles and panel entries. Do not silently remap missing providers, reset customized lanes, or drop an entire role. Keep at least one lane per panel and exactly one descriptor for each single-model role.

Why and Reflect require the parent's live MCP surface. Keep their investigator, reviewer, and synthesizer roles on `inherit-parent` or `auto`. Preserve all documented role rows, and preserve the order of untouched lanes. Say when replacements or removals reduce provider diversity. If the operator already named role changes, apply those without asking them to repeat the choice.

Derive the assigned family set from the resulting role descriptors, excluding `inherit-parent` and `auto`. An unassigned family is optional: do not ask for its effort, check its CLI or credentials, or probe it. A missing Grok CLI cannot block a configuration with no Grok roles. Availability checks must not choose assignments for the operator.

### 4. Validate and choose assigned efforts

Every non-alias value must match `<provider>:<model>@<effort>` and map to exactly one matrix family by `(provider, model)`. Require the effort to appear in that row's Selectable efforts cell. An unmatched provider/model, out-of-domain effort, duplicate role, or unknown role is inconsistent state. Show the conflicting rows verbatim and resolve them through an explicit matrix family or alias replacement before probing or writing.

Collect one requested effort for each assigned family only. Name the model, its Selectable efforts, and its current value; propose the matrix Default effort for a newly assigned family. Empty input keeps that value. If loaded roles use mixed efforts within an assigned family, show all conflicting rows and ask for one effort from that family's Selectable efforts. Do not invent precedence. Honor efforts the operator already explicitly selected.

An effort-only rerun preserves each role's family and lane order. Rewrite every occurrence of an assigned family to its selected effort; leave aliases unchanged. If every role uses an alias, there are no family effort questions or model-pair probes.

### 5. Probe the assigned routes

Probe each distinct assigned `provider:model@effort` pair once, even when two assigned families share a provider. Do not enumerate or offer older models as substitutes. The table below defines routes for families that are assigned; it is not a required-provider checklist.

If any role uses `inherit-parent` or `auto`, also run one tiny read-only native inherited-agent probe with a unique marker before writing. It must use the parent's native delegation surface with the model omitted, even when there are no explicit model pairs. Reuse that successful alias-route result for aliases within this setup run only while the parent and native route remain unchanged. A disabled or unavailable native delegation tool fails this probe; the parent answering the marker itself does not count.

A failed probe writes nothing. Report the failing pair or inherited native route, cause, and affected roles. Let the operator repair availability and retry, explicitly remap or remove affected lanes via step 3, or cancel. Recompute assigned families and efforts after any role change, and probe any new or changed pairs before proceeding. Successful results may be reused only within this setup run for the same parent, pair, and unchanged route. Do not treat a failed selected lane as successful or silently replace it. Until every final selected pair and any required alias-route probe passes, keep the active sheet and parent integration bytes unchanged; a failed first run creates neither artifact.

| Family | Pair source | Claude parent route | Codex parent route | Availability proof |
|---|---|---|---|---|
| Fable | Fable matrix row + selected effort | native Agent `pstack-fable-<effort>` | Claude CLI | native one-turn probe or `claude auth status --json` plus one-turn probe |
| Sol | Sol matrix row + selected effort | `codex exec` | native `spawn_agent` | `codex login status` plus one-turn probe or native one-turn probe |
| Grok | Grok matrix row + selected effort | Grok CLI | Grok CLI | `grok models` must list the requested model; one-turn probe |
| Opus | Opus matrix row + selected effort | native Agent `pstack-opus-<effort>` | Claude CLI | native one-turn probe or `claude auth status --json` plus one-turn probe |

Use a tiny read-only probe that returns a unique marker. A login-status command alone proves credentials, not that the requested model and effort flags run. Record native and external results separately. Never call the external launcher for the parent's own provider. On a Claude parent, the Fable and Opus probes are one-turn runs of the mapped `pstack-<stem>-<effort>` agent. On a Codex parent, the Sol probe is native `spawn_agent` with the selected `reasoning_effort`. Every other pair uses the external runner with the selected effort flag.

Receipts and native transcripts prove the requested effort and the route. They do not prove a provider's hidden applied reasoning depth. There is no implicit timeout, weaker-model fallback, same-provider external fallback, or second mutable configuration source.

### 6. Render the selected role map

Build the new sheet in memory from the complete role map selected in step 3 and the requested efforts from step 4. Do not write it yet. Validate complete role coverage, nonempty panels, Why/Reflect aliases, and successful step 5 results for every non-alias descriptor and the inherited native route whenever aliases are present. Refuse an unqualified slug, unavailable selected route, family outside the model matrix, or provider/model mismatch.

There is no requirement to assign every matrix family. Efforts persist only in assigned role descriptors; do not add placeholder roles or another configuration source to store unassigned efforts. If the operator changes a role at confirmation, return to step 3 and revalidate its resulting pairs before writing.

### 7. Confirm and commit

Show any rolling-alias migrations as original and normalized descriptors. Then show the route table for this parent and every rendered role and descriptor. Ask for confirmation before writing.

Why and Reflect require the parent's live MCP surface. Keep their investigator, reviewer, and synthesizer roles on `inherit-parent` or `auto`; the bounded external runner deliberately omits ambient MCPs. `inherit-parent` and `auto` are valid descriptors, but their native route must pass step 5. Say when they reduce a panel's provider diversity. For panel roles, one lane runs per entry. The list length is the fan-out count. `arena cross-judge pool` is a list from which Arena chooses a provider different from the parent and base candidate when possible. `swarm workers` is the default for every worker unless a race explicitly assigns another descriptor.

Every non-alias value must match `<provider>:<model>@<effort>` and must have passed step 5. Any aliases require a successful inherited native-route probe.

After the operator confirms, write the in-memory render from step 6. Never paste the example below as the result. It is only the complete first-run role map used to seed step 2; selected efforts and explicit role changes always replace its example values before writing.

```markdown
# pstack model configuration

Provider-qualified per-role choices. Read the installed pstack provider-dispatch reference before dispatching a configured role. Every documented role remains present. `inherit-parent` and `auto` use the parent model natively and still count as one panel lane.

feature, refactoring: grok:grok-4.6@xhigh
bug-fix: codex:gpt-5.6-sol@max
perf-issue: codex:gpt-5.6-sol@max
hillclimb: codex:gpt-5.6-sol@max
judgment and prose: claude:fable@max
hardest tasks: claude:fable@max
how explorer: grok:grok-4.6@xhigh
how explainer: claude:fable@max
why investigators, synthesizer: inherit-parent
reflect tooling, judgment, divergent, synthesizer: inherit-parent
arena runners: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
arena cross-judge pool: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
swarm workers: grok:grok-4.6@xhigh
architect runners: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
interrogate reviewers: claude:fable@max, codex:gpt-5.6-sol@max, grok:grok-4.6@xhigh, claude:opus@xhigh
```

### 8. Wire it in

Render the parent integration in memory before either write. On Claude, the integration is the single `@~/.claude/pstack-models.md` include in `~/.claude/CLAUDE.md`. On Codex, it is the exact sheet bytes between one `<!-- pstack:models:begin -->` and `<!-- pstack:models:end -->` pair in `~/.codex/AGENTS.md`. Replace that whole bounded block on a rerun. Insert one block at the end on first run. If either marker is missing, duplicated, or reversed, stop and report inconsistent state instead of guessing a boundary.

Snapshot every target's current bytes. Write the sheet and parent integration only after all required assigned-pair and inherited native-route probes pass and the operator confirms. Read both targets back and compare them with the in-memory render. If either write or readback fails, restore every snapshot and report the failure. An unchanged rerun must produce byte-identical sheet and integration content after normalization.

Do not copy the model sheet between harnesses without rerunning the parent-specific probes; route availability can differ even on the same host.

### 9. Behavioral smoke

Before declaring setup complete, run one small read-only panel from this parent using each distinct assigned descriptor, with distinct output/receipt paths and an independent cross-judge from the configured cross-judge pool. If any roles use aliases, also exercise a native inherited lane; for an alias-only sheet, that native lane is the whole panel. Use a different-provider judge when the configured pool permits it, otherwise use a separate native or configured judge and report the reduced diversity. Never add an unassigned provider merely to make the smoke multi-provider. A smoke failure leaves setup incomplete; report the failing lane and return to step 3 or let the operator repair and retry. Launch Claude-native agents and every external process in the background with retained handles, then drain them. Verify the native transcript entries and every external receipt. A structural config check or unit test is not a substitute.

Report the sheet path, parent route table, requested-effort probe results, smoke results, and external elapsed/token/cost receipts. Re-running this skill re-probes and updates the same sheet. Do not claim the provider exposed hidden applied-effort observability.
