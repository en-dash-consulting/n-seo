#!/bin/sh
# Register the git filters this repo expects.
#
# rex-scrub: strips `lastModifiedBy` from the PRD tree on the way into git.
#
#   rex stamps every item it writes with the local git identity, resolved from
#   `git config user.name` + `user.email`. There is no flag, env var or config
#   key to turn that off (en-dash-consulting/n-dx#377), and `no-private-names`
#   in CI rejects the result — so without this filter, every `rex add` or
#   `rex update` writes a name and address into tracked files and fails the
#   build.
#
#   This is a `clean` filter only: the field is stripped as the file is staged
#   and never restored on checkout, because nothing here reads it. The value
#   stays in the working tree, so rex is unaffected; git simply never sees it.
#
#   One wart worth knowing: `git status` will list a file rex has just stamped
#   as modified, because the stat cache went stale. There is no content
#   difference — `git diff` is empty and `git add` produces nothing to commit —
#   but the M is visible until something refreshes the index.
#
#   Filters live in .git/config, which is not cloned. Every working copy has to
#   run this once. CI is the backstop if someone does not.
#
# Usage:
#   ops/install-git-filters.sh              install
#   ops/install-git-filters.sh --uninstall  remove
set -eu

NAME="rex-scrub"
CLEAN="sed '/^lastModifiedBy: /d'"

if [ "${1:-}" = "--uninstall" ]; then
  git config --unset "filter.$NAME.clean" 2>/dev/null || true
  echo "removed filter.$NAME.clean"
  echo "note: .gitattributes still references it; unregistered filters are a no-op."
  exit 0
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "not a git repository" >&2
  exit 1
fi

git config "filter.$NAME.clean" "$CLEAN"
echo "registered filter.$NAME.clean = $CLEAN"

# Re-stage anything already tracked so the filter applies to existing files
# rather than only to the next write.
if git ls-files -z '.rex/**/*.md' | grep -qz . 2>/dev/null; then
  git add --renormalize .rex 2>/dev/null || true
fi

if git diff --cached --quiet 2>/dev/null; then
  echo "PRD tree already clean."
else
  echo "staged the scrub of files that already carried the field — review with 'git diff --cached'."
fi
