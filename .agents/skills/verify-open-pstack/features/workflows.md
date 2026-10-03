# Engineering workflows

Users invoke poteto-mode for an engineering task or call a focused skill directly; the parent coordinates the work with its approved role assignments.

## Sub-features

- `workflow-entry`: select the installed poteto-mode skill and follow its task routing.
- `workflow-direct`: invoke a focused skill without the general entry point.
- `workflow-benchmark`: the benchmark-checklist skill vets a measured number and inspects machine load portably.
- `workflow-fresh-worker`: a follow-up or retry goes to a fresh subagent with consolidated scope, not a resumed one.
- `workflow-schema-cast`: boundary parsing is schema-first, not a hand-rolled guard ending in `as`.
- `workflow-hourly-tick`: program playbooks propose an hourly audit tick through the host's scheduler, and wait for authorization to arm it.
- `workflow-pr-headings`: a PR body uses `##` section headings, deferring to the repository's own PR template.

## How to get to it (user POV)

Claude Code: `/pstack:poteto-mode` or `/pstack:how`. Codex: select the same names in the skill picker, or mention `$pstack:poteto-mode` and `$pstack:how`.

## Driving it with the parent apps

Preconditions: installed candidate identity established, authenticated selected providers, and a saved approved sheet. Read the installed provider-dispatch reference before dispatch. Use a test task attached to this checkout; do not alter the user's model assignments.

- **General entry:** submit `Use pstack:poteto-mode. Explain how the orch CLI persists a work unit. Do not edit files.` Capture the skill invocation, selected workflow, dispatched descriptors, and result. Expect an explanation grounded in the CLI and store source with no file mutations.
- **Direct entry:** in a separate test session submit `Use pstack:how. Explain how orch unit get reads persisted work. Do not edit files.` Observe the configured explorer/explainer routes, their terminal outcomes, and a source-grounded answer. Record any unavailable assigned provider as a dropout under the saved policy.
- **Benchmark vetting:** in a fresh parent session submit `Use pstack:benchmark-checklist. I measured the export endpoint at p50 120 ms before my change and 95 ms after, two runs per side on this machine. Vet the number before I report it. Do not edit files.` Expect the reply to inspect machine load with `uptime` plus `nproc` on Linux or `sysctl -n hw.ncpu` on macOS, never an unconditional `nproc`, and to demand a named limiter, error counts, and run spread. A claimed speedup with no named limiter must come back inconclusive.
- **Fresh-worker decision:** in a fresh parent session, run a small delegated task through `pstack:poteto-mode` and let its subagent finish, then submit `Follow up: rename the helper it added. Same scope.` Expect a fresh subagent spawned with consolidated scope (the original brief, the follow-up, and the prior agent's report and branch), not a resume of the finished agent. A resume is expected only when the follow-up needs state trapped in the old agent, such as uncommitted changes or a live process. A failed lane's authorized continuation must produce a fresh execution identity with the failed worktree and receipt preserved, never a reset of the prior attempt.
- **Schema-first casts:** stage a scratch TypeScript file containing `const user = data as User` and a property-by-property guard, then in a fresh parent session submit `Use pstack:typescript-best-practices. Refactor this boundary so no 'as' cast remains.` Expect the result to derive the type from a runtime schema (`z.infer`) or annotate the schema with `z.ZodType<User>` when the type comes first, not a hand-validated guard that ends in `return data as User`.
- **Hourly scheduling:** in a fresh parent session submit `Use pstack:poteto-mode. Draft the program checklist for a three-PR autopilot queue and stop before execution.` Read the emitted checklist. Expect a proposed hourly cadence (`/loop 1h` on Claude Code, the documented Codex cadence on Codex), a tick prompt that re-reads only the execution playbook, and no goal or standing-orders arming step, no 30-minute cadence, and no cadence left to memory. Confirm that no scheduler or goal was created. The shipped `check-plan.mjs` must accept the emitted skeleton; run it against the emitted plan as CLI evidence only.
- **PR headings:** in a scratch repository with no pull request template, ask `pstack:poteto-mode` to prepare a PR body for a supplied change without publication. Expect `##` section headings (`Why`, `What changed`, `Scope`, `Tradeoffs`, `Blast Radius`, `Verification`), not bold lead-ins. Repeat in a scratch repository that ships `.github/pull_request_template.md` with different sections and expect the template's sections to win.
- **Evidence:** retain parent input, skill loads, native events or external receipts, and `git status --short` plus `git diff` before and after. Verify referenced source locations and the stated persistence behavior against the orchestration recipe.

## Gotchas

- The general and direct entry prompts prove read-only workflow entry; they do not cover implementation, architect, arena, or review panels.
- The benchmark, fresh-worker, schema-cast, and PR-heading fixtures prove the loaded skill's guidance in the reply or diff; they do not prove a completed benchmark, a merged PR, or an armed loop.
- Reading a skill manually or launching an external worker directly does not prove the parent selected it.
- Do not add a timeout, weaker model, or unsaved backup to finish a verification run.
