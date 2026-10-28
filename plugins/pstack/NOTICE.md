# Attribution

Open Pstack adapts MIT-licensed work for Claude Code and Codex. The complete license texts are preserved in [LICENSE](LICENSE) and [LICENSES/](LICENSES/). Copies of this notice, `LICENSE`, and `LICENSES/` ship inside the packaged plugin at `plugins/pstack/`; the canonical files live at the repository root.

## Project lineage

[Lauren Tan](https://github.com/cursor/plugins/tree/main/pstack) created Pstack. [Michael Denyer's pstack-claude](https://github.com/michael-denyer/pstack-claude) port is the origin of this repository's history, through import commit `053ed78732e3b71826933170eafe7f7782dda844`. [Eric Litman's Open Pstack](https://github.com/ericlitman/open-pstack) adapted it for a shared Claude Code and Codex distribution.

Arjit Jaiswal maintains this distribution independently and tracks Cursor's Pstack directly. This does not imply affiliation with or endorsement by Cursor or the maintainers of other ports.

Ted Mader contributed optional Sonnet, Astra, Luna, and Terra model support in [ericlitman/open-pstack#55](https://github.com/ericlitman/open-pstack/pull/55), original commit `ae37a1615d8d45bc6faee6e22130f2f5aa06abfe`. This distribution adapts that work for its provider setup and dispatch.

## Included sources

| Component | Copyright / attribution | License |
| --- | --- | --- |
| Pstack-derived skills, agents, playbooks, tools, and assets from [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) | (c) 2026 Lauren Tan | [MIT](LICENSE) |
| Port-authored adaptations for the shared Claude Code and Codex distribution from [Eric Litman's Open Pstack](https://github.com/ericlitman/open-pstack) | Eric Litman | [MIT](LICENSE) |
| Cursor Team Kit skills `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, and `what-did-i-get-done`, imported at [`e46364b`](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills) | (c) 2026 Cursor | [MIT](LICENSES/LICENSE-cursor-team-kit) |
| `plugins/pstack/hooks/run-hook.cmd`, adapted near-verbatim from Superpowers 6.1.0 in [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/superpowers), originally obra/superpowers | (c) 2025 Jesse Vincent | [MIT](LICENSES/LICENSE-superpowers) |

[UPSTREAM.md](https://github.com/arjitj2/open-pstack/blob/main/UPSTREAM.md) records the incorporated Pstack revision. The [historical import record](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/NOTICE.md#upstream-sources) identifies earlier component revisions, including the initial `e46364b` import and subsequent `3fe2823`, `bdf7aa3`, `efa2a53`, `71ed0d1`, `f8abedd`, and `12d587df` updates. Source files retain their upstream notices where present.

## Port modifications

The port changes Cursor-specific tools, paths, and harness instructions for Claude Code and Codex. The [upstream maintenance guide](https://github.com/arjitj2/open-pstack/blob/main/UPSTREAM.md#port-adaptations) describes those adaptations.

Port-authored work includes the plugin and marketplace manifests, Codex tool mapping, native Claude agent definitions, setup and provider integrations, tests, and repository documentation. The standalone `babysit` skill is informed by Cursor's public behavior without copying its implementation or prose. The SessionStart hook is port-authored except for the attributed Superpowers launcher above. This distribution adapts Cursor's `ketchup` skill with Codex manual-invocation metadata, automated-event exclusions, and portable read-only status checks. The `in-your-own-words` and `sharpen` skills retain manual invocation in both hosts. GitHub frontier discovery adapts Cursor’s base-chain traversal with explicit repository identity, published-head checks and clear unsupported-fork failures.

Further Cursor adaptations preserve parent-owned delegation, grounded in-reply comparisons, usable application readiness, paged review-state aggregation, and portable plan and worktree audit checks. This port adds fail-closed pagination guards and explicit transcript scoping.

The `afd51cf6` Ketchup adaptation preserves existing media, explanatory diagrams, plain action bullets and grounded choice comparisons for both hosts, with the port’s read-only and UI-authorization boundaries.

The `e5136d8` principle adaptations replace blanket recipes with evidence about premises, legitimate state, repeatable operations and observable testing contracts, while retaining portable host controls.

The `99743e9` adaptation shortens the migration, type-system, Swarm and lead-review guidance while retaining portable metadata, parent-owned dispatch, saved recovery and compatibility conditions.

The `182f2ce` adaptation retains the shared Codex/Claude tree while applying the Claude question-tool mapping to setup and recognizing upstream's official Claude package. Its generated tree and incompatible routing and transcript rules are not imported.

The `0317eb8` TypeScript update adopts Lauren Tan's verifying type-guard branding rule and example. The `a968159` naming validation is adapted to this distribution's static checks. The generated Claude tree and alternate setup policies from `1b80080` remain excluded.

The formal-verification creation and maintenance skills, complete Ketchup call lists, and Sharpen prompt-ban removal derive from Cursor commits through [`d457567`](https://github.com/cursor/plugins/tree/d457567332aa6989e753ea289f30ea2bfbc80bc0/pstack). Port adaptations preserve host-local skill registration, scoped proof, parent Git ownership, approved provider policy and optional post-setup offers. Cursor-specific guide prose and the generated duplicate Claude tree remain excluded.
The Statechart compiler and skill, Ketchup Video, watcher, check-plan and worktree-audit fixes, and the playbook and review-prose updates derive from Cursor commits through [`ab1f702`](https://github.com/cursor/plugins/tree/ab1f702ce8e8b6557edb56b09f52cde8bfb83f17/pstack). Port adaptations preserve host invocation names, model-invocable Statechart, manual-only Ketchup Video, read-only review lanes, parent Git ownership, and the saved provider and verifier policies.

The Orchestrate supervision rules derive from [`c742dd6`](https://github.com/cursor/plugins/tree/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack). Port adaptations retain the public bookkeeping CLI, parent Git ownership and saved recovery policy while requiring live PR reports and evidence before worker cancellation.
