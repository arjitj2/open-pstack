# Compatibility and release evidence

The stable package is [v1.4.1-arjit.5](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.5). Its Cursor content baseline is 0.15.5 at `12d587dfb20741cafc376c42c696c5f6e2a64487`. Later Cursor changes are recorded in [upstream status](../UPSTREAM.md). A reviewed or detected source commit is not necessarily incorporated in the stable package.

| Parent | Native workers | External workers |
| --- | --- | --- |
| Codex | Assigned Codex models or inherited parent | Claude, Grok, Devin, Cursor CLI |
| Claude Code | Assigned Claude models or inherited parent | Codex, Grok, Devin, Cursor CLI |

Only assigned providers need to be installed and authenticated. Run `setup-pstack` in the parent you use. Successful setup in one parent does not prove the other parent's routes work. Why and Reflect inherit the parent so they retain its connected tools.

External workers do not inherit the parent's MCP connections. Read-only Devin and Cursor workers cannot execute shell commands. See the [provider contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) for permissions, supported efforts, model evidence, and limitations.

## Evidence for the stable release

[Release PR #13](https://github.com/arjitj2/open-pstack/pull/13) adds provider-complete quota adapters and saved recovery policies for unavailable routes, terminal backend failures, and explicit deadlines. The tested plugin tree is `f9dd098a1ae5525a2aa2f00141d0f58aaed1bb37`, frozen at candidate `c78598543fb60f357e9c6edf96045d7e9d61ed4f`. All 185 package files matched in both installed hosts. It passed 426 Bun tests, four strict typechecks, 26 maintenance tests, and static/plugin checks. Compile mutation checks rejected a provider without an adapter and an unmapped receipt status.

Installed checks passed in the Codex desktop and Claude Code 2.1.281. Each host ran nine controlled failure scenarios through the installed runner and policy helper. Real native backup workers completed a read-only task and continued a failed writer's task from a separate snapshot while preserving its partial file. The parent announced the failure, inspection, and selected backup without asking for a replacement. Claude records these messages as narration-tagged blocks; a separate check of the same session in its default interactive terminal confirmed that the notices display before the corresponding actions. Legacy quota-only policy stopped on a terminal failure. Synthetic negative controls rejected mismatched receipts, conflicting completion evidence, cancellation, billing blocks, unsafe inspection, and exhausted chains.

Codex desktop backups explicitly requested GPT-6 Sol at high effort through its native subagent tool; that tool did not expose a separate backend model identity field. Claude native worker transcripts reported Opus 5.5 at high effort. The desktop parent read the installed candidate instructions in an existing session; this was not a fresh plugin discovery test. A separate Codex CLI 0.154.0 attempt rejected GPT-6 Sol with ChatGPT authentication before tests began. Native desktop success does not establish that external CLI route's availability.

The failed providers were network-free test doubles; the backup model calls were real. Claude quota handling includes a captured real exhaustion response. Devin fixtures use diagnostics from the installed CLI. Cursor fixtures combine installed error framing with publicly reported usage-limit wording. These tests do not certify real quota depletion on every provider account, every model, or every subscription. The captured `.4` installation and global model settings were restored; the temporary Claude plugin was removed.

## Recovery limits

Recovery follows the saved policy and approved chain. Existing sheets without a `# fallback` line remain quota-only. Quiet workers remain active unless an explicit deadline or authoritative failure ends the attempt. Started writers require automatic inspection and preservation before another writer runs. Unsafe or ambiguous work, cancellation, billing blocks, conflicting evidence, and exhausted chains stop that lane with a checkpoint. Independent healthy work can continue.

A fallback cannot recover an exhausted or unavailable parent controller. Local API guards do not prove that a provider has disabled account-managed overage. See the [provider contract](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md) for exact routing and receipt rules.

## Earlier subscription-aware setup validation

[Release PR #11](https://github.com/arjitj2/open-pstack/pull/11) introduced subscription-aware setup and explicitly approved worker fallbacks in `.4`. Its tested package tree was `cddd6d809d2c9b7e5a06ff04e05bdea9c75c8f60`, with 329 Bun tests, strict typechecks, 26 maintenance tests, and static/plugin checks.

Installed tests in Codex CLI 0.154.0 and Claude Code 2.1.281 exercised confirmed setup/save/readback with native smoke and separate judging, approved native fallback, legacy no-fallback, ordinary authentication errors, and started-writer preservation. Both installed policy helpers rejected exhausted-but-unauthorized routes and forged skip history. Quota failures were controlled fixtures and native workers were real calls. That release recognized external Codex/Grok quota formats only. Tests restored the captured `.2` installation and global model settings.

## Cursor catch-up validation

[Release PR #9](https://github.com/arjitj2/open-pstack/pull/9) records the Cursor catch-up and installed checks with Codex CLI 0.154.0 and Claude Code 2.1.281. Budget selection, custom-effort preservation, fixed-effort mappings, confirmed save/readback, native workers, and separate judges passed. The package passed 225 Bun tests, strict typechecks, 26 maintenance tests, and static/plugin checks. The captured `.2` installation and global model settings were restored. See the [adoption report](cursor-adoption-20260924.md) for evidence limits.

## Earlier provider validation

[Release PR #4](https://github.com/arjitj2/open-pstack/pull/4) records the exact candidate tested in installed Codex and Claude Code. Validation includes setup probes, confirmations, file readback, smoke workers, and independent judges. The release passed 223 Bun tests, strict typechecking, static checks, nine maintenance tests, and plugin validation.

The underlying provider rollout is recorded in [PR #2](https://github.com/arjitj2/open-pstack/pull/2). The original provider validation used Codex CLI 0.154, Claude Code 2.1.179, Cursor CLI 2026.09.10-fd3934a, and Devin CLI 3000.10.27bcbe88c7. These are recorded test environments, not a guarantee for every older or newer version. The optional-family release adds representative high-effort checks; it does not certify every possible model, effort, or subscription.

## Report a compatibility problem

Open an [issue here](https://github.com/arjitj2/open-pstack/issues/new). Include the installed Pstack tag, parent application and version, affected provider CLI version, requested model and effort, reproduction steps, and observed error. Redact credentials and private prompts. Do not upload raw conversation exports.
