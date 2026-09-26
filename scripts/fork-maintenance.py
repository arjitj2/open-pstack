#!/usr/bin/env python3
"""Maintain this fork's Cursor pstack review ledger and metadata-only proposals.

`maintenance/upstream-ledger.json` on `main` records every first-parent Cursor
`pstack/` commit after the incorporated baseline (the `Commit` row of
`UPSTREAM.md`) as `pending`, `adopted`, `adapted`, or `excluded`. The daily run
catalogues new source commits through one immutable metadata-only proposal PR
per (target, base, ledger blob) tuple; it never imports upstream content,
force-pushes, or edits human work. `ericlitman/open-pstack` is an optional
advisory source only; its failure never blocks Cursor proposals.
"""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

FORK = "arjitj2/open-pstack"
OWNER = FORK.split("/")[0]
UPSTREAM = "ericlitman/open-pstack"
CURSOR = "cursor/plugins"
CURSOR_URL = "https://github.com/" + CURSOR + ".git"
ERIC_URL = "https://github.com/" + UPSTREAM + ".git"
CURSOR_REF = "refs/remotes/maintenance/cursor"
ERIC_REF = "refs/remotes/maintenance/eric"
PSTACK = "pstack/"
LEDGER_PATH = "maintenance/upstream-ledger.json"
BRANCH_PREFIX = "automation/"
START = "<!-- fork-maintenance:start -->"
END = "<!-- fork-maintenance:end -->"
PR_MARKER = "<!-- fork-maintenance:proposal"
STATUS_CANDIDATE = "cursor-catalog/candidate"
STATUS_DISPATCH = "cursor-catalog/dispatch"
BOT_NAME = "open-pstack maintenance"
BOT_EMAIL = "open-pstack-maintenance@users.noreply.github.com"
SHA_RE = re.compile(r"[0-9a-f]{40}")
STATUSES = {"pending", "adopted", "adapted", "excluded"}
FINAL_STATUSES = {"adopted", "adapted", "excluded"}
DEFAULT_REPORT = "Maintenance monitoring is active. The next weekly run will publish the full report."
MAX_PROPOSAL_BODY = 60_000
PROPOSAL_BODY_OVERHEAD = 1024


class CheckFailed(Exception):
    def __init__(self, problems):
        super().__init__("; ".join(problems))
        self.problems = problems


def run(*args):
    return subprocess.check_output(args, text=True).strip()


def api(path, method="GET", payload=None, paginate=False):
    args = ["gh", "api", path, "--method", method]
    if paginate:
        args += ["--paginate", "--slurp"]
    if payload is not None:
        args += ["--input", "-"]
    result = subprocess.check_output(args, input=json.dumps(payload) if payload is not None else None, text=True)
    value = json.loads(result) if result.strip() else None
    return [item for page in value for item in page] if paginate else value


def git(*args, env=None, stdin=None, raw=False):
    full = dict(os.environ)
    if env:
        full.update(env)
    output = subprocess.check_output(["git", *args], input=stdin.encode() if stdin is not None else None, env=full).decode()
    return output if raw else output.strip()


def git_ok(*args):
    return subprocess.run(["git", *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


def sha40(value):
    return isinstance(value, str) and bool(SHA_RE.fullmatch(value))


def fetch_cursor_and_eric_advisory():
    git("fetch", "--no-tags", CURSOR_URL, "main:" + CURSOR_REF)
    try:
        git("fetch", "--no-tags", ERIC_URL, "main:" + ERIC_REF)
        return True
    except subprocess.CalledProcessError:
        print("warning: optional advisory fetch of " + UPSTREAM + " failed; continuing", file=sys.stderr)
        return False


def read_baseline(ref):
    document = git("show", ref + ":UPSTREAM.md")
    match = re.search(r"^\| Commit \| `([0-9a-f]{40})` \|$", document, re.M)
    if not match:
        raise RuntimeError("The Cursor sync commit could not be read from " + ref + ":UPSTREAM.md.")
    return match.group(1)


def load_ledger(ref=None, path=None):
    text = git("show", ref + ":" + LEDGER_PATH) if ref else Path(path or LEDGER_PATH).read_text()
    return json.loads(text)


def dump_ledger(ledger):
    return json.dumps(ledger, indent=2, sort_keys=True) + "\n"


def ledger_structure_errors(ledger):
    if not isinstance(ledger, dict):
        return ["ledger root is not an object"]
    errors = []
    if ledger.get("schema") != 1:
        errors.append("ledger schema must be 1")
    if not sha40(ledger.get("reviewed_through")):
        errors.append("reviewed_through must be a full commit SHA")
    entries = ledger.get("entries")
    if not isinstance(entries, list):
        return errors + ["entries must be a list"]
    seen = set()
    for i, entry in enumerate(entries):
        where = "entries[%d]" % i
        if not isinstance(entry, dict):
            errors.append(where + " is not an object")
            continue
        commit = entry.get("commit")
        if not sha40(commit):
            errors.append(where + ".commit must be a full commit SHA")
        elif commit in seen:
            errors.append(where + " duplicates commit " + commit[:12])
        else:
            seen.add(commit)
        status = entry.get("status")
        if not isinstance(status, str) or status not in STATUSES:
            errors.append(where + ".status must be one of " + "/".join(sorted(STATUSES)))
        elif status in FINAL_STATUSES:
            if any(not isinstance(entry.get(key), str) or not entry[key].strip()
                   for key in ("reason", "evidence")):
                errors.append(where + " is " + status + " but lacks reason/evidence")
        elif entry.get("reason") or entry.get("evidence"):
            errors.append(where + " is pending but carries decision fields")
    return errors


def log_pstack(start, end):
    out = git("log", "--first-parent", "--reverse", "--format=%H%x09%cI%x09%s", start + ".." + end, "--", PSTACK)
    commits = []
    for line in out.splitlines():
        sha, timestamp, subject = line.split("\t", 2)
        commits.append({"sha": sha, "timestamp": timestamp, "date": timestamp[:10], "subject": subject})
    return commits


def coverage_errors(ledger, baseline):
    reviewed = ledger["reviewed_through"]
    if not (git_ok("cat-file", "-e", baseline) and git_ok("cat-file", "-e", reviewed)):
        return ["source objects needed to validate ledger coverage are missing"]
    if not git_ok("merge-base", "--is-ancestor", baseline, reviewed):
        return ["incorporated baseline is not an ancestor of reviewed_through"]
    expected = {c["sha"] for c in log_pstack(baseline, reviewed)}
    historical = set(git("log", "--first-parent", "--format=%H", baseline, "--", PSTACK).splitlines())
    errors = []
    have = {e["commit"] for e in ledger["entries"] if sha40(e.get("commit"))}
    for sha in sorted(expected - have):
        errors.append("no ledger entry for catalogued commit " + sha[:12])
    for entry in ledger["entries"]:
        commit = entry.get("commit")
        if not sha40(commit):
            continue
        if not git_ok("cat-file", "-e", commit):
            errors.append("entry commit " + commit[:12] + " is not a known object")
        elif commit in historical:
            if entry["status"] == "pending":
                errors.append("incorporated baseline crosses pending entry " + commit[:12])
        elif commit not in expected:
            errors.append("entry " + commit[:12] + " is outside (baseline..reviewed_through] or did not touch " + PSTACK)
    return errors


def changed_paths(sha, *paths):
    # Explicit first-parent diff includes changes introduced by merge commits.
    return git("show", "--format=", "--name-only", "--first-parent", "-m", sha, "--", *paths).splitlines()


def substantive(paths):
    """Only explicitly known prose/metadata locations are non-substantive."""
    return any(not (p in {"pstack/README.md", "pstack/CHANGELOG.md", "pstack/LICENSE", "pstack/LICENSE.md"}
                   or p.startswith("pstack/docs/")) for p in paths)


def proposal_id(target, base):
    return "cursor-%s-%s" % (target[:12], base[:12])


def branch_name(target, base):
    return BRANCH_PREFIX + proposal_id(target, base)


def build_proposal(base, ledger, baseline, new):
    target = new[-1]["sha"]
    pid = proposal_id(target, base)
    entries = [dict(e) for e in ledger.get("entries", [])]
    have = {e["commit"] for e in entries}
    for commit in new:
        if commit["sha"] in have:
            continue
        entries.append({"commit": commit["sha"], "status": "pending",
                        "subject": commit["subject"], "date": commit["date"]})
    ledger_after = dict(ledger)
    ledger_after["reviewed_through"] = target
    ledger_after["entries"] = entries
    meta = {
        "pid": pid,
        "base": base,
        "target": target,
        "baseline": baseline,
        "reviewed_before": ledger["reviewed_through"],
        "new": new,
        "pending": [e for e in entries if e["status"] == "pending"],
    }
    return {LEDGER_PATH: dump_ledger(ledger_after)}, meta


def inert_subject(subject):
    subject = str(subject).replace("\n", " ").replace("\r", " ")
    runs = re.findall(r"`+", subject)
    fence = "`" * (max((len(run) for run in runs), default=0) + 1)
    return fence + " " + subject + " " + fence


def proposal_body(meta, head):
    prefix = "\n".join([
        "# Cursor pstack catalog proposal",
        "",
        "Metadata-only automation proposal `" + meta["pid"] + "`. Merging records new Cursor `pstack/`",
        "commits as pending in the maintenance ledger; it does not adopt upstream behavior or change `plugins/`.",
        "",
        "- Source: `" + CURSOR + "` `" + PSTACK + "` through [`" + meta["target"][:12] + "`](https://github.com/" + CURSOR + "/commit/" + meta["target"] + ")",
        "- Incorporated baseline: `" + meta["baseline"] + "`",
        "- Compare: https://github.com/" + CURSOR + "/compare/" + meta["reviewed_before"] + "..." + meta["target"],
        "- Rebuild: `python3 scripts/fork-maintenance.py preview --base " + meta["base"] + " --target " + meta["target"] + "`",
        "- Base: `main` at `" + meta["base"] + "`",
        "- Head: `" + head + "`",
        "- New pending commits: " + str(len(meta["new"])),
        "- Outstanding pending decisions after merge: " + str(len(meta["pending"])),
        "",
        "This body is automation-owned and written once; human edits are preserved.",
        "Dispatch and validation state are reported as commit statuses on the head commit, never by",
        "rewriting this body. A closed unmerged proposal is surfaced, not silently duplicated.",
        "",
        "## New commits",
        "",
    ]) + "\n"
    def commit_line(commit):
        sha = commit.get("sha", commit.get("commit"))
        return "- [`" + sha[:12] + "`](https://github.com/" + CURSOR + "/commit/" + sha + ") (" + commit.get("date", "") + "): " + inert_subject(commit.get("subject", "")) + "\n"
    suffix = "\n## Outstanding pending decisions\n\n"
    details = ""
    omitted = 0
    budget = MAX_PROPOSAL_BODY - len(prefix) - len(suffix) - PROPOSAL_BODY_OVERHEAD
    for commit in meta["new"]:
        line = commit_line(commit)
        if len(details) + len(line) <= budget:
            details += line
        else:
            omitted += 1
    pending = ""
    for entry in meta["pending"]:
        line = commit_line(entry)
        if len(details) + len(pending) + len(line) <= budget:
            pending += line
        else:
            omitted += 1
    if not pending:
        pending = "None listed.\n" if not meta["pending"] else "See the ledger for the full pending list.\n"
    if omitted:
        pending += "\n" + str(omitted) + " commit details omitted; see the pinned compare and rebuild command above.\n"
    content = prefix + (details or "See the pinned compare for the commit list.\n") + suffix + pending
    digest = hashlib.sha256(content.encode()).hexdigest()
    marker = PR_MARKER + " " + json.dumps(
        {"target": meta["target"], "base": meta["base"], "head": head, "body_sha256": digest}, sort_keys=True) + " -->"
    body = marker + "\n" + content
    if len(body) > MAX_PROPOSAL_BODY:
        raise CheckFailed(["proposal body exceeds character limit"])
    return body


def proposal_marker(body):
    match = re.search(r"<!-- fork-maintenance:proposal (\{.*?\}) -->", body or "")
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        return None


@contextmanager
def temporary_proposal_commit(base, files, meta):
    with tempfile.TemporaryDirectory(prefix="fork-maintenance-proposal-") as tmp:
        index = os.path.join(tmp, "index")
        objdir = os.path.join(tmp, "objects")
        os.mkdir(objdir)
        common = os.path.abspath(git("rev-parse", "--git-common-dir"))
        date = git("log", "-1", "--format=%cI", meta["target"])
        env = {"GIT_INDEX_FILE": index,
               "GIT_OBJECT_DIRECTORY": objdir,
               "GIT_ALTERNATE_OBJECT_DIRECTORIES": os.path.join(common, "objects"),
               "GIT_AUTHOR_NAME": BOT_NAME, "GIT_AUTHOR_EMAIL": BOT_EMAIL, "GIT_AUTHOR_DATE": date,
               "GIT_COMMITTER_NAME": BOT_NAME, "GIT_COMMITTER_EMAIL": BOT_EMAIL, "GIT_COMMITTER_DATE": date}
        count = len(meta["new"])
        message = ("Catalog Cursor pstack commits through " + meta["target"][:12] + "\n\n"
                   "Advances the maintenance ledger reviewed_through to " + meta["target"] + " and records\n"
                   + str(count) + " pending entr" + ("y" if count == 1 else "ies") + " for maintainer review. Metadata only.\n\n"
                   "Proposal-Id: " + meta["pid"] + "\n")
        git("read-tree", base, env=env)
        for path in sorted(files):
            blob = git("hash-object", "-w", "--stdin", env=env, stdin=files[path])
            git("update-index", "--add", "--cacheinfo", "100644," + blob + "," + path, env=env)
        tree = git("write-tree", env=env)
        yield git("commit-tree", tree, "-p", base, env=env, stdin=message), env


def remote_branch(name):
    out = git("ls-remote", "origin", "refs/heads/" + name)
    return out.split()[0] if out else ""


def dispatched(head):
    statuses = api("repos/" + FORK + "/commits/" + head + "/statuses?per_page=100", paginate=True)
    return any(s.get("context") == STATUS_DISPATCH and s.get("state") == "success" for s in statuses)


def ensure_dispatch(number, head, base, target):
    if dispatched(head):
        return False
    api("repos/" + FORK + "/statuses/" + head, "POST",
        {"state": "pending", "context": STATUS_CANDIDATE,
         "description": "Awaiting metadata-only candidate validation against main " + base[:12]})
    run("gh", "workflow", "run", "sync-candidate.yml", "--repo", FORK, "--ref", "main",
        "-f", "pr=" + str(number), "-f", "head=" + head, "-f", "base=" + base, "-f", "target=" + target)
    api("repos/" + FORK + "/statuses/" + head, "POST",
        {"state": "success", "context": STATUS_DISPATCH,
         "description": "Candidate validation dispatched from trusted main"})
    return True


def cleanup_superseded(current_number):
    closed, kept = [], []
    for pr in api("repos/" + FORK + "/pulls?state=open&per_page=100", paginate=True):
        if pr["number"] == current_number:
            continue
        body = pr.get("body") or ""
        meta = proposal_marker(body)
        if meta is None or not all(sha40(meta.get(k)) for k in ("target", "base", "head")):
            continue
        head = pr.get("head") or {}
        if ((head.get("repo") or {}).get("full_name") != FORK
                or head.get("ref") != branch_name(meta["target"], meta["base"])
                or head.get("sha") != meta["head"] or (pr.get("base") or {}).get("ref") != "main"):
            kept.append(pr["number"])
            continue
        content = body.split("\n", 1)[1] if "\n" in body else ""
        if hashlib.sha256(content.encode()).hexdigest() != meta.get("body_sha256"):
            kept.append(pr["number"])
            continue
        api("repos/" + FORK + "/issues/" + str(pr["number"]) + "/comments", "POST",
            {"body": "Superseded by #" + str(current_number) + "; closing this unedited automation proposal."})
        api("repos/" + FORK + "/pulls/" + str(pr["number"]), "PATCH", {"state": "closed"})
        closed.append(pr["number"])
    return {"closed": closed, "kept": kept}


def catalogue_cursor_changes():
    base = git("rev-parse", "HEAD")
    ledger = load_ledger(ref=base)
    baseline = read_baseline(base)
    problems = ledger_structure_errors(ledger)
    if not problems:
        problems = coverage_errors(ledger, baseline)
    if problems:
        raise CheckFailed(problems)
    reviewed = ledger["reviewed_through"]
    if not git_ok("merge-base", "--is-ancestor", reviewed, CURSOR_REF):
        raise RuntimeError("Ledger reviewed_through is not an ancestor of the fetched Cursor main.")
    new = log_pstack(reviewed, CURSOR_REF)
    result = {"base": base, "new": new, "status": "current"}
    if not new:
        print("Cursor pstack tip is already catalogued on main; no proposal needed.")
        return result
    target = new[-1]["sha"]
    branch = branch_name(target, base)
    result.update(target=target, branch=branch)
    prs = api("repos/" + FORK + "/pulls?state=all&head=" + OWNER + ":" + branch + "&base=main&per_page=100",
              paginate=True)
    open_prs = [p for p in prs if p.get("state") == "open"]
    closed_prs = [p for p in prs if p.get("state") != "open"]
    if closed_prs and not open_prs:
        result.update(status="closed", pr=closed_prs[0])
        print("Closed unmerged proposal #%s exists for %s; surfacing instead of duplicating."
              % (closed_prs[0]["number"], branch))
        return result
    files, meta = build_proposal(base, ledger, baseline, new)
    with temporary_proposal_commit(base, files, meta) as (commit, object_env):
        result["commit"] = commit
        remote = remote_branch(branch)
        if remote and remote != commit:
            result.update(status="refused", remote=remote, expected=commit)
            print("Refusing to update %s: remote head %s is not the deterministic proposal commit %s."
                  % (branch, remote[:12], commit[:12]))
            return result
        if not remote:
            git("push", "origin", commit + ":refs/heads/" + branch, env=object_env)
        if open_prs:
            pr = open_prs[0]
            if (pr.get("head") or {}).get("sha") != commit:
                result.update(status="refused", remote=remote, expected=commit)
                print("Refusing: proposal #%s head does not match the deterministic commit." % pr["number"])
                return result
        else:
            body = proposal_body(meta, commit)
            try:
                pr = api("repos/" + FORK + "/pulls", "POST",
                         {"title": "Catalog Cursor pstack through " + target[:12],
                          "head": branch, "base": "main", "body": body, "draft": False})
            except subprocess.CalledProcessError as exc:
                raise RuntimeError("Could not create the proposal PR. Enable 'Allow GitHub Actions to create "
                                   "and approve pull requests' in repository Actions settings, then rerun.") from exc
        result["pr"] = pr
        result["dispatched"] = ensure_dispatch(pr["number"], commit, base, target)
        result["superseded"] = cleanup_superseded(pr["number"])
        result["status"] = "proposed"
        print("Proposal #%s for %s (head %s)." % (pr["number"], branch, commit[:12]))
        return result


def outstanding_commits(ledger, new):
    items = []
    for entry in ledger["entries"]:
        if entry["status"] != "pending":
            continue
        items.append({"sha": entry["commit"], "subject": entry.get("subject", ""),
                      "timestamp": git("log", "-1", "--format=%cI", entry["commit"]),
                      "substantive": substantive(changed_paths(entry["commit"], PSTACK)),
                      "kind": "pending decision"})
    for commit in new:
        items.append({"sha": commit["sha"], "subject": commit["subject"], "timestamp": commit["timestamp"],
                      "substantive": substantive(changed_paths(commit["sha"], PSTACK)),
                      "kind": "awaiting cataloguing"})
    return items


def collect_alerts(result, eric_ok):
    alerts = []
    now = datetime.now(timezone.utc)
    for item in result.get("outstanding", []):
        if not item["substantive"]:
            continue
        age = max(0, (now - datetime.fromisoformat(item["timestamp"])).days)
        for threshold in (21, 7):
            if age >= threshold:
                alerts.append(("lag:%s:%d" % (item["sha"], threshold),
                               "Cursor change [%s](https://github.com/%s/commit/%s) has waited at least %d days: %s."
                               % (item["sha"][:8], CURSOR, item["sha"], threshold, item["subject"])))
                break
    if eric_ok:
        try:
            mbase = git("merge-base", "HEAD", ERIC_REF)
            custom = set(git("diff", "--name-only", mbase, "HEAD", "--", "plugins/pstack/").splitlines())
            for line in git("log", "--first-parent", "--format=%H%x09%s", "HEAD.." + ERIC_REF, "--", "plugins/pstack/").splitlines():
                sha, subject = line.split("\t", 1)
                paths = set(changed_paths(sha))
                if paths & custom and re.search(r"\b(fix|fixes|fixed|bug|regression|security)\b", subject, re.I):
                    alerts.append(("fix:" + sha,
                                   "Likely relevant upstream fix [%s](https://github.com/%s/commit/%s): %s. Title/path heuristic only; review applicability."
                                   % (sha[:8], UPSTREAM, sha, subject)))
        except subprocess.CalledProcessError:
            print("warning: Eric advisory history could not be compared; continuing", file=sys.stderr)
    if result.get("status") == "closed":
        pr = result["pr"]
        alerts.append(("closed-proposal:" + result["branch"],
                       "Closed unmerged proposal [#%s](%s) exists for `%s`. Review it before re-proposing; automation will not duplicate it."
                       % (pr["number"], pr.get("html_url", ""), result["branch"])))
    if result.get("status") == "refused":
        alerts.append(("drift:" + result["branch"] + ":" + result.get("remote", "")[:12],
                       "Proposal branch `%s` differs from the deterministic automation commit; preserving human work. Inspect manually."
                       % result["branch"]))
    return alerts


def event_id(value):
    return hashlib.sha256(value.encode()).hexdigest()[:24]


def read_state(body):
    match = re.search(r"<!-- fork-maintenance-state:(.*?) -->", body, re.S)
    return json.loads(match.group(1)) if match else {"notified": []}


def managed_body(body, report, state):
    section = START + "\n" + report + "\n<!-- fork-maintenance-state:" + json.dumps(state, sort_keys=True) + " -->\n" + END
    if START in body and END in body:
        return body[:body.index(START)] + section + body[body.index(END) + len(END):]
    return body.rstrip() + "\n\n" + section + "\n"


def current_report(body):
    old = re.search(re.escape(START) + r"\n(.*?)\n<!-- fork-maintenance-state:", body, re.S)
    return old.group(1) if old else DEFAULT_REPORT


def update_issue(alerts=(), report=None):
    issue = api("repos/" + FORK + "/issues/1")
    body = issue.get("body") or ""
    state = read_state(body)
    notified = set(state.get("notified", []))
    fresh = [(key, text) for key, text in alerts if event_id(key) not in notified]
    if fresh:
        comments = api("repos/" + FORK + "/issues/1/comments?per_page=100", paginate=True)
        existing = "\n".join(c.get("body") or "" for c in comments)
        for key, text in fresh:
            marker = "<!-- maintenance-alert:" + event_id(key) + " -->"
            if marker not in existing:
                api("repos/" + FORK + "/issues/1/comments", "POST", {"body": "@arjitj2 " + text + "\n\n" + marker})
            notified.add(event_id(key))
    state["notified"] = sorted(notified)
    updated = managed_body(body, report if report is not None else current_report(body), state)
    if updated != body:
        api("repos/" + FORK + "/issues/1", "PATCH", {"body": updated})


def maintainer_activity(number):
    entries = []
    for endpoint in ("issues/%d/comments" % number, "pulls/%d/reviews" % number):
        entries.extend(api("repos/" + UPSTREAM + "/" + endpoint + "?per_page=100", paginate=True))
    candidates = []
    for entry in entries:
        user = entry.get("user") or {}
        body = entry.get("body") or ""
        if user.get("type") == "Bot" or "[bot]" in user.get("login", ""):
            continue
        if entry.get("author_association") not in {"OWNER", "MEMBER", "COLLABORATOR"}:
            continue
        if re.search(r"gavel|greptile|open.?swe|generated (?:by|review)|automated review", body, re.I):
            continue
        timestamp = entry.get("submitted_at") or entry.get("created_at")
        if timestamp:
            candidates.append((timestamp, user.get("login", "maintainer"), entry.get("html_url", "")))
    if not candidates:
        return "No non-generated maintainer comment/review identified."
    timestamp, login, url = max(candidates)
    return "Latest apparently non-generated maintainer activity: [%s, %s](%s)." % (login, timestamp[:10], url)


def build_report(ledger, baseline, outstanding, new, eric_ok):
    now = datetime.now(timezone.utc)
    pending = len(outstanding) - len(new)
    rows = ["### Upstream maintenance",
            "Open-pstack incorporates Cursor [`%s`](https://github.com/%s/commit/%s) (the `Commit` row of UPSTREAM.md) and has catalogued review through `%s`."
            % (baseline[:12], CURSOR, baseline, ledger["reviewed_through"][:12]),
            "",
            "Pending review decisions: %d. Source commits awaiting cataloguing on main: %d. Skill instructions count as behavior; classifications are conservative."
            % (pending, len(new))]
    aged = []
    for item in outstanding:
        item = dict(item)
        item["age"] = max(0, (now - datetime.fromisoformat(item["timestamp"])).days)
        aged.append(item)
    substantive_ages = [i["age"] for i in aged if i["substantive"]]
    oldest = max(substantive_ages, default=0)
    severity = "overdue review" if oldest >= 21 else "attention" if oldest >= 7 else "within threshold"
    rows.append("Oldest substantive lag: %d days (%s)." % (oldest, severity) if substantive_ages
                else "No outstanding substantive lag.")
    for item in aged:
        kind = "substantive" if item["substantive"] else "prose only"
        rows.append("- [`%s`](https://github.com/%s/commit/%s) (%s; %d days; %s; %s): %s"
                    % (item["sha"][:8], CURSOR, item["sha"], item["timestamp"][:10], item["age"], kind, item["kind"], item["subject"]))
    rows += ["", "### Our upstream contributions (advisory)"]
    if eric_ok:
        try:
            for number in (70, 73, 74):
                pr = api("repos/" + UPSTREAM + "/pulls/" + str(number))
                status = "merged" if pr.get("merged_at") else pr["state"]
                rows.append("- [#%d](%s): %s — %s. %s" % (number, pr["html_url"], status, pr["title"], maintainer_activity(number)))
        except Exception as exc:
            rows.append("Eric advisory unavailable this run: %s" % exc)
    else:
        rows.append("Eric advisory fetch failed this run; contribution status not reported.")
    rows += ["", "Seven days of substantive lag merits attention; 21 days merits an overdue review. Inactivity without new Cursor changes is not a warning. Automated review activity is not evidence of a maintainer response."]
    return "\n".join(rows)


def daily():
    eric_ok = fetch_cursor_and_eric_advisory()
    result = catalogue_cursor_changes()
    result["outstanding"] = outstanding_commits(load_ledger(ref=result["base"]), result["new"])
    update_issue(collect_alerts(result, eric_ok))


def weekly():
    eric_ok = fetch_cursor_and_eric_advisory()
    base = git("rev-parse", "HEAD")
    ledger = load_ledger(ref=base)
    baseline = read_baseline(base)
    problems = ledger_structure_errors(ledger)
    if not problems:
        problems = coverage_errors(ledger, baseline)
    if problems:
        raise CheckFailed(problems)
    reviewed = ledger["reviewed_through"]
    if not git_ok("merge-base", "--is-ancestor", reviewed, CURSOR_REF):
        raise RuntimeError("Ledger reviewed_through is not an ancestor of the fetched Cursor main.")
    new = log_pstack(reviewed, CURSOR_REF)
    result = {"base": base, "new": new, "outstanding": outstanding_commits(ledger, new), "status": "current"}
    report = build_report(ledger, baseline, result["outstanding"], new, eric_ok)
    update_issue(collect_alerts(result, eric_ok), report)


def preview(base_arg=None, target_arg=None, out_dir=None):
    base = git("rev-parse", base_arg or "HEAD")
    ledger = load_ledger(ref=base)
    baseline = read_baseline(base)
    problems = ledger_structure_errors(ledger)
    if not problems:
        problems = coverage_errors(ledger, baseline)
    if problems:
        raise CheckFailed(problems)
    end = git("rev-parse", target_arg or CURSOR_REF)
    if not git_ok("merge-base", "--is-ancestor", ledger["reviewed_through"], end):
        raise RuntimeError("Ledger reviewed_through is not an ancestor of the target history.")
    new = log_pstack(ledger["reviewed_through"], end)
    if not new:
        print("No new Cursor pstack commits to catalogue.")
        return
    files, meta = build_proposal(base, ledger, baseline, new)
    with temporary_proposal_commit(base, files, meta) as (commit, _):
        pass
    if out_dir:
        root = Path(out_dir)
        for path, content in files.items():
            dest = root / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(content)
        print("Wrote proposed ledger to %s" % out_dir)
    print(proposal_body(meta, commit))
    print("commit: %s\nbranch: %s" % (commit, branch_name(meta["target"], meta["base"])))


def check_ledger(path):
    try:
        ledger = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CheckFailed(["cannot parse %s: %s" % (path, exc)])
    problems = ledger_structure_errors(ledger)
    coverage = "skipped (upstream objects not present)"
    if not problems:
        baseline = None
        try:
            baseline = read_baseline("HEAD")
        except Exception:
            pass
        if baseline and git_ok("cat-file", "-e", baseline) and git_ok("cat-file", "-e", ledger["reviewed_through"]):
            cov = coverage_errors(ledger, baseline)
            problems += cov
            coverage = "checked" if not cov else "failed"
    if problems:
        raise CheckFailed(problems)
    print("ledger ok: %d entries, coverage %s." % (len(ledger["entries"]), coverage))


def check_candidate(pr, head, base, target):
    problems = []
    if not re.fullmatch(r"[1-9][0-9]*", str(pr or "")):
        problems.append("pr must be a pull request number")
    for name, value in (("head", head), ("base", base), ("target", target)):
        if not sha40(value or ""):
            problems.append(name + " must be a full commit SHA")
    if problems:
        raise CheckFailed(problems)
    if git("rev-parse", "HEAD") != base:
        raise CheckFailed(["trusted checkout does not match the dispatched base"])
    branch = branch_name(target, base)
    git("fetch", "--no-tags", "origin", "refs/heads/" + branch)
    git("fetch", "--no-tags", CURSOR_URL, "main:" + CURSOR_REF)
    if target not in git("rev-list", "--first-parent", CURSOR_REF).splitlines():
        problems.append("target is not on Cursor main first-parent history")
    data = api("repos/" + FORK + "/pulls/" + str(pr))
    if data.get("state") != "open":
        problems.append("proposal #%s is %s, not open" % (pr, data.get("state")))
    head_repo = (data.get("head") or {}).get("repo") or {}
    if head_repo.get("full_name") != FORK:
        problems.append("proposal head is not in " + FORK)
    if (data.get("head") or {}).get("ref") != branch:
        problems.append("proposal head ref is not " + branch)
    if (data.get("head") or {}).get("sha") != head:
        problems.append("proposal head does not match the dispatched head")
    if (data.get("base") or {}).get("ref") != "main" or (data.get("base") or {}).get("sha") != base:
        problems.append("proposal base does not match the dispatched main commit")
    marker = proposal_marker(data.get("body") or "")
    if marker is None or any(marker.get(k) != v for k, v in (("head", head), ("base", base), ("target", target))):
        problems.append("proposal marker does not match dispatched base/head/target")
    try:
        parents = git("rev-list", "--parents", "-n", "1", head).split()
        if parents != [head, base]:
            problems.append("candidate commit's only parent must be the base")
    except subprocess.CalledProcessError:
        problems.append("candidate head object is not available")
        raise CheckFailed(problems)
    changed = git("diff", "--name-only", base, head).splitlines()
    if changed != [LEDGER_PATH]:
        problems.append("candidate must change exactly " + LEDGER_PATH + " (found: " + ", ".join(changed) + ")")
    try:
        if git("rev-parse", base + ":plugins/pstack") != git("rev-parse", head + ":plugins/pstack"):
            problems.append("candidate changes plugins/pstack")
    except subprocess.CalledProcessError:
        problems.append("could not compare plugins/pstack trees")
    try:
        problems += ["candidate ledger: " + e for e in ledger_structure_errors(load_ledger(ref=head))]
        ledger_before = load_ledger(ref=base)
        baseline = read_baseline(base)
        ledger_problems = ledger_structure_errors(ledger_before)
        if not ledger_problems:
            ledger_problems = coverage_errors(ledger_before, baseline)
        if ledger_problems:
            raise CheckFailed(ledger_problems)
        reviewed = ledger_before["reviewed_through"]
        if not git_ok("merge-base", "--is-ancestor", reviewed, target):
            problems.append("ledger reviewed_through is not an ancestor of target")
        else:
            new = log_pstack(reviewed, target)
            if not new or new[-1]["sha"] != target:
                problems.append("target is not the last first-parent pstack commit after reviewed_through")
            else:
                files, meta = build_proposal(base, ledger_before, baseline, new)
                with temporary_proposal_commit(base, files, meta) as (expected, _):
                    if expected != head:
                        problems.append("candidate is not the canonical deterministic proposal commit")
    except (KeyError, json.JSONDecodeError, subprocess.CalledProcessError) as exc:
        problems.append("could not rebuild the canonical proposal: %s" % exc)
    if problems:
        raise CheckFailed(problems)
    print("candidate ok: #%s is the canonical metadata-only proposal for %s." % (pr, branch))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["daily", "weekly", "preview", "check-ledger", "check-candidate"])
    parser.add_argument("--base", help="Base commit (preview, check-candidate)")
    parser.add_argument("--target", help="Cursor commit or ref (preview, check-candidate)")
    parser.add_argument("--head", help="Candidate head commit (check-candidate)")
    parser.add_argument("--pr", help="Candidate pull request number (check-candidate)")
    parser.add_argument("--file", help="Ledger path (check-ledger)")
    parser.add_argument("--out-dir", help="Write only the proposed ledger here (preview)")
    args = parser.parse_args()
    if args.mode in {"daily", "weekly"} and os.environ.get("GITHUB_REPOSITORY") != FORK:
        raise RuntimeError("This automation only runs in " + FORK + ".")
    try:
        if args.mode == "daily":
            daily()
        elif args.mode == "weekly":
            weekly()
        elif args.mode == "preview":
            preview(args.base, args.target, args.out_dir)
        elif args.mode == "check-ledger":
            check_ledger(args.file or LEDGER_PATH)
        elif args.mode == "check-candidate":
            if not (args.pr and args.head and args.base and args.target):
                raise CheckFailed(["check-candidate requires --pr, --head, --base, and --target"])
            check_candidate(args.pr, args.head, args.base, args.target)
    except CheckFailed as exc:
        for problem in exc.problems:
            print("check failed: " + problem, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
