#!/usr/bin/env bash
# The SR-Main background worker on the VPS: one systemd unit running the same
# release as the web app with JKAI_SERVICE_ROLE=worker, so the heartbeat,
# scheduled and forge engines, the pollers and the watches leave the process
# that serves pages. The web app runs as JKAI_SERVICE_ROLE=http beside it.
# See src/lib/server/service-role.ts for which services each role owns.
#
#   scripts/main-worker.sh install          write both units' role drop-ins (idempotent)
#   scripts/main-worker.sh follow <release> start/restart the worker if <release>
#                                           knows the split, stop it if it does not
#   scripts/main-worker.sh mark <release>   record that <release> knows the split
#   scripts/main-worker.sh unsplit          back to one process: drop the web's
#                                           role, stop the worker, restart the web
#
# Why `follow` checks a marker: a release older than the split reads any role
# it does not know as `web`, which runs EVERY engine. Rolling the web app back
# to one while the worker kept running would run every cron, every daydream and
# every alert twice. So a rollback stops the worker unless the target release
# was marked by the release script that deployed it.
#
# The worker's PORT is set on the command line, not with Environment=: the
# EnvironmentFile sets PORT=4173 and an EnvironmentFile beats Environment=,
# which would put the worker on the web app's port. Nothing calls the worker
# over HTTP; it listens only because the server entry always does.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
WEB="${SERVICE:-strange-rambling-svelte}"
WORKER="strange-rambling-worker"
WORKER_PORT=4199
UNIT_DIR=/etc/systemd/system
MARKER=.service-split
ENTRY="$VPS_DIR/scripts/server-with-ws.mjs"

role_dropin() {
  local role="$1" extra="${2:-}"
  printf '%s\n' \
    '# Written by scripts/main-worker.sh on every release; do not edit by hand.' \
    '[Service]' \
    'ExecStart=' \
    "ExecStart=/usr/bin/env JKAI_SERVICE_ROLE=$role $extra/usr/bin/node $ENTRY"
}

install_units() {
  # The worker is the web unit's twin: same unit file and drop-ins (env files,
  # tokens, security), re-copied every release so a change to the web's
  # environment reaches it, plus its own role and description.
  sudo install -m 0644 "$UNIT_DIR/$WEB.service" "$UNIT_DIR/$WORKER.service"
  sudo rm -rf "$UNIT_DIR/$WORKER.service.d"
  sudo mkdir -p "$UNIT_DIR/$WORKER.service.d"
  for f in "$UNIT_DIR/$WEB.service.d"/*.conf; do
    [ -e "$f" ] || continue
    [ "$(basename "$f")" = "90-role.conf" ] && continue
    sudo install -m 0644 "$f" "$UNIT_DIR/$WORKER.service.d/"
  done
  {
    printf '%s\n' '[Unit]' \
      'Description=Strange Ramblings background worker — the heartbeat, scheduled and forge engines and the pollers, off the web process (JKAI_SERVICE_ROLE=worker). scripts/main-worker.sh.'
    role_dropin worker "PORT=$WORKER_PORT " | sed 1d
    printf '%s\n' 'Restart=always' 'RestartSec=5'
  } | sudo tee "$UNIT_DIR/$WORKER.service.d/90-role.conf" >/dev/null
  role_dropin http | sudo tee "$UNIT_DIR/$WEB.service.d/90-role.conf" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable "$WORKER" >/dev/null 2>&1 || true
}

follow() {
  local release="$1"
  if [ -f "$release/$MARKER" ]; then
    echo "==> Restarting $WORKER on $(basename "$release")..."
    sudo systemctl restart "$WORKER"
    # Engines run nowhere while the worker is down: if it does not stay up
    # (Restart=always would hide a crash loop behind a momentary "active"), go
    # back to one process rather than leave the site without them.
    local restarts
    restarts="$(systemctl show "$WORKER" -p NRestarts --value 2>/dev/null || echo 0)"
    sleep 20
    if systemctl is-active --quiet "$WORKER" &&
      [ "$(systemctl show "$WORKER" -p NRestarts --value 2>/dev/null || echo 0)" = "$restarts" ]; then
      echo "    $WORKER is active"
      return 0
    fi
    echo "==> ERROR: $WORKER did not stay up; returning to one process." >&2
    sudo journalctl -u "$WORKER" --no-pager -n 30 >&2 || true
    unsplit
    return 1
  fi
  echo "==> $(basename "$release") predates the worker split: stopping $WORKER so nothing runs twice."
  sudo systemctl stop "$WORKER" 2>/dev/null || true
}

unsplit() {
  sudo systemctl stop "$WORKER" 2>/dev/null || true
  sudo rm -f "$UNIT_DIR/$WEB.service.d/90-role.conf"
  sudo systemctl daemon-reload
  sudo systemctl restart "$WEB"
}

case "${1:-}" in
  install) install_units ;;
  follow) follow "${2:?release dir}" ;;
  mark) touch "${2:?release dir}/$MARKER" ;;
  unsplit) unsplit ;;
  *) echo "usage: $0 install | follow <release-dir> | mark <release-dir> | unsplit" >&2; exit 2 ;;
esac
