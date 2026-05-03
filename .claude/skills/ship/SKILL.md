---
name: ship
description: Use when the user says "ship", "deploy", "ship it", or asks to push and deploy strange_rambling_svelte changes to production. Runs the full check → build → commit → deploy → verify-live loop and refuses to declare done until the change is observed on strangeramblings.com.
---

# Ship — strange_rambling_svelte

Project root: `/home/john/strange_rambling_svelte`
Production URL: `https://strangeramblings.com`
Deploy script: `~/strange_rambling_svelte/scripts/deploy.sh`

Use this skill to take pending changes from working tree → live on production with verification. Never skip a step. Never declare success without the verification curl in step 6.

## Steps

1. **Type / svelte check**
   - `cd ~/strange_rambling_svelte && npm run check`
   - If errors, fix them and re-run. Do NOT proceed with errors.

2. **Build**
   - `npm run build`
   - If the build fails with stale-output symptoms (missing chunks, hash mismatch, "Cannot find module" pointing at `.svelte-kit/output/...`), do a clean rebuild:
     - `rm -rf .svelte-kit/output && npm run build`

3. **Commit**
   - Stage only intended files (no `git add -A`).
   - Conventional commit message: `feat:`, `fix:`, `chore:`, `refactor:`, `style:`, `docs:` — follow recent commits in the repo for tone.
   - Create the commit with the standard Co-Authored-By trailer.

4. **Push + deploy**
   - `git push`
   - `~/strange_rambling_svelte/scripts/deploy.sh`
   - Wait for the deploy script to finish; do not background it.

5. **Verify live**
   - Identify a verification target — a URL path and a unique string the change introduces (a class name, copy snippet, new route, asset hash).
   - `curl -sS https://strangeramblings.com/<path> | grep -F '<unique-string>'`
   - For asset/script changes, fetch the bundle directly and grep there.
   - If grep finds nothing: the deploy did not propagate or the change isn't where you think. Investigate (cache, build output, wrong file edited) — do NOT declare done.

6. **Report**
   - Report: deploy URL, verification path, the string you grepped for, and whether it was found.
   - Format: one terse paragraph. Example: "Shipped to https://strangeramblings.com/health — verified `data-section=\"hrv-trend\"` present in the rendered HTML."

## Hard rules

- **Never claim "deployed" without step 5 returning a match.** "I pushed and deploy.sh exited 0" is not verification.
- **Never edit again locally between deploy and verify.** If verify fails, treat it as a bug to investigate, not a reason to tweak and retry blindly.
- **Stale build symptoms = clean rebuild first.** Do not try to fix a build error by editing source code if `.svelte-kit/output` looks stale.
- **No `--no-verify` on commit.** If hooks fail, fix the cause and create a new commit.
