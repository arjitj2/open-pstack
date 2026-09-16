# Maintaining this fork

`upstream-main` is an exact, fast-forward-only mirror of `ericlitman/open-pstack/main`. Our `main` combines the maintained upstream with local provider changes. Existing contribution branches remain independent for upstream PRs #70 (Devin), #73 (selected-provider setup), and #74 (Cursor workers).

The daily **Sync open-pstack upstream** workflow updates the mirror and maintains one ready-for-review PR from it into `main`. Merge conflicts remain visible for manual resolution. It never force-pushes, merges, tags, releases, installs, or imports Cursor changes directly. Merge sync PRs with a merge commit to preserve upstream ancestry.

Candidate CI is explicitly dispatched from trusted `main`, verifies the current PR head and base, and tests their proposed merge with read-only credentials. A separate job attaches the result to the mirror head. Tests execute without secrets or persisted checkout credentials. The PR remains subject to relevant installed Claude Code and Codex validation; passing CI is not that evidence. If the base changes, the next daily run replaces the old status with pending, naming the new base, and dispatches a fresh candidate.

GitHub's bot-token-created PR workflows may require approval. The explicit candidate workflow avoids depending on those runs. Enable Actions and **Allow GitHub Actions to create and approve pull requests** in this fork's Actions settings. The automation does not use its approval capability. Missing permissions fail visibly with a recovery message. Workflow failure notifications use GitHub Actions notifications; enable notifications for failed runs in your GitHub notification settings.

The weekly **Report upstream maintenance** workflow updates only the managed section of issue #1, preserving its checklist. It reads the Cursor sync point from the maintained upstream's current `UPSTREAM.md`, not our potentially older installation. It reports outstanding changes, the oldest substantive age and threshold severity, and our three contribution states. Maintainer comments/reviews are identified by repository association, excluding bots and recognizable generated review templates such as Gavel; the report labels remaining activity as apparently non-generated rather than guaranteeing human authorship. Merge commits are compared to their first parent so merge-only fixes remain visible. Skill Markdown counts as behavior. Only enumerated prose locations are excluded from substantive lag; classification is intentionally conservative.

Daily checks mention the owner once for each new likely relevant upstream fix (a fix/bug/security title overlapping our modified plugin paths), and once when an outstanding substantive Cursor change crosses seven or 21 days. These are review prompts, not semantic guarantees. Notification markers make retries idempotent. A quiet Cursor repository is healthy; bot reviews are not proof of maintainer engagement. The report contains stable commit dates rather than a constantly changing 'checked at' timestamp.

For an immediate refresh, run either workflow manually from `main`. A divergent mirror is never reset automatically: inspect upstream history before choosing a recovery. If candidate tests fail, fix the sync PR and rerun **Validate upstream sync candidate** with the current PR number, mirror SHA, and main SHA. For conflicts, create a separate reconciliation branch from `main`, merge `upstream-main` there, resolve and validate it, and open a reconciliation PR. After that PR merges, close the redundant mirror PR. Never resolve conflicts by committing onto the exact mirror.

GitHub can disable schedules in inactive public repositories after 60 days; check workflow status if reports stop. There is no artificial keepalive commit. Daily scheduling is best-effort and may be delayed by GitHub.

Install only a uniquely named tested release tag or full commit from this fork. Validate the exact combined candidate in both affected hosts before tagging or rollout, record the evidence, and retain the previous pin for rollback. None of these workflows advances the installed pin. Normal upstream releases and our fork releases have separate provenance.

## Installed release

The initial combined release is `v1.4.1-arjit.1` (plugin `1.4.1-arjit.1`). Codex uses the existing `open-pstack` marketplace name, preserving the `pstack:` skill namespace. The optional-family release is `v1.4.1-arjit.2` (plugin `1.4.1-arjit.2`); install it only after the exact candidate passes both installed host lanes. To switch an existing installation:

```sh
codex plugin remove pstack@open-pstack
codex plugin marketplace remove open-pstack
codex plugin marketplace add https://github.com/arjitj2/open-pstack.git --ref v1.4.1-arjit.2
codex plugin add pstack@open-pstack
```

Start a new Codex task to discover the installed skills. Run `setup-pstack` when you want to change model assignments; installation does not rewrite your model sheet. To roll back, keep the fork marketplace URL and restore the previously tested ref `v1.4.1-arjit.1`.
