#!/usr/bin/env bash
# Run the local gate on porkserv instead of on homeserv.
#
# WHY. gate:check:only asks Node for an 8GB heap and gate:build for 6GB, on a
# homeserv that has 7.6GB of RAM in total and 2.3GB of it already in swap. The
# gate cannot fit on the machine it was written for: earlyoom SIGTERMed node
# seventeen times in the fortnight to 2026-08-29 at 1-4GB RSS. porkserv has 62GB
# and four real cores and is otherwise idle (load 0.15), so both halves of
# gate-concurrent.sh run there at full size, at once, with nothing swapping.
#
# It is NOT faster per core — porkserv is an i5-7500T at 2.7GHz against
# homeserv's i3-7300T at 3.5GHz. The win is that the gate FINISHES instead of
# being OOM-killed two thirds of the way through, and that it stops evicting
# everything else on the dev box while it runs.
#
#   ./scripts/gate-remote.sh              # svelte-check + the full test suite
#   ./scripts/gate-remote.sh --build      # ...and a real production build
#
# Run it from any worktree. The tree you are standing in is the tree that gets
# gated, uncommitted changes included — that is the whole point of a pre-push
# gate, and it is why this rsyncs a working tree rather than cloning a ref.
#
# THE WORKTREE NEEDS NO node_modules. The install happens on porkserv against
# the rsynced package-lock.json, so a bare `git worktree add` is enough to gate
# from.
#
# This does not replace CI. `gate` still runs on GitHub-hosted runners on every
# PR and must keep doing so: SR-Main is a PUBLIC repo, and a self-hosted runner
# accepting fork PRs would let a stranger execute code on the box that holds the
# restic backups. See ~/porkserv/runner.yml.
set -uo pipefail

REMOTE="${GATE_REMOTE_HOST:-porkserv}"
REMOTE_ROOT="${GATE_REMOTE_ROOT:-/home/john/gate}"
REMOTE_WORK="$REMOTE_ROOT/work"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --build) WITH_BUILD=1 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

echo "==> gating $(basename "$ROOT") [$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')] on ${REMOTE}"

# .git is EXCLUDED, and that is a deliberate call, not an oversight.
#
#   - In a worktree, .git is a FILE holding an absolute gitdir path pointing back
#     into homeserv's main checkout. Copying it produces a repo that is broken in
#     a confusing way rather than absent in an obvious one.
#   - One test genuinely needs a repo — owner.test.ts enumerates the source tree
#     with `git ls-files` to prove the owner's phone number is not in it — so
#     gate-remote-run.sh makes the workspace its own throwaway repo instead.
#     (check-module-boundaries.mjs and select-tests.test.ts only LOOK like git
#     users: the first mentions `git ls-files` in a comment, the second shells
#     out to `grep -rlE`.)
#   - It therefore always takes the `GATE_LEVEL` unset branch of
#     gate-concurrent.sh and runs the WHOLE suite. That agrees with the polarity
#     that script argues for — get the level wrong and you run too much, never
#     too little — and porkserv has the headroom to make full the cheap option.
#
# .env and keys.json are excluded too. This box gets the CI-shaped environment
# assembled in gate-remote-run.sh instead: homeserv's .env points DATABASE_URL at
# homeserv's own 127.0.0.1:5433, which is not reachable from porkserv, and
# shipping real secrets to a third machine to run unit tests is a cost with no
# benefit. CI has no .env either and its tests pass.
echo "==> rsync → ${REMOTE}:${REMOTE_WORK}"
rsync -a --delete --info=stats1 \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='keys.json' \
  --exclude='node_modules' \
  --exclude='.svelte-kit' \
  --exclude='build' \
  --exclude='.worktrees' \
  --exclude='.claude/worktrees' \
  ./ "${REMOTE}:${REMOTE_WORK}/"
RSYNC_EC=$?
if [ "$RSYNC_EC" -ne 0 ]; then
  echo "ERROR: rsync failed (exit ${RSYNC_EC}) — nothing ran on ${REMOTE}." >&2
  exit 1
fi

# `ssh -n`, and the payload is a FILE on the far side rather than a heredoc piped
# into `bash -s`. A piped script leaves its own remaining text in stdin, the
# first command that reads stdin eats it, and the rest never executes — silently,
# with exit 0. That cost a scheduled job two thirds of its body on 2026-08-20.
# The runner arrives as part of the rsync above, so it is always the version
# belonging to the tree being gated.
#
# flock serialises runs: one workspace, one node_modules, one database. Two
# worktrees gated at once would otherwise interleave into the same directory.
# -w 3600 waits rather than failing, because "another gate is running" is a
# reason to queue, not to error.
ssh -n "$REMOTE" \
  "GATE_WITH_BUILD=${WITH_BUILD} flock -w 3600 '${REMOTE_ROOT}/.lock' '${REMOTE_WORK}/scripts/gate-remote-run.sh'"
EC=$?

if [ "$EC" -ne 0 ]; then
  echo "==> GATE FAILED on ${REMOTE} (exit ${EC})" >&2
  exit "$EC"
fi
echo "==> gate passed on ${REMOTE}"
