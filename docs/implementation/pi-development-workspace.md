# Persistent Pi development workspace

Implemented in the existing cumulative checkout on 2026-09-07. This delivery improves Pi; a native Codex worker is still a separate adapter and evaluation project. Nothing here publishes a PR or deploys production.

The owner entry point is `/jkai/develop`, linked from navigation and the epic backlog. Work can cover Public site, News, Health, Intelligence, Maps, Decks, Platform or JKAI. The portfolio complements the existing epics; it does not migrate or discard them.

A feature starts as an editable brief. Accepting it records a revision, outcome, constraints, target routes and observable acceptance criteria. The worker receives the accepted brief, answered decisions, pinned constraints and up to eight evidenced repository lessons for the product area. Lessons expire after 90 days. Editing the brief invalidates verification; changing the candidate invalidates its evidence and preview.

Pi 0.84.4 now runs over JSON-line RPC with a persistent per-build session directory. Subsequent iterations continue that transcript. Steering instructions are persisted before dispatch, acknowledged separately from inclusion, and reconciled against saved user messages after reconnect. Dispatch reservation prevents cancelling an instruction already being sent. A tool can ask the owner a blocking question; the question and answer survive worker restarts. Owner wait time is excluded from the iteration watchdog. Pause/stop interrupt the active child; a controller advisory lock prevents competing recovery loops. A recovered session with an unanswered decision stays paused.

Repository builds commissioned through this workspace stop at candidate review. The broker records the exact candidate revision and a capped diff, prepares an isolated full-site preview, and retains the workspace and session. The owner records evidence for each criterion against that revision. Acceptance is unavailable until the repository gate, preview and all criteria pass and every decision has an answer. Integration locks the review state, rechecks the candidate, merges into a separate cumulative batch and runs structural, type, unit, production-build and builder-bundle checks. Durable broker receipts make retried acceptance idempotent. Harness-control changes cannot silently change the checks: they must first enter the owner's cumulative checkout.

The local broker snapshots all authored cumulative checkout work, including uncommitted work. Later source changes merge forward into its batch; conflicts stop preparation without discarding the previous batch. Neither operation resets the user's checkout. The broker owns a separate trusted volume for git baselines and receipts. It rejects symlinked workspaces and executable or external git configuration. New dispatch receipts remain build work on the backlog and link to the existing console; parking/reopening makes a failed request eligible for an explicit retry.

Preview code runs as an unprivileged user in a separate nested Docker daemon, with dropped capabilities, resource limits, no host mounts and an internal network. Each preview has its own disposable Postgres database and local credentials. A small trusted ingress container exposes its HTTP endpoint; a local-only proxy signs in a synthetic owner. The image includes Bubblewrap for the existing authored-tool runtime. Its seccomp profile retains the Moby default rules and adds namespace/mount operations needed by Bubblewrap; `systempaths=unconfined` lets it mount its own `/proc`. The process still runs as user 1000, with no capabilities, no-new-privileges, no host mounts and the internal network. AppArmor remains Docker’s default. A real Bubblewrap smoke check runs before preview setup. The profile derives from [Moby profiles at 61eaf326](https://github.com/moby/profiles/blob/61eaf32614c7c71b60bd8927d3e6a4ffc8ff1f31/seccomp/default.json); its Apache licence is retained beside `scripts/development-seccomp.json`.

The candidate has no production provider credentials or outbound network. Previews use the built production server. Closing a preview frees its containers/database but retains source, sessions and evidence history. At most eight previews are exposed at once.

## Local use

- Workspace: `http://192.168.0.77:5275/jkai/develop` through the existing local sign-in gateway.
- App listener: `http://127.0.0.1:5275`.
- Candidate/batch previews: `http://127.0.0.1:5281` through `:5288`; these listeners remain loopback-only. When reviewing from another computer, forward the relevant port to that computer before opening the preview link.
- Compose: `/home/john/docker/local/compose.development.yaml`, layered over `compose.yaml` and `compose.jkai.yaml`.
- Migration: `scripts/migrations/2026-09-07-pi-development.sql`, applied only to the isolated local database.

The builder container has an empty local Pi auth volume. Configure a provider in that local environment before commissioning a paid build. The CLI fixture below proves the real Pi session protocol without any provider credentials. It does not establish live-model feature quality. The existing host-mode worker still has service-level isolation; this change does not claim that each Pi tool runs in the preview's narrower sandbox. Native Codex, production deployment evidence and a production migration rollout are not part of this local implementation.

## Reproducible validation

`src/lib/jkai/pi-rpc.test.ts`, `src/lib/jkai/orchestrator-reentry.test.ts`, `src/lib/builds/development.test.ts` and the opt-in `development.integration.test.ts` cover framing, disconnects, timeouts, revision conflicts, durable receipts and acceptance invalidation. The integration test refuses to run outside the named local database.

`node scripts/qa/development-preview.mjs` exercises the real UI through the local gateway at desktop and phone widths: brief acceptance, decisions, steering receipts, reload and premature acceptance blocking. Screenshots are written to `/tmp/development-*.png`.

`docker exec porkserv-local-development-builder-1 node /workspace/scripts/qa/pi-session-fixture.mjs` exercises the actual pinned Pi CLI with a deterministic local provider: live steering, persisted history, restart/continuation, a blocking owner decision and forced mid-turn process-crash recovery. No model credits are consumed.

`docker exec porkserv-local-development-broker-1 node /source/scripts/qa/development-broker-fixture.mjs --accept` exercises cumulative preparation, a synthetic candidate, full-site preview, git-configuration rejection and idempotent integration. It removes its synthetic marker before batch integration and retains the resulting local preview for inspection.

The broker retains structural, type, test, build and builder-bundle output in its private volume as `<build-id>-gate-<step>.log`. The test process uses the web role so existing scheduler-wiring tests exercise the normal app contract. Authored prompts, skills and voice material accompany snapshots; runtime data does not.

The production-source allowance is 611,000 lines for this authorised cumulative work (measured at about 610,200); the obsolete prompt-draining path was removed, and the other footprint budgets and dependency boundaries are unchanged.

## Validation completed locally

- Full isolated integration: 856 test files passed, one skipped; 10,170 tests passed, three skipped. Structural, schema and dependency checks passed; Svelte reported zero errors and 891 existing warnings. The final production build, client budgets, builder bundle and tracked-source cleanliness check passed.
- Delivery/session checks: five focused files, 20 tests passed, including three actual local-Postgres tests and rapid pause/resume coverage. The real Pi CLI fixture passed steering, persisted continuation, owner questions and forced process-crash recovery without a paid model. A duplicate builder process was refused by the database lock.
- Browser checks: desktop 1440px and phone 390px, all four tabs, persisted brief/decisions/instructions, reload, premature-acceptance blocking and an authenticated cross-origin site-preview iframe passed.
- Runtime parity: 72 previously affected tests passed after including authored voice material, Bubblewrap and the correct test service role; the full suite then passed in the corrected image.
- Batch receipt: `8f3db815a51ff111659a32a5dd8d8f82406e6892`, returned identically by two acceptance calls. The retained combined preview is `http://127.0.0.1:5283`. Synthetic marker files were removed before integration, synthetic UI database rows were cleaned up, and the two older smoke previews were closed.
- Local Compose validates, the migration is applied to the isolated database, and the local app/builder were restarted successfully. The main workspace returns HTTP 200 through the existing local gateway. Earlier cumulative work remains in the working tree; no PR or production deployment was made.

 A passing transport fixture is deliberately separate from a claim that a paid model has implemented and satisfied a real product brief.
