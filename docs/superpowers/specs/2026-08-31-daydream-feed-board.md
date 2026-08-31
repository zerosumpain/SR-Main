# Daydream feed: a board, a ruling loop, and a diary you can write to

Autonomous run, 2026-08-31. Kick-off: "do it autonomously" → **Full grade**, no
human contact until the final report. Decision Log at the foot.

## The brief, as five asks

1. The Feed tab becomes **three columns of cards** with **quick actions on the
   card face** — not buried behind an expand.
2. Where a feed item **refers to a location**, it gets an **expandable map**;
   every item gets a **clickthrough to the detail that is relevant to it**.
3. A **useful** verdict **weaves that intelligence into the /intel graph**.
4. A third quick action, **OK** — archives the suggestion without saying whether
   it was useful or not.
5. **Queue to model** on *any* feed item, suppressed ones included: the model
   considers it and rules. **A ruling becomes a memory**, so the engine learns
   and stops re-raising the same false claim ("two Canva charges" is one
   payment). That list of memories is **accessible**.
6. **Calendar**: create events that push to the real calendar, add detail to
   existing ones, proper buttons, the brown/orange accent.

## What already exists (precedent, not invention)

- `$lib/daydream/adjudicate.ts` — the reviewer. Already runs on a heartbeat,
  already has the Canva case as its specification, already writes
  `review_*` columns. What it lacks is an **on-demand** entry point and a
  memory of its own ruling.
- `$lib/daydream/notes.ts` — the shape for "a thing on a thought becomes a
  `jkai_memories` row, and the column is the display copy and the link".
  `recordRulingMemory` is this, for a verdict instead of a sentence.
- `$lib/jkai/intel/auto-extract.ts` — `extractIntoIntel({kind, refId, …})`
  already grows the graph from files, research and chat threads. A fourth
  `AutoKind`, `daydream`, is the whole of ask 3.
- `$lib/daydream/intel-bridge.ts` — intel → daydream. This build adds the
  return leg; the two are deliberately separate modules because they have
  opposite trust models (a bridged insight is a *candidate*; a woven thought is
  something the owner has already endorsed).
- `apple_calendar_create` / `apple_calendar_update` in the site-tool registry —
  the calendar write path exists and is reached through `executeTool`.
- `$lib/daydream/priority.ts` — colour is decided in one place. Nothing in this
  build hand-writes a `t-*` class from a database word.
- `hub/SectionHead`, `hub/FacetBar`, `.cta` / `.btn` — the hub's chrome, whose
  `--accent` is `#c4570a`, the burnt orange the brief calls brown/orange.

## Files to touch

| File | Why |
|---|---|
| `src/lib/db/schema.ts` | 3 nullable columns on `daydream_thoughts`: `intel_note_id`, `intel_woven_at`, `review_memory_id`. Additive only — no rename, no drop. |
| `src/lib/daydream/destination.ts` **(new)** | Pure: a thought → the one page that answers it. Ask 2's clickthrough. |
| `src/lib/daydream/destination.test.ts` **(new)** | |
| `src/lib/daydream/rulings.ts` **(new)** | Write a ruling to `jkai_memories`; read the list back. Ask 5. |
| `src/lib/daydream/rulings.test.ts` **(new)** | |
| `src/lib/daydream/weave.ts` **(new)** | Build the text for one thought and hand it to `extractIntoIntel`. Ask 3. |
| `src/lib/daydream/weave.test.ts` **(new)** | |
| `src/lib/jkai/intel/auto-extract.ts` | `AutoKind` gains `'daydream'`. |
| `src/lib/daydream/thought-store.ts` | `archiveThought` (ask 4); `recordFeedback` weaves on `useful`. |
| `src/lib/daydream/ledger.ts` | Return the three new fields so the card can link. |
| `src/lib/daydream/ponder/run.ts` | `rulingCards()` in the pack — this is *how* it learns. |
| `src/routes/api/daydream/thoughts/+server.ts` | `archive`, `review_now`, `rulings`, `calendar_list`, `create_event`, `update_event`. |
| `src/routes/jkai/daydreams/+page.svelte` | 3-col board, card-face actions, inline map, destination link, rulings section, Archived facet. |
| `src/lib/components/jkai/daydream/CalendarBoard.svelte` | Hub buttons + accent, create-event form, push-detail-to-calendar. |

## Verification

1. `npm run test -- <the four new specs>` — unit.
2. `./scripts/gate-remote.sh --build` on porkserv — full gate (the 8GB heap
   does not fit on homeserv).
3. Built server on homeserv, Playwright at 1440×3600 (`fullPage` captures only
   the viewport on `/jkai` — the scroll lives in `.jkai-body`): the feed renders
   three columns, a place card opens a map, the calendar shows solid accent
   buttons and a create form.
4. Merge → CI deploys → verify on production.

## Decision Log

**D1 — Isolated worktree, not the shared checkout.**
Options: edit `~/strange_rambling_svelte` in place / cut a worktree from
`origin/master`. Chosen: worktree. The shared checkout was parked on
`fix/jkai-code-route-always-offered`, ~30 commits behind master, with 29 dirty
files belonging to another session. Reversible: the worktree is disposable.

**D2 — The reviewer still never acts; the *pipeline* writes the memory.**
Ask 5 says the model should "generate memories". `adjudicate.ts` rule 2 is that
the reviewer returns a verdict and calls nothing with a side effect. Options:
give the reviewer a memory-write tool / have the caller compose the memory from
the verdict it returned. Chosen: the caller. The memory's text is assembled
deterministically from fields the model already returned, so the ruling is
recorded without widening the reviewer's blast radius by one tool. Reversible,
and the stricter of the two.

**D3 — `archived` is its own status, not `dismissed`.**
`recordFeedback` already writes `dismissed` for *not useful*. Reusing it for OK
would silently record a negative verdict the owner explicitly declined to give,
and would move the cold-start threshold. `archived` sets no `feedback`, so it
touches neither the kind weights nor the threshold count. Reversible.

**D4 — Weave on `useful` only, and never fail the vote.**
Options: weave everything reviewed / weave on an explicit button / weave on a
useful verdict. Chosen: on `useful` — that is the owner endorsing the content,
which is exactly the admission test the graph's `graph_state` gate exists to
apply. The weave is awaited but its failure is swallowed and reported: a graph
that is busy must never lose a vote. A manual "Weave now" button is offered too,
for anything voted before this shipped.

**D5 — Rulings live as a section on the Feed, not a new tab.**
The hub already has eight tabs and John's standing note is no over-engineered
UI. The rulings are *about* feed items, so they sit under them as section E.
Reversible in one move if it wants promoting.

**D6 — Calendar detail writes BOTH ways, and says which is which.**
"Adding detail on items" is ambiguous between the engine-local note that already
exists and a real CalDAV write. Both shipped, labelled: *Tell the engine what
this means* (local, unchanged) and *Add this to the calendar entry* (pushes
`notes`/`location` through `apple_calendar_update`). Doing only the local one
would have missed the ask; doing only the remote one would have thrown away the
PE-day note the local one exists for.

**D7 — Three columns collapse, they do not scroll.**
`repeat(3, …)` at ≥1200px, two at ≥820px, one below. An open card takes
`grid-column: 1 / -1` so the detail is full-width rather than a 320px column.
The hub's rule is that nothing may scroll the page sideways.
