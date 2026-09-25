# Model setup

Setup discovers available access, recommends role assignments, and saves approved configuration after real probes.

## Sub-features

- `setup-selected`: check only providers selected for the final assignments.
- `setup-persist`: confirm and read back the model sheet and parent integration.
- `setup-failure`: preserve existing configuration on failed validation or writes.

## How to get to it (user POV)

Claude Code: `/pstack:setup-pstack`. Codex app: `/` then select `pstack:setup-pstack`, or mention `$pstack:setup-pstack`. Codex CLI: `/skills` or the same mention.

## Driving it with the parent apps

Preconditions: Installation recipe passed in the parent being tested; dedicated writable test configuration with authenticated included access. Read `tests/setup-selected-providers.md` for the complete behavioral cases and fixture requirements. Run both parents when shared setup changes.

- **Snapshot:** capture the test model sheet and parent integration before invocation, including explicit absence if either does not exist. Do not export credential files.
- **Invoke:** enter `Use pstack:setup-pstack. Configure only inherit-parent roles, with two independent architect runners. Do not select external providers.` in the test parent. This selects the native-only scenario, not permission to rewrite a personal sheet.
- **Drive:** answer access questions from known facts, review the proposed assignments, and confirm saving the disposable test configuration. Observe a real native marker probe, a worker, and a separate reviewer; capture native dispatch and terminal events, not just their summary text.
- **Read back:** compare saved sheet and integration with the confirmed proposal. Require all documented role rows, two architect seats, and no external CLI probes for the native-only case. In Codex the instructions file is `AGENTS.md`; Claude uses `CLAUDE.md`. Record the actual paths chosen by setup.
- **Failure paths:** follow the named selected-provider failure and write-failure cases in `tests/setup-selected-providers.md`; retain before/after bytes and expect rollback. Record cases not exercised separately.

## Gotchas

- Setup asks before saving; a verification recipe does not remove that product behavior.
- A parent responding to its own marker is not a native-agent probe.
- Do not invent subscription capacity, authorize API spending, or add provider fallbacks for convenience.
- A policy-CLI validation pass does not prove setup's conversation, provider probes, or transactional writes.
