# Research Desk v2 — Design Spec

**Date:** 2026-06-15
**Status:** Approved-by-directive ("plan and build this autonomously") → planning
**Area:** `src/lib/canvas/intelligence/` (desk), `src/routes/jkai/canvas/[slug]` (style/palette source), `src/lib/deepdive/`, `src/routes/api/deepdive/[id]/`
**Grounding:** `docs/superpowers/specs/_research-desk-v2-integration-map.md`

## 1. Vision & scope

Evolve the Research Desk from a neat, single-axis surface into a workflow-canvas-grade exploration tool. Five workstreams (A already shipped):

- **A. Concurrency throttle** — DONE/deployed (`ed1b9dc0`): cap concurrent z.ai calls in phase2 (default 3, `DEEPDIVE_LLM_CONCURRENCY`).
- **B. Synthesize overhaul** — multi-dimension grouping (category / theme / entity-type / sentiment / entity-co-occurrence / similarity) rendered as overlapping **piles** of related cards (not neat grids), collapse/expand.
- **C. Canvas restyle** — match the `/jkai/canvas` workflow editor: panning grid background, node/edge/toolbar styling. Remove the desk's left sidebar; relocate only the **filters** into a **view-locked floating box** top-left.
- **D. Nodes via right-click** — bring the workflow canvas's `NodePalette` (right-click → add node) to the desk, with two new node types: a **research chat node** (LLM chat grounded in this session) and a **report/export node** (expandable report preview + docx/md download).

**Canonical target:** the embedded `ResearchDesk.svelte` (mounted at `/deepdive/[id]` and `/quickanswer/[id]`). The static `/jkai/research` launcher form is unchanged here (out of scope).

## 2. Resolved decisions (open questions from the map)

1. **Node persistence:** client-only, ephemeral node state for v1 (chat/report nodes are created on demand; the lifted `addNode`/edge-POST/PATCH server calls are stripped). Node positions reuse the in-client `positionById` model; not persisted across reload in v1.
2. **Floating-box contents:** the artefact-type filters (source/fact/entity/counterfactual — currently in `LeftFeed`) **plus** the new group-by selector. The mode toggle + counters stay in the top command bar.
3. **`streamCompletion` + reasoning:** extend `streamCompletion` with a `disableThinking?: boolean` option that passes `thinking: { type: 'disabled' }` to the z.ai create call — this keeps the existing **OpenRouter 429 fallback + idle watchdog** while stopping GLM reasoning-token starvation. (Cleaner than the direct-client-call path.)
4. **Auth:** the new `/api/deepdive/[id]/{chat,report,clusters,export/md}` routes are standard private deepdive APIs (gated by the `/api/*` hook); no `PUBLIC_PATHS` change.
5. **Sentiment grouping:** uses `relationships.sentiment` (per entity-pair; the only sentiment we store). The "sentiment" pile groups facts/entities by the sentiment of the relationships they participate in. Per-fact sentiment extraction is out of scope (note in UI: "relationship sentiment").
6. **Report staleness:** the report node previews `researchSessions.report`, and offers a **"Regenerate report"** action that fires `runPostProcessing(sessionId)` (fire-and-forget) so it reflects current facts (incl. post-load synthesis). Gated like `handleExport` (`!readonly && deskMode !== 'quick'`).
7. **Similarity clustering:** server-side greedy cosine-threshold over `facts.embedding` (reuse the `1 - (e <=> e)` idiom; threshold ~0.82), cached per session keyed on fact-count. Cluster labels derived from the highest-confidence member fact (truncated) for v1 (no extra LLM).
8. **Node kinds/colors:** add `research-chat` and `research-report` `NodeKind`s with colors in `KIND_COLOR` + `mapTypeToKind`.
9. **Palette flag:** ensure the desk enables the palette (don't gate on `PUBLIC_CANVAS_NEW_PALETTE === 'false'`; the desk mounts `NodePalette` directly).
10. **Report data:** add a dedicated `GET /api/deepdive/[id]/report` (returns `session.report`) for the node preview rather than bloating `/data`.
11. **Download:** reuse the existing `handleExport`/`<a download>` mechanism + export endpoints verbatim.

## 3. Canvas restyle (C)

Lift from `src/routes/jkai/canvas/[slug]/+page.svelte` into the desk:
- **Panning grid:** the `.viewport` two-layer linear-gradient grid (`:5945-5964`) + the three CSS vars (`--grid-offset-x=panX`, `--grid-offset-y=panY`, `--grid-cell=32*zoom`, `:3394-3396`) on the desk's viewport element (sibling of the transformed world).
- **Node frame:** reconcile the desk card *frame* to `.wf-node` (1.5px `--card-border`, mono label, `data-kind` 3px left bar, `.is-selected` accent outline) — keep the richer card bodies.
- **Edges:** synthesis/relationship edges adopt `.edge-stroke`/`.edge-hit` + `orthPath()`.
- **Toolbar/zoom chrome:** adopt `.hifi-toolbar`/`.composer-pill`/`.hifi-zoomctl`. Minimap/legend optional polish.

**Floating filters box (remove sidebar):** a `position:absolute; top:12px; left:12px` box that is a **sibling of the transformed world** (so it's view-locked, not panned) — mirrors how the minimap/legend/toolbar are anchored. Remove the `LeftFeed` sidebar; the activity feed/ticker stays (bottom). The box contains the artefact-type filters + the group-by selector (§5). Styled `--surface-elevated` + `.composer-pill` controls.

## 4. Right-click context menu + node types (D)

- Lift `NodePalette.svelte` (self-contained) + the `oncontextmenu` handler (`:3402-3413`) + palette state/handlers (`openPalette`/`closePalette`/`onPalettePick`, `:2203-2268`) + `screenToWorld`/`resolveOverlap` onto the desk. **Strip the server `addNode`/edge persistence** — desk nodes are client-only (decision §2.1). Scope the palette to a small research node set (chat, report — plus existing intelligence nodes if useful).
- **Register each new type** (per the registry's multi-list requirement): `CANVAS_NODE_TYPES` entry in `adapter.ts`; a config panel (clone `DelayPanel`) registered in `panels/registry.ts` **and** added to `SPECIALISED_PANEL_TYPES`; a `NodeKind` + `KIND_COLOR` color; a custom in-graph renderer branch under `$lib/canvas/intelligence/`.

### 4a. Research chat node
- In-graph renderer = a chat thread (clone `policy-engine/components/AskModel.svelte`'s SSE-over-POST reader): messages `$state`, `fetch` → `res.body.getReader()` + `TextDecoder`, parse `data:` frames (`sources`, `token`, `done`), render via `ChatMarkdown` + `sanitize-chat`, citation chips from the `sources` frame.
- Backend `POST /api/deepdive/[id]/chat` (streamed) — §6.

### 4b. Report/export node
- Expandable preview rendered from `GET /api/deepdive/[id]/report` (the `ResearchReport` JSON): exec summary, collapsible cluster sections, gaps (color via `display.severityColor`), hypotheses, follow-ups, source-diversity. Join `fact_ids`/`entity_centrality` against the `/data` payload the desk already holds.
- A **Regenerate report** button (fires `runPostProcessing` via a new endpoint, fire-and-forget) and **Download docx / md** buttons wired to the existing export endpoints via `handleExport` (+ the new `export/md` for the auto report).

## 5. Synthesize grouping overhaul (B)

Replace the single-axis category layout + boolean `arrange` toggle with a **`groupBy` enum**:
```
type GroupDim = 'cluster' | 'theme' | 'entityType' | 'sentiment' | 'cooccurrence' | 'similarity';
```
- **New pure module `desk/grouping.ts`:** `groupBy(dim, cards, edges, mentions, similarityMap) → { memberOf: Map<cardId,groupKey>, groups: {key,label,count}[] }`. Generalises `themeOf`/`factCat`.
  - Client-only data: `cluster` (deskCategory), `theme` (`themeOf`), `entityType` (`entities.type`), `sentiment` (bucket `store.edges` by `relationships.sentiment`).
  - `cooccurrence`: needs `entityMentions` added to `/data`; entities/facts sharing ≥1 fact form a group (client graph build).
  - `similarity`: from the new server endpoint (§6).
- **New `pileLayout()` in `layout.ts`** (replaces `organisedLayout`/`themeLayout` callsites): a grid of **pile anchors** (left→right packing). Each group is a fanned **stack** — member cards at `anchor + i*{dx:6,dy:8}` with descending z-index, capped ~5 visible, a label + `+N` count badge (reuse `CategoryHeader`/`ThemeHeader` host). **Collapsed by default; expand-on-click** spreads members into a column (animated via the existing `morphIds` 520ms transition). Manual/pinned overrides still win (`posOf` priority unchanged).
- **Default grouping** when synthesize first runs: `similarity` (the "pile of related facts" feel). Selector lives in the floating box (§3).
- **Performance:** collapsed piles render only their top ~3-5 cards + a count → `G*(3..5)` DOM nodes instead of `N`. Keep grouping funnelled through the single `positionById`/`groupBy` derived (O(N)/flush). Similarity is one cached server call per dimension-switch; embeddings never shipped to the client.

## 6. Backend changes

- **`streamCompletion`** (`ai.ts`): add `disableThinking?: boolean` → pass `thinking:{type:'disabled'}` on the z.ai create (keeps the OpenRouter fallback + watchdog).
- **`POST /api/deepdive/[id]/chat`** (streamed SSE-over-POST): body `{ question, history? }`. Load+404-guard session. Context = always-included compact overview from `session.report` (exec summary + top `ranked_facts` + cluster titles + top entities by `entity_centrality`; fallback top-confidence facts) **+** retrieval: embed the question (`generateEmbedding`) and run the `similar-facts` pgvector query for top ~12 on-topic facts; resolve `sourceId→{title,domain,url}` for `[n]` citations. System prompt: answer only from context, cite `[n]`, say if uncovered. Stream `sources` then `token`s then `done`. Wire `request.signal`. Uses `streamCompletion(..., { disableThinking:true, maxTokens:3072 })`.
- **`GET /api/deepdive/[id]/report`**: returns `session.report` (or `{ report:null }`).
- **`POST /api/deepdive/[id]/report/regenerate`**: fires `runPostProcessing(sessionId)` fire-and-forget; returns 202. (Progress visible via the existing SSE stream's status/log events.)
- **`GET /api/deepdive/[id]/clusters?by=similarity`**: greedy cosine-threshold clustering over `facts.embedding` (server SQL), returns `{ factId, clusterId, clusterLabel }[]`. Cached in-memory per `(sessionId, factCount)`.
- **`GET /api/deepdive/[id]/export/md`**: `generateReportMarkdown(sessionId)` (new sibling of `generateReport` in `docx-export.ts`, using `marked`-style assembly) → markdown download. Fills the report-as-md gap.
- **`/api/deepdive/[id]/data`**: add `entityMentions` (`{entityId,factId}`) to the payload (for co-occurrence). Optionally `noveltyScore`/`sourceAgreement` for pile sorting.

## 7. Components & files
**New:** `desk/grouping.ts` (+ test), `desk/FloatingFilters.svelte`, `desk/ResearchChatNode.svelte`, `desk/ReportNode.svelte`, `desk/GroupHeader.svelte` (or reuse CategoryHeader); `api/deepdive/[id]/chat/+server.ts`, `.../report/+server.ts`, `.../report/regenerate/+server.ts`, `.../clusters/+server.ts`, `.../export/md/+server.ts`; `generateReportMarkdown` in `docx-export.ts`; new node entries in `adapter.ts` + panels + `registry.ts`.
**Modified:** `ResearchDesk.svelte` (grid, palette wiring, floating box, pile rendering, groupBy selector, remove LeftFeed sidebar), `layout.ts` (`pileLayout` replaces organised/theme), `ai.ts` (`disableThinking`), `data/+server.ts` (entityMentions), `adapter.ts`/`+page.svelte` kind maps, `KIND_COLOR`.
**Retired:** the `arrange` boolean toggle, `organisedLayout`/`themeLayout` callsites (folded into `pileLayout`), the desk left sidebar.

## 8. Testing
- **Unit (Vitest):** `grouping.ts` (each dimension → correct memberOf/groups; cooccurrence graph; sentiment bucketing); `pileLayout` (anchors non-overlapping, fanned offsets, collapsed vs expanded positions); the similarity-cluster SQL helper (greedy threshold) if extractable; `disableThinking` passes the param; chat context-assembly + ranking helper (pure part); `generateReportMarkdown` shape.
- **Integration:** `/chat` streams `sources`+`token`+`done`; `/report` returns the JSON; `/clusters?by=similarity` returns factId→clusterId; `/export/md` returns markdown with Content-Disposition; `/data` includes entityMentions.
- **Manual E2E (per verify-live discipline):** restyled desk shows the grid; floating filters lock top-left; right-click adds a chat node (grounded answers + citations) and a report node (preview + regenerate + docx/md download); synthesize groups into piles; switch group-by dimensions; expand/collapse piles; deploy + verify on strangeramblings.com.

## 9. Rollout
Backend first (streamCompletion option, the 5 endpoints, /data field) → grouping logic + pileLayout (pure, tested) → desk restyle (grid/frame/toolbar/floating filters, remove sidebar) → palette + node registration → chat node → report node → group-by selector + pile UI → deploy + verify. Additive; no destructive schema (no new tables in v1 — chat is ephemeral).
