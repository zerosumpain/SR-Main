# Workflow Engine Phase 3: Data Inspection + Breakpoints

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the breakpoint system, add a Node Inspector panel with config/schema/data tabs, edge data inspection, and improved run visualisation animations.

**Architecture:** The engine already has `breakpointResolvers` Map and `checkBreakpoint` on `ExecutionContext`. This phase wires up the server-side continue endpoint to those resolvers, adds a `NodeInspector` Svelte component that replaces the ChatPanel when a node is double-clicked, and adds DB capture of `inputData` during execution (not just `outputData`).

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Drizzle ORM, SSE, `@xyflow/svelte`.

**Design spec:** `docs/superpowers/specs/2026-04-12-workflow-engine-design.md` — Section 6 (Canvas UI: Node Inspector), Section 3 (Breakpoints).

**Depends on:** Phase 2 (completed) — orchestrator, chat panel, all existing API routes exist.

---

## File Structure

```
src/routes/api/workflows/[id]/
├── breakpoints/+server.ts            # PUT — set/clear breakpoints on a run
└── runs/[runId]/
    ├── continue/+server.ts           # POST — resume a paused run
    └── nodes/[nodeId]/+server.ts     # GET — full input/output data for a node

src/lib/workflows/
└── engine.ts                         # Modify: capture inputData, expose breakpointResolvers

src/lib/components/workflows/
├── NodeInspector.svelte              # Right sidebar inspector (3 tabs)
├── NodeInspectorConfig.svelte        # Config tab — form fields driven by configSchema
├── NodeInspectorSchema.svelte        # Schema tab — read-only input/output schemas
├── NodeInspectorData.svelte          # Data tab — expandable JSON tree
└── JsonTree.svelte                   # Reusable recursive JSON tree component

src/routes/workflows/[id]/+page.svelte  # Modify: toggle inspector/chat in right sidebar

tests/lib/workflows/
└── engine-breakpoint.test.ts         # Breakpoint pause/resume tests
```

---

### Task 1: Capture inputData in engine + DB update

The engine currently only captures `outputData` in `run/+server.ts`. The `inputData` for each node (the `mergedInput` built just before execution) also needs to be persisted. This is step 1 because the Data tab in the inspector depends on it.

**Files:**
- Modify: `src/lib/workflows/engine.ts`
- Modify: `src/routes/api/workflows/[id]/run/+server.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/engine-breakpoint.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import type { WorkflowDefinition, WorkflowEvent } from '$lib/workflows/types';

function makeEngine() {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  return new WorkflowEngine(registry);
}

describe('engine inputData capture', () => {
  it('returns inputData for each node in result', async () => {
    const engine = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'transform', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { doubled: input.value * 2 }' }, label: 'Double' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'transform' }],
    };

    const result = await engine.execute(workflow, 'run-bp-1', { value: 5 });

    expect(result.nodeInputs).toBeDefined();
    expect(result.nodeInputs.get('transform')).toEqual({ value: 5 });
  });
});

describe('engine breakpoints', () => {
  it('pauses at a breakpointed node and resumes when resolver is called', async () => {
    const engine = makeEngine();
    const events: WorkflowEvent[] = [];
    engine.onEvent('run-bp-2', (e) => events.push(e));

    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'transform', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { doubled: input.value * 2 }' }, label: 'Double' },
      ],
      edges: [{ id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'transform' }],
    };

    const breakpoints = new Set(['transform']);
    const executePromise = engine.execute(workflow, 'run-bp-2', { value: 5 }, breakpoints);

    // Wait for breakpoint_hit event
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'breakpoint_hit' && e.nodeId === 'transform')).toBe(true);
    }, { timeout: 2000 });

    // Resume — provide modified input data
    engine.resumeBreakpoint('run-bp-2', 'transform', { value: 10 });

    const result = await executePromise;
    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('transform')).toEqual({ doubled: 20 });
  });

  it('getBreakpointResolver returns undefined for non-paused node', () => {
    const engine = makeEngine();
    expect(engine.getBreakpointResolver('nonexistent-run', 'nonexistent-node')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/engine-breakpoint.test.ts
```

Expected: FAIL — `result.nodeInputs` undefined, `engine.resumeBreakpoint` not found.

- [ ] **Step 3: Modify engine.ts**

Add `nodeInputs` to `EngineResult`, capture `mergedInput` before execution, expose `resumeBreakpoint` and `getBreakpointResolver` methods. The breakpoint resolver map needs to be keyed by `runId:nodeId` so multiple concurrent runs don't collide. When `resumeBreakpoint` is called with modified data, the modified data replaces `mergedInput` for that node's execution.

Key changes to `src/lib/workflows/engine.ts`:

```typescript
// Add to EngineResult interface:
nodeInputs: Map<string, Record<string, unknown>>;

// Add instance-level map for resolvers (keyed by `${runId}:${nodeId}`):
private breakpointResolvers = new Map<string, (modifiedInput?: Record<string, unknown>) => void>();

// Add public methods:
resumeBreakpoint(runId: string, nodeId: string, modifiedInput?: Record<string, unknown>): void {
  const key = `${runId}:${nodeId}`;
  const resolver = this.breakpointResolvers.get(key);
  if (resolver) {
    resolver(modifiedInput);
    this.breakpointResolvers.delete(key);
  }
}

getBreakpointResolver(runId: string, nodeId: string): ((data?: Record<string, unknown>) => void) | undefined {
  return this.breakpointResolvers.get(`${runId}:${nodeId}`);
}
```

Inside `execute`, the breakpoint pause block becomes:

```typescript
if (breakpoints?.has(nodeId)) {
  emit('breakpoint_hit', nodeId, mergedInput);
  emit('node_paused', nodeId);
  mergedInput = await new Promise<Record<string, unknown>>((resolve) => {
    const key = `${runId}:${nodeId}`;
    this.breakpointResolvers.set(key, (modifiedInput) => resolve(modifiedInput ?? mergedInput));
  });
}
```

Also add a `nodeInputs` Map that gets populated with `mergedInput` before execution:

```typescript
nodeInputs.set(nodeId, { ...mergedInput });
```

Return `nodeInputs` in the `EngineResult`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/engine-breakpoint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update run/+server.ts to persist inputData**

In the `.then()` callback of `engine.execute()`, also update `nodeExecutions` with `inputData` from `result.nodeInputs`:

```typescript
for (const [nodeId, inputData] of result.nodeInputs) {
  await db.update(nodeExecutions).set({
    inputData,
    startedAt: new Date(), // approximate — set when we know it ran
  }).where(eq(nodeExecutions.nodeId, nodeId));
}
```

Combine this with the existing completed/failed updates so it's one pass per node.

Also update `nodeExecutions` status to `running` immediately when `node_started` events fire — listen via `engine.onEvent` in the run handler and update the DB row in real-time. This makes the Data tab accurate mid-run.

---

### Task 2: Breakpoints API endpoint

**Files:**
- Create: `src/routes/api/workflows/[id]/breakpoints/+server.ts`

- [ ] **Step 1: Write the failing test** (manual — test via curl after implementation)

No unit test needed for this route; it's a thin adapter. Verify manually.

- [ ] **Step 2: Create the endpoint**

`PUT /api/workflows/[id]/breakpoints` — body: `{ runId: string, nodeIds: string[] }`.

The engine singleton holds breakpoint state per-run. The endpoint calls a new `engine.setBreakpoints(runId, nodeIds)` method that replaces the breakpoint set for that run.

Create `src/routes/api/workflows/[id]/breakpoints/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engine } from '$lib/workflows';

export const PUT: RequestHandler = async ({ request }) => {
  const { runId, nodeIds } = await request.json();
  if (!runId || !Array.isArray(nodeIds)) {
    return json({ error: 'runId and nodeIds required' }, { status: 400 });
  }
  engine.setBreakpoints(runId, new Set(nodeIds));
  return json({ ok: true });
};
```

Add `setBreakpoints(runId: string, nodes: Set<string>): void` to `WorkflowEngine`:

```typescript
private activeBreakpoints = new Map<string, Set<string>>();

setBreakpoints(runId: string, nodes: Set<string>): void {
  this.activeBreakpoints.set(runId, nodes);
}
```

In `execute`, use `this.activeBreakpoints.get(runId)` merged with the `breakpoints` parameter passed directly (for backward compatibility). Clean up `activeBreakpoints` entry after run completes.

---

### Task 3: Continue-from-breakpoint API endpoint

**Files:**
- Create: `src/routes/api/workflows/[id]/runs/[runId]/continue/+server.ts`

- [ ] **Step 1: Create the endpoint**

`POST /api/workflows/[id]/runs/[runId]/continue` — body: `{ nodeId: string, modifiedInput?: Record<string, unknown> }`.

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { engine } from '$lib/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const { nodeId, modifiedInput } = await request.json();
  if (!nodeId) {
    return json({ error: 'nodeId required' }, { status: 400 });
  }

  const resolver = engine.getBreakpointResolver(params.runId, nodeId);
  if (!resolver) {
    return json({ error: 'No breakpoint found for this node in this run' }, { status: 404 });
  }

  engine.resumeBreakpoint(params.runId, nodeId, modifiedInput);
  return json({ ok: true });
};
```

- [ ] **Step 2: Verify it works end-to-end**

Start a run with a breakpoint set via the UI, call continue via curl with modified data, verify the run resumes and the modified data appears in the next node's input.

---

### Task 4: Node data fetch endpoint

**Files:**
- Create: `src/routes/api/workflows/[id]/runs/[runId]/nodes/[nodeId]/+server.ts`

- [ ] **Step 1: Create the endpoint**

`GET /api/workflows/[id]/runs/[runId]/nodes/[nodeId]` — returns full `inputData` and `outputData` for a node execution.

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { nodeExecutions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [execution] = await db
    .select()
    .from(nodeExecutions)
    .where(
      and(
        eq(nodeExecutions.runId, params.runId),
        eq(nodeExecutions.nodeId, params.nodeId),
      ),
    );

  if (!execution) {
    return json({ error: 'Node execution not found' }, { status: 404 });
  }

  return json({
    nodeId: params.nodeId,
    status: execution.status,
    inputData: execution.inputData,
    outputData: execution.outputData,
    logs: execution.logs,
    error: execution.error,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  });
};
```

---

### Task 5: JsonTree Svelte component

This is a dependency of the Node Inspector's Data tab and the Edge inspector.

**Files:**
- Create: `src/lib/components/workflows/JsonTree.svelte`

- [ ] **Step 1: Create JsonTree.svelte**

A recursive, collapsible JSON tree. Rules:
- Objects and arrays are collapsible (default: expanded up to depth 2, collapsed beyond)
- Primitive values render inline with type-coloured text (string=green, number=blue, boolean=orange, null=grey)
- Arrays show index badges: `[0]`, `[1]`
- Objects show key names
- A "copy" button on hover copies the subtree as JSON to clipboard
- "Show full" toggle for string values over 200 chars (truncate by default)

Props: `value: unknown`, `depth?: number` (default 0), `maxAutoExpand?: number` (default 2).

Use CSS custom properties from the existing design system (`--text-primary`, `--text-ghost`, `--card-border`, `--font-mono`).

No test needed — visual component, verified manually.

---

### Task 6: NodeInspector Svelte component

**Files:**
- Create: `src/lib/components/workflows/NodeInspector.svelte`
- Create: `src/lib/components/workflows/NodeInspectorConfig.svelte`
- Create: `src/lib/components/workflows/NodeInspectorSchema.svelte`
- Create: `src/lib/components/workflows/NodeInspectorData.svelte`

- [ ] **Step 1: Create NodeInspectorConfig.svelte**

Config tab — renders form fields from the node's `configSchema`. For each property in `configSchema.properties`:
- `string` type with `description` containing "language" or enum values → `<select>`
- Long `string` type (code, expression, prompt fields detected by name containing "code", "expression", "prompt", "body") → `<textarea rows=8>`
- Other `string` → `<input type="text">`
- `number` → `<input type="number">`
- `boolean` → `<input type="checkbox">`

Props: `config: Record<string, unknown>`, `configSchema: JsonSchema`, `onConfigChange: (key: string, value: unknown) => void`.

- [ ] **Step 2: Create NodeInspectorSchema.svelte**

Schema tab — shows two sections: "Input Schema" and "Output Schema", both as read-only JSON rendered via `JsonTree`. Uses `getDefinition(nodeType)` from `registry-client.ts` to get the definition, then calls `executor.getInputSchema(config)` / `executor.getOutputSchema(config)` — but since executors aren't available client-side, the schemas come from a new API endpoint.

Add `GET /api/workflows/[id]/nodes/[nodeId]/schema` that returns `{ inputSchema, outputSchema }` by loading the executor server-side. The component fetches this on mount.

Props: `workflowId: string`, `nodeId: string`, `nodeType: string`, `config: Record<string, unknown>`.

- [ ] **Step 3: Create NodeInspectorData.svelte**

Data tab — shows `inputData` and `outputData` from the most recent run, using `JsonTree`. Shows a "No data yet" empty state if not run. Fetches from `GET /api/workflows/[id]/runs/[runId]/nodes/[nodeId]`.

When a breakpoint is hit (determined by `status === 'paused_breakpoint'`), shows an editable JSON textarea for `inputData` and a "Continue with this input" button that calls `POST /api/workflows/[id]/runs/[runId]/continue`.

Props: `workflowId: string`, `nodeId: string`, `runId: string | null`, `status: string | null`.

- [ ] **Step 4: Create NodeInspector.svelte**

Main inspector panel. Three-tab layout using a tab strip. Includes a header with:
- Node label + type badge
- Breakpoint toggle button (red dot icon — sets/clears breakpoint via `PUT /api/workflows/[id]/breakpoints`)
- "Back to chat" button (close inspector)

Props:
```typescript
{
  workflowId: string;
  runId: string | null;
  node: CanvasNode;
  onClose: () => void;
  onConfigChange: (nodeId: string, key: string, value: unknown) => void;
}
```

Tabs: Config | Schema | Data. Active tab stored in local `$state`.

Import `NodeInspectorConfig`, `NodeInspectorSchema`, `NodeInspectorData` — lazy import if needed to avoid SSR issues (all in browser context so fine).

---

### Task 7: Wire inspector into the editor page

**Files:**
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 1: Add inspector state and imports**

```svelte
let NodeInspector: any = $state(null);
let inspectedNode = $state<CanvasNode | null>(null);
let currentRunId = $state<string | null>(null);

if (browser) {
  // ... existing imports ...
  import('$lib/components/workflows/NodeInspector.svelte').then(m => NodeInspector = m.default);
}
```

- [ ] **Step 2: Update handleNodeDoubleClick**

```svelte
function handleNodeDoubleClick(nodeId: string) {
  const node = nodes.find(n => n.id === nodeId);
  if (node) inspectedNode = node;
}
```

- [ ] **Step 3: Capture runId on run start**

In `handleRun`, capture `result.runId` into `currentRunId = result.runId`.

- [ ] **Step 4: Track runId during SSE**

Already set above; pass `currentRunId` to inspector.

- [ ] **Step 5: Replace right sidebar with conditional render**

```svelte
{#if inspectedNode && NodeInspector}
  <NodeInspector
    {workflowId}
    runId={currentRunId}
    node={inspectedNode}
    onClose={() => inspectedNode = null}
    onConfigChange={handleConfigChange}
  />
{:else if ChatPanel}
  <ChatPanel ... />
{/if}
```

- [ ] **Step 6: Add handleConfigChange**

```svelte
function handleConfigChange(nodeId: string, key: string, value: unknown) {
  nodes = nodes.map(n =>
    n.id === nodeId
      ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
      : n
  );
}
```

- [ ] **Step 7: Handle breakpoint_hit SSE event**

In `connectSSE`, handle the new event to auto-open the inspector:

```svelte
} else if (event.type === 'breakpoint_hit' && event.nodeId) {
  updateNodeStatus(event.nodeId, 'paused_breakpoint');
  const node = nodes.find(n => n.id === event.nodeId);
  if (node) inspectedNode = node;
}
```

---

### Task 8: Edge data inspection

**Files:**
- Modify: `src/lib/components/workflows/Canvas.svelte`
- Create: `src/lib/components/workflows/EdgeInspector.svelte`
- Modify: `src/routes/workflows/[id]/+page.svelte`

- [ ] **Step 1: Create EdgeInspector.svelte**

A smaller panel (not a tab panel — just a popover/sidebar section) showing:
- Source node → Target node label
- Source output schema → Target input schema (call schema endpoint for both)
- If a run has completed: actual data that flowed (fetch `outputData` from the source node's execution)
- If schemas are incompatible: a red "Type mismatch" badge

Props: `workflowId: string`, `runId: string | null`, `edge: CanvasEdge`, `nodes: CanvasNode[]`, `onClose: () => void`.

- [ ] **Step 2: Wire into +page.svelte**

Add `inspectedEdge` state. Update `handleEdgeClick` to set it. Render `EdgeInspector` in the right sidebar when an edge is selected (priority: edge > node > chat).

---

### Task 9: Run visualisation improvements

**Files:**
- Modify: `src/lib/components/workflows/nodes/BaseNode.svelte`
- Modify: `src/lib/components/workflows/Canvas.svelte` (edge animation)

- [ ] **Step 1: Improve node status animations in BaseNode.svelte**

Current: only `animate-pulse` for running. New behaviour:
- `pending` → grey border, no animation
- `running` → blue border + pulse animation + spinning indicator icon (a small spinner SVG or CSS border spin)
- `completed` → green border + checkmark icon — fade in, stays 3s then fades to solid green border
- `failed` → red border + X icon
- `paused_breakpoint` → amber/yellow border + pause icon + gentle pulse

Add a breakpoint indicator: if `hasBreakpoint` prop is true, show a red dot in the top-right corner of the node.

New props added: `hasBreakpoint?: boolean`.

- [ ] **Step 2: Add edge flow animation**

In Canvas.svelte, use Svelte Flow's `<SvelteFlowProvider>` edge options to apply a CSS class for "flowing" edges during a run. Svelte Flow supports custom edge components — add an `AnimatedEdge` type that uses CSS `stroke-dashoffset` animation to show flowing dots when `isRunning` is true.

Pass `isRunning` (derived from `runStatus === 'running'`) to the canvas and apply it to all edges.

---

### Test Command

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run tests/lib/workflows/engine-breakpoint.test.ts
```

For all tests:

```bash
cd ~/strange_rambling_svelte/.worktrees/workflow-engine && npx vitest run
```

---

## Task Order (Sequential — each depends on the previous)

1. Task 1 — inputData capture in engine (foundation for Data tab)
2. Task 2 — breakpoints API endpoint (depends on engine changes)
3. Task 3 — continue endpoint (depends on engine's `resumeBreakpoint`)
4. Task 4 — node data fetch endpoint (depends on `inputData` being captured)
5. Task 5 — JsonTree component (dependency of inspector tabs)
6. Task 6 — NodeInspector components (depends on JsonTree + endpoints from tasks 2–4)
7. Task 7 — Wire inspector into editor page (depends on NodeInspector component)
8. Task 8 — Edge inspection (depends on inspector being wired in)
9. Task 9 — Run visualisation improvements (independent, but do last to avoid noise during debugging)
