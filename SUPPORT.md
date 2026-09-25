# Support and maintenance

Arjit Jaiswal maintains this distribution. Report problems in [arjitj2/open-pstack](https://github.com/arjitj2/open-pstack/issues), including problems with the packaged port. This project is not an official Cursor, OpenAI, Anthropic, or Cognition product.

Daily GitHub Actions checks detect Cursor changes. The maintainer aims to review the backlog weekly. These are review targets, not a response-time or release guarantee. GitHub schedules can be delayed or disabled; failed runs and the public maintenance issue expose interruptions.

For future stable releases, release notes must include the exact source baseline, validation evidence, known limitations, and a previous tested pin for rollback. The [compatibility page](docs/compatibility.md) and [migration guide](docs/fork-maintenance.md#install-or-migrate) provide those details for the current release. Pending updates are visible before release. A quiet upstream does not itself indicate a maintenance problem.

See the [install-source policy](docs/fork-maintenance.md#keep-main-ready-for-users) for normal installs and fixed checkpoints. To help test an unreleased candidate, use a separate installation or a disposable workspace and preserve your current model configuration. Never include authentication tokens or unredacted conversation exports in a public report.
