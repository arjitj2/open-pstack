#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('maintenance', Path(__file__).resolve().parents[1] / 'scripts/fork-maintenance.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class MaintenanceTests(unittest.TestCase):
    def test_managed_report_preserves_checklist_and_is_stable(self):
        original = '# Work\n- [x] Provider integration\n'
        first = m.managed_body(original, 'Healthy', {'notified': ['a']})
        self.assertTrue(first.startswith(original))
        self.assertEqual(first, m.managed_body(first, 'Healthy', {'notified': ['a']}))
        changed = m.managed_body(first, 'Needs review', {'notified': ['a', 'b']})
        self.assertIn('- [x] Provider integration', changed)
        self.assertNotIn('Healthy', changed)
        self.assertEqual(m.read_state(changed), {'notified': ['a', 'b']})

    def test_skill_markdown_and_unknown_paths_are_behavior(self):
        self.assertTrue(m.substantive(['pstack/skills/setup-pstack/SKILL.md']))
        self.assertTrue(m.substantive(['pstack/.cursor-plugin/plugin.json']))
        self.assertFalse(m.substantive(['pstack/README.md', 'pstack/docs/guide.md']))
        self.assertTrue(m.substantive(['pstack/docs/guide.md', 'pstack/skills/x/SKILL.md']))

    def test_paginated_api_preserves_every_page(self):
        with patch.object(m.subprocess, 'check_output', return_value='[[{"number":1}],[{"number":2}]]') as call:
            self.assertEqual(m.api('repos/a/b/pulls', paginate=True), [{'number': 1}, {'number': 2}])
            self.assertIn('--paginate', call.call_args.args[0])
            self.assertIn('--slurp', call.call_args.args[0])

    def test_unchanged_candidate_is_not_redispatched(self):
        head, base = 'a' * 40, 'b' * 40
        def git(*args):
            return head if args[0] == 'rev-parse' else ''
        def api(path, *args, **kwargs):
            if '/branches/' in path:
                return {'commit': {'sha': base}}
            return [{'number': 2, 'body': m.PR_MARKER + f'\n<!-- candidate-dispatched:{head}:{base} -->'}]
        with patch.object(m, 'git', side_effect=git), patch.object(m, 'api', side_effect=api), patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)), patch.object(m, 'run') as dispatch:
            m.sync()
            dispatch.assert_not_called()

    def test_failed_dispatch_does_not_record_success_marker(self):
        head, base = 'a' * 40, 'b' * 40
        calls = []
        def api(path, method='GET', payload=None, **kwargs):
            calls.append((path, method, payload))
            return {'commit': {'sha': base}} if '/branches/' in path else [{'number': 2, 'body': m.PR_MARKER}]
        with patch.object(m, 'git', side_effect=lambda *args: head if args[0] == 'rev-parse' else ''), patch.object(m, 'api', side_effect=api), patch.object(m.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1)), patch.object(m, 'run', side_effect=subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(subprocess.CalledProcessError):
                m.sync()
        self.assertFalse(any(method == 'PATCH' for _, method, _ in calls))
        self.assertEqual(calls[-1][2]['state'], 'pending')

    def test_health_retry_does_not_duplicate_alerts_or_touch_checklist(self):
        sha = 'c' * 40
        state = {'body': '# Setup\n- [x] Existing checklist\n', 'comments': []}
        writes = []
        def git(*args):
            if args[0] == 'show' and ':UPSTREAM.md' in args[-1]:
                return '| Commit | `' + 'a' * 40 + '` |'
            if args[0] == 'log' and '--reverse' in args:
                return sha + '\t2020-01-01T00:00:00+00:00\tFix worker execution'
            if args[0] == 'show':
                return 'pstack/skills/worker/SKILL.md'
            return ''
        def api(path, method='GET', payload=None, **kwargs):
            if method == 'POST':
                state['comments'].append(payload)
                writes.append(method)
                return payload
            if method == 'PATCH':
                state['body'] = payload['body']
                writes.append(method)
                return payload
            if path.startswith('repos/ericlitman/') and ('/comments?' in path or '/reviews?' in path):
                return []
            if '/comments?' in path:
                return state['comments']
            if '/pulls/' in path:
                return {'state': 'open', 'html_url': 'https://example.invalid/pr', 'title': 'Provider'}
            return {'body': state['body']}
        with patch.object(m, 'git', side_effect=git), patch.object(m, 'api', side_effect=api):
            m.health(weekly=True)
            first = state['body']
            m.health(weekly=True)
        self.assertEqual(writes, ['POST', 'PATCH'])
        self.assertEqual(first, state['body'])
        self.assertIn('- [x] Existing checklist', first)
        self.assertIn('21 days', state['comments'][0]['body'])

    def test_generated_reviews_do_not_count_as_maintainer_response(self):
        rows = [
            {'user': {'login': 'ericlitman', 'type': 'User'}, 'author_association': 'OWNER', 'body': '## Gavel review: approved', 'created_at': '2026-09-16T00:00:00Z', 'html_url': 'generated'},
            {'user': {'login': 'ericlitman', 'type': 'User'}, 'author_association': 'OWNER', 'body': 'Please adjust the setup flow.', 'created_at': '2026-09-15T00:00:00Z', 'html_url': 'human'},
        ]
        with patch.object(m, 'api', side_effect=[rows, []]):
            result = m.maintainer_activity(70)
        self.assertIn('2026-09-15', result)
        self.assertNotIn('generated)', result)

    def test_merge_only_fix_paths_are_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.check_output(['git', *args], cwd=directory, text=True, stderr=subprocess.DEVNULL).strip()
            git('init', '-b', 'main')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            root = Path(directory)
            (root / 'README').write_text('base')
            git('add', '.')
            git('commit', '-m', 'base')
            git('checkout', '-b', 'fix')
            skill = root / 'pstack/skills/worker/SKILL.md'
            skill.parent.mkdir(parents=True)
            skill.write_text('fixed behavior')
            git('add', '.')
            git('commit', '-m', 'worker change')
            git('checkout', 'main')
            (root / 'README').write_text('updated')
            git('commit', '-am', 'documentation')
            git('merge', '--no-ff', 'fix', '-m', 'Fix worker execution')
            merge = git('rev-parse', 'HEAD')
            with patch.object(m, 'git', side_effect=git):
                self.assertEqual(m.changed_paths(merge, 'pstack/'), ['pstack/skills/worker/SKILL.md'])
                self.assertTrue(m.substantive(m.changed_paths(merge, 'pstack/')))

    def test_normal_push_preserves_divergent_mirror(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, local = root / 'remote.git', root / 'local'
            def git(*args):
                return subprocess.run(['git', *args], cwd=local if local.exists() else root, text=True, capture_output=True, check=True).stdout.strip()
            git('init', '--bare', str(remote))
            git('clone', str(remote), str(local))
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            (local / 'file').write_text('base')
            git('add', 'file')
            git('commit', '-m', 'base')
            base = git('rev-parse', 'HEAD')
            git('push', 'origin', 'HEAD:upstream-main')
            (local / 'file').write_text('one')
            git('commit', '-am', 'one')
            first = git('rev-parse', 'HEAD')
            git('push', 'origin', 'HEAD:upstream-main')
            git('checkout', '--detach', base)
            (local / 'file').write_text('two')
            git('commit', '-am', 'two')
            with self.assertRaises(subprocess.CalledProcessError):
                git('push', 'origin', 'HEAD:upstream-main')
            self.assertEqual(git('ls-remote', 'origin', 'refs/heads/upstream-main').split()[0], first)


if __name__ == '__main__':
    unittest.main()
