#!/usr/bin/env bash
# Refresh the homeserv Codex bridge. Counterpart to deploy-codex-bridge.sh
# (which does the VPS).
#
# The bridge runs from /home/john/jkai-codex-bridge, NOT from this checkout.
# That is deliberate: ~/strange_rambling_svelte is shared between concurrent
# Claude sessions and changes branch underneath you, so a systemd unit pinned to
# it dies the moment someone else starts a feature. The runtime dir holds the
# built bundle plus its own node_modules for @openai/codex-sdk, which the bundle
# keeps external.
set -euo pipefail

RUNTIME_DIR="/home/john/jkai-codex-bridge"
SERVICE="jkai-codex-bridge"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# The build resolves `$lib` through tsconfig.json, which extends
# .svelte-kit/tsconfig.json. A fresh worktree has no .svelte-kit until a sync,
# and esbuild then leaves `$lib` as a bare import: the bundle builds, installs,
# and the bridge dies on start with "Cannot find package '$lib'" (2026-09-25).
echo "==> Syncing SvelteKit (for the \$lib alias)..."
npx svelte-kit sync >/dev/null

echo "==> Building bundle..."
node packages/jkai-codex-bridge/build.mjs
if grep -qE "from ['\"]\\\$lib/" packages/jkai-codex-bridge/dist/start.js; then
  echo "==> Bundle still imports \$lib, so the bridge would not start. Not installing it." >&2
  exit 1
fi

echo "==> Installing to $RUNTIME_DIR..."
mkdir -p "$RUNTIME_DIR/dist"
cp packages/jkai-codex-bridge/dist/start.js "$RUNTIME_DIR/dist/start.js"

# The bundle imports @openai/codex-sdk at runtime; the runtime dir carries its
# own copy so it does not depend on this checkout's node_modules surviving.
# Keep it on the version this checkout locks. It used to install only when the
# SDK was missing, so the weekly bump (.github/workflows/codex-sdk-bump.yml)
# never reached homeserv.
WANT=$(node -p "require('./package-lock.json').packages['node_modules/@openai/codex-sdk'].version")
HAVE=$(node -p "try { require('$RUNTIME_DIR/node_modules/@openai/codex-sdk/package.json').version } catch { '' }")
if [ "$WANT" != "$HAVE" ]; then
  echo "==> Installing @openai/codex-sdk $WANT into the runtime dir (had: ${HAVE:-none})..."
  (cd "$RUNTIME_DIR" && npm pkg set "dependencies.@openai/codex-sdk=^$WANT" && npm install --no-audit --no-fund)
fi

echo "==> Restarting $SERVICE..."
systemctl --user daemon-reload
systemctl --user enable "$SERVICE.service" >/dev/null 2>&1 || true
systemctl --user restart "$SERVICE.service"

echo "==> Health check..."
# NB: curl's -w already prints 000 on a connection failure, so do NOT add
# `|| echo 000` — that appends a second 000, giving "000000", which never
# equals "000" and makes the retry loop exit on the first attempt before the
# service has finished binding. (Cost one confusing "NOT responding" on a
# service that was in fact up.) `|| true` keeps set -e happy without touching
# the value.
# A body left over from an earlier run would be printed as if it were this one's.
rm -f /tmp/codex-health-homeserv.json
for _ in $(seq 1 15); do
  STATUS=$(curl -s -o /tmp/codex-health-homeserv.json -w '%{http_code}' --max-time 10 http://127.0.0.1:5207/health) || true
  [ "$STATUS" != "000" ] && break
  sleep 1
done
BODY=$(cat /tmp/codex-health-homeserv.json 2>/dev/null || true)
echo "    HTTP $STATUS — $BODY"

# 503 means the process is up but `codex login` has not been run — a distinct
# state from "not running", and the fix is a login, not a redeploy.
case "$STATUS" in
  200) echo "==> Bridge is ready." ;;
  503) echo "==> Bridge is RUNNING but not authenticated. Run: codex login --device-auth"; exit 1 ;;
  *)   echo "==> Bridge is NOT responding. Check: journalctl --user -u $SERVICE -n 50"; exit 1 ;;
esac
