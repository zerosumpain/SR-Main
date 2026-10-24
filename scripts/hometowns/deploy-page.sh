#!/usr/bin/env bash
# Publish the Hometowns map page for the current ENGINE_HASH (spec §10.10, §13.4).
#
#   scripts/hometowns/deploy-page.sh --dry-run    # check everything, print the copy, change nothing
#   scripts/hometowns/deploy-page.sh              # build, verify, upload, check the live URL
#   scripts/hometowns/deploy-page.sh --dry-run --no-build   # inspect the existing dist/<hash>/ instead
#   scripts/hometowns/deploy-page.sh --dry-run --dist DIR    # inspect a build elsewhere (folder name = hash)
#
# --no-build and --dist are dry-run only: a real publish always builds from
# the checked tree, because nothing in an existing build proves which tree
# it came from (its folder, meta tag and bundled hash all come from the same
# engine-hash.generated.ts import, so a dirty build later reverted looks clean).
#
# The page lives at /projects/hometowns/<ENGINE_HASH>/mobile.html, served from
# the VPS's data/jkai-projects/hometowns/<ENGINE_HASH>/ by the projects route.
# There is no site rebuild and CI never touches that folder, so this script
# is the only writer. Rules, in order:
#
#  1. The engine tree is clean (an uncommitted engine edit would ship code no
#     PR has seen, from a public repo) and engine-hash.generated.ts is current.
#     No gitignored file feeds the build either (a .env.local, say), apart from
#     dist/, test output and the node_modules link (pinned by package-lock.json).
#  2. The build's folder name, the generated ENGINE_HASH, the page's own
#     <meta name="hometowns-engine-hash"> and the bundled engine all agree.
#  3. ADDITIVE only. Old hashes stay on disk so an open phone on an old
#     revision keeps working (§10.10); there is no --delete anywhere. If the
#     hash's folder already exists it must be byte-identical (then this is a
#     no-op); a different folder under the same hash is refused, never
#     overwritten. A new folder is uploaded to a staging name, verified, and
#     only then renamed into place, so a half-copied page is never served.
#     The staging folder doubles as a lock, so two runs cannot interleave.
#     Everything is world-readable (dirs 755, files 644) whatever the VPS umask.
#  4. The live URL returns 200, text/html, the first-party CSP (no sandbox,
#     which is what the 'hometowns' STATIC_PROJECT_KEYS entry buys) and the
#     right hash marker, and every other file in the build is served with its
#     exact bytes (scripts as JavaScript).
#
# The SSH lane is the one the other hand deploys use (deploy-builder.sh,
# deploy-codex-bridge.sh, the Marbler bundle). Override with environment
# variables; nothing secret lives here:
#
#   VPS_HOST  (157.180.19.38)   VPS_USER (johnk)   VPS_DIR (/opt/strange-rambling-svelte)
#   VPS_KEY   (~/.ssh/id_ed25519, else ~/.ssh/vps_codex, whichever exists)
#   HOMETOWNS_SITE (https://strangeramblings.com)   HOMETOWNS_LIVE_TRIES (3)
#
# Exit codes: 1 usage or environment, 2 refused locally, 3 refused by what is
# on the VPS, 4 uploaded but the live check failed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ENGINE_DIR="src/lib/games/hometowns/engine"
GENERATED="$ENGINE_DIR/engine-hash.generated.ts"
VIEW_DIR="games/hometowns-view"
MARKER="hometowns-engine-hash"

VPS_HOST="${VPS_HOST:-157.180.19.38}"
VPS_USER="${VPS_USER:-johnk}"
VPS_DIR="${VPS_DIR:-/opt/strange-rambling-svelte}"
SITE="${HOMETOWNS_SITE:-https://strangeramblings.com}"
LIVE_TRIES="${HOMETOWNS_LIVE_TRIES:-3}"
if [[ -z "${VPS_KEY:-}" ]]; then
  for k in "$HOME/.ssh/id_ed25519" "$HOME/.ssh/vps_codex"; do
    if [[ -f "$k" ]]; then VPS_KEY="$k"; break; fi
  done
fi

DRY_RUN=0
BUILD=1
DIST=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --no-build) BUILD=0 ;;
    --dist) BUILD=0; DIST="${2:?--dist needs a folder}"; shift ;;
    -h|--help) sed -n '2,50p' "$0"; exit 0 ;;
    *) echo "deploy-page: unknown option $1 (see --help)" >&2; exit 1 ;;
  esac
  shift
done
if [[ "$BUILD" == 0 && "$DRY_RUN" == 0 ]]; then
  echo "deploy-page: --no-build and --dist only go with --dry-run; a real publish builds from this checkout" >&2
  exit 1
fi

refuse() { echo "REFUSED: $*" >&2; exit 2; }
say() { echo "==> $*"; }

# ── 1. The engine tree ────────────────────────────────────────────────────────
dirty="$(git status --porcelain --untracked-files=all -- "$ENGINE_DIR" "$VIEW_DIR" scripts/hometowns/engine-hash.mjs)"
if [[ -n "$dirty" ]]; then
  echo "$dirty" >&2
  refuse "the engine or page tree has uncommitted changes; commit them first"
fi
ignored="$(git status --porcelain --ignored --untracked-files=all -- "$ENGINE_DIR" "$VIEW_DIR" \
  | sed -n 's/^!! //p' | grep -vE "^$VIEW_DIR/(dist|node_modules|test-results|playwright-report)(/|\$)" || true)"
if [[ -n "$ignored" ]]; then
  echo "$ignored" >&2
  refuse "gitignored files sit in the engine or page tree and could feed the build; move them out first"
fi
if ! node scripts/hometowns/engine-hash.mjs --check >/dev/null 2>&1; then
  node scripts/hometowns/engine-hash.mjs --check >&2 || true
  refuse "engine-hash.generated.ts is stale"
fi
HASH="$(sed -n "s/^export const ENGINE_HASH = '\([0-9a-f]*\)';$/\1/p" "$GENERATED")"
[[ "$HASH" =~ ^[0-9a-f]{16}$ ]] || refuse "could not read a 16-hex ENGINE_HASH from $GENERATED"
say "ENGINE_HASH $HASH (commit $(git rev-parse --short HEAD))"

# ── 2. The build ──────────────────────────────────────────────────────────────
if [[ "$BUILD" == 1 ]]; then
  say "Building the page"
  npm --prefix "$VIEW_DIR" run build
fi
[[ -n "$DIST" ]] || DIST="$VIEW_DIR/dist/$HASH"
DIST="${DIST%/}"
[[ -d "$DIST" ]] || refuse "no build at $DIST (run without --no-build)"
[[ "$(basename "$DIST")" == "$HASH" ]] || refuse "the build folder $(basename "$DIST") is not the current ENGINE_HASH $HASH"
[[ -f "$DIST/mobile.html" ]] || refuse "$DIST has no mobile.html"
if [[ -n "$(find "$DIST" ! -type f ! -type d)" ]]; then refuse "$DIST holds something other than files and folders"; fi
page_hash="$(sed -n "s/.*<meta name=\"$MARKER\" content=\"\([0-9a-f]*\)\".*/\1/p" "$DIST/mobile.html" | head -1)"
[[ "$page_hash" == "$HASH" ]] || refuse "mobile.html says engine hash '${page_hash:-none}', not $HASH (a stale build?)"
if ! grep -lqF "$HASH" "$DIST"/assets/*.js 2>/dev/null; then
  refuse "no script in $DIST/assets carries $HASH: the bundled engine is not this one"
fi
[[ "$BUILD" == 1 ]] || echo "    (an existing build, inspected only: a real publish rebuilds from this checkout)"

manifest() { (cd "$1" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum); }
LOCAL_MANIFEST="$(manifest "$DIST")"
count="$(printf '%s\n' "$LOCAL_MANIFEST" | grep -c .)"
bytes="$(find "$DIST" -type f -printf '%s\n' | awk '{s+=$1} END {print s+0}')"

# ── 3. The VPS ────────────────────────────────────────────────────────────────
[[ -n "${VPS_KEY:-}" && -f "$VPS_KEY" ]] || { echo "deploy-page: no SSH key (set VPS_KEY)" >&2; exit 1; }
REMOTE_ROOT="$VPS_DIR/data/jkai-projects/hometowns"
REMOTE="$REMOTE_ROOT/$HASH"
STAGING="$REMOTE_ROOT/.incoming-$HASH"
TARGET="$VPS_USER@$VPS_HOST"
SSH_OPTS=(-i "$VPS_KEY" -o BatchMode=yes -o IdentitiesOnly=yes -o ConnectTimeout=20)
remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$1"; }
q() { printf '%q' "$1"; }
REMOTE_MANIFEST_CMD='find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum'
# Prints anything the web server could not read: the hometowns/ folder or a
# hash folder's directories without r-x for others, or files without r.
bad_perms_cmd() {
  echo "find $(q "$REMOTE_ROOT") -maxdepth 0 ! -perm -005 -print; find $(q "$1") \( -type d ! -perm -005 \) -print -o \( -type f ! -perm -004 \) -print"
}

say "Reading $TARGET:$REMOTE (read-only)"
state="$(remote "if [ -e $(q "$REMOTE") ]; then echo PRESENT; cd $(q "$REMOTE") && $REMOTE_MANIFEST_CMD; else echo ABSENT; fi")"
URL="$SITE/projects/hometowns/$HASH/mobile.html"

if [[ "$(head -1 <<<"$state")" == PRESENT ]]; then
  if [[ "$(tail -n +2 <<<"$state")" == "$LOCAL_MANIFEST" ]]; then
    say "Already published and byte-identical: nothing to copy"
    COPY=0
    bad="$(remote "$(bad_perms_cmd "$REMOTE")")"
    if [[ -n "$bad" ]]; then
      echo "    but not world-readable, so the site cannot serve it:"; printf '%s\n' "$bad" | sed 's/^/      /'
      if [[ "$DRY_RUN" == 0 ]]; then
        # Only adds read (and directory search) bits; contents are untouched.
        remote "chmod go+rx $(q "$REMOTE_ROOT") && chmod -R go+rX $(q "$REMOTE")"
        say "Made it readable (go+rX)"
      fi
    fi
  else
    echo "REFUSED: $TARGET:$REMOTE already exists with different contents." >&2
    echo "         A published hash is never overwritten (an open phone may be running it)." >&2
    diff <(tail -n +2 <<<"$state") <(printf '%s\n' "$LOCAL_MANIFEST") >&2 || true
    exit 3
  fi
elif [[ "$state" == ABSENT ]]; then
  COPY=1
else
  echo "deploy-page: unexpected answer from the VPS:" >&2; echo "$state" >&2; exit 1
fi

if [[ "$COPY" == 1 ]]; then
  echo "Will copy $count files ($bytes bytes) from $DIST/ to $TARGET:$REMOTE/"
  echo "(uploaded to $STAGING/, verified, then renamed into place; nothing else under hometowns/ is touched):"
  printf '%s\n' "$LOCAL_MANIFEST" | sed 's/^/    /'
fi
if [[ "$DRY_RUN" == 1 ]]; then
  echo "Then: check $URL"
  say "Dry run: nothing was copied"
  exit 0
fi

tmp="$(mktemp -d)"
STAGED_BY_US=0
cleanup() {
  # An interrupted upload leaves no half-copied folder behind (it would be
  # publicly reachable under the slug); the live folder is never touched here.
  if [[ "$STAGED_BY_US" == 1 ]]; then remote "rm -rf $(q "$STAGING")" >/dev/null 2>&1 || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

if [[ "$COPY" == 1 ]]; then
  # mkdir without -p is the lock: it fails if another run is uploading this
  # hash, or an interrupted one could not clean up. umask 022 so the folders
  # are world-readable whatever the account's umask.
  if ! remote "umask 022 && mkdir -p $(q "$REMOTE_ROOT") && mkdir $(q "$STAGING")"; then
    echo "REFUSED: $TARGET:$STAGING exists: another deploy of $HASH is running, or one was killed." >&2
    echo "         If none is running: ssh $TARGET rm -rf $(q "$STAGING")   then rerun." >&2
    exit 3
  fi
  STAGED_BY_US=1
  say "Uploading"
  # -p with --chmod sets the modes outright (no umask); a file's bytes never vary.
  rsync -rtp --chmod=D755,F644 -e "ssh $(printf '%q ' "${SSH_OPTS[@]}")" "$DIST/" "$TARGET:$STAGING/"
  staged="$(remote "cd $(q "$STAGING") && $REMOTE_MANIFEST_CMD")"
  if [[ "$staged" != "$LOCAL_MANIFEST" ]]; then
    echo "deploy-page: the staged copy does not match the build; nothing was published" >&2
    exit 3
  fi
  bad="$(remote "$(bad_perms_cmd "$STAGING")")"
  if [[ -n "$bad" ]]; then
    printf '%s\n' "$bad" >&2
    echo "deploy-page: the staged copy is not world-readable; nothing was published" >&2
    exit 3
  fi
  # -T: never move INTO an existing folder; -n: never replace one. If the hash
  # folder appeared meanwhile, staging is still there afterwards and we stop.
  if ! remote "mv -T -n $(q "$STAGING") $(q "$REMOTE") 2>/dev/null; [ ! -e $(q "$STAGING") ]"; then
    echo "REFUSED: $REMOTE appeared while uploading; left it alone" >&2
    exit 3
  fi
  STAGED_BY_US=0
  live_manifest="$(remote "cd $(q "$REMOTE") && $REMOTE_MANIFEST_CMD")"
  [[ "$live_manifest" == "$LOCAL_MANIFEST" ]] || { echo "deploy-page: $REMOTE does not match the build after the rename" >&2; exit 3; }
  say "Published $TARGET:$REMOTE"
fi

# ── 4. The live URL ───────────────────────────────────────────────────────────
# fetch URL: sets code, ctype and leaves the headers and body in $tmp. A
# connection failure is code 000 with empty files, never a script abort.
fetch() {
  : > "$tmp/headers"; : > "$tmp/body"
  code="$(curl -sS --max-time 20 -D "$tmp/headers" -o "$tmp/body" -w '%{http_code}' "$1")" || code=000
  ctype="$(sed -n 's/^[Cc]ontent-[Tt]ype: *//p' "$tmp/headers" | tr -d '\r' | tail -1 || true)"
}

# Sets problem to the first thing wrong with what is served, or "".
live_problem() {
  fetch "$URL"
  local csp served path want got
  csp="$(sed -n 's/^[Cc]ontent-[Ss]ecurity-[Pp]olicy: *//p' "$tmp/headers" | tr -d '\r' | tail -1 || true)"
  served="$(sed -n "s/.*<meta name=\"$MARKER\" content=\"\([0-9a-f]*\)\".*/\1/p" "$tmp/body" | head -1 || true)"
  if [[ "$code" != 200 ]]; then
    problem="HTTP $code for mobile.html (000 is no connection; a 404 for a published file means the 'hometowns' STATIC_PROJECT_KEYS entry is not live yet)"
    return
  elif [[ "$ctype" != text/html* ]]; then
    problem="content type '$ctype', not text/html"; return
  elif [[ -z "$csp" || "$csp" == *sandbox* ]]; then
    problem="the page is served with the sandboxed CSP, which stops its module worker (is 'hometowns' in STATIC_PROJECT_KEYS on the live site?)"
    return
  elif [[ "$served" != "$HASH" ]]; then
    problem="the served page's hash marker is '${served:-none}', not $HASH"; return
  fi
  # Every other file: same bytes, and scripts typed as JavaScript (a module
  # worker refuses anything else).
  while read -r want path; do
    path="${path#./}"
    [[ "$path" == mobile.html ]] && continue
    fetch "$SITE/projects/hometowns/$HASH/$path"
    if [[ "$code" != 200 ]]; then problem="HTTP $code for $path"; return; fi
    got="$(sha256sum < "$tmp/body" | cut -d' ' -f1)"
    if [[ "$got" != "$want" ]]; then problem="$path is served with different bytes"; return; fi
    if [[ "$path" == *.js && "$ctype" != *javascript* ]]; then problem="$path is served as '$ctype', not JavaScript"; return; fi
  done <<<"$LOCAL_MANIFEST"
  problem=""
}

say "Checking $URL and the $((count - 1)) files beside it"
problem=""
for ((try = 1; try <= LIVE_TRIES; try++)); do
  live_problem
  [[ -z "$problem" ]] && break
  if [[ "$try" -lt "$LIVE_TRIES" ]]; then echo "    try $try: $problem" >&2; sleep 2; fi
done
if [[ -n "$problem" ]]; then
  if [[ "$COPY" == 1 ]]; then echo "The upload itself succeeded: $REMOTE is on the VPS." >&2; fi
  echo "LIVE CHECK FAILED: $problem" >&2
  exit 4
fi
say "Live: 200 text/html, first-party CSP, marker $HASH, $count files byte-identical"
echo "    $URL"
