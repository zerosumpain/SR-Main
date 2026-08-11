#!/usr/bin/env bash
# Keep the jkai-builder sidecar both ALIVE and CURRENT. Run every 60s by
# jkai-builder-watchdog.timer, as root.
#
# Two jobs, in this order:
#
#   1. Apply a staged bundle, but only while no build is running.
#   2. Restart the service if /health has stopped answering.
#
# Why (1) is not simply part of the deploy: restarting the builder kills its
# child `pi` process, and there is no resume — the iteration in flight is lost
# and has to be redone, which is ~340k tokens on a recent change request. Builds
# run for 30-60 minutes and master is merged several times an afternoon, so a
# restart-on-every-deploy would knock builds over routinely.
#
# The opposite policy is what actually bit us: on 2026-08-11 the fix for an
# overloaded provider merged at 07:18 and the sidecar did not pick it up until
# 12:36, so a build died at 11:29 of precisely the fault that had been fixed
# five hours earlier. Nobody had run deploy-builder.sh, because nothing said to.
#
# Staging always and swapping when idle gets both: deploys never wait, builds
# are never killed, and the gap between "merged" and "running" is at most one
# build plus 60 seconds.

set -uo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
LIVE="$VPS_DIR/packages/jkai-builder/dist/start.js"
PENDING_LINK="$VPS_DIR/builder-releases/pending"
BACKUP="$VPS_DIR/packages/jkai-builder/dist/start.js.previous"
SOCK="/run/jkai-builder/jkai-builder.sock"
SERVICE="jkai-builder"

log() { logger -t jkai-builder-maintain "$*"; echo "$*"; }

# `-w` prints a code even on failure, so a trailing `|| echo 000` concatenates
# and you get "000000" in the log. Capture, then normalise anything that is not
# three digits to 000.
probe() {
  local code
  code=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 --unix-socket "$SOCK" http://x/health 2>/dev/null) || true
  case "$code" in
    [0-9][0-9][0-9]) echo "$code" ;;
    *) echo 000 ;;
  esac
}

# Poll until the service answers, or give up. Used after every restart this
# script performs: without it the health check below sees a process that is
# merely still booting and restarts it a second time — observed in testing.
wait_for_health() {
  for _ in $(seq 1 15); do
    [ "$(probe)" = "200" ] && return 0
    sleep 2
  done
  return 1
}

# A build with status='running' owns a live pi process. Anything that is not a
# clear "no" counts as busy: if the database cannot be reached we must not
# assume the coast is clear and restart into someone's work.
builds_running() {
  local ctr count
  ctr=$(docker ps --filter "name=strange-rambling-app-db" --format '{{.Names}}' | head -1)
  if [ -z "$ctr" ]; then
    echo "unknown"
    return
  fi
  count=$(docker exec "$ctr" psql -U app -d strange_rambling -tAc \
    "SELECT count(*) FROM jkai_builds WHERE status='running';" 2>/dev/null | tr -d '[:space:]')
  if [ -z "$count" ]; then echo "unknown"; else echo "$count"; fi
}

# ---- 1. Apply a staged bundle if one is waiting and nothing is in flight -----

if [ -L "$PENDING_LINK" ] && [ -f "$PENDING_LINK/start.js" ]; then
  if cmp -s "$PENDING_LINK/start.js" "$LIVE"; then
    : # Already running it. Nothing to do, and nothing worth logging every minute.
  elif [ -f "$PENDING_LINK/.failed" ]; then
    # This bundle has already been tried and rolled back. Without this marker the
    # timer would reinstall it, fail, roll back and restart the service EVERY 60
    # SECONDS — turning one bad build into a permanent restart loop. Exiting
    # non-zero does not prevent the next tick; only remembering does. Cleared by
    # the next CI run, which stages a different sha.
    if [ "$((RANDOM % 30))" -eq 0 ]; then
      log "staged bundle $(readlink -f "$PENDING_LINK") previously failed to start — not retrying"
    fi
  else
    RUNNING=$(builds_running)
    if [ "$RUNNING" != "0" ]; then
      # Deliberately quiet-ish: this is the normal state during a long build,
      # and a line a minute would bury the interesting ones.
      if [ "$((RANDOM % 10))" -eq 0 ]; then
        log "staged bundle waiting; $RUNNING build(s) in flight (or db unreachable) — deferring"
      fi
    else
      log "no builds in flight — applying staged bundle $(readlink -f "$PENDING_LINK")"
      cp -f "$LIVE" "$BACKUP" 2>/dev/null || true
      if install -m 644 -o johnk -g johnk "$PENDING_LINK/start.js" "$LIVE"; then
        systemctl restart "$SERVICE"
        if wait_for_health; then
          log "applied and healthy: $(readlink -f "$PENDING_LINK")"
          exit 0
        elif [ -f "$BACKUP" ]; then
          # A bundle can build cleanly and still fail at startup — an unresolved
          # $lib import did exactly that on 2026-08-11 and crash-looped the
          # service. Put the known-good one back rather than leave the builder
          # down until someone notices.
          log "ERROR: staged bundle failed its health probe — rolling back"
          install -m 644 -o johnk -g johnk "$BACKUP" "$LIVE"
          systemctl restart "$SERVICE"
          if wait_for_health; then
            log "rolled back and healthy"
          else
            log "ERROR: rollback did not come back healthy either — jkai-builder is DOWN"
          fi
          # Remember that THIS bundle is bad, so the next tick does not reinstall
          # it. `pending` stays put as the record of what failed; the marker is
          # what stops the loop.
          touch "$(readlink -f "$PENDING_LINK")/.failed" 2>/dev/null || true
          exit 1
        else
          log "ERROR: staged bundle failed its health probe and there is no backup to restore"
          touch "$(readlink -f "$PENDING_LINK")/.failed" 2>/dev/null || true
          exit 1
        fi
      else
        log "ERROR: could not install staged bundle over $LIVE"
      fi
    fi
  fi
fi

# ---- 2. The original watchdog: restart if health has stopped answering -------

CODE=$(probe)
if [ "$CODE" != "200" ]; then
  log "health probe returned $CODE — restarting $SERVICE"
  systemctl restart "$SERVICE"
fi
