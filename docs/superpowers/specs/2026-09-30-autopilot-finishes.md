# Autopilot finishes what it starts

2026-09-30. Kicked off from a review of codegraph and `/jkai/develop` ("crack on").

## Why

Nine development features, about 35M tokens, no pull requests. The review found
the loop fails before retrieval quality can matter:

- **A broken test failed every candidate.** `feed-checks.test.ts` (#1026, 26 Sept)
  threw unless `DATABASE_URL` was loopback. The broker's preview database is on a
  docker network, so the tests step of every isolated verification failed. The
  jokes feature (f3a6c096) spent five rounds being coached to fix it.
- **The reviewer was the builder.** `development-assessor` is unpinned, the site
  default and the builder are both `codex/gpt-6-luna`, and every recorded verdict
  is `independent:false`. The jokes run passed 5 of 5 criteria with a red gate.
- **Infrastructure failures spent rounds.** The restart branch never read
  `cycle.failureKind`. A disk failure used all six rounds of an earlier run.
- **Nothing happened after the PR opened.** The watcher checked merged/closed
  only. A red CI run, a draft, or a protected-path change sat until the six-hour
  stall stop, with nobody told why.
- **Browser failures returned stack traces**, not the page the scenario missed.

## What changes

| Piece | Change |
|---|---|
| `feed-checks.test.ts` | Skips (never throws) off a loopback test database. |
| `scripts/development-verification.mjs` (new) | `failureKindFor` files known flakes (jsdom lru-cache, disk, Docker) as `infrastructure`; `verificationExcerpt` puts the FAIL lines first. |
| `scripts/development-preview-check.mjs` | A failed scenario reports the step, the page text and the controls it offered. |
| `development-review.server.ts` | `developmentAssessor` falls through role → agentic routing profile → the owner's alternate model to the first that is not the builder's. Autopilot will not accept on a self-review. Coaching stops claiming independence it does not have. |
| `development-autopilot.server.ts` | `restartDecision`: infrastructure retries without a round (back-off, max 3); the same failure three rounds running ends the run. CI red → close the PR, coach the failure back, re-release on a new branch. Draft / protected / conflicting / not-merged → notify the owner once and keep watching. |
| `development-release.server.ts` | `classifyRelease` runs CI's own `classify-pr-risk.sh` before the PR opens; the tier and paths go on the state and the PR body. `watchOpenPullRequest` reads the head commit's check runs and pulls the failing job log. |
| `development.ts` | `failureSignature`; the delivery prompt names `.github/protected-paths.txt`. |
| `$lib/github/pr.ts` | `closePullRequest`, beside the one opener. |

## Decision log

| Fork | Options | Chosen | Why | Reversible |
|---|---|---|---|---|
| How to make the reviewer independent | pin a model in prod settings; hard-code a second model; fall through existing operator settings | Fall through settings: role → `agentic` profile → `jkai.chat.alt_openrouter_model` | No model constant in code ([[never hard-code a primary model]]); every candidate is an owner or router choice. On prod today it resolves to the owner's alternate (deepseek-v4-flash, ~$0.12/1M), a different vendor | Pin `jkai.development.assessor_model` to override |
| Autopilot on a self-review | warn; refuse | Refuse unattended acceptance; the owner can still accept by hand | The checker marking its own work is the failure being fixed | Code |
| Draft PRs under the `pull_request` policy | open ready when autopilot is on; keep draft | Keep draft; notify when CI is green | The draft is the owner's chosen permission, not a bug | — |
| Merge conflict with master | rebase in the release clone; hand to owner | Hand to owner with a notification | A rebase rewrites the candidate the reviewer judged | Later |
| Shared-suite failures | re-run failing tests on the base; stop on repetition | Stop when one failure signature repeats three rounds running | Cheap and generic; the base re-run needs a second preview container | Add later if repetition proves too slow |
| Where CI logs come from | check-run summary only; job log | Job log excerpt around `##[error]`, summary as fallback | The summary is usually empty for Actions jobs | — |

## Verification

- Unit: `development-autopilot-finish.test.ts`, `tests/scripts/development-verification.test.ts`, the existing development suites.
- Gate: `./scripts/gate-remote.sh --build`.
- Live: after deploy, confirm the broker runs the new scripts (`/opt/sr-development/sources/<sha>`), and that `developmentAssessor` resolves independent on production.
