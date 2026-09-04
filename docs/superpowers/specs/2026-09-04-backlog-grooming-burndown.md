# Backlog room — grooming, categories and burndown

**Route:** `/jkai/daydreams/backlog` · **Branch:** `feat/daydream-backlog-grooming`
**Kick-off (John, 2026-09-04):** *"review /jkai/daydreams/backlog specifically. look at
visual elements to improve the backlog, and the functionality of grooming that backlog
(as well as stats relating to burndown). i want to be able to groom and contribute to a
particular item, change it's priority, add items myself, filter by category etc. work
autonomously to improve the UI"*

Autonomy grade: **Full** — no human gate between here and the live verification.

## What was already there (measured, not assumed)

Read against a local copy of the 455 production `improvement_backlog` rows on
2026-09-04. The room already shipped in three parts — the queue board (#681), themes
(#682) and inflow attribution (#687) — and it already does four of the six things the
brief asks for:

| Brief | State on arrival |
|---|---|
| change its priority | **present** — one-step raise on the card, full P1–P5 select in the editor |
| add items myself | **present** — `+ Add feature` → `backlog_create` |
| filter | **partial** — lane (5) and flag (5) chips, title search, intake channel |
| groom an item | **partial** — a three-step AI editor, but nothing it says is kept |
| contribute to an item | **absent** |
| burndown stats | **absent** |

So this is not a rebuild. It is: fill the two gaps, finish the third, and fix what
the measurement exposed about the surface itself.

What the surface actually looked like, at 1600px with the real 468 rows:

- The scroll container runs **8,297px**. The board itself does not begin until
  roughly y=2000 — five tiles, a manage row, ten intake cells, a three-bar meter, a
  seven-cell caps strip and two paragraphs of prose come first.
- Of six stage columns, **three were empty** (`proposed` 0, `parked` 0, and `in build`
  16 against `accepted` 347). Half the width of the primary work surface was drawn for
  nothing.
- `accepted` holds **347** items and the column stops at 40, ending in
  `+307 more — narrow with a filter`. There is no filter that reaches them: the queue
  cannot be worked through, only sampled.
- **293 of 413** open items are tied at P2, and there was no way to filter *to* a
  priority in order to break the tie.

## What ships

### A · Burndown — `board.ts` + `BurndownChart.svelte`

`summariseBurndown(items, { days, now })`, pure and unit-tested beside the rest of
`board.ts`. It reconstructs one point per day: an item was open on day *D* if it was
created on or before *D* and had not settled by *D*.

Two exhibits, never one with two y-axes:

1. **Standing queue** — a single-hue area/line. One series, so no legend; the title
   names it.
2. **In and out, per day** — added above the baseline, settled below, diverging from
   zero. Position carries the meaning as well as the hue.

Plus a trailing 7-day rate, the net per week, and a projection that is allowed to say
the queue never clears.

**`settledAt` is now written.** Until this branch the only date a settled row carried
was `updatedAt`, which a priority edit also moves — so an item settled in July and
re-prioritised yesterday reconstructed as "settled yesterday". `setParked`,
`foldItems`, `removeBacklogItem` and `markAttempt` now stamp `settledAt` on the
transition (and clear it on the way back to `open`). Rows that settled before this
branch have no stamp and fall back to `updatedAt`; the chart reports how many of each
it is drawing rather than presenting a reconstruction as a record.

### B · Contribute — a durable note thread

`BacklogItemData.notes` (additive datastore JSON, no `drizzle push`), written through
`backlog_note` / `backlog_note_remove`. The editor gets a fourth step, **Discuss**;
the card and the list show a note count.

The AI grooming conversation is persisted with it. Before this, closing the editor
threw away every question the model asked and every answer given — grooming an item
over two sittings was impossible.

### C · Filter by category

`BoardFilter` gains `kinds` (tool · feature · source · watch · engine — the literal
"category"), `priorities` (P1–P5), and the flags `groomed` / `ungroomed` / `noted`.
All of it lives in the pure module and is tested there, not asserted by screenshot.

### D · The surface

- **Board | List.** The board keeps the shape of the pipeline; the new list is for
  working through 347 items — one row each, sortable, paged at 100, with the priority
  stepper, park, select and groom inline.
- Empty stage columns are folded away by default, with the count kept visible.
- The filter bar is grouped, with the secondary dimensions behind a disclosure and an
  active-filter summary so nothing filtered is ever filtered invisibly.
- The intake strip and caps strip become collapsible, so the work surface is near the
  top of the page rather than 2,000px down it.

## Files

| File | Why |
|---|---|
| `src/lib/selfimprove/board.ts` | burndown, the new filter dimensions, sort modes, note counts |
| `src/lib/selfimprove/board.test.ts` | tests for all of the above |
| `src/lib/selfimprove/types.ts` | `BacklogNote`, `notes`, `groomingConversation`, `settledAt` |
| `src/lib/selfimprove/backlog.ts` | note writers; `settledAt` on every settle path |
| `src/lib/selfimprove/backlog.test.ts` | note writers, `settledAt` transitions |
| `src/routes/api/daydream/thoughts/+server.ts` | `backlog_note`, `backlog_note_remove` |
| `src/lib/components/jkai/daydream/rooms/BurndownChart.svelte` | new |
| `src/lib/components/jkai/daydream/rooms/QueueList.svelte` | new |
| `src/lib/components/jkai/daydream/rooms/QueueBoard.svelte` | filter bar, view toggle, column folding |
| `src/lib/components/jkai/daydream/rooms/BacklogEditor.svelte` | the Discuss step |
| `src/routes/jkai/daydreams/backlog/+page.svelte` | the burndown band |

## Verification

1. `npx vitest run src/lib/selfimprove/board.test.ts src/lib/selfimprove/backlog.test.ts`
2. `./scripts/gate-remote.sh --build` — the full gate on porkserv
3. Playwright at 1600px against the dev server with the 468 real rows: burndown drawn,
   list paging past 40, category filter narrowing, note saved and re-read after a reload
4. Live: `/jkai/daydreams/backlog` on strangeramblings.com after CI deploys

## Decision log

Every entry is a fork that would otherwise have been a question.

**1 · Rebuild the room, or fill its gaps?** Considered a redesign of the whole
backlog surface. Chose to keep the shipped board and add to it: four of the six
things asked for already work, and three PRs of measured reasoning sit behind the
board's rules. Reversible — every addition is additive.

**2 · Where the burndown gets its dates.** Options: (a) `updatedAt`, as `drained`
already does; (b) a new `settledAt`, written from here on; (c) a nightly snapshot
table. Chose **(b) with (a) as the labelled fallback**. (a) alone is known to
over-state the drain — a priority edit moves the date. (c) is a schema change and
gives nothing for the 455 rows that already exist. (b) costs four lines in the
writers and makes the chart get more truthful every night. Reversible.

**3 · Chart colours.** The instinct was `--accent` (in) and `--good` (out), the pair
the existing in/out meter uses. The palette validator failed it: **ΔE 5.2 protan**,
below the floor — a red-green reader cannot separate those two bars. `--accent` with
`--accent-ink`, the site's designated counter-accent, scores **14.4 protan / 27.3
normal** and passes in both themes. The chroma-floor FAIL that remains is a property
of the brand token (petrol is deliberately low-chroma) and the rule here is never to
hex-invent; position above/below the zero baseline plus direct labels carry identity
without relying on hue. Reversible.

**4 · Two charts, not one.** Standing queue runs 0–450; daily flow runs 0–30. A
second y-axis is the most common chart error there is. Two exhibits. Not reversible
in the sense that it should never be reversed.

**5 · "Contribute" = a note thread.** Options: comments; a full activity timeline; or
persisting the grooming conversation only. Chose owner notes **plus** persisting the
conversation — the second alone is the model talking to itself, and the first alone
loses the grooming that produced the brief. An activity timeline is bigger than the
ask and the run ledger already records what the engine did. Reversible.

**6 · A list view rather than raising the column cap.** 347 cards in one kanban
column is not a surface anyone grooms from; raising the cap to 347 ships a 40,000px
page. A dense paged list is the form the task actually has. Reversible — the board is
still there behind a toggle.

**7 · Notes bump `updatedAt`.** They follow the datastore convention rather than
writing around it. Safe now only because decision 2 moved the burndown off
`updatedAt` for settled rows; an open row's `updatedAt` is not used as a date by
anything the chart draws.
