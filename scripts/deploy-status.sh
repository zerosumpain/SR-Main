#!/usr/bin/env bash
# Fast, read-only answer to "is the release missing, or is my PWA stale?"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SITE="${1:-https://strangeramblings.com}"
SITE="${SITE%/}"
if [ -n "${2:-}" ]; then
  EXPECTED="$2"
elif command -v gh >/dev/null 2>&1; then
  EXPECTED="$(gh api 'repos/{owner}/{repo}/commits/master' --jq .sha 2>/dev/null \
    || git rev-parse origin/master 2>/dev/null \
    || git rev-parse HEAD)"
else
  EXPECTED="$(git rev-parse origin/master 2>/dev/null || git rev-parse HEAD)"
fi
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "==> Reading uncached deployment identity from $SITE/api/version"
curl --fail --silent --show-error \
  -H 'Cache-Control: no-cache' \
  "$SITE/api/version?t=$(date +%s)" > "$TMP"

set +e
node - "$TMP" "$EXPECTED" <<'NODE'
const fs = require('node:fs');
const [file, expected] = process.argv.slice(2);
const version = JSON.parse(fs.readFileSync(file, 'utf8'));
console.log(`live sha:   ${version.sha ?? 'unknown'}`);
console.log(`live tree:  ${version.tree ?? 'unknown'}`);
console.log(`built at:   ${version.builtAt ?? 'unknown'}`);
console.log(`via:        ${version.via ?? 'unknown'}`);
console.log(`expected:   ${expected}`);
if (!version.sha || !expected.startsWith(version.sha) && !version.sha.startsWith(expected)) process.exit(2);
NODE
STATUS=$?
set -e

if command -v gh >/dev/null 2>&1; then
  echo
  echo "==> Latest master workflow"
  gh run list --workflow CI --branch master --limit 1 \
    --json databaseId,status,conclusion,headSha,createdAt,url \
    --template '{{range .}}{{.status}} / {{.conclusion}}  {{.headSha}}  {{.url}}{{"\n"}}{{end}}' || true
fi

echo
if [ "$STATUS" -eq 0 ]; then
  echo "DEPLOYED: production is on the expected commit. If the UI is old, reopen the PWA"
  echo "or accept its Update now prompt; another deploy will not change the server."
else
  echo "NOT DEPLOYED: production does not match the expected commit. Inspect the master"
  echo "workflow before rebuilding or re-running anything."
fi
exit "$STATUS"
