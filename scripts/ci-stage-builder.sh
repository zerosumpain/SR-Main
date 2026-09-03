#!/usr/bin/env bash
# Build the jkai-builder bundle and STAGE it. Never restarts anything.
#
# Runs in the `prebuild` job, which already has node_modules and has just run
# `npm run build` — so `.svelte-kit/tsconfig.json` exists, which is what
# `$lib/*` resolution depends on. Without it esbuild silently drops the alias
# and emits a bundle that dies at startup; build.mjs refuses in that case, and
# this script is deliberately downstream of the real build for the same reason.
#
# Staging is separated from applying because restarting the builder kills the
# `pi` process of any build in flight, with no resume. `jkai-builder-maintain.sh`
# (the 60-second watchdog timer) picks the candidate up only after ci-release.sh
# has proved the matching web SHA publicly and activates its pointer. It then
# waits until no build is running, so deploys do not knock builds over.
#
# Failing here stops the release before the web symlink moves. The builder is
# part of the candidate the PR proved; silently retaining a different version
# would make the deployed set impossible to reproduce from the green artifact.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SHA="$(git rev-parse HEAD)"
STAGE_ROOT="$VPS_DIR/builder-releases"
STAGE_DIR="$STAGE_ROOT/$SHA"

# The bundle is built by the prebuild job on porkserv and arrives here inside
# the release artifact. This script deliberately builds nothing: the release job
# has no node_modules, because it no longer shares a workspace with the build.
BUNDLE="packages/jkai-builder/dist/start.js"
[ -f "$BUNDLE" ] || { echo "$BUNDLE missing — the release artifact did not carry it (did 'build:release-sidecars' fail?)" >&2; exit 1; }
UNIT="packages/jkai-builder/jkai-builder.service"
LAUNCHER="scripts/jkai-builder-launch.sh"
[ -f "$UNIT" ] || { echo "$UNIT missing" >&2; exit 1; }
[ -x "$LAUNCHER" ] || { echo "$LAUNCHER missing or not executable" >&2; exit 1; }

# Same discipline as ci-prebuild.sh: a staged directory either exists complete
# or does not exist, so activation can never point at a half-written bundle.
echo "==> Staging $SHA..."
mkdir -p "$STAGE_ROOT"
rm -rf "$STAGE_DIR.partial"
mkdir -p "$STAGE_DIR.partial"
cp "$BUNDLE" "$STAGE_DIR.partial/start.js"
cp "$UNIT" "$STAGE_DIR.partial/jkai-builder.service"
cp "$LAUNCHER" "$STAGE_DIR.partial/jkai-builder-launch.sh"
echo "$SHA" > "$STAGE_DIR.partial/sha"
rm -rf "$STAGE_DIR"
mv -T "$STAGE_DIR.partial" "$STAGE_DIR"

# Keep the last few for a manual rollback; drop the rest. `-type d` matters:
# `pending` is a symlink to one of these, and a glob would have listed it as a
# directory and eventually deleted the pointer the watchdog reads.
find "$STAGE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | tail -n +6 | cut -d' ' -f2- | xargs -r rm -rf

echo "==> Installing the maintenance script + timer..."
sudo install -m 755 scripts/jkai-builder-maintain.sh /usr/local/bin/jkai-builder-maintain.sh

# Point the existing watchdog unit at the script. It used to carry the health
# probe inline; the apply-when-idle logic is far too much for an ExecStart line.
sudo tee /etc/systemd/system/jkai-builder-watchdog.service > /dev/null <<'UNIT'
[Unit]
Description=JKAI builder maintenance — apply a staged bundle when idle, restart if /health stops answering

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jkai-builder-maintain.sh
UNIT
sudo systemctl daemon-reload

echo "==> Staged $SHA at $STAGE_DIR"
echo "    Inert until ci-release.sh proves the matching web SHA publicly and activates it."
if [ -f "$VPS_DIR/packages/jkai-builder/dist/start.js" ] &&
   cmp -s "$BUNDLE" "$VPS_DIR/packages/jkai-builder/dist/start.js"; then
  echo "    (identical to what is already running — nothing will change)"
fi
