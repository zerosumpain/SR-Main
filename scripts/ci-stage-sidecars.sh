#!/usr/bin/env bash
# Stage each pre-built systemd sidecar. Never restarts anything.
#
# Runs in the `prebuild` job, and that placement is the whole point: the
# `release` job deliberately has no `setup-node` and no `npm ci` (it says so in
# ci.yml), so `npm run build:<sidecar>` cannot work there. The first version of
# this script ran from `ci-release.sh`, warned on every sidecar, and exited 0 —
# a deploy that reported success and changed nothing. `ci-stage-builder.sh` had
# already documented this trap; it is in prebuild for exactly the same reason.
#
# Staging is separate from applying so the ordering is honest: nothing restarts
# until the release job has actually put the new web build live. A gate that
# fails after prebuild therefore leaves the sidecars untouched.
#
# ADDING A SIDECAR IS ONE LINE in SIDECARS below. `tests/scripts/ci-deploy-sidecars.test.ts`
# fails the build if that line names an npm script or a unit file that does not
# exist — the allow-list failure mode this repo has been bitten by before.
#
# NOT handled here, deliberately:
#
#   jkai-builder   Has its own path (`ci-stage-builder.sh`) with an apply-when-idle
#                  watchdog, because restarting it kills the `pi` process of a
#                  build in flight with no resume. Do not fold it into this.
#   jkai-run-worker  No unit file, and inert on the VPS (JKAI_RUN_WORKER unset).
#   services/webframe  Docker, not systemd.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SHA="$(git rev-parse HEAD)"
STAGE_ROOT="$VPS_DIR/sidecar-releases"

# name | npm run <script> | unit filename (inside the package dir)
SIDECARS=(
  "jkai-codex-bridge|build:codex-bridge|jkai-codex-bridge.service"
  "jkai-wa-worker|build:wa-worker|jkai-wa-worker.service"
)

warn() { echo "::warning::$*"; echo "!!  $*" >&2; }

STAGED=0
FAILED=0
for entry in "${SIDECARS[@]}"; do
  IFS='|' read -r NAME SCRIPT UNIT <<< "$entry"
  PKG="packages/$NAME"
  echo "==> Staging $NAME @ $SHA"

  if [ ! -d "$PKG" ]; then warn "$NAME: $PKG missing — manifest and tree disagree"; FAILED=$((FAILED+1)); continue; fi

  # Built by the prebuild job on porkserv (`npm run $SCRIPT`) and delivered in
  # the release artifact. Nothing is built here: this job has no node_modules.
  BUNDLE="$PKG/dist/start.js"
  if [ ! -f "$BUNDLE" ]; then
    warn "$NAME: $BUNDLE missing from the release artifact — did the prebuild step for '$SCRIPT' fail? The previous bundle stays live"
    FAILED=$((FAILED+1)); continue
  fi
  if [ ! -f "$PKG/$UNIT" ]; then
    warn "$NAME: unit $UNIT not found in $PKG — manifest is wrong"
    FAILED=$((FAILED+1)); continue
  fi

  # A staged directory either exists complete or does not exist, so the apply
  # step can never pick up a half-written bundle. Same discipline as
  # ci-prebuild.sh and ci-stage-builder.sh.
  DIR="$STAGE_ROOT/$NAME/$SHA"
  mkdir -p "$STAGE_ROOT/$NAME"
  rm -rf "$DIR.partial"; mkdir -p "$DIR.partial"
  cp "$BUNDLE" "$DIR.partial/start.js"
  cp "$PKG/$UNIT" "$DIR.partial/$UNIT"
  echo "$UNIT" > "$DIR.partial/unit"
  rm -rf "$DIR"
  mv -T "$DIR.partial" "$DIR"

  # Keep a few for manual rollback; drop the rest.
  find "$STAGE_ROOT/$NAME" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -rf

  echo "    staged at $DIR (not live — ci-apply-sidecars.sh applies it)"
  STAGED=$((STAGED+1))
done

echo "==> sidecars staged: $STAGED/${#SIDECARS[@]}"
if [ "$FAILED" -ne 0 ] || [ "$STAGED" -ne "${#SIDECARS[@]}" ]; then
  echo "==> ERROR: the release payload is incomplete; refusing to deploy a mixed-version candidate" >&2
  exit 1
fi
