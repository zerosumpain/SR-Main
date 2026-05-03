#!/usr/bin/env bash
# Deploy the jkai-builder sidecar on the VPS. Independent from deploy.sh
# (which restarts strange-rambling-svelte). Builds run on the VPS;
# the builder owns the orchestrator loop separately so deploys of the
# SvelteKit app don't kill in-flight builds.
set -euo pipefail

VPS_HOST="157.180.19.38"
VPS_USER="johnk"
VPS_KEY="$HOME/.ssh/id_ed25519"
VPS_DIR="/opt/strange-rambling-svelte"
BUILDS_ROOT="/opt/jkai-builds"
SERVICE="jkai-builder"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building jkai-builder bundle..."
npm run build:builder

echo "==> Syncing bundle + unit + sources to VPS..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "mkdir -p $VPS_DIR/packages/jkai-builder/{bin,src,dist}"
rsync -avz --delete \
  -e "ssh -i $VPS_KEY" \
  packages/jkai-builder/dist/ \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/packages/jkai-builder/dist/"
rsync -avz \
  -e "ssh -i $VPS_KEY" \
  packages/jkai-builder/jkai-builder.service \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/packages/jkai-builder/"

echo "==> Ensuring builds root + installing systemd unit..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo install -d -m 755 -o $VPS_USER -g $VPS_USER $BUILDS_ROOT && sudo cp $VPS_DIR/packages/jkai-builder/jkai-builder.service /etc/systemd/system/$SERVICE.service && sudo systemctl daemon-reload && sudo systemctl enable $SERVICE.service && sudo systemctl restart $SERVICE.service"

echo "==> Verifying..."
sleep 3
RESP=$(ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo curl -fsS --unix-socket /run/jkai-builder/jkai-builder.sock --max-time 5 http://x/health" || echo "FAILED")
if echo "$RESP" | grep -q '"ok":true'; then
  echo "==> jkai-builder healthy: $RESP"
else
  echo "==> ERROR: health probe failed"
  ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo systemctl status $SERVICE.service --no-pager | head -25; sudo journalctl -u $SERVICE.service --no-pager -n 30"
  exit 1
fi
