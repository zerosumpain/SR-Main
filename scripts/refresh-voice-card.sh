#!/usr/bin/env bash
#
# Rebuild the Voice Card from the live corpus and open a PR when it has moved.
#
#   scripts/refresh-voice-card.sh [--dry-run] [--corpus FILE]
#
# --dry-run  does everything up to the push: exports, rebuilds, prints the diff
#            and the PR body it would have opened, then throws the branch away.
# --corpus   skips the export and reads a corpus file instead. For testing, and
#            for a second run that should not hit production again.
#
# WHY THIS EXISTS. The card is measured from the blog posts tagged
# authorship='human'. Writing a post therefore changes nothing on its own — the
# numbers only move when somebody exports the corpus, re-runs the builder and
# commits the result, and "somebody remembers to do a four-step manual job" is
# not a mechanism. Left alone the card describes the writer John was on the day
# it was built, for as long as that goes unnoticed. This job does the four steps
# on a schedule.
#
# IT OPENS A PR. IT DOES NOT COMMIT TO MASTER. The card is the single
# description of how every automated writer sounds — the blog assistant, jkai
# chat, the Engine Room, briefings, release notes, sr-docs, and the two Claude
# prompt stacks. A silent overnight rewrite of that would be untraceable, and
# the first sign of a bad rebuild would be everything quietly writing wrong.
# Same rule the drift job already follows: propose, never apply.
#
# WHAT IT DELIBERATELY LEAVES ALONE. The exemplars. A rebuild re-measures the
# numbers and re-ranks the distinctive terms; it never picks new passages,
# because which six paragraphs represent a writer is a judgement and selection
# is pinned for prompt-cache reasons besides. The PR says so, and lists the
# posts the card had not seen so the choice is at least in front of you.
#
# HOMESERV ONLY, and it needs no rsync line in ci-release.sh — the same rule
# sync-voice.sh records. It runs nowhere but this box: it wants the repo, the
# VPS ssh key, gh, and node_modules, and the VPS has none of that.
#
# Scheduled 07:00 on the 1st via crontab, an hour after the in-app drift job at
# 06:00 so the datastore note lands first and the two agree about what moved.
# Cron calls ~/bin/voice-card-refresh.sh rather than this path: the checkout is
# routinely parked on a feature branch, where this file is a different version
# or is not there at all, so the wrapper reads it out of origin/master instead.
set -uo pipefail   # NOT -e: several steps have expected-nonzero exits (the
                   # drift check exits 1 on material drift, --check exits 1 when
                   # out of date) that must be read rather than aborted on.

REPO="${VOICE_REPO:-$HOME/strange_rambling_svelte}"
# What the rebuild is measured against and branched from. Master in every real
# run; overridable so the job can be exercised against a branch before the code
# it needs has landed there.
BASE_REF="${VOICE_BASE_REF:-origin/master}"
VPS_HOST="johnk@157.180.19.38"
SSH_KEY="$HOME/.ssh/id_ed25519"
CONTAINER="strange-rambling-app-db-1"

STATE_DIR="$HOME/.cache/voice-card-refresh"
WORKTREE="$STATE_DIR/worktree"
CORPUS="$STATE_DIR/corpus.json"
LOCK="$STATE_DIR/lock"
LOG="$STATE_DIR/refresh.log"
STATE_REPORT="$STATE_DIR/last-failure"

BRIDGE="http://127.0.0.1:3000/send"
# Never hardcoded here: the number does not go in the repo. The crontab line
# supplies it; without it the job still runs and simply logs instead.
CHAT_ID="${VOICE_ALERT_CHAT_ID:-}"

DRY_RUN=0
CORPUS_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --corpus)  CORPUS_OVERRIDE="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }

notify() {
  local text="$1" payload code
  if [[ -z "$CHAT_ID" ]]; then
    log "no VOICE_ALERT_CHAT_ID set — would have said: $text"
    return
  fi
  payload=$(python3 -c 'import json,sys; print(json.dumps({"chatId": sys.argv[1], "message": sys.argv[2]}))' \
    "$CHAT_ID" "$text")
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 20 -X POST "$BRIDGE" \
    -H 'Content-Type: application/json' -d "$payload" 2>/dev/null) || code=000
  [[ "$code" == "200" ]] && log "notified (HTTP $code)" \
                         || log "NOTIFY FAILED (HTTP $code) — bridge down? message was: $text"
}

# A failure that repeats every month is how a monitor gets muted. Say it once.
notify_if_changed() {
  local text="$1" prev
  prev=$(cat "$STATE_REPORT" 2>/dev/null || echo "")
  printf '%s' "$text" > "$STATE_REPORT"
  if [[ "$text" == "$prev" ]]; then
    log "same failure as last run — not alerting again"
  else
    notify "$text"
  fi
}

cleanup() {
  # The export holds unpublished drafts and private chat turns. It does not
  # outlive the run, and it never sits in the repo (docs/voice-corpus.md).
  [[ -n "$CORPUS_OVERRIDE" ]] || rm -f "$CORPUS"
  if [[ -d "$WORKTREE" ]]; then
    git -C "$REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1 \
      || rm -rf "$WORKTREE"
  fi
}
finish() {
  local rc="${1:-0}"
  cleanup
  tail -n 5000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
  exit "$rc"
}

# --- 0. one instance only -------------------------------------------------
exec 9>"$LOCK"
if ! flock -n 9; then
  log "another run holds the lock — exiting quietly"
  exit 0
fi
trap 'finish 1' INT TERM

log "=== run start (base $BASE_REF) ==="
[[ -d "$REPO/.git" ]] || { log "FATAL: $REPO is not a checkout"; finish 1; }

# --- 1. a clean worktree at origin/master ---------------------------------
# Never the main checkout: it is routinely parked on somebody's feature branch,
# and two Claude sessions share it. A throwaway worktree cannot land a commit
# on top of in-progress work, and it guarantees the builder that runs is
# master's builder rather than whatever is checked out.
git -C "$REPO" fetch --quiet origin "${BASE_REF#origin/}" || { log "FATAL: git fetch failed"; finish 1; }
git -C "$REPO" worktree remove --force "$WORKTREE" >/dev/null 2>&1
rm -rf "$WORKTREE"
if ! git -C "$REPO" worktree add --detach "$WORKTREE" "$BASE_REF" >>"$LOG" 2>&1; then
  log "FATAL: could not create the worktree"
  notify_if_changed "🔴 voice-card refresh could not create its worktree. See $LOG."
  finish 1
fi

# Hard-linked, never symlinked: a symlinked node_modules resolves to its real
# path and breaks module resolution in ways that look like code problems.
# ~1 second, no extra disk, and it is thrown away with the worktree.
cp -al "$REPO/node_modules" "$WORKTREE/node_modules" 2>>"$LOG" || {
  log "FATAL: could not hard-link node_modules"
  notify_if_changed "🔴 voice-card refresh could not hard-link node_modules. See $LOG."
  finish 1
}
cd "$WORKTREE" || finish 1

# --- 2. catch up the stacks that do not share this filesystem -------------
# If a previous month's PR was merged, master now carries a card that the Claude
# skill and sr-docs have never seen — and until sync-voice.sh runs,
# the merge changed nothing about how anything actually writes. Do it first, so
# a merged card takes effect even in a month where nothing new gets proposed.
if [[ $DRY_RUN -eq 0 ]]; then
  if scripts/sync-voice.sh --check >>"$LOG" 2>&1; then
    log "downstream stacks already match master's card"
  else
    log "master's card is newer than the synced copies — syncing"
    if scripts/sync-voice.sh >>"$LOG" 2>&1; then
      # sr-docs is its own repo and sync-voice.sh deliberately leaves committing
      # to the caller. Explicit paths only.
      git -C "$HOME/sr-docs" add content/internal/design-system/john-voice.md >/dev/null 2>&1 \
        && git -C "$HOME/sr-docs" commit -q -m "voice: sync the card from master" >/dev/null 2>&1 \
        && log "committed the sr-docs page"
      notify "🗣️ The voice card that was merged is now live everywhere.

The john-voice Claude skill and sr-docs have been re-rendered from master's
card."
    else
      log "sync-voice.sh FAILED"
      notify_if_changed "🔴 voice sync failed after a card merge

Master carries a new card but the Claude skill and sr-docs still hold the old
one.
  cd ~/strange_rambling_svelte && scripts/sync-voice.sh"
    fi
  fi
fi

# --- 3. export the corpus -------------------------------------------------
# Read-only, and the query itself excludes WhatsApp-sourced chat turns rather
# than filtering them afterwards — that content should not reach a file on disk
# in the first place. Same query as docs/voice-corpus.md.
if [[ -n "$CORPUS_OVERRIDE" ]]; then
  CORPUS="$(readlink -f "$CORPUS_OVERRIDE")"
  [[ -f "$CORPUS" ]] || { log "FATAL: no such corpus file: $CORPUS"; finish 64; }
  log "using the corpus file given on the command line: $CORPUS"
else
  log "exporting the corpus from production"
  rm -f "$CORPUS"
  # -n matters: without it ssh reads this script's stdin, and when the script is
  # itself being piped into bash (which is how cron invokes it) it swallows
  # every line after this one. The run then ends here, quietly, exit 0.
  ssh -n -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=20 "$VPS_HOST" \
    "docker exec $CONTAINER sh -lc 'psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"select json_build_object(
        '\''posts'\'', (select json_agg(json_build_object('\''id'\'', id, '\''slug'\'', slug, '\''authorship'\'', authorship, '\''content'\'', content)) from blog_posts),
        '\''chat'\'',  (select json_agg(o.content) from orchestrator_chats o join jkai_conversations c on c.id = o.conversation_id where o.role = '\''user'\'' and c.source = '\''web'\''),
        '\''resolutions'\'', (select json_agg(content order by created_at) from blog_assistant_messages where role = '\''proposal_resolved'\''))\"'" \
    > "$CORPUS" 2>>"$LOG"
  chmod 600 "$CORPUS" 2>/dev/null

  # A truncated or empty export must never reach the builder. It would measure
  # a corpus of nothing, produce a card describing a writer who does not exist,
  # and the PR would look exactly like a real one.
  POSTS=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d.get("posts") or []))' "$CORPUS" 2>/dev/null || echo 0)
  if [[ "${POSTS:-0}" -lt 5 ]]; then
    log "export unusable — $POSTS post(s)"
    notify_if_changed "🔴 voice-card refresh could not read the corpus

The export came back with ${POSTS} posts, which is fewer than production has
ever held, so nothing was rebuilt and the card is untouched. Usually the ssh
key, the db container name, or psql env vars.
  ssh -i ~/.ssh/id_ed25519 $VPS_HOST"
    finish 1
  fi
  log "exported $POSTS post(s)"
fi

# --- 4. what moved, measured against the card as committed ----------------
# Before the rebuild: the drift report compares a fresh measurement to the
# card currently on master, and after step 5 there is no such card left to
# compare against. Exit 1 means material, which is a finding, not a failure.
DRIFT_OUT=$(npx tsx scripts/voice-drift.ts --corpus "$CORPUS" 2>&1); DRIFT_RC=$?
printf '%s\n' "$DRIFT_OUT" >> "$LOG"
if [[ $DRIFT_RC -gt 1 ]]; then
  log "drift check crashed (rc=$DRIFT_RC)"
  notify_if_changed "🔴 voice-card refresh: the drift check crashed

$(printf '%s' "$DRIFT_OUT" | tail -20)"
  finish 1
fi

# --- 5. rebuild -----------------------------------------------------------
BUILD_OUT=$(npx tsx scripts/build-voice-card.ts --corpus "$CORPUS" --write 2>&1); BUILD_RC=$?
printf '%s\n' "$BUILD_OUT" >> "$LOG"
if [[ $BUILD_RC -ne 0 ]]; then
  log "builder failed (rc=$BUILD_RC)"
  notify_if_changed "🔴 voice-card refresh: the builder failed

$(printf '%s' "$BUILD_OUT" | tail -25)

The committed card is untouched."
  finish 1
fi

# --- 6. the common case: the card did not move ----------------------------
# The build stamp is derived from the corpus rather than the clock, so an
# unchanged corpus rebuilds byte-identically and there is nothing to propose.
CHANGED=$(git status --porcelain data/voice/)
if [[ -z "$CHANGED" ]]; then
  log "card unchanged — nothing to propose"
  finish 0
fi
log "card moved:"
printf '%s\n' "$CHANGED" | tee -a "$LOG"

# --- 7. the PR body -------------------------------------------------------
NEW_POSTS=$(printf '%s' "$DRIFT_OUT" | sed -n 's/^ *new *\([0-9]*\) post.*/\1/p' | head -1)
NEW_POSTS="${NEW_POSTS:-0}"
CORPUS_LINE=$(printf '%s' "$DRIFT_OUT" | sed -n 's/^ *corpus *//p' | head -1)
VERSION=$(python3 -c 'import json;print(json.load(open("data/voice/voice-card.json"))["version"])' 2>/dev/null || echo '?')

# The posts that were actually measured, by slug. The ids come out of the
# builder's own report rather than being recomputed here: "tagged human" is not
# the same set as "measured" — six rows sit below the prose floor — and a
# tag-stripping regex overcounts words by about a quarter against the
# plainTextFromHtml the builder uses, so any second opinion would be wrong.
MEASURED_IDS=$(printf '%s' "$BUILD_OUT" | sed -n 's/^ *human posts *[0-9]* *(ids \(.*\))$/\1/p' | head -1)
MEASURED_POSTS=$(IDS="$MEASURED_IDS" python3 - "$CORPUS" <<'PY' 2>/dev/null || true
import json, os, sys
ids = {int(x) for x in os.environ.get('IDS', '').replace(',', ' ').split() if x.strip().isdigit()}
posts = json.load(open(sys.argv[1])).get('posts') or []
for p in sorted((p for p in posts if p.get('id') in ids), key=lambda p: p.get('id', 0)):
    print(f"- `{p['slug']}`")
PY
)

# What actually changed in the file. The drift table above only speaks for
# public-prose, so on a month where his posts held still but the chat corpus or
# the contrast set grew, it reads "nothing moved" over a diff that plainly did.
# This is derived from the two files rather than described from memory.
CARD_CHANGES=$(python3 - <<'PY' 2>/dev/null || true
import json, subprocess
new = json.load(open('data/voice/voice-card.json'))
try:
    old = json.loads(subprocess.run(['git', 'show', 'HEAD:data/voice/voice-card.json'],
                                    capture_output=True, text=True, check=True).stdout)
except Exception:
    print('- the card is new; there is nothing to compare it against')
    raise SystemExit

out = []
if old.get('version') != new.get('version'):
    out.append(f"- card version {old.get('version')} → {new.get('version')}")
oc, nc = old.get('corpus') or {}, new.get('corpus') or {}
for key, label in (('posts', 'human posts'), ('words', 'words of his prose'),
                   ('contrastPosts', 'generated posts in the contrast set'),
                   ('contrastWords', 'words in the contrast set')):
    if oc.get(key) != nc.get(key) and (oc.get(key) is not None or nc.get(key) is not None):
        out.append(f"- {label}: {oc.get(key)} → {nc.get(key)}")

for reg in sorted(set(old.get('registers', {})) | set(new.get('registers', {}))):
    om = (old.get('registers', {}).get(reg) or {}).get('measured') or {}
    nm = (new.get('registers', {}).get(reg) or {}).get('measured') or {}
    if om == nm:
        continue
    moved = []
    for field in ('posts', 'words', 'sentences', 'fleschReadingEase'):
        if om.get(field) != nm.get(field):
            moved.append(f"{field} {om.get(field)} → {nm.get(field)}")
    if om.get('distinctive') != nm.get('distinctive'):
        moved.append('distinctive terms re-ranked')
    out.append(f"- **{reg}**: " + ('; '.join(moved) if moved else 'measurements changed'))

print('\n'.join(out) if out else '- only the build stamp; the measurements are identical')
PY
)

PAIRS=$(printf '%s' "$BUILD_OUT" | sed -n 's/^ *\([0-9]*\) from \([0-9]*\) resolution.*/\1 from \2 resolution(s)/p' | head -1)

if [[ "$NEW_POSTS" != "0" ]]; then
  TITLE="voice: the card catches up with ${NEW_POSTS} post(s) it had never seen"
  OPENER="I wrote something, so the card that describes how I write is out of date."
else
  # No new posts of mine, but the corpus underneath still moved — more chat
  # turns, another generated post in the contrast set. Say that, rather than
  # claiming prose drift the drift table has just denied.
  TITLE="voice: the card catches up with the corpus underneath it"
  OPENER="No new posts of mine this month, but the corpus the card is measured over has moved anyway."
fi

BODY="$(cat <<EOF
${OPENER} This is the rebuild — measured from the posts tagged
\`authorship='human'\` in production as of $(date -u +%F), card v${VERSION}.

Opened by \`scripts/refresh-voice-card.sh\` on homeserv. It proposes; merging is
still a decision, because this file is the only description of how every
automated writer sounds and a rebuild nobody read would be untraceable.

## What changed in the file

${CARD_CHANGES}

${PAIRS:+Preference pairs: ${PAIRS}. Only rejections and acceptances I rewrote
before applying carry a signal, so a run of straight acceptances correctly
produces none.}

## What that says about the prose

This table is the \`public-prose\` register alone — my posts, measured against
the card as committed. It can honestly read "nothing moved" while the file above
changed, because the chat corpus and the contrast set move on their own.

\`\`\`
${DRIFT_OUT}
\`\`\`

${CORPUS_LINE:+Corpus: $CORPUS_LINE}

## What this does not touch

The **exemplars** are unchanged. A rebuild re-measures the numbers and re-ranks
the distinctive terms, but which six passages represent a writer is a judgement,
and selection is pinned anyway so the prompt prefix keeps hitting the OpenRouter
cache. If a newer post reads more like me than one of the six, that swap is a
separate commit in \`data/voice/exemplars/\`.

Every post the rebuild actually measured — the ones tagged \`human\` that clear
the prose floor, which is a smaller set than the ones tagged \`human\`:

${MEASURED_POSTS:-(could not read the corpus)}

The prohibitions and the persona lines are hand-written and also untouched.

## After merging

Nothing downstream changes on merge alone. The \`john-voice\` Claude
skill and sr-docs read their own copies, and the next run of this job syncs them
— or \`scripts/sync-voice.sh\` does it now.

## Caveat that applies to all of this

Five posts is a small corpus. One new post moves every number in the table, so a
large percentage change is arithmetic before it is evidence about how I write.
EOF
)"

if [[ $DRY_RUN -eq 1 ]]; then
  log "--dry-run: not pushing. The PR would have been:"
  echo
  echo "TITLE: $TITLE"
  echo
  printf '%s\n' "$BODY"
  echo
  git --no-pager diff --stat data/voice/
  finish 0
fi

# --- 8. branch, commit, push ---------------------------------------------
# One branch per month, so a re-run in the same month updates the open PR
# instead of opening a second one arguing the same case.
BRANCH="voice/card-refresh-$(date -u +%Y-%m)"
git checkout -q -B "$BRANCH" >>"$LOG" 2>&1
git add data/voice/voice-card.json data/voice/preferences.json >>"$LOG" 2>&1
git -c user.name='voice-card-refresh' -c user.email='johnkelly.main@gmail.com' \
  commit -q -m "$TITLE" -m "Rebuilt from the live corpus by scripts/refresh-voice-card.sh. Exemplars untouched." >>"$LOG" 2>&1

PUSH_OK=0
if git push -q origin "HEAD:refs/heads/$BRANCH" >>"$LOG" 2>&1; then
  PUSH_OK=1
else
  # The branch already exists, which in the same month means an earlier run of
  # this job put it there — the new commit is built fresh off master, so it
  # diverges and a fast-forward is impossible. Force, but only over this job's
  # own work: if a person has pushed to that branch, leave it alone and say so.
  git fetch --quiet origin "refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" 2>/dev/null
  REMOTE_AUTHOR=$(git log -1 --format=%an "refs/remotes/origin/$BRANCH" 2>/dev/null)
  if [[ -z "$REMOTE_AUTHOR" || "$REMOTE_AUTHOR" == "voice-card-refresh" ]]; then
    git push -q --force origin "HEAD:refs/heads/$BRANCH" >>"$LOG" 2>&1 && PUSH_OK=1
  else
    log "refusing to force over $REMOTE_AUTHOR's commit on $BRANCH"
    notify_if_changed "⚠️ voice-card refresh will not touch $BRANCH

Somebody else has pushed to that branch — last commit is $REMOTE_AUTHOR's — and
this job only ever forces over its own work. Nothing was pushed. Rename or
merge that branch and the next run will pick up where it left off."
    finish 2
  fi
fi
if [[ $PUSH_OK -eq 0 ]]; then
  log "push FAILED"
  notify_if_changed "🔴 voice-card refresh: the push failed

The rebuilt card is sitting in $WORKTREE and will be thrown away on the next
run. See $LOG."
  finish 1
fi

# --- 9. open the PR, or leave the open one to pick it up -----------------
EXISTING=$(gh pr list --repo zerosumpain/SR-Main --head "$BRANCH" --state open --json url --jq '.[0].url' 2>/dev/null)
if [[ -n "$EXISTING" ]]; then
  log "updated the open PR: $EXISTING"
  notify "🗣️ The voice card moved again this month.

$EXISTING has been updated with a fresh rebuild.
${NEW_POSTS} post(s) the old card had never seen."
  finish 0
fi

PR_URL=$(gh pr create --repo zerosumpain/SR-Main --base master --head "$BRANCH" \
  --title "$TITLE" --body "$BODY" 2>&1 | tail -1)
if [[ "$PR_URL" != https://* ]]; then
  log "gh pr create failed: $PR_URL"
  notify_if_changed "🔴 voice-card refresh pushed a branch but could not open the PR

Branch: $BRANCH
$PR_URL"
  finish 1
fi

log "opened $PR_URL"
notify "🗣️ My voice card has drifted and there is a PR for it.

$PR_URL

${NEW_POSTS} post(s) the card had never seen. Exemplars untouched — those are
still a judgement call, and the PR lists the candidates."
finish 0
