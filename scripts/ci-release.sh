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

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SERVICE="${SERVICE:-strange-rambling-svelte}"
PUBLIC_URL="${PUBLIC_URL:-https://strangeramblings.com}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"

SHA="$(git rev-parse HEAD)"
RELEASE_DIR="$VPS_DIR/releases/$SHA"
STATE_DIR="$VPS_DIR/.deploy-state"
mkdir -p "$STATE_DIR"

[ -d "$RELEASE_DIR" ] || { echo "no staged release at $RELEASE_DIR — prebuild did not run or did not finish" >&2; exit 1; }
[ -f "$RELEASE_DIR/handler.js" ] || { echo "staged release has no handler.js" >&2; exit 1; }

# Read what is serving now BEFORE the swap. This is the release log's "what did
# this replace" boundary. Empty on the first run of this script.
PREV_SHA="$(sed -n 's/^sha=//p' "$VPS_DIR/build/.deploy-sha" 2>/dev/null | head -1 || true)"
echo "==> Previously deployed sha: ${PREV_SHA:-<none>}"

echo "==> Placing package manifests..."
rsync -a package.json package-lock.json "$VPS_DIR/"

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
rsync -a scripts/studio-image.mjs "$VPS_DIR/scripts/"
rsync -a scripts/studio-research.mjs "$VPS_DIR/scripts/"
# The build-history graph's pull channel. The agent is told in REPO_SYSTEM_PROMPT
# to run this by path, so the same allow-list trap applies exactly as above:
# without this line the command named in the prompt does not exist on the VPS,
# every invocation fails, and the agent falls back to rediscovering by hand —
# the 10.5-discovery-actions-per-iteration behaviour this change set exists to
# reduce. Nothing else would report the absence.
rsync -a scripts/codegraph-query.mjs "$VPS_DIR/scripts/"
rsync -a scripts/codegraph-tree-pass.mjs "$VPS_DIR/scripts/"

# Production deps only when the lockfile actually changed. Measured: 26% of
# commits change it. The hash is kept by us rather than read back out of
# node_modules — npm's own installed-tree metadata is not in a shape that can be
# compared against a lockfile, and a guard that silently never matches is worse
# than no guard. Recorded only AFTER a clean install, so a failure retries.
echo "==> Production deps..."
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ "$(cat "$STATE_DIR/lockfile.sha256" 2>/dev/null || true)" = "$LOCK_HASH" ]; then
  echo "    lockfile unchanged — skipping install"
else
  ( cd "$VPS_DIR" && npm install --omit=dev --silent )
  echo "$LOCK_HASH" > "$STATE_DIR/lockfile.sha256"
  echo "    installed"
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
  if grep -qiE '^Error:|Interactive prompts require a TTY|Please run|error: could not' "$DRIZZLE_LOG"; then
    echo "==> drizzle-kit push REPORTED AN ERROR while exiting 0 — schema was NOT applied:" >&2
    grep -iE '^Error:|Interactive prompts require a TTY|Please run|error: could not' "$DRIZZLE_LOG" | head -5 >&2
    echo "==> Apply it by hand on the VPS, then stamp $STATE_DIR/schema.sha256." >&2
    echo "==> A drop + an add on ONE table reads as a rename and needs a TTY; split them across two deploys or run push interactively." >&2
    rm -f "$DRIZZLE_LOG"
    exit 1
  fi
  rm -f "$DRIZZLE_LOG"
  echo "$SCHEMA_HASH" > "$STATE_DIR/schema.sha256"
fi

echo "==> Ensuring service entrypoint + support dirs..."
sudo sed -i "s|ExecStart=.*index.js|ExecStart=/usr/bin/node $VPS_DIR/scripts/server-with-ws.mjs|" \
  "/etc/systemd/system/$SERVICE.service"
sudo systemctl daemon-reload
sudo mkdir -p /opt/strange-rambling/static/images/blog
sudo chown "$(id -un):$(id -gn)" /opt/strange-rambling/static/images/blog
mkdir -p ~/.openclaw/workflow-files && chmod 700 ~/.openclaw/workflow-files

echo "==> Draining in-flight runs (running -> paused) before restart..."
PG_CTR=$(docker ps --filter "name=strange-rambling-app-db" --format '{{.Names}}' | head -1 || true)
if [ -n "$PG_CTR" ]; then
  docker exec "$PG_CTR" psql -U app -d strange_rambling \
    -c "UPDATE workflow_runs SET status='paused' WHERE status='running';" || true
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

echo "==> Pointing build/ at releases/$SHA..."
ln -sfn "releases/$SHA" "$VPS_DIR/build.tmp"
mv -Tf "$VPS_DIR/build.tmp" "$VPS_DIR/build"
echo "    build -> $(readlink "$VPS_DIR/build")"

# Restarts ONLY the web app. The jkai-builder sidecar owns build-orchestrator
# state and must survive web restarts — only scripts/deploy-builder.sh touches it.
echo "==> Restarting $SERVICE (builder is unaffected)..."
sudo systemctl restart "$SERVICE"

# ---- Sidecars -------------------------------------------------------------
# APPLY only. The bundles were built and staged in the prebuild job, because THIS
# job deliberately has no node_modules (see the checkout step in ci.yml) — the
# first version of this tried to `npm run build:...` here and silently staged
# nothing. Applying after the web restart also keeps the ordering honest: a gate
# failure leaves the sidecars untouched.
#
# Never fails the release: a stale sidecar is a smaller problem than a web deploy
# that did not happen, so the script warns and exits 0 on its own.
echo "==> Applying staged sidecars..."
./scripts/ci-apply-sidecars.sh

echo "==> Verifying against the PUBLIC url (not localhost — Caddy/cloudflared and"
echo "    the static cache come up on different timelines than the node process)..."
if timeout 90 bash -c "until curl -fsS -o /dev/null '$PUBLIC_URL'; do sleep 3; done"; then
  echo "==> Deployed successfully to $PUBLIC_URL"
  echo "    $(curl -fsS -o /dev/null -w 'HTTP %{http_code} in %{time_total}s' "$PUBLIC_URL")"

  # Record what just went live (/admin/ops/releases). Deliberately AFTER the
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
  echo "==> ERROR: $PUBLIC_URL did not return 200 within 90s. Service state:" >&2
  systemctl is-active "$SERVICE" >&2 || true
  sudo journalctl -u "$SERVICE" --no-pager -n 30 >&2
  echo "==> Rollback: point build/ back at the previous release and restart:" >&2
  echo "    ln -sfn releases/${PREV_SHA:-<sha>} $VPS_DIR/build.tmp && mv -Tf $VPS_DIR/build.tmp $VPS_DIR/build && sudo systemctl restart $SERVICE" >&2
  exit 1
fi

# Prune. The box runs at ~93% disk and each release is ~92MB, so this is not
# optional. Never prune the live one, whatever the count says.
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
