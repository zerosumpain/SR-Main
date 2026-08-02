---
name: ship
description: Use when the user says "ship", "deploy", "ship it", or asks to push and deploy strange_rambling_svelte changes to production. Runs the full gate → commit → PR → CI-deploy → verify-live loop and refuses to declare done until the change is observed on strangeramblings.com.
---

# Ship — strange_rambling_svelte

Project root: `/home/john/strange_rambling_svelte`
Production URL: `https://strangeramblings.com`

**Deploying means merging to `master` and letting CI do it.** There is no manual
deploy step in this skill, and you must not add one.

> `scripts/deploy.sh` still exists in the repo. **Never run it.** A hand-rolled
> deploy overwrote the production `.env` with homeserv's, causing a 33-hour
> outage plus a public `/admin` exposure via `AUTH_BYPASS=1` (2026-07-24). The
> VPS `.env` is now `chattr +i`. The same goes for hand-rolled `rsync` of the
> repo over `/opt/strange-rambling-svelte`. CI deploys via
> `scripts/ci-deploy.sh`, which is a different script and syncs an explicit file
> list — that is the only supported path.

Never skip a step. Never declare success without the live verification in step 7.

## What CI actually does

Two jobs in `.github/workflows/ci.yml`:

- **gate** — hosted runner, throwaway pgvector service container, runs
  `npm run gate` (public-routes → font-sizes → check → test → build).
- **deploy** — `needs: gate`, self-hosted runner ON the VPS, only on a push to
  `master`. Runs `npm ci`, copies the `PUBLIC_` lines out of the production
  `.env` (those are inlined into the bundle at build time), `npm run build`,
  then `./scripts/ci-deploy.sh`, which stamps `build/.deploy-sha`, applies the
  schema, and restarts the service.

`needs: gate` is the real enforcement — SR-Main is private on GitHub Free, so
required status checks are unavailable. A red gate can never reach the VPS.

## Steps

1. **Work on a branch, never on `master` directly.**
   - Check `git status` first. The checkout is shared with other sessions —
     if there are unrelated modified files, use a worktree
     (`git worktree add .worktrees/<name> -b <branch> origin/master`) and copy
     `.env` + `keys.json` into it; symlink `node_modules`.
   - Stage explicit paths. Never `git add -A`.

2. **Run the gate locally before pushing** — the same chain CI runs, so a red CI
   is a surprise rather than the norm:
   - `cd ~/strange_rambling_svelte && npm run gate` **with the Bash sandbox
     disabled**. Under the sandbox the adapter-node packaging step fails with
     `RollupError: Could not resolve entry module ".svelte-kit/adapter-node/index.js"`;
     a clean rebuild does NOT fix it — disabling the sandbox does.
   - **Never `source .env` first** — it sets `JKAI_MCP_META_TOOL=1` and breaks
     four tests.
   - To iterate faster, run the stages individually: `npm run gate:check`,
     `gate:test`, `gate:public-routes`, `gate:font-sizes`, `gate:build`.
     `npm run check` needs `NODE_OPTIONS=--max-old-space-size=8192`; it OOMs at
     the default heap ("Ineffective mark-compacts near heap limit").
   - Stale-output symptoms (missing chunks, hash mismatch, "Cannot find module"
     pointing at `.svelte-kit/output/...`) → `rm -rf .svelte-kit/output` and
     rebuild. Do not "fix" those by editing source.
   - If `gate:public-routes` reports a change, do NOT reflexively
     `-- --write`. Confirm the route is *meant* to be anonymous first — curl it
     on production and look for a `302 → /login`. Only then write and commit
     the snapshot.

3. **Schema changes (only if `src/lib/db/schema.ts` changed).**
   - CI applies the schema to PROD for you inside `ci-deploy.sh`
     (`drizzle-kit push --force`, on a timeout). Do not push to prod by hand.
   - A **rename** creates *and* drops, which makes drizzle-kit prompt; the CI
     step then times out and the deploy dies. So does `.unique()` on a
     populated table. Restructure the change or apply it manually on the VPS
     first.
   - The LOCAL homeserv DB (`:5433`) is separate and CI never touches it —
     apply there too, or the always-on service breaks on its next restart:
     `CI=1 DATABASE_URL=<value from .env> npx drizzle-kit push --config=drizzle.config.ts --force`
   - Prefer no schema change at all where the datastore will do
     (`$lib/datastore` collections + jsonb) — that is the house pattern for
     engine//feature state and it sidesteps this whole step.

4. **Commit.**
   - Conventional prefix: `feat:`, `fix:`, `chore:`, `refactor:`, `style:`,
     `docs:`. Follow recent commits for tone — they explain *why*, and name the
     failure the change prevents.
   - Standard Co-Authored-By trailer. **No `--no-verify`** — if a hook fails,
     fix the cause.
   - Never quote real data (phone numbers, tokens, customer strings) in the
     message. A commit message is published in the release log.

5. **Push and open a PR.**
   - `git push -u origin <branch>` (from a worktree, push by refspec).
   - `gh pr create --base master`.

6. **Wait for the gate, then merge explicitly.**
   - **Never `gh pr merge --auto`.** With no required status checks it does not
     mean "merge when green", it means "merge now" — and it cancels the
     in-flight run (seen 2026-07-27, PR #44).
   ```bash
   until [ "$(gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion')" != "" ]; do sleep 45; done
   gh run list --branch "$BRANCH" --limit 1 --json conclusion --jq '.[0].conclusion'   # must be "success"
   gh pr merge <N> --squash
   ```
   - Low-tier PRs from `agent/` branches auto-merge on their own; anything
     touching `.github/protected-paths.txt` territory is tier=high and needs a
     human. Merging to `master` is what triggers the deploy.
   - Then block on the *master* run the same way — the merge starts a second
     run, and that is the one that deploys.

7. **Verify live.** A green deploy job is not verification.
   - Commit landed:
     `ssh -i ~/.ssh/id_ed25519 johnk@157.180.19.38 cat /opt/strange-rambling-svelte/build/.deploy-sha`
     — `sha` must match `origin/master` and `dirty=no`.
   - Pick a verification target: a path plus a unique string the change
     introduces (class name, copy snippet, new route, asset hash).
   - `curl -sS https://strangeramblings.com/<path> | grep -F '<unique-string>'`
   - For asset/script changes, fetch the bundle directly and grep there.
   - **Owner-gated pages return 302 for everyone anonymous, and so does a route
     that does not exist** — a 302 proves nothing on its own. Prove the code
     shipped some other way: grep the built server chunks on the VPS, check a
     side effect (a seeded collection, a scheduled cron line in
     `journalctl -u strange-rambling-svelte.service`), or verify while signed in.
   - If grep finds nothing: the deploy did not propagate or the change is not
     where you think. Investigate — do NOT declare done.

8. **Report.** Deploy URL, verification path, the string you grepped for, and
   whether it was found. One terse paragraph. Example: "Shipped to
   https://strangeramblings.com/health — verified `data-section="hrv-trend"`
   present in the rendered HTML."

## Hard rules

- **Never run `scripts/deploy.sh`, and never hand-roll an rsync to the VPS.**
  Merge to `master`; CI deploys.
- **Never claim "deployed" without step 7 returning real evidence.** "CI went
  green" is not verification.
- **Never `gh pr merge --auto` on this repo.** Block on the run conclusion.
- **Never edit again locally between deploy and verify.** If verify fails, treat
  it as a bug to investigate, not a reason to tweak and retry blindly.
- **Stale build symptoms = clean rebuild first**, not a source edit.
- **No `--no-verify` on commit.**
