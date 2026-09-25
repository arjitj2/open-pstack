# Open Pstack verification map

Run the parent skill's Launch and Doctor first. Use one fresh scratch store per run, retain evidence outside scratch, and record the exact entry point used. Parent tests require a dedicated authenticated session and a verified installed candidate; CLI tests need Bun and the checkout dependencies. Do not mutate personal setup to create fixtures.

## Features

- [Installation and discovery](installation.md): marketplace installation, reload, skill discovery in both parents.
- [Model setup](setup.md): selected-provider checks, confirmation, persistence, native probes.
- [Engineering workflows](workflows.md): invoking poteto-mode and direct focused skills.
- [Routing policy](routing.md): inspecting a saved role through the CLI and observing parent-owned dispatch.
- [Orchestration bookkeeping](orchestration.md): persistent work-unit state and inbox consumption through the real CLI.

## Proof and coverage

Capture command or parent action, output, exit status or native terminal state, and a second read of persistent changes. A path not exercised is unverified even if another entry point passed. Map entries are a starter set, not exhaustive coverage: watch-pr, plan checking, worktree auditing, all review panels, and upstream maintenance need their own recipes when changed. One CLI smoke validates the generated skill's harness; it does not validate all features or approve a release.

Each feature has four H2 sections: Sub-features, How to get to it (user POV), Driving it with the named harness, and Gotchas. Add new entry points and preconditions when product behavior changes.
