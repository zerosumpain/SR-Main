#!/usr/bin/env bash
# Verify that a PR-built release candidate is byte-for-source compatible with
# the current master tree and production build environment, then restamp it for
# the merge commit. Any uncertainty fails closed to a fresh build, not a deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The candidate is downloaded into a STAGING DIRECTORY, never over the checkout.
#
# It used to be unpacked with `path: .`, straight over the repository root, and
# the very next workflow step ran this script — a file the archive was therefore
# free to replace first. The artifact is named `candidate-<tree>` and is accepted
# on that name plus the name of a job in its producing run, both of which any
# pull_request run in a PUBLIC repo can arrange. That made "we found a
# candidate" equivalent to arbitrary code execution as the runner user, on a box
# with passwordless sudo.
#
# Nothing leaves this directory except the four paths the upload step puts in
# it. Anything else is not a candidate to be fixed up, it is a candidate to be
# thrown away.
STAGING="${CANDIDATE_DIR:-$ROOT/.candidate}"

# Exactly the non-build entries of the `Upload release candidate` step in
# ci.yml. Keep the two in step: a path added there and not here rejects every
# candidate, which fails closed to a fresh build rather than shipping something
# unverified.
ALLOWED_FILES=(
  packages/jkai-builder/dist/start.js
  packages/jkai-codex-bridge/dist/start.js
  packages/jkai-wa-worker/dist/start.js
)

report() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "promoted=$1" >> "$GITHUB_OUTPUT"; fi
}

reject() {
  echo "==> Candidate rejected: $1"
  echo "==> Falling back to a fresh production build."
  rm -rf "$STAGING" "$ROOT/build"
  rm -f \
    "$ROOT/packages/jkai-builder/dist/start.js" \
    "$ROOT/packages/jkai-codex-bridge/dist/start.js" \
    "$ROOT/packages/jkai-wa-worker/dist/start.js"
  report false
  exit 0
}

[ -d "$STAGING" ] || reject "no candidate staged at $STAGING"

# Refuse anything that is not a regular file. A symlink would satisfy the path
# allow-list below while still resolving anywhere on the runner.
if find "$STAGING" -mindepth 1 ! -type d ! -type f -print -quit | grep -q .; then
  reject 'candidate contains a non-regular file (symlink, device or socket)'
fi

# Every file must be inside build/, or be one of the three named sidecars.
while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  case "$rel" in
    build/*) continue ;;
  esac
  ok=no
  for allowed in "${ALLOWED_FILES[@]}"; do
    [ "$rel" = "$allowed" ] && { ok=yes; break; }
  done
  [ "$ok" = yes ] || reject "candidate carries an unexpected path: $rel"
done < <(cd "$STAGING" && find . -type f | sed 's|^\./||')

[ -f "$STAGING/build/.deploy-sha" ] || reject 'build/.deploy-sha is missing'
[ -f "$STAGING/build/handler.js" ] || reject 'build/handler.js is missing'
[ -f .env ] || reject '.env is missing'

CURRENT_SHA="$(git rev-parse HEAD)"
CURRENT_TREE="$(git rev-parse 'HEAD^{tree}')"
CURRENT_ENV="$(sha256sum .env | cut -d' ' -f1)"
STAMPED_TREE="$(sed -n 's/^tree=//p' "$STAGING/build/.deploy-sha" | head -1)"
STAMPED_ENV="$(sed -n 's/^build_env_sha256=//p' "$STAGING/build/.deploy-sha" | head -1)"

[ "$STAMPED_TREE" = "$CURRENT_TREE" ] || reject "tree is $STAMPED_TREE, expected $CURRENT_TREE"
[ "$STAMPED_ENV" = "$CURRENT_ENV" ] || reject 'build-time public environment differs from production'

# Only now, with the contents checked and the tree proven identical, does
# anything move out of staging.
rm -rf "$ROOT/build"
mv "$STAGING/build" "$ROOT/build"
for allowed in "${ALLOWED_FILES[@]}"; do
  if [ -f "$STAGING/$allowed" ]; then
    mkdir -p "$ROOT/$(dirname "$allowed")"
    mv "$STAGING/$allowed" "$ROOT/$allowed"
  fi
done
rm -rf "$STAGING"

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
