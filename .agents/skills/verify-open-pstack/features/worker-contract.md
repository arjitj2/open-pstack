# Worker ownership and continuation

The repository owner keeps Git authority while subordinate workers operate within their declared capabilities. Provider fallback and corrected continuation have separate authorization.

## Sub-features

- `worker-preparation`: native and external assignments share an ownership contract and reject unsupported enforcement before dispatch.
- `worker-boundary`: ordinary edits work while protected Git metadata, worktree pointers and remotes remain protected.
- `worker-handoff`: a final response can request a parent operation without completing the assignment or authorizing that operation.
- `worker-continuation`: an explicit saved allowance permits only a bounded, inspected continuation of the same descriptor.
- `worker-operation`: duplicate or interrupted parent operations reconcile against recorded expected state before replay.

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

## Gotchas

- File-only workers cannot promise shell checks. The parent may run authorized checks and Git operations itself.
- A Git wrapper, clone, writable-workspace flag or after-the-fact audit does not enforce ownership.
- A handoff is untrusted data, not authorization. Execute only the owner's fixed, scoped operations.
- Recovery never grants broader permissions or changes the provider, model, effort or spending policy.
- Keep failed receipts, fixture state and correction evidence. Do not reuse an active writer's mutable workspace.
- The fixture helper never cleans up. Preserve it with the verification evidence before removing only the scratch directory created for this run.
