#!/usr/bin/env bash
# VPS-local deploy, run by the GitHub Actions self-hosted runner.
#
# This is the same contract as scripts/deploy.sh, minus the SSH: deploy.sh runs
# ON HOMESERV and pushes to the VPS over ssh/rsync; this runs ON THE VPS (in the
# runner's checkout) and places files directly. Keep the two in step — if you
# add a step to one, add it to the other. deploy.sh remains the manual path.
#
# Expects: cwd = repo root, `npm ci` and `npm run build` already done.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SERVICE="${SERVICE:-strange-rambling-svelte}"
PUBLIC_URL="${PUBLIC_URL:-https://strangeramblings.com}"

# Read the sha currently serving production BEFORE the rsync replaces build/.
# This is the release log's "what did this deploy replace" boundary; without it
# a release can only be attributed to a single commit. Empty on the first deploy
# after this script was introduced.
PREV_SHA="$(sed -n 's/^sha=//p' "$VPS_DIR/build/.deploy-sha" 2>/dev/null | head -1 || true)"
echo "==> Previously deployed sha: ${PREV_SHA:-<none>}"

echo "==> Stamping deploy provenance into build/.deploy-sha..."
{
  echo "sha=$(git rev-parse HEAD)"
  echo "short=$(git rev-parse --short HEAD)"
  echo "branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "dirty=$([ -n "$(git status --porcelain)" ] && echo yes || echo no)"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "via=github-actions"
} > build/.deploy-sha
cat build/.deploy-sha

echo "==> Placing build output..."
rsync -a --delete build/ "$VPS_DIR/build/"

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

echo "==> Installing production deps..."
( cd "$VPS_DIR" && npm install --omit=dev --silent )

echo "==> Applying DB schema (drizzle-kit push)..."
# drizzle-kit is a devDep and prod strips devDeps, so install it unsaved.
# CI=1 + --force disables the interactive prompt; a destructive change will
# instead hit the timeout, which is deliberate — run it by hand in that case.
DRIZZLE_TIMEOUT="${DRIZZLE_TIMEOUT:-180}"
(
  cd "$VPS_DIR"
  if [ ! -x node_modules/.bin/drizzle-kit ]; then
    npm install --no-save --silent drizzle-kit@^0.31.10
  fi
  set -a; . ./.env; set +a
  set +e
  CI=1 FORCE_COLOR=0 timeout "${DRIZZLE_TIMEOUT}s" stdbuf -oL -eL \
    node_modules/.bin/drizzle-kit push --config=drizzle.config.ts --force
  ec=$?
  set -e
  if [ "$ec" -eq 124 ]; then
    echo "==> drizzle-kit timed out after ${DRIZZLE_TIMEOUT}s — destructive change awaiting confirmation? Run manually." >&2
    exit 1
  fi
  exit $ec
)

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

# Restarts ONLY the web app. The jkai-builder sidecar owns build-orchestrator
# state and must survive web restarts — only scripts/deploy-builder.sh touches it.
echo "==> Restarting $SERVICE (builder is unaffected)..."
sudo systemctl restart "$SERVICE"

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
        --built-at "$(sed -n 's/^built_at=//p' build/.deploy-sha | head -1)" \
      || echo "    warn: release-log ingest failed (deploy is fine)"
  fi
else
  echo "==> ERROR: $PUBLIC_URL did not return 200 within 90s. Service state:" >&2
  systemctl is-active "$SERVICE" >&2 || true
  sudo journalctl -u "$SERVICE" --no-pager -n 30 >&2
  exit 1
fi
