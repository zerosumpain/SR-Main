#!/usr/bin/env bash
# Build every sidecar shipped alongside the web release and prove each expected
# entrypoint exists. This is deliberately strict: silently retaining an old
# sidecar makes a green candidate describe a combination that was never tested.
set -euo pipefail

npm run build:builder
npm run build:codex-bridge
npm run build:wa-worker

for bundle in \
  packages/jkai-builder/dist/start.js \
  packages/jkai-codex-bridge/dist/start.js \
  packages/jkai-wa-worker/dist/start.js
do
  if [ ! -s "$bundle" ]; then
    echo "release sidecar bundle is missing or empty: $bundle" >&2
    exit 1
  fi
done

echo "release sidecars: 3/3 built"
