# Engineering workflows

Users invoke poteto-mode for an engineering task or call a focused skill directly; the parent coordinates the work with its approved role assignments.

## Sub-features

- `workflow-entry`: select the installed poteto-mode skill and follow its task routing.
- `workflow-direct`: invoke a focused skill without the general entry point.

## How to get to it (user POV)

Claude Code: `/pstack:poteto-mode` or `/pstack:how`. Codex: select the same names in the skill picker, or mention `$pstack:poteto-mode` and `$pstack:how`.

## Driving it with the parent apps

Preconditions: installed candidate identity established, authenticated selected providers, and a saved approved sheet. Read the installed provider-dispatch reference before dispatch. Use a test task attached to this checkout; do not alter the user's model assignments.

- **General entry:** submit `Use pstack:poteto-mode. Explain how the orch CLI persists a work unit. Do not edit files.` Capture the skill invocation, selected workflow, dispatched descriptors, and result. Expect an explanation grounded in the CLI and store source with no file mutations.
- **Direct entry:** in a separate test session submit `Use pstack:how. Explain how orch unit get reads persisted work. Do not edit files.` Observe the configured explorer/explainer routes, their terminal outcomes, and a source-grounded answer. Record any unavailable assigned provider as a dropout under the saved policy.
- **Evidence:** retain parent input, skill loads, native events or external receipts, and `git status --short` plus `git diff` before and after. Verify referenced source locations and the stated persistence behavior against the orchestration recipe.

## Gotchas

- These prompts prove read-only workflow entry; they do not cover implementation, architect, arena, or review panels.
- Reading a skill manually or launching an external worker directly does not prove the parent selected it.
- Do not add a timeout, weaker model, or unsaved backup to finish a verification run.
