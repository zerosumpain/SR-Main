#!/usr/bin/env bash
# Stage a finished build as a release directory on the VPS.
#
# Runs in the `prebuild` job, which deliberately does NOT depend on the gate:
# building is ~160s of work nobody is waiting on, and it can happen while the
# gate is still deciding. Nothing here touches what production is serving — the
# release only goes live when scripts/ci-release.sh flips the symlink, and that
# runs in a job that does depend on a green gate.
#
# Expects: cwd = repo root, `npm ci` and `npm run build` already done.
set -euo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SHA="$(git rev-parse HEAD)"
RELEASE_DIR="$VPS_DIR/releases/$SHA"

[ -d build ] || { echo "no build/ directory — did the build step run?" >&2; exit 1; }
[ -f build/handler.js ] || { echo "build/handler.js missing — the adapter did not package a server bundle. Is SR_GATE_STUB_ADAPTER set? It must never be set here." >&2; exit 1; }

echo "==> Stamping deploy provenance into build/.deploy-sha..."
{
  echo "sha=$SHA"
  echo "short=$(git rev-parse --short HEAD)"
  echo "branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "dirty=$([ -n "$(git status --porcelain)" ] && echo yes || echo no)"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "via=github-actions"
} > build/.deploy-sha
cat build/.deploy-sha

# Copy to .partial and rename. A release directory either exists complete or
# does not exist — a half-copied one must never be mistaken for shippable, and
# ci-release.sh's only precondition is that the directory is there.
echo "==> Staging release $SHA..."
mkdir -p "$VPS_DIR/releases"
rm -rf "$RELEASE_DIR.partial"
rsync -a build/ "$RELEASE_DIR.partial/"
rm -rf "$RELEASE_DIR"
mv -T "$RELEASE_DIR.partial" "$RELEASE_DIR"

echo "==> Staged $(du -sh "$RELEASE_DIR" | cut -f1) at $RELEASE_DIR"
echo "==> Not live yet — ci-release.sh flips the symlink once the gate is green."
