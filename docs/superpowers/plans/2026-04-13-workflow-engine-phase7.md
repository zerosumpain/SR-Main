# Workflow Engine Phase 7: Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the workflow editor and list page: run history panel, workflow list improvements, full canvas node type coverage, mobile long-press on nodes, and error-handler node component verification.

**Architecture:** Mostly UI additions in existing Svelte components and the `[id]/+page.svelte` editor. No new DB migrations needed — all data already captured in `workflowRuns` and `nodeExecutions` tables from Phase 3.

**Dependencies:** Phase 1–4 complete. Phase 6 (scheduling) helps but is not required (trigger badge falls back gracefully if no schedule exists).

**Tech Stack:** Svelte 5 runes, SvelteKit, `@xyflow/svelte`, existing design tokens (CSS custom properties).

---

## Task 1: Run History Panel

Add a "Runs" tab to the workflow editor right sidebar. Shows past executions with timestamp, status, and duration. Clicking a run loads its node execution data.

**Files:**
- Create: `src/lib/components/workflows/RunHistoryPanel.svelte`
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 1.1: Create RunHistoryPanel.svelte**

Create `src/lib/components/workflows/RunHistoryPanel.svelte`:

```svelte
<script lang="ts">
  let {
    workflowId,
    onRunSelect,
    onClose,
  }: {
    workflowId: string;
    onRunSelect: (runId: string) => void;
    onClose: () => void;
  } = $props();

  interface RunRecord {
    id: string;
    status: string;
    trigger: string;
    startedAt: string;
    completedAt: string | null;
    error: string | null;
  }

  let runs = $state<RunRecord[]>([]);
  let loading = $state(true);

  const STATUS_COLORS: Record<string, string> = {
    completed: '#2d7d46',
    failed: '#b43232',
    running: '#569cd6',
    pending: 'var(--text-ghost)',
  };

  function duration(start: string, end: string | null): string {
    if (!end) return '—';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  }

  function formatTime(iso: string): string {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  }

  $effect(() => {
    fetch(`/api/workflows/${workflowId}/runs`)
      .then((r) => r.json())
      .then(({ runs: data }) => { runs = data ?? []; })
      .finally(() => { loading = false; });
  });
</script>

<div class="w-72 border-l flex flex-col h-full" style="background: var(--card-bg); border-color: var(--card-border);">
  <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--card-border);">
    <span class="text-xs font-semibold" style="color: var(--text-primary);">Run History</span>
    <button onclick={onClose} class="text-xs" style="color: var(--text-ghost);">✕</button>
  </div>

  <div class="flex-1 overflow-y-auto">
    {#if loading}
      <p class="text-xs p-4" style="color: var(--text-ghost);">Loading...</p>
    {:else if runs.length === 0}
      <p class="text-xs p-4" style="color: var(--text-ghost);">No runs yet. Click Run to start one.</p>
    {:else}
      {#each runs as run}
        <button
          onclick={() => onRunSelect(run.id)}
          class="w-full text-left px-4 py-3 border-b hover:bg-white/5 transition-colors"
          style="border-color: var(--card-border);"
        >
          <div class="flex items-center justify-between mb-1">
            <span
              class="text-[10px] font-semibold uppercase tracking-wide"
              style="color: {STATUS_COLORS[run.status] ?? 'var(--text-ghost)'};"
            >
              {run.status}
            </span>
            <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {duration(run.startedAt, run.completedAt)}
            </span>
          </div>
          <div class="text-[10px]" style="color: var(--text-secondary);">
            {formatTime(run.startedAt)} · {run.trigger}
          </div>
          {#if run.error}
            <div class="text-[10px] mt-1 truncate" style="color: #b43232;">{run.error}</div>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
</div>
```

- [ ] **Step 1.2: Wire into the editor page**

In `src/routes/workflows/[id]/+page.svelte`:

1. Add `'runs'` to the `rightPanel` state type: `let rightPanel = $state<'chat' | 'inspector' | 'runs'>('chat')`
2. Add a "Runs" tab button in the toolbar area (or alongside the existing close/back buttons in the right panel header)
3. Dynamic import `RunHistoryPanel`
4. Add the panel branch:
   ```svelte
   {:else if rightPanel === 'runs' && RunHistoryPanel}
     <RunHistoryPanel
       {workflowId}
       onRunSelect={(runId) => { currentRunId = runId; rightPanel = 'inspector'; }}
       onClose={() => { rightPanel = 'chat'; }}
     />
   ```

---

## Task 2: Workflow List Improvements

Add trigger type badge, last run status/time, and node count to each workflow card on the list page.

**Files:**
- Modify: `src/routes/workflows/+page.svelte` (or the list page, check actual path)
- Modify: `src/routes/api/workflows/+server.ts` (GET endpoint — enrich response)

- [ ] **Step 2.1: Identify the list page path**

Check `src/routes/workflows/` for `+page.svelte` and `+page.server.ts`. The list route is at `/workflows`.

- [ ] **Step 2.2: Enrich the GET /api/workflows response**

In `src/routes/api/workflows/+server.ts` GET handler, join with `workflowSchedules` for trigger type and `workflowRuns` for last run, and count `workflowNodes`:

```typescript
// In the GET handler, after fetching workflows, for each workflow:
// 1. Count nodes: SELECT COUNT(*) FROM workflowNodes WHERE workflowId = w.id
// 2. Get last run: SELECT status, completedAt FROM workflowRuns WHERE workflowId = w.id ORDER BY startedAt DESC LIMIT 1
// 3. Get schedule: SELECT type FROM workflowSchedules WHERE workflowId = w.id LIMIT 1
// Add these as extra fields on each workflow object in the response
```

Use Drizzle's `count()` aggregation and batch the queries. Return enriched objects with `nodeCount`, `lastRun: { status, completedAt } | null`, `triggerType: 'manual' | 'cron' | 'event' | 'webhook' | null`.

- [ ] **Step 2.3: Update the list page cards**

In the workflow list page component, display:
- **Trigger badge:** A small pill showing `cron`, `event`, `webhook`, or `manual` using matching colors from `TriggerConfigModal` presets.
- **Last run status:** Status dot + relative time (e.g., "2h ago") using `Intl.RelativeTimeFormat`.
- **Node count:** Small `N nodes` label in ghost text.

---

## Task 3: Canvas Node Type Coverage

The `Canvas.svelte` component only maps 3 node types to custom components. Add all remaining node types so they render correctly instead of falling back to a default.

**Files:**
- Modify: `src/lib/components/workflows/Canvas.svelte`

- [ ] **Step 3.1: Import all node components and expand nodeTypes map**

In `src/lib/components/workflows/Canvas.svelte`, add imports for all node components and expand the `nodeTypes` object:

```svelte
<script lang="ts">
  // Existing imports:
  import ManualTriggerNode from './nodes/ManualTriggerNode.svelte';
  import CodeExecuteNode from './nodes/CodeExecuteNode.svelte';
  import TransformNode from './nodes/TransformNode.svelte';

  // Add:
  import HttpRequestNode from './nodes/HttpRequestNode.svelte';
  import LlmCallNode from './nodes/LlmCallNode.svelte';
  import ConditionalNode from './nodes/ConditionalNode.svelte';
  import LoopNode from './nodes/LoopNode.svelte';
  import DelayNode from './nodes/DelayNode.svelte';
  import ErrorHandlerNode from './nodes/ErrorHandlerNode.svelte';
  import DataStoreNode from './nodes/DataStoreNode.svelte';
  import EmailNode from './nodes/EmailNode.svelte';
  import StravaNode from './nodes/StravaNode.svelte';
  import WhoopNode from './nodes/WhoopNode.svelte';
  import OpenRouterNode from './nodes/OpenRouterNode.svelte';
</script>
```

Update the `nodeTypes` constant:

```typescript
const nodeTypes = {
  'manual-trigger': ManualTriggerNode,
  'code-execute': CodeExecuteNode,
  'transform': TransformNode,
  'http-request': HttpRequestNode,
  'llm-call': LlmCallNode,
  'conditional': ConditionalNode,
  'loop': LoopNode,
  'delay': DelayNode,
  'error-handler': ErrorHandlerNode,
  'data-store': DataStoreNode,
  'email': EmailNode,
  'strava': StravaNode,
  'whoop': WhoopNode,
  'openrouter': OpenRouterNode,
};
```

**Note:** `StravaNode`, `WhoopNode`, and `OpenRouterNode` are created in Phase 5. If Phase 5 is not yet complete, omit those three entries until then.

---

## Task 4: Mobile Long-Press on Nodes

Double-click opens the node inspector on desktop, but doesn't work on mobile. Add a 300ms long-press handler on nodes.

**Files:**
- Modify: `src/lib/components/workflows/Canvas.svelte`

- [ ] **Step 4.1: Add long-press detection**

In `src/lib/components/workflows/Canvas.svelte`, add long-press tracking state and a `handleNodePointerDown` handler. Long-press fires `onNodeDoubleClick` after 300ms if the pointer hasn't moved:

```typescript
let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressNodeId: string | null = null;

function handleNodePointerDown({ node, event }: { node: CanvasNode; event: PointerEvent | MouseEvent | TouchEvent }) {
  longPressNodeId = node.id;
  longPressTimer = setTimeout(() => {
    if (longPressNodeId === node.id) {
      onNodeDoubleClick?.(node.id);
    }
    longPressNodeId = null;
  }, 300);
}

function handleNodePointerUp() {
  if (longPressTimer) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressNodeId = null;
}
```

In the `<SvelteFlow>` component, add:
```svelte
onnodepointerdown={handleNodePointerDown}
onnodepointerup={handleNodePointerUp}
```

This runs in parallel with the existing double-click detection (the 300ms timer will fire before the double-click window on mobile, while being cancelled quickly enough on desktop that it doesn't interfere with normal single-clicks).

---

## Task 5: Error Handler Node Component

The Error Handler executor was added in Phase 4 but may not have a Svelte component. Verify and create if missing.

**Files:**
- Verify: `src/lib/components/workflows/nodes/ErrorHandlerNode.svelte`
- Create if missing

- [ ] **Step 5.1: Check if ErrorHandlerNode.svelte exists**

```bash
ls src/lib/components/workflows/nodes/ErrorHandlerNode.svelte
```

If it exists and has content, skip to Step 5.3. If missing, proceed.

- [ ] **Step 5.2: Create ErrorHandlerNode.svelte**

The Error Handler has two output handles: `success` and `error`. It wraps a subgraph and routes to different branches depending on whether an error occurred.

Create `src/lib/components/workflows/nodes/ErrorHandlerNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let { data } = $props();

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#569cd6',
    completed: '#2d7d46',
    failed: '#b43232',
    paused_breakpoint: '#b8860b',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(
    data.status ? STATUS_COLORS[data.status] ?? 'var(--card-border)' : 'var(--card-border)'
  );
  let isRunning = $derived(data.status === 'running');

  const maxRetries = data.config?.maxRetries ?? 0;
</script>

<div
  class="rounded-lg border-2 min-w-[160px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  <!-- Single input handle -->
  <Handle type="target" position={Position.Left} id="input" style="top: 30px;" />

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      <span class="text-sm">🛡️</span>
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        error-handler
      </span>
      {#if data.status}
        <span class="w-2 h-2 rounded-full ml-auto" style="background: {borderColor};"></span>
      {/if}
    </div>
    <div class="text-sm font-medium" style="color: var(--text-primary);">{data.label}</div>
    {#if maxRetries > 0}
      <div class="text-[10px] mt-1" style="color: var(--text-ghost);">
        Retries: {maxRetries}
      </div>
    {/if}
  </div>

  <!-- Two output handles: success (top-right) and error (bottom-right) -->
  <Handle
    type="source"
    position={Position.Right}
    id="success"
    style="top: 25px;"
  />
  <Handle
    type="source"
    position={Position.Right}
    id="error"
    style="top: 50px;"
  />

  <!-- Output labels -->
  <div class="absolute right-4 flex flex-col gap-[14px]" style="top: 18px;">
    <span class="text-[9px]" style="color: #2d7d46;">success</span>
    <span class="text-[9px]" style="color: #b43232;">error</span>
  </div>
</div>
```

- [ ] **Step 5.3: Verify error-handler executor exists and has two output handles**

Check `src/lib/workflows/nodes/error-handler.ts` (or wherever the Phase 4 implementation lives):

```bash
ls src/lib/workflows/nodes/
```

If `error-handler.ts` exists, verify it's registered in `src/lib/workflows/index.ts` with both `errorHandlerDef` and `errorHandlerExecutor`. If the executor is missing outputs `success` and `error` in its definition, update the `outputs` field:

```typescript
outputs: [
  { name: 'success', type: 'any', label: 'Success' },
  { name: 'error', type: 'object', label: 'Error' },
],
```

Also ensure the executor sets `metadata._selectedHandle` to either `'success'` or `'error'` so the engine's conditional routing picks the right branch (same pattern as `conditional.ts`).

- [ ] **Step 5.4: Add ErrorHandlerNode to Canvas nodeTypes**

This is covered by Task 3. If Task 3 was done first, `ErrorHandlerNode` is already in the `nodeTypes` map. If Task 5 runs first, add it manually then let Task 3 reconcile.
