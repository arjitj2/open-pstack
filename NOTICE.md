# Attribution

Open Pstack adapts MIT-licensed work for Claude Code and Codex. The complete license texts are preserved in [LICENSE](LICENSE) and [LICENSES/](LICENSES/).

## Project lineage

[Lauren Tan](https://github.com/cursor/plugins/tree/main/pstack) created Pstack. [Michael Denyer's pstack-claude](https://github.com/michael-denyer/pstack-claude) port is the origin of this repository's history, through import commit `053ed78732e3b71826933170eafe7f7782dda844`. [Eric Litman's Open Pstack](https://github.com/ericlitman/open-pstack) adapted it for a shared Claude Code and Codex distribution.

Arjit Jaiswal maintains this distribution independently and tracks Cursor's Pstack directly. This does not imply affiliation with or endorsement by Cursor or the maintainers of other ports.

Ted Mader contributed optional Sonnet, Astra, Luna, and Terra model support in [ericlitman/open-pstack#55](https://github.com/ericlitman/open-pstack/pull/55), original commit `ae37a1615d8d45bc6faee6e22130f2f5aa06abfe`. This distribution adapts that work for its provider setup and dispatch.

## Included sources

| Component | Copyright | License |
| --- | --- | --- |
| Pstack-derived skills, agents, playbooks, tools, and assets from [cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack) | (c) 2026 Lauren Tan | [MIT](LICENSE) |
| Cursor Team Kit skills `deslop`, `thermo-nuclear-code-quality-review`, `make-pr-easy-to-review`, `fix-ci`, `fix-merge-conflicts`, `get-pr-comments`, and `what-did-i-get-done`, imported at [`e46364b`](https://github.com/cursor/plugins/tree/e46364b8be46000b7df0f260550cd712afbb8d36/cursor-team-kit/skills) | (c) 2026 Cursor | [MIT](LICENSES/LICENSE-cursor-team-kit) |
| `plugins/pstack/hooks/run-hook.cmd`, adapted near-verbatim from Superpowers 6.1.0 in [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/superpowers), originally obra/superpowers | (c) 2025 Jesse Vincent | [MIT](LICENSES/LICENSE-superpowers) |

[UPSTREAM.md](UPSTREAM.md) records the incorporated Pstack revision. The [historical import record](https://github.com/arjitj2/open-pstack/blob/5f0bb42dea46344c2f1961ebeebaeee135b49778/NOTICE.md#upstream-sources) identifies earlier component revisions, including the initial `e46364b` import and subsequent `3fe2823`, `bdf7aa3`, `efa2a53`, `71ed0d1`, `f8abedd`, and `12d587df` updates. Source files retain their upstream notices where present.

## Port modifications

The port changes Cursor-specific tools, paths, and harness instructions for Claude Code and Codex. The [upstream maintenance guide](UPSTREAM.md#port-adaptations) describes those adaptations.

Port-authored work includes the plugin and marketplace manifests, Codex tool mapping, native Claude agent definitions, setup and provider integrations, tests, and repository documentation. The standalone `babysit` skill is informed by Cursor's public behavior without copying its implementation or prose. The SessionStart hook is port-authored except for the attributed Superpowers launcher above.
