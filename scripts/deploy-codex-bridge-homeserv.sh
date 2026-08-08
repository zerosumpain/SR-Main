#!/usr/bin/env bash
# Refresh the homeserv Codex bridge. Counterpart to deploy-codex-bridge.sh
# (which does the VPS).
#
# The bridge runs from /home/john/jkai-codex-bridge, NOT from this checkout.
# That is deliberate: ~/strange_rambling_svelte is shared between concurrent
# Claude sessions and changes branch underneath you, so a systemd unit pinned to
# it dies the moment someone else starts a feature. The runtime dir holds the
# built bundle plus its own node_modules for @openai/codex-sdk, which the bundle
# keeps external.
set -euo pipefail

RUNTIME_DIR="/home/john/jkai-codex-bridge"
SERVICE="jkai-codex-bridge"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building bundle..."
node packages/jkai-codex-bridge/build.mjs

echo "==> Installing to $RUNTIME_DIR..."
mkdir -p "$RUNTIME_DIR/dist"
cp packages/jkai-codex-bridge/dist/start.js "$RUNTIME_DIR/dist/start.js"

# The bundle imports @openai/codex-sdk at runtime; the runtime dir carries its
# own copy so it does not depend on this checkout's node_modules surviving.
if [ ! -d "$RUNTIME_DIR/node_modules/@openai/codex-sdk" ]; then
  echo "==> Installing the Codex SDK into the runtime dir..."
  (cd "$RUNTIME_DIR" && npm install --no-audit --no-fund)
fi

echo "==> Restarting $SERVICE..."
systemctl --user daemon-reload
systemctl --user enable "$SERVICE.service" >/dev/null 2>&1 || true
systemctl --user restart "$SERVICE.service"

echo "==> Health check..."
for _ in $(seq 1 10); do
  STATUS=$(curl -s -o /tmp/codex-health-homeserv.json -w '%{http_code}' --max-time 10 http://127.0.0.1:5207/health || echo 000)
  [ "$STATUS" != "000" ] && break
  sleep 1
done
BODY=$(cat /tmp/codex-health-homeserv.json 2>/dev/null || true)
echo "    HTTP $STATUS — $BODY"

# 503 means the process is up but `codex login` has not been run — a distinct
# state from "not running", and the fix is a login, not a redeploy.
case "$STATUS" in
  200) echo "==> Bridge is ready." ;;
  503) echo "==> Bridge is RUNNING but not authenticated. Run: codex login --device-auth"; exit 1 ;;
  *)   echo "==> Bridge is NOT responding. Check: journalctl --user -u $SERVICE -n 50"; exit 1 ;;
esac
