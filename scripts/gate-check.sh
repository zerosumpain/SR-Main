#!/usr/bin/env bash
# The type-check half of the gate, as its own job.
#
# Split out of gate-concurrent.sh when the gate stopped being one job. That
# script exists to run svelte-check and vitest together so the pair costs the
# LONGER of the two rather than their sum — a trick that only pays while both
# share a machine. Once the tests shard across four runners of their own,
# pinning the type check to one of them just makes that shard the slow one.
# gate-concurrent.sh is still the right tool for a LOCAL gate run; see its
# header.
#
# WHAT MUST SURVIVE THE SPLIT IS THE LIVENESS ASSERTION. svelte-check can die
# without printing anything and still exit 0, at which point "found no errors"
# and "never looked" are indistinguishable from the exit code alone — a green
# gate over a tree nobody checked. So the summary line is asserted, not assumed.
#
# The two accepted summary formats are not interchangeable trivia: svelte-check
# prints a human line ("svelte-check found 0 errors and 765 warnings in 214
# files") under one reporter and a machine line ("COMPLETED 6916 FILES 0
# ERRORS") under another, and which one appears depends on how the output is
# being consumed. Matching only one of them turns a perfectly good run red.
#
# NEVER SCOPED, at any gate level. A changed type signature breaks its
# consumers, not itself, so narrowing the check would miss exactly what it
# exists to catch. There is deliberately no GATE_LEVEL branch in here.
#
# CI-only: not synced to the VPS (scripts/ci-release.sh is a per-file
# allow-list and this file has no line in it) and nothing at runtime reads it.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

# `svelte-kit sync` first and separately: svelte-check reads .svelte-kit/types
# and does not generate it. A missing sync shows up as hundreds of bogus "cannot
# find module './$types'" errors rather than as the setup failure it is.
echo "==> svelte-kit sync"
if ! npm run gate:sync; then
  echo "ERROR: svelte-kit sync failed; not starting the type check." >&2
  exit 1
fi

# `tee` so the output streams into the job log as it happens instead of landing
# in one dump at the end — the old buffered-then-cat approach made per-file
# timings unreadable after the fact.
#
# PIPESTATUS[0], not $?. A pipeline reports the status of its LAST command, so
# without this a red type check reads as a green gate. `pipefail` is set above
# and would also cover it; both are here because this is the one exit code in
# the repo that must not be wrong.
echo "==> svelte-check"
npm run gate:check:only 2>&1 | tee "$LOG"
EC=${PIPESTATUS[0]}

if ! grep -qE 'svelte-check found|COMPLETED [0-9]+ FILES' "$LOG"; then
  echo "ERROR: svelte-check printed no summary line — it did not run to completion." >&2
  EC=1
fi

if [ "$EC" -ne 0 ]; then
  echo "==> TYPE CHECK FAILED (exit ${EC})" >&2
  exit 1
fi

echo "==> type check passed"
