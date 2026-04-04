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

echo "==> Installing production deps..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "cd $VPS_DIR && npm install --omit=dev --silent"

echo "==> Updating systemd service (if needed)..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo sed -i 's|ExecStart=.*index.js|ExecStart=/usr/bin/node /opt/strange-rambling-svelte/build/index.js|' /etc/systemd/system/$SERVICE.service && sudo systemctl daemon-reload"

echo "==> Ensuring image upload directory exists..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "mkdir -p /opt/strange-rambling/static/images/blog && chmod 755 /opt/strange-rambling/static/images/blog"

echo "==> Restarting service..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo systemctl restart $SERVICE"

echo "==> Verifying..."
sleep 2
STATUS=$(ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "systemctl is-active $SERVICE")

if [ "$STATUS" = "active" ]; then
  echo "==> Deployed successfully to https://dev.strangeramblings.com"
else
  echo "==> ERROR: Service is $STATUS"
  ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
    "sudo journalctl -u $SERVICE --no-pager -n 20"
  exit 1
fi
