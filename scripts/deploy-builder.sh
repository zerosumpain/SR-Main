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

# --- pi version pin --------------------------------------------------------
# The builder runs `pi` from the host PATH (JKAI_BUILDS_HOSTMODE=1), and nothing
# in ci-deploy.sh installs or updates it — a merge to master leaves whatever
# binary happens to be on the box. That is how the host ended up on 0.72.1 while
# the jkai-sandbox image still carried 0.69.0.
#
# package.json's jkai.piVersion is the single pin. This makes the host match it,
# and the builder's own assertPiVersion() refuses to run if it ever doesn't.
# Upgrading pi = move the pin in a PR, run a canary build, then deploy — never
# `npm i -g` straight onto the box, which leaves nothing to roll back to.
PI_VERSION="$(node -p "require('./package.json').jkai.piVersion")"
echo "==> Ensuring pi $PI_VERSION on the build host..."
# NOTE the 2>&1 on every `pi --version`: pi prints its version to STDERR, so
# capturing stdout alone yields an empty string and every comparison here fails
# against "". That is not hypothetical — the first run of this step reported
# `pi is  after install, expected 0.72.1` having just installed it correctly.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "
  set -eu
  installed=\"\$(pi --version 2>&1 | head -1 || echo none)\"
  if [ \"\$installed\" = \"$PI_VERSION\" ]; then
    echo \"    pi $PI_VERSION already installed.\"
  else
    echo \"    pi is '\$installed' — installing $PI_VERSION ...\"
    sudo npm install -g '@mariozechner/pi-coding-agent@$PI_VERSION'
    now=\"\$(pi --version 2>&1 | head -1)\"
    [ \"\$now\" = \"$PI_VERSION\" ] || { echo \"    ERROR: pi is '\$now' after install, expected $PI_VERSION\"; exit 1; }
    echo \"    pi $PI_VERSION installed.\"
  fi
"

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

echo "==> Clearing any staged bundle (this deploy supersedes it)..."
# Without this the 60s watchdog would see a `pending` symlink from an earlier CI
# run, decide it differs from what was just installed, and swap the manual
# deploy straight back out.
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "rm -f $VPS_DIR/builder-releases/pending"

echo "==> Installing builder maintenance script + timer..."
# Same script CI installs, so whichever ran last leaves the same state. It does
# two things every 60s: apply a staged bundle when no build is in flight, and
# restart the service if /health stops answering.
scp -q -i "$VPS_KEY" scripts/jkai-builder-maintain.sh "$VPS_USER@$VPS_HOST:/tmp/jkai-builder-maintain.sh"
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo install -m 755 /tmp/jkai-builder-maintain.sh /usr/local/bin/jkai-builder-maintain.sh && rm -f /tmp/jkai-builder-maintain.sh"
ssh -i "$VPS_KEY" "$VPS_USER@$VPS_HOST" "sudo tee /etc/systemd/system/${SERVICE}-watchdog.service > /dev/null" <<'EOF'
[Unit]
Description=JKAI builder maintenance — apply a staged bundle when idle, restart if /health stops answering

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jkai-builder-maintain.sh
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
