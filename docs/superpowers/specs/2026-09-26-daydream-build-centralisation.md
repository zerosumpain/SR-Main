# Daydream and build: centralise, don't split

**Status:** PR-A (quick wins) in review; PR-B … P4b queued
**Brief (John, 2026-09-26):** compare daydream and build, and centralise the
behaviour they duplicate.

## Finding

The answer is **shared in-process modules, not microservices**. The builder
sidecar is the only part of either system that earns a process of its own, and
it already is one. Everything else daydream and build duplicate is library code
(opening a pull request, scrubbing a token, tagging spend, telling the owner,
deciding whether the owner is idle) that wants one implementation in `$lib`, not
a network hop. Daydream and build both stay in Main: they are excluded from
SR-Jkai-Core in `docs/module-ownership.json`.

## Programme

| PR | Scope |
|---|---|
| **PR-A** — quick wins | One PR opener + one redactor (`$lib/github/pr`, `$lib/github/redact`); build-side spend tagged to build workloads instead of `selfimprove`; self-improve and workflow-doctor reports through `notifyOwner`; the idle gate moves to `$lib/heartbeat/idle`. |
| **PR-B** — daydream P4a | Delete legacy daydream code. Tables stay declared. |
| **PR-C** — D3 single intake queue | Think-loop `build` notes → improvement backlog (with dedup) → owner tap → `createChangeRequest` (with dedup). The toolsmith, appetite and fault feeds are deleted. |
| **PR-D** | A shared `runToolLoop` in `$lib/llm`. |
| **PR-E** | One spend guard. |
| **PR-F** | One run ledger. |
| **P4b** | Dump, then drop the retired tables. |

## Decision Log

| # | Decision | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Shape of the centralisation | Microservices / shared modules | Shared modules | A service boundary adds network hops and deploy surface and removes no code. The builder sidecar is already its own process. | Yes |
| 2 | Order | Consolidate first / P4 deletion first | P4 before consolidation | Most daydream duplicates — the adjudicate/compose/weekly checkers, `deliver.ts`'s WhatsApp paths, the ponder adversary — are deletion targets. Consolidating them first is waste. | Yes |
| 3 | Where appetite/faults/toolsmith deletion lands | P4 / PR-C | PR-C | They are the intake plumbing D3 replaces. Deleting them without the replacement would orphan workflowdoctor escalation. | Yes |
| 4 | pi agent loop and `runToolLoop` | Fold in / keep separate | Keep separate | pi is a coding agent in a sandbox, not a chat tool loop. Its cost already lands in the shared `recordBuildUsage`. | Yes |
| 5 | Retired table drop | With P4a / after P4a is live | After P4a is live (P4b) | `pg_dump` to `/opt/strange-rambling-svelte/backups` first. `daydream_trail` and `daydream_places` are **not** dropped: `/home/people` reads them. | Dump makes it recoverable |
| 6 | Heartbeat rows for deleted activities | Delete with the code / leave paused | Leave `paused` until P4b, then remove | A paused row is a harmless skip. Deleting rows alongside code couples a data change to a code rollback. | Yes |

### PR-A decisions

| # | Decision | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| A1 | The one PR opener | Keep three / new module / extend `$lib/github/pr` | Extend `$lib/github/pr` with `openPullRequest({ repo, head, base, title, body, draft, token, userAgent })` | Selfimprove's `openDraftPr` already lived there and now calls it for its last step. It takes an explicit repo and token, so the Forge (brass-and-rails, `FORGE_GITHUB_TOKEN`) and the develop release (SR-Main) both delegate to it. A 422 for a head that already has an open PR against the same base returns it (`reused: true`) — the idempotence both jkai copies had. Labels were not added: no caller sets any. | Yes |
| A2 | The develop release's repo | Hard-coded literal / derive | `repoSlugFromUrl(SR_MAIN_GIT_TARGET.repoUrl)` | Same target the change-request lane uses, so the two cannot disagree. Also replaces the literal in the clone URL, the merge watcher and the ancestry check. `repoSlugFromUrl` moved from `sandbox.ts` to `$lib/github/pr`. | Yes |
| A3 | `publishViaGit`'s `gh pr create` fallback | Remove / keep | Keep | It is the tokenless homeserv path (the CLI's own auth), not a second REST implementation. | Yes |
| A4 | The one redactor | Reuse `$lib/security/sensitive` / new `$lib/github/redact` | New `redactGitHubSecrets(text, token?)` | `redactSensitive` is a PII scrubber (phones, keys by shape) for stored text; this is credential hygiene for git/GitHub output. It is the union of the three copies: the `execInSandbox` base64 envelope and long base64 runs, the literal token, `x-access-token:…@`, and `ghp_…`/`github_pat_…` shapes. Superset of each copy. | Yes |
| A5 | Spend tags | New `build` workload / existing ids | Existing workload ids: the adversary's calls (`development-review`, autopilot's answer-from-brief, which runs on the assessor model) → `development-assessor`; develop-lane grooming → `builder` | A tag is a workload id so the spend row is the row that switches the model. Both ids are already registered, so `/admin/ops/costs` labels them with no mapping change. `planner.ts` (`builder`) and `design-review.ts` (`design-review`) were already right. | Yes |
| A6 | Report notification category | New categories / reuse | Reuse `build` | "Autonomous builds and workflow runs reaching a terminal state" covers both nightly runs. It defaults to WhatsApp + phone, and production has no customised `build` route (checked 2026-09-26), so the owner keeps receiving the WhatsApp summary; `whatsappText` keeps its text exactly the old message. | Yes |
| A7 | Idle gate and module cycles | `$lib/heartbeat/idle` imported by everyone / injected | Heartbeat activities import `$lib/heartbeat/idle`; `runImprovementNow` and `runDoctorNow` take `isUserActive` as an option | The heartbeat already imports `$lib/selfimprove` and `$lib/workflowdoctor`; importing the gate back would add two module cycles the boundary gate refuses. A cron run with no gate fails **closed** (reads as active and skips), the same answer the gate gives when the DB is unreachable. No re-export shim is left in `selfimprove/run.ts`; selfimprove's `IDLE_WINDOW_MS` went with it (the heartbeat module owns the 60-minute default). | Yes |
