# Cursor pstack catalog proposal `cursor-12d587dfb207-5aae9c873dd1`

Automation-generated metadata proposal. Merging records the Cursor commits below as
pending review decisions in `maintenance/upstream-ledger.json`. It does not adopt upstream
behavior, does not change `plugins/`, and does not authorize installation or release.

| Field | Value |
| --- | --- |
| Source | `cursor/plugins` `pstack/` |
| Incorporated baseline | `f8abeddd1862dc73704e3d719dd73df0d51b8c71` |
| Ledger reviewed_through | `f8abeddd1862dc73704e3d719dd73df0d51b8c71` -> `12d587dfb20741cafc376c42c696c5f6e2a64487` |
| Base | `5aae9c873dd111d7bccd1ae428c30a1328755753` |

## New commits

| Commit | Date | Classification | Subject |
| --- | --- | --- | --- |
| [`f5bdd6826fd0`](https://github.com/cursor/plugins/commit/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d) | 2026-09-10 | substantive | fix(pstack): operator-neutral pronouns + in-chat status tick (#362) |
| [`889ec4b68fa5`](https://github.com/cursor/plugins/commit/889ec4b68fa5aab0e867dad71ec3fdf386ae48f3) | 2026-09-11 | substantive | fix(pstack): bug-fix/perf/hillclimb defaults to grok 4.6 (#365) |
| [`5bf2b1544db7`](https://github.com/cursor/plugins/commit/5bf2b1544db739998121a306340631963c2ff3de) | 2026-09-12 | substantive | feat(pstack): setup-pstack budget ask (max/xhigh/high/medium) (#366) |
| [`70b2dc8b4b85`](https://github.com/cursor/plugins/commit/70b2dc8b4b85c8d5648624ca40d692c421fff32f) | 2026-09-22 | substantive | feat(pstack): port skill updates and default to Opus 5.5 and Grok 4.7 (#414) |
| [`b42effe0aa50`](https://github.com/cursor/plugins/commit/b42effe0aa50f59c693d7e2924714e015e00bf7c) | 2026-09-23 | prose only | fix(pstack): scrub old model names from public upgrade help (#416) |
| [`b0b9c7a0baf8`](https://github.com/cursor/plugins/commit/b0b9c7a0baf8b6aa1d00bf77d4101e577d4ba411) | 2026-09-23 | substantive | docs(pstack): cut 19 more instructions Opus 5.5 does not need (#419) |
| [`12d587dfb207`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487) | 2026-09-23 | substantive | fix(pstack): resolve rule conflicts and read the model rule the same way (#422) |

## Outstanding pending decisions

- [`f5bdd6826fd0`](https://github.com/cursor/plugins/commit/f5bdd6826fd0a0d9cbc4347134c3a74a200b9d9d): fix(pstack): operator-neutral pronouns + in-chat status tick (#362)
- [`889ec4b68fa5`](https://github.com/cursor/plugins/commit/889ec4b68fa5aab0e867dad71ec3fdf386ae48f3): fix(pstack): bug-fix/perf/hillclimb defaults to grok 4.6 (#365)
- [`5bf2b1544db7`](https://github.com/cursor/plugins/commit/5bf2b1544db739998121a306340631963c2ff3de): feat(pstack): setup-pstack budget ask (max/xhigh/high/medium) (#366)
- [`70b2dc8b4b85`](https://github.com/cursor/plugins/commit/70b2dc8b4b85c8d5648624ca40d692c421fff32f): feat(pstack): port skill updates and default to Opus 5.5 and Grok 4.7 (#414)
- [`b42effe0aa50`](https://github.com/cursor/plugins/commit/b42effe0aa50f59c693d7e2924714e015e00bf7c): fix(pstack): scrub old model names from public upgrade help (#416)
- [`b0b9c7a0baf8`](https://github.com/cursor/plugins/commit/b0b9c7a0baf8b6aa1d00bf77d4101e577d4ba411): docs(pstack): cut 19 more instructions Opus 5.5 does not need (#419)
- [`12d587dfb207`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487): fix(pstack): resolve rule conflicts and read the model rule the same way (#422)

## Review material

- `audit.json`: deterministic machine-readable record of this proposal.
- `patches/<sha>.patch`: upstream source diffs stored as non-executable review material.

## Recording a decision

Adopt upstream intent in a normal pull request that changes `plugins/pstack`, then set the
ledger entry to `adopted` or `adapted` with `reason` and `evidence` (the PR plus installed-host
validation). Use `excluded` with `reason` and `evidence` for commits deliberately not taken.
Pending entries remain listed until a decision is recorded, even after reviewed_through
advances past them.
