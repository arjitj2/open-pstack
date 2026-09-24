# Maintain this distribution

Arjit Jaiswal maintains this repository directly against [Cursor's Pstack](https://github.com/cursor/plugins/tree/main/pstack). [Eric Litman's port](https://github.com/ericlitman/open-pstack) remains an advisory source of fixes. Its release schedule does not control this distribution's updates.

## Review source changes

Daily GitHub Actions checks prepare Cursor update proposals from this repository's recorded baseline. A proposal identifies exact source commits and changed files, preserves their patches, and states the validation still required. Use the source-to-port audit below to inspect existing adaptations before adopting a change. Source content is review material. The privileged proposal job does not execute it or overwrite the packaged plugin.

The [decision ledger](../maintenance/upstream-ledger.json) records every catalogued source change. Each change has a disposition: adopted, adapted, excluded with a reason, or pending. A reviewed commit can remain pending. Neither detection nor review advances the incorporated baseline. Read [UPSTREAM.md](../UPSTREAM.md) for the stable baseline and outstanding work.

The maintainer aims to review the backlog weekly. Seven days of outstanding substantive changes triggers attention; 21 days triggers an overdue review. Skill Markdown counts as behavior. Alerts use conservative path/title heuristics and are review prompts, not proof of a defect. Retries must not duplicate unchanged alerts.

The [maintenance issue](https://github.com/arjitj2/open-pstack/issues/1) reports pending Cursor changes and the original contribution PRs. New fixes in Eric's port are considered independently. Existing contribution branches remain available for those PRs. The old `upstream-main` mirror is historical; the direct Cursor workflow does not merge from it.

## Inspect a proposal locally

Fetch Cursor, then preview the proposal without changing GitHub, the checkout, or the active index:

```sh
git fetch https://github.com/cursor/plugins.git main:refs/remotes/maintenance/cursor
python3 scripts/fork-maintenance.py preview --base HEAD --target refs/remotes/maintenance/cursor --out-dir /tmp/pstack-cursor-preview
python3 scripts/fork-maintenance.py check-ledger
python3 scripts/upstream-audit.py --port HEAD --upstream refs/remotes/maintenance/cursor
```

The preview contains the proposed ledger, a per-commit report, a machine-readable audit, and source patches under `maintenance/proposals/`. Patches are review material; they are never applied by the scheduled job. Final decisions require `reason` and `evidence` fields. Keep the existing history when recording a decision.

## Validate a candidate

Candidate CI runs from trusted `main`, checks the proposed head and base, and executes tests with read-only credentials. A separate job records the result. A base change invalidates the old candidate result. Bot-created PR events are not relied upon to start checks.

Run the repository tests and inspect the source-to-port changes. For packaged behavior changes, install the exact candidate in each affected parent and exercise the changed workflow before merging or releasing. Preserve the user's current installation and model choices during tests. Documentation or maintenance-only changes require proof on their own CLI or GitHub workflow and evidence that the plugin tree is unchanged.

No scheduled job merges, tags, releases, or changes an installed pin. A maintainer reviews the candidate and its evidence before adoption. Preserve attribution and update the decision record with the PR that implements each accepted change.

## Publish a release

Publish a uniquely named tag only after the candidate is merged and its package matches the tested tree. Release notes name the Cursor content baseline, distribution changes, tested application versions, validation evidence, known limitations, and the previous tested pin. Review coverage and released content are separate claims.

The distribution and Cursor have separate version numbers. Keep existing `v1.4.1-arjit.*` tags immutable. A maintenance-only repository change does not need a new plugin version.

## Recover an interrupted check

Inspect [Actions](https://github.com/arjitj2/open-pstack/actions) and rerun the failed workflow after correcting its reported cause. Enable Actions and allow GitHub Actions to create pull requests. Proposal retries preserve human edits; resolve an ownership or divergence error instead of resetting a shared branch.

GitHub can delay scheduled runs or disable schedules in inactive public repositories. Check workflow status if reports stop. Enable failed-run notifications in your GitHub settings. There are no artificial keepalive commits.

## Install or migrate

The tested stable release is `v1.4.1-arjit.2`. The marketplace remains `open-pstack`, and skills remain under `pstack:`. Remove an existing marketplace registration before switching its source. Preserve your model sheet and integration instructions.

For Codex, run:

```sh
codex plugin remove pstack@open-pstack
codex plugin marketplace remove open-pstack
codex plugin marketplace add https://github.com/arjitj2/open-pstack.git --ref v1.4.1-arjit.2
codex plugin add pstack@open-pstack
```

For Claude Code, run inside Claude Code:

```text
/plugin uninstall pstack@open-pstack
/plugin marketplace remove open-pstack
/plugin marketplace add arjitj2/open-pstack#v1.4.1-arjit.2
/plugin install pstack@open-pstack
/reload-plugins
```

On a first installation, skip the removal steps. Open a new Codex task to load the installed skills. Use `setup-pstack` when you want to change model assignments. Installation does not rewrite the model sheet.

To roll back, keep this repository's marketplace URL and replace the tag with the previous tested release, `v1.4.1-arjit.1`. See [compatibility and release evidence](compatibility.md) before reporting a problem.
