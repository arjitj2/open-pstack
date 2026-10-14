#!/usr/bin/env bash
set -u

usage() { echo "Usage: worktree-audit.sh [-b <pr-base-ref>] [--transcript-root <directory>] [repo-path]" >&2; }

base=""
repo=""
transcript_root=""
while [ $# -gt 0 ]; do
	case "$1" in
		-b|--base)
			[ $# -ge 2 ] && [ -n "$2" ] && [ "${2#-}" = "$2" ] || { usage; exit 2; }
			base="$2"; shift 2 ;;
		--transcript-root)
			[ $# -ge 2 ] && [ -n "$2" ] && [ "${2#-}" = "$2" ] || { usage; exit 2; }
			transcript_root="$2"; shift 2 ;;
		-h|--help)
			usage; exit 0 ;;
		-*)
			usage; exit 2 ;;
		*)
			[ -n "$repo" ] && { usage; exit 2; }
			repo="$1"; shift ;;
	esac
done
if [ -n "$transcript_root" ]; then
	[ -d "$transcript_root" ] && [ -r "$transcript_root" ] || {
		echo "error: transcript root is not a readable directory: $transcript_root" >&2; exit 2; }
	transcript_root=$(cd "$transcript_root" && pwd -P) || exit 2
fi
repo="${repo:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$repo" ] && { echo "not in a git repo; pass a repo path" >&2; exit 1; }
cd "$repo" || exit 1

git rev-parse --git-dir >/dev/null 2>&1 || {
	echo "error: $repo is not a git repository" >&2; exit 1; }

if [ -z "$base" ]; then
	base=$(git symbolic-ref --short -q refs/remotes/origin/HEAD 2>/dev/null || true)
	if [ -z "$base" ]; then
		for c in origin/main origin/master; do
			git rev-parse --verify -q "$c" >/dev/null 2>&1 && { base="$c"; break; }
		done
	fi
	[ -n "$base" ] && \
		echo "note: defaulting base to $base (override with -b/--base)" >&2
fi
case "$base" in
	origin/*)
		git fetch origin "+refs/heads/${base#origin/}:refs/remotes/$base" --quiet 2>/dev/null \
			|| echo "warn: could not fetch $base; merged column may be stale" >&2 ;;
esac
git rev-parse --verify -q "$base^{commit}" >/dev/null 2>&1 || {
	echo "error: base ref '$base' does not resolve" >&2; exit 1; }

# Main worktree is the first entry; everything else is a candidate.
main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')

# PR state by branch, fetched once. Empty if gh is unavailable.
prs=$(mktemp)
gh pr list --author "@me" --state all --limit 1000 \
	--json number,state,headRefName 2>/dev/null > "$prs" || echo "[]" > "$prs"

# jq reads that JSON and rg finds the transcripts. Without either, the PR and
# LAST_CHAT columns blank out and no row can reach verify-recent-chat, so an
# in-use worktree buckets as safe. Say so rather than return a confident table.
command -v jq >/dev/null || echo "warn: jq not found; PR column will be empty" >&2
command -v rg >/dev/null || echo "warn: rg not found; LAST_CHAT column will be empty and no row can bucket verify-recent-chat" >&2

# Transcripts: ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl, where <encoded-cwd> is a
# session's cwd with every "/" turned into "-". A session run inside a worktree lives
# under that worktree's own directory, so scan the whole projects tree, not one repo's.
if [ -n "$transcript_root" ]; then
	transcripts="$transcript_root"
else
	transcripts="$HOME/.claude/projects"
fi
now=$(date +%s)

echo "# base: $base"
printf "SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE\n"

git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do
	[ "$wt" = "$main_wt" ] && continue

	size=$(du -sh "$wt" 2>/dev/null | awk '{print $1}')
	head=$(git -C "$wt" rev-parse HEAD 2>/dev/null)
	head_ts=$(git -C "$wt" log -1 --format='%ct' HEAD 2>/dev/null || echo 0)
	age=$([ "$head_ts" -gt 0 ] 2>/dev/null && echo "$(( (now - head_ts) / 86400 ))d" || echo "?")

	# Squash-merged branches are not ancestors of the base, so PR state is the
	# real signal; merge-base only catches fast-forward/rebase merges.
	git merge-base --is-ancestor "$head" "$base" 2>/dev/null && merged=YES || merged=no

	# Distinguish real WIP (tracked edits) from disposable untracked scratch.
	porcelain=$(git -C "$wt" status --porcelain 2>/dev/null)
	if [ -z "$porcelain" ]; then dirty=clean
	elif printf '%s\n' "$porcelain" | grep -qv '^??'; then
		dirty="wip:$(printf '%s\n' "$porcelain" | grep -cv '^??')"
	else dirty="scratch:$(printf '%s\n' "$porcelain" | grep -c '^??')"; fi

	branch=$(git -C "$wt" symbolic-ref --quiet --short HEAD 2>/dev/null || echo "")
	if [ -z "$branch" ]; then remote=detached
	elif git -C "$wt" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
		[ "$(git -C "$wt" rev-parse "origin/$branch" 2>/dev/null)" = "$head" ] \
			&& remote=pushed \
			|| remote="ahead$(git -C "$wt" rev-list --count "origin/$branch..HEAD" 2>/dev/null)"
	else remote=no-remote; fi

	pr=$([ -n "$branch" ] && jq -r --arg b "$branch" \
		'.[] | select(.headRefName==$b) | "#\(.number)/\(.state)"' "$prs" 2>/dev/null | head -1)
	[ -z "$pr" ] && pr="-"

	# Most recent chat whose transcript operated in this worktree. Match path
	# followed by "/" or a quote so glint-482 does not match glint-482-r37.
	last="-"; last_ts=0
	if [ -d "$transcripts" ]; then
		f=$(rg -l -e "${wt}/" -e "${wt}\"" "$transcripts" 2>/dev/null \
			| xargs stat -f '%m %N' 2>/dev/null | sort -rn | head -1)
		if [ -n "$f" ]; then last_ts=$(echo "$f" | awk '{print $1}')
			last=$(date -r "$last_ts" '+%Y-%m-%d' 2>/dev/null); fi
	fi
	recent=$([ "$last_ts" -gt 0 ] 2>/dev/null && [ $(( (now - last_ts) / 86400 )) -le 4 ] && echo yes || echo no)

	case "$dirty" in wip:*) bucket=hold-wip ;; *)
		case "$pr" in *OPEN*) bucket=hold-open-pr ;; *)
			if [ "$recent" = yes ]; then bucket=verify-recent-chat
			elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe
			else bucket=review; fi ;;
		esac ;;
	esac

	printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
		"$size" "$age" "$merged" "$dirty" "$remote" "$pr" "$last" "$bucket" "$wt"
done | sort -t$'\t' -k1,1 -rh

rm -f "$prs"
