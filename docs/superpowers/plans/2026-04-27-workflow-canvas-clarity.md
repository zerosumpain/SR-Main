# Workflow Canvas Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the JKAI workflow canvas clear and self-verifying — every node has a structured (no-JSON) config form, the canvas shows runtime status + row counts on connectors, and the orchestrator runs a debug pass before declaring a workflow complete.

**Architecture:** Three independent feature phases shipped sequentially. Phase A (runtime indicators) is done first because it's the smallest surface and makes Phase C testable. Phase B (config UIs) lands a single generic `BasicConfigForm.svelte` that consumes the existing `basicConfig: BasicConfigField[]` schema already declared on every node — no per-node panel work is needed because every node already has `basicConfig` populated. Phase C (debug verification) adds a `dryRun` flag to `ExecutionContext`, short-circuits side-effecting executors, exposes a `POST /api/workflows/[id]/debug-run` endpoint, and gives the orchestrator a `verify_workflow` LLM tool capped at 3 verification rounds.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, PostgreSQL + Drizzle ORM, Vitest for tests, existing SSE infrastructure, existing `WorkflowEngine` and `NodeRegistry`.

**Spec:** `docs/superpowers/specs/2026-04-27-workflow-canvas-clarity-design.md`

---

## Phase A — Runtime Indicators (Outcome #2)

### Task A1: Add `rowCount` to NodeResult and the node_completed event

**Files:**
- Modify: `src/lib/workflows/types.ts` (NodeResult interface around line 68)

- [ ] **Step 1: Add the field to the type**

In `src/lib/workflows/types.ts`, change `NodeResult`:

```ts
export interface NodeResult {
  output: Record<string, unknown>;
  /**
   * How many rows / records this node produced. Set explicitly by every
   * executor — defaults to 1 in the engine when omitted (e.g. legacy executors).
   * Used for status pills on nodes and labels on outgoing edges.
   */
  rowCount?: number;
  logs?: string[];
  metadata?: Record<string, unknown>;
  pause?: {
    reason: 'awaiting_human';
    interactionId: number;
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsgo --noEmit 2>&1 | head -40` (falls back to `npx tsc --noEmit` if tsgo not present).
Expected: PASS, no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/types.ts
git commit -m "workflows: add optional rowCount to NodeResult"
```

---

### Task A2: Engine emits rowCount on node_completed

**Files:**
- Modify: `src/lib/workflows/engine.ts` (the `emit('node_completed', ...)` call near line 229 and the healing-success emit near line 387)

- [ ] **Step 1: Update the success emit**

Around line 229, change:

```ts
nodeOutputs.set(nodeId, result.output);
emit('node_completed', nodeId, result.output);
```

to:

```ts
const rowCount = typeof result.rowCount === 'number' ? result.rowCount : 1;
nodeOutputs.set(nodeId, result.output);
emit('node_completed', nodeId, { ...result.output, _rowCount: rowCount, _durationMs: Date.now() - nodeStartedAt });
```

Add `const nodeStartedAt = Date.now();` immediately above the existing `emit('node_started', nodeId);` (~line 201).

- [ ] **Step 2: Mirror the change in the healing-success emit**

Around line 387, the `emit('node_completed', nodeId, retryResult.output);` call. Apply the same `_rowCount` + `_durationMs` enrichment using the retry start timestamp.

- [ ] **Step 3: Typecheck**

Run: `npx tsgo --noEmit 2>&1 | head -40`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/engine.ts
git commit -m "workflows: emit _rowCount and _durationMs on node_completed"
```

---

### Task A3: Set rowCount in every executor

**Files:**
- Modify: every file under `src/lib/workflows/nodes/` that has an `execute()` method returning `NodeResult`

The list is enumerated below. For each, set `rowCount` based on what the node actually produced. Where the output already counts records, use that; otherwise default to 1.

Use `grep -l "execute" src/lib/workflows/nodes/*.ts | xargs grep -L "rowCount"` to find anything missed.

- [ ] **Step 1: Multi-row producers**

Edit each of these to compute `rowCount` from the array length they return:

| File | Field to count |
|---|---|
| `src/lib/workflows/nodes/whoop.ts` | `output.workouts?.length ?? 0` |
| `src/lib/workflows/nodes/strava.ts` | `output.activities?.length ?? 0` |
| `src/lib/workflows/nodes/gmail-fetch.ts` | `output.messages?.length ?? 0` |
| `src/lib/workflows/nodes/gmail-search.ts` | `output.messages?.length ?? 0` |
| `src/lib/workflows/nodes/tavily-search.ts` | `output.results?.length ?? 0` |
| `src/lib/workflows/nodes/health-query.ts` | `output.points?.length ?? output.rows?.length ?? 0` |
| `src/lib/workflows/nodes/intel-query.ts` | `output.results?.length ?? 0` |
| `src/lib/workflows/nodes/web-scrape.ts` | `output.pages?.length ?? 1` |
| `src/lib/workflows/nodes/stealth-scrape.ts` | `output.pages?.length ?? output.records?.length ?? 1` |
| `src/lib/workflows/nodes/stealth-scrape-llm.ts` | `output.records?.length ?? output.items?.length ?? 1` |
| `src/lib/workflows/nodes/site-mapper.ts` | `output.pages?.length ?? output.urls?.length ?? 0` |
| `src/lib/workflows/nodes/accumulator.ts` | `output.items?.length ?? 0` |
| `src/lib/workflows/nodes/loop.ts` | `output.iterations ?? output.results?.length ?? 0` |
| `src/lib/workflows/nodes/merge.ts` | `Array.isArray(output.merged) ? output.merged.length : 1` |
| `src/lib/workflows/nodes/file-extract.ts` | `output.records?.length ?? output.rows?.length ?? 1` |
| `src/lib/workflows/nodes/file-text-extract.ts` | `output.chunks?.length ?? 1` |
| `src/lib/workflows/nodes/text-parser.ts` | `Array.isArray(output.matches) ? output.matches.length : 1` |
| `src/lib/workflows/nodes/http-request.ts` | `Array.isArray(output.body) ? output.body.length : 1` |

For each, find the `return { output, ... }` and add `rowCount`:

```ts
return { output, rowCount: output.workouts?.length ?? 0 };
```

- [ ] **Step 2: Single-row producers**

Edit each of these to set `rowCount: 1` on every return path:

`whatsapp.ts`, `email.ts`, `gmail-send.ts`, `gmail-reply.ts`, `gmail-label.ts`, `home-assistant.ts`, `blog.ts`, `data-store.ts`, `intel-write.ts`, `transform.ts`, `code-execute.ts`, `llm-call.ts`, `llm-router.ts`, `llm-agent.ts`, `think.ts`, `openrouter.ts`, `validator.ts`, `conditional.ts`, `delay.ts`, `manual-trigger.ts`, `trigger.ts`, `gmail-trigger.ts`, `error-handler.ts`, `sub-workflow.ts`, `interactive-step.ts`, `jkai.ts`, `chat.ts`, `inspector.ts`, `quick-answer.ts`, `deep-dive.ts`, `deep-research.ts`, `intelligence.ts`, `research-result.ts`, `file-store.ts`, `file-build.ts`, `file-ops.ts`, `blog-ops.ts`, `deep-dive-ops.ts`.

For nodes with conditional outputs (e.g. `validator` returning either matched or unmatched), 1 row is fine — the rowCount represents units of output flowing forward.

- [ ] **Step 3: Run vitest sweep**

Run: `OPENCLAW_TEST_PROFILE=low npx vitest run src/lib/workflows --reporter=basic 2>&1 | tail -50`
Expected: existing tests pass; new code is purely additive.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/nodes
git commit -m "workflows: set explicit rowCount in every executor"
```

---

### Task A4: Canvas — read rowCount/duration from node_completed events

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (`liveData` declaration ~line 72; the `node_completed` event branch ~line 917)

- [ ] **Step 1: Widen liveData type**

Find:

```ts
let liveData = $state.raw<
  Record<string, { inputData?: unknown; outputData?: unknown; error?: string }>
>({});
```

Change to:

```ts
let liveData = $state.raw<
  Record<string, {
    inputData?: unknown;
    outputData?: unknown;
    error?: string;
    rowCount?: number;
    durationMs?: number;
  }>
>({});
```

- [ ] **Step 2: Capture rowCount/durationMs from the event**

Find the `node_completed` handler around line 917 and update it to extract `_rowCount` and `_durationMs` from `evt.data` and store them on `liveData`. The existing handler likely looks like:

```ts
} else if (evt.type === 'node_completed' && evt.nodeId) {
  pendingLiveData[evt.nodeId] = {
    ...(pendingLiveData[evt.nodeId] ?? liveData[evt.nodeId] ?? {}),
    inputData: (evt.data?.inputData ?? liveData[evt.nodeId]?.inputData) as unknown,
    outputData: evt.data,
  };
  pendingLiveStatus[evt.nodeId] = 'completed';
  scheduleFlush();
}
```

Replace its body with:

```ts
const data = (evt.data ?? {}) as Record<string, unknown>;
const rowCount = typeof data._rowCount === 'number' ? data._rowCount : undefined;
const durationMs = typeof data._durationMs === 'number' ? data._durationMs : undefined;
const { _rowCount: _r, _durationMs: _d, ...output } = data;
pendingLiveData[evt.nodeId] = {
  ...(pendingLiveData[evt.nodeId] ?? liveData[evt.nodeId] ?? {}),
  inputData: (data.inputData ?? liveData[evt.nodeId]?.inputData) as unknown,
  outputData: output,
  rowCount,
  durationMs,
};
pendingLiveStatus[evt.nodeId] = 'completed';
scheduleFlush();
```

- [ ] **Step 3: Typecheck + dev**

Run: `npx tsgo --noEmit 2>&1 | head -30`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/routes/jkai/canvas/\[slug\]/+page.svelte
git commit -m "canvas: capture rowCount and durationMs from node_completed events"
```

---

### Task A5: Canvas — render status pill on every node

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (node template — search for `wf-node` class and the existing `wf-node-status-dot` block ~line 3271)

- [ ] **Step 1: Add a helper for the pill text**

Add this near the other helpers in the `<script>` block (e.g. after the `statusDotColour` function):

```ts
function statusPillText(nodeId: string, status: NodeStatus | undefined): string | null {
  const live = liveData[nodeId];
  if (status === 'running') {
    const startedAt = nodeStartedAt[nodeId];
    if (!startedAt) return 'Running…';
    const secs = ((nowTick - startedAt) / 1000).toFixed(1);
    return `Running ${secs}s`;
  }
  if (status === 'completed') {
    if (typeof live?.rowCount === 'number') return `Done · ${live.rowCount} rows`;
    return 'Done';
  }
  if (status === 'failed') {
    const err = live?.error || 'failed';
    return `Failed: ${String(err).split('\n')[0].slice(0, 40)}`;
  }
  if (status === 'awaiting_human') return 'Awaiting input';
  return null;
}
```

- [ ] **Step 2: Track per-node start time + a 250ms ticker for live duration**

Add at the top of the `<script>` block alongside `liveStatus`:

```ts
let nodeStartedAt = $state.raw<Record<string, number>>({});
let nowTick = $state(Date.now());
```

In the `node_started` event handler, set `pendingNodeStartedAt[evt.nodeId] = Date.now();` (mirroring the pendingLiveStatus pattern). Push that into `nodeStartedAt` from `flushLive()`.

Add a `$effect` that runs a 250ms interval whenever any node is `running`:

```ts
$effect(() => {
  const anyRunning = Object.values(liveStatus).some((s) => s === 'running');
  if (!anyRunning) return;
  const id = setInterval(() => { nowTick = Date.now(); }, 250);
  return () => clearInterval(id);
});
```

(See feedback memory `feedback_svelte5_state_in_effect_loop.md` — the interval handle is a local `const`, not `$state`, which is the correct pattern.)

- [ ] **Step 3: Render the pill in the node template**

Find the existing `wf-node-status-dot` block (~line 3271) and add a sibling pill element:

```svelte
{@const pill = statusPillText(n.id, liveStatus[n.id] ?? n.status)}
{#if pill}
  <span class="wf-node-status-pill wf-node-status-{statusDotColour(liveStatus[n.id] ?? n.status)}">{pill}</span>
{/if}
```

- [ ] **Step 4: Add CSS for the pill and the running border pulse**

Find the existing `.wf-node-status-dot` styles in the same file and add:

```css
.wf-node-status-pill {
  position: absolute;
  top: 4px;
  right: 6px;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-family: var(--font-mono, monospace);
  line-height: 1.4;
  white-space: nowrap;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  pointer-events: none;
}
.wf-node-status-pill.wf-node-status-blue   { background: #1a73e8; }
.wf-node-status-pill.wf-node-status-green  { background: #1e8e3e; }
.wf-node-status-pill.wf-node-status-red    { background: #c5221f; }
.wf-node-status-pill.wf-node-status-amber  { background: #b06000; }

.wf-node[data-status='running'] {
  box-shadow: 0 0 0 2px #1a73e8;
  animation: wf-pulse 1.4s ease-in-out infinite;
}
.wf-node[data-status='completed'] { box-shadow: 0 0 0 2px #1e8e3e; }
.wf-node[data-status='failed']    { box-shadow: 0 0 0 2px #c5221f; }
.wf-node[data-status='awaiting_human'] { box-shadow: 0 0 0 2px #b06000; }
@keyframes wf-pulse {
  0%, 100% { box-shadow: 0 0 0 2px #1a73e8; }
  50%      { box-shadow: 0 0 0 4px rgba(26,115,232,0.45); }
}
```

Update the node element so it carries `data-status={liveStatus[n.id] ?? n.status}`. Find the existing top-level `<div class="wf-node …">` for the visual node and add the attribute.

- [ ] **Step 5: Smoke test in browser**

Run: `npm run dev` and open `http://homeserv:5173/jkai/canvas/<a-recent-slug>`. Trigger a workflow run via the existing run button. Confirm:
1. While running: blue pulsing border, "Running 0.6s" pill that ticks up.
2. On completion: green border, "Done · N rows" pill.
3. On failure: red border, "Failed: <message>" pill.

- [ ] **Step 6: Commit**

```bash
git add src/routes/jkai/canvas/\[slug\]/+page.svelte
git commit -m "canvas: status pill (running/done/failed) and bordered live state on nodes"
```

---

### Task A6: Canvas — render row-count labels on edges

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte` (edge rendering — search for `class="edge-stroke"` ~line 2586 and the surrounding `<g>` per-edge block)

- [ ] **Step 1: Compute mid-point + label per edge**

The existing edge renderer draws an SVG path between two nodes. Where the path is rendered (`<path class="edge-stroke" …>`), add a sibling `<text>` element that displays `liveData[edge.from]?.rowCount` once defined:

```svelte
{@const sourceLive = liveData[e.from]}
{@const showRows = typeof sourceLive?.rowCount === 'number'}
{#if showRows}
  {@const mid = edgeMidpoint(e)}
  <g class="edge-rowcount" transform="translate({mid.x}, {mid.y})">
    <rect x="-22" y="-9" width="44" height="14" rx="3" />
    <text x="0" y="2" text-anchor="middle">{sourceLive.rowCount} rows</text>
  </g>
{/if}
```

- [ ] **Step 2: Add `edgeMidpoint(e)` helper**

In the `<script>` block, add:

```ts
function edgeMidpoint(e: { from: string; to: string }): { x: number; y: number } {
  const a = canvas?.nodes.find((n) => n.id === e.from);
  const b = canvas?.nodes.find((n) => n.id === e.to);
  if (!a || !b) return { x: 0, y: 0 };
  return {
    x: (a.position.x + b.position.x) / 2 + 80, // 80 ≈ half node width; adjust if node width differs
    y: (a.position.y + b.position.y) / 2 + 30,
  };
}
```

If the codebase already has an edge geometry helper (look near the `Orthogonal edge routing` comment ~line 467), prefer reusing/extending it over the simple midpoint above.

- [ ] **Step 3: CSS for the label**

Add near the other edge styles:

```css
.edge-rowcount rect { fill: rgba(255,255,255,0.92); stroke: rgba(0,0,0,0.15); stroke-width: 1; }
.edge-rowcount text { font-family: var(--font-mono, monospace); font-size: 10px; fill: #222; pointer-events: none; }
```

- [ ] **Step 4: Smoke test**

Run a workflow with a multi-row node (e.g. `whoop` → `transform`) and confirm the edge between them shows e.g. `47 rows`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/jkai/canvas/\[slug\]/+page.svelte
git commit -m "canvas: row-count label on edges, sourced from node_completed events"
```

---

## Phase B — Structured Config UIs (Outcome #1)

### Task B1: Add `schema-builder` to BasicConfigField['type']

**Files:**
- Modify: `src/lib/workflows/types.ts` (line 24 — the `type:` union)

- [ ] **Step 1: Extend the union and add a row schema type**

Change:

```ts
type: 'dropdown' | 'toggle' | 'slider' | 'text' | 'textarea' | 'template-textarea' | 'number' | 'code';
```

to:

```ts
type: 'dropdown' | 'toggle' | 'slider' | 'text' | 'textarea' | 'template-textarea' | 'number' | 'code' | 'schema-builder';
```

Add a new exported helper type below `BasicConfigField`:

```ts
export interface SchemaFieldRow {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsgo --noEmit 2>&1 | head -30`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/types.ts
git commit -m "types: add schema-builder field type and SchemaFieldRow"
```

---

### Task B2: Build `BasicConfigForm.svelte`

**Files:**
- Create: `src/lib/canvas/nodes/panels/BasicConfigForm.svelte`

- [ ] **Step 1: Write the component**

```svelte
<script lang="ts">
  import type { BasicConfigField, NodeDefinition } from '$lib/workflows/types';
  import SchemaBuilderField from './SchemaBuilderField.svelte';

  let {
    config,
    onChange,
    definition,
  }: {
    config: Record<string, unknown>;
    onChange: (config: Record<string, unknown>) => void;
    definition: NodeDefinition;
  } = $props();

  let showAdvanced = $state(false);

  const fields = $derived(definition.basicConfig ?? []);

  function isVisible(field: BasicConfigField): boolean {
    if (field.advancedOnly && !showAdvanced) return false;
    const v = field.visibleWhen;
    if (!v) return true;
    const other = config[v.key];
    if (v.equals !== undefined) return other === v.equals;
    if (v.in) return v.in.includes(other);
    if (v.not !== undefined) return other !== v.not;
    return true;
  }

  function update(key: string, value: unknown) {
    onChange({ ...config, [key]: value });
  }

  // Group by section, preserving order of first appearance
  const sections = $derived.by(() => {
    const order: string[] = [];
    const map = new Map<string, BasicConfigField[]>();
    for (const f of fields) {
      const sec = f.section ?? '';
      if (!map.has(sec)) {
        map.set(sec, []);
        order.push(sec);
      }
      map.get(sec)!.push(f);
    }
    return order.map((s) => ({ name: s, fields: map.get(s)! }));
  });

  function toggleAdvanced() {
    showAdvanced = !showAdvanced;
  }
</script>

<div class="bcf">
  {#each sections as sec (sec.name)}
    {#if sec.name}
      <h4 class="bcf-section">{sec.name}</h4>
    {/if}
    {#each sec.fields as f (f.key)}
      {#if isVisible(f)}
        <label class="bcf-field" class:bcf-field-wide={f.type === 'textarea' || f.type === 'template-textarea' || f.type === 'code' || f.type === 'schema-builder'}>
          <span class="bcf-label">{f.label}</span>
          {#if f.description}<span class="bcf-desc">{f.description}</span>{/if}

          {#if f.type === 'dropdown'}
            <select value={config[f.key] ?? ''} onchange={(e) => update(f.key, (e.currentTarget as HTMLSelectElement).value)}>
              {#each f.options ?? [] as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          {:else if f.type === 'toggle'}
            <input type="checkbox" checked={Boolean(config[f.key])} onchange={(e) => update(f.key, (e.currentTarget as HTMLInputElement).checked)} />
          {:else if f.type === 'slider'}
            <div class="bcf-slider">
              <input type="range" min={f.min ?? 0} max={f.max ?? 100} step={f.step ?? 1} value={Number(config[f.key] ?? f.min ?? 0)} oninput={(e) => update(f.key, Number((e.currentTarget as HTMLInputElement).value))} />
              <span>{config[f.key] ?? f.min ?? 0}</span>
            </div>
          {:else if f.type === 'number'}
            <input type="number" min={f.min} max={f.max} step={f.step ?? 1} value={Number(config[f.key] ?? 0)} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, Number((e.currentTarget as HTMLInputElement).value))} />
          {:else if f.type === 'text'}
            <input type="text" value={String(config[f.key] ?? '')} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, (e.currentTarget as HTMLInputElement).value)} />
          {:else if f.type === 'textarea' || f.type === 'template-textarea'}
            <textarea rows="4" value={String(config[f.key] ?? '')} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
          {:else if f.type === 'code'}
            <textarea class="bcf-code" rows="8" spellcheck="false" value={String(config[f.key] ?? '')} placeholder={f.placeholder ?? ''} oninput={(e) => update(f.key, (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
          {:else if f.type === 'schema-builder'}
            <SchemaBuilderField value={config[f.key] as unknown[] ?? []} onChange={(v) => update(f.key, v)} />
          {/if}
        </label>
      {/if}
    {/each}
  {/each}

  <button type="button" class="bcf-advanced-toggle" onclick={toggleAdvanced}>
    {showAdvanced ? 'Hide advanced fields' : 'Show advanced fields'}
  </button>
</div>

<style>
  .bcf { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
  .bcf-section { margin: 8px 0 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
  .bcf-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
  .bcf-label { font-weight: 600; color: #222; }
  .bcf-desc { font-size: 11px; color: #666; }
  .bcf-slider { display: flex; gap: 8px; align-items: center; }
  .bcf-code { font-family: var(--font-mono, monospace); font-size: 11px; }
  .bcf-advanced-toggle { margin-top: 8px; background: none; border: 1px dashed #ccc; padding: 4px 8px; font-size: 11px; cursor: pointer; }
  input[type='text'], input[type='number'], select, textarea {
    width: 100%; padding: 4px 6px; border: 1px solid #d0d0d0; border-radius: 3px; font: inherit; box-sizing: border-box;
  }
</style>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsgo --noEmit 2>&1 | head -30`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/canvas/nodes/panels/BasicConfigForm.svelte
git commit -m "canvas: BasicConfigForm renderer for NodeDefinition.basicConfig"
```

---

### Task B3: Build `SchemaBuilderField.svelte`

**Files:**
- Create: `src/lib/canvas/nodes/panels/SchemaBuilderField.svelte`

- [ ] **Step 1: Write the component**

```svelte
<script lang="ts">
  import type { SchemaFieldRow } from '$lib/workflows/types';

  let {
    value,
    onChange,
  }: {
    value: unknown[] | undefined;
    onChange: (v: SchemaFieldRow[]) => void;
  } = $props();

  const rows = $derived<SchemaFieldRow[]>(Array.isArray(value) ? (value as SchemaFieldRow[]) : []);

  const TYPES: SchemaFieldRow['type'][] = ['string', 'number', 'boolean', 'object', 'array'];

  function update(i: number, patch: Partial<SchemaFieldRow>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  }

  function add() {
    onChange([...rows, { name: '', type: 'string', required: false }]);
  }

  function remove(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
</script>

<table class="sb">
  <thead>
    <tr>
      <th>Field name</th>
      <th>Type</th>
      <th>Required</th>
      <th></th>
    </tr>
  </thead>
  <tbody>
    {#each rows as row, i (i)}
      <tr>
        <td><input type="text" value={row.name} oninput={(e) => update(i, { name: (e.currentTarget as HTMLInputElement).value })} /></td>
        <td>
          <select value={row.type} onchange={(e) => update(i, { type: (e.currentTarget as HTMLSelectElement).value as SchemaFieldRow['type'] })}>
            {#each TYPES as t}<option value={t}>{t}</option>{/each}
          </select>
        </td>
        <td><input type="checkbox" checked={row.required} onchange={(e) => update(i, { required: (e.currentTarget as HTMLInputElement).checked })} /></td>
        <td><button type="button" onclick={() => remove(i)} aria-label="remove">×</button></td>
      </tr>
    {/each}
    {#if rows.length === 0}
      <tr><td colspan="4" class="sb-empty">No fields. Click "Add field" below.</td></tr>
    {/if}
  </tbody>
</table>
<button type="button" class="sb-add" onclick={add}>+ Add field</button>

<style>
  .sb { width: 100%; border-collapse: collapse; font-size: 12px; }
  .sb th, .sb td { padding: 4px 6px; border-bottom: 1px solid #eee; text-align: left; }
  .sb th { font-size: 10px; text-transform: uppercase; color: #666; }
  .sb input[type='text'], .sb select { width: 100%; padding: 3px 6px; border: 1px solid #d0d0d0; border-radius: 3px; }
  .sb-empty { color: #999; text-align: center; font-style: italic; padding: 12px 0; }
  .sb-add { margin-top: 6px; background: none; border: 1px dashed #ccc; padding: 3px 8px; font-size: 11px; cursor: pointer; }
  button[aria-label='remove'] { background: none; border: none; font-size: 16px; cursor: pointer; color: #c5221f; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/canvas/nodes/panels/SchemaBuilderField.svelte
git commit -m "canvas: SchemaBuilderField (table) for schema-builder field type"
```

---

### Task B4: Update panels registry to fall back to BasicConfigForm

**Files:**
- Modify: `src/lib/canvas/nodes/panels/registry.ts`

- [ ] **Step 1: Replace the registry contents**

```ts
import type { Component } from 'svelte';
import StealthScrapePanel from './StealthScrapePanel.svelte';
import StealthScrapeLlmPanel from './StealthScrapeLlmPanel.svelte';
import InteractiveStepPanel from './InteractiveStepPanel.svelte';
import SiteMapperPanel from './SiteMapperPanel.svelte';
import CodeExecutePanel from './CodeExecutePanel.svelte';
import BasicConfigForm from './BasicConfigForm.svelte';
import GenericJsonPanel from './GenericJsonPanel.svelte';
import type { NodeDefinition } from '$lib/workflows/types';

export type PanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  definition?: NodeDefinition;
};

const specialized: Record<string, Component<PanelProps>> = {
  'stealth-scrape': StealthScrapePanel,
  'stealth-scrape-llm': StealthScrapeLlmPanel,
  'interactive-step': InteractiveStepPanel,
  'site-mapper': SiteMapperPanel,
  'code-execute': CodeExecutePanel,
};

/**
 * Resolution order:
 *   1. specialized panel for this type (if registered)
 *   2. BasicConfigForm if the definition declares basicConfig
 *   3. GenericJsonPanel as last-resort
 */
export function getPanel(type: string, definition?: NodeDefinition): Component<PanelProps> {
  if (specialized[type]) return specialized[type];
  if (definition?.basicConfig && definition.basicConfig.length > 0) return BasicConfigForm;
  return GenericJsonPanel;
}
```

- [ ] **Step 2: Update every call site of getPanel to pass the definition**

Find call sites: `grep -rn "getPanel(" src/`. There should be one or two. Each must now pass the node's `NodeDefinition` (look up via the existing `nodeDefinitions` store / registry-client). Example:

```ts
const Panel = getPanel(node.type, getNodeDefinition(node.type));
```

If the consuming component already has access to the definition under another name, pass it through. If not, import `getDefinition` (or whatever the client-side lookup is — `src/lib/workflows/registry-client.ts`) and call it.

- [ ] **Step 3: Smoke test in browser**

Run `npm run dev`, open the canvas, open a node config (e.g. `whatsapp` or `http-request`). Confirm a structured form appears (Phone number, Message, etc.) — not a JSON textarea.

- [ ] **Step 4: Commit**

```bash
git add src/lib/canvas/nodes/panels/registry.ts
# plus any call-site files
git commit -m "canvas: route nodes with basicConfig through BasicConfigForm"
```

---

### Task B5: Convert `validator` and `data-store` schema fields to schema-builder

**Files:**
- Modify: `src/lib/workflows/nodes/validator.ts` (or wherever its `basicConfig` lives)
- Modify: `src/lib/workflows/nodes/data-store.def.ts`

- [ ] **Step 1: Audit current schema field**

Run: `grep -n "basicConfig\|schema" src/lib/workflows/nodes/validator.ts src/lib/workflows/nodes/data-store.def.ts | head -30`. Locate the field that today represents the schema (likely a `code` or `textarea` field whose value is a JSON string).

- [ ] **Step 2: Replace with schema-builder**

For `data-store.def.ts`, change the existing schema field's `type` from whatever it is today to `'schema-builder'`. The stored value shape goes from a free-form JSON object to `SchemaFieldRow[]`.

If the executor today reads `config.schema` as a JSON object, add a small adapter at the top of the executor:

```ts
function rowsToSchema(rows: unknown): { properties: Record<string, { type: string }>; required: string[] } {
  if (!Array.isArray(rows)) return { properties: {}, required: [] };
  const properties: Record<string, { type: string }> = {};
  const required: string[] = [];
  for (const r of rows as { name: string; type: string; required: boolean }[]) {
    if (!r.name) continue;
    properties[r.name] = { type: r.type };
    if (r.required) required.push(r.name);
  }
  return { properties, required };
}
```

Use `rowsToSchema(config.schema)` wherever the old object was previously consumed.

Repeat for `validator.ts`.

- [ ] **Step 3: Run vitest for these two nodes**

Run: `OPENCLAW_TEST_PROFILE=low npx vitest run src/lib/workflows/nodes/validator src/lib/workflows/nodes/data-store --reporter=basic 2>&1 | tail -30`
Expected: PASS (or skip if no tests exist; in that case smoke-test in the browser by adding a validator node and defining a 2-field schema).

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/nodes/validator.ts src/lib/workflows/nodes/data-store.def.ts
git commit -m "nodes: switch validator/data-store schema fields to schema-builder"
```

---

## Phase C — Debug Verification (Outcome #3)

### Task C1: Add `dryRun` flag to ExecutionContext

**Files:**
- Modify: `src/lib/workflows/types.ts` (ExecutionContext, line 79)
- Modify: `src/lib/workflows/engine.ts` (constructor / execute options)

- [ ] **Step 1: Add the field to the type**

In `types.ts`:

```ts
export interface ExecutionContext {
  runId: string;
  workflowId: string;
  workspaceDir: string;
  /** When true, side-effecting nodes must short-circuit and return a simulated output. */
  dryRun: boolean;
  emit: (event: WorkflowEvent) => void;
  // … rest unchanged
}
```

Update `EngineOptions`:

```ts
export interface EngineOptions {
  selfHealing?: boolean;
  dryRun?: boolean;
}
```

- [ ] **Step 2: Plumb through engine.ts**

Find the existing context creation around line 203:

```ts
const context: ExecutionContext = {
  runId,
  workflowId: workflowId ?? workflow.id,
  workspaceDir: `/tmp/workflow-${runId}`,
  // …
};
```

Add `dryRun: this.options.dryRun ?? false,` to the object.

If `EngineOptions` is currently passed via `execute()` rather than the constructor, accept it on `execute()` and store on `this.options` for the run, OR pass it directly into the context creation call. Either works — match existing style.

- [ ] **Step 3: Typecheck**

Run: `npx tsgo --noEmit 2>&1 | head -30`
Expected: PASS — every existing call site that constructs an `ExecutionContext` will now flag missing `dryRun`. Fix each by adding `dryRun: false`. Run the typecheck again.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/types.ts src/lib/workflows/engine.ts
git commit -m "engine: thread dryRun flag through ExecutionContext and EngineOptions"
```

---

### Task C2: Side-effecting executors short-circuit on dryRun

**Files (all under `src/lib/workflows/nodes/`):**
- Modify: `whatsapp.ts`, `email.ts`, `gmail-send.ts`, `gmail-reply.ts`, `gmail-label.ts`, `home-assistant.ts`, `blog.ts`, `data-store.ts`, `intel-write.ts`

- [ ] **Step 1: Pattern (apply to each file)**

At the top of each `execute()` method, before any side-effecting call, insert a dry-run branch. Example for `whatsapp.ts`:

```ts
async execute(input, config, context): Promise<NodeResult> {
  const to = renderTemplate(config.to, input);
  const message = renderTemplate(config.message, input);

  if (context.dryRun) {
    return {
      output: { simulated: true, would_send: { to, message } },
      rowCount: 1,
      logs: [`[dry-run] would send WhatsApp to ${to}: ${String(message).slice(0, 80)}`],
    };
  }

  // …existing real-send logic
}
```

Per-node mappings:

| File | Captured shape |
|---|---|
| `whatsapp.ts` | `{ simulated: true, would_send: { to, message } }` |
| `email.ts` | `{ simulated: true, would_send: { to, subject, body } }` |
| `gmail-send.ts` | `{ simulated: true, would_send: { accountId, to, subject, body } }` |
| `gmail-reply.ts` | `{ simulated: true, would_reply: { accountId, threadId, body } }` |
| `gmail-label.ts` | `{ simulated: true, would_label: { accountId, messageId, addLabels, removeLabels } }` |
| `home-assistant.ts` | `{ simulated: true, would_call: { domain, service, entity_id, data } }` |
| `blog.ts` | `{ simulated: true, would_publish: { title, slug, status } }` |
| `data-store.ts` | only the *write* branch — `{ simulated: true, would_write: { key, value } }`. The read branch must run for real so downstream nodes have realistic data. |
| `intel-write.ts` | `{ simulated: true, would_write: { collection, record } }` |

- [ ] **Step 2: Run vitest**

Run: `OPENCLAW_TEST_PROFILE=low npx vitest run src/lib/workflows --reporter=basic 2>&1 | tail -50`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/nodes/whatsapp.ts src/lib/workflows/nodes/email.ts src/lib/workflows/nodes/gmail-send.ts src/lib/workflows/nodes/gmail-reply.ts src/lib/workflows/nodes/gmail-label.ts src/lib/workflows/nodes/home-assistant.ts src/lib/workflows/nodes/blog.ts src/lib/workflows/nodes/data-store.ts src/lib/workflows/nodes/intel-write.ts
git commit -m "nodes: short-circuit side-effecting executors when context.dryRun"
```

---

### Task C3: New `POST /api/workflows/[id]/debug-run` endpoint

**Files:**
- Create: `src/routes/api/workflows/[id]/debug-run/+server.ts`

- [ ] **Step 1: Write the endpoint**

```ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { WorkflowEngine } from '$lib/workflows/engine';
import { registry } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows/types';
import { randomUUID } from 'crypto';

interface CaptureEntry {
  nodeId: string;
  nodeType: string;
  capture: Record<string, unknown>;
}

export const POST: RequestHandler = async ({ params, request }) => {
  const id = params.id!;
  const body = (await request.json().catch(() => ({}))) as { initialInput?: Record<string, unknown> };

  const wfRow = await db.select().from(workflows).where(eq(workflows.id, id)).limit(1).then((r) => r[0]);
  if (!wfRow) return json({ error: 'workflow not found' }, { status: 404 });

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, id));

  const workflow: WorkflowDefinition = {
    id,
    name: wfRow.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config ?? {}) as Record<string, unknown>,
      label: n.label ?? n.type,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  const engine = new WorkflowEngine(registry, { dryRun: true });
  const runId = `dbg_${randomUUID()}`;

  const result = await engine.execute(workflow, runId, body.initialInput ?? {});

  // Build capture log: every node whose output has simulated:true
  const captureLog: CaptureEntry[] = [];
  for (const [nodeId, output] of Object.entries(result.nodeOutputs ?? {})) {
    if (output && typeof output === 'object' && (output as { simulated?: unknown }).simulated === true) {
      const nodeType = workflow.nodes.find((n) => n.id === nodeId)?.type ?? 'unknown';
      captureLog.push({ nodeId, nodeType, capture: output as Record<string, unknown> });
    }
  }

  return json({
    runId,
    status: result.status,
    captureLog,
    nodeOutputs: result.nodeOutputs ?? {},
    errors: result.errors ?? [],
  });
};
```

(If `WorkflowEngine`'s constructor doesn't take options today, adjust to whatever signature it already exposes — pass `{ dryRun: true }` via whichever entry point is in use. Match the pattern in `src/routes/api/workflows/[id]/run/+server.ts`.)

- [ ] **Step 2: Confirm engine returns `nodeOutputs`**

Open `src/lib/workflows/engine.ts` and check the `EngineResult` shape near the bottom of `execute()`. If `nodeOutputs` isn't on the returned object, add it: just include `nodeOutputs: Object.fromEntries(nodeOutputs)` in the existing return statement. Update the `EngineResult` type accordingly.

- [ ] **Step 3: Smoke test**

```bash
curl -s -X POST http://localhost:5173/api/workflows/<an-existing-workflow-id>/debug-run -H 'content-type: application/json' -d '{}' | jq .
```

Expected: a JSON response with `captureLog` listing every WhatsApp/email/etc node in the workflow with `would_send` content, and `status: "completed"`. Confirm the real WhatsApp service was NOT invoked (no QR-code log lines, no Baileys send chatter).

- [ ] **Step 4: Commit**

```bash
git add src/routes/api/workflows/\[id\]/debug-run/+server.ts src/lib/workflows/engine.ts
git commit -m "api: POST /api/workflows/[id]/debug-run runs workflow in dryRun mode"
```

---

### Task C4: Add `verify_workflow` orchestrator tool

**Files:**
- Modify: `src/lib/workflows/orchestrator/loop.ts` (the tool definitions and tool dispatch ~line 86–320)

- [ ] **Step 1: Add the tool definition**

Find the existing tools array (where `finalize_workflow`, `update_node`, etc. are declared). Add:

```ts
{
  name: 'verify_workflow',
  description: 'Run the current workflow draft in dryRun mode (side-effecting nodes simulated, capture log returned). Use this BEFORE finalize_workflow when the workflow contains any side-effecting nodes (whatsapp, email, gmail-send, gmail-reply, blog, home-assistant, data-store, intel-write). Review the capture log against the user\'s original goal — if it does not satisfy the goal, call update_node to fix and verify again. You may call verify_workflow at most 3 times per draft.',
  input_schema: {
    type: 'object',
    properties: {
      initialInput: { type: 'object', description: 'Optional input to seed the workflow with' },
    },
  },
}
```

- [ ] **Step 2: Add the tool handler**

Where the existing tool dispatch lives (the `switch (tool.name)` or equivalent), add a new case:

```ts
case 'verify_workflow': {
  if (verificationCount >= 3) {
    return {
      tool_use_id: tool.id,
      content: 'Verification limit reached (3). You must call finalize_workflow next, or stop and ask the user for guidance.',
    };
  }
  verificationCount++;

  const engine = new WorkflowEngine(registry, { dryRun: true });
  const runId = `dbg_${randomUUID()}`;
  const draftWorkflow: WorkflowDefinition = {
    id: workflowId ?? 'draft',
    name: draft.name ?? 'draft',
    nodes: draft.nodes,
    edges: draft.edges,
  };

  const result = await engine.execute(draftWorkflow, runId, (tool.input as { initialInput?: Record<string, unknown> }).initialInput ?? {});

  const captureLog: Array<{ nodeId: string; nodeType: string; capture: unknown }> = [];
  for (const [nodeId, output] of Object.entries(result.nodeOutputs ?? {})) {
    if (output && typeof output === 'object' && (output as { simulated?: unknown }).simulated === true) {
      const nodeType = draft.nodes.find((n) => n.id === nodeId)?.type ?? 'unknown';
      captureLog.push({ nodeId, nodeType, capture: output });
    }
  }

  return {
    tool_use_id: tool.id,
    content: JSON.stringify({
      verificationRound: verificationCount,
      maxRounds: 3,
      runStatus: result.status,
      captureLog,
      errors: result.errors ?? [],
    }, null, 2),
  };
}
```

Add `let verificationCount = 0;` alongside the existing loop counters at the top of the loop function.

- [ ] **Step 3: Update the system prompt**

Find the orchestrator's system prompt — likely in `src/lib/workflows/orchestrator/prompts.ts` or inlined in `loop.ts`. Add a paragraph:

> Before calling `finalize_workflow`, if the workflow contains any side-effecting nodes (`whatsapp`, `email`, `gmail-send`, `gmail-reply`, `gmail-label`, `home-assistant`, `blog`, `data-store`, `intel-write`), you MUST call `verify_workflow` first. Inspect the returned `captureLog` carefully — does each captured `would_send` / `would_publish` / `would_call` actually meet the user's stated goal? If not, call `update_node` to fix the issue, then call `verify_workflow` again. You have at most 3 verification rounds per workflow.

- [ ] **Step 4: Run vitest**

Run: `OPENCLAW_TEST_PROFILE=low npx vitest run src/lib/workflows/orchestrator --reporter=basic 2>&1 | tail -30`
Expected: existing tests pass.

- [ ] **Step 5: Manual end-to-end test**

In the JKAI builder UI, ask: "Send me a WhatsApp every morning at 9am with my Whoop strain from yesterday". Confirm the orchestrator calls `verify_workflow` before `finalize_workflow` (visible in the streaming tool trace) and that the capture log shows a `would_send` with the correct phone number (+447359228511) and a sensible message body referencing strain.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/orchestrator/loop.ts src/lib/workflows/orchestrator/prompts.ts
git commit -m "orchestrator: verify_workflow tool with 3-round cap and dryRun execution"
```

---

## Final: Deploy

### Task D1: Run typecheck + tests + lint, then deploy

- [ ] **Step 1: Full typecheck**

Run: `npx tsgo --noEmit 2>&1 | tail -20`
Expected: PASS, zero new errors.

- [ ] **Step 2: Full vitest**

Run: `OPENCLAW_TEST_PROFILE=low npx vitest run --reporter=basic 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `npm run lint 2>&1 | tail -20`
Expected: PASS or warnings only.

- [ ] **Step 4: Build locally**

Run: `npm run build 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Push**

```bash
git push origin master
```

- [ ] **Step 6: Deploy**

Run: `~/strange_rambling_svelte/scripts/deploy.sh 2>&1 | tail -30`
Expected: deployment script completes and the live site at https://strangeramblings.com responds normally.

- [ ] **Step 7: Production smoke test**

Open https://strangeramblings.com/jkai/canvas/<a-real-slug>. Confirm:
1. Opening a `whatsapp` node config shows a structured form (Phone number / Message), not raw JSON.
2. Triggering a workflow run shows status pills (Running / Done · N rows / Failed) on each node.
3. Edges between completed nodes show row counts.

---

## Self-Review Notes

- **Spec coverage:**
  - Outcome #1 (config UIs) → Tasks B1–B5. The spec called for populating `basicConfig` on 35 nodes; investigation showed every node already has `basicConfig` declared, so the task is the renderer + `schema-builder` field type only.
  - Outcome #2 (runtime indicators) → Tasks A1–A6.
  - Outcome #3 (debug verification) → Tasks C1–C4.
  - Build order #2 → #1 → #3 preserved.
- **Placeholder scan:** No "TBD"/"TODO"/"appropriate error handling" left in. Each step has either exact code or an exact command.
- **Type consistency:** `rowCount` is optional on `NodeResult` (engine defaults to 1); `_rowCount`/`_durationMs` are reserved keys on `node_completed` event data; `dryRun` is required on `ExecutionContext` and propagates from `EngineOptions`. Tool name `verify_workflow` is referenced consistently in C4.
- **Known follow-ups (not in scope):** none. Backwards-compatible throughout.
