# jkai Canvas: Node Palette + Webpage Node — Design

**Date**: 2026-04-21
**Status**: Approved, pending implementation plan
**Area**: `~/strange_rambling_svelte/` — `/jkai/canvas/[slug]`

## 1. Goals & shape of the change

Replace the hierarchical `+ node` dropdown on the jkai canvas with a single unified **Node Palette** component, invoked via four triggers (keyboard, right-click, long-press, drag-from-handle-into-empty-space). Add a new **Webpage** node type that renders live pages with a transparent headless-browser fallback for sites that block iframes. No floating UI on the canvas in its idle state; the existing `+ node` pill is removed.

Touched areas:

- `src/routes/jkai/canvas/[slug]/+page.svelte` — remove old dropdown, wire palette triggers
- `src/lib/canvas/NodePalette.svelte` *(new)* — the unified picker
- `src/lib/canvas/nodes/WebpageNode.svelte` *(new)* — webpage node renderer
- `src/lib/canvas/OpenAsWebpageButton.svelte` *(new)* — reusable affordance
- `src/lib/canvas/adapter.ts` — handle type metadata for all node types
- `src/lib/canvas/ResearchResultNode.svelte` — wire `<OpenAsWebpageButton>` onto citations
- `src/lib/db/schema.ts` — no schema change, but `type = "webpage"` becomes a valid value
- `src/routes/api/workflows/[id]/nodes/+server.ts` — accept `"webpage"` type
- `src/routes/api/webframe/*` *(new)* — probe, render, event-forwarding, extract endpoints
- `docker-compose.webframe.yml` *(new)* — Playwright container for proxied rendering

**Non-goals for v1**:

- Natural-language "describe the workflow" entry (parked)
- Generalized URL detector that wraps `<OpenAsWebpageButton>` around every URL anywhere (only research-result citations get the affordance in v1)
- Per-site authenticated proxied sessions (cookies-free sandbox only)
- Persisting iframe scroll state across reloads

## 2. Interaction model — the Node Palette

One component, one mental model, four triggers:

| Trigger | Open position | Pre-filter mode | Auto-wires edge? |
|---|---|---|---|
| ⌘K or `/` anywhere on canvas | Screen-centred modal | workflow-ranked | no |
| Right-click on empty canvas | Anchored at cursor | workflow-ranked | no |
| Long-press on empty canvas (touch, 450ms, cancels if finger moves >10px) | Anchored at touch point | workflow-ranked | no |
| Drag edge from node handle → release on empty canvas | Anchored at release point | strict-downstream of source | yes |

### 2.1 Modes

**Workflow-ranked mode** shows all node types, in two sections:

1. **Suggested** — top 6 candidates, ranked by `(compatibility score with nodes on canvas × 2) + recent-usage-boost + default-weight`.
2. **All nodes** — existing category groups (Trigger & Flow, LLM & AI, Parse & Transform, Intelligence, Intel & Web, Integrations, Observability) with name + description + tag search.

**Strict-downstream mode** shows only node types whose declared input types intersect the source node's declared output types (see §3). If zero matches, degrade to workflow-ranked with a small "no strict matches — showing all" banner. Creating a node in this mode also creates the typed edge `source → new node` automatically.

### 2.2 Palette component

- Fixed width ~420px, floating card, search input at top with autofocus
- Arrow-key navigation, `Enter` to create, `Esc` to dismiss
- Each row: icon + name + one-line description + category label
- Recent picks marked with a faint `↺ recent`
- Touch: larger hit area, no hover states

### 2.3 Node placement

- Cursor / release point / touch point → that exact position
- ⌘K / `/` → viewport centre
- If another node overlaps within 40px radius, offset down-right by 24px until clear

### 2.4 Removed

- `+ node` composer pill at `+page.svelte:1456`
- Two-level category/search dropdown at `+page.svelte:1494–1565`

The composer bar keeps its other controls (model picker, send, etc.).

## 3. Handle type system

Every node type gets declared input/output handle metadata to power the strict-downstream filter and the workflow-ranked scoring.

### 3.1 Metadata shape (in `adapter.ts`)

```ts
type HandleKind =
  | 'text' | 'url' | 'image' | 'json' | 'dataset'
  | 'research-result' | 'intel-session' | 'trigger-signal'
  | 'any'; // escape hatch: matches everything on either side

type HandleSpec = {
  id: string;           // e.g. "text", "url", "result"
  kinds: HandleKind[];  // what data flows through
  label?: string;       // shown in tooltip
  required?: boolean;
};

type NodeTypeMeta = {
  // ...existing fields
  handles: {
    inputs: HandleSpec[];   // [] for trigger nodes
    outputs: HandleSpec[];  // [] for terminal nodes (stats-summary, inspector, viewer)
  };
};
```

### 3.2 Compatibility rule

For strict-downstream filter: candidate `C` is valid downstream of source `S` iff any `S.output.kinds` intersects any `C.input.kinds`. `'any'` matches on either side.

### 3.3 Workflow-ranked score

For each candidate `C`: `score = Σ over nodes N on canvas of compatibility(N.outputs, C.inputs) + recent-usage-boost + default-weight`.

- `compatibility(A, B)` = 1 if any kind in A outputs intersects any kind in B inputs, else 0
- `recent-usage-boost` = count of times this type was picked from the palette in the last 20 picks (stored in `localStorage.canvasPaletteRecents`), capped at +3
- `default-weight` = per-type small float in `adapter.ts` (e.g. `llm-call = 0.5`, rare types = 0) so ties break sensibly on an empty canvas

Top 6 become the "Suggested" section. When a workflow has >50 nodes, sample the 50 most recently added for the scoring pass; the rest of the palette stays fully interactive.

### 3.4 Handle rendering on the canvas

- Left-edge input dot(s) (one per input spec, spaced vertically)
- Right-edge output dot(s) (one per output spec)
- Hover → tooltip shows the handle's `label` and `kinds`
- Drag starts on a source output handle; release on a compatible input handle creates a typed edge, populating `workflow_edges.sourceHandle` and `workflow_edges.targetHandle` (columns already exist and are nullable)

### 3.5 Edge creation — strictness & escape hatch

Dropping a dragged edge onto an incompatible input handle flashes the target red and shows a tooltip: `"text output → dataset input: not compatible"`. A right-click context menu on the attempted edge includes `Connect anyway` as an escape hatch (writes a `NULL` sourceHandle/targetHandle edge).

Existing edges in DB with NULL handles continue to render — the filter only applies to new connections.

### 3.6 Migration

Initial pass fills `handles` for all ~50 existing types with sensible defaults, e.g.:

| Type | inputs | outputs |
|---|---|---|
| `trigger` | [] | `trigger-signal` |
| `chat` | `trigger-signal, text` | `text` |
| `llm-call` | `text` | `text` |
| `research-result` | `text` | `research-result, text` |
| `stats-summary` | `dataset` | [] |
| `inspector` | `any` | [] |
| `webpage` *(new)* | `url, research-result, text` | `url, text, text` (currentUrl, selectedText, extractedText) |

No DB migration. `schema.ts` untouched other than a comment noting new valid `type` values.

## 4. Webpage node — rendering & UI

### 4.1 Component

New `src/lib/canvas/nodes/WebpageNode.svelte`. Registered in `adapter.ts` under the "Intel & Web" group with `type = 'webpage'`.

### 4.2 Node body layout

- **Header strip** (24px): favicon · editable URL input · reload · open-in-new-tab · fullscreen toggle · "proxied" badge (only when fallback is active)
- **Viewport**: `<iframe>` filling the rest of the node body. Default 720×480. Resizable via corner handle, reusing the pattern from `IntelligenceNode.svelte`.
- **Fullscreen toggle** overlays the entire canvas (like the existing intel fullscreen pattern).
- **Status footer** (16px, auto-hides after 2s): `Loaded · direct` / `Loaded · proxied via homeserv` / `Failed: X-Frame-Options blocked`

### 4.3 Rendering pipeline

1. User enters URL (or one arrives from upstream)
2. Client calls `GET /api/webframe/probe?url=…` — server reads `X-Frame-Options` and `CSP frame-ancestors`
3. **Permissive** → iframe `src` = real URL. On `load`, client sends a `postMessage({ type: 'webframe-ping' })` to the iframe; if no pong within 1s, or `load` never fires within 6s, escalate to proxy
4. **Blocked** (or escalated) → iframe `src` = `/api/webframe/render?url=…&session=<nodeId>`, which streams a Playwright-rendered page from the Chromium container. Same-origin so postMessage & DOM access work.
5. Proxied pages are interactive: clicks/scroll/form input forwarded as Playwright `page.evaluate` calls over an SSE channel keyed on `session`. Sessions idle-timeout at 5 min.

### 4.4 Extraction & outputs (unified regardless of pipeline)

- `currentUrl`: updated on navigation (postMessage for direct, Playwright event for proxied)
- `selectedText`: emitted on selectionchange (debounced 400ms)
- `extractedText`: computed once per URL via `@mozilla/readability` — client-side on direct, server-side on proxied

### 4.5 Upstream URL wiring

- Connected via `url` or `research-result` output → webpage node auto-loads that URL on create and when the upstream value changes. If multiple upstream nodes feed URLs, the most recent change wins. User can override via URL bar (override persists until a new upstream change arrives).
- Connected via `text` output → do not auto-navigate. URL bar pre-populates with the first URL-looking substring (via `/\bhttps?:\/\/\S+/i`) and waits for user to press Go.

### 4.6 Persistence

`workflow_nodes.config` JSONB stores `{ url, lastLoadedAt, mode: 'direct'|'proxied'|null, size: {w,h} }`. No HTML persisted. On reopen, the node re-loads from `config.url`.

## 5. Deep-research integration

`ResearchResultNode.svelte` gains a per-citation "Open as webpage node" button via a new reusable component:

```svelte
<OpenAsWebpageButton url={citation.url} sourceNodeId={node.id} />
```

On click:

1. Calls `addNode('webpage', …, { url })` positioned 40px to the right of the research-result node (offset down-right by 24px increments until non-overlapping)
2. Calls `addEdge(sourceNodeId, newNodeId, { sourceHandle: <research-result node's primary output handle id>, targetHandle: <webpage node's primary input handle id> })` — handle IDs (not kinds) are written to `workflow_edges.sourceHandle` / `targetHandle`; the compatibility check in §3.2 resolves kinds via the `HandleSpec` lookup
3. Webpage node renders immediately via the §4 pipeline

No new server endpoint — uses existing `addNode()` / `addEdge()` primitives.

`<OpenAsWebpageButton>` validates `URL.canParse(url)` before rendering.

**v2 (out of scope)**: a general URL-detection pass over chat / llm-call / intelligence node rendered text that wraps URLs in `<OpenAsWebpageButton>` automatically. Structure `<OpenAsWebpageButton>` so it's drop-in for that future work.

## 6. Data model & server changes

### 6.1 DB schema (`schema.ts`)

- `workflow_nodes.type` gains valid value `"webpage"` (freeform TEXT; no enum)
- No new columns — webpage config fits existing JSONB
- `workflow_edges.sourceHandle` / `targetHandle` start being populated (columns already nullable TEXT)

### 6.2 New server endpoints — `src/routes/api/webframe/`

| Route | Method | Purpose |
|---|---|---|
| `/api/webframe/probe` | GET `?url=` | Cheap HEAD/GET; reads `X-Frame-Options` & `CSP frame-ancestors`; returns `{ canFrame, reason? }`; cached 10 min per URL |
| `/api/webframe/render` | GET `?url=&session=` | Streams Playwright-rendered HTML; establishes SSE channel for forwarded events |
| `/api/webframe/event` | POST | Client → server input forwarding (click, scroll, form input) keyed by `session` |
| `/api/webframe/extract` | POST `{url, html?}` | Runs Readability on supplied HTML (direct) or Playwright-captured HTML (proxied); returns `{ text, title, byline }` |

All routes sit behind the existing Cloudflare Access auth on `jkai.strangeramblings.com`.

### 6.3 Playwright service

`docker-compose.webframe.yml` (new), runs as its own container on homeserv:

- Image: `mcr.microsoft.com/playwright:v1.47.0-jammy`
- Thin Node server exposing one Chromium per active session
- Internal-only port (no Tailscale exposure); SvelteKit calls over the docker network
- Idle timeout 5 min per session; hard cap 6 concurrent sessions; FIFO queue beyond that with 30s per-slot timeout
- Every session starts with a clean profile — **no shared cookies**, no carry-over auth

### 6.4 No new tables

Existing `workflow_nodes` / `workflow_edges` sufficient. All Playwright session state is ephemeral server memory.

## 7. Error handling & edge cases

- **Probe fails / times out (>3s)**: fall through to direct iframe; escalate to proxy if iframe `load` never fires
- **Proxy render fails** (Chromium crash, SSL error, 404): inline error card with original URL, `[Retry] [Open in tab] [Change URL]`
- **Playwright queue full**: "Queued — X ahead of you" message; drains FIFO
- **Compatibility filter returns zero candidates**: degrade to workflow-ranked with `no strict matches — showing all` banner
- **Palette opened with empty canvas**: hide "Suggested" section; show "All nodes" directly
- **Incompatible drag drop**: target handle flashes red + tooltip; `Connect anyway` right-click escape hatch writes NULL-handle edge
- **User edits URL in a proxied node**: tear down Playwright session, re-probe from scratch
- **Malformed / relative citation URL**: `<OpenAsWebpageButton>` hides itself via `URL.canParse` check
- **Workflow >50 nodes**: workflow-ranked scoring samples the 50 most recently added
- **Touch long-press inside a node**: doesn't fire (would conflict with node drag)

## 8. Testing

### 8.1 Unit (Vitest)

- Handle compatibility matrix (intersection, `'any'` wildcard, empty-output terminal nodes)
- Workflow-ranked scoring (weights, sampling at >50 nodes, usage-boost)
- URL validator / citation URL canonicalization
- `X-Frame-Options` / `CSP frame-ancestors` parser

### 8.2 Component (Vitest + `@testing-library/svelte`)

- `NodePalette` renders both modes, keyboard nav, search filter, strict-downstream filter
- `WebpageNode` renders header, iframe, resize, fullscreen toggle
- `OpenAsWebpageButton` validates URL, fires addNode + addEdge

### 8.3 Integration

- Each of the four palette triggers creates a node at the expected position
- Drag-from-handle → release on empty canvas creates a node AND a typed edge
- Webpage node loads a permissive URL directly; escalates to proxy on a stubbed blocked URL
- Playwright container mocked with a deterministic stub in tests

### 8.4 E2e (Playwright against a dev instance)

- One happy-path test per trigger on a seeded workflow
- Webpage-node test against a permissive URL (e.g. example.com)
- Research → "Open as webpage node" → connected webpage node renders

### 8.5 Rollout

- Feature flag `canvas.newPalette` (env-driven) wraps both pieces for first sessions
- Old dropdown stays available behind the flag-off path for rollback
- Default-on once e2e passes locally

## 9. Open questions / explicitly deferred

- Natural-language workflow creation (Q1 option C) — deferred
- Generalized URL-detection affordance outside research citations — deferred to v2
- Authenticated proxied sessions (shared cookies) — deferred; security review needed
- Multi-region Playwright (VPS vs homeserv) — deferred; homeserv-local is fine for v1
