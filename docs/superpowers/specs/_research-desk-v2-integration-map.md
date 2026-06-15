I have everything I need from the four readings to assemble the integration map. The task is purely synthesis of the provided readings into a precise engineering document. Let me return the full markdown.

# Research Desk v2 — Engineering Integration Map

> Targets the route `/jkai/research` (the static launch form) being rebuilt into a pan/zoom canvas, plus the embedded desk component `$lib/canvas/intelligence/ResearchDesk.svelte` (used in deepdive detail pages). All paths absolute under `/home/john/strange_rambling_svelte/`. The canvas to mimic is the per-workflow editor `src/routes/jkai/canvas/[slug]/+page.svelte` (8087 lines) — note: there is **no** `/jkai/workflow(s)` route; "the workflow canvas" is `/jkai/canvas/<slug>`. All shared SR tokens (`--bg`, `--accent`, `--text-primary`, `--divider`, `--card-border`, `--font-mono`, `--surface-elevated`) are already global, so no new fonts/colors.

---

## 1. Canvas restyle (mimic the workflow canvas)

### 1a. Shell: viewport + grid + pan/zoom world

The single biggest visual signature is the dotted/lined grid that tracks pan/zoom. Lift these as a unit:

- **`.viewport` grid CSS** — `src/routes/jkai/canvas/[slug]/+page.svelte:5945-5964`. Two-layer linear-gradient grid (`var(--divider) 1px`), `background-size`/`background-position` driven by CSS vars `--grid-cell` / `--grid-offset-x/y`. `.viewport.panning { cursor: grabbing; }`.
- **CSS var wiring on the element** — `+page.svelte:3394-3396`: `--grid-offset-x = panX`, `--grid-offset-y = panY`, `--grid-cell = 32 * zoom`. These three style bindings are what make the grid pan/zoom with the world.
- **`.graph` transform child** — markup `+page.svelte:3446-3450`, CSS `6416-6419`: `transform: translate(panX,panY) scale(zoom)`. All world-space nodes/edges live inside this.
- **Pan handlers** — `onPointerDown/Move/Up` `+page.svelte:1932-1962` (left-drag on empty viewport space).
- **Screen↔world helpers** — `screenToWorld()` `2167-2174`, `viewportCenterInWorld()` `2156-2165` (`(client - pan)/zoom`); needed for filter-box positioning (1d) and the context menu (§2).

**Delta for the desk:** the embedded `ResearchDesk.svelte` already has a panned/zoomed `.desk-world` (`:891`) and an absolute `positionById` memo (`:485`), so it has the world transform but **not** the grid background. For the new `/jkai/research` canvas route, add `.viewport` + `.graph` + grid vars wholesale. For the embedded desk, only the grid CSS + the three `--grid-*` vars need adding to its existing world container.

### 1b. Node/card style

- **`.wf-node`** CSS `+page.svelte:6431-6476`: flat warm-brutalist rectangle (148×52), mono 12px, `border: 1.5px solid var(--card-border)`, colored 3px left bar via `::before` keyed off `data-kind`. Pill variant for triggers `6479-6487`.
- **State/selection** `6542-6569`: `.active`→accent border, `.ok`→green, `.failed`→#c44, `.is-selected`→`outline: 2px solid var(--accent)`, `.drop-target`→`outline: 2px dashed var(--accent)`.
- **Default node markup template** `4260-4345` (the copy-template for new cards: handles + status dot + name/summary + output handle).
- **`KIND_COLOR`** map `1055-1068` drives the left-bar/legend/minimap colors.

**Delta for the desk:** the desk's existing fact/source/entity cards keep their own richer bodies; reconcile only the *frame* (border, mono label, `data-kind` left bar, selection outline) to `.wf-node` so they read as the same family. Do not replace the desk's card internals.

### 1c. Edges + handles + chrome

- **Edges:** `orthPath()` orthogonal elbow router `+page.svelte:1016-1053`; visible `.edge-stroke` markup `3496-3510` (`var(--accent)` active else `var(--text-ghost)`, `stroke-dasharray="3 3"` when active, `vector-effect="non-scaling-stroke"`, no arrowheads); wide transparent `.edge-hit` click target `3476-3495`; midpoint badges `3511-3517`; CSS `6420-6429`.
- **Handles:** `.node-handle` CSS `6570-6599` (12px circles, output `right:-7px` crosshair, input `.node-handle-input` `left:-7px`, hover fills `--accent`).
- **Toolbar:** `.hifi-toolbar` `5798-5806`, `.composer-pill` buttons `5875-5889` (mono 10px uppercase), zoom stepper `.hifi-zoomctl` `5920-5942`.
- **Minimap** CSS `6666-6701` / markup `5579-5603`; **legend** CSS `6639-6663` / markup `5570-5576`.

**Delta for the desk:** the existing synthesis edges (`cat:<cid> → factId`, from `synthesis-reducer.ts:93-119`) should adopt `.edge-stroke`/`.edge-hit` + `orthPath()`. Adopt `.hifi-toolbar`/`.composer-pill`/`.hifi-zoomctl` for the desk's toolbar (currently `ResearchDesk.svelte:1004-1025`). Minimap/legend are optional polish.

### 1d. Remove the left sidebar; relocate ONLY the filters into a view-locked floating box top-left

The desk's filtering/controls currently live in the toolbar/command-bar region. The v2 requirement: drop the sidebar, keep only the **filters** in a small box pinned to the viewport (not the world).

**How to pin fixed-in-viewport over a pan/zoom world:** the box must be a sibling of `.graph`/`.desk-world` (a direct child of `.viewport`), NOT inside the transformed `.graph`. Position it `position: absolute; top: 12px; left: 12px; z-index` above the world. Because it is outside the `translate/scale` transform, it stays locked top-left regardless of pan/zoom — this is exactly how the existing chrome (minimap `+page.svelte:5579-5603`, legend `5570-5576`, toolbar `5798`) is anchored: those live outside `.graph` and over the viewport. Mirror that placement and styling (`.composer-pill` controls, `--surface-elevated` background, mono labels).

**Open question:** the readings describe the desk's filter state but not a single enumerated "filters" model in the toolbar region (`ResearchDesk.svelte:1004-1025` is referenced as the toolbar but its exact filter fields are not in the readings). The precise set of filter controls to relocate is **unknown** — see Open Questions.

---

## 2. Right-click context menu + new node types

### 2a. Add an `oncontextmenu` add-node menu to the desk

Lift the trigger + the menu component as a unit:

- **`oncontextmenu` handler** — `+page.svelte:3402-3413` on `.viewport`. Guards on `NEW_PALETTE` flag, ignores right-clicks landing on `.chat-node, .wf-node`, `preventDefault`, converts cursor via `screenToWorld(e.clientX, e.clientY)`, then `openPalette({ anchor:{x,y}, mode:{kind:'workflow-ranked'}, worldPosition })`.
- **`NEW_PALETTE` flag** — `+page.svelte:139` (`PUBLIC_CANVAS_NEW_PALETTE !== 'false'`). Ensure it is not `'false'` on the desk route.
- **The menu component** — `src/lib/canvas/NodePalette.svelte` (452 lines), drop in wholesale; it is self-contained and SR-styled (`.palette` `background: var(--surface-elevated)`, `border: 1px solid var(--text-primary)`, hard-shadow `box-shadow: 6px 6px 0`). Positioning derived at `NodePalette.svelte:168-178` (clamps anchor into viewport, `PALETTE_WIDTH=420`). Mount once at the bottom like `+page.svelte:5610-5617`.
- **Palette state + handlers** — copy `paletteOpen/paletteAnchor/paletteMode/paletteFromNodeId/palettePositionOverride` (`2203-2207`), `openPalette()/closePalette()` (`2209-2225`), `onPalettePick(type)` (`2227-2268`), plus helpers `viewportCenterInWorld` (`2156-2165`), `resolveOverlap` (`2176-2188`).
- **Scoping the desk's node set:** the palette pulls from `$lib/canvas/adapter` `allTypes()/byType()` and filters out `group === 'Annotations'` (`NodePalette.svelte:32-39`). To show only research-relevant types on the desk, either feed a filtered list or use a dedicated `group` to scope.

**Persistence caveat (important for the desk):** in the workflow canvas, `onPalettePick` → `addNode()` `+page.svelte:2417-2454` does `POST /api/workflows/<workflowId>/nodes` then `invalidateAll()`. The Research Desk is NOT workflow-id-backed. Two options: (a) keep client-only node state (the rendering/menu/drag code all works without the API; only `addNode`/edge-POST/PATCH hit the server) — recommended for v1; or (b) introduce a session-scoped node store. The desk already maintains client card state + positions (`positionById` `:485`), so client-only placement is the lower-risk path.

### 2b. Register/render two NEW node types (research-chat, report/export)

The canvas registry requires touching **multiple lists** for a fully-configurable node. Per the workflow-canvas reading, for each new type do ALL of:

1. **Palette entry** — add a `NodeTypeOption` to `CANVAS_NODE_TYPES` in `src/lib/canvas/adapter.ts:91-897` (`type`, `label`, `kind`, `group`, `description`, `defaultConfig`, `handles`). Choose a `kind` so `mapTypeToKind` (`adapter.ts:978-1005`) and `KIND_COLOR` (`+page.svelte:1055-1068`) give it a color, or add a new `NodeKind` (`adapter.ts:5-20`) + both maps.
2. **Config panel** — clone the minimal `src/lib/canvas/nodes/panels/DelayPanel.svelte`, register it in the `specialized` map in `src/lib/canvas/nodes/panels/registry.ts:89-150` **AND** add the type string to `SPECIALISED_PANEL_TYPES` at `+page.svelte:38-89`. Missing either list means the panel won't mount. (Alternatively give the node `basicConfig` on its server def so `BasicConfigForm` auto-renders.)
3. **Server-side node def + executor** (only if the node should run inside a workflow) — `xxx.def.ts` under `src/lib/workflows/nodes/` wired into `src/lib/workflows/registry-client.ts` (`nodeDefinitions` ~`:908`). Auto-derives a palette entry via `defToOption()` (`adapter.ts:944-954`) if not curated. For desk-only nodes (chat/report) that never execute in the workflow engine, this step is optional.
4. **Custom in-graph renderer** — add a `{:else if n.kind === '<kind>'}` branch in the node `{#each}` loop (`+page.svelte:3522+`) and a component under `$lib/canvas/intelligence/`. Otherwise the node renders as a default `.wf-node` card for free.

**Closest existing templates to clone:**
- **Research chat node** → the `chat` type (`adapter.ts:106-116`) + its rich in-graph renderer (`+page.svelte:3523-4066`) + `JkaiPanel`. Renderer body is the chat-thread UI (§3).
- **Report/export node** → clone `file-store`/`file-write`/`blog-create` (`adapter.ts:707-718`, panels `FileStorePanel`/`FileWritePanel`/`BlogCreatePanel`).
- A research node family already exists to mirror: `intelligence`, `research-result`, `quick-answer`, `deep-research` (`adapter.ts:345-397`) with renderers `$lib/canvas/intelligence/IntelligenceNode.svelte` and `ResearchResultNode.svelte` (imported `+page.svelte:21-22`).

---

## 3. Research chat node — `POST /api/deepdive/[id]/chat` (streamed)

There is an exact template in-repo: `src/routes/projects/policy-engine/chat/+server.ts` (server) + `src/routes/projects/policy-engine/components/AskModel.svelte` (client SSE-over-POST reader). Replicate that against the deepdive session's facts/entities/sources.

### 3a. Transport (reuse, don't invent)

- **`streamCompletion(systemPrompt, userPrompt, opts)`** — `src/lib/deepdive/ai.ts:247`. Returns `{ text, tokensUsed }`, calls `opts.onToken(token)` per delta (`ai.ts:233-235`). Already has z.ai→OpenRouter rate-limit fallback (pre-first-token, `ai.ts:285`), 30s idle watchdog (`ai.ts:204-219`), and external `AbortSignal` (`ai.ts:253`). Pipe `onToken` into the HTTP `ReadableStream`.
- **GLM reasoning-token caveat:** GLM-5.1 burns `max_tokens` on reasoning and can return empty content. `streamCompletion` does NOT currently set `thinking.disabled` (`ai.ts:222-224`). Per `feedback_glm_reasoning_tokens.md`, the proven path (option b) is to mirror the policy endpoint and call `getOpenAIClient().chat.completions.create({ ..., stream: true, thinking: { type: 'disabled' } })` directly (`policy-engine/chat/+server.ts:91`); the cleaner long-term path (option a) is to extend `streamCompletion` with a `disableThinking` option. **Recommend (b) for v1**, file (a) as follow-up.
- **Streaming style:** SSE-over-POST via `fetch` + `ReadableStream` reader (chat turn needs a request body, so EventSource/GET is unusable here). Server `policy-engine/chat/+server.ts:71-118`; client `AskModel.svelte:84-117`.

### 3b. Context assembly (retrieval/ranking for token budget)

Mirror policy-engine's `retrieve(question, k)` + `buildContext` (`chat/+server.ts:37-41,58`) but over the session:

1. **Always include the compact, pre-ranked overview from `researchSessions.report`** (`schema.ts:377`, shape `types.ts:86-103`): `executive_summary` + top-N `ranked_facts` + cluster titles/summaries + top entities by `entity_centrality`. Cheap, already ranked, no embedding. Fallback if `report` is null: top-confidence facts.
2. **Embed the question** via `generateEmbedding(question)` (`ai.ts:304`) → `toVectorLiteral` (`vector.ts:8`), then run the `similar-facts` pgvector query (`src/routes/api/deepdive/[id]/similar-facts/+server.ts:24-34`: `1 - (embedding <=> ${vec}::vector)`, ordered by `embedding <=> vec`, filtered `session_id`, non-counterfactual, threshold 0.5) to pull the top ~10-15 on-topic facts. This is the retrieval/ranking the prompt asked for.
3. **Resolve `sourceId`→`{title,domain,url}`** for retrieved facts so the model can cite `[n]`, like policy-engine emits a `sources` frame (`chat/+server.ts:59,76`).
4. **Cap** each passage (`.slice(0, 1400)`, `chat/+server.ts:39`) and history to ~6 turns (`chat/+server.ts:55`). Token budget guidance: `maxTokens: 3072` (`source-summary/+server.ts:134-137`).

### 3c. Endpoint design — `POST /api/deepdive/[id]/chat`

Request body: `{ question: string, history?: {role,content}[] }`.
1. Load session, 404 if missing — mirror `synthesize/+server.ts:10-17`.
2. Build context (3b).
3. Build SYSTEM prompt policy-engine-style (`chat/+server.ts:25-35`): answer only from supplied context, cite `[n]`, say so if not covered, name session/topic.
4. Build `userPrompt` = context passages + overview + recent history + question (`chat/+server.ts:61-68`).
5. Return a `ReadableStream` emitting `data: {type:'sources'}`, then `data:{type:'token'}` per delta, then `data:{type:'done'}` — either pipe `streamCompletion.onToken` into `controller.enqueue`, or call the client directly with `thinking:{type:'disabled'}` (`chat/+server.ts:80-101`). Headers: `text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no` (`chat/+server.ts:110-117`).
6. Wire `request.signal` → `streamCompletion`'s `signal` for cancel-on-disconnect (`ai.ts:253`).
- **Persistence:** optional `research_chat_messages` table keyed on `sessionId` if threads should survive reload (mirror `narrative/+server.ts:8` for a `/chat/history` GET). Policy-engine keeps chat ephemeral in localStorage (`AskModel.svelte:37`) — fine for v1.
- **Note (hooks bypass):** other deepdive API paths needed a `hooks.server.ts` bypass; the new `/api/deepdive/[id]/chat` route must be reachable by the auth/hook layer (verify — see Open Questions).

### 3d. Node chat-thread UI

In-graph renderer holds `messages: {role,content,sources}[]` `$state` + the fetch+reader loop (near-copy of `AskModel.svelte:84-117`): `res.body.getReader()` + `TextDecoder`, split on `\n\n`, parse `data:` lines, append `evt.token` to the streaming assistant message, stash `evt.sources` for citation chips (`AskModel.svelte:111-113`). Render via `src/lib/canvas/ChatMarkdown.svelte` + sanitize with `src/lib/security/sanitize-chat.ts`. Style with `--surface-elevated`/`--card-border`/`--accent`. Mount either as the `{:else if n.kind === 'research-chat'}` branch in the node `{#each}` (§2b·4), or as a desk panel/mode alongside `gather`/`synthesize` (`desk/CommandBar.svelte:67`) — the desk already knows `sessionId`.

---

## 4. Report/export node

### 4a. Existing export endpoints (reuse the download plumbing — do not invent)

All under `src/routes/api/deepdive/[id]/export/`, thin `GET`s delegating to `$lib/deepdive/docx-export.ts` (docx built with `docx` npm `^9.6.1`, programmatic; `html-to-docx` NOT installed; `marked` `^17.0.6` present):
- **`export/docx/+server.ts:4-13`** → `generateReport(sessionId)` (`docx-export.ts:31`): cover, Executive Summary, per-cluster Heading-1 sections with footnoted source citations (`docx-export.ts:159-160`), Appendix A Key Entities table (top-50 by centrality), Appendix B Contested Claims (`docx-export.ts:243-244`), Appendix C Sources. Throws `'Report not yet generated'` if `session.report` null (`docx-export.ts:40`). Filename `deepdive-${slug}-${date}.docx`.
- **`export/narrative-docx/+server.ts:5-16`** → `generateNarrativeReport` (`docx-export.ts:343`): curated `narrativeItems`; 404 if none.
- **`export/narrative-md/+server.ts:6-66`** → markdown string inline; 404 if none.
- **Two distinct outputs:** auto **report** (docx only) from `session.report`; curated **narrative** (docx+md) from `narrativeItems`. There is **no markdown export of the auto report** today.

### 4b. Generate-report design (generate → preview → download)

1. **Generate (server):** add a JSON read endpoint **`GET /api/deepdive/[id]/report`** (does NOT exist) returning `session.report` directly so the node previews without re-running the LLM. Reads the same jsonb the docx reads. If null, node shows "Report not generated — run analysis" (mirrors `docx-export.ts:40`). No streaming needed for preview (already persisted).
2. **Report data shape** — `ResearchReport` `src/lib/deepdive/types.ts:86-103`: always-set `ranked_facts`, `timeline`, `clusters{title,summary,fact_ids}`, `executive_summary`, `entity_centrality`; optional `knowledge_gaps` (`types.ts:53-58`), `hypotheses` (`types.ts:60-66`), `suggested_followups`, `source_diversity`, `contradictions_map`. Filled by `runPostProcessing(sessionId, session)` `src/lib/deepdive/postprocess.ts:18` (12 steps, persisted `:425-428`) — runs ONLY as the worker's final stage; there is no standalone `/report` regenerate endpoint.
3. **Reuse postprocess/narrative + display canon** — colors/labels from `src/lib/deepdive/display.ts`: `confidenceColor`/`confidenceLabel` (`:7-17`), `credibilityBadge` (`:19-40`), `severityColor` (`:42-46`), `ENTITY_TYPE_COLORS` (`:48-56`), `SENTIMENT_COLORS` (`:58-63`).

### 4c. Expandable preview (in node)

Render from the `report` JSON: exec summary, collapsible cluster sections (title/summary + facts joined from `/data`), chips for `knowledge_gaps` (color via `severityColor`), `hypotheses`, `suggested_followups`, `source_diversity`. Join `fact_ids`/`entity_centrality` against the `/data` payload the desk already fetches. Expand/collapse fits the `CommandBar`-headed node body pattern in `ResearchResultNode.svelte`.

### 4d. Download (docx/md)

Wire buttons straight to the existing `handleExport(kind)` (`ResearchDesk.svelte:214-227`) which maps kind→export path and triggers a transient `<a download>`. The "⤴ Share / export" menu (`CommandBar.svelte:107-125`) already has the three items, gated on `ctl.canShare`. The docx pipeline is already rich — no new builder for `.docx`.
- **Gap — report-as-markdown:** only narrative has `.md`. To offer report `.md`, add `generateReportMarkdown` sibling to `generateReport` in `docx-export.ts` + an `export/md` route (`marked` is available).
- **Gap — staleness:** `runSynthesis` writes to the separate `synthesisRuns` table (`schema.ts:1176`, `synthesis.ts:36,144-155`), NOT `session.report`. On-demand synthesis after load does NOT update the report, so docx/preview can be stale. Either (a) add a "Regenerate report" action calling `runPostProcessing` fire-and-forget (gate behind the `!readonly && deskMode !== 'quick'` guard used by `handleShare`/`handleExport`) with an SSE progress channel, or (b) document that the report reflects the pipeline run. Recommend (a).
- **Gap — `/data` doesn't expose narrative report fields** (`data/+server.ts:75-89` returns facts/entities/sources/relationships only; reads `report` solely for `entity_centrality`, `:30-31`). The preview needs the new `/report` endpoint (or add the fields to `/data`).

---

## 5. Synthesize grouping overhaul

### 5a. Current model (single dimension)

Grouping is single-axis: synthesis topic clusters only. `runSynthesis` asks the LLM for 4-8 clusters `{title,summary,fact_ids}` (`synthesis.ts:97-127`); `synthesis-reducer.ts:93-119` patches each fact `deskCategory:cid, deskState:'synthesized'` + a `cat:<cid>→factId` edge; `ResearchDesk.svelte:285-297` merges into `LayoutCategory[]`; the packer `organisedLayout` (`layout.ts:194-257`) lays named category columns (`colStride 320`, `rowStride 180`), uncategorised in a trailing column (`:240-246`), entities always in a wrapping bottom rail ignoring category (`:224-237`). The one existing alternate axis is "Arrange by theme" = group by KIND/type: `themeOf` (`themes.ts:109-121`), `themeLayout` (`themes.ts:180-216`), toggle `arrange:'off'|'once'|'live'` (`ResearchDesk.svelte:136`) overlaid in `posOf` (`:443-479`). **All layouts are neat grids — no overlapping-pile rendering exists today.**

### 5b. Feasible group-by dimensions + where computed

| Dimension | Computable | Where / data source |
|---|---|---|
| **category** (topic clusters) | Yes, existing | `deskCategory`/`clusters` (current synthesis output) |
| **theme** (kind/type) | Yes, existing | `themeOf` `themes.ts:109` |
| **entity-by-type** | Yes, client now | `entities.type` already in `/data` (`:82`); `themes.ts:85-98` already buckets |
| **sentiment** | Partly — plumbing | `relationships.sentiment` `schema.ts:471` (per entity-pair, NOT per-fact); already in `/data` `:69`. Grouping *relationships/entity-pairs* by sentiment is client-side now. Grouping *facts* by sentiment needs NEW per-fact extraction (LLM/heuristic) — not available |
| **entity-co-occurrence** | New payload field | needs `entityMentions` `{entityId,factId}` (`schema.ts:454-459`, populated `phase2.ts:306`) which is **never sent to the client**. Add to `/data`, then co-occurrence = entities sharing ≥1 factId; pure client graph build |
| **similarity-cluster** | New server endpoint | `facts.embedding` (1536-dim, `schema.ts:422`, populated `phase2.ts:233`) is too heavy to ship. Cluster server-side with pgvector cosine (reuse the `1 - (e <=> e) > 0.85` idiom from `credibility.ts:142`) and return `factId→clusterId` |

### 5c. "Group by" selector model

Generalise the existing `arrange` mechanism (it already does kind-grouping with `once`/`live` and overlays positions in `posOf`). Replace the boolean theme toggle with a `groupBy` enum:

```
type GroupDim = 'cluster' | 'theme' | 'entityType' | 'sentiment' | 'cooccurrence' | 'similarity';
```

Each dimension produces `Map<cardId, groupKey>` + ordered `groups[]` (key, label, count). A single pile-packer replaces both `organisedLayout` and `themeLayout`. New pure module `src/lib/canvas/intelligence/desk/grouping.ts`: `groupBy(dim, cards, edges, mentions, similarityMap) → {memberOf: Map, groups: []}` (generalises `themeOf`/`factCat`). Compute location:
- **Client, already-loaded data:** `cluster`, `theme`, `entityType`, `sentiment` (bucket `store.edges`).
- **Client, +1 payload field:** `cooccurrence` (add `entityMentions` to `/data`).
- **Server endpoint (required):** `similarity` — new `GET/POST /api/deepdive/[id]/clusters?by=similarity`, pgvector cosine clustering over `facts.embedding`, returns `{factId, clusterId, clusterLabel}[]`. Never ship raw vectors. Cache (deterministic per fact-set; recompute only on fact-count change). Called on dimension-switch, NOT per flush.

### 5d. Overlapping-PILE rendering

The desk absolutely-positions every card via one `positionById` memo (`ResearchDesk.svelte:485`) inside `.desk-world` (`:891`).
- **Pile anchor per group** (grid slot, same left→right packing as `themeLayout`). Stack member cards at `anchor + i*offset` (small fixed offset `{dx:6, dy:8}`, cap ~5 visible) with descending z-index — fanned stack. Reuse `CategoryHeader`/`ThemeHeader` host pattern (`ResearchDesk.svelte:945-970`) for the pile label + count badge.
- **Collapsed by default, expand-on-click.** Keep `Set<groupKey>` of expanded piles in `$state`. Collapsed → render only top ~3-5 cards + "+N" count chip. Expanded → spread members into the existing column/grid layout, animated via the existing `.morphing` 520ms transform transition (`ResearchDesk.svelte:1123`, wired through `morphIds`).
- Manual/pinned overrides still win (`posOf` step 1, `:443-451`); reuse `effectivePosition` sticky behaviour (`positioning.ts:41-69`).

### 5e. Performance notes (hundreds of cards)

- Current desk renders every visible card as a host div (`ResearchDesk.svelte:974-1000`). Piles are the main perf win: collapsed pile renders only its top few cards + a count → N cards across G groups ≈ `G*(3..5)` DOM nodes instead of N. This is the reason piles (not grids) suit hundreds of cards.
- Keep grouping pure and funnelled through the single `positionById`/`groupBy` derived (no per-card derived work) to preserve the O(N)-per-flush guarantee (`:481-487`).
- `morphIds` already gates the expensive transform transition to only moved cards (`:822-844`) — expand/collapse animates only the affected pile.
- Similarity must be server-side + cached (one call per dimension-switch); embeddings stay server-only.

### 5f. Required changes summary (synthesize)

1. `/api/deepdive/[id]/data` (`+server.ts:34`): add `entityMentions` (and optionally `noveltyScore`/`sourceAgreement`/`deskCategory` for richer pile sorting).
2. New `src/lib/canvas/intelligence/desk/grouping.ts`: pure `groupBy(...)`.
3. New `pileLayout()` in `layout.ts` (replaces `organisedLayout`/`themeLayout` callsites).
4. New server endpoint `/api/deepdive/[id]/clusters?by=similarity` (pgvector cosine, cached).
5. `ResearchDesk.svelte`: swap `arrange` boolean for a `groupBy` selector in the toolbar (`:1004-1025`), render piles + count/expand reusing `CategoryHeader`/`ThemeHeader`.

---

## 6. Reuse / Build / Retire inventory

### Reuse (lift as-is or near-as-is)
- **Canvas shell & chrome** — `+page.svelte` `.viewport`/grid (`5945-5964`, vars `3394-3396`), `.graph` transform (`3446-3450`/`6416-6419`), pan handlers (`1932-1962`), `screenToWorld`/`viewportCenterInWorld` (`2156-2174`), `.wf-node`/handles/edges CSS (`6420-6620`), `orthPath()` (`1016-1053`), `KIND_COLOR` (`1055-1068`), toolbar/zoom chrome (`5798-5942`), minimap/legend.
- **Add-node menu** — `src/lib/canvas/NodePalette.svelte` (whole), palette state + `openPalette/closePalette/onPalettePick` (`2203-2268`), `oncontextmenu` (`3402-3413`), `resolveOverlap` (`2176-2188`).
- **Node registry plumbing** — `src/lib/canvas/adapter.ts` (`CANVAS_NODE_TYPES`, `allTypes/byType`, `mapTypeToKind`), `panels/registry.ts` (`getPanel`, `specialized`), `handles.ts` (`compatibility`, `rankForWorkflow`), `recents.ts`, `DelayPanel.svelte` (template), `IntelligenceNode`/`ResearchResultNode` + `DeepResearch/QuickAnswer/ResearchResult` panels.
- **Chat transport/retrieval** — `streamCompletion` (`ai.ts:247`), `generateEmbedding` (`ai.ts:304`), `toVectorLiteral` (`vector.ts:8`), `similar-facts` SQL (`similar-facts/+server.ts:24-34`), policy-engine chat skeleton (`chat/+server.ts:43-118`) + `AskModel.svelte:84-117` reader, `ChatMarkdown.svelte`, `sanitize-chat.ts`, session guard (`synthesize/+server.ts:10-17`).
- **Report/export** — all three export endpoints + `docx-export.ts` (`generateReport:31`, `generateNarrativeReport:343`), `display.ts` color canon, `handleExport` (`ResearchDesk.svelte:214`) + export menu (`CommandBar.svelte:107-125`).
- **Synthesize** — `themeOf` (`themes.ts:109`), `posOf` overlay (`ResearchDesk.svelte:443-479`), `positionById`/`effectivePosition` (`:485`, `positioning.ts:41-69`), `CategoryHeader`/`ThemeHeader` hosts, `morphIds` transition (`:822-844`, `:1123`), `credibility.ts:142` cosine idiom.

### Build (new)
- Canvas-route restyle of `/jkai/research` (grid shell over the launch surface) OR grid CSS onto the embedded desk world.
- View-locked floating filter box (sibling of `.graph`, `position:absolute` top-left).
- Two new node types: **research-chat** + **report/export** — palette entry + panel (×2 lists) + in-graph renderer each.
- `POST /api/deepdive/[id]/chat` (streamed SSE-over-POST, retrieval-grounded, citation frames).
- `GET /api/deepdive/[id]/report` (JSON read of `session.report` for preview).
- `GET/POST /api/deepdive/[id]/clusters?by=similarity` (pgvector cosine, cached).
- `generateReportMarkdown` + `export/md` route (report-as-md gap).
- "Regenerate report" action calling `runPostProcessing` (fire-and-forget + SSE) — recommended to fix staleness.
- `grouping.ts` (`groupBy`) + `pileLayout()` + `groupBy` selector + pile/expand UI.
- Add `entityMentions` (and optional fact fields) to `/api/deepdive/[id]/data`.
- Optional `research_chat_messages` table + `/chat/history` GET (if threads persist).

### Retire
- The static `/jkai/research` launch surface (`.prompt-input`, `.seg` Quick/Deep toggle, `.run-grid`) as the route's primary UI — superseded by the canvas (keep launch affordance somewhere, e.g. a node or toolbar).
- The left **sidebar** on the desk (filters relocate to the floating box; rest removed).
- The boolean `arrange` toggle (`ResearchDesk.svelte:136`) — replaced by `groupBy` enum.
- Callsites of `organisedLayout`/`themeLayout` — folded into the single `pileLayout()`.

---

## 7. Risks / Open questions

1. **Desk node persistence.** The workflow canvas persists via `/api/workflows/<workflowId>/{nodes,edges}` and `invalidateAll()`. The Research Desk is session-scoped, not workflow-id-backed. **Decision needed:** client-only node state (recommended v1, all render/menu/drag works without the API) vs. a new session-scoped node store. If client-only, `addNode`/edge-POST/PATCH calls in the lifted code must be stripped.
2. **Which filters relocate.** The exact set of filter controls in the desk toolbar (`ResearchDesk.svelte:1004-1025`) is not enumerated in the readings. The floating-box contents are **unknown** — needs the actual filter model before building.
3. **`streamCompletion` + thinking-disabled.** Confirm whether to extend `streamCompletion` with `disableThinking` (clean) or call the client directly with `thinking:{type:'disabled'}` (proven, recommended). The direct-call path bypasses `streamCompletion`'s built-in z.ai→OpenRouter fallback + idle watchdog — **trade-off to confirm** (the policy endpoint accepted losing the fallback).
4. **Hooks/auth for new routes.** Other deepdive/policy-engine API paths needed a `hooks.server.ts` bypass. Confirm `/api/deepdive/[id]/{chat,report,clusters}` are reachable through the auth layer (and whether deepdive sessions are auth-gated at all).
5. **Sentiment on facts is not available.** `relationships.sentiment` is per entity-pair only. "Group facts by sentiment" requires new per-fact extraction; v1 should reframe it as "group entity-relationships by sentiment" (free from loaded edges) — confirm product intent.
6. **Report staleness vs. on-demand synthesis.** `synthesisRuns` (separate table) do not update `session.report`; docx/preview reflect the worker pipeline run, not later synthesis. Confirm whether to ship the "Regenerate report" (`runPostProcessing`) action or just document the limitation.
7. **Similarity-cluster algorithm + cache invalidation.** pgvector clustering approach (greedy cosine-threshold like `credibility.ts:142` vs k-means), the `clusterLabel` source (LLM vs derived), threshold value, and cache key (fact-set hash / fact count) are unspecified — needs a decision.
8. **New `NodeKind` colors.** If research-chat/report get dedicated kinds, `NodeKind` (`adapter.ts:5-20`), `mapTypeToKind` (`978-1005`), and `KIND_COLOR` (`+page.svelte:1055-1068`) must all be updated, or they reuse an existing kind's color.
9. **`PUBLIC_CANVAS_NEW_PALETTE`.** The context menu is gated by this flag (`+page.svelte:139`); confirm it is not `'false'` in the desk's deploy environment.
10. **`/report` vs `/data` for preview.** Decide whether to add a dedicated `/report` endpoint (cleaner) or extend `/data` to return the narrative report fields (`executive_summary`/`clusters`/`hypotheses`/`knowledge_gaps`/`suggested_followups`/`source_diversity`) — the latter touches a shared payload.
11. **docx serialization.** Export returns `new Uint8Array(buffer)` — confirm the report node's download path reuses the existing `<a download>` mechanism (`ResearchDesk.svelte:214-227`) verbatim rather than re-implementing blob handling.