#!/usr/bin/env bash
# Deploy the jkai-codex-bridge sidecar on the VPS. Independent from
# scripts/ci-deploy.sh, which never touches packages/ — the bridge is its own
# process with its own lifecycle, and restarting it must not require a web
# deploy (nor the reverse).
#
# Mirrors scripts/deploy-builder.sh. The one thing it CANNOT do for you is log
# in: `codex login` is an interactive OAuth flow and the token lives in the
# service user's ~/.codex/auth.json on each host. Run it once per host:
#
#   ssh johnk@157.180.19.38 'codex login --device-auth'
#
# and follow the printed URL + code.
set -euo pipefail

VPS_HOST="157.180.19.38"
VPS_USER="johnk"
VPS_KEY="$HOME/.ssh/id_ed25519"
VPS_DIR="/opt/strange-rambling-svelte"
SERVICE="jkai-codex-bridge"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building jkai-codex-bridge bundle..."
npm run build:codex-bridge

echo "==> Syncing bundle + unit to VPS..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "mkdir -p $VPS_DIR/packages/jkai-codex-bridge/dist"
rsync -avz --delete \
  -e "ssh -i $VPS_KEY" \
  packages/jkai-codex-bridge/dist/ \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/packages/jkai-codex-bridge/dist/"
rsync -avz \
  -e "ssh -i $VPS_KEY" \
  packages/jkai-codex-bridge/jkai-codex-bridge.service \
  "$VPS_USER@$VPS_HOST:$VPS_DIR/packages/jkai-codex-bridge/"

# The bundle keeps @openai/codex-sdk external, so the VPS needs it installed.
# ci-deploy.sh's `npm install --omit=dev` covers it because the SDK is a real
# dependency, not a devDependency — but a bridge deploy can land before the next
# web deploy, so check rather than assume.
echo "==> Verifying the Codex SDK is installed on the VPS..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "test -d $VPS_DIR/node_modules/@openai/codex-sdk || (cd $VPS_DIR && npm install --omit=dev @openai/codex-sdk)"

echo "==> Installing systemd unit..."
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo cp $VPS_DIR/packages/jkai-codex-bridge/jkai-codex-bridge.service /etc/systemd/system/$SERVICE.service \
   && sudo systemctl daemon-reload \
   && sudo systemctl enable $SERVICE.service \
   && sudo systemctl restart $SERVICE.service"

echo "==> Health check..."
sleep 3
# /health returns 503 (not a connection error) when the process is up but
# `codex login` hasn't been run — report that distinctly, it's the likely state
# on a first deploy and the fix is a one-liner rather than a redeploy.
STATUS=$(ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "curl -s -o /tmp/codex-health.json -w '%{http_code}' --max-time 10 http://127.0.0.1:5207/health || echo 000")
BODY=$(ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "cat /tmp/codex-health.json 2>/dev/null || true")

echo "    HTTP $STATUS — $BODY"
case "$STATUS" in
  200) echo "==> Bridge is ready." ;;
  503) echo "==> Bridge is RUNNING but not authenticated. Run: ssh $VPS_USER@$VPS_HOST 'codex login --device-auth'"; exit 1 ;;
  *)   echo "==> Bridge is NOT responding. Check: sudo journalctl -u $SERVICE -n 50"; exit 1 ;;
esac
