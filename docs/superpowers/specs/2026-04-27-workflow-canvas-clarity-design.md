# Workflow Canvas Clarity — Config UIs, Runtime Indicators, Debug Verification

**Date:** 2026-04-27
**Project:** strange_rambling_svelte / JKAI Builds canvas
**Scope:** Three independent improvements to the workflow builder, shipped sequentially.

## Problem

The JKAI workflow canvas works end-to-end but is opaque in three ways:

1. **Configuring a node means editing JSON.** The `NodeDefinition` type already declares a `basicConfig: BasicConfigField[]` schema (with field types `dropdown | toggle | slider | text | textarea | template-textarea | number | code`), but no renderer consumes it. 35 of 40 node types fall back to `GenericJsonPanel.svelte` — a raw JSON textarea. Only 5 nodes (`code-execute`, `stealth-scrape`, `stealth-scrape-llm`, `web-scrape`, `interactive-step`) have hand-written panels.

2. **The canvas is silent at runtime.** SSE events stream from `/api/workflows/[id]/runs/[runId]/stream` and the canvas tracks `liveStatus` per node, but the visual treatment is minimal. Edges show nothing during a run — there's no way to see how much data is moving between nodes.

3. **The orchestrator declares "complete" without testing.** The orchestrator loop calls `finalize_workflow` and returns. There's an advisory `verifyWorkflow` that checks for static issues (missing required fields, bad templates) but no behavioural verification — the LLM never sees what its workflow would actually send before declaring it done. This means bad WhatsApp messages, wrong recipients, malformed payloads only surface when the user runs the workflow and gets the wrong output.

## Goals

| # | Goal | Success criterion |
|---|------|-------------------|
| 1 | Every node has a structured config UI — no JSON for ordinary use | All 40 node types render a generic `BasicConfigForm` from `basicConfig`. JSON view remains as a "Show advanced" toggle for power users. |
| 2 | Runtime state is visible on the canvas | While a run is in progress, every node shows a coloured border + status pill ("Running 1.2s" / "Done 47 rows" / "Failed: timeout"). Every active edge shows the source node's `rowCount` in small text mid-edge. |
| 3 | Orchestrator self-verifies before finalising | The LLM has a `verify_workflow` tool that triggers a debug run (side-effecting nodes simulated, capture log returned), inspects the captured outputs against the user's original goal, and either loops back to fix issues or calls `finalize_workflow`. Hard cap of 3 verification rounds. |

## Non-goals

- No new node types, no executor logic changes beyond the additions called out below.
- No replacement of the existing canvas / Svelte 5 reactive store. We extend, not rewrite.
- No new auth, no new API surface beyond one debug endpoint and one orchestrator tool.
- No retroactive migration of saved workflows. Existing `config` jsonb stays valid.

## Build Order

1. **Outcome #2 (runtime indicators)** — smallest surface, makes #3 testable, ~1–2 days.
2. **Outcome #1 (config UIs)** — bounded mechanical work, one renderer + 35 schemas, ~3–5 days.
3. **Outcome #3 (debug verification)** — depends on #1 (orchestrator edits via `basicConfig`) and benefits from #2 (row counts in capture log), ~2–3 days.

---

## Outcome #2 — Runtime Indicators

### Data model

Extend `NodeResult` (`src/lib/workflows/types.ts`) with an explicit `rowCount: number`:

```ts
interface NodeResult {
  output: Record<string, unknown>;
  rowCount: number;          // NEW — set by every executor
  logs?: string[];
  metadata?: Record<string, unknown>;
  pause?: { reason: 'awaiting_human'; interactionId: string };
}
```

Every executor sets it deliberately:

- `whoop`: `output.workouts.length`
- `gmail-fetch`: `output.messages.length`
- `http-request`: `Array.isArray(output.body) ? output.body.length : 1`
- `whatsapp` / `email` / single-record nodes: `1`
- `loop`: total iterations executed
- `merge`: combined input row count

If an executor doesn't set it, default to `1`. We do **not** auto-detect from output shape — explicit beats clever, and `output.body` could be a 47-element array of metadata or a single response object.

### Event payload

Extend `WorkflowEvent` so `node_completed` carries `rowCount`:

```ts
{ type: 'node_completed', runId, nodeId, data: { rowCount, durationMs } }
```

The SSE endpoint already forwards events untouched — no engine change required beyond emitting the new field.

### Canvas rendering

In `src/routes/jkai/canvas/[slug]/+page.svelte`:

- Per-node visual: status determines border colour (`idle` = neutral, `running` = blue + subtle pulse, `completed` = green, `failed` = red, `awaiting_human` = amber). Status pill in the top-right corner with text:
  - `running`: `Running 1.2s` (live duration, updates every 250ms)
  - `completed`: `Done 47 rows`
  - `failed`: `Failed: <one-line error>` (truncated; full in tooltip)
- Per-edge visual: a small label rendered at the edge midpoint showing `47 rows` once the source node has completed. Hidden while idle. Inherits the source node's `rowCount` from `liveData`.
- Both updates flow through the existing `flushLive()` patch path — no new reactive plumbing.

### Files touched

- `src/lib/workflows/types.ts` — add `rowCount` to `NodeResult` and `node_completed` event data.
- `src/lib/workflows/engine.ts` — propagate `rowCount` from result to event, default to 1.
- `src/lib/workflows/nodes/*.ts` — set `rowCount` in every executor (40 files, mostly one-line).
- `src/routes/jkai/canvas/[slug]/+page.svelte` — node + edge rendering.
- `src/lib/canvas/styles.ts` (or equivalent) — status colour tokens.

---

## Outcome #1 — Structured Config UIs

### Renderer

New component: `src/lib/canvas/nodes/panels/BasicConfigForm.svelte`. Consumes a `BasicConfigField[]` schema and a `config` object, emits `change` events that bubble up the same way `GenericJsonPanel` does today.

Field type → renderer:

| Field type | Renderer |
|---|---|
| `dropdown` | `<select>` with `options` array |
| `toggle` | Checkbox switch |
| `slider` | Range input with current-value label |
| `text` | Single-line input |
| `textarea` | Multi-line input |
| `template-textarea` | Multi-line input + autocomplete for `{{upstream.field}}` references (reuses existing template-mention component if present, else plain textarea for v1) |
| `number` | Number input (with `min`/`max` if defined) |
| `code` | CodeMirror or simple monospace textarea (whatever `CodeExecutePanel` uses) |
| `schema-builder` | **NEW** — repeating list of `{ name: text, type: dropdown(string/number/boolean/object/array), required: toggle }` rows; add/remove buttons |

Visibility rules: each field can declare `showWhen: { field: string, equals: unknown }` — renderer hides fields whose condition isn't met. Sections (`section?: string` on each field) group fields under collapsible headers.

### Panel registry change

`src/lib/canvas/nodes/panels/registry.ts` — fallback chain becomes:

1. Specialized panel if registered for the type (existing behaviour).
2. `BasicConfigForm` if the node's `NodeDefinition` declares non-empty `basicConfig`.
3. `GenericJsonPanel` as last resort.

A "Show advanced" toggle on the form opens the JSON view in a side panel for power users / orchestrator debugging.

### Populating `basicConfig` for 35 nodes

For each node in `src/lib/workflows/nodes/*.def.ts` that doesn't already declare `basicConfig`, add it. The shape of each is determined by the existing `configSchema` JsonSchema and `defaultConfig`. Examples:

- `whatsapp`: `[ { key: 'to', type: 'text', label: 'Phone number', required: true }, { key: 'message', type: 'template-textarea', label: 'Message' } ]`
- `http-request`: `[ method dropdown, url text, headers textarea (`Key: Value` per line, parsed at execute), body template-textarea ]`
- `validator`: `[ schema schema-builder ]`
- `data-store`: `[ key text, schema schema-builder, ttl number ]`
- `transform`: `[ expression code ]`
- `llm-call`: `[ model dropdown, system template-textarea, user template-textarea, temperature slider 0–1 ]`

Headers / list-of-objects fields use `textarea` with one entry per line and a documented parsing rule, not a new field type. We chose not to add `key-value` or `list-of-objects` field types — they'd be one-off complexity for ~3 nodes.

### Files touched

- `src/lib/workflows/types.ts` — add `schema-builder` to `BasicConfigField['type']` union, add `showWhen?` and `section?` if not already present.
- `src/lib/canvas/nodes/panels/BasicConfigForm.svelte` — new file.
- `src/lib/canvas/nodes/panels/SchemaBuilderField.svelte` — new file.
- `src/lib/canvas/nodes/panels/registry.ts` — update fallback chain.
- `src/lib/workflows/nodes/*.def.ts` — add `basicConfig` to each of the 35 nodes that don't have it.

---

## Outcome #3 — Debug Endpoint + Orchestrator Verification

### `dryRun` flag in `ExecutionContext`

Add `dryRun: boolean` to `ExecutionContext` (`src/lib/workflows/types.ts`). When the engine is invoked with `dryRun: true`, every executor sees the flag.

Side-effecting executors short-circuit:

```ts
// whatsapp.ts
if (context.dryRun) {
  return {
    output: { simulated: true, would_send: { to, message } },
    rowCount: 1,
    logs: [`[dry-run] would send to ${to}: ${message.slice(0, 80)}…`],
  };
}
```

Executors to update: `whatsapp`, `email`, `gmail-send`, `gmail-reply`, `gmail-label`, `home-assistant`, `blog`, `data-store` (write path only), `intel-write`. Read-only executors (HTTP GET, gmail-fetch, strava, whoop) run for real — they have no side effect on the user.

### Debug API endpoint

`POST /api/workflows/[id]/debug-run`

Body: `{ initialInput?: object }`

Response:
```json
{
  "runId": "dbg_…",
  "status": "completed" | "failed",
  "captureLog": [
    { "nodeId": "n3", "nodeType": "whatsapp", "would_send": { "to": "+44…", "message": "…" } },
    { "nodeId": "n4", "nodeType": "blog", "would_publish": { "title": "…", "slug": "…" } }
  ],
  "nodeOutputs": { "n1": {...}, "n2": {...} },
  "errors": [...]
}
```

Implementation: thin wrapper around `WorkflowEngine.execute()` with `dryRun: true`, no DB persistence of run/node-execution rows (debug runs are ephemeral).

### `verify_workflow` orchestrator tool

New tool added to `src/lib/workflows/orchestrator/loop.ts` alongside `finalize_workflow`. Tool definition:

```ts
{
  name: 'verify_workflow',
  description: 'Run the current workflow draft in debug mode (side-effecting nodes simulated) and review what it would have sent. Call this before finalize_workflow to confirm the workflow meets the user\'s goal.',
  input_schema: { initialInput: { type: 'object' } }
}
```

Tool handler:

1. Pass the in-memory draft (nodes + edges) directly to `WorkflowEngine.execute()` with `dryRun: true` — no DB persistence of the verification run.
2. Collect outputs from every node where `output.simulated === true` into a `captureLog` array.
3. Return `{ captureLog, nodeOutputs, errors }` to the LLM as the tool result.

System prompt addition: "If the workflow contains any side-effecting nodes (whatsapp, email, gmail-send, blog, home-assistant), you MUST call `verify_workflow` and review its output before calling `finalize_workflow`."

Verification rounds are capped via the existing 30-round tool-loop limit and a new explicit `maxVerifications: 3` counter — after 3 verify calls, the next must be `finalize_workflow` or the loop aborts with an error returned to the user.

### Files touched

- `src/lib/workflows/types.ts` — add `dryRun: boolean` to `ExecutionContext`.
- `src/lib/workflows/engine.ts` — accept `dryRun` option, pass through to context.
- `src/lib/workflows/nodes/{whatsapp,email,gmail-send,gmail-reply,gmail-label,home-assistant,blog,data-store,intel-write}.ts` — short-circuit on `dryRun`.
- `src/routes/api/workflows/[id]/debug-run/+server.ts` — new endpoint.
- `src/lib/workflows/orchestrator/loop.ts` — add `verify_workflow` tool, increment counter, enforce cap.
- `src/lib/workflows/orchestrator/prompts.ts` (or wherever the system prompt lives) — instruction update.

---

## Testing strategy

- **Outcome #2:** Unit test that every executor returns a `rowCount`. Snapshot test that SSE events for a small two-node run carry `rowCount`. Visual regression: a Playwright test that runs a workflow and asserts the edge label appears with the right number.
- **Outcome #1:** Unit test that `BasicConfigForm` renders every field type. Type-level test that every `NodeDefinition` exports a non-empty `basicConfig`. Smoke test that loading the canvas with each node type doesn't fall through to `GenericJsonPanel`.
- **Outcome #3:** Integration test that `POST /api/workflows/[id]/debug-run` against a workflow with a WhatsApp node returns `would_send` instead of triggering a real send. Test that the orchestrator loop calls `verify_workflow` before `finalize_workflow` for a workflow that includes a WhatsApp node. Test the 3-round cap.

## Open questions

None — all design decisions have been made above. Implementation plan is the next artifact.

## Decisions log

| Question | Decision | Rationale |
|---|---|---|
| Generic renderer vs per-node panels | Generic, populate all 40 | One renderer, schema-driven, retains existing 5 specialized panels as overrides |
| Extra structured field types | Only `schema-builder` added | Other shapes (key/value, list-of-objects) handled with textarea + parsing rule |
| Row count semantics | Explicit `rowCount` per executor | Auto-detection (e.g., array length) is wrong for `{ workouts: [...] }` style outputs |
| Node visual treatment | Coloured border + text status pill | Pill carries duration/rowCount/error; border carries quick-glance state |
| Dry-run mechanism | Per-executor `dryRun` in `ExecutionContext` | Engine-level substitution hides intent; config-level toggle leaks into saved state |
| Verification ownership | `verify_workflow` LLM tool | Keeps orchestrator agentic; cap of 3 rounds prevents runaway |
