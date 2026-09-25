Closes #

## What changed


## Verification

- [ ] Bun tests, strict typecheck, static invariants, and plugin validation pass.
- [ ] For plugin changes, the exact candidate is installed in every affected harness.
- [ ] The changed behavior passes from each affected user surface.
- [ ] Evidence below names the version or commit, action, and observed result.
- [ ] Maintenance-only changes prove plugin-tree equality and exercise the changed CLI or workflow.

Live evidence:


## Documentation impact

Owner doc updated at <path>, or `none, <reason>` when there is no user-facing change. See the [documentation ownership map](../AGENTS.md#documentation-ownership).

Use installed-host evidence for plugin changes and actual CLI or workflow evidence for maintenance-only changes. A pull request without applicable live evidence remains a draft. Do not merge, tag, release, or roll it out.
