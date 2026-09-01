#!/usr/bin/env bash
# Verify a finished build and stamp its provenance, on the machine that built it.
#
# Placing it on the VPS is ci-stage-release.sh's job. The split exists because
# the extraction check below imports the BUILT server chunks, which import from
# node_modules — and since the build moved to porkserv the release job has none.
# Running it there failed with "Cannot find package 'marked'".
#
# Runs in the `prebuild` job, which deliberately does NOT depend on the gate:
# building is ~160s of work nobody is waiting on, and it can happen while the
# gate is still deciding. Nothing here touches what production is serving — the
# release only goes live when scripts/ci-release.sh flips the symlink, and that
# runs in a job that does depend on a green gate.
#
# Expects: cwd = repo root, `npm ci` and `npm run build` already done.
set -euo pipefail

SHA="$(git rev-parse HEAD)"
TREE="$(git rev-parse 'HEAD^{tree}')"
[ -f .env ] || { echo ".env missing — build-time public environment cannot be fingerprinted" >&2; exit 1; }
BUILD_ENV_SHA256="$(sha256sum .env | cut -d' ' -f1)"

[ -d build ] || { echo "no build/ directory — did the build step run?" >&2; exit 1; }
[ -f build/handler.js ] || { echo "build/handler.js missing — the adapter did not package a server bundle" >&2; exit 1; }

# Some faults exist only after bundling and are invisible to every unit test —
# pdf.js losing its worker file took every PDF in production down for four days
# while the gate stayed green. This runs the BUILT extractor over a real PDF.
# Here rather than in the gate because the gate stubs out adapter-node, so it has
# no server bundle to check; failing here means `release` never runs.
echo "==> Checking document extraction in the built bundle..."
node scripts/check-built-extract.mjs

echo "==> Stamping deploy provenance into build/.deploy-sha..."
{
  echo "sha=$SHA"
	  echo "short=$(git rev-parse --short HEAD)"
	  echo "tree=$TREE"
	  echo "build_env_sha256=$BUILD_ENV_SHA256"
  echo "branch=$(git rev-parse --abbrev-ref HEAD)"
  echo "dirty=$([ -n "$(git status --porcelain)" ] && echo yes || echo no)"
  echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "via=github-actions"
} > build/.deploy-sha
cat build/.deploy-sha

echo "==> Build verified and stamped. ci-stage-release.sh places it on the VPS."
