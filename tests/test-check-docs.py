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

TYPES = '''export const PARENTS = ["claude", "codex"] as const;
export const PROVIDERS = ["claude", "codex", "grok", "devin", "cursor", "antigravity"] as const;
export type Provider = (typeof PROVIDERS)[number];
'''
MANIFEST = '{"name": "pstack", "version": "1.6.0"}\n'
README = '''# Fixture

Intro.

## Supported parent apps and worker providers

**This distribution supports Codex (`codex`) and Claude Code (`claude`) as parents.**

| Worker provider | Descriptor prefix | From a Codex parent |
| --- | --- | --- |
| OpenAI / Codex | `codex` | Native |
| Anthropic / Claude | `claude` | External |
| xAI / Grok | `grok` | External |
| Devin | `devin` | External |
| Cursor | `cursor` | External |
| Antigravity | `antigravity` | External |

## Notes

See [plugin](plugins/pstack/skills/poteto-mode/scripts/runner/types.ts) and [self](#notes).
'''
RELEASES = '''# Distribution releases

The `main` installation package advances to 1.6.0 with new workers, retaining the same baseline.

| Distribution release | Cursor Pstack version |
| --- | --- |
| [v1.5.0](https://example.invalid/v1.5.0) | 0.15.5 |
| [v1.4.1-arjit.2](https://example.invalid/old) | 0.15.1 |
'''
CHANGES = '# CHANGES\n\n## 1.6.0 — new workers\n\nText.\n\n## 1.5.0 — numbering\n\nOld text.\n'


def write(root, rel, text):
    path = Path(root) / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def make_repo(root):
    root = Path(root)
    subprocess.check_call(['git', 'init', '-q'], cwd=root)
    write(root, 'plugins/pstack/skills/poteto-mode/scripts/runner/types.ts', TYPES)
    write(root, 'plugins/pstack/.claude-plugin/plugin.json', MANIFEST)
    write(root, 'plugins/pstack/skills/poteto-mode/references/provider-dispatch.md',
          '# Dispatch\n\n## Model matrix\n\n## Optional Devin models\n')
    write(root, 'README.md', README)
    write(root, 'docs/releases.md', RELEASES)
    write(root, 'CHANGES.md', CHANGES)
    return root


def stage(root):
    subprocess.check_call(['git', 'add', '-A'], cwd=root)


class CheckDocsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='check-docs-test-')
        self.root = make_repo(self.tmp)
        stage(self.root)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def edit(self, rel, old, new):
        path = self.root / rel
        path.write_text(path.read_text().replace(old, new, 1))
        stage(self.root)

    def messages(self):
        return [p.message for p in m.check(self.root)]

    def test_clean_fixture_passes(self):
        self.assertEqual(m.check(self.root), [])

    def test_new_source_provider_without_doc_fails(self):
        self.edit('plugins/pstack/skills/poteto-mode/scripts/runner/types.ts',
                  '"antigravity"]', '"antigravity", "gemini"]')
        problems = m.check(self.root)
        self.assertTrue(any('gemini' in p.message and 'lacks' in p.message for p in problems))

    def test_removed_and_duplicate_rows_fail(self):
        self.edit('README.md', '| Antigravity | `antigravity` | External |\n', '')
        problems = m.check(self.root)
        self.assertTrue(any('antigravity' in p.message for p in problems))
        self.edit('README.md', '| xAI / Grok | `grok` | External |',
                  '| xAI / Grok | `grok` | External |\n| Duplicate Grok | `grok` | External |')
        problems = m.check(self.root)
        self.assertTrue(any('duplicate' in p.message for p in problems))

    def test_row_reorder_still_passes(self):
        rows = ['| OpenAI / Codex | `codex` | Native |', '| Anthropic / Claude | `claude` | External |']
        self.edit('README.md', '\n'.join(rows), '\n'.join(reversed(rows)))
        self.assertEqual(m.check(self.root), [])

    def test_missing_source_declaration_fails_loudly(self):
        write(self.root, 'plugins/pstack/skills/poteto-mode/scripts/runner/types.ts',
              TYPES.replace('export const PROVIDERS', 'export const PROVIDERS_X'))
        stage(self.root)
        problems = m.check(self.root)
        self.assertTrue(any('PROVIDERS' in p.message for p in problems))
        write(self.root, 'plugins/pstack/skills/poteto-mode/scripts/runner/types.ts',
              'export type Provider = string;\n')
        stage(self.root)
        self.assertTrue(any('PARENTS' in p.message for p in m.check(self.root)))

    def test_broken_file_and_anchor_links_fail(self):
        write(self.root, 'docs/extra.md', '# X\n\n[a](missing.md) [b](#no-such-heading) [c](../README.md)\n')
        stage(self.root)
        problems = m.check(self.root)
        msgs = [p.message for p in problems]
        self.assertTrue(any('missing.md' in x for x in msgs))
        self.assertTrue(any('no-such-heading' in x for x in msgs))
        self.assertFalse(any('README.md' in x and 'not found' in x for x in msgs))
        write(self.root, 'docs/extra.md', '# X\n\n[d](../README.md#bogus-anchor)\n')
        stage(self.root)
        self.assertTrue(any('bogus-anchor' in p.message for p in m.check(self.root)))

    def test_broken_link_into_plugin_docs_fails(self):
        write(self.root, 'docs/extra.md',
              '# X\n\n[ok](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#model-matrix)\n'
              '[bad](../plugins/pstack/skills/poteto-mode/references/provider-dispatch.md#no-such)\n')
        stage(self.root)
        problems = m.check(self.root)
        self.assertTrue(any('no-such' in p.message for p in problems))
        self.assertFalse(any('model-matrix' in p.message for p in problems))

    def test_valid_anchors_fences_inline_code_and_schemes_pass(self):
        write(self.root, 'docs/heads.md', '# H\n\n## Intro\n\n## Intro\n\n[a](#intro-1)\n')
        write(self.root, 'docs/enc.md', '# E\n\n## What’s added\n\n## Café menu\n\n[a](#whats-added) [b](heads.md#intro) '
              '[c](#caf%C3%A9-menu)\n```\n[inside-fence](nope.md)\n```\n`[inline](nope.md)` [ext](https://no-such-host.invalid/x)\n')
        stage(self.root)
        self.assertEqual(m.check(self.root), [])

    def test_exempt_scopes_and_untracked_files_are_skipped(self):
        write(self.root, 'README-UPSTREAM.md', '# verbatim\n\n[a](missing.md)\n')
        write(self.root, 'maintenance/proposals/p1/report.md', '# generated\n\n[b](missing.md)\n')
        write(self.root, 'docs/plans/old.md', '# frozen plan with v1.3.0 and claude-opus-4 text\n')
        write(self.root, 'docs/dated-20260101.md', '# record\n\nDated record: claude-opus-4, v1.4.1, f8abedd.\n')
        stage(self.root)
        write(self.root, '.worktrees/other/bad.md', '[x](missing.md)\n')
        self.assertEqual(m.check(self.root), [])

    def test_release_version_accounted_by_row_or_pending_line(self):
        self.assertEqual(m.check(self.root), [])
        self.edit('docs/releases.md', '| [v1.5.0]',
                  '| [v1.6.0](https://example.invalid/v1.6.0) | 0.15.5 |\n| [v1.5.0]')
        problems = m.check(self.root)
        self.assertTrue(any('advances' in p.message for p in problems))
        self.edit('docs/releases.md', 'The `main` installation package advances to 1.6.0 with new workers, retaining the same baseline.\n\n', '')
        self.assertEqual(m.check(self.root), [])

    def test_pending_version_mismatch_and_missing_changes_heading_fail(self):
        self.edit('plugins/pstack/.claude-plugin/plugin.json', '"version": "1.6.0"', '"version": "1.7.0"')
        problems = m.check(self.root)
        msgs = [p.message for p in problems]
        self.assertTrue(any('advances to 1.7.0' in x for x in msgs))
        self.assertTrue(any('## 1.7.0' in x for x in msgs))

    def test_older_release_baseline_may_differ(self):
        self.assertEqual(m.check(self.root), [])

    def test_parent_line_drift_fails(self):
        self.edit('README.md', 'Codex (`codex`) and Claude Code (`claude`)', 'Codex (`codex`) and Claude Code')
        problems = m.check(self.root)
        self.assertTrue(any('claude' in p.message and 'PARENTS' in p.message for p in problems))

    def test_cli_exit_codes(self):
        self.assertEqual(m.main(['--root', str(self.root)]), 0)
        self.edit('README.md', '| Antigravity | `antigravity` | External |\n', '')
        self.assertEqual(m.main(['--root', str(self.root)]), 1)

    def test_unsupported_source_expression_fails(self):
        self.edit(m.RUNNER_TYPES, '"antigravity"]', '"antigravity", EXTRA_PROVIDER]')
        self.assertTrue(any('PROVIDERS' in p.message for p in m.check(self.root)))

    def test_shorter_fence_does_not_close_block(self):
        write(self.root, 'docs/fenced.md', '````markdown\n```\n[example](missing.md)\n```\n````\n')
        stage(self.root)
        self.assertEqual(m.check(self.root), [])

    def test_heading_suffix_collision(self):
        write(self.root, 'docs/collision.md', '# Foo\n# Foo\n# Foo-1\n[valid](#foo-1-1)\n')
        stage(self.root)
        self.assertEqual(m.check(self.root), [])

    def test_conflicting_pending_versions_fail(self):
        self.edit('docs/releases.md', '# Distribution releases', '# Distribution releases\n\nThe `main` installation package advances to 1.7.0.')
        self.assertTrue(any(p.path == m.RELEASES for p in m.check(self.root)))

    def test_reference_definition_links_checked(self):
        write(self.root, 'docs/reference-link.md', '[missing][target]\n\n[target]: missing.md\n')
        stage(self.root)
        self.assertTrue(any('missing.md' in p.message for p in m.check(self.root)))


if __name__ == '__main__':
    unittest.main()
