#!/usr/bin/env bash
# Build and deploy the systemd sidecars from CI, so a merge to master is the only
# step. Runs in the `release` job on the self-hosted runner, which IS the VPS.
#
# Why this exists: `ci-release.sh` deploys the web app and nothing else, so every
# other long-running process was hand-deployed from a laptop —
# `scripts/deploy-codex-bridge.sh`, and nothing at all for anything newer. That
# is fine for one sidecar and untenable for three, and it is the reason a sidecar
# could silently run a months-old bundle.
#
# ADDING A SIDECAR IS ONE LINE in SIDECARS below. The companion test
# (`scripts/ci-deploy-sidecars.test.ts`) fails the build if that line names an
# npm script or a unit file that does not exist — the allow-list failure mode
# this repo has been bitten by before.
#
# NOT handled here, deliberately:
#
#   jkai-builder   Has its own path (`ci-stage-builder.sh`) because restarting it
#                  kills the `pi` process of any build in flight, with no resume.
#                  It stages and a watchdog applies when idle. Do not "simplify"
#                  it into this script.
#   jkai-run-worker  Has no unit file and is inert on the VPS (JKAI_RUN_WORKER is
#                  unset, so runs execute in the web process). Add a unit and a
#                  manifest line when that changes.
#   services/webframe  Docker, not systemd. Different lifecycle entirely.
#
# Failure discipline matches the builder's: a stale sidecar is a far smaller
# problem than a release that did not happen, so a sidecar failure warns and the
# script still exits 0. The caller does not need `|| true`.
set -uo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"

# name | npm run <script> | unit filename (inside the package dir)
SIDECARS=(
  "jkai-codex-bridge|build:codex-bridge|jkai-codex-bridge.service"
)

warn() { echo "::warning::$*"; echo "!!  $*" >&2; }

FAILED=0
DEPLOYED=0

for entry in "${SIDECARS[@]}"; do
  IFS='|' read -r NAME SCRIPT UNIT <<< "$entry"
  PKG="packages/$NAME"
  echo "==> $NAME"

  if [ ! -d "$PKG" ]; then
    warn "$NAME: $PKG is missing — manifest and tree disagree"
    FAILED=1; continue
  fi

  if ! npm run "$SCRIPT" >/dev/null 2>&1; then
    warn "$NAME: 'npm run $SCRIPT' failed — keeping the previous bundle"
    FAILED=1; continue
  fi

  BUNDLE="$PKG/dist/start.js"
  if [ ! -f "$BUNDLE" ]; then
    warn "$NAME: $BUNDLE missing after '$SCRIPT' — keeping the previous bundle"
    FAILED=1; continue
  fi

  # Same discipline as ci-stage-builder.sh: assemble beside the target and swap,
  # so the running service never reads a half-written bundle.
  DEST="$VPS_DIR/packages/$NAME"
  mkdir -p "$DEST"
  rm -rf "$DEST/dist.partial"
  mkdir -p "$DEST/dist.partial"
  cp "$BUNDLE" "$DEST/dist.partial/start.js"
  rm -rf "$DEST/dist.prev"
  [ -d "$DEST/dist" ] && mv -T "$DEST/dist" "$DEST/dist.prev"
  mv -T "$DEST/dist.partial" "$DEST/dist"

  if [ -f "$PKG/$UNIT" ]; then
    cp "$PKG/$UNIT" "$DEST/$UNIT"
    if ! sudo install -m 644 "$PKG/$UNIT" "/etc/systemd/system/$UNIT"; then
      warn "$NAME: could not install $UNIT"
      FAILED=1; continue
    fi
    sudo systemctl daemon-reload
  else
    warn "$NAME: unit $UNIT not found in $PKG — manifest is wrong"
    FAILED=1; continue
  fi

  SERVICE="${UNIT%.service}"
  if sudo systemctl restart "$SERVICE"; then
    # Give it a moment to fall over, then report honestly rather than assuming.
    sleep 2
    if systemctl is-active --quiet "$SERVICE"; then
      echo "    $SERVICE restarted and active"
      DEPLOYED=$((DEPLOYED+1))
    else
      warn "$NAME: $SERVICE restarted but is NOT active — rolling the bundle back"
      if [ -d "$DEST/dist.prev" ]; then
        rm -rf "$DEST/dist"
        mv -T "$DEST/dist.prev" "$DEST/dist"
        sudo systemctl restart "$SERVICE" || true
        warn "$NAME: rolled back to the previous bundle"
      fi
      FAILED=1
    fi
  else
    warn "$NAME: systemctl restart $SERVICE failed"
    FAILED=1
  fi
done

echo "==> sidecars deployed: $DEPLOYED/${#SIDECARS[@]}"
[ "$FAILED" -eq 0 ] || echo "::warning::one or more sidecars did not deploy — see above. The web release is unaffected."
exit 0
