# JKAI Multimedia Tools — Design

**Date:** 2026-04-16
**Status:** Design approved, pending implementation plan
**Scope:** Give JKAI the ability to respond to chat messages with inline multimedia (charts, maps, tables) via a lightweight tool path, without routing through the autonomous build system.

## Problem

Today when a user asks JKAI "visualise my sleep last week" or "show my recent runs on a map," the only authoring path is the autonomous builder (`/jkai/builds`) — a Docker-sandboxed, iterative loop designed for medium-sized Vite web apps. That's vastly overpowered for a single chart or map response, costs many iterations of LLM output, and produces a standalone web app rather than an inline chat reply.

JKAI needs a lighter path: tool calls that return multimedia artifacts rendered inline in the conversation, ideally reusable across sessions.

## Goals

- Inline chart / map / table responses in the `/jkai` chat hub, scoped to a single LLM turn
- Three primitive render tools callable directly by the LLM
- The ability for the LLM to author one-off ("ephemeral") custom tools that produce artifacts
- A promotion path from ephemeral to persisted reusable tools, keeping the human in the loop
- Reuse of the existing `customTools` + `custom-tool-loader.ts` plumbing — no parallel registry

## Non-goals (v1)

- Image artifacts (generated or fetched)
- Arbitrary HTML / iframe artifact type
- Interactive widgets (sliders, pickers, re-query UI)
- A persisted-custom-tool management page (list/edit/delete via UI)
- Artifact export (PNG / GPX / CSV download)
- Artifact editing after render
- Any change to the autonomous builder itself — it only gets demoted in system prompt guidance

## Architecture

Three layers, cheapest first. The LLM picks the lowest layer it can.

```
Layer 1: Primitive renderers (built-in, fixed)
         render_chart, render_map, render_table
         → LLM calls with inline spec + data → artifact straight into chat

Layer 2: Ephemeral custom tools (per-call, not persisted to registry)
         LLM authors handler code → runs once in the existing AsyncFunction sandbox
         → returns an artifact → chat renders it
         → handler + schema retained on the chat message row for possible promotion

Layer 3: Promoted custom tools (persisted in `customTools`, reusable)
         Promotion is an explicit action: user says "save that" OR LLM offers
         and user confirms. Uses existing custom-tool-loader path.
```

### Routing

No router code. Routing is purely tool-selection:

- Register the three primitives and an `author_ephemeral_tool` meta-tool into the orchestrator toolset
- Add a section to `data/prompts/03-tools.md` describing the layer ladder: prefer primitives → ephemeral tool → builder (only for multi-file web apps)
- Existing LLM tool-selection picks by description semantics, exactly as it does today

## Artifact data model

Single normalised shape, discriminated by `type`:

```ts
type Artifact =
  | { type: 'chart';
      spec: VegaLiteSpec;
      data: unknown[];
      caption?: string }
  | { type: 'map';
      center?: [number, number];
      zoom?: number;
      layers: Array<
        | { kind: 'points';  points: Array<{ lat: number; lng: number; label?: string }> }
        | { kind: 'track';   points: Array<{ lat: number; lng: number }> }
        | { kind: 'heatmap'; points: Array<{ lat: number; lng: number; weight?: number }> }
      >;
      caption?: string }
  | { type: 'table';
      columns: Array<{ key: string; label: string; align?: 'left' | 'right' | 'center' }>;
      rows: Array<Record<string, unknown>>;
      caption?: string };
```

Every tool that produces a visualisation (primitive or custom) returns:

```ts
{ success: true, data: { artifact: Artifact, summary: string } }
```

`summary` is a short human-readable description the LLM sees in history (e.g. `"Line chart: sleep duration over 7 days, 6.2–8.1h"`), keeping the token cost of history small.

### Persistence

Artifacts live on `orchestratorChats.metadata` (already `jsonb`). Shape:

```ts
metadata: {
  toolCalls?: Array<{
    id: string;
    name: string;            // tool name, or '__ephemeral__' for Layer 2
    args: Record<string, unknown>;
    result: ToolResult;      // includes data.artifact when present
    ephemeral?: {            // set only for Layer 2
      handlerCode: string;
      parameters: JSONSchema;
      proposedName?: string;
      proposedDescription?: string;
    };
  }>;
}
```

This mirrors the `ToolStep[]` structure `ChatArea.svelte` already aggregates around line 50; only the `result` shape is enriched and the optional `ephemeral` sidecar added.

### LLM context economy

When injecting a tool result back into LLM context (fresh or from history), the payload is trimmed:

```
{ success: true, summary: "<short text>", artifactType: "chart", artifactId: "<id>" }
```

Not the full `spec` + `data`. Full payload is only sent to the client for rendering. If the LLM needs the underlying data, it re-calls the upstream data tool (e.g. `health_sleep_stats`). Artifacts are *presentations*, not canonical sources.

## Layer 1 — Primitive renderers

Single file: `src/lib/workflows/site-tools/tools/visualise.ts`. Three tools registered via `register()`:

### `render_chart`

- Parameters: `{ spec: object, data: array, caption?: string }`
- `spec` is a Vega-Lite spec. If `data` is passed alongside, the handler merges it into `spec.data.values`.
- Handler returns `{ artifact: { type: 'chart', spec, data, caption }, summary }`
- Auto-generated summary: axis labels, data point count, min/max of the y-field

### `render_map`

- Parameters: `{ layers: array, center?: [lat, lng], zoom?: number, caption?: string }`
- Each layer: `{ kind: 'points' | 'track' | 'heatmap', points: [...] }`
- If `center`/`zoom` omitted, the client auto-fits bounds from all points
- Summary: layer count and a short description (e.g. `"Map: 1 track, 42 points"`)

### `render_table`

- Parameters: `{ columns: array, rows: array, caption?: string }`
- Columns: `{ key, label, align? }`. Rows: plain objects keyed by column keys.
- Summary: row count and column names

All three are in a new `visualise` toolset. `03-tools.md` gets a new section with example flows.

### Example end-to-end flow

```
User: "Show my sleep for the last week as a chart"

LLM → health_sleep_stats({ days: 7 })
   ← { data: [ { date: "2026-04-09", duration_hrs: 7.2 }, ... ] }

LLM → render_chart({
        spec: { mark: "line",
                encoding: {
                  x: { field: "date", type: "temporal" },
                  y: { field: "duration_hrs", type: "quantitative", title: "Sleep (hrs)" }
                } },
        data: [ ...7 rows... ],
        caption: "Sleep duration — last 7 days"
      })
   ← { success: true, data: { artifact: {...}, summary: "Line chart: sleep duration over 7 days, 6.2–8.1h" } }

LLM replies: "Here's your sleep for the last week — you averaged 7.1 hours, with a dip on Thursday."
```

The chart renders inline above the assistant's text bubble.

## Layer 2 — Ephemeral custom tools

### `author_ephemeral_tool` meta-tool

Parameters: `{ name, description, parameters, handlerCode, callArgs }`.

Handler steps:
1. Validate `handlerCode` compiles — wrap in `new AsyncFunction`, catch syntax errors, return typed failure if it fails.
2. Build the handler using the existing `buildHandler` from `custom-tool-loader.ts` (reuses `platform.call`, global `fetch`). Run-count / error-count DB updates are skipped for ephemeral runs.
3. Execute the handler with `callArgs`.
4. Write `{ handlerCode, parameters, proposedName, proposedDescription }` into the current chat message's `metadata.toolCalls[].ephemeral` sidecar.
5. Return the handler's result (expected to include `{ artifact, summary }`).

Does NOT register into the main registry. Does NOT write to `customTools`. Survival of the code past this turn happens only via the message's sidecar.

### Sandbox

Same `new AsyncFunction` execution used by persisted custom tools. Same `platform.call` depth limit (5). Same risk profile — no new attack surface.

### Promotion mechanism

Two paths, both terminating in the same DB insert.

**`promote_ephemeral_tool` meta-tool**

Parameters: `{ messageId, toolCallId, name?, description? }` — overrides optional.

Handler:
1. Load the referenced message, locate the matching `toolCalls[]` entry, read its `ephemeral` sidecar.
2. Validate `name` uniqueness in `customTools`; on collision, suggest a suffix and return an error.
3. Insert into `customTools` with `enabled: true`.
4. Call `register()` so the tool becomes live in this process without a restart.
5. Return the final registered name.

**User-initiated path**: user says "save that" → LLM calls `promote_ephemeral_tool` directly.

**LLM-proposed path**: when the LLM judges the ephemeral tool reusable, it appends a structured marker to its reply:

```
[[suggest-promote: <toolCallId> as "render_training_load_chart"]]
```

ChatArea parses and strips this marker, rendering an inline "Save this as a reusable tool" button above the message. Clicking opens a small modal prefilled with the proposed name + description (editable), which POSTs to `/api/jkai/tools/promote` — which invokes `promote_ephemeral_tool` server-side.

The marker-in-reply approach keeps the LLM out of direct DB mutation unless the user confirms.

## Chat UI rendering

Changes localised to `src/lib/components/jkai/ChatArea.svelte` and a new `artifacts/` sub-directory.

### ChatArea modifications

- During the `toolCalls` aggregation loop (around line 50), for any step whose `result.data.artifact` is set, emit a render slot tied to the assistant message.
- Parse the assistant text for any `[[suggest-promote: ...]]` markers, strip them, and emit a "Save as tool" button above the message bubble.

### New components

- `src/lib/components/jkai/artifacts/Artifact.svelte` — dispatcher switching on `artifact.type`
- `src/lib/components/jkai/artifacts/ChartArtifact.svelte` — dynamic import of `vega-embed`, renders into a div with caption below
- `src/lib/components/jkai/artifacts/MapArtifact.svelte` — dynamic import of Leaflet, renders the three layer kinds, auto-fits bounds when `center`/`zoom` are absent
- `src/lib/components/jkai/artifacts/TableArtifact.svelte` — pure Svelte, sticky header, optional sort-by-column, caption above

All three capped at ~400px max height with scroll and (where applicable) zoom controls.

### Library choices

- Charts: **Vega-Lite** via `vega-embed` — ~90KB gzipped, declarative spec is LLM-friendly
- Maps: **Leaflet** — already a dependency for `/live`
- Tables: hand-rolled Svelte component — no library

## API surface

New routes:

- `POST /api/jkai/tools/promote` — body `{ messageId, toolCallId, name?, description? }`; auth as existing JKAI routes; wraps `promote_ephemeral_tool`
- `GET /api/jkai/tools` — list persisted custom tools; exists for future management UI but not consumed in v1

Unchanged:

- `/api/workflows/orchestrator/chat` — receives tool results including artifacts transparently via the existing `metadata` field
- `/api/jkai/conversations/[id]` — returns artifact payloads as part of message metadata on history load

## Prompt changes

`data/prompts/03-tools.md` gains a new section describing the visualisation tool ladder, with at least:

- When to prefer primitives (simple "show me X as a chart")
- When to author an ephemeral tool (data wrangling + rendering, or composition of multiple data sources)
- When to use the builder (multi-file web apps only — explicit demotion)
- Example LLM flows for each layer
- Guidance on when to emit the `[[suggest-promote: ...]]` marker (recurring task, parameterisable, not one-shot)

## Data model changes

- No schema changes needed for artifacts — `orchestratorChats.metadata` is already `jsonb`
- `customTools` unchanged — promoted ephemerals land in the existing table
- No new tables in v1

## Testing posture

- Unit tests for the three primitive handlers: valid args produce expected artifact shape, summaries are generated, invalid args produce typed errors
- Unit tests for `author_ephemeral_tool`: syntax errors caught, sidecar written to metadata, handler executes via `buildHandler`
- Unit tests for `promote_ephemeral_tool`: happy path, name collision, missing sidecar
- Component tests for each artifact component with representative fixtures
- E2E: chat → visualise primitive → artifact renders in conversation → reload conversation → artifact still renders

## Open questions / deferred

- None blocking v1. Listed non-goals above will be re-evaluated after v1 lands.

## Summary of files touched

New:
- `src/lib/workflows/site-tools/tools/visualise.ts` — the three primitive renderers
- `src/lib/workflows/site-tools/tools/ephemeral-tools.ts` — `author_ephemeral_tool` + `promote_ephemeral_tool`
- `src/lib/components/jkai/artifacts/Artifact.svelte`
- `src/lib/components/jkai/artifacts/ChartArtifact.svelte`
- `src/lib/components/jkai/artifacts/MapArtifact.svelte`
- `src/lib/components/jkai/artifacts/TableArtifact.svelte`
- `src/routes/api/jkai/tools/promote/+server.ts`
- `src/routes/api/jkai/tools/+server.ts`
- `data/prompts/visualise-tools.md` (or extension of `03-tools.md`)

Modified:
- `src/lib/workflows/site-tools/registry.ts` — import new tool modules
- `src/lib/components/jkai/ChatArea.svelte` — artifact rendering + promote marker parsing
- `data/prompts/03-tools.md` — layer ladder guidance

Unchanged but referenced:
- `src/lib/workflows/site-tools/custom-tool-loader.ts` (`buildHandler` reused)
- `src/lib/db/schema.ts` (`customTools` table already exists; `orchestratorChats.metadata` already jsonb)
