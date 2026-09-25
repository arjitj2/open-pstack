# Why this distribution exists

Pstack gives coding agents a shared engineering workflow: understand the problem, choose an approach, delegate work, and verify the result. This distribution brings that workflow to Codex and Claude Code while helping you use the model subscriptions you already have.

[Cursor’s original Pstack](https://github.com/cursor/plugins/tree/main/pstack), created by Lauren Tan, is built for work inside Cursor. [Eric Litman’s Open Pstack](https://github.com/ericlitman/open-pstack) brought those workflows to Codex and Claude Code and provides the foundation for this project.

Arjit Jaiswal maintains this distribution to develop provider routing, subscription-aware setup, and recovery through approved backups alongside the Pstack workflows. It makes its own compatibility and release decisions and tracks Cursor directly, so adopting changes does not depend on another port releasing them first. Shared skills and attribution remain part of that work.

The [README](../README.md#supported-parent-apps-and-worker-providers) is the reference for current parent apps, worker providers, and setup. [Compatibility evidence](compatibility.md) records tested behavior and limits. The [release history](releases.md) and [release notes](https://github.com/arjitj2/open-pstack/releases) identify what shipped and which Cursor content each release incorporates. The [maintenance policy](fork-maintenance.md) explains how updates are reviewed and validated.

This project preserves credit to Lauren Tan, Eric Litman, and Michael Denyer’s earlier Claude port. See [attribution](../NOTICE.md) for provenance and licenses, and [migration instructions](fork-maintenance.md#install-or-migrate) to switch distributions while preserving your model choices.
