#!/usr/bin/env python3
"""Maintain this fork's upstream mirror and an idempotent maintenance report."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import subprocess

FORK = "arjitj2/open-pstack"
UPSTREAM = "ericlitman/open-pstack"
CURSOR = "cursor/plugins"
START = "<!-- fork-maintenance:start -->"
END = "<!-- fork-maintenance:end -->"
PR_MARKER = "<!-- fork-maintenance:sync -->"


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


def git(*args):
    return run("git", *args)


def fetch():
    git("fetch", "--no-tags", f"https://github.com/{UPSTREAM}.git", "main:refs/remotes/maintenance/upstream")
    git("fetch", "--no-tags", f"https://github.com/{CURSOR}.git", "main:refs/remotes/maintenance/cursor")


def sync():
    target = git("rev-parse", "refs/remotes/maintenance/upstream")
    # A normal push rejects divergence, including an upstream history rewrite.
    git("push", "origin", f"{target}:refs/heads/upstream-main")
    base = api(f"repos/{FORK}/branches/main")["commit"]["sha"]
    git("fetch", "origin", "main")
    if subprocess.run(["git", "merge-base", "--is-ancestor", target, base]).returncode == 0:
        return
    prs = api(f"repos/{FORK}/pulls?state=open&base=main&head=arjitj2:upstream-main&per_page=100", paginate=True)
    if len(prs) > 1:
        raise RuntimeError("Multiple mirror PRs exist; resolve them before retrying.")
    pr = prs[0] if prs else None
    if pr and PR_MARKER not in (pr.get("body") or ""):
        raise RuntimeError("Existing mirror PR is not automation-owned; refusing to edit it.")
    body = (f"{PR_MARKER}\nBring open-pstack changes through `{target}` into the maintained fork. "
            "The mirror preserves upstream history; merge only after reviewing custom-provider compatibility.\n\n"
            "Validation:\n- [ ] Candidate CI passes.\n- [ ] Relevant installed Claude Code and Codex behavior passes on this exact candidate.\n\n"
            "This PR is ready for review, but does not authorize automatic merging or installation.\n")
    marker = f"<!-- candidate-dispatched:{target}:{base} -->"
    if pr and marker in (pr.get("body") or ""):
        return
    if pr is None:
        try:
            pr = api(f"repos/{FORK}/pulls", "POST", {"title": "Sync open-pstack upstream", "head": "upstream-main", "base": "main", "body": body, "draft": False})
        except subprocess.CalledProcessError as exc:
            raise RuntimeError("Could not create sync PR. Enable 'Allow GitHub Actions to create and approve pull requests' in repository Actions settings, then rerun.") from exc
    api(f"repos/{FORK}/statuses/{target}", "POST", {"state": "pending", "context": "Upstream sync candidate", "description": f"Awaiting candidate tests against main {base[:12]}"})
    run("gh", "workflow", "run", "sync-candidate.yml", "--repo", FORK, "--ref", "main", "-f", f"pr={pr['number']}", "-f", f"head={target}", "-f", f"base={base}")
    # Record dispatch only after success, so a failed dispatch is retried next run.
    api(f"repos/{FORK}/pulls/{pr['number']}", "PATCH", {"body": body + "\n" + marker})


def changed_paths(sha, *paths):
    # Explicit first-parent diff includes changes introduced by merge commits.
    return git("show", "--format=", "--name-only", "--first-parent", "-m", sha, "--", *paths).splitlines()


def maintainer_activity(number):
    entries = []
    for endpoint in (f"issues/{number}/comments", f"pulls/{number}/reviews"):
        entries.extend(api(f"repos/{UPSTREAM}/{endpoint}?per_page=100", paginate=True))
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
    return f"Latest apparently non-generated maintainer activity: [{login}, {timestamp[:10]}]({url})."


def substantive(paths):
    """Only explicitly known prose/metadata locations are non-substantive."""
    return any(not (p in {"pstack/README.md", "pstack/CHANGELOG.md", "pstack/LICENSE", "pstack/LICENSE.md"}
                   or p.startswith("pstack/docs/")) for p in paths)


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


def health(weekly=False):
    upstream = "refs/remotes/maintenance/upstream"
    cursor = "refs/remotes/maintenance/cursor"
    document = git("show", f"{upstream}:UPSTREAM.md")
    match = re.search(r"^\| Commit \| `([0-9a-f]{40})` \|$", document, re.M)
    if not match:
        raise RuntimeError("Upstream's recorded Cursor sync point could not be read.")
    baseline = match.group(1)
    git("merge-base", "--is-ancestor", baseline, cursor)
    now = datetime.now(timezone.utc)
    commits = []
    alerts = []
    for line in git("log", "--first-parent", "--reverse", "--format=%H%x09%cI%x09%s", f"{baseline}..{cursor}", "--", "pstack/").splitlines():
        sha, timestamp, subject = line.split("\t", 2)
        paths = changed_paths(sha, "pstack/")
        important = substantive(paths)
        age = max(0, (now - datetime.fromisoformat(timestamp)).days)
        commits.append((sha, timestamp[:10], subject, important, age))
        if important and age >= 7:
            threshold = 21 if age >= 21 else 7
            alerts.append((f"lag:{sha}:{threshold}", f"Cursor change [{sha[:8]}](https://github.com/{CURSOR}/commit/{sha}) has waited at least {threshold} days: {subject}."))
    # Relevant-fix alerts concern new open-pstack fixes in the fork's actual changed areas.
    base = git("merge-base", "HEAD", upstream)
    custom = set(git("diff", "--name-only", base, "HEAD", "--", "plugins/pstack/").splitlines())
    for line in git("log", "--first-parent", "--format=%H%x09%s", f"HEAD..{upstream}", "--", "plugins/pstack/").splitlines():
        sha, subject = line.split("\t", 1)
        paths = set(changed_paths(sha))
        if paths & custom and re.search(r"\b(fix|fixes|fixed|bug|regression|security)\b", subject, re.I):
            alerts.append((f"fix:{sha}", f"Likely relevant upstream fix [{sha[:8]}](https://github.com/{UPSTREAM}/commit/{sha}): {subject}. Title/path heuristic only; review applicability."))
    issue = api(f"repos/{FORK}/issues/1")
    body = issue.get("body") or ""
    state = read_state(body)
    notified = set(state.get("notified", []))
    fresh = [(key, text) for key, text in alerts if event_id(key) not in notified]
    if fresh:
        # Mark each notification in its comment, allowing retry recovery after a partial run.
        comments = api(f"repos/{FORK}/issues/1/comments?per_page=100", paginate=True)
        existing = "\n".join(c.get("body") or "" for c in comments)
        for key, text in fresh:
            marker = f"<!-- maintenance-alert:{event_id(key)} -->"
            if marker not in existing:
                api(f"repos/{FORK}/issues/1/comments", "POST", {"body": f"@arjitj2 {text}\n\n{marker}"})
            notified.add(event_id(key))
    state["notified"] = sorted(notified)
    old = re.search(re.escape(START) + r"\n(.*?)\n<!-- fork-maintenance-state:", body, re.S)
    report = old.group(1) if old else "Maintenance monitoring is active. The next weekly run will publish the full report."
    if weekly:
        rows = ["### Upstream maintenance", f"Open-pstack tracks Cursor commit [`{baseline[:12]}`](https://github.com/{CURSOR}/commit/{baseline}).", "", f"Outstanding pstack commits: {len(commits)}. Skill instructions count as behavior; classifications are conservative."]
        ages = [age for _, _, _, important, age in commits if important]
        oldest = max(ages, default=0)
        severity = "reassess upstream" if oldest >= 21 else "attention" if oldest >= 7 else "within threshold"
        rows.append(f"Oldest substantive lag: {oldest} days ({severity})." if ages else "No outstanding substantive lag.")
        for sha, date, subject, important, age in commits:
            rows.append(f"- [{sha[:8]}](https://github.com/{CURSOR}/commit/{sha}) ({date}; {age} days; {'substantive' if important else 'prose only'}): {subject}")
        rows += ["", "### Our upstream contributions"]
        for number in (70, 73, 74):
            pr = api(f"repos/{UPSTREAM}/pulls/{number}")
            status = "merged" if pr.get("merged_at") else pr["state"]
            rows.append(f"- [#{number}]({pr['html_url']}): {status} — {pr['title']}. {maintainer_activity(number)}")
        rows += ["", "Seven days of substantive lag merits attention; 21 days merits reassessing the upstream arrangement. Inactivity without new Cursor changes is not a warning. Automated review activity is not evidence of a maintainer response."]
        report = "\n".join(rows)
    updated = managed_body(body, report, state)
    if updated != body:
        api(f"repos/{FORK}/issues/1", "PATCH", {"body": updated})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["daily", "weekly"])
    args = parser.parse_args()
    if os.environ.get("GITHUB_REPOSITORY") != FORK:
        raise RuntimeError(f"This automation only runs in {FORK}.")
    fetch()
    if args.mode == "daily":
        sync()
    health(weekly=args.mode == "weekly")


if __name__ == "__main__":
    main()
