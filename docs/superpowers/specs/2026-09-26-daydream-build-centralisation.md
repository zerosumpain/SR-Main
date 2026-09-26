# Daydream and build: centralise, don't split

**Status:** PR-A (quick wins) in review; PR-C (single intake queue) in review; PR-D (shared tool loop) in review; PR-E … P4b queued
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

### PR-C decisions — D3, the single intake queue

**The flow after PR-C.** Producer → `intakeIdeas` (`$lib/selfimprove/backlog`) →
one improvement-backlog item (or a citation on the item it restates) → owner
accepts the item's brief in the backlog room → the nightly propose phase
dispatches at most one tapped repo build (or watch) → `createChangeRequest`
returns the open build for the same slug or title instead of starting another.
Producers: think-loop `build` notes (`queueBuildNotes` in the `daydream-think`
activity), workflow-doctor escalations (`escalateFindings`), the nightly
question-miner (`learnInsights`), owner entries and the trace route.

Deleted: `$lib/daydream/appetite/*`, the `daydream-appetite` activity and its
registration, `AppetiteBoard.svelte` and the Improvement room's Appetite section,
the `capability_decide` action, capability leads on the backlog board,
`$lib/daydream/faults.ts` (collectFaultIdeas / faultNeeds / raiseFault — nothing
writes the ledger any more), `selfimprove/toolsmith.ts` and `pickToolWork`.
Kept: `verify.ts` and the repair phase (the `custom_tools` runtime), `createMonitor`,
the `daydream_capabilities` / `daydream_faults` table declarations (P4b), the
paused `daydream-appetite` heartbeat row (P4b).

| # | Decision | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| C1 | Where think `build` notes join the backlog | `think/run.ts` / `think/notes.ts` / the heartbeat activity | The `daydream-think` activity, after `runThink` returns, via `queueBuildNotes(createdKeys)`; the pure mapping `buildIdeaFromNote` lives in `think/notes.ts` | `run.ts` is being edited by another PR; `$lib/selfimprove` imports `$lib/daydream`, so daydream cannot import the backlog; the heartbeat already imports both. Only notes the feed shows are queued (an echo of a refuted claim or a dismissed note is not a proposal). | Yes |
| C2 | Intake dedup rule | Exact slug only / `looksSameSubject` (3 shared words) / trigram title similarity | Trigram `titleSimilarity` ≥ `TITLE_ECHO_SIMILARITY` (0.6) — the think loop's own `liveEchoOf` rule — against open items and items settled in the last 30 days; exact slug still checked by key, fail-closed | Reuses the existing "same claim" definition instead of inventing one. `looksSameSubject` is the clusterer's "related" test, too loose to merge on. Titles only: prose matches on its template. | Yes |
| C3 | What a merge does | Drop the arrival / append to `notes` / new `citations` field | `citations[]` on the item (source, ref, producer title, first/last, count); a returning asker bumps `count`; `updatedAt` is not moved | Keeps who asked and how often without a second item. `notes` are owner prose. Moving `updatedAt` would re-date the burndown's drained rows. | Yes — additive JSON |
| C4 | Two findings from one producer that read alike | Merge / keep apart | Keep apart when the arrival has a `ref` and the candidate is cited by the same source under a different ref | Two doctor findings on neighbouring nodes ("…/ Read the diary" vs "…/ Read the calendar") score 0.70 and are two fixes; two think notes the loop kept apart were already judged distinct by `liveEchoOf`. | Yes |
| C5 | The owner's tap | Board stage "accepted" / epic accept / accepted brief | `isOwnerAccepted(item)` = `grooming.acceptedAt` is set | `stageFor` calls every untried open row "accepted", so a stage is not a tap; epic accept is about grouping. `acceptedAt` is stamped only when a person saves the groomed brief. Only tapped items are PICKED, so untapped high-priority rows can no longer hold every slot. Production had **0** tapped items on 2026-09-26, so the first night after deploy dispatches nothing. | Yes |
| C6 | `daydream.appetite.autobuild` | Drop / rename / keep | Keep, key unchanged, explicit `true` only | It is `selfimprove`'s own `SETTINGS_AUTOBUILD_KEY`, not appetite code; renaming would silently turn an explicit `true` back to off. Unset on production (checked 2026-09-26). | Yes |
| C7 | `tool` / `source` items with no toolsmith | Leave them lane-less / map to the repo lane | Both go to the repo build lane (`laneForKind` → `build`; propose picks `feature`, `tool`, `source`) behind the same tap | Otherwise hundreds of queued items would have no builder at all. The tap keeps it from spending unattended. | Yes |
| C8 | The toolsmith phase in the run record | Remove `build` from `PhaseName` / keep it skipped | Keep, always `skipped` with the reason | Every historical `improvement_runs` record has it; a missing phase is a hole each dashboard must special-case. | Yes |
| C9 | `createChangeRequest` dedup | By backlog slug / by title / both | Both: `gitTargetConfig.backlogSlug` exact, else trigram title at 0.6 against `requestTitle` (or the display title for older builds); live = pending/running/paused, or `outcome = pr_open` within 14 days. Returns `{ reused: true }`; the propose phase records the ref without counting an attempt or a nightly slot | Covers the engine re-asking and chat asking for the same thing. A lookup failure degrades to opening a new one — the ask is never lost. The title rule lives in `$lib/utils/title-similarity` because `$lib/selfimprove` and `$lib/daydream` both import `$lib/jkai`. | Yes |
| C10 | After the nightly change-request cap | Fall through to the blind draft PR / stop | Stop | The fallback's own comment says it is only for a host with no build lane; the old code fell through to it once the cap was spent. | Yes |
| C11 | The fault ledger | Keep `faults.ts` for its reads / delete | Delete the module; keep the table | Once escalation writes the backlog nothing writes `daydream_faults`; its 132 open rows on production would only have fed `collectFaultIdeas` and `faultNeeds`, both deleted. The Improvement room's cells now read intake by channel and "waiting for your tap". | Code: git revert. Rows: kept until P4b |
| C12 | The morning briefing's "Would like to build" line | Drop / re-point | Re-point to the last 24 hours' think `build` notes, linking the backlog | It was the appetite ledger's one owner-requested line; a build note is now what proposes a build. | Yes |

### PR-D decisions

`runToolLoop` in `src/lib/llm/tool-loop.ts`. Adopted by the think cycle
(`daydream/think/run.ts`) and the heartbeat turn (`heartbeat/llm.ts`).

| # | Decision | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| D1 | How the loop reaches a model | Resolve the model itself / take a resolved client | Takes a client from `getLLMClient` | Keeps provider selection in `$lib/llm/client`. `installUsageCapture` already records every `create()`, so the loop only sums usage for the caller and never writes to the ledger. | Yes |
| D2 | Activity tagging | Always wrap / optional | Optional `activity`, one wrap around the whole loop | A turn's spend stays one row. The heartbeat passes none, because `runHeartbeatTurn` already wraps the turn. | Yes |
| D3 | Tool calls when no tools were offered | Execute / ignore | Ignore: the message is the reply | The heartbeat with `toolsEnabled: false` always took the content in that case; running a call to a tool it never offered makes no sense. Only differs from the think cycle when its toolbox has zero definitions, which never happens. | Yes |
| D4 | Tool arguments | Pass parsed JSON through / normalise | Malformed or non-object → `{}` | The think cycle already did this; the heartbeat passed an array or `null` through to the executor. | Yes |
| D5 | A response with no message | Stop / forced final | Forced final when configured, else `stop: 'empty'` | Matches think's `break` into its final call and the heartbeat's empty reply. | Yes |
| D6 | Timeout scope | Per call / whole loop | Whole loop, via `combineSignals` | A per-call ceiling multiplies by the round count. Neither adopter sets one yet. | Yes |
| D7 | Think's counters when the loop throws | Keep partial counts / report zero | Zero rounds and tokens on that path | The loop returns totals, not a running tally. The `error` field is what that path reports; the ledger still has every call. | Yes |
| D8 | Callers left alone | Adopt all / two | `workflows/nodes/llm-agent.ts` (owned by SR-Workflows in `docs/module-ownership.json`, would drift), `blog/assistant/runner.ts` (an async generator that streams; later), every single-shot caller | | Yes |
| D9 | The activity-tag registry check | Callers wrap `withActivity` themselves / extend the check | Extend `workloads.test.ts` | Moving the literal into an option hid `'daydream'` from the scan that catches tag typos. The scan now also reads `activity: '…'` in any file calling `runToolLoop(`, and `tool-loop.ts` joins the documented dynamic-tag exceptions. No existing assertion changed. | Yes |
