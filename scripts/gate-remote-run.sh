#!/usr/bin/env bash
# The porkserv half of the gate lane. Driven by scripts/gate-remote.sh on
# homeserv, which rsyncs the tree here and invokes this file under flock.
#
# Do not run this by hand expecting it to gate your homeserv checkout — it gates
# whatever is currently sitting in the workspace, which is whatever the last
# rsync put there.
#
# Everything it prepares is stamped, so a run that changed neither the lockfile
# nor the schema goes straight to the gate. Cold, `npm ci` is the bulk of the
# time (CI's prebuild on this same box measures 3m14s cold).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

STAMPS="$(dirname "$ROOT")/stamps"
mkdir -p "$STAMPS"

# The CI-shaped environment, assembled here rather than shipped from homeserv.
#
# SCRAPER_ALLOW_NON_HOMESERV IS LOAD-BEARING ON THIS BOX. stealth-scrape refuses
# to run anywhere but homeserv — a datacenter IP defeats the point of stealth
# scraping — so without the flag its tests fail here for a reason that has
# nothing to do with the change being gated. The tests mock `runScrape`, so
# nothing is actually scraped; the flag only stops the host guard
# short-circuiting before the mock is reached. ci.yml sets it for exactly the
# same reason.
export DATABASE_URL="${DATABASE_URL:-postgresql://app:test@localhost:5432/strange_rambling}"
export SCRAPER_ALLOW_NON_HOMESERV=1
export PUBLIC_VAPID_PUBLIC_KEY="${PUBLIC_VAPID_PUBLIC_KEY:-ci-gate-placeholder}"

# TZ=UTC IS LOAD-BEARING. porkserv's system clock is Europe/London; homeserv and
# GitHub's runners are both UTC. Date handling that is correct in UTC is not
# automatically correct in BST, and the suite contains assertions that pin a
# calendar DATE: an all-day event on 2026-09-23 parses to 2026-09-22T23:00:00Z
# under BST, and apple-calendar.test.ts asserts /^2026-09-23/. Two tests failed
# on this box for that reason alone on the lane's first run.
#
# Pinning to UTC makes this lane agree with CI and with homeserv, which is the
# only useful definition of a gate: it must fail for reasons that belong to the
# change, not to the machine. (The underlying tests are TZ-fragile and would be
# better written against a fixed zone, but that is a separate change and they
# are not wrong in any environment that actually runs them.)
export TZ=UTC

echo "==> workspace: ${ROOT}"
echo "==> node $(node --version), npm $(npm --version)"

# ── git ─────────────────────────────────────────────────────────────
# The tree arrives WITHOUT .git (a worktree's .git is a file holding an absolute
# path back into homeserv's checkout, so copying it makes a broken repo). But the
# suite is not entirely git-free: tests/lib/config/owner.test.ts enumerates the
# source tree with
#
#   git ls-files --cached --others --exclude-standard src packages
#
# to prove the owner's phone number appears in no non-test source file. Without a
# repo that test dies with "fatal: not a git repository" — a security guard
# reporting an environment fault, which is the worst kind of red.
#
# So the workspace becomes its own throwaway repo. `git add -A` reindexes every
# run so the listing matches the tree that was just rsynced; .gitignore came
# across with it, so --exclude-standard still hides node_modules and build
# output. No commit is ever made, so no git identity is needed.
if [ ! -d .git ]; then
  echo "==> initialising the workspace repo (for git ls-files in the suite)"
  git init -q . || { echo "ERROR: git init failed." >&2; exit 1; }
fi
if ! git add -A 2>/dev/null; then
  echo "ERROR: git add -A failed — owner.test.ts would report a false positive." >&2
  exit 1
fi

# ── dependencies ─────────────────────────────────────────────────────────────
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ ! -d node_modules ] || [ "$(cat "$STAMPS/npm-ci" 2>/dev/null)" != "$LOCK_HASH" ]; then
  echo "==> package-lock.json changed (or no node_modules) — npm ci"
  if ! npm ci; then
    echo "ERROR: npm ci failed — not running the gate against a half-installed tree." >&2
    exit 1
  fi
  echo "$LOCK_HASH" > "$STAMPS/npm-ci"
else
  echo "==> node_modules matches package-lock.json — skipping npm ci"
fi

# ── database ─────────────────────────────────────────────────────────────────
# Poll a real query rather than pg_isready. The postgres image runs a TEMPORARY
# server during initdb so init scripts can run; pg_isready succeeds against that
# one, it is then shut down and restarted for real, and any client connected in
# the gap is dropped. This turned master red once already — see the note in
# ci.yml's "Wait for Postgres" step.
echo "==> waiting for Postgres"
PG_UP=0
for i in $(seq 1 90); do
  if psql "$DATABASE_URL" -c 'select 1' >/dev/null 2>&1; then
    echo "==> postgres accepting queries after ${i}s"
    PG_UP=1
    break
  fi
  sleep 1
done
if [ "$PG_UP" -ne 1 ]; then
  echo "ERROR: Postgres did not accept a query within 90s." >&2
  echo "  systemctl status gate-postgres ; docker logs gate-postgres | tail -40" >&2
  exit 1
fi

SCHEMA_HASH="$(sha256sum src/lib/db/schema.ts | cut -d' ' -f1)"
if [ "$(cat "$STAMPS/schema" 2>/dev/null)" != "$SCHEMA_HASH" ]; then
  echo "==> schema.ts changed — pushing it to the gate database"
  psql "$DATABASE_URL" -c 'CREATE EXTENSION IF NOT EXISTS vector;' >/dev/null || exit 1
  # CI=1 and --force are both required: a column rename opens an interactive
  # prompt, and this runs under `ssh -n` with no TTY to answer it, so a
  # promptable push would hang until the flock timeout rather than fail.
  if ! CI=1 FORCE_COLOR=0 npx drizzle-kit push --config=drizzle.config.ts --force; then
    echo "ERROR: drizzle-kit push failed — the gate database does not match schema.ts." >&2
    exit 1
  fi
  echo "$SCHEMA_HASH" > "$STAMPS/schema"
else
  echo "==> gate database already matches schema.ts"
fi

# ── the gate ─────────────────────────────────────────────────────────────────
# GATE_TEST_MAX_WORKERS is deliberately left UNSET. gate-concurrent.sh warns that
# the two halves' memory ceilings add — vitest sizes its pool at (cores - 1) and
# every worker inherits the 4GB NODE_OPTIONS heap — which on the autonomous
# builder's 7GB cgroup produced 1,026 ceiling hits and a worker that died mid
# string with `No such built-in module: node:`. Here that arithmetic is 3 workers
# x 4GB alongside svelte-check's 8GB, about 20GB against 62GB of RAM. This is the
# box where unbounded is finally the correct setting.
echo "==> running the gate"
./scripts/gate-concurrent.sh
GATE_EC=$?

if [ "$GATE_EC" -ne 0 ]; then
  exit "$GATE_EC"
fi

# ── the build, on request ────────────────────────────────────────────────────
# The REAL adapter, not SR_GATE_STUB_ADAPTER. That flag is a CI-gate-only
# shortcut that swaps adapter-node for a no-op to save ~93s, and it must never be
# set where the output is inspected. Building for real here is worth having:
# on homeserv the packaging step dies under the Bash sandbox with "Could not
# resolve entry module .svelte-kit/adapter-node/index.js", so this lane is the
# one place a full adapter-node build can be proved outside CI.
if [ "${GATE_WITH_BUILD:-0}" = "1" ]; then
  echo "==> building (real adapter-node)"
  if ! npm run gate:build; then
    echo "==> BUILD FAILED" >&2
    exit 1
  fi
  [ -f build/handler.js ] || {
    echo "ERROR: build/handler.js missing — the adapter did not package a server bundle." >&2
    exit 1
  }
  echo "==> build ok ($(du -sh build | cut -f1))"
fi
