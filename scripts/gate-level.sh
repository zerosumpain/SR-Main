#!/usr/bin/env bash
# Compute the gate LEVEL for a change set: L1, L2 or L3.
#
# This is a SECOND axis, deliberately not a third value on classify-pr-risk.sh.
# The two answer different questions:
#
#   tier  (classify-pr-risk.sh) — "may an agent land this without a human?"
#                                 a TRUST question, ALLOW-by-default: anything
#                                 not named in protected-paths.txt is low,
#                                 because you want autonomy everywhere you have
#                                 not explicitly forbidden it.
#
#   level (this script)         — "how much of the tree could this have broken?"
#                                 a BLAST-RADIUS question, DENY-by-default:
#                                 anything not recognised gets the full gate.
#
# One file cannot carry both polarities without one of them being wrong, and the
# repo's own history shows they are not the same set: replaying the classifier
# over 200 merges, its top two drivers are scripts/** and .github/**, protected
# because an agent editing its own deploy path is dangerous — not because they
# touch the bundle. Meanwhile src/lib/db/index.ts, the module behind the one
# real post-merge build break this repo has had, is not protected at all.
#
#   L1 — documentation only. Nothing that is compiled, bundled, imported, or
#        read at runtime. Linters only.
#   L2 — ordinary source. Recognised code paths, no wide trigger, add/modify
#        only, and tier=low.
#   L3 — everything else, and the default.
#
# FAIL-CLOSED BY CONSTRUCTION. LEVEL starts at L3 and only ever moves down on a
# fully successful path. Every error, every unknown, every unreadable ref leaves
# it at L3. The exit code is always 0 — classification is not itself a failure,
# and a non-zero exit here would fail the gate for the wrong reason. Callers
# must therefore read `level`, never the status.
#
# Usage:
#   scripts/gate-level.sh [BASE_REF]        # defaults to origin/master
#   GATE_LEVEL_FILES=$'a\nb' scripts/gate-level.sh   # injected list, for tests
#
# Deliberately NOT `set -e`: every exit path is explicit so that a failure
# cannot skip the emit and leave a caller reading an empty level.
set -uo pipefail

LEVEL=L3
REASON="default (nothing lowered it)"

emit() {
  echo "level=$LEVEL"
  echo "reason=$REASON"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "level=$LEVEL"
      echo "reason=$REASON"
    } >> "$GITHUB_OUTPUT"
  fi
  exit 0
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)" || { REASON="cannot resolve repo root"; emit; }

# ── the change set ────────────────────────────────────────────────────────────
if [ -n "${GATE_LEVEL_FILES:-}" ]; then
  CHANGED="$GATE_LEVEL_FILES"
  STATUSES=""
else
  BASE_REF="${1:-origin/master}"
  MB="$(git -C "$HERE" merge-base "$BASE_REF" HEAD 2>/dev/null)" || { REASON="no merge-base against $BASE_REF"; emit; }
  [ -n "$MB" ] || { REASON="empty merge-base against $BASE_REF"; emit; }
  # --diff-filter is NOT used to exclude deletions here; we want to SEE them so
  # they can force L3 rather than silently vanishing from the list.
  # Compare the merge base with the working tree, not only HEAD. CI checkouts
  # are clean so the answer is identical there; locally this also sees staged
  # and unstaged edits (and validate-change uses a temporary index for untracked
  # files) instead of declaring active work "no files changed".
  STATUSES="$(git -C "$HERE" diff --name-status "$MB" -- 2>/dev/null)" || { REASON="cannot diff against $BASE_REF"; emit; }
  CHANGED="$(printf '%s\n' "$STATUSES" | awk 'NF{print $NF}')"
fi

if [ -z "$(printf '%s' "$CHANGED" | tr -d '[:space:]')" ]; then
  LEVEL=L1
  REASON="no files changed"
  emit
fi

# Any deletion or rename invalidates the reasoning: a deleted module can break
# importers that no longer appear in the diff, and a rename is a delete plus an
# add with no edge between them.
if [ -n "$STATUSES" ] && printf '%s\n' "$STATUSES" | grep -qE '^(D|R[0-9]*)'; then
  REASON="change set contains a deletion or rename"
  emit
fi

# ── wide triggers: the files whose change invalidates the graph itself ────────
is_wide() {
  case "$1" in
    package.json|package-lock.json) return 0 ;;
    vite.config.ts|vite.config.js|svelte.config.js|tsconfig.json|drizzle.config.ts) return 0 ;;
    src/app.d.ts|src/app.html|src/hooks.server.ts|src/hooks.client.ts) return 0 ;;
    src/lib/db/schema.ts) return 0 ;;
    *.d.ts) return 0 ;;
    .github/*) return 0 ;;
    scripts/*) return 0 ;;
    *) return 1 ;;
  esac
}

# ── documentation: tight, and deliberately NOT "any .md anywhere" ────────────
# data/prompts/*.md is read at runtime by the prompts loader, covered by a test,
# and rsynced to the VPS by the release. Treating it as documentation would ship
# a prompt change with nothing checked at all. Only docs/ and root-level
# markdown qualify.
is_docs() {
  case "$1" in
    docs/*) return 0 ;;
    */*) return 1 ;;          # anything nested that is not under docs/
    *.md) return 0 ;;         # root-level markdown only
    *) return 1 ;;
  esac
}

# ── recognised source: the L2 candidate set ──────────────────────────────────
is_known_code() {
  case "$1" in
    src/*|tests/*|packages/*|static/*|data/*) return 0 ;;
    *) return 1 ;;
  esac
}

ALL_DOCS=1
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if is_wide "$f"; then
    REASON="wide trigger: $f"
    emit
  fi
  if ! is_docs "$f"; then
    ALL_DOCS=0
    if ! is_known_code "$f"; then
      REASON="unrecognised path: $f"
      emit
    fi
  fi
done <<< "$CHANGED"

if [ "$ALL_DOCS" -eq 1 ]; then
  LEVEL=L1
  REASON="documentation only"
  emit
fi

# ── the trust axis gates the blast-radius axis, never the other way round ─────
# A protected path is L3 whatever its blast radius looks like. This confinement
# is the whole reason scoping is acceptable: anything skipped at L2 is, by
# construction, a change the trust axis already called low — never auth, server
# lib, hooks, schema or the deploy path.
if [ -z "${GATE_LEVEL_FILES:-}" ]; then
  TIER_OUT="$("$HERE/scripts/classify-pr-risk.sh" "${1:-origin/master}" 2>/dev/null)" || { REASON="risk classifier failed"; emit; }
  if printf '%s' "$TIER_OUT" | grep -q 'tier=HIGH'; then
    REASON="protected paths touched (tier=high)"
    emit
  fi
elif [ "${GATE_LEVEL_TIER:-low}" = "high" ]; then
  REASON="protected paths touched (tier=high, injected)"
  emit
fi

LEVEL=L2
REASON="ordinary source, no wide triggers, tier=low"
emit
