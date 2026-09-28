#!/usr/bin/env python3
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PLUGIN = REPO / 'plugins' / 'pstack'
HOOKS = PLUGIN / 'hooks'
CODEX_MANIFEST = PLUGIN / '.codex-plugin' / 'plugin.json'
CODEX_DESCRIPTOR = HOOKS / 'codex-hooks.json'
CLAUDE_DESCRIPTOR = HOOKS / 'hooks.json'
CONTEXT = HOOKS / 'session-start-context.md'

CODEX_SOURCES = {'startup', 'resume', 'clear', 'compact'}
CLAUDE_SOURCES = {'startup', 'clear', 'compact'}


def load_json(path):
    return json.loads(path.read_text())


def single_session_start_handler(descriptor_path):
    data = load_json(descriptor_path)
    groups = data['hooks']['SessionStart']
    assert len(groups) == 1, '%s must register one SessionStart matcher group' % descriptor_path
    handlers = groups[0]['hooks']
    assert len(handlers) == 1, '%s must register one SessionStart handler' % descriptor_path
    return groups[0], handlers[0]


def event(source):
    return json.dumps({
        'session_id': 'thr_test',
        'transcript_path': None,
        'cwd': os.getcwd(),
        'hook_event_name': 'SessionStart',
        'source': source,
        'permission_mode': 'default',
        'model': 'gpt-5.6-sol',
    }).encode()


class DescriptorTests(unittest.TestCase):
    def test_codex_manifest_overrides_default_hook_discovery(self):
        manifest = load_json(CODEX_MANIFEST)
        entry = manifest.get('hooks')
        self.assertEqual(entry, './hooks/codex-hooks.json')
        resolved = (PLUGIN / entry).resolve()
        self.assertEqual(resolved, CODEX_DESCRIPTOR.resolve())
        self.assertTrue(str(resolved).startswith(str(PLUGIN.resolve()) + os.sep))
        self.assertTrue(CODEX_DESCRIPTOR.is_file())

    def test_codex_registration_matches_all_supported_sources(self):
        group, handler = single_session_start_handler(CODEX_DESCRIPTOR)
        matcher = re.compile(group['matcher'])
        for source in CODEX_SOURCES:
            self.assertIsNotNone(matcher.search(source), source)
        for rejected in ('', 'other', 'startupx', 'prestartup', 'resume2', 'subagent'):
            self.assertIsNone(matcher.search(rejected), rejected)
        self.assertEqual(handler['type'], 'command')
        self.assertFalse(handler.get('async', False))
        self.assertIn('${PLUGIN_ROOT}/hooks/run-hook.cmd', handler['command'])
        self.assertIn('session-start', handler['command'])
        self.assertNotIn('CLAUDE_PLUGIN_ROOT', handler['command'])
        self.assertIn('%PLUGIN_ROOT%', handler.get('commandWindows', ''))

    def test_claude_registration_is_unchanged(self):
        group, handler = single_session_start_handler(CLAUDE_DESCRIPTOR)
        matcher = re.compile(group['matcher'])
        for source in CLAUDE_SOURCES:
            self.assertIsNotNone(matcher.search(source), source)
        self.assertIsNone(matcher.search('resume'))
        self.assertEqual(handler['type'], 'command')
        self.assertFalse(handler.get('async', False))
        self.assertIn('${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cmd', handler['command'])

    def test_descriptors_point_at_the_same_emitter(self):
        _, codex_handler = single_session_start_handler(CODEX_DESCRIPTOR)
        _, claude_handler = single_session_start_handler(CLAUDE_DESCRIPTOR)
        for command in (codex_handler['command'], claude_handler['command']):
            self.assertIn('hooks/run-hook.cmd', command)
            self.assertRegex(command, r'session-start"\s*$|session-start\s*$')


class EmissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.workdir = Path(self.tmp.name) / 'elsewhere'
        self.workdir.mkdir()
        self.expected = CONTEXT.read_bytes()

    def shipped_output(self, descriptor, env_name, stdin_bytes, extra_env=None):
        _, handler = single_session_start_handler(descriptor)
        env = dict(os.environ)
        env.update(extra_env or {})
        env[env_name] = str(PLUGIN)
        proc = subprocess.run(
            ['bash', '-c', handler['command']],
            cwd=str(self.workdir), env=env, input=stdin_bytes,
            capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stderr, b'')
        return proc.stdout

    def test_shipped_codex_command_emits_exact_shared_text_for_every_source(self):
        for source in CODEX_SOURCES:
            with self.subTest(source=source):
                out = self.shipped_output(CODEX_DESCRIPTOR, 'PLUGIN_ROOT', event(source))
                self.assertEqual(out, self.expected)

    def test_shipped_claude_command_emits_the_same_bytes(self):
        for source in CLAUDE_SOURCES:
            with self.subTest(source=source):
                out = self.shipped_output(CLAUDE_DESCRIPTOR, 'CLAUDE_PLUGIN_ROOT', event(source))
                self.assertEqual(out, self.expected)

    def test_emitter_ignores_event_content_and_repeats_without_dedup(self):
        first = self.shipped_output(CODEX_DESCRIPTOR, 'PLUGIN_ROOT', event('startup'))
        again = self.shipped_output(CODEX_DESCRIPTOR, 'PLUGIN_ROOT', event('startup'))
        garbage = self.shipped_output(CODEX_DESCRIPTOR, 'PLUGIN_ROOT', b'not json\n')
        empty = self.shipped_output(CODEX_DESCRIPTOR, 'PLUGIN_ROOT', b'')
        self.assertEqual(first, again)
        self.assertEqual(first, garbage)
        self.assertEqual(first, empty)

    def test_hook_has_no_preference_gate_and_touches_no_model_files(self):
        home = Path(self.tmp.name) / 'home'
        codex_home = home / '.codex'
        codex_home.mkdir(parents=True)
        sheet = codex_home / 'pstack-models.md'
        agents = codex_home / 'AGENTS.md'
        sheet.write_text('# sheet\nrole: codex:gpt-5.6-sol@max\n')
        agents.write_text('<!-- pstack:models:begin -->\nsheet bytes\n<!-- pstack:models:end -->\n')
        before = {p: p.read_bytes() for p in sorted(home.rglob('*')) if p.is_file()}
        extra = {'HOME': str(home), 'CODEX_HOME': str(codex_home)}
        out = self.shipped_output(CODEX_DESCRIPTOR, 'PLUGIN_ROOT', event('compact'), extra_env=extra)
        self.assertEqual(out, self.expected)
        after = {p: p.read_bytes() for p in sorted(home.rglob('*')) if p.is_file()}
        self.assertEqual(before, after)

if __name__ == '__main__':
    unittest.main()
