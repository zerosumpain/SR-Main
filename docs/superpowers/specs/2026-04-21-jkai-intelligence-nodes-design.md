# JKAI Intelligence Nodes — Design Spec

## Overview

Add a new family of canvas nodes that let the user explore, synthesise, and branch from live intelligence directly on the jkai canvas. The canvas stops being only a workflow builder and becomes a working environment where knowledge-graph context, chat, deep research, and quick research flow through the same graph.

Three new node types are introduced:

- **`intelligence`** — a large, queryable window onto the knowledge graph. Filtered by a query plus optional facets (time range, tags, entity types). Renders a live preview of the matching items. Outputs both a summary `intelContext` string and a structured `intelItems` array so downstream nodes can consume either the prose or the collection.
- **`research-result`** — a result node spawned by the Intelligence node's "Explore further" action. Wraps an async `deep-dive` or `quick-answer` session, pulses while pending, and populates with the report when done. The user can keep exploring the canvas while it runs.
- **(extended)** **`chat`** — gains awareness of upstream Intelligence nodes. When a chat node has any `intelligence` upstream, the chat uses that filtered context as its intel source (overriding the global knowledge-graph call that `generalChat` normally makes).

The design reuses existing infrastructure (`buildKnowledgeContext`, `deep-dive` site tools, the `quickAnswers` worker, the chat SSE stream) rather than inventing parallel systems.

## Scope

**In:**

- Three node registrations in `src/lib/canvas/adapter.ts` (`intelligence`, `research-result`; `chat` updated).
- New visual `NodeKind` `'intelligence'` plus colour + kind mapping.
- Two new workflow executors: `intelligence.ts`, `research-result.ts` (each with a `.def.ts`).
- Extend `ChatOptions` in `$lib/workflows/chat/general-chat` with `intelContextOverride?: string | null` so chat can swap in a pre-filtered context.
- Chat-node executor detects upstream intelligence (via merged `input.intelContext` / `input.intelFocus`) and passes it as the override.
- New Svelte components:
  - `IntelligenceNode.svelte` (large node body: query box, facet chips, live preview, "Explore further" button).
  - `ResearchResultNode.svelte` (loading pulse + completed report view; delegated per engine).
  - `ExploreFurtherMenu.svelte` (popover with deep/quick actions, extensible).
- Spawn logic in the canvas page that creates the child node + edge, starts the session, and returns the new node id.
- Server endpoints to create + stream research sessions from a node (`POST /api/canvas/[slug]/nodes/[id]/explore`).
- Persistence: a thin `intel_explorations` reference row (`nodeId → sessionId + engine + status`) so reloading the canvas shows pending state correctly.
- Drizzle schema change + `drizzle-kit push` via deploy script.
- Integration tests for the intelligence executor, the chat override path, and the explore-spawn flow.

**Out (explicitly deferred):**

- Editing an Intelligence node after spawning research from it does not retroactively change child research-result nodes. The child is frozen at the moment the user clicked "Explore further". (Re-running the child can be a Phase 2 feature.)
- No multi-user concerns — single-user system.
- No semantic diff / clustering over intelligence items. The preview is a scrollable list.
- No "Save this filter as a new intelligence source" feature. User re-creates nodes when the filter changes.
- No export of research results to files (they live on the canvas; the existing report view at `/deepdive/[id]` remains the canonical deep-link).
- No cross-canvas Intelligence sharing. An intelligence node is bound to its canvas.

## Architecture

### Node registration (`src/lib/canvas/adapter.ts`)

Add a new `NodeKind` `'intelligence'`:

```ts
export type NodeKind =
  | 'input' | 'llm' | 'parse' | 'output' | 'intel' | 'agent'
  | 'chat' | 'trigger' | 'inspector' | 'stats'
  | 'intelligence';
```

Register two entries — a new group `Intelligence` sits alongside `Intel & Web`:

```ts
{ type: 'intelligence', label: 'Intelligence', kind: 'intelligence',
  group: 'Intelligence',
  description: 'Filtered view onto the knowledge graph. Queryable. Spawns deep/quick research.',
  defaultConfig: {
    size: { w: 360, h: 440 },
    query: '',
    facets: { entityTypes: [], tags: [], timeRange: null, limit: 20, ordering: 'relevant' }
  } },

{ type: 'research-result', label: 'Research Result', kind: 'intelligence',
  group: 'Intelligence',
  description: 'Deep or quick research output. Slowly pulses while running; populates when complete.',
  defaultConfig: { size: { w: 340, h: 360 }, engine: 'deep', sessionId: '' } },
```

Extend `mapTypeToKind()` to return `'intelligence'` for `intelligence` and `research-result`. Add a muted-teal accent in `KIND_COLOR` (e.g. `#5dbea3`) so intelligence nodes read distinctly from `intel` (which uses `--accent` orange for query-the-graph nodes).

Sizes persist via the existing `node.config.size` pattern used by Chat, Inspector, and Stats. The resize handler covers `kind === 'intelligence'`.

### Data model: `IntelItem`

The intelligence node produces a structured, shallow-serialisable array. This is the shape downstream consumers (Loop, LLM-call, Quick Research) will see on `input.intelItems`:

```ts
type IntelItem = {
  id: string;              // note id | entity id
  kind: 'note' | 'entity';
  title: string;
  snippet: string;         // ≤ 300 char summary
  url?: string;            // sourceUrl if present
  createdAt: string;       // ISO
  score: number;           // 0..1 relevance
  metadata?: {
    entityType?: string;
    tags?: string[];
    sourceTag?: string;
  };
};
```

The matching prose context (already used by `intel-query`) is emitted alongside:

```ts
type IntelligenceOutput = {
  intelQuery: string;        // resolved after template interpolation
  intelFocus: {              // the filters that produced this slice
    query: string;
    entityTypes: string[];
    tags: string[];
    timeRange: { from: string; to: string } | null;
    ordering: 'recent' | 'relevant';
  };
  intelContext: string;      // from buildKnowledgeContext — legacy path still works
  intelItems: IntelItem[];   // new structured list
  intelCount: number;        // total matches (before limit)
};
```

`intelContext` is shallow-merged with the rest of input, which preserves the existing `intel-query` downstream contract. `intelItems` is the new hook that makes looping + per-item fan-out ergonomic.

### Intelligence node executor (`src/lib/workflows/nodes/intelligence.ts`)

Steps:

1. Resolve `query` via `interpolateTemplate(config.query, input)`. If empty and `facets.timeRange` is non-null, run a facet-only query; otherwise return `{ intelItems: [], intelCount: 0, intelContext: '' }`.
2. Call a new helper `searchIntel(query, facets)` in `$lib/jkai/intel/search.ts` that unifies the existing vector + keyword search already used by the intel route's `/intel/search`. It returns `IntelItem[]` and a total count.
3. Call `buildKnowledgeContext(query)` for the prose summary (unchanged — this is the path the chat node + LLM nodes expect).
4. Return the shape above.

The executor is synchronous (no emitted progress). The preview on the node uses the same API via the canvas page, so there's no double-round-trip.

### Research-result node executor (`src/lib/workflows/nodes/research-result.ts`)

This node's `execute()` is defensive: in normal flow (triggered by "Explore further"), the child node already has a `sessionId` set in its config and its status is tracked server-side. When the workflow DAG runs this node directly, it:

- If `config.sessionId` is set, fetches the latest report from the authoritative source (`executeSiteTool('research_report', { sessionId })` for deep; the `quick_answers` row for quick) and emits it as output. Always re-reads; does not short-circuit on prior `outputData`, so re-runs pick up newly completed reports.
- If no `sessionId`, returns `{ success: false, error: 'Not commissioned' }` (the node is a result view, not a commissioner — the canvas UI handles commission).

The node is a DAG participant (not display-only): its `researchReport` is allowed to flow downstream to, e.g., an LLM node that summarises or merges reports.

Output shape:

```ts
type ResearchResultOutput = {
  researchEngine: 'deep' | 'quick';
  researchStatus: 'pending' | 'running' | 'complete' | 'failed';
  researchTopic: string;
  researchReport: string;         // markdown
  researchSources: Array<{ url: string; title: string; domain: string }>;
  researchSessionId: string;
  researchDurationMs?: number;
};
```

### Chat context override

Extend `ChatOptions` in `src/lib/workflows/chat/general-chat.ts`:

```ts
interface ChatOptions {
  // ...existing
  /**
   * Pre-built intel context to inject verbatim into the system prompt,
   * overriding the global buildKnowledgeContext() call. When set to a
   * non-empty string, the caller's context is used. Empty string = no
   * intel section. `null`/undefined = fall back to useIntelContext logic.
   */
  intelContextOverride?: string | null;
}
```

In the system-prompt assembly at line 380–385, replace the current conditional with:

```ts
const graphSectionPromise =
  options.intelContextOverride != null
    ? Promise.resolve(options.intelContextOverride)
    : options.useIntelContext === false
      ? Promise.resolve('')
      : buildKnowledgeContext(userMessage);
```

The chat executor (`src/lib/workflows/nodes/chat.ts`) then inspects its merged `input` and forwards an override when an upstream intelligence node is present:

```ts
const intelOverride =
  typeof input.intelContext === 'string' && input.intelContext.length > 0
    ? input.intelContext
    : null;

// ... pass `intelContextOverride: intelOverride` to generalChat
```

This gives us the behaviour the spec asks for — connecting chat to an intelligence node focuses the chat to that filtered context — without a second code path.

### Explore-further flow

When the user clicks **Deep research from here** or **Quick research** on an intelligence node:

1. Canvas UI calls `POST /api/canvas/[slug]/nodes/[id]/explore` with `{ engine: 'deep' | 'quick' }`.
2. Server handler:
   - Loads the intelligence node, resolves its current `query` + `facets` (from `config`, no need to rerun).
   - For **deep**: calls `executeSiteTool('research_start', { topic, goals })` where `topic = query` and `goals` include facet hints. Gets a `sessionId`.
   - For **quick**: inserts a `quickAnswers` row with the topic, calls `startQuickAnswer(id)`. Gets the row id.
   - Creates a new `research-result` workflow node (positioned below-and-right of the parent, offset `(140, 120)`) with `config = { engine, sessionId, topic, parentNodeId }`.
   - Creates a `workflowEdge` from the intelligence node → new node.
   - Inserts an `intel_explorations` row: `{ nodeId, engine, sessionId, status: 'running', startedAt }`.
   - Returns `{ node, edge, streamUrl }` where `streamUrl` is the existing SSE endpoint for that engine (`/api/deepdive/[id]/stream` or `/api/quickanswer/[id]/stream`).
3. Canvas UI adds the node + edge locally (no reload), opens an SSE connection to `streamUrl`, and the `ResearchResultNode` renders live. Keyboard/mouse remain free for other canvas work while it runs.
4. On `status: 'complete'` from the stream, the UI marks the node done and writes the report into the node's `outputData` (via `PATCH .../nodes/[id]`). The `intel_explorations` row is updated.

#### Persistence table

```ts
export const intelExplorations = pgTable('intel_explorations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  parentNodeId: text('parent_node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  engine: text('engine').notNull(), // 'deep' | 'quick'
  sessionId: text('session_id').notNull(),
  status: text('status').notNull(), // 'running' | 'complete' | 'failed' | 'cancelled'
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
});
```

This is an index-row, not a truth-row — the authoritative data lives in `research_sessions` (deep) or `quick_answers` (quick). The `intel_explorations` row lets the canvas load page hydrate pending children on reload without needing to reverse-engineer the node's config.

### Canvas load: rehydrating pending state

In `src/routes/jkai/canvas/[slug]/+page.server.ts`, when loading a canvas, join `intel_explorations` by `workflowId`. For each row still `running`, set the corresponding node's UI status to `pending` and include the `streamUrl` so the page can reconnect. Rows `complete` rely on the existing node's `outputData` persisted at completion time.

### Delete / cascade

- Deleting an intelligence node cascades to its `intel_explorations` rows (via `onDelete: 'cascade'`). The attached `research-result` nodes themselves are _not_ auto-deleted — they stand as orphans until the user deletes them explicitly. This matches the feel of existing canvas edits and keeps research output preserved if the user was pruning noise.
- Deleting a `research-result` node cancels the session if still running (POST `research_control { action: 'stop' }` / `requestStop(quickAnswerId)`).

## UI

### Intelligence node layout (360 × 440)

```
┌──────────────────────────────────────────┐
│  Intelligence                        ⋯ ✕ │  ← header: name, menu, delete
├──────────────────────────────────────────┤
│ [ query: "new projects detected…"     ⟳ ] │  ← query textarea (mono, 2 lines)
│                                          │
│ Facets:  [type▾ 2]  [tags▾ 0]  [time▾ Y] │  ← facet pills → popover on click
│          [ordering: relevant]            │
├──────────────────────────────────────────┤
│ 12 matches                               │  ← live count
│ ─ project · Claude plugin foo · 2h ago   │
│ ─ note    · Intel on Amazon gap · 1d     │  ← scrollable list of IntelItems
│ ─ entity  · "Anthropic DevEx"   · 3d     │
│ …                                        │
├──────────────────────────────────────────┤
│ [ Explore further ▾ ]                    │  ← primary action, opens menu
└──────────────────────────────────────────┘
```

- Query textarea debounced (300 ms) → refetch.
- Facet popovers are tiny floating panels with checkboxes / a time-range picker (presets: _all_, _today_, _yesterday_, _last 7 days_, _last 30 days_, custom).
- Results list lazy-renders (virtual scroll not needed at ≤50 items; limit caps at 50).
- List row click → opens the underlying note/entity in a side panel (reuse `/intel` drawers).
- Connection handles: one input (left), one output (right). Output carries the `IntelligenceOutput` shape.

### Explore-further menu

Opened as a popover below the button. Two items for now:

1. **Deep research from here** — commissions a `deep-dive` session. Goals derived from facets (e.g. "Focus on projects from the last 7 days"); topic is the node's current query.
2. **Quick research** — commissions a `quickAnswers` session. Topic = query. Goals derived from facets.

Menu is extensible: the component reads options from a single `INTELLIGENCE_EXPLORE_ACTIONS` array. Future additions (e.g. "Summarise", "Compare two items") plug in here.

### Research-result node (340 × 360)

Three states:

| state | visual |
|---|---|
| `pending` | Slow pulse (accent teal → muted, 2 s cycle). Header shows engine + topic. Body shows spinner + the most recent log line from the SSE stream. |
| `complete` | Header shows engine + topic + duration. Body shows report (markdown-rendered). Footer shows source count with tooltip listing domains. |
| `failed` | Muted red border. Body shows error + retry button (re-runs by POSTing `/explore` with the same engine/topic). |

Pulse animation (CSS):

```css
@keyframes intel-pulse {
  0%,100% { box-shadow: 0 0 0 0 color-mix(in oklab, #5dbea3 30%, transparent); border-color: #5dbea3; }
  50%     { box-shadow: 0 0 0 8px color-mix(in oklab, #5dbea3 0%, transparent);  border-color: color-mix(in oklab, #5dbea3 40%, var(--card-border)); }
}
.research-result[data-status='pending'] { animation: intel-pulse 2s ease-in-out infinite; }
```

Completed research is click-through to the full `/deepdive/[id]` or `/quickanswer/[id]` route via a small "open full report" link in the footer.

### Chat node behaviour hint

When a chat node's upstream has an intelligence node, show a small pill under the chat header: `focus: <query>` (clickable to reveal the full filter). This is pure UI — the context wiring happens automatically via input merge. Also render a muted connector line style between intelligence → chat (reusing the edge colour for `intelligence`).

## Data flow examples

### 1. Chat focused to intelligence

```
[ Intelligence query="claude plugins" ] ──▶ [ Chat ]
```

Intelligence emits `intelContext` + `intelItems` into chat's merged input. Chat passes `intelContextOverride` to `generalChat`. The user asks "what's the biggest gap?" and generalChat answers _only_ from the 12 plugin items, not the whole graph.

### 2. Per-item fan-out via loop

```
[ Intelligence                  ]
  query="new projects yesterday" ──▶ [ Loop over intelItems ] ──▶ [ Research Result (quick) per item ]
```

Loop iterates `input.intelItems`. Per iteration, a `research-result` node templates `topic = {{item.title}}` and runs a quick answer. Outputs accumulate via the loop's existing `results` array.

(In practice this second case uses a **quick-research** node rather than a `research-result` with a pre-set sessionId — see "Variant: commissioning from inside a workflow" below.)

### 3. Standalone (no chat, no loop)

User drags an intelligence node, types a query, browses the preview, clicks "Deep research from here", and the child node appears and populates while they work elsewhere on the canvas.

### Variant: commissioning from inside a workflow

The `research-result` node only renders an existing session. To commission research from _inside_ a running workflow (case 2 above), we need a commissioning companion. Two options:

- **A.** Extend the existing `deep-dive` node (operation `start`) — already works — and add a parallel `quick-answer` node (new, thin wrapper that creates a row and awaits `complete` via a short polling loop). Wire their output through a display-only `research-result` downstream if the user wants the pretty UI; or consume `researchReport` directly.
- **B.** Have `research-result` take a `commission: boolean` flag — when true and `sessionId` is empty, it kicks off a session, awaits it, and returns. Bigger change, more convenient.

**Decision: A.** Adding a small `quick-answer` executor sibling to `deep-dive` is a minimal, symmetric change that keeps the display node ("here is a result") separate from the action node ("do research"). The loop example in §2 becomes:

```
Intelligence ──▶ Loop ──▶ [ Quick Answer node ] ──▶ (optional) Research Result display
```

The "Explore further" UI action is still a single atomic operation server-side (commission + create display node + wire edge) because it's an interactive user gesture, not a DAG step — the display-node-only path keeps the DAG clean.

## API endpoints

### New

- `POST /api/canvas/[slug]/nodes/[id]/explore` — body `{ engine: 'deep' | 'quick' }`. Returns `{ node, edge, streamUrl }`. Commissions the session, creates child node + edge + `intel_explorations` row.
- `POST /api/canvas/[slug]/nodes/[id]/cancel-exploration` — cancels a pending `research-result` node's session.
- `GET /api/canvas/[slug]/intel/preview` — query params `query`, `limit`, `entityTypes[]`, `tags[]`, `from`, `to`. Returns `{ items: IntelItem[], total: number }`. Used by the node's live preview.

### Extended

- Existing `GET /api/canvas/[slug]` (or the `+page.server.ts` loader) joins `intel_explorations` so pending children rehydrate on reload.
- Existing `/api/deepdive/[id]/stream` and `/api/quickanswer/[id]/stream` SSE endpoints are reused verbatim.

## Testing

### Unit

- `searchIntel()` — facets translate correctly; time-range resolves presets; ordering flips result order.
- `intelligence` executor — empty query + no facets returns empty shape; template interpolation works; facets pass through to `intelFocus`.
- `research-result` executor — with session id: pulls latest report. Without: returns error.
- `chat` executor — when input has `intelContext`, forwards `intelContextOverride` to `generalChat`; when not, forwards `null` and normal flow is unchanged.

### Integration

- Vitest spec that wires `intelligence → chat` with a stubbed `generalChat`: assert that the chat sees the stubbed override, not a real `buildKnowledgeContext` call.
- Vitest spec that POSTs `/api/canvas/[slug]/nodes/[id]/explore` with `engine: 'quick'`, stubs `startQuickAnswer`, and asserts (a) new node + edge created, (b) `intel_explorations` row inserted, (c) response includes the expected `streamUrl`.

### Manual (post-deploy checklist)

- Drag intelligence node onto canvas → type query → preview updates.
- Connect to chat → ask a question → answer is focused to filter (spot-check with a query that would otherwise pull from the whole graph).
- "Explore further → deep research" spawns a pulsing child → navigates away → comes back → child still pulsing or completed.
- Reload canvas mid-research → pending state rehydrates.
- Intelligence → Loop → Quick Answer node runs over each item (build a tiny example canvas).

## Migrations / deploy

- New Drizzle table `intel_explorations` (schema above). Deploy script already runs `drizzle-kit push` on every deploy, so no manual migration needed.
- `NodeKind` expansion is additive; no runtime migration.
- Deploy via `scripts/deploy.sh` after the plan is implemented, reviewed, and the user has given the push-to-live go-ahead (per project feedback: _always deploy after pushing_ — but only after user confirms).

## Open decisions (resolved autonomously)

| question | decision |
|---|---|
| Large node vs. resizable | Large fixed default (360×440), resizable via the existing handle pattern, persisted in `config.size`. |
| Should intelligence cache its preview? | No — it's cheap (≤50 items), and freshness matters more than latency. Refetch on every config change or canvas re-open. |
| Do we need a new visual kind? | Yes, `'intelligence'`. Re-using `'intel'` would conflate "query the graph" (orange pipeline node) with "browse the graph" (teal large node). The distinct colour pays off in readability. |
| Delete-cascade behaviour | Cascade `intel_explorations` on parent delete; leave result nodes standing. Preserves user's exploration history across filter tweaks. |
| Explore-further as node vs. gesture | Gesture. A menu option on the intelligence node, not a separate palette entry. Symmetry with deep-dive node is intentional: deep-dive for DAG-driven research, explore-further for user-driven exploration. |
| `quickAnswers` integration in DAG | Add a thin `quick-answer` executor (like `deep-dive`). Needed for per-item fan-out (loop → quick answer per topic). |
| Cancel pulsating node | Delete-node gesture cancels the underlying session (POST `/cancel-exploration`). No "stop but keep node" state in phase 1. |

## Summary of files touched

**New:**

- `src/lib/workflows/nodes/intelligence.ts` + `.def.ts`
- `src/lib/workflows/nodes/research-result.ts` + `.def.ts`
- `src/lib/workflows/nodes/quick-answer.ts` + `.def.ts`
- `src/lib/jkai/intel/search.ts` (factored out of `/intel/search` route)
- `src/lib/canvas/intelligence/IntelligenceNode.svelte`
- `src/lib/canvas/intelligence/ResearchResultNode.svelte`
- `src/lib/canvas/intelligence/ExploreFurtherMenu.svelte`
- `src/lib/canvas/intelligence/FacetPopover.svelte`
- `src/routes/api/canvas/[slug]/nodes/[id]/explore/+server.ts`
- `src/routes/api/canvas/[slug]/nodes/[id]/cancel-exploration/+server.ts`
- `src/routes/api/canvas/[slug]/intel/preview/+server.ts`

**Modified:**

- `src/lib/canvas/adapter.ts` — new `NodeKind`, group, entries, kind map, colour.
- `src/lib/db/schema.ts` — `intel_explorations` table.
- `src/lib/workflows/chat/general-chat.ts` — `intelContextOverride` option.
- `src/lib/workflows/nodes/chat.ts` — forwards `intelContextOverride` when upstream has intelContext.
- `src/lib/workflows/index.ts` — register three new executors.
- `src/routes/jkai/canvas/[slug]/+page.svelte` — render new node kinds; wire explore-further click to the API; manage SSE streams for pending children.
- `src/routes/jkai/canvas/[slug]/+page.server.ts` — join `intel_explorations` for pending rehydrate.
- `scripts/deploy.sh` — unchanged (drizzle-kit push already runs).

No existing file grows above the project's soft ceiling for comfort; the canvas `+page.svelte` is the only one at risk (2600+ lines already), so intelligence-node rendering is kept in external components that it only instantiates.
