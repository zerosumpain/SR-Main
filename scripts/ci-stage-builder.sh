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
# (the 60-second watchdog timer) picks the staged bundle up the moment nothing
# is running. Deploys therefore never wait for a build, and builds are never
# knocked over by a deploy.
#
# Failing here must not fail the release: a stale sidecar is a much smaller
# problem than a web deploy that did not happen. The caller runs this with `||
# true` and the log carries the reason.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SHA="$(git rev-parse HEAD)"
STAGE_ROOT="$VPS_DIR/builder-releases"
STAGE_DIR="$STAGE_ROOT/$SHA"

# The bundle is built by the prebuild job on porkserv and arrives here inside
# the release artifact. This script deliberately builds nothing: the release job
# has no node_modules, because it no longer shares a workspace with the build.
BUNDLE="packages/jkai-builder/dist/start.js"
[ -f "$BUNDLE" ] || { echo "$BUNDLE missing — the release artifact did not carry it (did 'npm run build:builder' fail in prebuild?)" >&2; exit 1; }

# Same discipline as ci-prebuild.sh: a staged directory either exists complete
# or does not exist, so the watchdog can never pick up a half-written bundle.
echo "==> Staging $SHA..."
mkdir -p "$STAGE_ROOT"
rm -rf "$STAGE_DIR.partial"
mkdir -p "$STAGE_DIR.partial"
cp "$BUNDLE" "$STAGE_DIR.partial/start.js"
echo "$SHA" > "$STAGE_DIR.partial/sha"
rm -rf "$STAGE_DIR"
mv -T "$STAGE_DIR.partial" "$STAGE_DIR"

# The pointer the watchdog reads. Swap it atomically too — it is read by a timer
# that may fire in the middle of this.
ln -sfn "$SHA" "$STAGE_ROOT/pending.tmp"
mv -Tf "$STAGE_ROOT/pending.tmp" "$STAGE_ROOT/pending"

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
echo "    Not live yet — the watchdog applies it within ~60s of the last build finishing."
if [ -f "$VPS_DIR/packages/jkai-builder/dist/start.js" ] &&
   cmp -s "$BUNDLE" "$VPS_DIR/packages/jkai-builder/dist/start.js"; then
  echo "    (identical to what is already running — nothing will change)"
fi
