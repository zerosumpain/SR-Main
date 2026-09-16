#!/usr/bin/env bash
# Put a staged release live. Runs in the `release` job, which DOES depend on the
# gate — this is the first thing in the pipeline that touches production.
#
# Split out of the old ci-deploy.sh, which built and shipped in one job that
# waited on the gate. Only the last ~20s of that job actually touched
# production; the rest was work nobody was waiting on. scripts/ci-prebuild.sh
# now does that part in parallel with the gate, and this script does the ship.
#
# The other reason for the split is a correctness bug the old shape had. It
# rsynced over the live build/ directory and only restarted the service ~15s
# later, so for those 15 seconds the running process served requests against
# newly-replaced content-hashed chunk files. The server manifest holds hundreds
# of lazily-imported hashed chunks, so any cold route in that window could 500.
#
# Releases are now directories and build/ is a symlink to one. Node resolves
# module specifiers to their realpath (--preserve-symlinks is off by default),
# so a process that started against releases/A keeps reading releases/A even
# after the symlink points at releases/B — verified empirically, not assumed.
# The swap is therefore invisible to the running process, and the only
# transition is the restart itself.
#
# Expects: cwd = repo root, scripts/ci-prebuild.sh already staged this sha.
set -euo pipefail

# Extracted applications still depend on declarations reconciled by Main.
node scripts/check-extracted-schema.mjs

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SERVICE="${SERVICE:-strange-rambling-svelte}"
PUBLIC_URL="${PUBLIC_URL:-https://strangeramblings.com}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
PUBLIC_BASE="${PUBLIC_URL%/}"

# Authored handlers require OS namespaces; fail before switching production.
./scripts/check-authored-runner.sh

SHA="$(git rev-parse HEAD)"
RELEASE_DIR="$VPS_DIR/releases/$SHA"
STATE_DIR="$VPS_DIR/.deploy-state"
mkdir -p "$STATE_DIR"

# A RELEASE IN FLIGHT, stated as a fact rather than guessed from a process list.
#
# scripts/rollback.sh must refuse while this is running: two processes moving the
# symlink at once serves a release nobody chose, and this job would overwrite the
# rollback seconds later while reporting success. That check used to be
# `pgrep -f ci-release.sh`, which matches any command line that MENTIONS the
# script — a grep, an editor, a log tail, a shell that happens to have the name
# in its history. A PID file says what is actually true.
RELEASE_PID_FILE="$STATE_DIR/release.pid"
echo $$ > "$RELEASE_PID_FILE"
trap 'rm -f "$RELEASE_PID_FILE"' EXIT

# Declared here, not where it is first assigned: under `set -u` the final report
# below reads it on every path, including the one where production never moved.
FAILED_POSTLIVE=""

# A CANCELLED RELEASE ABANDONS PRODUCTION MID-MUTATION.
#
# The job has a timeout and a human can press cancel; either sends a signal, the
# shell dies wherever it happens to be, and nothing says whether the symlink had
# already moved. Print the state and the exact way back, to the log that
# operator is already looking at.
on_interrupt() {
  echo "" >&2
  echo "==> INTERRUPTED. Production may be mid-release." >&2
  echo "    build/ currently points at: $(readlink "$VPS_DIR/build" 2>/dev/null || echo '<unknown>')" >&2
  echo "    intended release:           $SHA" >&2
  echo "    previous release:           ${PREV_SHA:-<unknown>}" >&2
  echo "" >&2
  echo "    To restore the previous release:" >&2
  echo "      $VPS_DIR/scripts/rollback.sh ${PREV_SHA:-<sha>}" >&2
  exit 130
}
trap on_interrupt INT TERM

public_sha() {
  local body
  body="$(curl -fsS -H 'Cache-Control: no-cache' "$PUBLIC_BASE/api/version?expected=$1" 2>/dev/null)" || return 1
  printf '%s' "$body" | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

wait_for_public_release() {
  local expected="$1"
  local timeout_seconds="$2"
  local deadline actual
  deadline=$(( $(date +%s) + timeout_seconds ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    actual="$(public_sha "$expected" || true)"
    if [ "$actual" = "$expected" ] && curl -fsS -o /dev/null -H 'Cache-Control: no-cache' "$PUBLIC_BASE/"; then
      return 0
    fi
    if [ -n "$actual" ]; then
      echo "    waiting: public /api/version reports $actual, expected $expected"
    fi
    sleep 3
  done
  return 1
}

rollback_web_release() {
  # REFUSE TO "ROLL BACK" TO THE COMMIT THAT IS FAILING.
  #
  # PREV_SHA is read from build/.deploy-sha, i.e. whatever the symlink points at
  # when this script starts. On a RE-RUN of a failed release that is already the
  # new commit — the previous attempt moved the symlink before failing. So this
  # function would point the symlink at the failing release, restart, watch
  # /api/version report the sha it was asked for, and print "Rollback verified".
  # A green rollback message while production serves the broken commit is worse
  # than no rollback at all, because it ends the investigation.
  if [ "$PREV_SHA" = "$SHA" ]; then
    echo "==> Automatic rollback unavailable: the previously-deployed sha IS this one ($SHA)." >&2
    echo "    This is a re-run; an earlier attempt already moved the symlink." >&2
    echo "    Roll back deliberately:  $VPS_DIR/scripts/rollback.sh --list" >&2
    return 1
  fi
  if [ -z "$PREV_SHA" ] || [ ! -d "$VPS_DIR/releases/$PREV_SHA" ]; then
    echo "==> Automatic rollback unavailable: previous release ${PREV_SHA:-<none>} is not present." >&2
    echo "    Available:  $VPS_DIR/scripts/rollback.sh --list" >&2
    return 1
  fi

  echo "==> Rolling web release back to $PREV_SHA..." >&2
  ln -sfn "releases/$PREV_SHA" "$VPS_DIR/build.rollback"
  mv -Tf "$VPS_DIR/build.rollback" "$VPS_DIR/build"
  sudo systemctl restart "$SERVICE"

  if wait_for_public_release "$PREV_SHA" 60; then
    echo "==> Rollback verified: public /api/version reports $PREV_SHA" >&2
    return 0
  fi
  echo "==> ERROR: rollback restart did not restore $PREV_SHA publicly within 60s." >&2
  return 1
}

[ -d "$RELEASE_DIR" ] || { echo "no staged release at $RELEASE_DIR — prebuild did not run or did not finish" >&2; exit 1; }
[ -f "$RELEASE_DIR/handler.js" ] || { echo "staged release has no handler.js" >&2; exit 1; }

# Owner-triggered hero preparation requires the same tools as video extraction.
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends ffmpeg
fi

# Read what is serving now BEFORE the swap. This is the release log's "what did
# this replace" boundary. Empty on the first run of this script.
PREV_SHA="$(sed -n 's/^sha=//p' "$VPS_DIR/build/.deploy-sha" 2>/dev/null | head -1 || true)"

# ...unless the symlink already points at THIS commit, which means a previous
# attempt at this same release got as far as the flip and then failed. In that
# case build/.deploy-sha is not evidence of what to go back to, and
# $STATE_DIR/previous.sha — written just before the flip below, and by
# rollback.sh — is. Without this, a re-run has no true previous release and the
# rollback path silently becomes a no-op that reports success.
if [ -n "$PREV_SHA" ] && [ "$PREV_SHA" = "$SHA" ]; then
  RECORDED_PREV="$(cat "$STATE_DIR/previous.sha" 2>/dev/null || true)"
  if [ -n "$RECORDED_PREV" ] && [ "$RECORDED_PREV" != "$SHA" ]; then
    echo "==> build/ already points at $SHA (this is a re-run); taking the previous sha from the deploy state instead."
    PREV_SHA="$RECORDED_PREV"
  fi
fi
echo "==> Previously deployed sha: ${PREV_SHA:-<none>}"

echo "==> Placing package manifests..."
# npm ci must receive the configuration used to generate the lockfile. In
# particular, Auth.js's optional peer range currently stops at Nodemailer 8
# while the adapter is API-compatible with the patched Nodemailer 9 release.
rsync -a package.json package-lock.json .npmrc "$VPS_DIR/"

# The production .env is intentionally immutable in the deployment runner's
# mount namespace after a historical overwrite incident. ci-webframe.sh installs
# a systemd UnsetEnvironment drop-in instead, so a stale AUTH_BYPASS entry can
# never reach this service; current application code also ignores it.

# NOTE: no --delete. The VPS's data/jkai-projects/ holds pages published at
# runtime by publish_page that do not exist in git; --delete would erase them.
echo "==> Placing data files (additive)..."
rsync -a data/ "$VPS_DIR/data/"

echo "==> Placing runtime-read sources..."
mkdir -p "$VPS_DIR/src/lib/db" "$VPS_DIR/src/lib/constants" \
         "$VPS_DIR/src/lib/workflows/scraper/python" "$VPS_DIR/src/lib/styles" \
         "$VPS_DIR/scripts"
rsync -a src/lib/db/schema.ts "$VPS_DIR/src/lib/db/"
rsync -a drizzle.config.ts "$VPS_DIR/"
rsync -a src/app.css "$VPS_DIR/src/" 2>/dev/null || true
rsync -a src/lib/styles/ "$VPS_DIR/src/lib/styles/" 2>/dev/null || true
rsync -a src/lib/workflows/scraper/python/ "$VPS_DIR/src/lib/workflows/scraper/python/"
rsync -a scripts/server-with-ws.mjs "$VPS_DIR/scripts/"
# The build smoke harness. `runStaticSmoke` shells out to this by path, and it
# must live inside the repo — `import('playwright')` resolves from the script's
# own directory. Shipped in #144 without this line, so the check reported
# "skipped — playwright is not available" on every production build while CI
# stayed green: the feature degrades silently by design, which is right for a
# missing browser and wrong for a missing file.
rsync -a scripts/smoke-static-app.mjs "$VPS_DIR/scripts/"
# Same reasoning, same failure mode, for the Studio gate: runStudioGate shells
# out to this by path, and without this line the gate is silently absent in
# production — it reports { ran: false } forever and every studio build sails
# through unchecked, with nothing to indicate the check never ran.
rsync -a scripts/studio-gate.mjs "$VPS_DIR/scripts/"
# The agent's own copy of that check, which it runs by hand via bash between
# edits. Same allow-list trap: absent here, the command named in the studio
# system prompt simply does not exist on the VPS, and the agent goes back to
# working blind — which is the condition this whole change set exists to end.
rsync -a scripts/studio-verify.mjs "$VPS_DIR/scripts/"
# The design review's capture half. It IMPORTS studio-gate.mjs (for
# injectBaseHref), so this line and the studio-gate one above are a pair —
# shipping this without that one makes the import throw at load and the stage
# reports { ran: false } forever, which is the same silent-absence trap again.
rsync -a scripts/studio-shots.mjs "$VPS_DIR/scripts/"
rsync -a scripts/studio-image.mjs "$VPS_DIR/scripts/"
rsync -a scripts/studio-research.mjs "$VPS_DIR/scripts/"
# The build-history graph's pull channel. The agent is told in REPO_SYSTEM_PROMPT
# to run this by path, so the same allow-list trap applies exactly as above:
# without this line the command named in the prompt does not exist on the VPS,
# every invocation fails, and the agent falls back to rediscovering by hand —
# the 10.5-discovery-actions-per-iteration behaviour this change set exists to
# reduce. Nothing else would report the absence.
# The rollback path. It is only useful if it is ON THE BOX before it is needed,
# and this rsync line is the only thing that puts it there — a script without
# one silently does not exist in production, which has caught this repo before.
# It ships every release so that the copy sitting next to a bad deploy is the
# one written to roll that deploy back.
rsync -a scripts/rollback.sh "$VPS_DIR/scripts/"

rsync -a scripts/codegraph-query.mjs "$VPS_DIR/scripts/"
rsync -a scripts/codegraph-tree-pass.mjs "$VPS_DIR/scripts/"
mkdir -p "$VPS_DIR/scripts/lib"
rsync -a scripts/lib/codegraph-snapshot.mjs scripts/lib/codegraph-scip.mjs "$VPS_DIR/scripts/lib/"

# Production deps only when the lockfile actually changed. Measured: 26% of
# commits change it. The hash is kept by us rather than read back out of
# node_modules — npm's own installed-tree metadata is not in a shape that can be
# compared against a lockfile, and a guard that silently never matches is worse
# than no guard. Recorded only AFTER a clean install, so a failure retries.
#
# INSTALLED BESIDE THE LIVE TREE, NOT THROUGH IT.
#
# `npm ci` begins by DELETING node_modules. This runs before the symlink flip,
# so for the ~17s it takes, the PREVIOUS release — still live, still serving the
# public — has no module tree underneath it. Node resolves a chunk's imports by
# walking up from its realpath to $VPS_DIR/node_modules, and the server manifest
# holds 545 lazily-imported route chunks, so any cold route in that window can
# 500. It is the same class of fault the releases/ symlink was introduced to
# fix, left behind in the dependency tree.
#
# So the install goes to a staging directory and is swapped in right after the
# flip, two renames apart rather than seventeen seconds. The old tree is kept as
# node_modules.old until the prune, which makes the swap trivially reversible.
echo "==> Production deps..."
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
NPM_STAGED=""
if [ "$(cat "$STATE_DIR/lockfile.sha256" 2>/dev/null || true)" = "$LOCK_HASH" ]; then
  echo "    lockfile unchanged — skipping install"
else
  # A staged tree costs a second copy of node_modules (~1.4G). The box has run
  # out of disk four times and that crash-loops Postgres, so check rather than
  # assume, and fall back to the old in-place install rather than failing the
  # deploy over it.
  AVAIL_GB="$(df -BG --output=avail "$VPS_DIR" | tail -1 | tr -dc '0-9')"
  if [ "${AVAIL_GB:-0}" -ge 6 ]; then
    echo "    staging into .npm-next (${AVAIL_GB}G free)"
    rm -rf "$VPS_DIR/.npm-next"
    mkdir -p "$VPS_DIR/.npm-next"
    cp package.json package-lock.json .npmrc "$VPS_DIR/.npm-next/"
    # Keep resolver diagnostics visible. A production-only peer conflict used to
    # collapse into a bare exit code here, after every earlier gate was green.
    ( cd "$VPS_DIR/.npm-next" && npm ci --omit=dev --no-audit --no-fund )
    NPM_STAGED=1
    echo "    staged"
  else
    echo "::warning::only ${AVAIL_GB:-?}G free — installing in place, which leaves the live release without node_modules for ~17s"
    ( cd "$VPS_DIR" && npm ci --omit=dev --no-audit --no-fund )
    echo "$LOCK_HASH" > "$STATE_DIR/lockfile.sha256"
    echo "    installed in place"
  fi
fi

# Same shape for the schema. Measured: 7 of 140 master commits touch schema.ts.
# This is the one guard that genuinely trades reconciliation for time — if the
# database drifts by some route other than a schema.ts commit, nothing here will
# notice. Bounded by only recording the hash after a clean push. If that
# exposure is ever unwelcome, add a weekly unconditional push rather than
# dropping the guard.
echo "==> Applying DB schema..."
SCHEMA_HASH="$(sha256sum src/lib/db/schema.ts | cut -d' ' -f1)"
if [ "$(cat "$STATE_DIR/schema.sha256" 2>/dev/null || true)" = "$SCHEMA_HASH" ]; then
  echo "    schema.ts unchanged — skipping drizzle push"
else
  DRIZZLE_TIMEOUT="${DRIZZLE_TIMEOUT:-180}"
  DRIZZLE_LOG="$(mktemp)"
  (
    cd "$VPS_DIR"
    if [ ! -x node_modules/.bin/drizzle-kit ]; then
      npm install --no-save --silent drizzle-kit@^0.31.10
    fi
    set -a; . ./.env; set +a
    set +e
    CI=1 FORCE_COLOR=0 timeout "${DRIZZLE_TIMEOUT}s" stdbuf -oL -eL \
      node_modules/.bin/drizzle-kit push --config=drizzle.config.ts --force 2>&1 \
      | tee "$DRIZZLE_LOG"
    ec="${PIPESTATUS[0]}"
    set -e
    if [ "$ec" -eq 124 ]; then
      echo "==> drizzle-kit timed out after ${DRIZZLE_TIMEOUT}s — destructive change awaiting confirmation? Run manually." >&2
      exit 1
    fi
    exit "$ec"
  )
  # ---------------------------------------------------------------------------
  # DRIZZLE-KIT'S EXIT CODE IS NOT EVIDENCE. Check what it SAID.
  #
  # On 2026-08-30 a push failed with
  #
  #   Error: Interactive prompts require a TTY terminal
  #       at promptColumnsConflicts
  #
  # and **exited 0**. `--force` covers data loss, not rename disambiguation: the
  # commit dropped a column and added one on the same table, so drizzle-kit
  # wanted a human to say whether that was a rename. With `set -e` active the
  # script sailed straight past, stamped the hash below, and the release went
  # green — while the schema had not moved at all.
  #
  # Two things then compound it. The deployed code was already selecting the new
  # column, so retrieval 500'd against a database that never got it. And the
  # stamp meant the NEXT deploy would report "schema.ts unchanged — skipping
  # drizzle push" and never try again: a one-off failure turned permanent.
  #
  # The comment above this block has always claimed the guard is "bounded by
  # only recording the hash after a clean push". This is what makes that true.
  # ---------------------------------------------------------------------------
  #
  # 2026-09-09 added `^error:` to the list. drizzle-kit planned to drop a composite
  # primary key AFTER re-adding the foreign keys that depend on it, Postgres
  # refused with
  #
  #   error: cannot drop constraint policy_artefacts_analysis_id_id_pk ...
  #
  # and drizzle-kit **exited 0** again. `error: could not` did not match it, so a
  # 146-statement schema push would have been recorded as applied when none of it
  # was. The pattern is now the whole family, not one wording of it.
  if grep -qiE '^Error:|^error:|Interactive prompts require a TTY|Please run|error: could not' "$DRIZZLE_LOG"; then
    echo "==> drizzle-kit push REPORTED AN ERROR while exiting 0 — schema was NOT applied:" >&2
    grep -iE '^Error:|^error:|Interactive prompts require a TTY|Please run|error: could not' "$DRIZZLE_LOG" | head -5 >&2
    echo "==> Apply it by hand on the VPS, then stamp $STATE_DIR/schema.sha256." >&2
    echo "==> A drop + an add on ONE table reads as a rename and needs a TTY; split them across two deploys or run push interactively." >&2
    rm -f "$DRIZZLE_LOG"
    exit 1
  fi
  rm -f "$DRIZZLE_LOG"
  echo "$SCHEMA_HASH" > "$STATE_DIR/schema.sha256"
fi

# Only the part the restarting web app reads — the broker URL and token, via a
# systemd drop-in. A second or two. The expensive half (source install, container
# lifecycle, tunnel reconciliation, executor preflight, prune) is ~50s and runs
# after the flip, because production does not depend on the sandbox being ready
# and should not wait for it.
./scripts/ci-development.sh pre

# Preserve legacy conclusions before the new investigation lifecycle starts.
# Stamp only committed data; a failed migration leaves the current app running.
DAYDREAM_MIGRATION="$(pwd)/scripts/migrations/2026-09-06-daydream-investigations.sql"
DAYDREAM_MIGRATION_HASH="$(sha256sum "$DAYDREAM_MIGRATION" | awk '{print $1}')"
if [ "$(cat "$STATE_DIR/daydream-investigations.sha256" 2>/dev/null || true)" != "$DAYDREAM_MIGRATION_HASH" ]; then
  echo "==> Migrating daydream investigation history..."
  (
    cd "$VPS_DIR"
    set -a; . ./.env; set +a
    timeout 120s node --input-type=module - "$DAYDREAM_MIGRATION" <<'NODE'
import pg from 'pg';
import { readFile } from 'node:fs/promises';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '90s'");
  await client.query(await readFile(process.argv[2], 'utf8'));
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
NODE
  )
  echo "$DAYDREAM_MIGRATION_HASH" > "$STATE_DIR/daydream-investigations.sha256"
fi

echo "==> Ensuring service entrypoint + support dirs..."
sudo sed -i "s|ExecStart=.*index.js|ExecStart=/usr/bin/node $VPS_DIR/scripts/server-with-ws.mjs|" \
  "/etc/systemd/system/$SERVICE.service"
sudo systemctl daemon-reload
sudo mkdir -p /opt/strange-rambling/static/images/blog
sudo chown "$(id -un):$(id -gn)" /opt/strange-rambling/static/images/blog
mkdir -p ~/.openclaw/workflow-files && chmod 700 ~/.openclaw/workflow-files

# An extracted application's envelopes retain their leases; its own worker keeps
# running across this restart and recovers them. Pausing one here would prevent
# that continuation, and would have Main writing to a row another process owns.
echo "==> Draining in-flight runs (running -> paused) before restart..."
# The excluded lanes come from scripts/external-queue-triggers.txt rather than a
# literal, so an extraction adds its lane in one place instead of here, in
# deploy.sh, and in the TypeScript queue separately.
source ./scripts/lib/queue-triggers.sh
queue_triggers_clause ./scripts/external-queue-triggers.txt
PG_CTR=$(docker ps --filter "name=strange-rambling-app-db" --format '{{.Names}}' | head -1 || true)
if [ -n "$PG_CTR" ]; then
  docker exec "$PG_CTR" psql -U app -d strange_rambling \
    -c "UPDATE workflow_runs SET status='paused' WHERE status='running' $QUEUE_MINE_SQL;" || true
else
  echo "==> drain skipped (no app-db container)"
fi

# One-off conversion, the first time this script runs against a VPS where build/
# is still a real directory. The running process resolved its module paths into
# that directory, so between the rename and the restart a lazy chunk import
# would find nothing — the two steps are therefore adjacent and the restart
# follows immediately. The old directory is kept, not deleted, so a manual
# rollback is a rename away.
if [ ! -L "$VPS_DIR/build" ]; then
  LEGACY="$VPS_DIR/build.legacy.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "==> First release under the symlink layout — moving the existing build/ to $LEGACY"
  mv "$VPS_DIR/build" "$LEGACY"
fi

# Written BEFORE the flip, because after it build/.deploy-sha no longer knows
# what came before. This is what a re-run and scripts/rollback.sh read.
[ -n "$PREV_SHA" ] && echo "$PREV_SHA" > "$STATE_DIR/previous.sha"

echo "==> Pointing build/ at releases/$SHA..."
ln -sfn "releases/$SHA" "$VPS_DIR/build.tmp"
mv -Tf "$VPS_DIR/build.tmp" "$VPS_DIR/build"
echo "    build -> $(readlink "$VPS_DIR/build")"

# The moment production changed. Everything after this point is happening while
# the new code is already serving the public, which is what makes a failure
# below categorically different from a failure above it.
echo "$SHA" > "$STATE_DIR/live.sha"

# The dependency half of the swap, here rather than earlier so the previous
# release never ran without a module tree. Two renames: the gap is microseconds,
# and the restart immediately below means the new process reads the new tree.
if [ -n "$NPM_STAGED" ]; then
  echo "==> Swapping in the staged node_modules..."
  rm -rf "$VPS_DIR/node_modules.old"
  [ -d "$VPS_DIR/node_modules" ] && mv -T "$VPS_DIR/node_modules" "$VPS_DIR/node_modules.old"
  mv -T "$VPS_DIR/.npm-next/node_modules" "$VPS_DIR/node_modules"
  rm -rf "$VPS_DIR/.npm-next"
  # Recorded only now, so an interrupted deploy reinstalls rather than believing
  # a tree it never swapped in.
  echo "$LOCK_HASH" > "$STATE_DIR/lockfile.sha256"
fi

# Restarts ONLY the web app. The jkai-builder sidecar owns build-orchestrator
# state and must survive web restarts — only scripts/deploy-builder.sh touches it.
echo "==> Restarting $SERVICE (builder is unaffected)..."
sudo systemctl restart "$SERVICE"

echo "==> Verifying against the PUBLIC url (not localhost — Caddy/cloudflared and"
echo "    the static cache come up on different timelines than the node process)..."
echo "    requiring /api/version to report the exact candidate sha: $SHA"
if wait_for_public_release "$SHA" 90; then
  echo "==> Deployed exact commit successfully to $PUBLIC_URL"
  echo "    $(curl -fsS -o /dev/null -w 'HTTP %{http_code} in %{time_total}s' "$PUBLIC_URL")"

  # ── EVERYTHING BELOW HAPPENS WITH THE NEW CODE ALREADY SERVING ─────────
  #
  # That makes a failure here categorically different from a failure above,
  # and until 2026-09-16 the script could not tell you which you had. `set -e`
  # killed it on the first post-live failure: production had moved, no rollback
  # ran, /releases had no record of the commit that was live, and the red badge
  # in the Actions tab looked exactly like a release that never touched the box
  # at all. Observed in run 34773827353.
  #
  # So these steps record a marker and carry on, and the script exits at the end
  # with a message that says production DID move. Rolling back automatically
  # would be wrong: the site is serving the new commit and passing its own
  # health check, and the operator, not this script, decides whether a sidecar
  # that failed to apply is worth reverting the whole release for.
  # FAILED_POSTLIVE is declared at the top of the script, not here: the final
  # report reads it on every path, including the one where production never
  # moved and this block never ran.
  postlive() {
    local label="$1"; shift
    if "$@"; then return 0; fi
    echo "::warning::post-live step failed: $label"
    echo "==> WARN: $label failed, and production is ALREADY LIVE on $SHA." >&2
    FAILED_POSTLIVE="${FAILED_POSTLIVE}${label}, "
    return 0
  }

  # Apply sidecars only after the web candidate proves that its own commit is
  # publicly visible. A failed web candidate is rolled back without touching
  # the running systemd sidecars; their staged directories are inert.
  # The expensive half of the sandbox provisioning, moved here from before the
  # flip. It is ~50s that production used to wait on for no reason: the live
  # site does not read any of it, and a sandbox that fails to provision used to
  # block a perfectly good web release.
  echo "==> Provisioning the development sandbox..."
  postlive "development sandbox provisioning" ./scripts/ci-development.sh post

  echo "==> Applying staged sidecars..."
  postlive "sidecar apply" ./scripts/ci-apply-sidecars.sh

  # The builder's staged directory has deliberately been inert until now. Its
  # watchdog must never apply a candidate merely because staging succeeded:
  # schema application, web restart or the public SHA proof may still fail.
  BUILDER_STAGE="$VPS_DIR/builder-releases/$SHA"
  if [ ! -d "$BUILDER_STAGE" ]; then
    # Post-live, so this is no longer an `exit 1`. The web release is serving
    # and healthy; a missing builder candidate is a broken builder, not a
    # broken site, and conflating the two is what made the badge unreadable.
    echo "::warning::matching jkai-builder candidate was not staged at $BUILDER_STAGE"
    FAILED_POSTLIVE="${FAILED_POSTLIVE}builder candidate missing, "
  else
    echo "==> Activating jkai-builder candidate for apply-when-idle..."
    # Through postlive as well. These are two filesystem calls that have never
    # failed, but they sit between the flip and the release-log ingest, and
    # under `set -e` a failure here would skip the record of a commit that is
    # already serving the public — the exact state this whole block exists to
    # stop being possible.
    postlive "builder candidate activation" bash -c '
      ln -sfn "$1" "$2/builder-releases/pending.tmp" &&
      mv -Tf "$2/builder-releases/pending.tmp" "$2/builder-releases/pending"
    ' _ "$SHA" "$VPS_DIR"
    # Use the existing service so this invocation serialises with its timer.
    postlive "builder watchdog" sudo systemctl start jkai-builder-watchdog.service
  fi

  postlive "development sandbox verification" \
    sudo bash -s -- "/opt/sr-development/sources/$SHA" <<'VERIFY'
set -euo pipefail
set -a
. /opt/strange-rambling-svelte/.env
set +a
node "$1/scripts/ci-verify-development.mjs"
VERIFY

  # Record what just went live (/releases). Deliberately AFTER the
  # public-URL check, so a build that never reached production is never logged
  # as a release — and deliberately non-fatal: the release log is a record of
  # the deploy, never a gate on it.
  echo "==> Recording the release..."
  RELEASE_LOG_TOKEN="$(sed -n 's/^RELEASE_LOG_SECRET=//p' "$VPS_DIR/.env" 2>/dev/null | tr -d '"' | head -1 || true)"
  if [ -z "$RELEASE_LOG_TOKEN" ]; then
    echo "    skipped: RELEASE_LOG_SECRET is not set in $VPS_DIR/.env"
  else
    RELEASE_LOG_TOKEN="$RELEASE_LOG_TOKEN" RELEASE_LOG_URL="$PUBLIC_URL" \
      node scripts/release-log/ingest.mjs --head \
        --prev "${PREV_SHA:-}" \
        --via github-actions \
        --built-at "$(sed -n 's/^built_at=//p' "$RELEASE_DIR/.deploy-sha" | head -1)" \
      || echo "    warn: release-log ingest failed (deploy is fine)"
  fi

  # Teach the build-history graph what the tree looks like AT THIS COMMIT.
  #
  # This job is the only place in the system that has both a git checkout
  # detached at the deployed sha and a credential for the ingest, which is
  # exactly what the old liveness pass lacked: it ran `git ls-files` in
  # homeserv's working copy, which sits on whatever branch someone left it on,
  # and marked 216 files gone when 138 of them were on master.
  #
  # Non-fatal, like the release log above: the graph is a record of production,
  # never a gate on it.
  echo "==> Refreshing the codegraph tree..."
  CODEGRAPH_TOKEN="$(sed -n 's/^CLAUDE_CHANGELOG_SECRET=//p' "$VPS_DIR/.env" 2>/dev/null | tr -d '"' | head -1 || true)"
  if [ -z "$CODEGRAPH_TOKEN" ]; then
    echo "    skipped: CLAUDE_CHANGELOG_SECRET is not set in $VPS_DIR/.env"
  else
    CODEGRAPH_TOKEN="$CODEGRAPH_TOKEN" \
      node scripts/codegraph-tree-pass.mjs --ref "${GITHUB_SHA:-HEAD}" \
      || echo "    warn: codegraph tree pass failed (deploy is fine)"
  fi
else
  echo "==> ERROR: $PUBLIC_URL did not serve candidate sha $SHA with a healthy root within 90s. Service state:" >&2
  systemctl is-active "$SERVICE" >&2 || true
  sudo journalctl -u "$SERVICE" --no-pager -n 30 >&2
  rollback_web_release || true
  exit 1
fi

# Prune. The box runs at ~93% disk and each release is ~92MB, so this is not
# optional. Never prune the live one, whatever the count says.
# The previous dependency tree, kept across the restart so the swap above stays
# reversible until the new process has proved itself.
rm -rf "$VPS_DIR/node_modules.old"

echo "==> Pruning old releases (keeping $KEEP_RELEASES)..."
LIVE="$(readlink -f "$VPS_DIR/build")"
ls -1dt "$VPS_DIR"/releases/*/ 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while read -r d; do
  if [ "$(readlink -f "$d")" = "$LIVE" ]; then
    echo "    keeping $(basename "$d") (live)"
    continue
  fi
  echo "    removing $(basename "$d")"
  rm -rf "$d"
done
df -h "$VPS_DIR" | tail -1

# ── the verdict ──────────────────────────────────────────────────────────────
#
# Reached only when the site is serving $SHA and passing its own health check.
# If a post-live step failed, that is still a red job — but a DIFFERENT red from
# the one above, and it has to say so, because the difference is whether
# production moved. A badge that cannot distinguish "never deployed" from
# "deployed, and something after it failed" sends you looking in the wrong place.
if [ -n "$FAILED_POSTLIVE" ]; then
  echo ""
  echo "==> LIVE on $SHA, but post-live checks failed: ${FAILED_POSTLIVE%, }" >&2
  echo "    PRODUCTION HAS MOVED and was NOT rolled back — the site is serving" >&2
  echo "    this commit and answering /api/version with it." >&2
  echo "    Decide deliberately whether that is worth reverting:" >&2
  echo "      $VPS_DIR/scripts/rollback.sh --list" >&2
  exit 1
fi

echo "==> Release complete: $SHA is live and every post-live step passed."
