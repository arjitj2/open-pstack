#!/usr/bin/env python3
"""Structural checks for repository documentation.

Each maintained fact has one owner (see AGENTS.md "Documentation ownership").
This script verifies the objective parts of that contract:

- the README provider table lists exactly the runner's PROVIDERS descriptor
  prefixes, and the parent line lists exactly the runner's PARENTS;
- relative Markdown links (and .md heading fragments, including same-page
  links and GitHub's duplicate-heading -1 suffix) resolve; and
- the approved public document inventory is respected; and
- the current CHANGELOG entry and pinned upstream README agree with the
  packaged version and Cursor baseline.

It is not a full Markdown parser. It supports the link forms used in this
repository (inline links, images, and single-line reference definitions).
Fenced code blocks, inline code, and scheme URLs (https:, mailto:) are skipped.
Outgoing links are scanned only in maintained docs; links into plugin docs
are still validated. File discovery uses
`git ls-files`, so untracked trees such as .worktrees/ are never scanned.
The checker reads plugins/ but never writes to it and makes no network calls.
"""
import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

RUNNER_TYPES = "plugins/pstack/skills/poteto-mode/scripts/runner/types.ts"
PLUGIN_MANIFEST = "plugins/pstack/.claude-plugin/plugin.json"
README = "README.md"
CHANGELOG = "CHANGELOG.md"
UPSTREAM = "UPSTREAM.md"
PROVIDER_SECTION = "Supported parent apps and worker providers"
APPROVED = {"README.md", "CHANGELOG.md", "CONTRIBUTING.md", "UPSTREAM.md",
            "NOTICE.md", "AGENTS.md", "LICENSE", "LICENSES/LICENSE-cursor-team-kit",
            "LICENSES/LICENSE-superpowers", "maintenance/upstream-ledger.json"}
CURSOR_BASELINE = re.compile(r"Cursor baseline: \[([0-9][^\]]*)\]\(https://github\.com/cursor/plugins/tree/([0-9a-f]{40})/pstack\)")
PINNED_README = re.compile(r"https://github\.com/cursor/plugins/blob/([0-9a-f]{40})/pstack/README\.md")


@dataclass(frozen=True)
class Problem:
    path: str
    line: int
    message: str

    def __str__(self):
        return "%s:%s: %s" % (self.path, self.line, self.message)


class DocsError(Exception):
    """A required source file could not be read or parsed."""


def _read(root, rel):
    try:
        return (root / rel).read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise DocsError("%s: cannot read file (%s)" % (rel, e))


def source_ids(root):
    text = _read(root, RUNNER_TYPES)
    ids = {}
    for name in ("PARENTS", "PROVIDERS"):
        match = re.search(r"export const %s = \[(.*?)\]" % name, text, re.S)
        if not match:
            raise DocsError("%s: `export const %s = [...]` not found or unreadable" % (RUNNER_TYPES, name))
        try:
            body = re.sub(r",\s*$", "", match.group(1))
            values = json.loads("[" + body + "]")
        except ValueError:
            raise DocsError("%s: %s must be a literal array of double-quoted ids" % (RUNNER_TYPES, name))
        if not values or not all(isinstance(v, str) and v for v in values):
            raise DocsError("%s: %s must declare nonempty string ids" % (RUNNER_TYPES, name))
        ids[name] = values
    return ids


def _section(lines, needle):
    start = None
    for i, line in enumerate(lines):
        if line.strip() == "## " + needle:
            start = i + 1
            break
    if start is None:
        return None
    end = len(lines)
    for i in range(start, len(lines)):
        if re.match(r"^## ", lines[i]):
            end = i
            break
    return (start, end)


def provider_problems(root):
    problems = []
    try:
        ids = source_ids(root)
    except DocsError as e:
        return [Problem(RUNNER_TYPES, 0, str(e))]
    for name, values in ids.items():
        if len(set(values)) != len(values):
            problems.append(Problem(RUNNER_TYPES, 0, "%s contains a duplicate id" % name))

    try:
        lines = _read(root, README).splitlines()
    except DocsError as e:
        return problems + [Problem(README, 0, str(e))]
    section = _section(lines, PROVIDER_SECTION)
    if section is None:
        return problems + [Problem(README, 0, "`## %s` section not found" % PROVIDER_SECTION)]
    start, end = section

    table = [(i, lines[i]) for i in range(start, end) if lines[i].lstrip().startswith("|")]
    if len(table) < 2:
        problems.append(Problem(README, start + 1, "no provider table under `## %s`" % PROVIDER_SECTION))
    else:
        header_line, header = table[0]
        cells = [c.strip() for c in header.strip().strip("|").split("|")]
        col = next((i for i, c in enumerate(cells) if "descriptor" in c.lower()), None)
        if col is None:
            problems.append(Problem(README, header_line + 1, "provider table lacks a descriptor-id column"))
        else:
            rows = []
            for i, line in table[1:]:
                rowcells = [c.strip() for c in line.strip().strip("|").split("|")]
                if all(re.fullmatch(r":?-+:?", c or "-") for c in rowcells):
                    continue
                if col >= len(rowcells):
                    problems.append(Problem(README, i + 1, "provider row has no descriptor cell"))
                    continue
                found = re.findall(r"`([^`]+)`", rowcells[col])
                if len(found) != 1:
                    problems.append(Problem(README, i + 1, "provider row must carry exactly one `id` descriptor"))
                    continue
                rows.append((i + 1, found[0]))
            seen = {}
            for lineno, pid in rows:
                if pid in seen:
                    problems.append(Problem(README, lineno, "duplicate provider descriptor `%s` (first row %d)" % (pid, seen[pid])))
                seen.setdefault(pid, lineno)
            documented = set(seen)
            for pid in ids["PROVIDERS"]:
                if pid not in documented:
                    problems.append(Problem(README, header_line + 1, "provider table lacks `%s` (runner PROVIDERS)" % pid))
            for lineno, pid in rows:
                if pid not in ids["PROVIDERS"]:
                    problems.append(Problem(README, lineno, "descriptor `%s` is not in runner PROVIDERS" % pid))

    parent_lines = [(i, lines[i]) for i in range(start, end) if "as parents" in lines[i]]
    if not parent_lines:
        problems.append(Problem(README, start + 1, "no `as parents` line naming the supported parent ids"))
    else:
        lineno, text = parent_lines[0]
        named = re.findall(r"`([^`]+)`", text)
        if len(set(named)) != len(named):
            problems.append(Problem(README, lineno + 1, "duplicate parent id in the `as parents` line"))
        for pid in ids["PARENTS"]:
            if pid not in named:
                problems.append(Problem(README, lineno + 1, "parent line lacks `%s` (runner PARENTS)" % pid))
        for pid in named:
            if pid not in ids["PARENTS"]:
                problems.append(Problem(README, lineno + 1, "parent id `%s` is not in runner PARENTS" % pid))
    return problems


FENCE = re.compile(r"^\s*(```+|~~~+)")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
INLINE_CODE = re.compile(r"(`+)(.+?)\1")
LINK = re.compile(r"\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)|^ {0,3}\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)")
SCHEME = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
EMPH = re.compile(r"[*`]|\[([^\]]*)\]\([^)]*\)")


def _prose_lines(text):
    fence = None
    for i, line in enumerate(text.splitlines()):
        m = FENCE.match(line)
        if m:
            if fence is None:
                fence = m.group(1)
            elif re.fullmatch(re.escape(fence[0]) + "{%d,}\\s*" % len(fence), line.strip()):
                fence = None
            continue
        if fence is None:
            yield i + 1, line


def github_slug(heading):
    """Approximate GitHub anchors for the heading styles this repo uses."""
    text = EMPH.sub(lambda m: m.group(1) or "", heading).lower()
    return "".join(c if (c.isalnum() or c in "-_") else "-" if c.isspace() else "" for c in text)


def heading_slugs(path):
    slugs = set()
    seen = {}
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return slugs
    for _, line in _prose_lines(text):
        m = HEADING.match(line)
        if not m:
            continue
        slug = github_slug(m.group(2))
        n = seen.get(slug, 0)
        candidate = slug if n == 0 else "%s-%d" % (slug, n)
        while candidate in slugs:
            n += 1
            candidate = "%s-%d" % (slug, n)
        seen[slug] = n
        slugs.add(candidate)
    return slugs


def tracked_markdown(root):
    try:
        out = subprocess.run(["git", "ls-files", "-z", "--", "*.md"], cwd=str(root),
                             check=True, capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        raise DocsError("git ls-files failed under %s (%s); the docs checker needs a git checkout" % (root, e))
    return [p for p in out.split("\0") if p and (root / p).is_file()]


def inventory_problems(root):
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=str(root), check=True,
                             capture_output=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        return [Problem(".", 0, "git ls-files failed: %s" % e)]
    scoped = []
    for rel in out.split("\0"):
        if not rel or not (root / rel).is_file():
            continue
        if "/" not in rel:
            if rel.endswith(".md") or rel.startswith(("LICENSE", "NOTICE")):
                scoped.append(rel)
        elif rel.startswith(("docs/", "maintenance/", "LICENSES/")):
            scoped.append(rel)
    return [Problem(rel, 0, "public document is outside the approved inventory")
            for rel in scoped if rel not in APPROVED]


def link_problems(root):
    try:
        files = tracked_markdown(root)
    except DocsError as e:
        return [Problem(".", 0, str(e))]
    problems = []
    slug_cache = {}
    for rel in files:
        if rel.startswith("plugins/"):
            continue
        path = root / rel
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            problems.append(Problem(rel, 0, "cannot read tracked file (%s)" % e))
            continue
        base = str(Path(rel).parent)
        for lineno, line in _prose_lines(text):
            line = INLINE_CODE.sub("", line)
            for m in LINK.finditer(line):
                dest = m.group(1) or m.group(2)
                if dest.startswith("<") and dest.endswith(">"):
                    dest = dest[1:-1]
                if SCHEME.match(dest):
                    continue
                target_part, _, frag = dest.partition("#")
                if not target_part:
                    target_rel = rel
                else:
                    target_rel = str(Path(base, unquote(target_part))) if base != "." else unquote(target_part)
                    target_rel = str(Path(target_rel))
                target_abs = (root / target_rel).resolve()
                try:
                    target_abs.relative_to(root.resolve())
                except ValueError:
                    problems.append(Problem(rel, lineno, "link escapes the repository: %s" % dest))
                    continue
                if not target_abs.exists():
                    problems.append(Problem(rel, lineno, "link target not found: %s" % dest))
                    continue
                if frag and target_rel.endswith(".md"):
                    if target_rel not in slug_cache:
                        slug_cache[target_rel] = heading_slugs(target_abs)
                    anchor = unquote(frag)
                    if anchor not in slug_cache[target_rel]:
                        problems.append(Problem(rel, lineno, "no heading matching #%s in %s" % (anchor, target_rel)))
    return problems


def release_problems(root):
    problems = []
    try:
        manifest = json.loads(_read(root, PLUGIN_MANIFEST))
        version = manifest["version"]
        if not isinstance(version, str) or not version:
            raise ValueError("version must be a nonempty string")
    except (DocsError, KeyError, ValueError) as e:
        return [Problem(PLUGIN_MANIFEST, 0, "cannot read packaged version: %s" % e)]
    try:
        changes = _read(root, CHANGELOG).splitlines()
        upstream = _read(root, UPSTREAM)
    except DocsError as e:
        return [Problem(".", 0, str(e))]
    headings = [(i, line) for i, line in enumerate(changes) if line.startswith("## ")]
    if not headings:
        problems.append(Problem(CHANGELOG, 1, "no version heading"))
        return problems
    first, heading = headings[0]
    if not re.match(r"^## " + re.escape(version) + r"(?:\s|$)", heading):
        problems.append(Problem(CHANGELOG, first + 1, "first version heading must be ## %s (suffix allowed)" % version))
    section = "\n".join(changes[first + 1:headings[1][0] if len(headings) > 1 else len(changes)])
    commit = re.findall(r"^\| Commit \| `([0-9a-f]{40})` \|$", upstream, re.M)
    upstream_version = re.findall(r"^\| Upstream version \| `([^`]+)` \|$", upstream, re.M)
    if len(commit) != 1 or len(upstream_version) != 1:
        problems.append(Problem(UPSTREAM, 1, "expected one Cursor Commit and Upstream version row"))
        return problems
    baselines = CURSOR_BASELINE.findall(section)
    if baselines != [(upstream_version[0], commit[0])]:
        problems.append(Problem(CHANGELOG, first + 1, "current version needs exactly one Cursor baseline matching UPSTREAM.md version and Commit"))
    pins = PINNED_README.findall(upstream)
    if pins != [commit[0]]:
        problems.append(Problem(UPSTREAM, 1, "pinned Cursor README must match Commit row"))
    return problems


def check(root):
    root = Path(root)
    problems = provider_problems(root) + inventory_problems(root) + link_problems(root) + release_problems(root)
    return sorted(problems, key=lambda p: (p.path, p.line, p.message))


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check maintained documentation structure.")
    parser.add_argument("--root", default=".", help="repository root to check (default: cwd)")
    args = parser.parse_args(argv)
    problems = check(args.root)
    for p in problems:
        print(p)
    if problems:
        print("check-docs: %d problem(s)" % len(problems))
        return 1
    print("check-docs: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
