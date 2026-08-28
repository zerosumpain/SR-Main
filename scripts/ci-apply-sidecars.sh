#!/usr/bin/env bash
# Apply the sidecar bundles staged by ci-stage-sidecars.sh, then restart them.
#
# Runs in the `release` job, AFTER the web app is live. Needs no node_modules —
# it only moves files and talks to systemd, which is why the build half lives in
# prebuild and this half does not.
#
# Applies only the bundle staged for THIS commit. A sidecar whose staging failed
# simply has no directory for this SHA and is skipped, so it keeps running what
# it was running rather than being restarted onto something stale.
#
# Failure discipline: a stale sidecar is a much smaller problem than a web
# release that did not happen, so this warns and exits 0. If a service fails to
# come back, its previous bundle is restored and restarted before that happens.
set -uo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SHA="$(git rev-parse HEAD)"
STAGE_ROOT="$VPS_DIR/sidecar-releases"

warn() { echo "::warning::$*"; echo "!!  $*" >&2; }

if [ ! -d "$STAGE_ROOT" ]; then
  echo "==> No staged sidecars ($STAGE_ROOT absent) — nothing to apply"
  exit 0
fi

APPLIED=0
SKIPPED=0
for NAMEDIR in "$STAGE_ROOT"/*; do
  [ -d "$NAMEDIR" ] || continue
  NAME="$(basename "$NAMEDIR")"
  SRC="$NAMEDIR/$SHA"

  if [ ! -d "$SRC" ]; then
    echo "==> $NAME: nothing staged for $SHA — leaving it as it is"
    SKIPPED=$((SKIPPED+1)); continue
  fi

  UNIT="$(cat "$SRC/unit" 2>/dev/null || true)"
  if [ -z "$UNIT" ]; then warn "$NAME: staged dir has no unit marker"; continue; fi
  SERVICE="${UNIT%.service}"
  DEST="$VPS_DIR/packages/$NAME"

  echo "==> $NAME: applying $SHA"
  mkdir -p "$DEST"

  # Keep the outgoing bundle so a failed restart can be undone.
  rm -rf "$DEST/dist.prev"
  [ -d "$DEST/dist" ] && cp -a "$DEST/dist" "$DEST/dist.prev"

  rm -rf "$DEST/dist.partial"; mkdir -p "$DEST/dist.partial"
  cp "$SRC/start.js" "$DEST/dist.partial/start.js"
  rm -rf "$DEST/dist"
  mv -T "$DEST/dist.partial" "$DEST/dist"

  cp "$SRC/$UNIT" "$DEST/$UNIT"
  if ! sudo install -m 644 "$SRC/$UNIT" "/etc/systemd/system/$UNIT"; then
    warn "$NAME: could not install $UNIT"; continue
  fi
  sudo systemctl daemon-reload

  if ! sudo systemctl restart "$SERVICE"; then
    warn "$NAME: systemctl restart $SERVICE failed"
  fi
  sleep 2
  if systemctl is-active --quiet "$SERVICE"; then
    echo "    $SERVICE restarted and active"
    APPLIED=$((APPLIED+1))
  else
    warn "$NAME: $SERVICE is NOT active after restart — rolling back"
    if [ -d "$DEST/dist.prev" ]; then
      rm -rf "$DEST/dist"
      cp -a "$DEST/dist.prev" "$DEST/dist"
      sudo systemctl restart "$SERVICE" || true
      sleep 2
      systemctl is-active --quiet "$SERVICE" \
        && warn "$NAME: rolled back to the previous bundle, service is active again" \
        || warn "$NAME: rollback did NOT bring $SERVICE back — needs hands"
    fi
  fi
done

echo "==> sidecars applied: $APPLIED (skipped: $SKIPPED)"
exit 0
