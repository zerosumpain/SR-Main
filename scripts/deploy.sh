#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="157.180.19.38"
VPS_USER="johnk"
VPS_KEY="$HOME/.ssh/id_ed25519"
VPS_DIR="/opt/strange-rambling-svelte"
SERVICE="strange-rambling-svelte"

echo "==> Building..."
npm run build

echo "==> Syncing build to VPS..."
rsync -avz --delete \
  -e "ssh -i $VPS_KEY" \
  build/ \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/build/"

echo "==> Syncing package files..."
rsync -avz \
  -e "ssh -i $VPS_KEY" \
  package.json package-lock.json \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/"

echo "==> Syncing data files..."
rsync -avz \
  -e "ssh -i $VPS_KEY" \
  data/ \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/data/"

echo "==> Syncing DB schema files..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "mkdir -p $VPS_DIR/src/lib/db $VPS_DIR/src/lib/constants $VPS_DIR/src/lib/workflows/scraper/python"
rsync -avz -e "ssh -i $VPS_KEY" \
  src/lib/db/schema.ts "$VPS_USER@$VPS_HOST:$VPS_DIR/src/lib/db/"
rsync -avz -e "ssh -i $VPS_KEY" \
  drizzle.config.ts "$VPS_USER@$VPS_HOST:$VPS_DIR/"

echo "==> Syncing runtime-read files (python scraper, etc)..."
# These files are read at runtime by absolute path relative to the repo root,
# not bundled into build/. Without this sync prod hits ENOENT on scrape.
rsync -avz -e "ssh -i $VPS_KEY" \
  src/lib/workflows/scraper/python/ \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/src/lib/workflows/scraper/python/"

# NOTE: the VPS is deliberately NOT running jkai-sandbox. Stealth scraping
# requires a residential IP and must execute on homeserv. The VPS proxies
# scrape requests to homeserv via SCRAPER_SERVICE_URL — see
# `src/lib/workflows/scraper/runner.ts` and the `/api/scraper/run` endpoint.
# If you see a jkai-sandbox container on the VPS, remove it:
#   ssh johnk@VPS 'docker rm -f jkai-sandbox; docker image rm jkai-sandbox:latest'

echo "==> Installing production deps..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "cd $VPS_DIR && npm install --omit=dev --silent"

# Apply any new/changed schema BEFORE restarting the service so the new
# code doesn't hit a missing table. Additive migrations (CREATE TABLE,
# CREATE INDEX, ADD COLUMN nullable/default) are applied non-interactively.
# Destructive changes (DROP / type narrowing) will make drizzle-kit prompt
# and this step will hang — that's intentional, run it manually.
echo "==> Applying DB schema (drizzle-kit push)..."
# drizzle-kit is a devDep and we strip devDeps in prod. Install it locally
# without touching package.json so it resolves the project's drizzle-orm.
DRIZZLE_TIMEOUT="${DRIZZLE_TIMEOUT:-180}"
# Install drizzle-kit if absent, then run via a remote bash script to keep
# quoting sane. CI=1 + --force disables drizzle's interactive prompt; stdbuf
# forces line buffering so its spinner output flushes over ssh.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" bash -s <<REMOTE
set -e
cd "$VPS_DIR"
if [ ! -x node_modules/.bin/drizzle-kit ]; then
  npm install --no-save --silent drizzle-kit@^0.31.10
fi
set -a; . ./.env; set +a
CI=1 FORCE_COLOR=0 timeout ${DRIZZLE_TIMEOUT}s stdbuf -oL -eL \
  node_modules/.bin/drizzle-kit push --config=drizzle.config.ts --force
ec=\$?
if [ "\$ec" -eq 124 ]; then
  echo "==> drizzle-kit timed out after ${DRIZZLE_TIMEOUT}s — destructive change awaiting confirmation? Run manually."
  exit 1
fi
exit \$ec
REMOTE

echo "==> Updating systemd service (if needed)..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo sed -i 's|ExecStart=.*index.js|ExecStart=/usr/bin/node /opt/strange-rambling-svelte/build/index.js|' /etc/systemd/system/$SERVICE.service && sudo systemctl daemon-reload"

echo "==> Installing workflow-engine watchdog timer..."
# External watchdog: every 60s, curl /api/health/workflow-engine. If it's down
# or the event loop has been blocked >5s the route returns 503 — restart the
# main service. SvelteKit's node adapter doesn't speak sd_notify so we can't
# use systemd's built-in WatchdogSec; this is the equivalent.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo tee /etc/systemd/system/${SERVICE}-watchdog.service > /dev/null" <<'EOF'
[Unit]
Description=Strange Ramblings workflow-engine watchdog
After=network.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'set -euo pipefail; code=$(curl -fsS -o /dev/null -w "%%{http_code}" --max-time 10 http://127.0.0.1:4173/api/health/workflow-engine || echo 000); if [ "$code" != "200" ]; then logger -t sr-watchdog "workflow-engine probe returned $code — restarting strange-rambling-svelte"; systemctl restart strange-rambling-svelte; fi'
EOF
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo tee /etc/systemd/system/${SERVICE}-watchdog.timer > /dev/null" <<'EOF'
[Unit]
Description=Strange Ramblings workflow-engine watchdog timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=60s
Unit=strange-rambling-svelte-watchdog.service

[Install]
WantedBy=timers.target
EOF
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo systemctl daemon-reload && sudo systemctl enable --now ${SERVICE}-watchdog.timer"

echo "==> Ensuring image upload directory exists..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo mkdir -p /opt/strange-rambling/static/images/blog && sudo chmod 755 /opt/strange-rambling/static/images/blog && sudo chown $VPS_USER:$VPS_USER /opt/strange-rambling/static/images/blog"

echo "==> Ensuring workflow file-store directory exists..."
# Default WORKFLOW_FILES_ROOT resolves to ~/.openclaw/workflow-files for the
# service user. Pre-create it so the first upload doesn't fail with ENOENT.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "mkdir -p ~/.openclaw/workflow-files && chmod 700 ~/.openclaw/workflow-files"

echo "==> Draining in-flight runs (running -> paused) before restart..."
# Avoid orphan-pending: if we restart while a run is mid-flight, the new
# process inherits a row stuck in 'running' that the engine politely waits
# on forever. Pausing them lets the reaper pick them up cleanly. The VPS
# doesn't ship psql, so we run via docker exec on the strange-rambling
# pgvector container. Best-effort — failure is logged but does not block.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" bash -s <<'REMOTE' || echo "==> drain skipped (db container missing)"
set -e
PG_CTR=$(docker ps --filter "name=strange-rambling-app-db" --format '{{.Names}}' | head -1)
if [ -z "$PG_CTR" ]; then echo "==> drain: no app-db container found"; exit 0; fi
docker exec "$PG_CTR" psql -U app -d strange_rambling -v ON_ERROR_STOP=1 \
  -c "UPDATE workflow_runs SET status='paused' WHERE status='running' RETURNING id;" || true
REMOTE

echo "==> Restarting service..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo systemctl restart $SERVICE"

echo "==> Verifying..."
sleep 2
STATUS=$(ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "systemctl is-active $SERVICE")

if [ "$STATUS" = "active" ]; then
  echo "==> Deployed successfully to https://strangeramblings.com"
else
  echo "==> ERROR: Service is $STATUS"
  ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
    "sudo journalctl -u $SERVICE --no-pager -n 20"
  exit 1
fi
