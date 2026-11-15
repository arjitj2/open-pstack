---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
---

# How

Explore the codebase to answer the user's question. State your interpretation if the scope is ambiguous.

Resolve `how explorer` and `how explainer` through [provider dispatch](../poteto-mode/references/provider-dispatch.md), including its frozen sheet, exact descriptors and efforts, worker contracts, saved recovery, spending gates, completion evidence, and named dropouts. Use its legacy unconfigured defaults only when permitted: `grok:grok-4.7@xhigh` for explorers and `claude:opus@max` for the explainer. Children never route themselves. On Codex, apply [the tool mapping](../poteto-mode/references/codex-tools.md).

For a narrow question, dispatch one read-only `how explainer` lane to explore and explain in one pass. Prefer this path when unsure.

For a cross-cutting subsystem or architectural overview, dispatch 2–4 read-only `how explorer` lanes on distinct angles. Each traces actual entry points, calls, data, boundaries, and surprising behavior. Each returns findings with file and symbol references, files read, and unresolved gaps. After all lanes reach verified terminal outcomes, dispatch one read-only `how explainer` with their complete findings and named dropouts. This planned synthesis is not a retry of a denied explorer.

Give the explainer this brief:

> Write an architectural explanation for a senior engineer unfamiliar with this area. Read the actual code and explain the flow, central abstractions, ownership, inputs, outputs, and non-obvious constraints. Reconcile conflicting findings against source. Cite useful files and symbols. Mark anything you could not trace. Use Overview, Key Concepts, How It Works, Where Things Live, and Gotchas where useful. Include a diagram only when it clarifies the flow. Build a working mental model without annotating every line.

Verify the explainer's terminal result before presenting it. Light edits for clarity or conversation context are fine; do not substantially rewrite it. If it drops out, report that limit rather than silently substituting parent work.
