# Installation and discovery

Users install the shared Pstack skill tree in Codex or Claude Code, then discover its skills in a fresh session.

## Sub-features

- `install-codex`: install from the marketplace and discover skills.
- `install-claude`: install, reload, and discover skills.
- `candidate-identity`: establish that the loaded files match the candidate under review.

## How to get to it (user POV)

Codex uses shell plugin commands and the app skill picker or CLI `/skills`. Claude Code uses `/plugin` commands and `/reload-plugins`.

## Driving it with the parent apps

Preconditions: a dedicated test profile/session with working authentication. These commands install public `main`; they do not install arbitrary unmerged checkout changes. For a candidate release, follow the validation policy in `docs/fork-maintenance.md`: establish a candidate installation using the host's supported local marketplace controls and prove loaded-tree equality before continuing. This starter map does not automate candidate installation; if identity cannot be established, report the candidate lane blocked.

- **Codex install:** run `codex plugin marketplace add arjitj2/open-pstack`, then `codex plugin add pstack@open-pstack`. Capture stdout, stderr, and status. Open a new task in the test checkout. In the app type `/` and select `pstack:how`; in CLI use `/skills` and select the same skill. Each entry point must show the skill.
- **Claude install:** inside Claude Code enter `/plugin marketplace add arjitj2/open-pstack`, `/plugin install pstack@open-pstack`, then `/reload-plugins`. Enter `/pstack:how`. Capture the invoked skill identity and loaded path.
- **Doctor:** use `codex plugin list` or `claude plugin list`, then inspect the loaded plugin manifest. Record path, version, and a recursive file comparison against `plugins/pstack`, excluding only generated dependency files. Matching version strings alone do not prove matching content.
- **Evidence:** save installation output and discovery action plus parent transcript/screenshot in `$VERIFY_EVIDENCE`. Do not count merely reading the source SKILL.md as installed discovery.

## Gotchas

- Never uninstall or overwrite a personal installation for a test fixture.
- Codex needs a fresh task after installation; Claude needs reload or a fresh session.
- Parent-specific primitive mapping lives in `plugins/pstack/skills/poteto-mode/references/codex-tools.md`; do not create separate packaged skill trees.
- Close only the test sessions and remove only profiles created for this run. Authentication is not automatically isolated by changing the working directory.
