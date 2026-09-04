# The Improvement Floor — P4, where the work comes from

**Status:** built autonomously 2026-09-04, after P1+P2 (#681) and P3 (#682).
**Brief:** John — *"crack on with p4"*, scoped in the P1/P2 spec as *"stamp
`source` on every idea at intake — the four `addIdeas` call sites already know
which channel they are. Backfill is partial and should say so: items written
before the field exists read `unattributed`, never a guess. The channel counts
and the intake/throughput ratio come free once the stamp exists."*

## What was missing

The room could always say what the engine **built** and never why it was
**asked**. "It shipped a tool last night" arrived without "because you asked
about this four times", so there was no way to tell a queue fed by real
questions from one feeding on its own faults — and the 6.4:1 intake-to-drain
ratio existed only in aggregate, with no way to see which channel was
responsible.

## The vocabulary

A closed set of nine channels plus one honest gap, in
`IDEA_SOURCES` (`types.ts`):

| channel | arrives from |
|---|---|
| `question` | unmet needs and under-served intents, mined from what the owner asked |
| `fault` | a `daydream_faults` row — daydreaming tried and could not |
| `doctor` | a workflow-doctor finding that needed repo code |
| `starved` | a metric nothing writes — a hypothesis with zero pairs |
| `health` | a shipped tool erroring or never being called |
| `appetite` | a capability the site has never had |
| `engine` | the engine's own proposal about itself |
| `toolsmith` | an aside the author model had while writing something else |
| `trace` | a chat turn the owner analysed and sent |
| `unattributed` | **queued before the stamp existed. Never a guess.** |

The doctor split is the interesting one. Its findings reach the engine as
ordinary `daydream_faults` rows — that fold *is* the design, one door rather
than a second wire — so `FaultIdea.faultKind` is the only thing that still
says where they came from. `workflow_dead_node` and `workflow_failing` map to
`doctor`; everything else to `fault`.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Who sets the channel | (a) the call site, (b) the model may declare it, (c) inferred on read | **(a)** | An idea claiming its own provenance is the fabrication pattern this engine has been bitten by before. `coercePlan` already whitelists the fields it reads out of the author's JSON, so nothing a model writes can reach the field; `coerceSource` is the second lock, and an unrecognised value becomes `unattributed` rather than a plausible guess. | Yes. |
| 2 | Backfill the 455 existing rows | (a) infer from the title, (b) infer from `kind`, (c) `unattributed` | **(c)** | There is no way to recover which channel a row came through, and every inference would render as a record. The same rule `driverSource` follows, where a driver that could not be established reads `unknown` rather than inventing one. The count is reported in its own cell so the gap is visible rather than spread across the others. | n/a — a gap, not a choice. |
| 3 | One `addIdeas` call or one per channel | (a) split into six, (b) one call, `source` per idea | **(b)** | Six calls means six `listBacklog()` reads for the per-night intake cap, which pages all 455 rows each time. The cap already exists precisely because there are several call sites. | Yes. |
| 4 | Field name | (a) `source` on `WorkItem`, (b) `intake` | **(b)** | `WorkItem.source` was already taken and means which LEDGER the row is from (`backlog` \| `capability`). Reusing it silently overwrote the older meaning — caught by an existing test, which is the point of it. | n/a |
| 5 | How "drained" is dated | (a) a new `settledAt` field, (b) `updatedAt` | **(b)**, named honestly | A priority edit also moves `updatedAt`, so a long-dead row touched from the board reads as drained today. That **over**-states the drain, so the published ratio is a floor on how badly intake outruns it — the direction that does not flatter the engine. Said out loud in the type rather than left for someone to discover. | Yes — a `settledAt` stamp is additive. |
| 6 | Where the channel filter lives | (a) in the strip, (b) with the board's other filters | **(b)** | Pressing a channel narrows the same board every other chip narrows. Two places holding filter state is two places to forget to reset. | Yes. |
| 7 | A channel with nothing in it | (a) render a zero, (b) omit | **(b)** | Ten cells of which six read zero is a strip nobody scans. A channel appears when something has arrived through it. | Yes. |

## What it shows

- **Ten channel cells**, each `recent/total` over a 30-day window with the open
  count and how many of those a shipped sibling already covers. Each is a
  filter onto the board below.
- **The drain meter** — in, out, standing — drawn against whichever bar is
  longest, so a short drain looks short rather than being scaled to look
  adequate. Plus the ratio, with the honest reading when it is above 1.
- **Tonight's ceilings**, read off `WORK_CAPS`/`BUDGET_CAPS` and the live
  heartbeat row rather than restated in the component. Two dashboards once
  printed a cron expression as the live schedule long after the schedule had
  moved; that is the failure this avoids.

## Files

- `src/lib/selfimprove/types.ts` — `IDEA_SOURCES`, `IdeaSource`,
  `BacklogItemData.source`.
- `src/lib/selfimprove/backlog.ts` — `IdeaInput.source`, `coerceSource`.
- `src/lib/selfimprove/analyze.ts` — six groups stamped, `DOCTOR_FAULT_KINDS`.
- `src/lib/selfimprove/toolsmith.ts` ×2, `api/jkai/trace/[traceId]/analyse` — the
  other three call sites.
- `src/lib/selfimprove/board.ts` — `WorkItem.intake`, `SOURCE_LABEL`,
  `BoardFilter.sources`, `summariseInflow`.
- `InflowStrip.svelte`, hosted by `QueueBoard.svelte`.

## Code review, applied 2026-09-04

Six findings, all six real and all six fixed with a test.

| # | Finding | Fix |
|---|---|---|
| 1 | **The whole inflow calculation ran over a truncated population.** `summariseInflow` was called in the component on `view.items`, which `trimSettled` caps at 120 settled rows — so `channel.total` printed "everything ever queued through this channel" off a list missing most of the settled ones, and `drained` would saturate at the cap, making the published ratio read *worse* than reality. The same mistake `summarise` was already written to avoid. | Computed inside `buildBoard` **before** the trim, beside `totals`, and carried on `BoardView.inflow`. |
| 2 | **The strip rendered above the error guard**, so a failed load showed a drain meter of measured zeros directly above "the queue could not be read". A read failure presented as a measurement. | Moved inside the `{:else}` branch. |
| 3 | **An attempt-exhausted *open* item was counted as drained.** `stageFor` returns `parked` once attempts hit the ceiling while `status` is still `open`, and every failed attempt bumps `updatedAt` — so an item the engine tried and failed on three nights running counted as drained and was subtracted from the standing queue. Exactly backwards. | Counted off `backlogStatus`, never the derived stage. |
| 4 | **`intake` was not coerced on read.** `coerceSource` guards the write path only, so a row edited by hand, restored from a dump, or left behind by a renamed channel carried a value matching no cell — counted in the totals, shown in no channel, unreachable by the filter. The cells stopped summing to the total. | `coerceIntake` on read, mirroring the write-path guard. |
| 5 | **"the run has 25 minutes" hardcoded six lines below the live value it duplicates.** Raising `maxWallMs` would make the tile and the sentence disagree — the exact failure the `caps` prop was added to prevent. | Reads `{caps.minutes}`. |
| 6 | `improvementSchedule()` awaited serially in a load that otherwise parallelises carefully. | Moved into the `Promise.all` beside its sibling `doctorSchedule()`. |
