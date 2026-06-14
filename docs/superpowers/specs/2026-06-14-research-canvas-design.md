# Research Canvas — "The Desk" — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design) → planning
**Area:** `src/lib/deepdive/`, `src/routes/deepdive/`, `src/routes/jkai/research/`, `src/lib/canvas/`, `src/lib/db/schema.ts`
**Supersedes (UX):** the linear `/deepdive/[id]/progress` + `/deepdive/[id]/dashboard` pages and the `/jkai/research` form.

---

## 1. Vision

Rebuild the deep-research feature as a live **"desk"** canvas. A research prompt kicks off the existing background engine; as it works, **artefacts** (sources, facts, entities) land on the desk in realtime, like a desk getting messy with facts. A **GATHER ⇄ SYNTHESIZE** toggle flips the same artefacts between two live arrangements:

- **GATHER** — raw intake: new artefacts drop in at scattered positions with a dashed `UNFILED` border. The desk fills and gets messy.
- **SYNTHESIZE** — organised intelligence: a streamed LLM pass sweeps the loose artefacts into **categories, clusters and an entity rail**, drawing connector lines between related artefacts.

Synthesis is **sticky**: once an artefact is filed it stays filed; flipping back to GATHER does not eject it — new arrivals simply accumulate loosely around the organised core, until the next synthesize folds them in. Both modes are continuously live ("cutting-edge realtime research"). The user can explore the learning *as it is being developed*.

## 2. Goals & Non-Goals

**Goals**
- A spatial, realtime, explorable research surface that replaces the conveyor-belt UX (form → log → static dashboard).
- Reuse the existing 4-phase engine, SSE spine, and custom-canvas internals almost wholesale.
- On-demand, re-runnable, streamed synthesis the user triggers via the toggle.
- Drag + pin artefacts with persisted positions that survive re-synthesis.
- Apply to **both** deep runs (full desk) and quick answers (small desk).
- Hold to the existing warm-brutalist design system and the `/jkai/canvas` look & feel.

**Non-Goals**
- No new canvas library (Cytoscape is retired; we use the existing custom DOM+SVG canvas).
- No change to the search provider (Tavily), credibility scoring, or cross-session entity canon.
- No public-sharing rework in this phase (desk stays private; reuse the existing share-token pattern later if wanted).
- Not a multi-user collaborative canvas.

## 3. User Experience

### 3.1 Entry (the launcher)
`/jkai/research` is rebuilt as a launcher: a prominent prompt bar ("Research anything…"), Quick/Deep mode select, optional goals, and a grid of recent runs (merged quick + deep, as today). Submitting a deep run navigates to the desk at `/deepdive/[id]`; a quick run navigates to `/quickanswer/[id]` (small desk).

### 3.2 The Desk
A full-bleed, pan/zoom/drag canvas built in the same idiom as `/jkai/canvas`:
- **Pan/zoom** lifted from `jkai/canvas/[slug]/+page.svelte:1850-1909` (`panX/panY/zoom`, `zoomAt`, `fit`, `reset`, wheel `factor=exp(-deltaY*0.0015)`, `MIN_ZOOM=0.25`/`MAX_ZOOM=3`).
- **Cards** are absolutely-positioned DOM nodes (`transform: translate()`), draggable with grid-snap (`GRID=20`), lifted from `:1992-2069`.
- **Connectors** are SVG paths via the lifted `orthPath()` (`:1016-1053`) with `vector-effect:non-scaling-stroke`.
- **Minimap** lifted from `:1117-1164`.

### 3.3 Artefact taxonomy
| Artefact | Source | Card treatment |
|---|---|---|
| **Source** | `sources` row | paper card; domain + credibility label |
| **Fact** | `facts` row | paper card; confidence bar (accent) |
| **Entity** | `entities` row | black chip; Archivo Black name |
| **Counter-fact / challenge** (red-team) | `facts` w/ `isCounterfactual` | card w/ red "challenge" tab; auto-linked edge to the fact it refutes (`refutesFactId`) |
| **Relationship** | `relationships` row | **edge only** (orthPath), never a draggable card |
| **Category / cluster** | `synthesis_runs.clusters` | group header that appears in SYNTHESIZE |
| **Hypothesis / gap** | `report` JSON | special cards surfaced in SYNTHESIZE |

Engine search **queries** appear in the bottom activity ticker (and optionally as transient "search" slips), not as permanent cards.

### 3.4 GATHER mode (default while running)
As each phase writes to the DB, the engine emits artefact events. Cards arrive at deterministic, id-seeded scatter positions with a dashed burnt-orange `UNFILED` border + a small `● UNFILED` mono tag. Counters tick (sources/facts/entities/links); the ticker narrates the current search. Already-filed cards do not move.

### 3.5 SYNTHESIZE mode (user-triggered, re-runnable)
Hitting the toggle calls `POST /api/deepdive/[id]/synthesize`, which runs a **streamed** LLM pass over the current artefact pile, assigning categories, forming clusters, ranking facts and surfacing relationships, emitting `synthesis.*` events. On the desk, loose cards **smoothly morph** into category columns / the entity rail, `UNFILED` borders resolve to the solid hairline, and connectors draw. Run it again later and newly-gathered loose cards fold into the existing structure; **pinned cards never move**.

### 3.6 The flip (motion contract)
- **→ SYNTHESIZE:** loose cards smoothly morph (ease-in-out) into their group/cluster/entity positions; connectors fade/draw in.
- **→ GATHER:** filed cards **stay put**; only *new* arrivals appear, dropped at fresh id-seeded scatter positions *around* the organised core.
- Pinned/manually-moved cards (non-null `canvas_x/y`) always keep their position in both modes.

### 3.7 Cockpit layout
- **Top command bar:** `sr.` monogram + topic · centred **GATHER⇄SYNTHESIZE** toggle (the hero control) · live counters · controls (⏸ pause · ◼ stop · ⤓ deepen · ⤴ share/export) · status pill (`● gathering` / `● synthesising` / phase).
- **Full-bleed desk** beneath.
- **Collapsible left feed** (collapses to a thin spine): live activity log · source list · legend · artefact-type filters · synthesis history.
- **Bottom activity ticker:** dark strip narrating the engine's current action.
- **Floating minimap** (bottom-right).
- **Right inspector drawer** on card click: full detail (source content / fact provenance + sources / entity mentions), related artefacts, and an "explore further" follow-up action (reusing the existing `/explore` endpoint).

### 3.8 Quick vs Deep
The desk component is shared. Quick answers render a **small desk**: the handful of sources/facts from the single pass, no phase machinery, no red-team; the toggle still works (synthesize groups the few facts). Deep runs render the full phased experience.

## 4. Visual design
Anchored to the real tokens in `src/app.css` and the `/jkai/canvas` look:
- Surface `--bg #ede4d4`; cards `#faf6ee` / `--surface-elevated #e8dece`; hairline borders `rgba(26,16,8,.18)`; accent `--accent #c4570a`.
- Hard offset brutalist shadow `box-shadow: 3px 4px 0 rgba(26,16,8,.1)`.
- Labels JetBrains Mono (`--font-mono`); entity names Archivo Black (`--font-display`); body DM Sans; `sr.` mark DM Mono.
- `UNFILED` = `1.5px dashed var(--accent)`, no shadow; resolves to solid hairline + shadow when filed.
- Status hues from tokens (`--success` for gathering pulse, `--accent` for synthesising).

## 5. Architecture

### 5.1 Reuse / Build / Retire
- **REUSE-AS-IS:** engine orchestrator (`worker.ts:91-218`), `emit/getEmitter/shouldStop/requestStop/getAbortSignal` (`worker.ts:12-82`), SSE stream endpoint (`api/deepdive/[id]/stream/+server.ts`), canvas pan/zoom/orthPath/minimap/portal.
- **EXTEND:** `phase1/2/3` + `postprocess` (add artefact emits at insert sites); canvas drag (swap PATCH target); the `$state.raw` + 5ms-flush live-patch idiom; `ResearchResultNode.svelte` (reuse its token-stream + `--scroll-h` ResizeObserver as the synthesis card).
- **RETIRE (extract helpers first):** `DeepResearchViewer.svelte`, `/deepdive/[id]/dashboard`, `/deepdive/[id]/progress`, `/jkai/research` form, Cytoscape (both usages). Salvage badge/credibility/severity helpers + narrative builder before deletion.

### 5.2 SSE event vocabulary
Current envelope (`types.ts:26-30`): `{ type:'log'|'stats'|'status'|'error', message?, data? }`, routed through the generic `emit()` — **new types need zero transport change**. Extend the union with `'artefact'` and `'synthesis'` and add a monotonic per-session `seq` for ordering/dedup (DB PK `id` is the dedup key; `seq` orders).

New events (emitted **after** the `.returning()` insert resolves, so `id` is stable):

| Event | Emit site | `data` |
|---|---|---|
| `artefact` `source.created` | `phase1.ts:107-119`, `phase3.ts:142-152` | `{ seq, artefactType:'source', id, url, title, domain, category, phase, credibilityScore, credibilityType }` |
| `artefact` `fact.created` | `phase2.ts:213-221`, `phase3.ts:155-163` | `{ seq, artefactType:'fact', id, sourceId, content, confidence, isCounterfactual, refutesFactId, tags, eventDate }` |
| `artefact` `entity.created` | `phase2.ts:251-259` | `{ seq, artefactType:'entity', id, name, type, description }` |
| `artefact` `relationship.created` | `phase2.ts:345-353` | `{ seq, artefactType:'relationship', id, fromEntityId, toEntityId, relationshipType, sentiment, strength, sourceId }` |
| `synthesis.started` | synthesize endpoint | `{ seq, runId, scope, factCount }` |
| `synthesis.progress` | per `onToken` | `{ seq, runId, token }` |
| `synthesis.cluster` | per cluster formed | `{ seq, runId, cluster:{ id, title, summary, fact_ids } }` |
| `synthesis.done` | on resolve | `{ seq, runId, summary, clusters, tokensUsed }` |

**Batching (anti-flood):** artefact emits are coalesced — emitted per storeFacts/storeEntities batch and/or flushed on a ~100ms queue — so a deep run's hundreds of inserts don't overwhelm the stream or the 5ms client flush. The client merges by `id`.

### 5.3 Hydrate-then-stream contract
On mount the desk does an initial `GET /api/deepdive/[id]/data` (already exports facts/entities/sources/relationships) to hydrate existing artefacts, **then** subscribes to `/api/deepdive/[id]/stream` for deltas. This handles desks opened mid-run and EventSource reconnects (dedup by `id`).

### 5.4 On-demand synthesis endpoint
`POST /api/deepdive/[id]/synthesize`, body `{ scope: { factIds?, category?, pinnedOnly? } }`. Grounded in `postprocess.ts:158-223` (clustering + executive summary). Flow (mirrors the fire-and-forget background-job idiom at `api/deepdive/+server.ts:46-78`):
1. Resolve the fact set from `scope`.
2. Insert a `synthesis_runs` row (`status:'running'`), `.returning()` `runId`. **Ensure the emitter exists** (re-create if the 30s post-completion cleanup tore it down — see 5.8).
3. Emit `synthesis.started`.
4. Background (no await): `streamCompletion()` with `onToken → synthesis.progress`; per cluster → `synthesis.cluster`; on resolve update the run row (`complete`, summary, clusters, tokens, `completedAt`), set `desk_state='synthesized'` on included facts, emit `synthesis.done`. On error/abort → `failed`/`cancelled` + `error`.
5. Return `201 { runId }`.

Synthesis writes to its **own** `synthesis_runs.clusters` — it does **not** overwrite `researchSessions.report.clusters`.

### 5.5 Position persistence
`PATCH /api/deepdive/[id]/artefacts/[artefactId]/position`, body `{ artefactType, position:{x,y}, pinned?, deskState?, deskCategory? }` → updates `canvas_x/y` (+ optional flags) on the matching table by `id`. Mirrors the canvas drag-persist pattern (`:2037-2063`); drops the transient client override on success. **Do not** reuse the workflow node route.

### 5.6 LLM gateway
Use `streamCompletion()` from `$lib/deepdive/ai.ts:133-199` (Z.AI `glm-5.1` default + OpenRouter, abort signal, retry, idle watchdog). For non-streamed structured re-clustering use the sibling `jsonCompletion<T>()` (`ai.ts:92-131`). **`$lib/vertex` is stale** — fix `~/strange_rambling_svelte/CLAUDE.md` line 9 to point at `$lib/jkai/llm-client` (the real gateway `ai.ts` wraps). Never call a provider SDK directly.

### 5.7 Auto-layout
Artefacts arrive with `canvas_x/y = null`. Placement:
- **Scatter (GATHER):** deterministic position from `hash(artefactId)` within a phase-banded region (so reloads are stable and cards don't overlap pathologically), with a small jitter.
- **Organised (SYNTHESIZE):** category columns laid out left-to-right; facts stacked under their category header; entities collected into the bottom rail; positions computed by a grid packer.
- **Override:** non-null `canvas_x/y` (user-dragged or pinned) always wins in both modes.

### 5.8 Emitter lifecycle & per-run abort
- `getEmitter` tears down 30s after a session completes (`worker.ts:12-26`). The synthesize endpoint must call a guarded `ensureEmitter(sessionId)` (re-create if absent) so synthesis on a completed session still streams.
- Add a **per-`runId` AbortController** map for synthesis so a single synthesis run can be cancelled without aborting the whole session (the existing `abortControllers` is keyed by `sessionId`). Session-level stop still cancels everything.

## 6. Data model changes (`src/lib/db/schema.ts`)
All additive / nullable / defaulted → safe `drizzle-kit push`.

Append to `sources` (`:388-400`), `facts` (`:404-418`), `entities` (`:422-429`):
```ts
canvasX:        doublePrecision('canvas_x'),                  // null = auto-layout
canvasY:        doublePrecision('canvas_y'),
pinned:         boolean('pinned').notNull().default(false),
deskState:      text('desk_state').notNull().default('unfiled'), // 'unfiled'|'filed'|'synthesized'|'archived'
deskCategory:   text('desk_category'),
synthesisRunId: text('synthesis_run_id'),                     // FK → synthesis_runs.id (nullable)
```
(`relationships` get **no** position columns — edges only. `facts` has no existing `category` column, so `deskCategory` is genuinely new; keep `sources.category` distinct from `deskCategory`.)

New table:
```ts
export const synthesisRuns = pgTable('synthesis_runs', {
  id:          text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  sessionId:   text('session_id').notNull().references(() => researchSessions.id),
  scope:       jsonb('scope').notNull().default(sql`'{}'::jsonb`),
  status:      text('status').notNull().default('running'),     // running|complete|failed|cancelled
  summary:     text('summary'),
  clusters:    jsonb('clusters').notNull().default(sql`'[]'::jsonb`),
  tokensUsed:  integer('tokens_used'),
  errorMessage: text('error_message'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});
```
(Mirrors the `quickAnswers` table idiom.) No new columns required on `researchSessions`.

## 7. Routing / auth / migration / deploy
- **New page:** the desk at `/deepdive/[id]` (index `+page.svelte` mounting `ResearchDesk.svelte`). `/deepdive/[id]/progress` and `/deepdive/[id]/dashboard` become redirects to it. Quick answers mount the small desk at `/quickanswer/[id]`.
- **New APIs:** `PATCH /api/deepdive/[id]/artefacts/[artefactId]/position`; `POST /api/deepdive/[id]/synthesize`.
- **Auth (gotcha):** allowlisting is `PUBLIC_PATHS` in `src/lib/auth.ts:4-49`, **not** `PUBLIC_API_PATHS` in `hooks.server.ts`. Desk stays **private** — add nothing to `PUBLIC_PATHS`.
- **Rate limit:** add `/api/deepdive/[id]/synthesize` to the per-user rate-limit map (`hooks.server.ts:26-34`) — it is LLM-expensive.
- **Migration/deploy:** edit `schema.ts` → `npx drizzle-kit push` locally → `scripts/deploy.sh` (builds with `NODE_OPTIONS=--max-old-space-size=8192`, runs `drizzle-kit push --force` on the VPS before restart; additive columns won't hang). Verify live before iterating.

## 8. Components & files
**New**
- `src/lib/canvas/intelligence/ResearchDesk.svelte` — the desk shell (pan/zoom/drag/minimap, mode toggle, hydrate-then-stream store).
- `src/lib/canvas/intelligence/desk/` — `ArtefactCard.svelte` (source/fact/entity/challenge variants), `CategoryHeader.svelte`, `EntityRail.svelte`, `ActivityTicker.svelte`, `LeftFeed.svelte`, `InspectorDrawer.svelte`, `CommandBar.svelte`, `ModeToggle.svelte`.
- `src/lib/canvas/intelligence/desk/layout.ts` — pure functions: `scatterPosition(id, phase)`, `organisedLayout(artefacts, categories)`, edge routing helpers. (Pure → unit-testable.)
- `src/lib/deepdive/desk-events.ts` — `emitArtefact()` helpers + `seq` counter + batching/coalescing.
- `src/lib/deepdive/synthesis.ts` — on-demand synthesis worker (streamed) + per-run abort registry.
- `src/routes/api/deepdive/[id]/synthesize/+server.ts`
- `src/routes/api/deepdive/[id]/artefacts/[artefactId]/position/+server.ts`
- `src/routes/deepdive/[id]/+page.svelte` + `+page.server.ts` (desk host).

**Modified**
- `src/lib/deepdive/{phase1,phase2,phase3,postprocess}.ts` — artefact emits at the insert sites.
- `src/lib/deepdive/worker.ts` — `ensureEmitter`, export `seq` helper.
- `src/lib/db/schema.ts` — columns + `synthesisRuns`.
- `src/routes/jkai/research/+page.svelte` (+ `.server.ts`) — rebuilt launcher.
- `src/routes/deepdive/[id]/{progress,dashboard}/+page.svelte` — redirect shims.
- `~/strange_rambling_svelte/CLAUDE.md` — fix the `$lib/vertex` line.

**Retired:** `DeepResearchViewer.svelte`, Cytoscape usages (after helper extraction).

## 9. Performance & realtime
- **Virtualise** the desk: cap rendered cards (e.g. ≤200 visible); overflow collapses into per-category "stacks" with a count badge that expands on click.
- Deterministic positions → stable reloads, no layout thrash.
- Coalesced artefact emits + `$state.raw` wholesale patch + 5ms debounced flush keep the DOM update cost bounded.
- SSE reconnect hydrates by diffing the snapshot against held card ids.

## 10. Testing
- **Unit (Vitest):** `layout.ts` scatter determinism (same id → same position) + organised packing + no-overlap invariants; `desk-events.ts` seq monotonicity + batching coalescing; synthesis scope resolution.
- **Integration:** synthesize endpoint inserts a run row, streams `synthesis.*`, flips `desk_state`; position PATCH persists `canvas_x/y`; hydrate-then-stream produces no duplicate cards on reconnect.
- **Manual E2E (per CLAUDE.md verify-live discipline):** launch a deep run → watch artefacts arrive in GATHER → flip to SYNTHESIZE (cards morph, connectors draw) → drag + pin a card → gather more → re-synthesize (pinned stays, new folds in) → quick-answer small desk → deploy → verify on strangeramblings.com.

## 11. Key decisions
1. Replace the old linear pages (not additive). 2. Synthesis = streamed on-demand LLM pass, re-runnable. 3. Drag + pin, persisted, survives re-synthesis. 4. Canvas applies to deep **and** quick. 5. Relationships = edges only. 6. Counterfactuals = challenge cards auto-linked to refuted fact. 7. Synthesis writes to its own `synthesis_runs` row. 8. Deterministic id-seeded scatter. 9. Hydrate-then-stream. 10. Coalesced artefact emits + `seq`. 11. Per-run abort + `ensureEmitter`. 12. Stays private.

## 12. Risks & open questions (status)
- **Resolved:** LLM gateway (use `ai.ts streamCompletion`); schema location (columns per table); `facts.category` non-existence (new `deskCategory`); emitter teardown (ensureEmitter); stop granularity (per-run abort); ordering (`seq`); flooding (coalescing); relationship rendering (edges); re-cluster ownership (own table).
- **To confirm during build:** exact `ResearchResultNode.svelte` prop contract before extracting its streaming bits; the precise insert-site line refs may have shifted — re-grep before editing; virtualisation threshold tuning under a real large run.

## 13. Out of scope / future
Public shareable desks (share-token), multi-user presence, exporting the desk as an image/PDF, mobile-optimised desk (follow the canvas-mobile-ux pattern later), saved desk arrangements/snapshots.

## 14. Rollout
Additive schema first (safe push), build behind the existing private auth, ship the desk at `/deepdive/[id]` with redirects from the old pages, rebuild the launcher last, then retire `DeepResearchViewer`/Cytoscape. Deploy and verify live at each milestone.
