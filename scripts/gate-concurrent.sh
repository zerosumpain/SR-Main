#!/usr/bin/env bash
# Run the type check and the test suite CONCURRENTLY.
#
# Why: the gate ran them back to back, which wasted half the machine. A hosted
# runner has 2 cores; svelte-check is single-threaded, and vitest with no
# explicit worker setting falls back to (cores - 1), which on a 2-core box is
# exactly ONE worker. Measured on a real gate run: across 454 test files in a
# four-minute window, no two files ever finished within 150ms of each other.
# Running the pair together costs the LONGER of the two rather than their sum
# (~109s off every gate run, at every risk level).
#
# EXIT CODES ARE THE WHOLE DIFFICULTY HERE. The obvious way to interleave two
# background processes' output — piping each through `tee` or a prefixer — makes
# bash report the status of the LAST command in the pipeline, and this script
# cannot rely on `pipefail` being set by whatever shell CI hands it. That
# silently converts a RED type check into a GREEN gate, which is the one
# failure this repo cannot afford: the job status is what the deploy depends on.
# So each side writes to its own log, we wait on the two PIDs individually, and
# we OR the statuses.
#
# The second trap is a checker that dies without printing anything and still
# exits 0 — "found no errors" and "never looked" are indistinguishable from the
# exit code alone. Both sides therefore assert a plausible summary line before
# the run is allowed to pass.
#
# CI-only: this is not synced to the VPS by ci-deploy.sh and nothing at runtime
# reads it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT
CHECK_LOG="$LOG_DIR/check.log"
TEST_LOG="$LOG_DIR/test.log"

# `svelte-kit sync` ONCE, up front, serially. Both sides would otherwise trigger
# it — svelte-check via gate:check, vitest via the sveltekit vite plugin — and
# two processes generating .svelte-kit/types at the same time is a race for no
# benefit. After this, only vitest may regenerate, and svelte-check only reads.
echo "==> svelte-kit sync (once, before the concurrent pair)"
if ! npm run gate:sync; then
  echo "ERROR: svelte-kit sync failed; not starting the gate." >&2
  exit 1
fi

# At L2 — ordinary source, no wide triggers, low risk tier — the tests are scoped
# to what the change can actually reach. EVERY other value runs the whole suite,
# including an empty or unrecognised one, because the condition selects the CHEAP
# path rather than excluding it. That polarity is the point: get the level wrong
# and you run too much, never too little.
#
# The type check is NEVER scoped. A changed type signature breaks its consumers,
# not itself, so narrowing it would miss exactly what it exists to catch.
if [ "${GATE_LEVEL:-}" = "L2" ]; then
  TEST_CMD=(./scripts/gate-test-scoped.sh "${GATE_BASE:-HEAD^}")
  echo "==> level L2: tests scoped to the change set"
else
  TEST_CMD=(npm run gate:test)
  echo "==> level ${GATE_LEVEL:-<unset>}: running the whole suite"
fi

# Bound the test pool when asked. Running the two halves together means their
# memory ceilings ADD, and vitest's does not scale the way it looks: it sizes
# its worker pool from the machine (cores - 1), NODE_OPTIONS is inherited by
# every one of those workers, and `gate:test` asks for a 4 GB heap — so on an
# 8-core box that is seven workers each permitted 4 GB, alongside
# svelte-check's own 4 GB.
#
# On the 2-core CI runner this never bit: one worker, one heap. It bit the
# autonomous builder immediately. Its cgroup (7 GB) recorded 1,026 hits against
# the ceiling and memory.peak pinned to it, and a vitest worker came back with
# `Error: No such built-in module: node:` — a specifier truncated mid-string,
# which is what a worker dying under reclaim looks like from the outside. The
# test passes alone, and passed in CI, so it reads as a real defect in a file
# the change never touched. That is the most expensive kind of wrong answer
# this system can give an agent.
#
# Unset means unbounded, which is CI's behaviour today and stays that way.
#
# NOTE THE `--`. `npm run gate:test --maxWorkers=3` hands the flag to npm, which
# ignores it, and vitest fans out exactly as before — a fix that changes nothing
# while reading as though it did.
if [ -n "${GATE_TEST_MAX_WORKERS:-}" ] && [ "${TEST_CMD[0]}" = "npm" ]; then
  TEST_CMD+=(-- --maxWorkers="$GATE_TEST_MAX_WORKERS")
  echo "==> test pool capped at ${GATE_TEST_MAX_WORKERS} workers"
fi

echo "==> Starting svelte-check and vitest concurrently"
START=$(date +%s)

npm run gate:check:only > "$CHECK_LOG" 2>&1 &
CHECK_PID=$!
"${TEST_CMD[@]}" > "$TEST_LOG" 2>&1 &
TEST_PID=$!

# `wait <pid>` yields that child's status. Do NOT collapse these into a bare
# `wait` — that returns 0 once all children are reaped, regardless of how they
# exited.
wait "$CHECK_PID"; CHECK_EC=$?
wait "$TEST_PID";  TEST_EC=$?

ELAPSED=$(( $(date +%s) - START ))

echo
echo "════════ svelte-check (exit ${CHECK_EC}) ════════"
cat "$CHECK_LOG"
echo
echo "════════ vitest (exit ${TEST_EC}) ════════"
cat "$TEST_LOG"
echo

# Liveness assertions. svelte-check prints e.g.
#   "svelte-check found 0 errors and 741 warnings in 202 files"
# and vitest prints a "Test Files" summary. Absence of either means the process
# died before finishing, whatever it claimed on the way out.
if ! grep -q 'svelte-check found' "$CHECK_LOG"; then
  echo "ERROR: svelte-check printed no summary line — it did not run to completion." >&2
  CHECK_EC=1
fi
if ! grep -q 'Test Files' "$TEST_LOG"; then
  echo "ERROR: vitest printed no 'Test Files' summary — it did not run to completion." >&2
  TEST_EC=1
fi

echo "==> type check: exit ${CHECK_EC} | tests: exit ${TEST_EC} | wall clock: ${ELAPSED}s"

if [ "$CHECK_EC" -ne 0 ] || [ "$TEST_EC" -ne 0 ]; then
  echo "==> GATE FAILED" >&2
  exit 1
fi

echo "==> gate passed"
