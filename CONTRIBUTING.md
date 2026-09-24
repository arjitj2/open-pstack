# Contribute to Open Pstack

Use [this repository's issues](https://github.com/arjitj2/open-pstack/issues) to report bugs and propose changes. Include reproduction steps, expected behavior, installed release, and relevant application versions. Pull requests for documentation and maintenance tooling are welcome.

Read [AGENTS.md](AGENTS.md) and [UPSTREAM.md](UPSTREAM.md) before editing. Keep one shared skill tree for Codex and Claude Code. Preserve upstream licenses and credit. Explain intentional differences from Cursor in the upstream decision record.

## Validate a change

Run the checks in [.github/workflows/ci.yml](.github/workflows/ci.yml). They include Bun tests, strict typechecking, maintenance tests, manifest parsing, and static invariants. Run `claude plugin validate ./plugins/pstack` for plugin validation.

For changes to packaged skills, agents, manifests, or runner behavior, install the exact candidate and exercise the changed behavior from every affected parent application. Record the installed version, action, observed result, and limitations in the PR. Keep behavior changes in draft until that evidence is available.

For documentation and maintenance tooling that leave the plugin tree unchanged, record that equality and demonstrate the changed CLI or workflow itself. Do not claim provider validation when none was needed or performed.

Keep tests and proposal validation separate from jobs with write permissions. New automation must handle retries without overwriting human edits or claiming that unreviewed content has shipped.
