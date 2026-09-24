# Compatibility and release evidence

The stable package is [v1.4.1-arjit.2](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.2). Its Cursor content baseline is 0.15.1 at `f8abeddd1862dc73704e3d719dd73df0d51b8c71`. Later Cursor changes are recorded in [upstream status](../UPSTREAM.md). A reviewed or detected source commit is not necessarily incorporated in the stable package.

| Parent | Native workers | External workers |
| --- | --- | --- |
| Codex | Assigned Codex models or inherited parent | Claude, Grok, Devin, Cursor CLI |
| Claude Code | Assigned Claude models or inherited parent | Codex, Grok, Devin, Cursor CLI |

Only assigned providers need to be installed and authenticated. Run `setup-pstack` in the parent you use. Successful setup in one parent does not prove the other parent's routes work. Why and Reflect inherit the parent so they retain its connected tools.

External workers do not inherit the parent's MCP connections. Read-only Devin and Cursor workers cannot execute shell commands. See the [provider contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) for permissions, supported efforts, model evidence, and limitations.

## Evidence for the stable release

[Release PR #4](https://github.com/arjitj2/open-pstack/pull/4) records the exact candidate tested in installed Codex and Claude Code. Validation includes setup probes, confirmations, file readback, smoke workers, and independent judges. The release passed 223 Bun tests, strict typechecking, static checks, nine maintenance tests, and plugin validation.

The underlying provider rollout is recorded in [PR #2](https://github.com/arjitj2/open-pstack/pull/2). The original provider validation used Codex CLI 0.154, Claude Code 2.1.179, Cursor CLI 2026.09.10-fd3934a, and Devin CLI 3000.10.27bcbe88c7. These are recorded test environments, not a guarantee for every older or newer version. The optional-family release adds representative high-effort checks; it does not certify every possible model, effort, or subscription.

## Report a compatibility problem

Open an [issue here](https://github.com/arjitj2/open-pstack/issues/new). Include the installed Pstack tag, parent application and version, affected provider CLI version, requested model and effort, reproduction steps, and observed error. Redact credentials and private prompts. Do not upload raw conversation exports.
