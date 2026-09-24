# Compatibility and release evidence

The stable package is [v1.4.1-arjit.4](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.4). Its Cursor content baseline is 0.15.5 at `12d587dfb20741cafc376c42c696c5f6e2a64487`. Later Cursor changes are recorded in [upstream status](../UPSTREAM.md). A reviewed or detected source commit is not necessarily incorporated in the stable package.

| Parent | Native workers | External workers |
| --- | --- | --- |
| Codex | Assigned Codex models or inherited parent | Claude, Grok, Devin, Cursor CLI |
| Claude Code | Assigned Claude models or inherited parent | Codex, Grok, Devin, Cursor CLI |

Only assigned providers need to be installed and authenticated. Run `setup-pstack` in the parent you use. Successful setup in one parent does not prove the other parent's routes work. Why and Reflect inherit the parent so they retain its connected tools.

External workers do not inherit the parent's MCP connections. Read-only Devin and Cursor workers cannot execute shell commands. See the [provider contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) for permissions, supported efforts, model evidence, and limitations.

## Evidence for the stable release

[Release PR #11](https://github.com/arjitj2/open-pstack/pull/11) adds subscription-aware setup and explicitly approved worker fallbacks. The tested package tree is `cddd6d809d2c9b7e5a06ff04e05bdea9c75c8f60`. It passed 329 Bun tests, strict typechecks, 26 maintenance tests, and static/plugin checks.

Installed tests in Codex CLI 0.154.0 and Claude Code 2.1.281 exercised confirmed setup/save/readback with native smoke and separate judging, approved native fallback, legacy no-fallback, ordinary authentication errors, and started-writer preservation. Both installed policy helpers rejected exhausted-but-unauthorized routes and forged skip history. Quota failures were injected with a network-free test double; the approved native workers were real calls. This does not certify real quota exhaustion in every provider.

External quota recognition currently covers verified Codex/Grok workload formats. Claude, Devin, and Cursor external quota formats remain ordinary failures until verified. A fallback cannot recover an exhausted parent controller. Local API guards do not prove that a provider has disabled account-managed overage. Tests preserved the captured `.2` installation and global model settings.

## Cursor catch-up validation

[Release PR #9](https://github.com/arjitj2/open-pstack/pull/9) records the Cursor catch-up and installed checks with Codex CLI 0.154.0 and Claude Code 2.1.281. Budget selection, custom-effort preservation, fixed-effort mappings, confirmed save/readback, native workers, and separate judges passed. The package passed 225 Bun tests, strict typechecks, 26 maintenance tests, and static/plugin checks. The captured `.2` installation and global model settings were restored. See the [adoption report](cursor-adoption-20260924.md) for evidence limits.

## Earlier provider validation

[Release PR #4](https://github.com/arjitj2/open-pstack/pull/4) records the exact candidate tested in installed Codex and Claude Code. Validation includes setup probes, confirmations, file readback, smoke workers, and independent judges. The release passed 223 Bun tests, strict typechecking, static checks, nine maintenance tests, and plugin validation.

The underlying provider rollout is recorded in [PR #2](https://github.com/arjitj2/open-pstack/pull/2). The original provider validation used Codex CLI 0.154, Claude Code 2.1.179, Cursor CLI 2026.09.10-fd3934a, and Devin CLI 3000.10.27bcbe88c7. These are recorded test environments, not a guarantee for every older or newer version. The optional-family release adds representative high-effort checks; it does not certify every possible model, effort, or subscription.

## Report a compatibility problem

Open an [issue here](https://github.com/arjitj2/open-pstack/issues/new). Include the installed Pstack tag, parent application and version, affected provider CLI version, requested model and effort, reproduction steps, and observed error. Redact credentials and private prompts. Do not upload raw conversation exports.
