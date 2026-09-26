#!/usr/bin/env python3
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('checkdocs', Path(__file__).resolve().parents[1] / 'scripts/check-docs.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

SHA = 'a' * 40
TYPES = '''export const PARENTS = ["claude", "codex"] as const;
export const PROVIDERS = ["claude", "codex", "grok", "devin", "cursor", "antigravity"] as const;
'''
README = '''# Fixture

## Supported parent apps and worker providers

Codex (`codex`) and Claude Code (`claude`) are supported as parents.

| Worker provider | Descriptor prefix |
| --- | --- |
| OpenAI | `codex` |
| Anthropic | `claude` |
| xAI | `grok` |
| Devin | `devin` |
| Cursor | `cursor` |
| Antigravity | `antigravity` |

## Notes

See [dispatch](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#model-matrix).
'''
CHANGELOG = f'''# Changes

## 1.8.0 current

Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/{SHA}/pstack).

## 1.7.0 old

Cursor baseline: [0.15.1](https://github.com/cursor/plugins/tree/{'b' * 40}/pstack).
'''
UPSTREAM = f'''# Upstream

| Source | Value |
| --- | --- |
| Commit | `{SHA}` |
| Upstream version | `0.15.5` |

The [pinned README](https://github.com/cursor/plugins/blob/{SHA}/pstack/README.md) is the source.
'''


def write(root, rel, text):
    path = Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


class CheckDocsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='check-docs-test-')
        self.root = Path(self.tmp)
        subprocess.check_call(['git', 'init', '-q'], cwd=self.root)
        write(self.root, m.RUNNER_TYPES, TYPES)
        write(self.root, m.PLUGIN_MANIFEST, '{"name":"pstack","version":"1.8.0"}\n')
        write(self.root, 'plugins/pstack/skills/poteto-mode/references/provider-dispatch.md', '# Dispatch\n\n## Model matrix\n')
        write(self.root, 'README.md', README)
        write(self.root, 'CHANGELOG.md', CHANGELOG)
        write(self.root, 'UPSTREAM.md', UPSTREAM)
        for rel in m.APPROVED - {'README.md', 'CHANGELOG.md', 'UPSTREAM.md', 'maintenance/upstream-ledger.json'}:
            write(self.root, rel, '# Allowed\n' if rel.endswith('.md') else 'allowed\n')
        write(self.root, 'maintenance/upstream-ledger.json', '{}\n')
        self.stage()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def stage(self):
        subprocess.check_call(['git', 'add', '-A'], cwd=self.root)

    def edit(self, rel, old, new):
        path = self.root / rel
        path.write_text(path.read_text().replace(old, new, 1))
        self.stage()

    def messages(self):
        return [p.message for p in m.check(self.root)]

    def test_clean_fixture_and_historical_baseline(self):
        self.assertEqual(m.check(self.root), [])

    def test_inventory_catches_public_sprawl_only(self):
        for rel in ('docs/dated-report.md', 'maintenance/proposals/old/audit.json', 'EXTRA.md',
                    'LICENSE-old', 'LICENSES/extra', 'NOTICE-extra'):
            write(self.root, rel, 'artifact\n')
        write(self.root, '.agents/skills/verify-open-pstack/features/custom.md', '# Reusable recipe\n')
        write(self.root, 'scripts/helper.md', '# Tooling note\n')
        write(self.root, '.github/workflows/config.yml', 'name: test\n')
        self.stage()
        found = {p.path for p in m.inventory_problems(self.root)}
        self.assertEqual(found, {'docs/dated-report.md', 'maintenance/proposals/old/audit.json',
                                 'EXTRA.md', 'LICENSE-old', 'LICENSES/extra', 'NOTICE-extra'})
        (self.root / 'EXTRA.md').unlink()
        self.assertNotIn('EXTRA.md', {p.path for p in m.inventory_problems(self.root)})

    def test_current_heading_version_and_baseline_are_required(self):
        self.edit('CHANGELOG.md', '## 1.8.0 current', '## 1.7.9 current')
        self.assertTrue(any('first version heading' in x for x in self.messages()))
        self.edit('CHANGELOG.md', '## 1.7.9 current', '## 1.8.0 current')
        self.edit('CHANGELOG.md', f'tree/{SHA}/pstack', f'tree/{"c" * 40}/pstack')
        self.assertTrue(any('Cursor baseline' in x for x in self.messages()))
        self.edit('CHANGELOG.md', f'tree/{"c" * 40}/pstack', f'tree/{SHA}/pstack')
        self.edit('CHANGELOG.md', '## 1.7.0 old', f'Cursor baseline: [0.15.5](https://github.com/cursor/plugins/tree/{SHA}/pstack).\n\n## 1.7.0 old')
        self.assertTrue(any('exactly one Cursor baseline' in x for x in self.messages()))

    def test_upstream_version_and_readme_pin_must_match(self):
        self.edit('UPSTREAM.md', '`0.15.5`', '`0.15.6`')
        self.assertTrue(any('Cursor baseline' in x for x in self.messages()))
        self.edit('UPSTREAM.md', '`0.15.6`', '`0.15.5`')
        self.edit('UPSTREAM.md', f'blob/{SHA}/pstack/README.md', f'blob/{"d" * 40}/pstack/README.md')
        self.assertTrue(any('pinned Cursor README' in x for x in self.messages()))

    def test_provider_and_links_still_checked(self):
        self.edit('README.md', '| Antigravity | `antigravity` |', '')
        self.assertTrue(any('antigravity' in x for x in self.messages()))
        self.edit('README.md', '| Cursor | `cursor` |', '| Cursor | `cursor` |\n[broken](missing.md)')
        self.assertTrue(any('missing.md' in x for x in self.messages()))

    def test_new_source_provider_and_duplicate_rows_fail(self):
        self.edit(m.RUNNER_TYPES, '"antigravity"]', '"antigravity", "gemini"]')
        self.assertTrue(any('gemini' in x and 'lacks' in x for x in self.messages()))
        self.edit('README.md', '| Cursor | `cursor` |', '| Cursor | `cursor` |\n| Duplicate | `cursor` |')
        self.assertTrue(any('duplicate provider descriptor' in x for x in self.messages()))

    def test_provider_row_reordering_passes(self):
        self.edit('README.md', '| OpenAI | `codex` |\n| Anthropic | `claude` |',
                  '| Anthropic | `claude` |\n| OpenAI | `codex` |')
        self.assertEqual(m.check(self.root), [])

    def test_missing_source_declaration_and_expression_fail(self):
        self.edit(m.RUNNER_TYPES, 'export const PROVIDERS', 'export const PROVIDERS_X')
        self.assertTrue(any('PROVIDERS' in x for x in self.messages()))
        write(self.root, m.RUNNER_TYPES, TYPES.replace('"antigravity"]', '"antigravity", EXTRA_PROVIDER]'))
        self.stage()
        self.assertTrue(any('PROVIDERS' in x for x in self.messages()))
        write(self.root, m.RUNNER_TYPES, 'export type Provider = string;\n')
        self.stage()
        self.assertTrue(any('PARENTS' in x for x in self.messages()))

    def test_parent_line_drift_fails(self):
        self.edit('README.md', 'Claude Code (`claude`)', 'Claude Code')
        self.assertTrue(any('claude' in x and 'PARENTS' in x for x in self.messages()))

    def test_missing_file_and_heading_anchors_fail(self):
        write(self.root, 'CONTRIBUTING.md', '# Contributing\n\n[a](missing.md) [b](#no-such-heading) [c](README.md#notes)\n')
        self.stage()
        messages = self.messages()
        self.assertTrue(any('missing.md' in x for x in messages))
        self.assertTrue(any('no-such-heading' in x for x in messages))
        self.assertFalse(any('README.md#notes' in x for x in messages))
        write(self.root, 'CONTRIBUTING.md', '# Contributing\n\n[d](README.md#bogus-anchor)\n')
        self.stage()
        self.assertTrue(any('bogus-anchor' in x for x in self.messages()))

    def test_plugin_heading_anchor_is_checked(self):
        write(self.root, 'CONTRIBUTING.md', '# Contributing\n\n'
              '[ok](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#model-matrix)\n'
              '[bad](plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#missing)\n')
        self.stage()
        messages = self.messages()
        self.assertTrue(any('#missing' in x for x in messages))
        self.assertFalse(any('#model-matrix' in x for x in messages))

    def test_valid_anchors_fences_inline_code_schemes_and_encoding(self):
        write(self.root, 'CONTRIBUTING.md', '# Guide\n\n## Intro\n\n## Intro\n\n## Café menu\n'
              '[a](#intro-1) [b](#caf%C3%A9-menu)\n'
              '````markdown\n```\n[inside](missing.md)\n```\n````\n'
              '`[inline](missing.md)` [ext](https://invalid.example/x)\n')
        self.stage()
        self.assertEqual(m.check(self.root), [])

    def test_untracked_docs_are_skipped(self):
        write(self.root, '.worktrees/other/bad.md', '[x](missing.md)\n')
        self.assertEqual(m.check(self.root), [])

    def test_heading_suffix_collision_and_reference_definition(self):
        write(self.root, 'CONTRIBUTING.md', '# Foo\n# Foo\n# Foo-1\n[valid](#foo-1-1)\n')
        self.stage()
        self.assertEqual(m.check(self.root), [])
        write(self.root, 'CONTRIBUTING.md', '[missing][target]\n\n[target]: missing.md\n')
        self.stage()
        self.assertTrue(any('missing.md' in x for x in self.messages()))

    def test_reusable_verification_link_is_scanned(self):
        rel = '.agents/skills/verify-open-pstack/features/extra.md'
        write(self.root, rel, '# Extra\n\n[missing](../../../missing.md)\n')
        self.stage()
        self.assertTrue(any(p.path == rel and 'missing.md' in p.message for p in m.check(self.root)))

    def test_cli_exit_codes(self):
        self.assertEqual(m.main(['--root', str(self.root)]), 0)
        self.edit('CHANGELOG.md', '## 1.8.0 current', '## 0.0.0 current')
        self.assertEqual(m.main(['--root', str(self.root)]), 1)


if __name__ == '__main__':
    unittest.main()
