#!/usr/bin/env bash
# Put a previously-deployed release back in front of the public, now.
#
# WHY THIS EXISTS. Until 2026-09-16 the only rollback in the system was
# rollback_web_release() inside ci-release.sh, which fires in exactly one
# situation: a release that failed to serve its own SHA within 90 seconds. It
# reaches back exactly one release, it only runs inside a CI job, and it is
# unreachable once that job has finished. So the case that actually happens —
# "it deployed cleanly and it is wrong" — had no path back at all. Recovery was
# a revert PR through the full gate, about ten minutes, or a direct push to
# master, which is the thing the branch ruleset is meant to stop.
#
# This script is the reason it is safe to close that escape hatch.
#
#   scripts/rollback.sh <sha>             # roll back to a release on this box
#   scripts/rollback.sh <sha> --dry-run   # say what would happen, change nothing
#   scripts/rollback.sh --list            # what is available to roll back to
#
# WHAT IT DOES NOT DO, and this is not a caveat to skim:
#
#   * It does NOT undo a `drizzle-kit push`. The schema moved forward with the
#     bad release and stays forward. Rolling code back onto a newer schema is
#     usually fine (the columns the old code reads still exist) and is exactly
#     wrong when the release dropped or renamed something.
#   * It does NOT roll the sidecars back — jkai-builder, jkai-codex-bridge,
#     jkai-wa-worker keep running whatever ci-apply-sidecars.sh last applied.
#   * It does NOT touch the development sandbox or the Webframe container.
#
# It moves the WEB CODE and nothing else. If the bad release also changed the
# schema, roll back and then deal with the schema deliberately — the banner
# below will tell you that is the situation you are in.
set -uo pipefail

VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SERVICE="${SERVICE:-strange-rambling-svelte}"
PUBLIC_URL="${PUBLIC_URL:-https://strangeramblings.com}"
PUBLIC_BASE="${PUBLIC_URL%/}"
STATE_DIR="$VPS_DIR/.deploy-state"

die() { echo "==> $1" >&2; exit 1; }

current_sha() {
  sed -n 's/^sha=//p' "$VPS_DIR/build/.deploy-sha" 2>/dev/null | head -1
}

list_releases() {
  echo "Releases present on this box (newest first):"
  local live
  live="$(readlink -f "$VPS_DIR/build" 2>/dev/null || true)"
  ls -1dt "$VPS_DIR"/releases/*/ 2>/dev/null | while read -r d; do
    local sha marker built
    sha="$(basename "$d")"
    marker=""
    [ "$(readlink -f "$d")" = "$live" ] && marker="  <- LIVE"
    built="$(sed -n 's/^built_at=//p' "$d/.deploy-sha" 2>/dev/null | head -1)"
    printf '  %s  %s%s\n' "${sha:0:12}" "${built:-unknown}" "$marker"
  done
}

[ $# -ge 1 ] || { echo "usage: scripts/rollback.sh <sha> | --list" >&2; list_releases; exit 2; }

if [ "$1" = "--list" ] || [ "$1" = "-l" ]; then
  list_releases
  exit 0
fi

TARGET="$1"
DRY_RUN=""
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1

# Accept a short sha and resolve it, so an operator reading /releases or a
# WhatsApp alert can paste what they have.
if [ ! -d "$VPS_DIR/releases/$TARGET" ]; then
  MATCHES="$(ls -1d "$VPS_DIR/releases/$TARGET"* 2>/dev/null || true)"
  COUNT="$(printf '%s\n' "$MATCHES" | grep -c . || true)"
  if [ "$COUNT" = "1" ]; then
    TARGET="$(basename "$MATCHES")"
  elif [ "$COUNT" = "0" ]; then
    echo "==> No release directory for '$TARGET'." >&2
    list_releases >&2
    exit 1
  else
    echo "==> '$TARGET' is ambiguous:" >&2
    printf '%s\n' "$MATCHES" >&2
    exit 1
  fi
fi

RELEASE_DIR="$VPS_DIR/releases/$TARGET"
[ -f "$RELEASE_DIR/handler.js" ] || die "$RELEASE_DIR has no handler.js — it is not a runnable release."

CURRENT="$(current_sha)"
if [ "$CURRENT" = "$TARGET" ]; then
  die "Already serving $TARGET. Nothing to do."
fi

# REFUSE WHILE A RELEASE IS IN FLIGHT. Two processes moving the symlink at once
# is how you end up serving a release nobody chose, and the CI job would
# overwrite this rollback seconds later while reporting success.
#
# Read from the PID file ci-release.sh writes and clears on exit, not from
# `pgrep -f ci-release.sh` — that matched any command line that merely MENTIONED
# the script, so a grep, an editor or a shell with the name in its history
# refused a legitimate rollback. `kill -0` asks whether the process is actually
# alive, which also clears a stale file left by a hard kill.
RELEASE_PID_FILE="$STATE_DIR/release.pid"
if [ -f "$RELEASE_PID_FILE" ]; then
  RELEASE_PID="$(cat "$RELEASE_PID_FILE" 2>/dev/null || true)"
  if [ -n "$RELEASE_PID" ] && kill -0 "$RELEASE_PID" 2>/dev/null; then
    die "A release is in flight (ci-release.sh, pid $RELEASE_PID). Wait for it to finish, then roll back."
  fi
  echo "==> Ignoring a stale release lock (pid ${RELEASE_PID:-unknown} is not running)."
fi

echo "==> Rolling back"
echo "    from: ${CURRENT:-<unknown>}"
echo "    to:   $TARGET"

# Say plainly when this is a PARTIAL rollback. The schema and the dependency
# tree moved with the bad release and are not moving back; if they changed, the
# operator needs to know that before they assume the site is as it was.
# Deliberately derived from file mtimes rather than a stamp in .deploy-sha.
# ci-prebuild.sh stamps sha, tree, build_env_sha256, branch, dirty, built_at and
# via — there is no lockfile or schema field to read, and inventing a comparison
# against a field that does not exist would produce a check that silently never
# fires. That is the failure mode this whole change set keeps finding.
#
# What IS knowable: ci-release.sh writes $STATE_DIR/schema.sha256 and
# lockfile.sha256 only when it actually applies a change. So if either is newer
# than the release being rolled back to, something moved forward after that
# release was built and is not moving back with it.
PARTIAL=""
for marker in schema:schema.sha256 dependencies:lockfile.sha256; do
  label="${marker%%:*}"
  file="$STATE_DIR/${marker##*:}"
  if [ -f "$file" ] && [ -d "$RELEASE_DIR" ] && [ "$file" -nt "$RELEASE_DIR" ]; then
    PARTIAL="${PARTIAL}    - the ${label} moved forward after this release was built, and stays forward\n"
  fi
done
echo ""
echo "==> This rolls back the WEB CODE ONLY."
echo "    Not the database schema. Not the systemd sidecars. Not Webframe."
if [ -n "$PARTIAL" ]; then
  echo ""
  echo "==> PARTIAL ROLLBACK — specifically:"
  printf "%b" "$PARTIAL"
  echo "    Old code against a newer schema is usually fine, and is exactly wrong"
  echo "    if the release you are undoing dropped or renamed something."
fi
echo ""

# Record where we came from, so a second rollback has somewhere to go and so
# the next release's own bookkeeping is not confused by a symlink it did not
# move.
mkdir -p "$STATE_DIR"
[ -n "$CURRENT" ] && echo "$CURRENT" > "$STATE_DIR/previous.sha"

if [ -n "$DRY_RUN" ]; then
  echo "==> --dry-run: stopping here. Nothing has been changed."
  echo "    Without it, this would point build/ at releases/$TARGET,"
  echo "    restart $SERVICE, and wait for $PUBLIC_BASE to report $TARGET."
  exit 0
fi

ln -sfn "releases/$TARGET" "$VPS_DIR/build.rollback"
mv -Tf "$VPS_DIR/build.rollback" "$VPS_DIR/build"
echo "    build -> $(readlink "$VPS_DIR/build")"
echo "$TARGET" > "$STATE_DIR/live.sha"

echo "==> Restarting $SERVICE..."
sudo systemctl restart "$SERVICE"

echo "==> Verifying against the PUBLIC url..."
DEADLINE=$(( $(date +%s) + 90 ))
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ACTUAL="$(curl -fsS -H 'Cache-Control: no-cache' "$PUBLIC_BASE/api/version?expected=$TARGET" 2>/dev/null \
    | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [ "$ACTUAL" = "$TARGET" ] && curl -fsS -o /dev/null -H 'Cache-Control: no-cache' "$PUBLIC_BASE/"; then
    echo "==> Rolled back. $PUBLIC_BASE/api/version reports $TARGET"
    exit 0
  fi
  [ -n "$ACTUAL" ] && echo "    waiting: public /api/version reports $ACTUAL"
  sleep 3
done

echo "==> ERROR: $PUBLIC_BASE did not report $TARGET within 90s. Service state:" >&2
systemctl is-active "$SERVICE" >&2 || true
sudo journalctl -u "$SERVICE" --no-pager -n 30 >&2
exit 1
