# Upstream maintenance

This recipe checks the documentation inventory and the production Cursor ledger proposal path. It applies to documentation and maintenance changes outside `plugins/pstack`.

## Sub-features

- `docs-structure`: approved public files, local links, provider IDs, current release baseline, and pinned upstream README.
- `ledger-catalog`: a Cursor commit becomes a pending entry in exactly one changed file, `maintenance/upstream-ledger.json`.
- `candidate-check`: the trusted workflow accepts only the exact deterministic ledger commit with the dispatched base, head, target, and PR marker identity.
- `audit`: Cursor changes, including its README, remain visible as source evidence.

## How to get to it (user POV)

Maintainers run `python3 scripts/check-docs.py`, `python3 scripts/fork-maintenance.py check-ledger`, `preview`, and `python3 scripts/upstream-audit.py` from a checkout. The daily catalog workflow creates a proposal pull request; the trusted validation workflow runs `check-candidate` from `main`. Reviewers inspect the ledger diff, source commit links, pinned compare URL, and exact preview command in the pull request body.

## Driving it with the named harness

Use the parent skill's Launch variables and `capture` function. Set `VERIFY_PATCH_BASE` to the exact trusted commit from which this change branched; record its full SHA in the evidence. Keep the evidence directory outside the checkout. This maintenance path does not require parent-app installation when the packaged plugin tree is unchanged.

```bash
: "${VERIFY_PATCH_BASE:?set the reviewed patch-base commit SHA}"
capture maintenance-plugin-diff git diff --exit-code "$VERIFY_PATCH_BASE" -- plugins/pstack
capture maintenance-docs python3 "$VERIFY_REPO/scripts/check-docs.py" --root "$VERIFY_REPO"
capture maintenance-ledger python3 "$VERIFY_REPO/scripts/fork-maintenance.py" check-ledger
capture maintenance-tests python3 -m unittest discover -s "$VERIFY_REPO/tests" -p 'test-*.py'
```

Fetch Cursor into a dedicated review ref, then capture the real audit and preview commands. `preview` prints the proposed PR body, commit, and branch when new `pstack/` commits exist. It prints a no-op message when the ledger already covers the source. Use the exact full commit SHAs shown in the output for a reproducible rerun.

```bash
capture maintenance-fetch git fetch --no-tags https://github.com/cursor/plugins.git main:refs/remotes/maintenance/cursor
VERIFY_BASE=$(git rev-parse HEAD)
VERIFY_TARGET=$(git rev-parse refs/remotes/maintenance/cursor)
capture maintenance-audit python3 "$VERIFY_REPO/scripts/upstream-audit.py" --port "$VERIFY_BASE" --upstream "$VERIFY_TARGET"
capture maintenance-preview python3 "$VERIFY_REPO/scripts/fork-maintenance.py" preview --base "$VERIFY_BASE" --target "$VERIFY_TARGET"
```

When `preview` has new commits, export the candidate ledger to disposable scratch and inspect the file list. The production command must write only the ledger. The command never changes checkout refs or the index.

```bash
capture maintenance-preview-export python3 "$VERIFY_REPO/scripts/fork-maintenance.py" preview --base "$VERIFY_BASE" --target "$VERIFY_TARGET" --out-dir "$VERIFY_SCRATCH/proposal"
capture maintenance-export-files find "$VERIFY_SCRATCH/proposal" -type f -print
```

For a proposal PR, record its number, full base, head, and target from the workflow dispatch. Run `check-candidate` from a trusted checkout at the exact base. Capture acceptance and separately record rejection of a local fixture with an extra changed path or a stale marker. Never supply personal credentials to a fixture. Keep the CLI output, PR URL, action run, and exact source refs in `$VERIFY_EVIDENCE/result.md`.

## Gotchas

- A no-op preview proves only that the current ledger is covered. Use the production CLI against a local Git/GitHub boundary fixture to exercise creation and rejection behavior when there are no new real Cursor commits; label that boundary in the evidence.
- `check-candidate` fetches the proposal branch and Cursor main. Run it only against a PR you intend to inspect and from the trusted base checkout.
- The body may be edited by a human while candidate validation still succeeds. The base, head, and target marker values must remain exact. Automation preserves edited bodies and refuses to overwrite a divergent proposal branch.
- `upstream-audit.py` compares Git blobs. A matching blob is evidence for review, not approval to import it.
