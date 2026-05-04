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

echo "==> Checking for in-flight builds..."
# Phase 3's deploy-doesn't-kill-builds protection covers ONLY the SvelteKit
# web-app deploy (deploy.sh). Restarting the builder DOES kill its child pi
# process — true checkpoint-resume across builder restarts is the unfinished
# half of phase 8 (deferred: needs setsid + fifo + reattach, non-trivial).
# Until then: refuse to deploy the builder if a build is iterating, unless
# explicitly forced via FORCE_DEPLOY=1.
ACTIVE_COUNT=$(ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "docker exec strange-rambling-app-db-1 psql -U app -d strange_rambling -tAc \"SELECT count(*) FROM jkai_builds WHERE status='running';\"" \
  2>/dev/null | tr -d '[:space:]')
if [ "${ACTIVE_COUNT:-0}" -gt 0 ] && [ -z "${FORCE_DEPLOY:-}" ]; then
  echo "==> ABORT: $ACTIVE_COUNT build(s) currently iterating. Restarting jkai-builder will kill the active pi child."
  echo "    Options:"
  echo "      a) Wait for the build to finish or pause it via the UI, then re-run."
  echo "      b) FORCE_DEPLOY=1 $0 — accept losing the in-flight iteration."
  echo "         (The orchestrator will re-run that iteration on resume; cost = one wasted LLM call.)"
  exit 2
fi
if [ "${ACTIVE_COUNT:-0}" -gt 0 ]; then
  echo "==> WARNING: FORCE_DEPLOY set with $ACTIVE_COUNT active build(s) — proceeding, the in-flight iteration WILL be killed."
fi

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

echo "==> Installing builder watchdog timer..."
# External watchdog: every 60s, probe /health over the unix socket. If the
# probe fails (socket missing, builder crashed, or RPC dispatcher hung), the
# oneshot service restarts jkai-builder. Equivalent to the strange-rambling
# watchdog wired in deploy.sh — Node's node:http server doesn't speak
# sd_notify so this is the substitute.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo tee /etc/systemd/system/${SERVICE}-watchdog.service > /dev/null" <<'EOF'
[Unit]
Description=JKAI builder watchdog — restarts jkai-builder if /health stops responding

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'set -euo pipefail; code=$(curl -fsS -o /dev/null -w "%%{http_code}" --max-time 10 --unix-socket /run/jkai-builder/jkai-builder.sock http://x/health || echo 000); if [ "$code" != "200" ]; then logger -t jkai-builder-watchdog "health probe returned $code — restarting jkai-builder"; systemctl restart jkai-builder; fi'
EOF
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo tee /etc/systemd/system/${SERVICE}-watchdog.timer > /dev/null" <<'EOF'
[Unit]
Description=JKAI builder watchdog timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=60s
Unit=jkai-builder-watchdog.service

[Install]
WantedBy=timers.target
EOF
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" \
  "sudo systemctl daemon-reload && sudo systemctl enable --now ${SERVICE}-watchdog.timer"

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
