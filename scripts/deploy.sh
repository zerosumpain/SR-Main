#!/usr/bin/env bash
# THIS SCRIPT DOES NOT DEPLOY. It exists to refuse, and to say what to do instead.
#
# History, because the refusal is only credible with it:
#
#   2026-07-24  Run by hand. It rsynced homeserv's repo over the VPS without
#               excluding .env, so the development .env replaced production's.
#               That carried DATABASE_URL pointing at a local dev database (the
#               app crash-looped on "password authentication failed", nothing
#               bound :4173, Cloudflare served 502 for 33 hours) AND
#               AUTH_BYPASS=1, whose "private address only" check reads
#               getClientAddress() — which behind cloudflared is always
#               127.0.0.1. So /admin and /drive were open to the public internet
#               the moment the site came back up.
#
#   Later       Production moved to releases/<sha>/ with build/ a symlink into
#               the live one. The rsync would now follow that symlink and
#               --delete its way through whatever release is serving.
#
# A guard was added for the second hazard: ssh to the VPS, test whether build/
# is a symlink, refuse if so. It was FAIL-OPEN. `ssh` exits 255 when it cannot
# connect, `[ -L ... ]` exits 1 when the path is not a symlink, and the guard
# could not tell those apart — so exactly when the VPS was unreachable, which is
# when someone is most likely to reach for a manual deploy, the script decided
# the symlink was absent and carried on to the rsync.
#
# There is no version of this script that is safe to keep working, so it does
# not work. The supported path is the only path.
set -euo pipefail

cat >&2 <<'REFUSE'
==> REFUSING TO RUN. This script no longer deploys anything.

Deploy by merging to master. CI builds the release and flips the symlink
atomically:  .github/workflows/ci.yml -> scripts/ci-release.sh

  git push -u origin <branch>
  gh pr create --fill
  # wait for "Gate (check + test)" to pass, then:
  gh pr merge <N> --squash

Never `gh pr merge --auto` — with nothing to wait on it merges immediately and
cancels the in-flight run.

TO ROLL BACK, on the VPS:

  scripts/rollback.sh <sha>

or by hand, if that script is not yet deployed:

  cd /opt/strange-rambling-svelte
  ln -sfn releases/<sha> build.tmp && mv -Tf build.tmp build
  sudo systemctl restart strange-rambling-svelte
  curl -s localhost:4173/api/version

Note a rollback moves the CODE only. It does not undo a drizzle-kit push, and
it does not roll the sidecars back.
REFUSE

exit 1
