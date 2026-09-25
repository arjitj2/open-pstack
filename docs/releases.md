# Distribution releases and Cursor content

Open Pstack, maintained by Arjit, uses its own release numbers starting with `v1.5.0`. Earlier releases retain their `v1.4.1-arjit.*` names. Published tags are never renamed or moved.

The Cursor baseline identifies the source content incorporated with this distribution’s adaptations and exclusions. It does not claim identical behavior or inclusion of every upstream feature. More than one distribution release can share a baseline when changes affect provider support, setup, recovery, or packaging.

The `main` installation package advances to 1.7.1 only after the draft [Claude auth-status removal candidate](../maintenance/claude-auth-repro/README.md) passes installed-parent validation. Version 1.7.0 introduced [optional OpenCode workers](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#optional-opencode-models), with [OpenCode validation](opencode-worker-verification.md) recorded separately. See [upstream status](../UPSTREAM.md) for the incorporated Cursor baseline. The table below records tagged releases separately.

| Distribution release | Cursor Pstack version | Incorporated Cursor commit | Scope at release |
| --- | --- | --- | --- |
| [v1.5.0](https://github.com/arjitj2/open-pstack/releases/tag/v1.5.0) | 0.15.5 | [`12d587dfb20741cafc376c42c696c5f6e2a64487`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487) | [Adaptations and exclusions](https://github.com/arjitj2/open-pstack/blob/v1.5.0/UPSTREAM.md) |
| [v1.4.1-arjit.5](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.5) | 0.15.5 | [`12d587dfb20741cafc376c42c696c5f6e2a64487`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487) | [Adaptations and exclusions](https://github.com/arjitj2/open-pstack/blob/v1.4.1-arjit.5/UPSTREAM.md) |
| [v1.4.1-arjit.4](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.4) | 0.15.5 | [`12d587dfb20741cafc376c42c696c5f6e2a64487`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487) | [Adaptations and exclusions](https://github.com/arjitj2/open-pstack/blob/v1.4.1-arjit.4/UPSTREAM.md) |
| [v1.4.1-arjit.3](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.3) | 0.15.5 | [`12d587dfb20741cafc376c42c696c5f6e2a64487`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487) | [Adaptations and exclusions](https://github.com/arjitj2/open-pstack/blob/v1.4.1-arjit.3/UPSTREAM.md) |
| [v1.4.1-arjit.2](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.2) | 0.15.1 | [`f8abeddd1862dc73704e3d719dd73df0d51b8c71`](https://github.com/cursor/plugins/commit/f8abeddd1862dc73704e3d719dd73df0d51b8c71) | [Adaptations and exclusions](https://github.com/arjitj2/open-pstack/blob/v1.4.1-arjit.2/UPSTREAM.md) |
| [v1.4.1-arjit.1](https://github.com/arjitj2/open-pstack/releases/tag/v1.4.1-arjit.1) | 0.15.1 | [`f8abeddd1862dc73704e3d719dd73df0d51b8c71`](https://github.com/cursor/plugins/commit/f8abeddd1862dc73704e3d719dd73df0d51b8c71) | [Adaptations and exclusions](https://github.com/arjitj2/open-pstack/blob/v1.4.1-arjit.1/UPSTREAM.md) |

`v1.5.0` changes versioning and documentation. Its worker implementation and shared skills are unchanged from `v1.4.1-arjit.5`. See [compatibility evidence](compatibility.md) for validation and limitations, and [release policy](fork-maintenance.md#publish-a-release) for maintenance requirements.

Historical tags inherited from Eric’s port, such as `v1.4.1`, remain available for provenance. They are not releases of this independently maintained distribution.
