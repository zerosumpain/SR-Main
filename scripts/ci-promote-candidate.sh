#!/usr/bin/env bash
# Verify that a PR-built release candidate is byte-for-source compatible with
# the current master tree and production build environment, then restamp it for
# the merge commit. Any uncertainty fails closed to a fresh build, not a deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

report() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "promoted=$1" >> "$GITHUB_OUTPUT"; fi
}

reject() {
  echo "==> Candidate rejected: $1"
  echo "==> Falling back to a fresh production build."
  rm -rf "$ROOT/build"
  rm -f \
    "$ROOT/packages/jkai-builder/dist/start.js" \
    "$ROOT/packages/jkai-codex-bridge/dist/start.js" \
    "$ROOT/packages/jkai-wa-worker/dist/start.js"
  report false
  exit 0
}

[ -f build/.deploy-sha ] || reject 'build/.deploy-sha is missing'
[ -f build/handler.js ] || reject 'build/handler.js is missing'
[ -f .env ] || reject '.env is missing'

CURRENT_SHA="$(git rev-parse HEAD)"
CURRENT_TREE="$(git rev-parse 'HEAD^{tree}')"
CURRENT_ENV="$(sha256sum .env | cut -d' ' -f1)"
STAMPED_TREE="$(sed -n 's/^tree=//p' build/.deploy-sha | head -1)"
STAMPED_ENV="$(sed -n 's/^build_env_sha256=//p' build/.deploy-sha | head -1)"

[ "$STAMPED_TREE" = "$CURRENT_TREE" ] || reject "tree is $STAMPED_TREE, expected $CURRENT_TREE"
[ "$STAMPED_ENV" = "$CURRENT_ENV" ] || reject 'build-time public environment differs from production'

BUILT_AT="$(sed -n 's/^built_at=//p' build/.deploy-sha | head -1)"
cat > build/.deploy-sha.tmp <<EOF
sha=$CURRENT_SHA
short=$(git rev-parse --short HEAD)
tree=$CURRENT_TREE
build_env_sha256=$CURRENT_ENV
branch=$(git rev-parse --abbrev-ref HEAD)
dirty=no
built_at=$BUILT_AT
promoted_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
via=github-actions-promoted
EOF
mv build/.deploy-sha.tmp build/.deploy-sha

echo "==> Reusing gate-certified candidate for tree $CURRENT_TREE"
cat build/.deploy-sha
report true
