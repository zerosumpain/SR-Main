#!/usr/bin/env bash
# Called with a clean environment, inside the candidate development source.
# Recover only disposable npm cache space; never prune releases or runtime data.
set -euo pipefail
install_log="$(mktemp)"
trap 'rm -f "$install_log"' EXIT
if npm ci --no-audit --no-fund >"$install_log" 2>&1; then
  cat "$install_log"
  exit 0
else
  install_status=$?
fi
cat "$install_log" >&2
if ! grep -q 'ENOSPC\|no space left on device' "$install_log"; then
  exit "$install_status"
fi
echo '==> Dependency install exhausted disk space; clearing disposable npm cache and retrying once.'
df -h .
npm cache clean --force
npm ci --no-audit --no-fund
