#!/usr/bin/env bash
# Deploy the jkai-builder sidecar on homeserv. Independent from deploy.sh
# (which only restarts strange-rambling-svelte). Phase 1: simple build +
# restart. Phase 8 will add checkpoint-on-SIGTERM with resume on boot.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Building jkai-builder bundle..."
npm run build:builder

echo "==> Installing systemd unit..."
mkdir -p "$HOME/.config/systemd/user"
# Unit lives in source; make sure the runtime symlink is in place.
if [ ! -e "$HOME/.config/systemd/user/jkai-builder.service" ] && [ -e "$ROOT/packages/jkai-builder/jkai-builder.service" ]; then
  cp "$ROOT/packages/jkai-builder/jkai-builder.service" "$HOME/.config/systemd/user/"
fi

systemctl --user daemon-reload
systemctl --user enable --now jkai-builder.service

echo "==> Restarting jkai-builder..."
systemctl --user restart jkai-builder.service

echo "==> Verifying..."
sleep 3
SOCK="/run/user/$(id -u)/jkai-builder.sock"
if [ ! -S "$SOCK" ]; then
  echo "==> ERROR: socket $SOCK not present after restart"
  systemctl --user status jkai-builder.service --no-pager | head -20
  exit 1
fi
RESP=$(curl -fsS --unix-socket "$SOCK" --max-time 5 http://x/health || echo "FAILED")
if echo "$RESP" | grep -q '"ok":true'; then
  echo "==> jkai-builder healthy: $RESP"
else
  echo "==> ERROR: health probe failed: $RESP"
  systemctl --user status jkai-builder.service --no-pager | head -20
  exit 1
fi
