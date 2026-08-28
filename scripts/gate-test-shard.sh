#!/usr/bin/env bash
# The test half of the gate, for ONE shard of the matrix job.
#
# Usage: gate-test-shard.sh <shard-index> <shard-total>
#
# Two modes, and the polarity is the same as everywhere else in the gate: the
# CHEAP path is selected explicitly and by exact match, and everything else
# falls through to running MORE rather than less.
#
#   GATE_LEVEL=L2 and total=1 -> scoped to what the change set can reach.
#                                A 26-file selection split four ways would pay
#                                four job set-ups to save nothing, so the level
#                                job emits a single shard at L2.
#   anything else             -> the whole suite, shard k of N.
#
# The `total = 1` half of that condition is not redundant. If the level ever says
# L2 while the matrix still fans out — a half-applied config change, a hand-typed
# workflow_dispatch — running the scoped selection in all four shards would run
# the same few files four times and skip everything else, reporting green. Under
# this condition that combination runs the full sharded suite instead: more work,
# never less.
#
# LIVENESS ASSERTION, same reasoning as gate-check.sh. vitest can exit 0 having
# executed nothing, and a suite that never ran looks exactly like a suite that
# passed. The `Test Files` summary line is the proof it got to the end.
#
# Note this deliberately does NOT `exec`. gate-test-scoped.sh execs its way into
# vitest, which is fine when the caller supplies the liveness check (as
# gate-concurrent.sh did); here this script IS the caller, so it has to stay
# alive to inspect the log.
#
# CI-only: not synced to the VPS (scripts/ci-release.sh is a per-file
# allow-list and this file has no line in it) and nothing at runtime reads it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IDX="${1:?shard index required}"
TOTAL="${2:?shard total required}"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

if [ "${GATE_LEVEL:-}" = "L2" ] && [ "$TOTAL" = "1" ]; then
  echo "==> level L2: tests scoped to the change set (single shard)"
  ./scripts/gate-test-scoped.sh "${GATE_BASE:-HEAD^}" 2>&1 | tee "$LOG"
  EC=${PIPESTATUS[0]}
else
  echo "==> level ${GATE_LEVEL:-<unset>}: whole suite, shard ${IDX}/${TOTAL}"
  # Excludes mirror `gate:test` in package.json exactly. The integration suite
  # wants live API keys and a database the gate deliberately does not have; it
  # runs in the nightly instead.
  #
  # No --passWithNoTests: vitest defaults it to false, so an empty shard fails.
  # That is the wanted direction — an empty shard means the sharding maths is
  # wrong, and a silent green would hide it.
  NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
    --exclude '**/node_modules/**' \
    --exclude '**/*.integration.test.ts' \
    --shard="${IDX}/${TOTAL}" 2>&1 | tee "$LOG"
  EC=${PIPESTATUS[0]}
fi

if ! grep -q 'Test Files' "$LOG"; then
  echo "ERROR: vitest printed no 'Test Files' summary — it did not run to completion." >&2
  EC=1
fi

if [ "$EC" -ne 0 ]; then
  echo "==> TESTS FAILED (shard ${IDX}/${TOTAL}, exit ${EC})" >&2
  exit 1
fi

echo "==> tests passed (shard ${IDX}/${TOTAL})"
