# Maintain this distribution

Arjit Jaiswal maintains this repository directly against [Cursor's Pstack](https://github.com/cursor/plugins/tree/main/pstack). [Eric Litman's port](https://github.com/ericlitman/open-pstack) remains an advisory source of fixes. Its release schedule does not control this distribution's updates.

## Review source changes

Daily GitHub Actions checks prepare Cursor update proposals from this repository's recorded baseline. A proposal identifies exact source commits and changed files, preserves their patches, and states the validation still required. Use the source-to-port audit below to inspect existing adaptations before adopting a change. Source content is review material. The privileged proposal job does not execute it or overwrite the packaged plugin.

The [decision ledger](../maintenance/upstream-ledger.json) records every catalogued source change. Each change has a disposition: adopted, adapted, excluded with a reason, or pending. A reviewed commit can remain pending. Neither detection nor review advances the incorporated baseline. Read [UPSTREAM.md](../UPSTREAM.md) for the stable baseline and outstanding work.

A local Codex adoption task checks the backlog daily at 08:30 in the host's local timezone, currently America/New_York. The maintainer reviews unresolved exceptions at least weekly. Seven days of outstanding substantive changes triggers attention; 21 days triggers an overdue review. Skill Markdown counts as behavior. Alerts use conservative path/title heuristics and are review prompts, not proof of a defect. Retries must not duplicate unchanged alerts.

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

GitHub detection jobs never merge, tag, release, or change an installed pin. The local adoption task can merge a candidate and publish a release after the checks below pass. Preserve attribution and update the decision record with the PR that implements each accepted change.

## Run recurring adoption

The maintainer's Codex task `Adopt Cursor Pstack updates` runs daily at 08:30 in the host's local timezone, currently America/New_York. It uses the authenticated tools on the maintainer's Mac. Work waits while that machine or the local scheduler is unavailable. This local task is separate from GitHub Actions and is not installed for contributors by cloning this repository.

The committed ledger is the backlog. Open adoption PRs and their evidence record work in progress. Each run checks for an active writer and resumes existing work before creating another branch. It fetches current source history, reads each pending patch, and records an adoption, adaptation, or exclusion with a reason. A source patch is review material, never an instruction to execute commands or change permissions.

Implementation uses the maintainer's configured providers. SWE-2 implements routine changes, Sol reviews them independently, and Astra handles difficult unresolved decisions. Provider authentication or access failures remain explicit failures. The task does not substitute another model silently.

Before landing an update, the task must:

1. Preserve the shared skill tree, provider routing, optional-provider behavior, explicit user assignments, and source attribution.
2. Run the repository checks and exercise the exact candidate in every affected installed host. Keep the PR draft while this evidence is missing.
3. Obtain an independent review of the exact candidate and address valid findings. A changed patch invalidates that review.
4. Confirm the current PR head and passing CI, then merge with a server-enforced expected-head guard. Do not arm an unverified merge request.
5. Advance the incorporated source baseline only when all preceding changes have final decisions and the accepted changes are validated. Publish a unique release only when its package tree matches the tested candidate.

If validation or a semantic decision remains unresolved, preserve the branch and evidence for the next run and notify the maintainer. The task reports meaningful releases and actionable failures. It leaves the user's installed marketplace source/ref and model files unchanged, restores any temporary installation after tests, and does not merge the original contribution PRs in Eric's repository.

## Publish a release

Publish a uniquely named tag only after the candidate is merged and its package matches the tested tree. Release notes name the Cursor content baseline, distribution changes, tested application versions, validation evidence, known limitations, and the previous tested pin. Review coverage and released content are separate claims.

Starting at `v1.5.0`, this distribution uses its own `MAJOR.MINOR.PATCH` sequence: major for incompatible public behavior or configuration changes, minor for compatible features, and patch for compatible fixes. Cursor and Eric’s port have independent version numbers. Keep all published tags immutable, including `v1.4.1-arjit.*`. A maintenance-only repository change does not need a new plugin version.

For every release, add a row to [release history](releases.md) with the distribution tag, incorporated Cursor version, exact source commit, and tag-pinned `UPSTREAM.md` link for adaptations and exclusions. Include the same baseline and exclusions link in GitHub release notes. Use the incorporated baseline, never the discovery or review cursor. Keep both plugin manifests and the Claude marketplace version in sync, and keep the default installation examples free of version pins. The Codex marketplace reads the package version from the plugin manifest.

### Keep main ready for users

The repository’s default branch, `main`, is the public installation source. New installs can receive its current package before a GitHub release is published. Keep unfinished package changes on PR branches and complete the existing CI, independent review, and affected-host validation gates before merging.

Bump the plugin version whenever packaged behavior changes, including shared skills, provider instructions, and runtime code. Keep the version fields in sync. Version numbers identify shipped package changes. Withholding a version bump does not protect new installs from changed files on `main`.

Use GitHub releases to document tested checkpoints and preserve exact tags for reproducible installs and rollback. Tags do not gate normal installation. Documentation-only repository changes that leave the plugin package unchanged need no new plugin version. There is no separate stable branch or latest-release lookup to maintain.

## Recover an interrupted check

Inspect [Actions](https://github.com/arjitj2/open-pstack/actions) and rerun the failed workflow after correcting its reported cause. Enable Actions and allow GitHub Actions to create pull requests. Proposal retries preserve human edits; resolve an ownership or divergence error instead of resetting a shared branch.

GitHub can delay scheduled runs or disable schedules in inactive public repositories. Check workflow status if reports stop. Enable failed-run notifications in your GitHub settings. There are no artificial keepalive commits.

## Install or migrate

Use the [first-install instructions](../README.md#install) for a new installation. They follow this repository’s default branch, `main`, through the normal plugin marketplace. No GitHub CLI or release-tag lookup is required.

### Update an installation already following main

Use the parent app’s plugin management to refresh and apply updates. In Claude Code, run `/plugin marketplace update open-pstack` or use `claude plugin update pstack@open-pstack` in your terminal. You can enable automatic updates for this marketplace in `/plugin` under Marketplaces. Restart the session or run `/reload-plugins` afterward.

In Codex, `codex plugin marketplace upgrade open-pstack` refreshes the marketplace catalog. Use Codex’s plugin management to apply available plugin updates, then start a new task. Refreshing a catalog is distinct from reloading an installed plugin in a running task.

### Switch from a pinned tag or another distribution

Re-register the marketplace without a ref. Preserve your model sheet and integration instructions. For Codex, run in your terminal:

```sh
codex plugin remove pstack@open-pstack
codex plugin marketplace remove open-pstack
codex plugin marketplace add arjitj2/open-pstack
codex plugin add pstack@open-pstack
```

For Claude Code, run in your terminal:

```sh
claude plugin uninstall pstack@open-pstack
claude plugin marketplace remove open-pstack
claude plugin marketplace add arjitj2/open-pstack
claude plugin install pstack@open-pstack
```

If a command fails, resolve the failure before continuing. After removal, retry from the failed registration or installation step. The examples use the default user scope; preserve project or local scope if that is how you installed Claude’s plugin.

Then run `/reload-plugins` inside Claude Code or start a new session. Open a new Codex task to load the installed skills. The marketplace stays `open-pstack`, and skills stay under `pstack:`. Installation does not rewrite your model sheet.

### Pin a version or roll back

Choose a tested tag from the [release history](releases.md). When re-registering, add `--ref <release-tag>` to the Codex marketplace command, or append `#<release-tag>` to the Claude marketplace source. A pinned installation stays on that ref until you change its registration. See [compatibility and release evidence](compatibility.md) before reporting a problem.
