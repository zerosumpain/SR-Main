# /jkai thread inspector — drill-downs and the Memory mode

Autonomous build, 2026-09-06. Brief: on the `/jkai` chat right rail, add a
double-click drill for every segment of information under the general,
intelligence, daydream and research lenses; add a Memory tab drawing from
`/jkai/intel/memory`, saying when a memory was used, updated or made stale;
lift the UI, interaction, relevance and integration of the column.

## What exists

`ContextRail.svelte` is a three-mode inspector (Context / Activity / Ledger).
Under Context, a lens strip picks one of five server-composed card sets
(`context-panel/compose.server.ts`), rendered by `ContextCard.svelte` in five
shapes: metrics, bars, links, series, note. A single click on a tile or row
selects it and offers "ask about this →", which drops the detail into the
composer via the `jkai:context-prompt` window event. The only drill that
exists is the graph card's `ondblclick` on a chip, which opens
`KnowledgeGraphModal` with an `EntityCard` beside the picture.

Memory on master (#726, #732) is `$lib/jkai/memory/`: `retrieveMemories`
(lexical + semantic + connected entities, ranked by `memoryScore`),
`renderMemories` (fits a 4,000-char budget), `writeMemory` / `forgetMemory` /
`pinMemory` (provenance, replacement by explicit id, tombstones, recursive
invalidation). `/jkai/intel/memory` is the editor; `/api/jkai/memory` is its
API. Every chat turn retrieves memories for the user message and passes them
as evidence — but nothing records which memories a turn was given.

## Design

### Drill-downs

- One modal shell, `context/ContextDrillModal.svelte`, portalled to `<body>`
  in the same register as `KnowledgeGraphModal` (opaque `--surface-elevated`,
  2px ink border, mono eyebrows, hairline rules).
- The body is a server-composed **drill manifest** from
  `GET /api/jkai/conversations/[id]/context-panel/drill?target=<key>`:
  eyebrow, title, subtitle, facts, sections (rows / prose / list), actions,
  and an `ask` bridge. The client renders the manifest generically; an
  `entity:<id>` target additionally mounts `EntityCard`, exactly as the graph
  modal does.
- Targets are opaque keys the composer attaches to each tile, row and card:
  `entities`, `entities:known`, `entities:new`, `relations`, `entity:<id>`,
  `research-desk`, `research-desk:active`, `research-desk:complete`,
  `research-run:<id>`, `thoughts`, `thoughts:new`, `thoughts:reviewed`,
  `thought:<id>`, `places`, `place:<id>`, `memory:<id>`, `memories:*`.
  `context-panel/drill.ts` parses them (pure, tested); `drill.server.ts`
  resolves them.
- Actions are declared by the server and executed by the modal:
  `link` (href), `ask` (context prompt), `post` (fetch to an `/api/` endpoint
  with a body, then re-read the manifest and bump the panel), `prompt` (a
  `post` that first asks for one line of text), `confirm` (a `post` behind a
  two-click confirm — forget, stop, archive).
- Interaction: double-click on any tile or row drills into that item; the
  card title is a button that drills into the card as a whole (the keyboard
  and touch route, since neither has a double-click); a single click keeps
  the existing select + "ask about this" bridge. Hover shows a `⤢` on the
  title so the affordance is discoverable.

### Memory mode

A fourth mode key. Payload from `GET /api/jkai/conversations/[id]/memory`,
composed by `$lib/jkai/memory/thread.server.ts`:

- **Figures** — live personal memories, pinned, served on the last turn,
  written from this thread.
- **Served last turn** — the memories the last assistant turn was given,
  each with why it was recalled. Read from `metadata.memory` on the assistant
  row, which this build starts stamping (see Decision 5). Turns before the
  deploy say "not recorded", never zero.
- **Relevant now** — `retrieveMemories` over the recent thread text: what the
  next turn would most likely be given. Rows that were retrieved last turn but
  did not fit the budget are counted as a tripwire.
- **This thread** — memories written from this thread
  (`sourceConversationId`) plus memory tool calls from the thread's recorded
  traces: written / recalled / forgotten, with the turn time.
- **Recently changed** — the last memories touched across the store, each
  with a state: current, pinned, replaced (by what), forgotten, expired,
  expiring.
- Foot: link to the memory page, and **review this thread now**, which runs
  the extraction pass on demand (`POST {action:'review'}`).

Row semantics match the cards: click selects and offers "ask about this";
double-click opens the memory drill (content, provenance, validity, linked
entities, lineage, use in this thread; pin/unpin, correct, forget).

### State vocabulary (derived from the row, never written by a model)

| state | rule |
|---|---|
| forgotten | `supersededBy = 'forgotten'` |
| replaced | `supersededBy` is another id |
| expired | `provenance.validUntil <= now` |
| expiring | `validUntil` within 14 days |
| pinned | `provenance.pinned` |
| current | otherwise |

## Files

- `src/lib/jkai/context-panel/types.ts` — `drill` keys on tiles/rows/cards; drill manifest schema.
- `src/lib/jkai/context-panel/drill.ts` (+ test) — target parsing.
- `src/lib/jkai/context-panel/drill.server.ts` — manifest composers per target.
- `src/lib/jkai/context-panel/compose.server.ts` — attach drill keys.
- `src/routes/api/jkai/conversations/[id]/context-panel/drill/+server.ts`.
- `src/lib/jkai/memory/contracts.ts` (+ test) — `selectMemoryLines`, `memoryState`, tool names.
- `src/lib/jkai/memory/thread.server.ts` — the Memory mode payload.
- `src/routes/api/jkai/conversations/[id]/memory/+server.ts` — GET + POST review.
- `src/lib/workflows/chat/general-chat.ts` — memory section reports served ids; returned from `generalChat`.
- `src/routes/api/workflows/orchestrator/chat/+server.ts` — stamp `metadata.memory`.
- `src/lib/workflows/chat/memory-review.ts` — export `reviewConversation`.
- `src/lib/components/jkai/context/ContextDrillModal.svelte`, `MemoryMode.svelte` — new.
- `src/lib/components/jkai/context/ContextCard.svelte`, `ContextRail.svelte` — wiring.

## Verification

- `npx vitest run src/lib/jkai/context-panel src/lib/jkai/memory`.
- `./scripts/gate-remote.sh` on porkserv (check + test + build).
- `vite dev` from the worktree, Playwright at 1440×1000 and 390×844: open
  `/jkai?c=<id>`, double-click a topics row, assert the drill modal; switch to
  Memory, assert the figures cell; screenshots to the scratchpad.
- Ship by PR → CI → merge; verify `build/.deploy-sha` and grep the deployed
  client chunk for the modal's class.

## Decision Log

1. **Where to build** — the main checkout was detached behind master; work in
   `.worktrees/intel-memory`, already at the deployed SHA. Reversible.
2. **One modal, server manifests** vs. per-lens modals — one shell, because
   four shells drift and the domain knowledge belongs beside the database.
   `EntityCard` is the one client-side embed, copying the graph modal.
3. **Double-click plus a title button** vs. double-click only — a double-click
   has no keyboard or touch equivalent, so the card title is the second route
   in. Single click is unchanged.
4. **Memory as a mode, not a lens** — a lens is a reading of what the thread
   is about; memory is what jkai carries into it regardless of subject. It
   sits beside Ledger.
5. **Record "used" by stamping the assistant row** (`metadata.memory`, like
   `usage`) vs. a new ledger table — no schema change, and the conversation
   loader already reads that column. History before the deploy is reported as
   "not recorded". A table can replace this later if the stamp gets heavy.
6. **Prompt selection unchanged** — the prompt is already relevance-ranked on
   master; the rail shows what it did rather than changing what it does.
7. **Health lens** — not in the brief's four; its tiles get the generic card
   drill (value, detail, link to /health) so no lens is a dead end.
8. **Actions reuse existing endpoints** (`/api/research/[id]/control`,
   `/to-intel`, `/to-drive`, `/api/daydream/thoughts`, `/api/jkai/memory`) —
   nothing new is writable except the on-demand memory review, which is the
   existing extraction pass exported.

## Follow-up (same day): sources, a 3D entity map, places on a map

John's three asks after the first ship, built on the same manifest:

- **Research sources.** The run drill lists the run's sources (most credible
  first, capped at 24) as rows that open the source in a NEW tab and leave
  the modal where it is. `DrillRow.external` is the flag; the modal renders
  such rows as `<a target="_blank" rel="noopener noreferrer">`.
- **A 3D entity map on the entities drill.** The manifest carries `graph`:
  every concept the thread produced (`buildThreadGraph(id, { full: true })`
  — a new option that ranks without trimming) with the edges between them,
  each node in one of four classes: the rail's known/new provenance crossed
  with whether it is one of the seven chips the rail is drawing. The modal
  lazy-loads `DrillGraph3D`, which is the intel page's `NetworkGraph3D` fed
  through `toNetGraph` and told to colour by category — one 3D view, two
  feeds, no second physics. Colours are the site's CVD-validated categorical
  ramp. A point-to-point relationship table sits underneath, typed verbs
  first.
- **Places on a map.** The manifest carries `map` (points with lat/lon, a
  label, an optional cluster radius): a daydream place with its radius, the
  places list with every point, the places a thought cites, and an intel
  entity whose TYPE names a place (a `location`-style type), geocoded from
  its name through `geocodePlace` injected by the route (Nominatim,
  rate-limited, cached; null rather than a guessed coordinate). The modal
  lazy-loads `DrillMap` (the shared Mapbox loader, as `FamilyMap` does).

Decisions: reuse `NetworkGraph3D` over a bespoke 3D view (one physics, one
interaction model); geocode the entity NAME rather than trust a model-written
coordinate (the geocoder module's own rule); lazy-load three.js and Mapbox so
no other drill pays for them.
