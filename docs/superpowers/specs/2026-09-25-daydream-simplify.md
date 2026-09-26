# Daydream, simplified — one loop, one feed

2026-09-25. Owner brief: *"it needs a huge simplification, as well as integration
into health and the apple-app. It's fixating on the wrong things, executing the
wrong sort of activities."* Wanted: a model spending spare cycles thinking about
his activity **equally across every channel** (Home Assistant, health, email,
chat, diary, money) — correlation, efficiency and quality-of-life proposals,
self-directed research, building new functionality, health planning and
observation, activity and reading suggestions, financial analysis that is
useful. Location "adds limited value". It should integrate deeply with the
iPhone app and use activity and health data to daydream usefully for its users.

## What was measured (prod + `origin/master` 250b4a9e, read-only)

**Size.** 67,446 lines / 325 files (11.5k tests); 25 `daydream_*` tables; 24
heartbeat jobs; 13 rooms; one 1,179-line API with 59 actions; ~310k tokens/day.
The thinking itself is ONE ponder call every 2h.

**What it talks about (30d, 232 thoughts).** Diary/plans 32% (9 of the last 10
WhatsApps; Rome ×4), intel-graph shapes 18.5%, health 12% (27 of 28 before 3 Sep,
the health lens's 7 proposals this week all merged as echoes), money 11.6% (none
in 11 days), mail-security counts 10%, places 8.6%, Home Assistant 1.7%,
**chat 0% — there is no chat channel**.

**What it does that produces nothing.**
- 491 hypotheses, **0 held**; ~80% tested on four people with no health data of
  their own (and a bug copies John's activity into all four).
- Sweep: 767 FDR survivors, the top ones identities (rain↔precipitation).
- 58 self-built tools in 30d, 33 never run, 6 about F1. 0 PRs.
- Observe polls 5 people every 2 min: 5,034 runs/week, 149k trail rows (42 MB).
- 83 thoughts suppressed "uncertain after review" at ~13k tokens each.
- `daydream-suggest` has no handler (168 skips/week); compose "0 phrased" ×328.

**What he rated useful.** Concrete anomalies — a double Canva charge, a date
clash, a PAYE code change, a vehicle-tax slot. Not useful: "1 September is
carrying several admin loads", security-mail burst counts, graph shapes.
Feedback stopped 18 Sep.

**Health and the app.** Nothing daydream produces reaches the iPhone: it picks
its own channel and never goes through `notifyOwner`, so the phone's pull queue
never sees a thought. It reads only COUNTS from SR-Health (`health-remote.ts`),
never the hub digest (moves, tripwires, experiments, forecasts, verdict) nor the
~40 HealthKit kinds the app uploads. "Users of the app" is the owner today: the
companion is multi-user by schema and holds one row; SR-Health has no person
column; pairing is owner-email only.

## Why the lens didn't fix it

The 2026-09-17 lens rotated what the pack WEIGHTED, but every cycle was still
the same ~170-card haystack. 74% of first-pass musings were echoes. Rotation of
emphasis over a fixed haystack is not rotation of attention.

## Decisions (owner, 2026-09-25 — all four as recommended)

| # | Decision |
|---|---|
| D1 | **Location moves out and slims.** Daydream stops reasoning over places. The trail collector moves to `$lib/presence` (Landgrab reads it), at a slower poll. Daydream gets a journeys tool reading the app's own track when a question needs it. |
| D2 | **Question-led with tools.** Each cycle picks ONE question (channel × outcome, even rotation), investigates with read-only tools + `correlate()`, writes 0–2 cited notes. |
| D3 | **Builds are proposals into the existing backlog.** Delete the toolsmith, appetite and fault feeds. |
| D4 | **Owner now, per-person ready.** Notes keyed by person from day one; non-owners would get health + activity channels only. The four multi-user prerequisites are NOT in this programme. |

## The shape

### One loop — `daydream-think`

A heartbeat activity, 07:00–23:00 London, every 45 min, same spare-cycle gates
as ponder (no jobs in flight, owner idle 20 min) and the same Codex caps
(`budget.ts`, in `SPENDING_ACTIONS`).

1. **Pick a question** — `think/questions.ts`, pure, clock-derived like
   `ponder/lens.ts` so a restart cannot reset the rotation. Two axes, both
   rotated evenly and independently:
   - **channel**: health · home · mail · chat · diary · money · research
   - **outcome**: correlate · efficiency · quality-of-life · research · build ·
     health-plan · suggest (activity/reading) · money-analysis

   A question is a channel × outcome pair plus a one-line brief ("Look at the
   house's heating against how he slept — is there something to change?").
   Cross-channel is the default: the channel is where it STARTS, not a fence.
   Pairs that make no sense (build × chat) are skipped by a table.
2. **Investigate** — a tool loop modelled on `heartbeat/llm.ts` `heartbeatTurn`
   (≤6 rounds, budget-scaled). **Every tool result is wrapped by CODE as a card
   with an id**; the model can only cite card ids. That keeps the cite-or-die
   guarantee `ponder/lookups.ts` protected, moved from "code built the pack" to
   "code built every card the model saw".
3. **Write** — JSON `{notes: [{outcome, title, body, cites[], action?}]}`, ≤2.
   `ponder/schema.ts`'s audit is reused: a note citing a card that was never
   issued dies whole. Dedupe against live thoughts via `refutations.liveEchoOf`.
4. **Deliver** — `notifyOwner({category: 'daydream'})`. New category in
   `notify/categories.ts`. Routing (WhatsApp / phone / feed-only) is the owner's
   existing per-category routing, editable on the phone. `deliver.ts`'s channel
   logic, `routes.ts` and the WhatsApp relevance grammar are deleted; bare
   verdict replies (useful / not that / never) stay.

### Two tool sets, never one — the injection boundary

A cycle holding private data must never read text somebody else wrote while it
can also reach outwards. So:

- **private cycles** (every channel but research): positive allow-list of
  read-only site tools over owner data — health hub, health series, HA history,
  mail METADATA and extracted timeline facts (never raw bodies), chat thread
  summaries, calendar, spend, memories, `correlate`, journeys. No web.
- **research cycles**: web search + fetch + the owner's stated interests and
  notebook topics as the brief. No private-data tools. Its notes can cite URLs.

The allow-lists are positive, pinned by tests, exactly as `lookups.ts` does —
"not flagged destructive" is not a read-only list.

### Health, deeply

New tools reading SR-Health over the existing service lane:
- `health_hub` — the full `/api/health/hub` digest: tripwires with meanings,
  moves, live experiments, forecast cones, verdict.
- `health_series` — daily HealthKit metrics from `apple_health_metrics` (×100
  storage scaling!) + Whoop: wrist temp, resp rate, HRV, RHR, daylight, state of
  mind, sleep stages, steps, workouts.
- `correlate(a, b, days)` — Spearman + BH over the owner's daily series, reusing
  `sweep/stats`. A model ASKS for a correlation it has a reason to want, instead
  of a nightly sweep testing 39,759 pairs.

The `health-plan` outcome writes a proposed week (training/sleep/recovery) that
the app and /health show beside their own rule-based moves.

### Surfaces

- **`/jkai/daydreams`** — ONE page: the feed of notes (grouped by outcome, 👍 /
  👎 / never / a note that becomes a memory), plus a one-line engine strip
  (last cycle, next question, budget). The 12 other rooms go; room URLs 308 to
  the page. The non-daydream rooms housed there (doctor, improvement, backlog,
  watches) keep their routes.
- **iPhone Today** — a "Noticed" card: `/api/native/today` gains a `daydream`
  section (top 2 undelivered-or-recent notes); `POST /api/native/daydream/feedback`.
- **iPhone Health tab** — health-plan and health notes under "The read".
- **Phone notifications** — free, via the `daydream` category.
- **Briefing** — `buildDaydreamBriefing` re-pointed at notes.
- **/health web strip** — deferred: needs a Health→Main service call that does
  not exist yet. The app tab covers the owner meanwhile.

### Kept

Codex caps (`budget.ts`), cite-or-die audit, live-claim dedupe, `never_kind`
mutes, feedback, the notebook (used by /jkai/notes and news), memory
consolidation (jkai memory reads its themes), `day_features` for the owner only
(the series source for `correlate`), the bank pull (spend is a money tool's data).

### Deleted

Detectors + snapshot, rules + rulesmith + backtest, hypotheses + steers, leads +
explore, sweep job + `sweep_findings`, ponder pack/lens/adversary, compose +
review/adjudicate (the audit + a single self-check replace them), offers, mail
classifier, spend extractor, intel bridge + weave, signal registry + hourly HA
harvest, appetite, faults, starvation, engine-proposals, weekly letter, digest,
places/naming/family rooms, per-person feature building.

Tables are **dumped to `/opt/strange-rambling-svelte/backups/` then dropped**.

### Location (D1) — revised 2026-09-25 evening

The move-out assumed Landgrab still read the trail. **It does not exist**:
Landgrab was pruned from Main in #871 (2026-09-13); `/projects/landgrab` 404s
and its two heartbeat rows (`geo-territory`, `landgrab-weekly`) have skipped
hourly with "no handler registered" since. Nothing outside daydream reads
`daydream_trail`. So there is nothing to move it FOR:

- `daydream-observe` (5 people every 2 min) and `daydream-places` are paused,
  as are the two orphan Landgrab rows. Tables stay until P4 dumps them.
- The loop's one view of location is the `activities` tool — the phone's own
  activity list (Apple workouts + the app's background outings, via SR-Health's
  read-through of the companion), with NO coordinates. `ha_get_history` can
  still read a person entity if a question needs a zone.
- `$lib/presence` is not built.

## Phases — each a PR, each live before the next

| Phase | What | Verify |
|---|---|---|
| **P0** | **DONE 2026-09-25 19:0x UTC** — paused (status `paused`, seed is `onConflictDoNothing` so a deploy won't revive them): suggest, hypothesise, sweep, explore, rulesmith, appetite, offers, spend, weekly. `signals` kept (free; ponder's house cards read it until P1). | pulses stop; ponder/compose unaffected |
| **P1** | `daydream-think` + questions + tool sets + `correlate` + health tools + `daydream` notify category + `subject` on thoughts. Runs beside ponder. | first live cycle writes a cited note; lands in the phone queue |
| **P2** | Surfaces: one-page feed, native Today section + feedback endpoint, iOS Today card + Health tab strip, briefing re-point. Ponder + compose disabled. | screenshot of feed; iOS CI screenshot of Today; `/api/native/today` carries `daydream` |
| **P3** | `activities` tool; observe/places + orphan Landgrab rows paused (Landgrab is gone — see D1 revised). | a cycle can cite an `activities` card; no trail writes |
| **P4** | Deletion: modules, jobs, rooms, API actions; dump + drop tables; redirects. | build + gate green; room URLs 308; line count |

### P4b — the table drop (measured 2026-09-26, read-only)

P4a (#1000) and PR-C (#1002) deleted the code. Of the 25 `daydream_*` tables,
Main's code (src, scripts, packages, tests; export name and SQL name, `grep -a`)
no longer touches **12**: `sweep_findings`, `steers`, `lead_steps`, `offers`,
`rules`, `hypothesis_assessments`, `observations`, `digests`, `leads`,
`faults`, `capabilities`, `hypotheses` (the last two only in comments and a
2026-09-06 one-off migration script). `signals` (read by `selfimprove/analyze`
and `loop-health`) and `calendar_exclusions` (read by `daydream/calendar/store`)
are still read and stay, as do trail, places, thoughts, notebook ×3, memory
consolidation ×3, `day_features` and `spend`.

**Extracted apps.** SR-Jkai-Core and SR-Workflows each carry a pre-P4a copy of
`$lib/daydream`. An import-graph walk from their routes, hooks and scripts finds
live readers of six of the twelve: `observations` + `signals`
(`signals/registry`, `stats/sweep`), `digests` + `hypotheses` (`digest/build`,
`evidence`), `leads` + `capabilities` (`briefing`, Jkai-Core's
`appetite/store`), `faults` (`faults.ts`). Those six are **not dropped** —
dropping them would turn a stale copy into a runtime error. The other six are read
only by unreachable files (Jkai-Core's `ledger`, `offers`, `provenance`,
`rules/store`, `hypotheses/test`) or only by their own `schema.ts`.

**The gate.** Every one of the 25 tables is in `requiredTables` for both
`jkai-core` and `workflows` in `docs/module-ownership.json`, which
`scripts/check-extracted-schema.mjs` enforces in `gate-structural.sh` **and**
`ci-release.sh`. That file is generated from SR-Infra
`registry/operations.json` (`check-estate.mjs --write-ownership`), whose own
audit also demands each app's `schema.ts` declare exactly its
`requiredTables`. So even the six droppable tables cannot leave Main's
`schema.ts` without, in order: an SR-Infra registry edit, the two extracted
apps dropping their declarations (and Jkai-Core its dead modules), then the
regenerated ownership file here.

| # | Decision | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| P1 | What P4b drops now | Drop the six unread tables with a hand-edited ownership file / keep them declared until the registry moves | Keep declared | Hand-editing a generated file passes Main's gate but contradicts SR-Infra; the next `--write-ownership` puts them back and Main's gate then fails the release. A red release gate costs more than ~5.5 MB of dead rows. | Yes |
| P2 | Which tables the eventual drop covers | All 12 unread / the 6 with no reachable reader anywhere | The 6: `sweep_findings` (6,268 rows), `lead_steps` (4,372), `hypothesis_assessments` (763), `offers` (28), `rules` (2), `steers` (0) | The other six are still reachable in extracted apps. They go when those apps prune their daydream copies. | Dump makes it recoverable |
| P3 | Heartbeat rows for deleted activities | Keep paused / delete now | Delete now, after a CSV backup (runbook stage 1) | Decision 6 of the centralisation spec deferred this to P4b. 19 `system-scan` rows have no handler on master (17 daydream + `geo-territory`, `landgrab-weekly`); `seed.ts` seeds from the registry so they are not re-created. Pulses cascade. | CSV backup |
| P4 | Where the push risk sits | — | Drops-only | Prod holds 222 tables = schema.ts's 218 + the 4 `tablesFilter` exclusions; removing declarations yields drops and no creates, so no rename prompt. | — |

## Success, measured 30 days after P2

- No channel over 30% of notes; health ≥ 15%; chat and home each ≥ 8%.
- ≥ 1 in 3 delivered notes rated useful.
- ≤ 150k tokens/day; ≤ 4 daydream jobs; `src/**/daydream*` ≤ 12k lines.
