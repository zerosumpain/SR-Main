# CI/CD pipeline hardening — safety and speed

**Date:** 2026-09-16
**Kick-off:** "Perform a review of the site … safe and efficient ci/cd pipeline … perfect balance
of safety and speed to deploy", then "crack on with the order you have proposed".
**Grade:** Full autonomous. Zero human contact until the final report.
**Audit:** https://claude.ai/code/artifact/bfa47327-fdb1-4309-88fc-6705524052c7

## Problem

A nine-dimension audit of `ci.yml`, `nightly.yml` and the release scripts found 40 findings
that survived adversarial verification. Four are open holes today:

1. Both self-hosted runners — including the production VPS — are registered on a **public**
   repo, and the master-only guard that keeps strangers off them lives inside the file a pull
   request proposes.
2. The gate-certified release candidate is accepted on an artifact *name* plus a job *name*,
   then unpacked with `path: .` over the checkout root, immediately before the runner executes
   `./scripts/ci-promote-candidate.sh` — a file the archive may have just replaced.
3. `select-tests.mjs` cannot see bare side-effect imports, so a change to any of 33
   `site-tools/tools/*.ts` modules selects exactly the always-run baseline and nothing else.
   The `destructive: true` invariant that `protected-paths.txt:139` relies on never runs.
4. The nightly has been red for 22 consecutive runs because `check-authored-runner.sh` was
   wired into `ci.yml` and `ci-release.sh` but not `nightly.yml`.

Separately, 241 seconds of every master deploy — 61% of the run — is porkserv downloading an
artifact the pull request already built and uploading it again so the VPS can download the
same bytes.

## Goals

- Close the four open holes.
- Take merge→live from ~391s to ~115s without giving up any verification.
- Give production a rollback before locking the branch ruleset.
- Leave the PR gate's ~4 minute wall clock alone.

## Non-goals

- Re-running the type check and tests on master. See Decision 4.
- Widening `is_known_code` in `gate-level.sh`. The deny-by-default classification is correct;
  the *selector* is what is broken.
- Protecting `site-tools/tools/**`. `protected-paths.txt` is right that this is ordinary
  feature work and protecting it would end the agent lane.

## Shape

All expensive verification happens once, on the pull request, on GitHub-hosted runners. Master
does not repeat it, because the artifact that ships is bound to the run that gated it. The
machine that deploys fetches that artifact directly. No self-hosted runner is reachable from a
workflow definition a pull request can write. The merge decision is computed from the base ref,
never from the branch under judgement. Production has a one-command rollback and an alarm that
reaches a phone.

## Waves

Delivered as four PRs, each gated and merged on its own so a regression is attributable and
revertible. Every merge auto-deploys, so each wave is live before the next starts.

| Wave | Items | Theme |
|---|---|---|
| 1 | 1–12 | Blind spots and dead alarms. No deploy-time cost. |
| 2 | 13–18 | The speed restructure. ~4½ minutes off every deploy. |
| 3 | 19–24 | Recovery first, then lock the branch. **19 before 22.** |
| 4 | 25–32 | Provenance, runner exposure, sudo, loose ends. |

Item-by-item detail lives in the audit artifact; it is the specification for this work and is
not restated here.

## Verification

Per item, stated before the code is written:

- **5** — `SELECT_TESTS_FILES='src/lib/workflows/site-tools/tools/whatsapp.ts' node
  scripts/select-tests.mjs` selects >60 files and includes `toolchain-fixes.test.ts`.
- **6** — a tracked path containing a space classifies L3, driven through the real git path,
  not `GATE_LEVEL_FILES`.
- **7** — `git mv` of a protected file classifies `tier=high`.
- **1–3, 11** — a `workflow_dispatch` nightly run goes green.
- **13** — `gh run view` on the first certified master deploy shows no `Prebuild` job and a
  merge→live under 150s.
- **19** — `rollback.sh` run against a real previous release restores it and `/api/version`
  reports the rolled-back SHA.
- Every wave — the `Gate (check + test)` check is green before merge, and
  `https://strangeramblings.com/api/version` reports the merged SHA afterwards.

## Decision Log

**1. Fix the selector, not the always-run list.** Options: (a) add the two invariant tests to
`tests/always-run.txt`; (b) teach `select-tests.mjs` about bare imports. Chose (b).
`tests/scripts/select-tests.test.ts:101` asserts the always-run list equals a specific grep, so
(a) fails that drift test on the next run and would need a second parallel list to be made
honest. (b) is one regex, is monotone — a bare-import edge can only add tests — and fixes all
33 modules rather than two. Reversible: one line.

**2. One PR per wave, not one per item.** 32 PRs would each pay a ~4 minute gate and a ~6.5
minute deploy. Four PRs keep each change attributable while landing the work in a day.
Reversible: each wave is a single squash commit to revert.

**3. Interim fork-approval change lands in Wave 1, not Wave 4.** Item 27's full fix — moving
both runners to a private ops repo — is a multi-step infrastructure change with a real chance
of breaking deploys. The interim, setting fork-PR approval to `all_external_contributors`, is
one API call, takes effect immediately, is reversible, and closes the entire outsider path. It
is wrong to leave that open for three waves while building the better fix. Reversible: one API
call back.

**4. Reject re-running the type check and tests on master.** One auditor proposed dropping the
`candidate_certified` clause at `ci.yml:199`/`:282`. It reads as free only because porkserv's
241s relay currently hides it; after Wave 2 it costs ~150s on every deploy and buys close to
nothing, since on L2/L3 the tree is identical by construction to what the PR gated and on L1
the jobs skip anyway. The exposure is in the *level* decision the certificate inherits, which
items 5 and 6 fix directly. Reversible: it is a deletion of two `if:` clauses if ever wanted.

**5. Wave 3 is ordered, not a set.** Item 22 (`pull_request` + `non_fast_forward` + `deletion`
rules) removes direct-push-to-master, which is today's fastest rollback. Item 19 builds the
replacement. Landing 22 first would leave a window with neither. Not reversible in the sense
that matters — an outage during that window would be felt — so the order is a hard constraint.

**6. `deploy.sh` is gutted, not deleted.** Deleting it would break any muscle memory or stale
doc that still invokes it, and would do so silently. A file that exists and refuses loudly,
naming the supported path, is the safer artefact. Reversible: it is in git history.

**7. Items 16 and 17 are dropped — their premises do not survive reading the code.**

*16 (tag the dev containers on content, not the SHA).* The saving was supposed to be ~21s of
container recreation for byte-identical cached layers. But `compose.yaml:36` bind-mounts
`${DEVELOPMENT_SOURCE_ROOT}` at `/source`, and `ci-development.sh:25` sets that to
`sources/$SHA` — a different path every deploy. Compose recreates a container whose mount
source changed regardless of its image tag, so stabilising the tag alone saves nothing. The
recreate is caused by the moving mount, not the tag. Making the mount stable would need a
`sources/current` symlink, which would break the prune at `ci-development.sh:164` — it asks
docker what is mounted rather than inferring it, deliberately.

*17 (key the dev-deps marker on the lockfile).* The claim was that
`$SOURCE/node_modules/.sr-dependencies-ready` lives inside the per-commit directory it guards
and so can never exist. It cannot exist for a NEW commit — correctly, because a new commit
genuinely needs its own install — but it does exist on a re-run of the same SHA, which is what
it is for. The proposed fix, a lockfile-keyed store hardlinked in with `cp -al`, would be a
security regression here rather than an optimisation: these checkouts are bind-mounted into
containers that run untrusted candidate code, and hardlinks would let a write from one
candidate's `node_modules` reach every other checkout and the store behind them.

**8. Item 15 moves to Wave 3, after item 20.** Moving the sandbox provisioning to after the
symlink flip is real — it is the largest remaining pre-flip cost, and today a failure
provisioning the *sandbox* blocks a perfectly good *web* release, which is the wrong coupling.
But putting work after the flip is only safe once a post-live failure is distinguishable from
a pre-live one and says so. That is item 20. Doing 15 first would add a new way to fail after
production has already moved, with the old indistinguishable-red-badge reporting still in
place. Same shape of constraint as 19-before-22.

**9. Item 25 ships its load-bearing half, not the attestation.** The forged-candidate path has
two locks. The first is cheap and needs no new permissions: require the producing run to belong
to this repository (`head_repository.id`) and its head commit to be the head of a pull request
that actually produced the commit being deployed
(`listPullRequestsAssociatedWithCommit`). That is implemented. The second,
`actions/attest-build-provenance` plus `gh attestation verify --signer-workflow`, needs
`id-token: write` and `attestations: write`, a `gh` on the VPS authenticated for attestation
verification, and turns every deploy into a hard dependency on that verification succeeding. It
is the stronger lock and it should follow — but shipping it blind, in the same run that
restructured the release path, would put an untested failure mode directly in front of
production. Recommended as the next piece of work, on its own, with a deliberate first deploy.

**10. Item 27's interim is done; the move is not, and it is the top recommendation.**
Fork-PR approval is now `all_external_contributors`, which closes the outside-contributor path
outright. What remains is that the master-only guards on both self-hosted runners live inside
the `ci.yml` a pull request proposes, and one of those runners is the production box. Fixing it
properly means a private ops repository, re-registering two runners, and a
`repository_dispatch` bridge — a change that breaks every deploy if it is wrong, cannot be
rehearsed, and involves a repository that does not exist yet. That is a decision about
infrastructure layout rather than a defect to patch, so it is written up rather than guessed at.

**11. Item 28 (narrow the sudo) is not attempted.** `sudo bash -s --` at `ci-release.sh:360` is
equivalent to NOPASSWD ALL and should become a fixed root helper installed out of band. But
editing `/etc/sudoers.d/` on the production box, blind, risks locking the deploy out of the
operations it needs, and the failure would land on the box serving the site. It needs a
prepared helper, a `visudo -c` check, and a rehearsed rollback — worth doing, not worth
improvising.

**12. Item 30 splits.** The `gate:schema-drift` half of the finding does not hold:
`gate-structural.sh:8-13` already documents that it returns before importing `pg` when there is
no `DATABASE_URL`, and earns its place because `npm run gate` on a dev box does have one, which
is where the drift accumulates. Deliberate and stated, not advertised coverage. The Playwright
half does hold — `tests/e2e/` has two specs and `package.json` has `test:e2e`, and no workflow
invokes either. Wiring it needs a served app on 5273 and seeded rows, which is real work; it is
now asserted as unwired by `coverage-census.test.ts` so it cannot keep reading as coverage.

---

*Written and self-reviewed under the autonomous-build grade. The audit artifact is the design
document; this spec records scope, ordering and the forks that would otherwise have been
questions.*
