# Worker ownership and continuation

The repository owner keeps Git authority while subordinate workers operate within their declared capabilities. Provider fallback and corrected continuation have separate authorization.

## Sub-features

- `worker-preparation`: native and external assignments share an ownership contract and reject unsupported enforcement before dispatch.
- `worker-boundary`: ordinary edits work while protected Git metadata, worktree pointers and remotes remain protected.
- `worker-handoff`: a final response can request a parent operation without completing the assignment or authorizing that operation.
- `worker-continuation`: an explicit saved allowance permits only a bounded, inspected continuation of the same descriptor.
- `worker-operation`: duplicate or interrupted parent operations reconcile against recorded expected state before replay.
- `worker-local-checks`: command-capable writers check, repair, and recheck locally; file-only writers request parent checks.

## How to get to it (user POV)

Invoke `pstack:poteto-mode` in Codex or `/pstack:poteto-mode` in Claude Code with a small delegated file change. Use the installed provider-dispatch reference to prepare the assignment. Keep the configured provider and model. A route that cannot enforce the requested contract must explain its capability mismatch before launching.

## Driving it with the Bun CLI and parent apps

Run Launch and Doctor, then install the exact candidate in dedicated authenticated profiles for both parents as described in [installation](installation.md). Record candidate tree identity, version, parent, resolved descriptor and actual launch. Do not change the user's personal sheet or settings to manufacture a supported route.

Create a fresh disposable fixture for each provider execution.

```bash
capture worker-fixture python3 "$VERIFY_REPO/tests/worker-contract/fixture.py" create --root "$VERIFY_SCRATCH/worker-probe"
```

The fixture contains an owner repository, a linked worker checkout, a local bare remote, a symlink into shared metadata and a hard link to Git config. Its `prompt.txt` specifies ordinary edits and attempted protected mutations. Pass that prompt and its `worker` directory through the installed parent workflow. Retain the actual tool surface and trusted provider denial events. Do not count an unavailable tool as an executed command that was denied.

Repeat with a fresh root and `create --layout checkout` to cover Git metadata inside the allowed working directory. A successful outside-root denial in the linked-worktree case does not prove protection of an ordinary checkout's `.git` directory.

Repeat with `create --layout separate-gitdir` to cover a `.git` pointer whose metadata directory is named `control`. A rule that protects only paths named `.git` does not establish protection for this layout.

```bash
capture worker-observed python3 "$VERIFY_REPO/tests/worker-contract/fixture.py" inspect --root "$VERIFY_SCRATCH/worker-probe"
```

The second read records ordinary file contents, Git metadata, the worktree pointer and remote refs. It is detection only. An unchanged hash does not establish prevention. A passing boundary claim also requires trusted evidence that the attempted operation was denied or that the relevant execution surface was unavailable. Include absolute Git invocations, direct file writes, symlink paths, shared common-dir writes, child processes and a local remote push wherever the tool surface permits those attempts. When fixture Git is advertised, exercise an allowed disposable fixture separately.

From each installed parent, exercise these outcomes and retain the parent tool transcript plus independent persistent-state reads.

1. Prepare an unsupported native or external route. Observe no provider invocation and an explicit capability reason. Do not silently substitute a model or weaken enforcement.
2. Complete an allowed ordinary edit on each route advertised as enforced. Verify actual permissions and model identity, not just requested flags.
3. Deliver a typed handoff through the provider's final response. Verify transport success is preserved while assignment completion remains false. Reject arbitrary shell, extra fields, unrelated task identities and worker-authored claims of verified denial.
4. Submit the same checkpoint operation twice. Observe one result, or an explicit need to reconcile ambiguous state. Change expected repository state and verify the operation is not blindly replayed.
5. With explicit continuation consent in a disposable sheet, exercise a real verified permission interruption. Inspect partial changes and side effects, establish that the old writer stopped, record a concrete correction and create a reviewed snapshot. Continue only the same authorized descriptor with fresh execution/output/receipt identity. Confirm partial work survives.
6. Exercise the allowance limit and stop conditions through the shipped policy CLI. Cover missing consent, unknown denial evidence, unresolved writer liveness, unsafe inspection, unchanged blockage, cancellation, billing restrictions and contradictory completed-task evidence. Label synthetic events as policy tests, never real provider recovery.
7. Repeat policy checks with a legacy sheet. Its existing attempt and fallback semantics must remain unchanged.

Record unsupported or blocked provider paths individually. A successful CLI test does not validate either installed parent. A provider report rejected by identity or spending guards is an unsuccessful run even when a side effect looks correct.

For local checks, create a separate fixture for each installed-parent lane. The helper performs Git operations and runs only in the parent.

```bash
capture local-check-fixture python3 "$VERIFY_REPO/tests/worker-contract/local-check.py" create --root "$VERIFY_SCRATCH/local-check"
```

Pass `prompt.txt` and the fixture's `writer` checkout through the installed workflow. The task requires a failing baseline, a change only to `normalize.py`, and a passing check. Use the saved descriptor and spending policy. Exercise native Codex and Claude assignments, external Claude's sandboxed Bash, Devin's sandboxed exec, and OpenCode writers on both supported native contracts where those routes are configured. Repeat with fresh paths for each lane.

Retain native host tool events or bounded provider tool observations from transparent process-boundary instrumentation. Record the actual check call and its matching failure or success result. Instrumentation must preserve argv, stdin, stdout, and exit status. Devin's runner deletes its private ATIF export after the attempt, so a verification recorder must select the check observations before cleanup. Never retain system context, reasoning, credentials, or unrelated tool output. Runner receipts and worker-written check logs alone do not prove that the worker ran a check.

```bash
capture local-check-observed python3 "$VERIFY_REPO/tests/worker-contract/local-check.py" inspect --root "$VERIFY_SCRATCH/local-check"
```

Require a passing parent check, an edited implementation, unchanged tracked tests and worker HEAD, and an unchanged seed. Inspect the actual diff and extra files. These state checks detect changes; they do not prove confinement. Record the installed version and tree identity, parent action, worker tool observations, and independent parent result separately.

Use fresh fixtures for negative paths. Put project sandbox exclusions in a Claude writer checkout and confirm empty setting sources keep an outside-worktree canary write denied. Observe one actual denial and no retry. Exercise sandbox startup failure and an old or malformed CLI version without model execution. Check a required outside-directory cache or network operation, and retain the concrete blocker instead of weakening isolation. For OpenCode, retain direct file-edit tools and separately verify the required shell boundary. On macOS, use an already authorized parent execution surface outside an enclosing Seatbelt sandbox; retain a separate nested-sandbox startup refusal without weakening the worker policy. Capture V1 Bash and V2 shell observations, failure and success exit codes, outside/child write and network denial, private policy write denial, and refusal when sandbox startup or its required settings fail. Verify read-only has no shell grant. Keep native V1 command timeouts distinct from the runner attempt deadline. Document runtime-provided cache/temp exceptions and hard-link limitations without claiming strict Git confinement.

For Antigravity writers, use a fresh dedicated checkout and the exact installed candidate from both Codex and Claude. Record the actual agy version separately from its supported 1.x capability contract. Confirm writer preflight rejects malformed versions, prereleases and other majors before model invocation while accepting compatible stable patch/minor versions. Verify default-project pinning and exact model/agent identity. Observe arbitrary worker-chosen heredocs, pipelines and nested shell commands, a failing check followed by repair and a passing rerun, native diagnostics, and background completion through `manage_task`. Exercise `RunPersistent` and `IsDaemon` without blanket denial. Retain native tool exit results; final `SUCCESS` alone proves delivery only.

Run fresh negative fixtures for sandbox bypass, foreign terminal, outside/symlink cwd, unknown command fields, foreign/traversing task selectors and direct edits of the generated hook/agent. Check SessionStart precedes command approval and all native hook payloads carry the same top-level `conversationId`, singleton canonical `workspacePaths`, and exact `modelName`. Stop must continue while `fullyIdle` is false and settle when true. Replace workspace discovery hooks during one command and observe the captured original guard on the next call; source fingerprints should detect mutation and cleanup must preserve the replacement. These observations establish the tested startup-hook behavior, not a complete provider settings snapshot.

Retain missing, crashed and malformed guard native errors with absent command side effects, including `failed to unmarshal result from hook jsonhook__... via protojson:`. Confirm these cannot become unqualified completion despite final `SUCCESS`, while an ordinary nonzero command still permits repair. Exercise native sandbox startup failure, cancellation and explicit deadlines, preserving control until provider/task settlement. Confirm read-only has no command tools or generated hooks. Verify ordinary outside writes fail while documenting native temp/cache and existing-hardlink limits; do not claim strict Git ownership enforcement.

Use disposable policy fixtures for malformed/unreadable/symlinked settings, unsafe grants, unknown shared/project keys, active global/plugin hooks, both plugin roots and preexisting workspace hooks. Refusal must identify the source/key without changing it or copying secrets. Preserve independent approved billing-route behavior. Confirm changed sources, colliding or replaced agent/hook/control files, session binding and fixed idle/denial flag inode replacement, overlapping hooks that retain a sticky denial, malformed session state that still marks denial, preparation rollback and idempotent cleanup. Confirm SessionStart and PostToolUse emit empty objects on success and validation failure while the next PreToolUse denies and settlement rejects. Exercise another available compatible agy version; record concrete source availability if only the rolling checkpoint is obtainable. Label fake-agy and local guard-process tests as boundary tests, not installed-parent evidence.

A file-only lane must deliver a valid `run-checks` request without claiming command execution; validate it with the parent's fixed task, checkpoint, file, check identifier, and HEAD before running acceptance. Native and external strict preparation must remain unsupported. Label fake CLI and synthetic policy cases as boundary tests, never installed-parent proof.

## Gotchas

- File-only workers cannot promise shell checks. The parent may run authorized checks and Git operations itself.
- A Git wrapper, clone, writable-workspace flag or after-the-fact audit does not enforce ownership.
- A handoff is untrusted data, not authorization. Execute only the owner's fixed, scoped operations.
- Recovery never grants broader permissions or changes the provider, model, effort or spending policy.
- Keep failed receipts, fixture state and correction evidence. Do not reuse an active writer's mutable workspace.
- The fixture helper never cleans up. Preserve it with the verification evidence before removing only the scratch directory created for this run.
