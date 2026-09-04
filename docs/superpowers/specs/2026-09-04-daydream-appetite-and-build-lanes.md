# Daydream appetite, the build lanes, and the doctor folded in

2026-09-04. Owner brief, verbatim:

> significantly enhance the daydream and self improvement function; actively
> encouraging it to think about site capability enhancements over efficiency
> tweaks as new features are built.
>
> 1. daydream should spend some cycles thinking about the types of questions
>    asked and site functionality that doesn't already exist that could add
>    value to the user, ie like data sources, news sources, watches, triggers
>    and workflows.
> 2. self improvement should build functionality on that basis. This should
>    include enhancing existing capability or building new. There should be a
>    bias to bringing in new data.
> 3. We should be looking at how we can fold in 'doctor' into self improvement,
>    and having a clear link to the /build capability. It should live in
>    daydream, but feel like a unified capability serving the application and it
>    be clear influences and design choices.

## What is true before this

- The loop is **reactive**. `daydream_faults` records what daydreaming could not
  do; `collectFaultIdeas()` is the first thing `selfimprove/analyze.ts` reads;
  the toolsmith builds a runtime tool to close the gap. Nothing anywhere asks
  what the site *could* do that it cannot.
- The engine's stated **prime outcome is efficiency** — fewer tool calls per
  answered question (`optimise.ts`, PR #60). That is the objective the brief
  asks to demote.
- `propose.ts` writes **whole files blind** from a flash model into a draft PR
  ("This is a draft. Nothing here has been run."), while the real builder —
  `createChangeRequest()` → GitHub issue → gated repo build → PR, the thing
  behind `/jkai/builds` — is never called by any engine.
- The **workflow doctor** still runs its own croner at 05:00 with its own host
  gate, kill switch and idle gate. Its findings never reach the fault ledger, so
  self-improve cannot see them.
- `learnInsights` does already run a "capability portfolio audit" producing
  `CapabilityOpportunity` rows (#667). They are flattened into backlog strings on
  the same night and nothing keeps them, scores them, dedupes them across nights,
  or tells the owner what the engine wants.

## The load-bearing observation

**Every lane the brief names already exists as a callable primitive.** This is
wiring, not invention:

| the owner's word | the primitive |
| --- | --- |
| data source | `discoverApis` → `api_register` (registration runs a live SSRF-guarded probe, so it verifies as a side effect) |
| news source | the source list is a hardcoded union in `$lib/news/types.ts` — so it is a repo change, i.e. the /build lane |
| watch, trigger, workflow | `createMonitor(description, cron)` — generates a scheduled workflow with a dedupe step and a notifier. All three words are one primitive |
| site functionality | `createChangeRequest({title, request})` — issue + repo build + `npm run gate` + PR |
| tool | `buildTool` behind `verify.ts` |

## Decisions (owner, 2026-09-04 — all four recommendations taken)

- **D1 Autonomy.** Data sources and runtime tools keep shipping automatically
  (both already have live verification gates). Watches and repo changes need a
  tap, unless `daydream.appetite.autobuild` is explicitly `true` — inverted
  semantics, exactly like `workflowdoctor.autoapply` — in which case at most
  **1 change request and 1 watch per night**. A change-request build can cost
  $2, roughly ten times a whole self-improve night, so it gets its own switch.
- **D2 Doctor.** The croner dies and becomes the `daydream-doctor` heartbeat
  activity (the move M0 made for self-improve). Findings raise daydream faults,
  so self-improve reads them like every other gap. The report folds into the
  Improvement room as a rollup plus an on-demand drill; `/jkai/doctor` redirects
  there. Not a twelfth room — M5's lesson about a 4,000-line component stands.
- **D3 Bias.** New-data leads take priority 1 and **reserve half of each night's
  build slots**. Call-efficiency stops being the stated prime outcome and takes
  at most one slot a night while new-data work is open. Repair keeps its slot: a
  source that has broken is still a source that stopped bringing data in.
- **D4 Delivery.** Capability leads become ordinary thoughts routed `briefing`,
  rateable by WhatsApp reply like anything else. The per-kind `kindWeight` then
  teaches the engine whether the owner wants more sources or more features.
  Never interrupts on its own.

## Shape

### A1 — Appetite (this ledger, and the stage that fills it)

New table `daydream_capabilities`: one row per idea the engine has had about
what the site should be able to do. `kind` is closed —
`data_source | news_source | watch | tool | feature`. `status` is
`proposed | queued | building | shipped | declined`.

`daydream-appetite`, a heartbeat activity, hourly inside 20:00–23:30
Europe/London with a once-a-day guard (the `alreadySampledToday` shape) and the
usual idle gate:

1. **The pack is assembled deterministically** (`appetite/pack.ts`) — the
   owner's recent questions and the intents that were not served well, the
   coverage map of what sources/tools/watches/APIs already exist, open faults by
   what they want, metrics with zero pairs, and the capability rows already on
   the ledger. Every line carries a `key`.
2. **The model proposes as data**, against the closed kind vocabulary, citing
   pack keys.
3. **Code audits every citation** (`appetite/spec.ts`, pure + tested). A
   candidate citing nothing in the pack is dropped and counted on the pulse —
   the same fabrication meter ponder carries.
4. **Code scores** (`scoreCapability`, pure + tested). Components are named:
   citations, `dataGain` (the bias, as a number), and recurrence across nights.
5. **Survivors bridge into thoughts** as `capability_<kind>`
   (`appetite/bridge.ts`, the `intel-bridge.ts` shape), so scoring, dedupe,
   mutes, routes and the relevance dial all apply unchanged.

A new thought family `build` (mark `BUILD`), default route `briefing`.

### A2 — The lanes (self-improve drains the ledger)

- `collectCapabilityIdeas()` is read **first** in `analyze.ts`, ahead of faults.
- `BacklogItemData.kind` gains `source` and `watch`; items carry `capabilityId`.
- `pickWork` reserves half the night's slots for new-data kinds when any is open.
- `propose` stops writing files blind: a `feature` item becomes a **change
  request** (issue + repo build + gate + PR). The blind draft PR survives only as
  the fallback when the build lane is unavailable.
- A `watch` item becomes `createMonitor(...)`.
- The capability row's status and outcome are written back, so the room can say
  what each idea became.
- `optimise` demoted per D3.

### A3 — Doctor folded in, and the room made unified

- `daydream-doctor` heartbeat activity; the croner and its host gate deleted.
- Doctor findings → `raiseFault` (`workflow_failing`, `workflow_dead_node`).
- `/jkai/doctor` → `/jkai/daydreams/improvement#doctor`.
- The Improvement room becomes **Appetite → Lanes → Doctor → Loop**, every
  capability showing its driver (which questions, which faults, which coverage
  gap) and its outcome (tool / source / watch / build / PR), assembled from
  recorded fields. No LLM writes any of it.

## Verification

- `npm run gate` (via `scripts/gate-remote.sh` on porkserv) then CI.
- On prod after deploy: `daydream_capabilities` exists (P4's drizzle trap —
  check, and create by hand if the CI push prompted); the `daydream-appetite`
  row is active with the right window; its first pulse names the pack size, the
  proposals, and how many the audit dropped.
- A capability lead appears in the next morning's briefing block.
