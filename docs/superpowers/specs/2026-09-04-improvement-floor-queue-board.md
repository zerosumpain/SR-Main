# The Improvement Floor — P1 read model + board, P2 owner interaction

**Status:** built autonomously 2026-09-04.
**Brief:** John — *"Review /daydreams/self improvement and come up with a radically
redesigned UI system… ideally as a kanban backlog with user interaction,
categorisation, epic/feature breakdown etc, and then delivery/testing"*, then
*"build p1 and p2, get it live"*.

Design artifact: https://claude.ai/code/artifact/dfe49e68-cb60-497c-b817-38fd115038dc

## The finding this is built on

Read off production, 2026-09-04:

| | |
|---|---|
| `improvement_backlog` | **455 rows — 352 open, 302 never attempted** |
| Priority spread of the open pile | **280 of 352 at P2** |
| Intake vs drain, August | 291 in, ~45 out — **6.4 : 1** |
| `custom_tools` | 79 tools, **32 never called**; `reverse_geocode` 706 calls at a **63%** error rate |
| `daydream_capabilities` | **0 rows** — the appetite scan has not yet written a lead |

A random 70-row sample of the backlog collapses to about **twelve subjects**.
Eight open items ask for bank/PayPal duplicate-charge reconciliation, and four
items on that same theme have *already shipped* — some before the open ones
were written. The engine re-asks for what it already built.

`pickWork` sorts on `priority`, and 80% of the queue shares one value. So the
ordering that decides what gets built tonight is effectively arbitrary, and the
room had **no surface at all** for the 352 items — only a count in a rollup cell.

## What P1 and P2 are

- **P1** — the queue becomes a six-stage board that can be read, filtered and
  sorted. Read-only; no schema change.
- **P2** — the owner can reprioritise, move, park and **fold duplicates**. Four
  actions; additive JSON fields on an existing datastore record, so no
  `drizzle push` and no rename prompt.

P3 (automatic epic clustering) and P4 (inflow attribution) are **out of scope**
and deliberately not started.

## The six stages

Derived, never stored — `stageFor()` in `$lib/selfimprove/board.ts`:

| Stage | Means | Derived from |
|---|---|---|
| `proposed` | the engine wants it, nobody has ruled | capability `proposed` |
| `accepted` | ruled yes, waiting for a slot | backlog `open`, `attempts === 0` |
| `building` | a lane is on it | backlog `open`, `attempts > 0`, under `MAX_ATTEMPTS` |
| `verifying` | an artifact exists and is unproven | shipped but the tool has 0 runs, or a PR is open |
| `live` | used at least once, or merged | `run_count > 0`, or a merged PR |
| `parked` | declined, folded, or out of attempts | `abandoned`, folded, `attempts >= MAX_ATTEMPTS`, capability `declined` |

`verifying` is the stage that did not exist before and is the reason the board
is worth building: **32 of 79 tools are shipped, enabled and never called**, and
nothing in the room distinguished those from the ones doing work.

## Decision Log

| # | Fork | Options | Chosen | Why | Reversible? |
|---|---|---|---|---|---|
| 1 | Where the read model lives | (a) `$lib/selfimprove/board.ts`, (b) `$lib/daydream/board.ts`, (c) `$lib/dashboard` | **(a)** | `selfimprove → daydream` is an existing one-way edge and `daydream → selfimprove` does **not** exist (the two hits are comments). Putting it in daydream would open a new `daydream <-> selfimprove` cycle in front of `check-module-boundaries`. | Yes — moving it later is a rename. |
| 2 | Does the board replace `AppetiteBoard`? | (a) replace, (b) keep both, (c) merge | **(b)** | The appetite board is the *ruling* surface for a lead — score decomposition, citations, accept/decline — and production has zero rows in it today, so it costs nothing on screen. The board's centre of gravity is the 352 backlog items, which have never had a surface. | Yes — drop the `proposed` column from the board if it reads as duplication once live. |
| 3 | Epic grouping in P1 | (a) auto-cluster now, (b) group only where a link already exists, (c) flat only | **(b)** | Auto-clustering is P3 and must reuse `findRelatedIdea`; a second matcher is the exact bug `reference_selfimprove_driver_link` was written about. Grouping by `capabilitySlug` / owner-set `epicSlug` needs no matcher and is free. | Yes — additive. |
| 4 | Payload size for 455 items | (a) send everything, (b) trim + cap, (c) paginate server-side | **(b)** | A trimmed item is ~250 bytes; 455 of them gzip to well under the client budget. Server-side pagination would put a round trip between the owner and a filter, which is the interaction the board exists for. | Yes. |
| 5 | Fold semantics | (a) delete the losers, (b) mark them `abandoned` with a reason and a pointer | **(b)** | Nothing in this engine deletes: a declined lead that can be re-proposed is the failure `improvement_backlog` was written to stop. `abandoned` is already a status `pickWork` skips and `addIdeas` will not resurrect (existence is checked by key). | Yes — `foldedInto` can be cleared. |
| 6 | Which item survives a fold | (a) the one clicked first, (b) highest priority then most attempts | **(b)** | The item carrying attempt history and a `lastError` is the one whose record is worth keeping — the same reason `addIdeas` refuses to rewrite an existing slug. | n/a |
| 7 | Can a drag start a build? | (a) yes, (b) no — a move only queues | **(b)** | A repo build can spend £2 and `daydream.appetite.autobuild` is deliberately inverted. A drag is a queue operation; spending still needs the lane's own gate. | n/a — safety. |
| 8 | Does the board write `priority` straight through? | (a) yes, (b) behind a confirm | **(a)** | `priority` is 1–5, bounded, audited by the datastore, and reversible in one click. A confirm on a stepper makes the one lever that fixes the 6.4:1 annoying to use. | Yes. |
| 9 | Cap on cards rendered per column | (a) none, (b) 40 with a "+N more" | **(b)** | 302 cards in one column is a scroll nobody reads. The cap is a render cap only — filters and counts run over the whole set, so the numbers never lie about what is hidden. | Yes. |

## Explicitly not touched

`verify.ts`, the smoke gate, the strictly-beats-incumbent rule in `repair.ts`,
and `WORK_CAPS`. The board changes what gets **picked**; it never changes what
gets **past**.

## Code review, applied 2026-09-04

An adversarial review of the branch found eight issues. All eight are fixed;
each one is now pinned by a test.

| # | Finding | Fix |
|---|---|---|
| 1 | **Parking a shipped item destroyed `status: 'shipped'`**, and dragging it back wrote `open` — putting an already-built tool in front of `pickWork` to be built a second time, the exact spend decision #7 exists to prevent. `foldItems` had the same hole. | `LEGAL_MOVES` gives `live` and `verifying` **no exits**; `setParked` and `foldItems` refuse a `shipped` row by name. Nothing was gained by allowing it: a shipped row already stops `addIdeas` re-proposing the idea. |
| 2 | **Tools were matched against the whole backlog**, so an open idea sharing two content words with `reverse_geocode` rendered "706 calls · 63% errors" for work nothing had built — and, first-match-wins, consumed the tool so the genuinely shipped sibling read `live` instead of `verifying`. That silently deflated the headline "shipped, never called" figure. | Candidates restricted to `status === 'shipped'`. |
| 3 | **An attempt-exhausted item could not be put back** — it is already `open`, so the write was a no-op and the card snapped straight back to Parked. | `setParked(slug, false)` resets `attempts` when the item is at or over the ceiling, keeping `lastError` (which the author prompt reads). The owner asking again *is* the override. |
| 4 | **The drill held a stale `WorkItem`** across `invalidateAll()`: after "Raise to P1" it kept showing P2 and a second click rewrote the same value. | The drill holds an **id**; the item is `$derived` from `view.items`. |
| 5 | **`nextPriority` wrapped 1→5 under a button labelled "Raise"** — one extra click silently sent an item to the bottom of the queue. | Raise clamps at P1 and disables there. Lowering is an explicit P1–P5 row in the drill. |
| 6 | **Bulk actions fired one full page reload per item** (each re-paging the datastore and re-running the already-served sweep), and did not disable while running. | `backlog_priority` / `backlog_park` take `slugs[]`; one request, one reload. Partial failure is reported per slug rather than swallowed. Buttons disable on `busy`. |
| 7 | `counts` and `epics` were serialised to the client and never read. | `epics` and `summariseEpics` deleted; `counts` now drives the "N/total" a filtered column shows. |
| 8 | The "never tried" chip counted every `attempts: 0` row (leads, abandoned work) while the tile beside it counted open work only. | The `untried` flag means open **and** never attempted, so the two agree. |

**Not a finding, recorded anyway:** this page already ships a large payload —
`loadAttempts` sends 500 `tool_attempts` rows including `handlerCode`, and
three separate call sites each page all 455 backlog rows per load. The board
adds to that rather than causing it, and trimming it is its own piece of work.
