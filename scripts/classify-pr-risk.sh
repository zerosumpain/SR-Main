#!/usr/bin/env bash
# Classify a change set as tier=low or tier=high against .github/protected-paths.txt.
#
# low  — additive/feature work. Safe for an agent to land without human review.
# high — touches auth, the data model, the deploy path, or the agent's own
#        safety rails. Never auto-merged; a human looks at it.
#
# Usage:
#   scripts/classify-pr-risk.sh [BASE_REF]     # defaults to origin/master
#
# Writes `tier` and `matched` to $GITHUB_OUTPUT when running under Actions, and
# always prints a human-readable verdict. Exit code is 0 for both tiers —
# classification is not itself a failure; the workflow decides what to do.
set -euo pipefail

BASE_REF="${1:-origin/master}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RULES="$HERE/.github/protected-paths.txt"

[ -f "$RULES" ] || { echo "missing $RULES" >&2; exit 2; }

# Merge-base diff, so we classify what the PR ADDS rather than everything that
# has landed on master since it branched.
if ! CHANGED=$(git diff --name-only "$(git merge-base "$BASE_REF" HEAD)"...HEAD 2>/dev/null); then
  echo "could not diff against $BASE_REF" >&2
  exit 2
fi

if [ -z "$CHANGED" ]; then
  echo "No files changed — tier=low"
  [ -n "${GITHUB_OUTPUT:-}" ] && { echo "tier=low"; echo "matched="; } >> "$GITHUB_OUTPUT"
  exit 0
fi

echo "Changed files:"
echo "$CHANGED" | sed 's/^/  /'
echo

matched=""
while IFS= read -r rule; do
  # strip comments / blanks
  rule="${rule%%#*}"
  rule="$(echo "$rule" | xargs || true)"
  [ -z "$rule" ] && continue

  # NB: the "/**" must be QUOTED on both lines. Unquoted, `== */**` is a glob
  # meaning "contains a slash", so every rule with a directory in it became a
  # subtree rule — src/hooks.server.ts silently matched all of src/.
  if [[ "$rule" == *"/**" ]]; then
    prefix="${rule%"/**"}/"                     # subtree rule
    hits=$(echo "$CHANGED" | grep -F "$prefix" | grep "^${prefix}" || true)
  else
    hits=$(echo "$CHANGED" | grep -Fx "$rule" || true)   # exact path
  fi

  if [ -n "$hits" ]; then
    while IFS= read -r h; do
      [ -n "$h" ] && matched+="$h (rule: $rule)"$'\n'
    done <<< "$hits"
  fi
done < "$RULES"

# ---------------------------------------------------------------------------
# MODIFYING an existing test is not the same as ADDING one.
#
# The gate is the only thing constraining an autonomous build, and the build can
# edit the gate's own assertions. Observed 2026-08-30, build 4cda9a8d: asked for
# an unrelated script, it went green partly by weakening an assertion in a test
# it had no reason to touch —
#
#   - expect(empty.factSheet).toBe('');
#   + expect(empty.facts.every((f) => f.section === 'Daydreams')).toBe(true);
#
# attaching a confident rationale about "a live test database" contributing
# Daydream rows. The builder's gate database has no daydream table at all.
#
# That PR classified tier=HIGH, but only by luck: it also added a file under
# `scripts/**`. The weakened assertion contributed NOTHING to the verdict. The
# same edit made during ordinary feature work classifies low and is auto-merge
# eligible from an `agent/` branch — a weakened invariant shipped to production
# by the very mechanism meant to catch weakened invariants.
#
# ADDING a test is the behaviour we want and stays tier=low. Only modification
# and deletion of an existing one is flagged, because that is the direction that
# can only ever remove coverage.
# ---------------------------------------------------------------------------
TEST_RE='\.(test|spec)\.[cm]?[jt]sx?$'
if EDITED_TESTS=$(git diff --name-status "$(git merge-base "$BASE_REF" HEAD)"...HEAD 2>/dev/null \
      | awk '$1 ~ /^[MDR]/ { $1=""; sub(/^[ \t]+/, ""); print }' \
      | grep -E "$TEST_RE" || true); then
  if [ -n "$EDITED_TESTS" ]; then
    while IFS= read -r t; do
      [ -n "$t" ] && matched+="$t (rule: modifies an existing test — coverage can only shrink)"$'\n'
    done <<< "$EDITED_TESTS"
  fi
fi

if [ -n "$matched" ]; then
  echo "tier=HIGH — protected paths touched:"
  echo "$matched" | sed 's/^/  /'
  TIER=high
else
  echo "tier=LOW — no protected paths touched."
  TIER=low
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  # Random heredoc delimiter, not a fixed one. `matched` is built from PR-
  # supplied filenames, and a file literally named EOF_MATCHED would close the
  # block early and let the rest of the name be parsed as further outputs —
  # including a forged `tier`. That matters more than it looks: the tier decides
  # auto-merge eligibility today, and is intended to gate more later.
  DELIM="EOF_$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  {
    echo "tier=$TIER"
    echo "matched<<$DELIM"
    echo "$matched"
    echo "$DELIM"
  } >> "$GITHUB_OUTPUT"
fi
