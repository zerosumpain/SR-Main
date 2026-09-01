#!/usr/bin/env bash
# Run the test suite scoped to what the change set can reach, falling back to
# the whole suite whenever the selector is not certain.
#
# Only used at gate level L2. See scripts/select-tests.mjs for how the selection
# is computed and why `vitest --changed` is not used (it forces passWithNoTests
# to true and fails OPEN — a bad base ref yields a green run that executed
# nothing).
#
# The contract with the selector is deliberately narrow: it prints `mode=full`
# or `mode=selected` and then one path per line, and it exits 0 whenever it
# produced a usable answer. This script reads the MODE, never the exit status,
# and treats anything it does not understand as "run everything".
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Local branches must compare with the merge base of origin/master. HEAD^ only
# describes the last commit, so a multi-commit branch can accidentally retest
# earlier work or miss files from the current change set. CI passes HEAD^
# explicitly because its pull_request checkout is GitHub's synthetic merge
# commit, whose first parent is exactly the base tip.
if [ -n "${1:-}" ]; then
  BASE="$1"
elif git rev-parse --verify origin/master >/dev/null 2>&1; then
  BASE=origin/master
else
  BASE=HEAD^
fi
OUT="$(node scripts/select-tests.mjs "$BASE" 2>&1)"
SELECTOR_EC=$?

MODE="$(printf '%s\n' "$OUT" | sed -n 's/^mode=//p' | head -1)"
REASON="$(printf '%s\n' "$OUT" | sed -n 's/^reason=//p' | head -1)"

if [ "$SELECTOR_EC" -ne 0 ] || [ -z "$MODE" ]; then
  echo "==> selector did not produce a usable answer (exit ${SELECTOR_EC}) — running the whole suite"
  printf '%s\n' "$OUT" | head -20
  exec npm run gate:test
fi

if [ "$MODE" != "selected" ]; then
  echo "==> full suite: ${REASON}"
  exec npm run gate:test
fi

# One path per line, after the two header lines.
mapfile -t FILES < <(printf '%s\n' "$OUT" | tail -n +3 | grep -v '^$')

# Belt and braces. The selector already refuses to emit an empty selection, but
# an empty list reaching vitest with passWithNoTests would be a green run that
# tested nothing — the exact failure this whole design exists to avoid.
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "==> selector reported 'selected' but emitted no files — running the whole suite" >&2
  exec npm run gate:test
fi

echo "==> scoped run: ${REASON}"
printf '    %s\n' "${FILES[@]}" | head -12
[ "${#FILES[@]}" -gt 12 ] && echo "    … and $(( ${#FILES[@]} - 12 )) more"

# --passWithNoTests=false is not decoration: it is the assertion that these files
# actually contained tests.
NODE_OPTIONS=--max-old-space-size=4096 exec npx vitest run \
  --exclude '**/node_modules/**' \
  --passWithNoTests=false \
  "${FILES[@]}"
