#!/usr/bin/env bash
# One deterministic local pre-PR check. It supplies the public build variable
# SvelteKit needs, gives svelte-check enough heap, and tests only the current
# branch's change set unless the risk classifier requires the full suite.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VALIDATION_DB=''
VALIDATION_INDEX=''
cleanup() {
  if [ -n "$VALIDATION_DB" ]; then
    docker rm -f "$VALIDATION_DB" >/dev/null 2>&1 || true
  fi
  if [ -n "$VALIDATION_INDEX" ]; then rm -f "$VALIDATION_INDEX"; fi
}
trap cleanup EXIT INT TERM

BASE="${1:-origin/master}"
git merge-base "$BASE" HEAD >/dev/null 2>&1 || {
  echo "Cannot resolve merge base against $BASE. Fetch it or pass an explicit base." >&2
  exit 2
}

# Make untracked files visible to the classifiers without touching the user's
# real index. Plain `git diff` sees tracked working-tree edits but not new files;
# a temporary index gives it the complete proposed tree and is removed on exit.
VALIDATION_INDEX="$(mktemp)"
export GIT_INDEX_FILE="$VALIDATION_INDEX"
git read-tree HEAD
git add -A

export PUBLIC_VAPID_PUBLIC_KEY="${PUBLIC_VAPID_PUBLIC_KEY:-local-validation-placeholder}"
export SCRAPER_ALLOW_NON_HOMESERV=1
export TZ=UTC

echo "==> Structural gates"
npm run gate:public-routes
npm run gate:font-sizes
npm run gate:measure
npm run gate:schema-imports
npm run gate:boundaries

LEVEL="$(./scripts/gate-level.sh "$BASE" | sed -n 's/^level=//p' | head -1)"
echo "==> Change level: ${LEVEL:-L3}"

if [ "$LEVEL" = 'L1' ]; then
  echo "==> Documentation-only change: structural gates are sufficient."
  exit 0
fi

./scripts/gate-check.sh

# The merge gate starts an isolated Postgres for every test shard. Mirror that
# locally when no explicit test database was supplied; falling through to a
# half-configured .env produces dozens of misleading credential/query failures.
if [ -z "${DATABASE_URL:-}" ]; then
  command -v docker >/dev/null 2>&1 || {
    echo 'DATABASE_URL is unset and Docker is unavailable; cannot run database-backed tests.' >&2
    exit 2
  }
  VALIDATION_DB="sr-validation-$$-$RANDOM"
  echo "==> Starting isolated validation database"
  docker run --detach --rm --name "$VALIDATION_DB" \
    -e POSTGRES_USER=app \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=strange_rambling \
    -p 127.0.0.1::5432 \
    pgvector/pgvector:pg16 >/dev/null
  DB_PORT="$(docker port "$VALIDATION_DB" 5432/tcp | head -1 | sed 's/.*://')"
  [ -n "$DB_PORT" ] || { echo 'Docker did not publish the validation database port.' >&2; exit 2; }
  export DATABASE_URL="postgresql://app:test@127.0.0.1:${DB_PORT}/strange_rambling"
  export INTEGRATION_CREDENTIALS_KEY='00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'
  for attempt in $(seq 1 60); do
    if psql "$DATABASE_URL" -c 'select 1' >/dev/null 2>&1; then break; fi
    [ "$attempt" -lt 60 ] || { echo 'Validation database did not become ready.' >&2; exit 2; }
    sleep 1
  done
  psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null
  CI=1 FORCE_COLOR=0 npx drizzle-kit push --config=drizzle.config.ts --force >/dev/null
fi

if [ "$LEVEL" = 'L2' ]; then
  ./scripts/gate-test-scoped.sh "$BASE"
else
  npm run gate:test
fi

echo "==> Local validation passed. The production build remains CI's single responsibility."
