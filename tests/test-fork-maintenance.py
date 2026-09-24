#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('maintenance', Path(__file__).resolve().parents[1] / 'scripts/fork-maintenance.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)

FORK = m.FORK
UPSTREAM_DOC = """# Upstream synchronization

| Source | Value |
| --- | --- |
| Repository | `https://github.com/cursor/plugins.git` |
| Path | `pstack/` |
| Commit | `%s` |
| Upstream version | `0.15.1` |
"""
OLD = {"GIT_AUTHOR_DATE": "2020-01-01T00:00:00+00:00", "GIT_COMMITTER_DATE": "2020-01-01T00:00:00+00:00"}


def repo_git(cwd, *args, env=None, stdin=None):
    full = dict(os.environ)
    if env:
        full.update(env)
    return subprocess.check_output(["git", *args], cwd=cwd, env=full, input=stdin, text=True).strip()


class Repos:
    pass


def build_repos(root):
    root = Path(root)
    repos = Repos()
    cursor = root / "cursor"
    cursor.mkdir()
    cgit = lambda *a, **k: repo_git(cursor, *a, **k)
    cgit("init", "-b", "main")
    cgit("config", "user.name", "Cursor")
    cgit("config", "user.email", "cursor@example.invalid")
    cgit("config", "commit.gpgsign", "false")
    (cursor / "pstack/skills/one").mkdir(parents=True)
    (cursor / "pstack/skills/one/SKILL.md").write_text("one v1\n\n")
    cgit("add", ".")
    cgit("commit", "-m", "baseline pstack")
    repos.baseline = cgit("rev-parse", "HEAD")
    (cursor / "pstack/skills/two").mkdir(parents=True)
    (cursor / "pstack/skills/two/SKILL.md").write_text("two v1\n")
    cgit("add", ".")
    cgit("commit", "-m", "Add second skill", env=OLD)
    repos.c1 = cgit("rev-parse", "HEAD")
    (cursor / "pstack/README.md").write_text("docs\n")
    cgit("add", ".")
    cgit("commit", "-m", "Document pstack", env=OLD)
    repos.c2 = cgit("rev-parse", "HEAD")
    (cursor / "other").mkdir()
    (cursor / "other/x.txt").write_text("x\n")
    cgit("add", ".")
    cgit("commit", "-m", "Unrelated monorepo change")
    repos.tip = cgit("rev-parse", "HEAD")
    repos.cursor = cursor

    fork = root / "fork"
    fork.mkdir()
    fgit = lambda *a, **k: repo_git(fork, *a, **k)
    fgit("init", "-b", "main")
    fgit("config", "user.name", "Fork")
    fgit("config", "user.email", "fork@example.invalid")
    fgit("config", "commit.gpgsign", "false")
    (fork / "UPSTREAM.md").write_text(UPSTREAM_DOC % repos.baseline)
    (fork / "maintenance").mkdir()
    (fork / m.LEDGER_PATH).write_text(json.dumps(
        {"schema": 1, "source": {"repository": "cursor/plugins", "ref": "main", "path": "pstack/"},
         "reviewed_through": repos.baseline, "entries": []}, indent=2) + "\n")
    (fork / "plugins/pstack").mkdir(parents=True)
    (fork / "plugins/pstack/keep.txt").write_text("keep\n")
    (fork / "README.md").write_text("fork\n")
    fgit("add", ".")
    fgit("commit", "-m", "main base")
    repos.base = fgit("rev-parse", "HEAD")
    repos.origin = root / "origin.git"
    repo_git(root, "init", "--bare", str(repos.origin))
    fgit("remote", "add", "origin", str(repos.origin))
    fgit("push", "-u", "origin", "main")
    fgit("fetch", "--no-tags", str(cursor), "main:" + m.CURSOR_REF)
    repos.fork = fork
    return repos


class FakeGitHub:

    def __init__(self, git):
        self.git = git
        self.pulls = []
        self.statuses = {}
        self.comments = []
        self.issue_body = "# Maintenance\n\n- [x] Human checklist\n"
        self.calls = []
        self.next_number = 1

    def find(self, number):
        return next(p for p in self.pulls if p["number"] == int(number))

    def api(self, path, method="GET", payload=None, paginate=False):
        self.calls.append((method, path))
        f = re.escape(FORK)
        if path == "repos/%s/issues/1" % FORK:
            if method == "PATCH":
                self.issue_body = payload["body"]
                return payload
            return {"body": self.issue_body}
        if path.startswith("repos/%s/issues/1/comments" % FORK):
            if method == "POST":
                self.comments.append(payload["body"])
                return payload
            return [{"body": c} for c in self.comments]
        if re.match(f + r"/issues/\d+/comments", path.replace("repos/", "", 1)) and method == "POST":
            self.comments.append(payload["body"])
            return payload
        if path.startswith("repos/%s/pulls?" % FORK):
            out = list(self.pulls)
            query = path.split("?", 1)[1]
            if "state=open" in query:
                out = [p for p in out if p["state"] == "open"]
            head = re.search(r"head=([^&]+)", query)
            if head:
                want = head.group(1).split(":", 1)[1]
                out = [p for p in out if p["head"]["ref"] == want and p["head"]["repo"]["full_name"] == FORK]
            return out
        if path == "repos/%s/pulls" % FORK and method == "POST":
            branch = payload["head"]
            sha = self.git("ls-remote", "origin", "refs/heads/" + branch).split()[0]
            pr = {"number": self.next_number, "state": "open", "title": payload["title"],
                  "body": payload["body"],
                  "head": {"ref": branch, "sha": sha, "repo": {"full_name": FORK}},
                  "base": {"ref": payload["base"], "sha": self.git("rev-parse", "HEAD")},
                  "merged_at": None, "html_url": "https://example.invalid/pull/%d" % self.next_number}
            self.next_number += 1
            self.pulls.append(pr)
            return pr
        match = re.match(f + r"/pulls/(\d+)$", path.replace("repos/", "", 1))
        if match:
            pr = self.find(match.group(1))
            if method == "PATCH":
                pr.update(payload)
            return pr
        match = re.match(f + r"/statuses/([0-9a-f]{40})$", path.replace("repos/", "", 1))
        if match and method == "POST":
            self.statuses.setdefault(match.group(1), []).append(payload)
            return payload
        match = re.search(r"commits/([0-9a-f]{40})/statuses", path)
        if match:
            return self.statuses.get(match.group(1), [])
        if path.startswith("repos/%s/pulls/" % m.UPSTREAM):
            return {"state": "open", "merged_at": None, "html_url": "https://example.invalid/u", "title": "Contribution"}
        if path.startswith("repos/%s/" % m.UPSTREAM):
            return []
        raise AssertionError("unexpected api %s %s" % (method, path))


class MaintenanceUnitTests(unittest.TestCase):
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

    def test_generated_reviews_do_not_count_as_maintainer_response(self):
        rows = [
            {'user': {'login': 'ericlitman', 'type': 'User'}, 'author_association': 'OWNER', 'body': '## Gavel review: approved', 'created_at': '2026-09-16T00:00:00Z', 'html_url': 'generated'},
            {'user': {'login': 'ericlitman', 'type': 'User'}, 'author_association': 'OWNER', 'body': 'Please adjust the setup flow.', 'created_at': '2026-09-15T00:00:00Z', 'html_url': 'human'},
        ]
        with patch.object(m, 'api', side_effect=[rows, []]):
            result = m.maintainer_activity(70)
        self.assertIn('2026-09-15', result)
        self.assertNotIn('generated)', result)

    def test_invalid_ledger_and_status_are_rejected(self):
        good = {'schema': 1, 'reviewed_through': 'a' * 40, 'entries': []}
        self.assertEqual(m.ledger_structure_errors(good), [])
        self.assertTrue(m.ledger_structure_errors({'schema': 2, 'reviewed_through': 'a' * 40, 'entries': []}))
        self.assertTrue(m.ledger_structure_errors({'schema': 1, 'reviewed_through': 'abc', 'entries': []}))
        self.assertTrue(m.ledger_structure_errors({'schema': 1, 'reviewed_through': 'a' * 40, 'entries': {}}))
        self.assertTrue(m.ledger_structure_errors({'schema': 1, 'reviewed_through': 'a' * 40,
                                         'entries': [{'commit': 'b' * 40, 'status': 'merged'}]}))
        self.assertTrue(m.ledger_structure_errors({'schema': 1, 'reviewed_through': 'a' * 40,
                                         'entries': [{'commit': 'b' * 40, 'status': 'pending', 'reason': 'x'}]}))
        dup = [{'commit': 'b' * 40, 'status': 'pending'}, {'commit': 'b' * 40, 'status': 'pending'}]
        self.assertTrue(m.ledger_structure_errors({'schema': 1, 'reviewed_through': 'a' * 40, 'entries': dup}))

    def test_final_decisions_require_reason_and_evidence(self):
        entry = {'commit': 'b' * 40, 'status': 'adopted'}
        ledger = {'schema': 1, 'reviewed_through': 'a' * 40, 'entries': [entry]}
        self.assertTrue(m.ledger_structure_errors(ledger))
        entry['reason'] = 'matches our provider model'
        self.assertTrue(m.ledger_structure_errors(ledger))
        entry['evidence'] = 'https://example.invalid/pr/9 plus installed-host run'
        self.assertEqual(m.ledger_structure_errors(ledger), [])
        for status in ('adapted', 'excluded'):
            entry['status'] = status
            self.assertEqual(m.ledger_structure_errors(ledger), [])

    def test_update_issue_retry_does_not_duplicate_alerts_or_touch_checklist(self):
        fake = FakeGitHub(lambda *a, **k: '')
        alerts = [('lag:%s:21' % ('c' * 40), 'Cursor change has waited at least 21 days.')]
        with patch.object(m, 'api', side_effect=fake.api):
            m.update_issue(alerts, 'Report A')
            first = fake.issue_body
            m.update_issue(alerts, 'Report A')
        writes = [c for c in fake.calls if c[0] != 'GET']
        self.assertEqual(len(writes), 2)
        self.assertEqual(first, fake.issue_body)
        self.assertIn('- [x] Human checklist', first)
        self.assertIn('21 days', fake.comments[0])
        self.assertIn('maintenance-alert', fake.comments[0])


class MaintenanceGitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='fork-maintenance-test-')
        self.repos = build_repos(self.tmp)
        self.prev_cwd = os.getcwd()
        os.chdir(str(self.repos.fork))
        self.git = lambda *a, **k: repo_git(self.repos.fork, *a, **k)
        self.fake = FakeGitHub(self.git)

    def tearDown(self):
        os.chdir(self.prev_cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def new_commits(self):
        return m.log_pstack(self.repos.baseline, m.CURSOR_REF)

    def test_merge_only_fix_paths_are_visible(self):
        self.git('checkout', '-b', 'fix')
        skill = self.repos.fork / 'pstack-local/skills/worker/SKILL.md'
        skill.parent.mkdir(parents=True)
        skill.write_text('fixed behavior')
        self.git('add', '.')
        self.git('commit', '-m', 'worker change')
        self.git('checkout', 'main')
        (self.repos.fork / 'README.md').write_text('updated')
        self.git('commit', '-am', 'documentation')
        self.git('merge', '--no-ff', 'fix', '-m', 'Fix worker execution')
        merge = self.git('rev-parse', 'HEAD')
        self.assertEqual(m.changed_paths(merge, 'pstack-local/'), ['pstack-local/skills/worker/SKILL.md'])
        self.assertTrue(m.substantive(m.changed_paths(merge)))

    def test_proposal_commit_is_deterministic_and_metadata_only(self):
        ledger = m.load_ledger(ref=self.repos.base)
        new = self.new_commits()
        self.assertEqual([c['sha'] for c in new], [self.repos.c1, self.repos.c2])
        files1, meta1 = m.build_proposal(self.repos.base, ledger, self.repos.baseline, new)
        files2, meta2 = m.build_proposal(self.repos.base, ledger, self.repos.baseline, new)
        self.assertEqual(files1, files2)
        with m.temporary_proposal_commit(self.repos.base, files1, meta1) as (commit1, env1), \
                m.temporary_proposal_commit(self.repos.base, files2, meta2) as (commit2, env2):
            self.assertEqual(commit1, commit2)
            self.assertEqual(self.git('rev-list', '--parents', '-n', '1', commit1, env=env1).split(),
                             [commit1, self.repos.base])
            changed = self.git('diff', '--name-only', self.repos.base, commit1, env=env1).splitlines()
            self.assertTrue(changed)
            self.assertTrue(all(p.startswith('maintenance/') for p in changed))
            self.assertEqual(self.git('rev-parse', self.repos.base + ':plugins/pstack'),
                             self.git('rev-parse', commit1 + ':plugins/pstack', env=env1))
            after = json.loads(self.git('show', commit1 + ':' + m.LEDGER_PATH, env=env1))
            self.assertEqual(after['reviewed_through'], self.repos.c2)
            self.assertEqual([e['status'] for e in after['entries']], ['pending', 'pending'])
            self.assertEqual([e['commit'] for e in after['entries']], [self.repos.c1, self.repos.c2])

    def test_source_patch_preserves_terminal_blank_context_and_parses(self):
        (self.repos.cursor / 'pstack/skills/one/SKILL.md').write_text('one v2\n\n')
        repo_git(self.repos.cursor, 'commit', '-am', 'Change first line, keep blank context')
        self.git('fetch', '--no-tags', str(self.repos.cursor), 'main:' + m.CURSOR_REF)
        target = self.git('rev-parse', m.CURSOR_REF)
        files, meta = m.build_proposal(self.repos.base, m.load_ledger(ref=self.repos.base),
                                       self.repos.baseline, self.new_commits())
        path = m.PROPOSAL_DIR + '/' + meta['pid'] + '/patches/' + target + '.patch'
        content = files[path].encode()
        self.assertTrue(content.endswith(b' \n'))
        parsed = subprocess.check_output(['git', 'apply', '--numstat', '-'], input=content)
        self.assertIn(b'pstack/skills/one/SKILL.md', parsed)
        expected = subprocess.check_output(['git', '-c', 'color.ui=false', '-c', 'log.showSignature=false',
            'show', '--format=fuller', '--date=iso-strict', '--no-ext-diff', '--no-textconv', '--no-renames',
            '--diff-algorithm=myers', '--unified=3', '--src-prefix=a/', '--dst-prefix=b/',
            '--first-parent', '-m', target, '--', m.PSTACK])
        self.assertEqual(content, expected)

    def test_caller_worktree_and_index_are_preserved(self):
        (self.repos.fork / 'README.md').write_text('dirty edit\n')
        (self.repos.fork / 'staged.txt').write_text('staged\n')
        self.git('add', 'staged.txt')
        (self.repos.fork / 'untracked.txt').write_text('untracked\n')
        before = (self.git('status', '--porcelain'), self.git('rev-parse', 'HEAD'),
                  self.git('ls-files', '-s'), self.git('count-objects', '-v'))
        ledger = m.load_ledger(ref=self.repos.base)
        files, meta = m.build_proposal(self.repos.base, ledger, self.repos.baseline, self.new_commits())
        with m.temporary_proposal_commit(self.repos.base, files, meta):
            pass
        after = (self.git('status', '--porcelain'), self.git('rev-parse', 'HEAD'),
                 self.git('ls-files', '-s'), self.git('count-objects', '-v'))
        self.assertEqual(before, after)

    def test_temporary_git_storage_is_removed_on_construction_and_caller_failure(self):
        files, meta = m.build_proposal(self.repos.base, m.load_ledger(ref=self.repos.base),
                                       self.repos.baseline, self.new_commits())
        with self.assertRaisesRegex(RuntimeError, 'caller failure'):
            with m.temporary_proposal_commit(self.repos.base, files, meta) as (_, env):
                storage = Path(env['GIT_OBJECT_DIRECTORY']).parent
                self.assertTrue(storage.exists())
                raise RuntimeError('caller failure')
        self.assertFalse(storage.exists())
        real_git = m.git
        paths = []
        def fail_read_tree(*args, **kwargs):
            if args[0] == 'read-tree':
                paths.append(Path(kwargs['env']['GIT_OBJECT_DIRECTORY']).parent)
                raise RuntimeError('construction failure')
            return real_git(*args, **kwargs)
        with patch.object(m, 'git', side_effect=fail_read_tree), self.assertRaisesRegex(RuntimeError, 'construction failure'):
            with m.temporary_proposal_commit(self.repos.base, files, meta):
                self.fail('construction should fail')
        self.assertTrue(paths)
        self.assertFalse(paths[0].exists())

    def test_drift_on_proposal_branch_is_refused(self):
        target = self.repos.c2
        branch = m.branch_name(target, self.repos.base)
        self.git('checkout', '--detach', self.repos.base)
        (self.repos.fork / 'human.txt').write_text('human work\n')
        self.git('add', 'human.txt')
        self.git('commit', '-m', 'human edit on proposal branch')
        human = self.git('rev-parse', 'HEAD')
        self.git('push', 'origin', 'HEAD:refs/heads/' + branch)
        self.git('checkout', 'main')
        with patch.object(m, 'api', side_effect=self.fake.api):
            result = m.catalogue_cursor_changes()
        self.assertEqual(result['status'], 'refused')
        self.assertEqual(result['remote'], human)
        self.assertEqual(self.git('ls-remote', 'origin', 'refs/heads/' + branch).split()[0], human)
        self.assertEqual(self.fake.pulls, [])

    def test_missing_commit_coverage_is_flagged(self):
        ledger = {'schema': 1, 'reviewed_through': self.repos.c2,
                  'entries': [{'commit': self.repos.c1, 'status': 'pending', 'subject': 's', 'date': '2020-01-01'}]}
        errors = m.coverage_errors(ledger, self.repos.baseline)
        self.assertTrue(any(self.repos.c2[:12] in e for e in errors))
        ledger['entries'].append({'commit': self.repos.c2, 'status': 'pending'})
        self.assertEqual(m.coverage_errors(ledger, self.repos.baseline), [])
        ledger['entries'].append({'commit': self.repos.tip, 'status': 'pending'})
        self.assertTrue(any('outside' in e for e in m.coverage_errors(ledger, self.repos.baseline)))

    def test_release_baseline_keeps_final_history_but_cannot_cross_pending(self):
        ledger = {'schema': 1, 'reviewed_through': self.repos.c2, 'entries': [
            {'commit': self.repos.c1, 'status': 'pending'},
            {'commit': self.repos.c2, 'status': 'pending'}]}
        self.assertTrue(any('pending' in e for e in m.coverage_errors(ledger, self.repos.c1)))
        ledger['entries'][0].update(status='adapted', reason='preserve provider routes', evidence='PR #9')
        self.assertEqual(m.coverage_errors(ledger, self.repos.c1), [])
        self.assertTrue(m.coverage_errors(ledger, self.repos.tip))

    def test_superseded_proposal_preserves_human_commit_or_description(self):
        old = self.candidate()['pr']
        saved_head, saved_body = old['head']['sha'], old['body']
        old['head']['sha'] = 'f' * 40
        with patch.object(m, 'api', side_effect=self.fake.api):
            self.assertEqual(m.cleanup_superseded(99)['kept'], [old['number']])
            self.assertEqual(old['state'], 'open')
            old['head']['sha'] = saved_head
            old['body'] += '\nHuman review note'
            self.assertEqual(m.cleanup_superseded(99)['kept'], [old['number']])
            self.assertEqual(old['state'], 'open')
            old['body'] = saved_body
            self.assertEqual(m.cleanup_superseded(99)['closed'], [old['number']])
            self.assertEqual(old['state'], 'closed')

    def test_optional_eric_comparison_failure_does_not_block_cursor_alerts(self):
        with patch.object(m, 'git', side_effect=subprocess.CalledProcessError(1, 'git')):
            self.assertEqual(m.collect_alerts({'outstanding': []}, True), [])

    def test_pending_stays_visible_and_catalogued_tip_needs_no_proposal(self):
        ledger = {'schema': 1, 'reviewed_through': self.repos.c2, 'entries': [
            {'commit': self.repos.c1, 'status': 'pending', 'subject': 'one', 'date': '2020-01-01'},
            {'commit': self.repos.c2, 'status': 'pending', 'subject': 'two', 'date': '2020-01-01'}]}
        self.git('checkout', '-b', 'ledger-update')
        (self.repos.fork / m.LEDGER_PATH).write_text(m.dump_ledger(ledger))
        self.git('commit', '-am', 'catalogue')
        self.git('checkout', 'main')
        self.git('merge', '--ff-only', 'ledger-update')
        self.git('push', 'origin', 'main')
        outstanding = m.outstanding_commits(ledger, [])
        self.assertEqual([i['sha'] for i in outstanding], [self.repos.c1, self.repos.c2])
        with patch.object(m, 'api', side_effect=self.fake.api), patch.object(m, 'run') as dispatch:
            result = m.catalogue_cursor_changes()
        self.assertEqual(result['status'], 'current')
        self.assertEqual(self.fake.pulls, [])
        dispatch.assert_not_called()

    def test_repeated_proposal_is_a_no_op(self):
        with patch.object(m, 'api', side_effect=self.fake.api), patch.object(m, 'run') as dispatch:
            first = m.catalogue_cursor_changes()
            self.assertEqual(first['status'], 'proposed')
            self.assertTrue(first['dispatched'])
            calls = len(self.fake.calls)
            second = m.catalogue_cursor_changes()
        self.assertEqual(second['status'], 'proposed')
        self.assertFalse(second['dispatched'])
        self.assertEqual(len(self.fake.pulls), 1)
        self.assertTrue(all(method == 'GET' for method, _ in self.fake.calls[calls:]))
        self.assertEqual(dispatch.call_count, 1)
        contexts = [s['context'] for s in self.fake.statuses[first['commit']]]
        self.assertEqual(contexts, [m.STATUS_CANDIDATE, m.STATUS_DISPATCH])

    def test_failed_dispatch_is_retried(self):
        with patch.object(m, 'api', side_effect=self.fake.api), \
                patch.object(m, 'run', side_effect=subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(subprocess.CalledProcessError):
                m.catalogue_cursor_changes()
        commit = self.git('ls-remote', 'origin', 'refs/heads/' + m.branch_name(self.repos.c2, self.repos.base)).split()[0]
        contexts = [s['context'] for s in self.fake.statuses[commit]]
        self.assertEqual(contexts, [m.STATUS_CANDIDATE])
        with patch.object(m, 'api', side_effect=self.fake.api), patch.object(m, 'run') as dispatch:
            result = m.catalogue_cursor_changes()
        self.assertEqual(result['status'], 'proposed')
        self.assertTrue(result['dispatched'])
        dispatch.assert_called_once()
        self.assertEqual(len(self.fake.pulls), 1)
        contexts = [s['context'] for s in self.fake.statuses[commit]]
        self.assertEqual(contexts.count(m.STATUS_DISPATCH), 1)
        self.assertEqual(contexts[-1], m.STATUS_DISPATCH)

    def test_closed_unmerged_proposal_is_surfaced_not_duplicated(self):
        branch = m.branch_name(self.repos.c2, self.repos.base)
        self.fake.pulls.append({'number': 7, 'state': 'closed', 'merged_at': None, 'body': m.PR_MARKER + ' {} -->',
                                'head': {'ref': branch, 'sha': '0' * 40, 'repo': {'full_name': FORK}},
                                'base': {'ref': 'main', 'sha': self.repos.base},
                                'html_url': 'https://example.invalid/pull/7'})
        pushed = []
        real_git = m.git
        def spy(*args, **kwargs):
            if args and args[0] == 'push':
                pushed.append(args)
            return real_git(*args, **kwargs)
        with patch.object(m, 'api', side_effect=self.fake.api), \
                patch.object(m, 'git', side_effect=spy), patch.object(m, 'run') as dispatch:
            result = m.catalogue_cursor_changes()
        self.assertEqual(result['status'], 'closed')
        self.assertEqual(result['pr']['number'], 7)
        self.assertEqual(pushed, [])
        self.assertEqual(len(self.fake.pulls), 1)
        dispatch.assert_not_called()

    def test_candidate_rejects_advanced_checkout_even_if_api_base_is_stale(self):
        result = self.candidate()
        (self.repos.fork / 'README.md').write_text('main advanced after dispatch\n')
        self.git('commit', '-am', 'Advance trusted main checkout')
        with patch.object(m, 'api', side_effect=self.fake.api), \
                patch.object(m, 'CURSOR_URL', str(self.repos.cursor)):
            with self.assertRaisesRegex(m.CheckFailed, 'trusted checkout'):
                m.check_candidate(result['pr']['number'], result['commit'], self.repos.base, self.repos.c2)

    def test_check_candidate_accepts_canonical_proposal(self):
        with patch.object(m, 'api', side_effect=self.fake.api), patch.object(m, 'run'), \
                patch.object(m, 'CURSOR_URL', str(self.repos.cursor)):
            result = m.catalogue_cursor_changes()
            m.check_candidate(result['pr']['number'], result['commit'], self.repos.base, self.repos.c2)

    def candidate(self):
        with patch.object(m, 'api', side_effect=self.fake.api), patch.object(m, 'run'):
            return m.catalogue_cursor_changes()

    def test_check_candidate_rejects_stale_or_foreign_identity(self):
        with patch.object(m, 'CURSOR_URL', str(self.repos.cursor)):
            result = self.candidate()
            pr = self.fake.find(result['pr']['number'])
            good = (pr['number'], result['commit'], self.repos.base, self.repos.c2)
            for mutate in (
                    lambda: pr['head'].update(sha='0' * 40),
                    lambda: pr['base'].update(sha='0' * 40),
                    lambda: pr['head']['repo'].update(full_name='other/repo'),
                    lambda: pr.update(state='closed'),
                    lambda: pr['head'].update(ref='automation/other')):
                saved = json.loads(json.dumps(pr))
                mutate()
                with patch.object(m, 'api', side_effect=self.fake.api):
                    with self.assertRaises(m.CheckFailed):
                        m.check_candidate(*good)
                pr.clear()
                pr.update(saved)
            with patch.object(m, 'api', side_effect=self.fake.api):
                with self.assertRaises(m.CheckFailed):
                    m.check_candidate(pr['number'], '0' * 40, self.repos.base, self.repos.c2)

    def test_check_ledger_validates_structure_and_coverage(self):
        m.check_ledger(m.LEDGER_PATH)
        bad = Path(self.tmp) / 'bad-ledger.json'
        bad.write_text(json.dumps({'schema': 1, 'reviewed_through': 'oops', 'entries': []}))
        with self.assertRaises(m.CheckFailed):
            m.check_ledger(str(bad))
        missing = Path(self.tmp) / 'missing-ledger.json'
        missing.write_text(json.dumps({'schema': 1, 'reviewed_through': self.repos.c2, 'entries': []}))
        with self.assertRaises(m.CheckFailed):
            m.check_ledger(str(missing))

    def test_preview_is_read_only_and_uses_last_pstack_commit(self):
        with patch.object(m, 'api', side_effect=AssertionError('preview must not call the API')):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                m.preview(None, self.repos.tip)
            text = out.getvalue()
        self.assertIn(self.repos.c2[:12], text)
        self.assertIn('cursor-%s-%s' % (self.repos.c2[:12], self.repos.base[:12]), text)
        self.assertIn('pending', text)


if __name__ == '__main__':
    unittest.main()
