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

echo "==> Ensuring image upload directory exists..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo mkdir -p /opt/strange-rambling/static/images/blog && sudo chmod 755 /opt/strange-rambling/static/images/blog && sudo chown $VPS_USER:$VPS_USER /opt/strange-rambling/static/images/blog"

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
