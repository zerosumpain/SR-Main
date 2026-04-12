# Workflow Engine Phase 1: Core Engine + Canvas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the workflow engine runtime, node registry with 3 starter nodes, Svelte Flow canvas with custom node rendering, and manual workflow execution with save/load.

**Architecture:** Engine Core + Thin Canvas Adapter. The workflow engine (`src/lib/workflows/`) defines types, graph execution, and node registry — it knows nothing about Svelte Flow. The canvas adapter (`src/lib/components/workflows/`) syncs between engine and Svelte Flow models. API routes handle persistence and execution.

**Tech Stack:** SvelteKit 2, Svelte 5 (runes), Svelte Flow, Drizzle ORM (PostgreSQL), TypeScript, Vitest, existing JKAI sandbox.

**Design spec:** `docs/superpowers/specs/2026-04-12-workflow-engine-design.md`

---

## File Structure

```
src/lib/workflows/
├── types.ts                    # All workflow type definitions
├── events.ts                   # WorkflowEvent emitter (per-run)
├── registry.ts                 # Node registry (register, lookup, list)
├── graph.ts                    # DAG builder + topological sort
├── engine.ts                   # Execution runtime
├── nodes/
│   ├── manual-trigger.ts       # Manual trigger node executor
│   ├── code-execute.ts         # Code execution node (sandbox)
│   └── transform.ts            # In-process JS transform node

src/lib/components/workflows/
├── Canvas.svelte               # Main Svelte Flow canvas wrapper
├── NodePalette.svelte          # Left sidebar node list
├── WorkflowToolbar.svelte      # Top toolbar (run/save)
├── nodes/
│   ├── BaseNode.svelte         # Shared node chrome (label, ports, status)
│   ├── ManualTriggerNode.svelte
│   ├── CodeExecuteNode.svelte
│   └── TransformNode.svelte
├── adapter.ts                  # Engine model ↔ Svelte Flow model sync

src/routes/workflows/
├── +page.server.ts             # Load workflow list
├── +page.svelte                # Workflow list view
├── [id]/
│   ├── +page.server.ts         # Load single workflow
│   └── +page.svelte            # Canvas editor
├── new/
│   └── +page.svelte            # New workflow (empty canvas)

src/routes/api/workflows/
├── +server.ts                  # GET list, POST create
├── [id]/
│   ├── +server.ts              # GET detail, PUT update, DELETE
│   ├── run/+server.ts          # POST start run
│   └── runs/
│       ├── +server.ts          # GET run list
│       └── [runId]/
│           ├── +server.ts      # GET run detail
│           └── stream/+server.ts  # SSE live events

tests/lib/workflows/
├── types.test.ts
├── graph.test.ts
├── engine.test.ts
├── registry.test.ts
├── nodes/
│   ├── manual-trigger.test.ts
│   ├── code-execute.test.ts
│   └── transform.test.ts
```

---

### Task 1: Install Svelte Flow

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install @xyflow/svelte**

```bash
cd ~/strange_rambling_svelte && npm install @xyflow/svelte
```

- [ ] **Step 2: Verify installation**

```bash
cd ~/strange_rambling_svelte && node -e "require.resolve('@xyflow/svelte')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Install croner for future scheduling**

```bash
cd ~/strange_rambling_svelte && npm install croner
```

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add package.json package-lock.json
git commit -m "feat(workflows): install @xyflow/svelte and croner"
```

---

### Task 2: Database Schema

**Files:**
- Modify: `src/lib/db/schema.ts`
- Test: `tests/lib/workflows/types.test.ts`

- [ ] **Step 1: Write schema test**

Create `tests/lib/workflows/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  workflows,
  workflowNodes,
  workflowEdges,
  workflowRuns,
  nodeExecutions,
  workflowSchedules,
  integrations,
} from '$lib/db/schema';

describe('workflow schema', () => {
  it('workflows table has expected columns', () => {
    expect(workflows.id).toBeDefined();
    expect(workflows.name).toBeDefined();
    expect(workflows.description).toBeDefined();
    expect(workflows.trigger).toBeDefined();
    expect(workflows.createdAt).toBeDefined();
    expect(workflows.updatedAt).toBeDefined();
  });

  it('workflowNodes table has expected columns', () => {
    expect(workflowNodes.id).toBeDefined();
    expect(workflowNodes.workflowId).toBeDefined();
    expect(workflowNodes.type).toBeDefined();
    expect(workflowNodes.position).toBeDefined();
    expect(workflowNodes.config).toBeDefined();
    expect(workflowNodes.label).toBeDefined();
  });

  it('workflowEdges table has expected columns', () => {
    expect(workflowEdges.id).toBeDefined();
    expect(workflowEdges.workflowId).toBeDefined();
    expect(workflowEdges.sourceNodeId).toBeDefined();
    expect(workflowEdges.targetNodeId).toBeDefined();
    expect(workflowEdges.sourceHandle).toBeDefined();
    expect(workflowEdges.targetHandle).toBeDefined();
  });

  it('workflowRuns table has expected columns', () => {
    expect(workflowRuns.id).toBeDefined();
    expect(workflowRuns.workflowId).toBeDefined();
    expect(workflowRuns.status).toBeDefined();
    expect(workflowRuns.trigger).toBeDefined();
    expect(workflowRuns.startedAt).toBeDefined();
    expect(workflowRuns.completedAt).toBeDefined();
    expect(workflowRuns.error).toBeDefined();
  });

  it('nodeExecutions table has expected columns', () => {
    expect(nodeExecutions.id).toBeDefined();
    expect(nodeExecutions.runId).toBeDefined();
    expect(nodeExecutions.nodeId).toBeDefined();
    expect(nodeExecutions.status).toBeDefined();
    expect(nodeExecutions.inputData).toBeDefined();
    expect(nodeExecutions.outputData).toBeDefined();
    expect(nodeExecutions.logs).toBeDefined();
  });

  it('workflowSchedules table has expected columns', () => {
    expect(workflowSchedules.id).toBeDefined();
    expect(workflowSchedules.workflowId).toBeDefined();
    expect(workflowSchedules.type).toBeDefined();
    expect(workflowSchedules.config).toBeDefined();
    expect(workflowSchedules.enabled).toBeDefined();
  });

  it('integrations table has expected columns', () => {
    expect(integrations.id).toBeDefined();
    expect(integrations.name).toBeDefined();
    expect(integrations.baseUrl).toBeDefined();
    expect(integrations.authType).toBeDefined();
    expect(integrations.authConfig).toBeDefined();
    expect(integrations.operations).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/types.test.ts
```

Expected: FAIL — imports do not exist yet.

- [ ] **Step 3: Add workflow tables to schema**

Append to the end of `src/lib/db/schema.ts` (before the closing of the file, after the CDO section):

```typescript
// ==========================================
// Workflows — Visual Automation Engine
// ==========================================

export const workflows = pgTable('workflows', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  description: text('description'),
  trigger: jsonb('trigger').default(sql`'{"type":"manual"}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Workflow = typeof workflows.$inferSelect;
export type NewWorkflow = typeof workflows.$inferInsert;

export const workflowNodes = pgTable('workflow_nodes', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  position: jsonb('position').notNull().default(sql`'{"x":0,"y":0}'::jsonb`),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  label: text('label').notNull(),
});

export type WorkflowNode = typeof workflowNodes.$inferSelect;
export type NewWorkflowNode = typeof workflowNodes.$inferInsert;

export const workflowEdges = pgTable('workflow_edges', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  sourceNodeId: text('source_node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  targetNodeId: text('target_node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  sourceHandle: text('source_handle'),
  targetHandle: text('target_handle'),
});

export type WorkflowEdge = typeof workflowEdges.$inferSelect;
export type NewWorkflowEdge = typeof workflowEdges.$inferInsert;

export const workflowRuns = pgTable('workflow_runs', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id),
  status: text('status').notNull().default('pending'),
  trigger: text('trigger').notNull().default('manual'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
});

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;

export const nodeExecutions = pgTable('node_executions', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  runId: text('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  nodeId: text('node_id').notNull().references(() => workflowNodes.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('pending'),
  inputData: jsonb('input_data'),
  outputData: jsonb('output_data'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  logs: jsonb('logs').default(sql`'[]'::jsonb`),
});

export type NodeExecution = typeof nodeExecutions.$inferSelect;
export type NewNodeExecution = typeof nodeExecutions.$inferInsert;

export const workflowSchedules = pgTable('workflow_schedules', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  workflowId: text('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
});

export type WorkflowSchedule = typeof workflowSchedules.$inferSelect;
export type NewWorkflowSchedule = typeof workflowSchedules.$inferInsert;

export const integrations = pgTable('integrations', {
  id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
  name: text('name').notNull(),
  description: text('description'),
  baseUrl: text('base_url'),
  authType: text('auth_type').notNull().default('none'),
  authConfig: jsonb('auth_config').default(sql`'{}'::jsonb`),
  operations: jsonb('operations').notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/types.test.ts
```

Expected: PASS — all 7 tests green.

- [ ] **Step 5: Push schema to database**

```bash
cd ~/strange_rambling_svelte && npx drizzle-kit push
```

Expected: Tables created in PostgreSQL.

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/db/schema.ts tests/lib/workflows/types.test.ts
git commit -m "feat(workflows): add workflow database schema tables"
```

---

### Task 3: Workflow Types

**Files:**
- Create: `src/lib/workflows/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/lib/workflows/types.ts`:

```typescript
export interface Position {
  x: number;
  y: number;
}

export interface PortDefinition {
  name: string;
  type: 'any' | 'string' | 'number' | 'boolean' | 'object' | 'array';
  label?: string;
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

export interface NodeDefinition {
  type: string;
  label: string;
  category: 'trigger' | 'core' | 'integration' | 'control' | 'custom';
  description: string;
  configSchema: JsonSchema;
  defaultConfig: Record<string, unknown>;
  inputs: PortDefinition[];
  outputs: PortDefinition[];
}

export interface NodeResult {
  output: Record<string, unknown>;
  logs?: string[];
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  runId: string;
  workspaceDir: string;
  emit: (event: WorkflowEvent) => void;
  getNodeOutput: (nodeId: string) => Record<string, unknown> | undefined;
  checkBreakpoint: () => Promise<void>;
  abortSignal: AbortSignal;
}

export interface NodeExecutor {
  type: string;
  execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult>;
  getInputSchema(config: Record<string, unknown>): JsonSchema;
  getOutputSchema(config: Record<string, unknown>): JsonSchema;
}

export type WorkflowEventType =
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'node_paused'
  | 'breakpoint_hit'
  | 'log';

export interface WorkflowEvent {
  type: WorkflowEventType;
  runId: string;
  nodeId?: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

export type RunStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type NodeExecutionStatus = 'pending' | 'running' | 'paused_breakpoint' | 'completed' | 'failed' | 'skipped';

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
}

export interface WorkflowNodeDef {
  id: string;
  type: string;
  position: Position;
  config: Record<string, unknown>;
  label: string;
}

export interface WorkflowEdgeDef {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
```

- [ ] **Step 2: Verify file compiles**

```bash
cd ~/strange_rambling_svelte && npx tsc --noEmit src/lib/workflows/types.ts 2>&1 || npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | head -20
```

Expected: No errors related to `src/lib/workflows/types.ts`.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/types.ts
git commit -m "feat(workflows): add core type definitions"
```

---

### Task 4: Workflow Event Emitter

**Files:**
- Create: `src/lib/workflows/events.ts`

- [ ] **Step 1: Create the events module**

Create `src/lib/workflows/events.ts`:

```typescript
import { EventEmitter } from 'events';
import type { WorkflowEvent } from './types';

const runEmitters = new Map<string, EventEmitter>();

export function getRunEmitter(runId: string): EventEmitter {
  let emitter = runEmitters.get(runId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    runEmitters.set(runId, emitter);
  }
  return emitter;
}

export function emitWorkflowEvent(event: WorkflowEvent): void {
  const emitter = runEmitters.get(event.runId);
  if (emitter) {
    emitter.emit('workflow', event);
  }
}

export function onWorkflowEvent(
  runId: string,
  handler: (event: WorkflowEvent) => void,
): () => void {
  const emitter = getRunEmitter(runId);
  emitter.on('workflow', handler);
  return () => {
    emitter.off('workflow', handler);
    if (emitter.listenerCount('workflow') === 0) {
      runEmitters.delete(runId);
    }
  };
}

export function cleanupRunEmitter(runId: string): void {
  const emitter = runEmitters.get(runId);
  if (emitter) {
    emitter.removeAllListeners();
    runEmitters.delete(runId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/events.ts
git commit -m "feat(workflows): add per-run event emitter"
```

---

### Task 5: Graph Builder + Topological Sort

**Files:**
- Create: `src/lib/workflows/graph.ts`
- Test: `tests/lib/workflows/graph.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/graph.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildGraph, topologicalSort } from '$lib/workflows/graph';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

function makeNode(id: string, type = 'transform'): WorkflowNodeDef {
  return { id, type, position: { x: 0, y: 0 }, config: {}, label: id };
}

function makeEdge(source: string, target: string): WorkflowEdgeDef {
  return { id: `${source}-${target}`, sourceNodeId: source, targetNodeId: target };
}

describe('buildGraph', () => {
  it('creates adjacency list from nodes and edges', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const graph = buildGraph(nodes, edges);

    expect(graph.adjacency.get('a')).toEqual(['b']);
    expect(graph.adjacency.get('b')).toEqual(['c']);
    expect(graph.adjacency.get('c')).toEqual([]);
  });

  it('tracks incoming edges per node', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'c'), makeEdge('b', 'c')];
    const graph = buildGraph(nodes, edges);

    expect(graph.incomingCount.get('a')).toBe(0);
    expect(graph.incomingCount.get('b')).toBe(0);
    expect(graph.incomingCount.get('c')).toBe(2);
  });

  it('indexes edges by source node', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b')];
    const graph = buildGraph(nodes, edges);

    expect(graph.edgesBySource.get('a')?.[0].targetNodeId).toBe('b');
  });
});

describe('topologicalSort', () => {
  it('returns nodes in dependency order', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const graph = buildGraph(nodes, edges);
    const sorted = topologicalSort(graph);

    expect(sorted).toEqual([['a'], ['b'], ['c']]);
  });

  it('groups parallel nodes in the same level', () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
    const edges = [makeEdge('a', 'b'), makeEdge('a', 'c'), makeEdge('b', 'd'), makeEdge('c', 'd')];
    const graph = buildGraph(nodes, edges);
    const sorted = topologicalSort(graph);

    expect(sorted[0]).toEqual(['a']);
    expect(sorted[1].sort()).toEqual(['b', 'c']);
    expect(sorted[2]).toEqual(['d']);
  });

  it('handles single node with no edges', () => {
    const nodes = [makeNode('a')];
    const graph = buildGraph(nodes, []);
    const sorted = topologicalSort(graph);

    expect(sorted).toEqual([['a']]);
  });

  it('throws on cycle', () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'a')];
    const graph = buildGraph(nodes, edges);

    expect(() => topologicalSort(graph)).toThrow('cycle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/graph.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement graph module**

Create `src/lib/workflows/graph.ts`:

```typescript
import type { WorkflowNodeDef, WorkflowEdgeDef } from './types';

export interface WorkflowGraph {
  nodeIds: string[];
  adjacency: Map<string, string[]>;
  incomingCount: Map<string, number>;
  edgesBySource: Map<string, WorkflowEdgeDef[]>;
  edgesByTarget: Map<string, WorkflowEdgeDef[]>;
  nodeMap: Map<string, WorkflowNodeDef>;
}

export function buildGraph(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
): WorkflowGraph {
  const nodeIds = nodes.map((n) => n.id);
  const adjacency = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const edgesBySource = new Map<string, WorkflowEdgeDef[]>();
  const edgesByTarget = new Map<string, WorkflowEdgeDef[]>();
  const nodeMap = new Map<string, WorkflowNodeDef>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    incomingCount.set(node.id, 0);
    edgesBySource.set(node.id, []);
    edgesByTarget.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    incomingCount.set(
      edge.targetNodeId,
      (incomingCount.get(edge.targetNodeId) ?? 0) + 1,
    );
    edgesBySource.get(edge.sourceNodeId)!.push(edge);
    edgesByTarget.get(edge.targetNodeId)!.push(edge);
  }

  return { nodeIds, adjacency, incomingCount, edgesBySource, edgesByTarget, nodeMap };
}

export function topologicalSort(graph: WorkflowGraph): string[][] {
  const inDegree = new Map(graph.incomingCount);
  const levels: string[][] = [];
  let remaining = graph.nodeIds.length;

  while (remaining > 0) {
    const level: string[] = [];
    for (const id of graph.nodeIds) {
      if (inDegree.get(id) === 0) {
        level.push(id);
      }
    }

    if (level.length === 0) {
      throw new Error('Workflow graph contains a cycle');
    }

    for (const id of level) {
      inDegree.set(id, -1); // mark processed
      for (const neighbour of graph.adjacency.get(id)!) {
        inDegree.set(neighbour, inDegree.get(neighbour)! - 1);
      }
    }

    levels.push(level);
    remaining -= level.length;
  }

  return levels;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/graph.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/graph.ts tests/lib/workflows/graph.test.ts
git commit -m "feat(workflows): add DAG builder and topological sort"
```

---

### Task 6: Node Registry

**Files:**
- Create: `src/lib/workflows/registry.ts`
- Test: `tests/lib/workflows/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { NodeRegistry } from '$lib/workflows/registry';
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '$lib/workflows/types';

function makeDummyExecutor(type: string): NodeExecutor {
  return {
    type,
    async execute(): Promise<NodeResult> {
      return { output: {} };
    },
    getInputSchema() {
      return { type: 'object' };
    },
    getOutputSchema() {
      return { type: 'object' };
    },
  };
}

function makeDummyDef(type: string, category: NodeDefinition['category'] = 'core'): NodeDefinition {
  return {
    type,
    label: type,
    category,
    description: `${type} node`,
    configSchema: { type: 'object' },
    defaultConfig: {},
    inputs: [],
    outputs: [{ name: 'output', type: 'any' }],
  };
}

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry();
  });

  it('registers and retrieves a node definition', () => {
    registry.register(makeDummyDef('test'), makeDummyExecutor('test'));
    const def = registry.getDefinition('test');
    expect(def?.type).toBe('test');
  });

  it('retrieves an executor', () => {
    registry.register(makeDummyDef('test'), makeDummyExecutor('test'));
    const executor = registry.getExecutor('test');
    expect(executor?.type).toBe('test');
  });

  it('returns undefined for unknown type', () => {
    expect(registry.getDefinition('nope')).toBeUndefined();
    expect(registry.getExecutor('nope')).toBeUndefined();
  });

  it('lists all definitions', () => {
    registry.register(makeDummyDef('a', 'trigger'), makeDummyExecutor('a'));
    registry.register(makeDummyDef('b', 'core'), makeDummyExecutor('b'));
    const all = registry.listDefinitions();
    expect(all).toHaveLength(2);
  });

  it('lists definitions by category', () => {
    registry.register(makeDummyDef('a', 'trigger'), makeDummyExecutor('a'));
    registry.register(makeDummyDef('b', 'core'), makeDummyExecutor('b'));
    registry.register(makeDummyDef('c', 'core'), makeDummyExecutor('c'));
    const cores = registry.listDefinitions('core');
    expect(cores).toHaveLength(2);
    expect(cores.every((d) => d.category === 'core')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/registry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement registry**

Create `src/lib/workflows/registry.ts`:

```typescript
import type { NodeDefinition, NodeExecutor } from './types';

export class NodeRegistry {
  private definitions = new Map<string, NodeDefinition>();
  private executors = new Map<string, NodeExecutor>();

  register(definition: NodeDefinition, executor: NodeExecutor): void {
    this.definitions.set(definition.type, definition);
    this.executors.set(definition.type, executor);
  }

  getDefinition(type: string): NodeDefinition | undefined {
    return this.definitions.get(type);
  }

  getExecutor(type: string): NodeExecutor | undefined {
    return this.executors.get(type);
  }

  listDefinitions(category?: NodeDefinition['category']): NodeDefinition[] {
    const all = Array.from(this.definitions.values());
    if (category) {
      return all.filter((d) => d.category === category);
    }
    return all;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/registry.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/registry.ts tests/lib/workflows/registry.test.ts
git commit -m "feat(workflows): add node registry"
```

---

### Task 7: Manual Trigger Node

**Files:**
- Create: `src/lib/workflows/nodes/manual-trigger.ts`
- Test: `tests/lib/workflows/nodes/manual-trigger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/nodes/manual-trigger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { manualTriggerExecutor, manualTriggerDef } from '$lib/workflows/nodes/manual-trigger';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('manualTriggerExecutor', () => {
  it('passes through input as output', async () => {
    const result = await manualTriggerExecutor.execute(
      { message: 'hello' },
      {},
      mockContext,
    );
    expect(result.output).toEqual({ message: 'hello' });
  });

  it('returns empty output when no input', async () => {
    const result = await manualTriggerExecutor.execute({}, {}, mockContext);
    expect(result.output).toEqual({});
  });

  it('has correct type', () => {
    expect(manualTriggerExecutor.type).toBe('manual-trigger');
  });
});

describe('manualTriggerDef', () => {
  it('is a trigger category', () => {
    expect(manualTriggerDef.category).toBe('trigger');
  });

  it('has no inputs and one output', () => {
    expect(manualTriggerDef.inputs).toHaveLength(0);
    expect(manualTriggerDef.outputs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/manual-trigger.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement manual trigger node**

Create `src/lib/workflows/nodes/manual-trigger.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const manualTriggerExecutor: NodeExecutor = {
  type: 'manual-trigger',

  async execute(
    input: Record<string, unknown>,
    _config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    return { output: { ...input } };
  },

  getInputSchema() {
    return { type: 'object', description: 'No input — this is the workflow entry point' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      description: 'Passes through any data provided at run start',
    };
  },
};

export const manualTriggerDef: NodeDefinition = {
  type: 'manual-trigger',
  label: 'Manual Trigger',
  category: 'trigger',
  description: 'Starts a workflow manually. Optionally accepts initial data.',
  configSchema: { type: 'object', properties: {} },
  defaultConfig: {},
  inputs: [],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/manual-trigger.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/nodes/manual-trigger.ts tests/lib/workflows/nodes/manual-trigger.test.ts
git commit -m "feat(workflows): add manual trigger node"
```

---

### Task 8: Transform Node

**Files:**
- Create: `src/lib/workflows/nodes/transform.ts`
- Test: `tests/lib/workflows/nodes/transform.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/nodes/transform.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { transformExecutor, transformDef } from '$lib/workflows/nodes/transform';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('transformExecutor', () => {
  it('evaluates a simple expression', async () => {
    const result = await transformExecutor.execute(
      { value: 5 },
      { expression: 'return { doubled: input.value * 2 }' },
      mockContext,
    );
    expect(result.output).toEqual({ doubled: 10 });
  });

  it('has access to full input object', async () => {
    const result = await transformExecutor.execute(
      { items: [1, 2, 3] },
      { expression: 'return { count: input.items.length }' },
      mockContext,
    );
    expect(result.output).toEqual({ count: 3 });
  });

  it('passes through input when no expression', async () => {
    const result = await transformExecutor.execute(
      { a: 1 },
      {},
      mockContext,
    );
    expect(result.output).toEqual({ a: 1 });
  });

  it('returns error info on bad expression', async () => {
    const result = await transformExecutor.execute(
      {},
      { expression: 'throw new Error("boom")' },
      mockContext,
    );
    expect(result.output).toHaveProperty('error');
    expect(result.logs?.[0]).toContain('boom');
  });

  it('has correct type', () => {
    expect(transformExecutor.type).toBe('transform');
  });
});

describe('transformDef', () => {
  it('is a core category', () => {
    expect(transformDef.category).toBe('core');
  });

  it('has one input and one output', () => {
    expect(transformDef.inputs).toHaveLength(1);
    expect(transformDef.outputs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/transform.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement transform node**

Create `src/lib/workflows/nodes/transform.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';

export const transformExecutor: NodeExecutor = {
  type: 'transform',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const expression = config.expression as string | undefined;

    if (!expression) {
      return { output: { ...input } };
    }

    try {
      const fn = new Function('input', expression);
      const result = fn(input);
      const output = result && typeof result === 'object' ? result : { result };
      return { output };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: { error: message },
        logs: [`Transform error: ${message}`],
      };
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Any data from upstream nodes' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    if (!config.expression) {
      return { type: 'object', description: 'Input passed through unchanged' };
    }
    return { type: 'object', description: 'Result of transform expression' };
  },
};

export const transformDef: NodeDefinition = {
  type: 'transform',
  label: 'Transform',
  category: 'core',
  description: 'Reshape data with a JavaScript expression. The input object is available as `input`.',
  configSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: 'JS function body. Use `input` to access upstream data. Must return an object.',
      },
    },
  },
  defaultConfig: { expression: 'return { ...input }' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/transform.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/nodes/transform.ts tests/lib/workflows/nodes/transform.test.ts
git commit -m "feat(workflows): add transform node"
```

---

### Task 9: Code Execute Node

**Files:**
- Create: `src/lib/workflows/nodes/code-execute.ts`
- Test: `tests/lib/workflows/nodes/code-execute.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/nodes/code-execute.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { codeExecuteExecutor, codeExecuteDef } from '$lib/workflows/nodes/code-execute';
import type { ExecutionContext } from '$lib/workflows/types';

// Mock the sandbox module
vi.mock('$lib/jkai/sandbox', () => ({
  ensureSandboxRunning: vi.fn(),
  execInSandbox: vi.fn(),
  writeFileInSandbox: vi.fn(),
}));

import { execInSandbox, ensureSandboxRunning, writeFileInSandbox } from '$lib/jkai/sandbox';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('codeExecuteExecutor', () => {
  it('executes javascript code in sandbox', async () => {
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
      stdout: '{"doubled":10}',
      stderr: '',
      exitCode: 0,
    });

    const result = await codeExecuteExecutor.execute(
      { value: 5 },
      { language: 'javascript', code: 'console.log(JSON.stringify({ doubled: input.value * 2 }))' },
      mockContext,
    );

    expect(result.output).toEqual({ doubled: 10 });
    expect(ensureSandboxRunning).toHaveBeenCalled();
  });

  it('executes python code in sandbox', async () => {
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
      stdout: '{"result":"ok"}',
      stderr: '',
      exitCode: 0,
    });

    const result = await codeExecuteExecutor.execute(
      {},
      { language: 'python', code: 'print(json.dumps({"result": "ok"}))' },
      mockContext,
    );

    expect(result.output).toEqual({ result: 'ok' });
  });

  it('captures stderr in logs', async () => {
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
      stdout: '{}',
      stderr: 'some warning',
      exitCode: 0,
    });

    const result = await codeExecuteExecutor.execute(
      {},
      { language: 'bash', code: 'echo "{}"' },
      mockContext,
    );

    expect(result.logs).toContain('some warning');
  });

  it('returns error on non-zero exit code', async () => {
    vi.mocked(ensureSandboxRunning).mockResolvedValue(undefined);
    vi.mocked(writeFileInSandbox).mockResolvedValue(undefined as any);
    vi.mocked(execInSandbox).mockResolvedValue({
      stdout: '',
      stderr: 'syntax error',
      exitCode: 1,
    });

    const result = await codeExecuteExecutor.execute(
      {},
      { language: 'python', code: 'bad code' },
      mockContext,
    );

    expect(result.output).toHaveProperty('error');
    expect(result.output.exitCode).toBe(1);
  });

  it('has correct type', () => {
    expect(codeExecuteExecutor.type).toBe('code-execute');
  });
});

describe('codeExecuteDef', () => {
  it('is a core category', () => {
    expect(codeExecuteDef.category).toBe('core');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/code-execute.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement code execute node**

Create `src/lib/workflows/nodes/code-execute.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext } from '../types';
import { ensureSandboxRunning, execInSandbox, writeFileInSandbox } from '$lib/jkai/sandbox';

export const codeExecuteExecutor: NodeExecutor = {
  type: 'code-execute',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const language = (config.language as string) || 'javascript';
    const code = config.code as string;
    const logs: string[] = [];

    if (!code) {
      return { output: { error: 'No code provided' }, logs: ['No code provided'] };
    }

    await ensureSandboxRunning();

    const inputJson = JSON.stringify(input);
    let wrappedCode: string;
    let filename: string;

    if (language === 'python') {
      filename = `workflow_${context.runId}.py`;
      wrappedCode = [
        'import json, sys, os',
        `input = json.loads(${JSON.stringify(inputJson)})`,
        code,
      ].join('\n');
    } else if (language === 'bash') {
      filename = `workflow_${context.runId}.sh`;
      wrappedCode = [
        `export WORKFLOW_INPUT=${JSON.stringify(inputJson)}`,
        code,
      ].join('\n');
    } else {
      filename = `workflow_${context.runId}.mjs`;
      wrappedCode = [
        `const input = ${inputJson};`,
        code,
      ].join('\n');
    }

    const workDir = `workflow-runs/${context.runId}`;
    await writeFileInSandbox(workDir, filename, wrappedCode);

    let execCmd: string;
    if (language === 'python') {
      execCmd = `cd /home/jkai/workspace/${workDir} && python3 ${filename}`;
    } else if (language === 'bash') {
      execCmd = `cd /home/jkai/workspace/${workDir} && bash ${filename}`;
    } else {
      execCmd = `cd /home/jkai/workspace/${workDir} && node ${filename}`;
    }

    const result = await execInSandbox(execCmd);

    if (result.stderr) {
      logs.push(result.stderr);
    }

    if (result.exitCode !== 0) {
      return {
        output: { error: result.stderr || 'Non-zero exit code', exitCode: result.exitCode },
        logs,
      };
    }

    // Try to parse the last line of stdout as JSON output
    const stdoutLines = result.stdout.trim().split('\n');
    const lastLine = stdoutLines[stdoutLines.length - 1];
    let output: Record<string, unknown>;

    try {
      output = JSON.parse(lastLine);
    } catch {
      output = { stdout: result.stdout };
    }

    if (stdoutLines.length > 1) {
      logs.push(stdoutLines.slice(0, -1).join('\n'));
    }

    return { output, logs: logs.length > 0 ? logs : undefined };
  },

  getInputSchema() {
    return { type: 'object', description: 'Available as `input` variable in code' };
  },

  getOutputSchema() {
    return { type: 'object', description: 'Last line of stdout parsed as JSON, or { stdout: string }' };
  },
};

export const codeExecuteDef: NodeDefinition = {
  type: 'code-execute',
  label: 'Code Execute',
  category: 'core',
  description: 'Run JavaScript, Python, or Bash code in a sandboxed environment.',
  configSchema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        description: 'Language: javascript, python, or bash',
      },
      code: {
        type: 'string',
        description: 'Code to execute. Input data is available as `input` variable.',
      },
    },
    required: ['code'],
  },
  defaultConfig: { language: 'javascript', code: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/nodes/code-execute.test.ts
```

Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/nodes/code-execute.ts tests/lib/workflows/nodes/code-execute.test.ts
git commit -m "feat(workflows): add code execute node"
```

---

### Task 10: Workflow Engine

**Files:**
- Create: `src/lib/workflows/engine.ts`
- Test: `tests/lib/workflows/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/engine.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowEngine } from '$lib/workflows/engine';
import { NodeRegistry } from '$lib/workflows/registry';
import { manualTriggerDef, manualTriggerExecutor } from '$lib/workflows/nodes/manual-trigger';
import { transformDef, transformExecutor } from '$lib/workflows/nodes/transform';
import type { WorkflowDefinition, WorkflowEvent } from '$lib/workflows/types';

function makeEngine(): { engine: WorkflowEngine; registry: NodeRegistry } {
  const registry = new NodeRegistry();
  registry.register(manualTriggerDef, manualTriggerExecutor);
  registry.register(transformDef, transformExecutor);
  const engine = new WorkflowEngine(registry);
  return { engine, registry };
}

describe('WorkflowEngine', () => {
  it('executes a simple two-node workflow', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'transform', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { doubled: input.value * 2 }' }, label: 'Double' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'transform' },
      ],
    };

    const result = await engine.execute(workflow, 'run-1', { value: 5 });

    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('transform')).toEqual({ doubled: 10 });
  });

  it('emits events during execution', async () => {
    const { engine } = makeEngine();
    const events: WorkflowEvent[] = [];
    engine.onEvent('run-2', (e) => events.push(e));

    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Test',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
      ],
      edges: [],
    };

    await engine.execute(workflow, 'run-2', {});

    const types = events.map((e) => e.type);
    expect(types).toContain('run_started');
    expect(types).toContain('node_started');
    expect(types).toContain('node_completed');
    expect(types).toContain('run_completed');
  });

  it('handles three-node chain', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Chain',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 't1', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'return { x: (input.x || 1) + 1 }' }, label: 'Add1' },
        { id: 't2', type: 'transform', position: { x: 400, y: 0 }, config: { expression: 'return { x: input.x * 10 }' }, label: 'Mult10' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 't1' },
        { id: 'e2', sourceNodeId: 't1', targetNodeId: 't2' },
      ],
    };

    const result = await engine.execute(workflow, 'run-3', { x: 1 });

    expect(result.nodeOutputs.get('t1')).toEqual({ x: 2 });
    expect(result.nodeOutputs.get('t2')).toEqual({ x: 20 });
  });

  it('reports failure when node throws', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Fail',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 't1', type: 'transform', position: { x: 200, y: 0 }, config: { expression: 'throw new Error("kaboom")' }, label: 'Boom' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 't1' },
      ],
    };

    const result = await engine.execute(workflow, 'run-4', {});

    // Transform catches errors and returns them in output, so this completes
    expect(result.status).toBe('completed');
    expect(result.nodeOutputs.get('t1')).toHaveProperty('error');
  });

  it('fails on unknown node type', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Unknown',
      nodes: [
        { id: 'n1', type: 'nonexistent', position: { x: 0, y: 0 }, config: {}, label: 'Bad' },
      ],
      edges: [],
    };

    const result = await engine.execute(workflow, 'run-5', {});
    expect(result.status).toBe('failed');
    expect(result.error).toContain('nonexistent');
  });

  it('merges outputs from multiple upstream nodes', async () => {
    const { engine } = makeEngine();
    const workflow: WorkflowDefinition = {
      id: 'w1',
      name: 'Fan-in',
      nodes: [
        { id: 'trigger', type: 'manual-trigger', position: { x: 0, y: 0 }, config: {}, label: 'Start' },
        { id: 'a', type: 'transform', position: { x: 200, y: -50 }, config: { expression: 'return { a: 1 }' }, label: 'A' },
        { id: 'b', type: 'transform', position: { x: 200, y: 50 }, config: { expression: 'return { b: 2 }' }, label: 'B' },
        { id: 'merge', type: 'transform', position: { x: 400, y: 0 }, config: { expression: 'return { sum: input.a + input.b }' }, label: 'Merge' },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'a' },
        { id: 'e2', sourceNodeId: 'trigger', targetNodeId: 'b' },
        { id: 'e3', sourceNodeId: 'a', targetNodeId: 'merge' },
        { id: 'e4', sourceNodeId: 'b', targetNodeId: 'merge' },
      ],
    };

    const result = await engine.execute(workflow, 'run-6', {});

    expect(result.nodeOutputs.get('merge')).toEqual({ sum: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/engine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the workflow engine**

Create `src/lib/workflows/engine.ts`:

```typescript
import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowEventType,
  NodeResult,
  ExecutionContext,
  RunStatus,
} from './types';
import type { NodeRegistry } from './registry';
import { buildGraph, topologicalSort } from './graph';
import { emitWorkflowEvent, onWorkflowEvent, cleanupRunEmitter } from './events';

export interface EngineResult {
  status: RunStatus;
  nodeOutputs: Map<string, Record<string, unknown>>;
  nodeErrors: Map<string, string>;
  error?: string;
}

export class WorkflowEngine {
  constructor(private registry: NodeRegistry) {}

  onEvent(runId: string, handler: (event: WorkflowEvent) => void): () => void {
    return onWorkflowEvent(runId, handler);
  }

  async execute(
    workflow: WorkflowDefinition,
    runId: string,
    initialInput: Record<string, unknown>,
    breakpoints?: Set<string>,
  ): Promise<EngineResult> {
    const nodeOutputs = new Map<string, Record<string, unknown>>();
    const nodeErrors = new Map<string, string>();
    const abortController = new AbortController();

    const breakpointResolvers = new Map<string, () => void>();

    const emit = (type: WorkflowEventType, nodeId?: string, data?: Record<string, unknown>) => {
      emitWorkflowEvent({
        type,
        runId,
        nodeId,
        data,
        timestamp: new Date().toISOString(),
      });
    };

    emit('run_started');

    try {
      const graph = buildGraph(workflow.nodes, workflow.edges);
      const levels = topologicalSort(graph);

      for (const level of levels) {
        const promises = level.map(async (nodeId) => {
          const nodeDef = graph.nodeMap.get(nodeId)!;
          const executor = this.registry.getExecutor(nodeDef.type);

          if (!executor) {
            throw new Error(`No executor found for node type: ${nodeDef.type}`);
          }

          // Gather input from upstream nodes
          const incomingEdges = graph.edgesByTarget.get(nodeId) || [];
          let mergedInput: Record<string, unknown>;

          if (incomingEdges.length === 0) {
            mergedInput = { ...initialInput };
          } else {
            mergedInput = {};
            for (const edge of incomingEdges) {
              const upstream = nodeOutputs.get(edge.sourceNodeId);
              if (upstream) {
                Object.assign(mergedInput, upstream);
              }
            }
          }

          // Check breakpoint
          if (breakpoints?.has(nodeId)) {
            emit('breakpoint_hit', nodeId, mergedInput);
            emit('node_paused', nodeId);
            await new Promise<void>((resolve) => {
              breakpointResolvers.set(nodeId, resolve);
            });
          }

          emit('node_started', nodeId);

          const context: ExecutionContext = {
            runId,
            workspaceDir: `/tmp/workflow-${runId}`,
            emit: (event) => emitWorkflowEvent(event),
            getNodeOutput: (id) => nodeOutputs.get(id),
            checkBreakpoint: async () => {},
            abortSignal: abortController.signal,
          };

          try {
            const result: NodeResult = await executor.execute(mergedInput, nodeDef.config, context);
            nodeOutputs.set(nodeId, result.output);
            emit('node_completed', nodeId, result.output);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            nodeErrors.set(nodeId, message);
            emit('node_failed', nodeId, { error: message });
            throw err;
          }
        });

        await Promise.all(promises);
      }

      emit('run_completed');
      cleanupRunEmitter(runId);
      return { status: 'completed', nodeOutputs, nodeErrors };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit('run_failed', undefined, { error: message });
      cleanupRunEmitter(runId);
      return { status: 'failed', nodeOutputs, nodeErrors, error: message };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/engine.test.ts
```

Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/engine.ts tests/lib/workflows/engine.test.ts
git commit -m "feat(workflows): add workflow execution engine"
```

---

### Task 11: Default Registry Setup

**Files:**
- Create: `src/lib/workflows/index.ts`

- [ ] **Step 1: Create the barrel file with default registry**

Create `src/lib/workflows/index.ts`:

```typescript
import { NodeRegistry } from './registry';
import { WorkflowEngine } from './engine';
import { manualTriggerDef, manualTriggerExecutor } from './nodes/manual-trigger';
import { transformDef, transformExecutor } from './nodes/transform';
import { codeExecuteDef, codeExecuteExecutor } from './nodes/code-execute';

export const registry = new NodeRegistry();

registry.register(manualTriggerDef, manualTriggerExecutor);
registry.register(transformDef, transformExecutor);
registry.register(codeExecuteDef, codeExecuteExecutor);

export const engine = new WorkflowEngine(registry);

export { NodeRegistry } from './registry';
export { WorkflowEngine } from './engine';
export type {
  WorkflowDefinition,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  WorkflowEvent,
  NodeDefinition,
  NodeExecutor,
  NodeResult,
  ExecutionContext,
  RunStatus,
  NodeExecutionStatus,
  Position,
  PortDefinition,
  JsonSchema,
} from './types';
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/index.ts
git commit -m "feat(workflows): add default registry and barrel exports"
```

---

### Task 12: Workflow CRUD API Routes

**Files:**
- Create: `src/routes/api/workflows/+server.ts`
- Create: `src/routes/api/workflows/[id]/+server.ts`

- [ ] **Step 1: Create the list/create endpoint**

Create `src/routes/api/workflows/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { name, description, nodes, edges } = body;

  if (!name || typeof name !== 'string') {
    return json({ error: 'name is required' }, { status: 400 });
  }

  const [workflow] = await db.insert(workflows).values({
    name,
    description: description || null,
  }).returning();

  if (Array.isArray(nodes) && nodes.length > 0) {
    await db.insert(workflowNodes).values(
      nodes.map((n: any) => ({
        id: n.id,
        workflowId: workflow.id,
        type: n.type,
        position: n.position || { x: 0, y: 0 },
        config: n.config || {},
        label: n.label || n.type,
      })),
    );
  }

  if (Array.isArray(edges) && edges.length > 0) {
    await db.insert(workflowEdges).values(
      edges.map((e: any) => ({
        id: e.id,
        workflowId: workflow.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle || null,
        targetHandle: e.targetHandle || null,
      })),
    );
  }

  return json(workflow, { status: 201 });
};
```

- [ ] **Step 2: Create the detail/update/delete endpoint**

Create `src/routes/api/workflows/[id]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  return json({ ...workflow, nodes, edges });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { name, description, nodes, edges } = body;

  const [existing] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!existing) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  await db.update(workflows).set({
    name: name ?? existing.name,
    description: description ?? existing.description,
    updatedAt: new Date(),
  }).where(eq(workflows.id, params.id));

  if (Array.isArray(nodes)) {
    await db.delete(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
    if (nodes.length > 0) {
      await db.insert(workflowNodes).values(
        nodes.map((n: any) => ({
          id: n.id,
          workflowId: params.id,
          type: n.type,
          position: n.position || { x: 0, y: 0 },
          config: n.config || {},
          label: n.label || n.type,
        })),
      );
    }
  }

  if (Array.isArray(edges)) {
    await db.delete(workflowEdges).where(eq(workflowEdges.workflowId, params.id));
    if (edges.length > 0) {
      await db.insert(workflowEdges).values(
        edges.map((e: any) => ({
          id: e.id,
          workflowId: params.id,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null,
        })),
      );
    }
  }

  return json({ success: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(workflows).where(eq(workflows.id, params.id));
  return json({ success: true });
};
```

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/+server.ts src/routes/api/workflows/\[id\]/+server.ts
git commit -m "feat(workflows): add CRUD API routes"
```

---

### Task 13: Workflow Run API Routes

**Files:**
- Create: `src/routes/api/workflows/[id]/run/+server.ts`
- Create: `src/routes/api/workflows/[id]/runs/+server.ts`
- Create: `src/routes/api/workflows/[id]/runs/[runId]/+server.ts`
- Create: `src/routes/api/workflows/[id]/runs/[runId]/stream/+server.ts`

- [ ] **Step 1: Create the run trigger endpoint**

Create `src/routes/api/workflows/[id]/run/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Workflow not found' }, { status: 404 });
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  const body = await request.json().catch(() => ({}));
  const initialInput = body.input || {};

  const [run] = await db.insert(workflowRuns).values({
    workflowId: params.id,
    status: 'running',
    trigger: 'manual',
    startedAt: new Date(),
  }).returning();

  // Create pending node execution records
  for (const node of nodes) {
    await db.insert(nodeExecutions).values({
      runId: run.id,
      nodeId: node.id,
      status: 'pending',
    });
  }

  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
      label: n.label,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  // Execute in background — don't await
  engine.execute(definition, run.id, initialInput).then(async (result) => {
    await db.update(workflowRuns).set({
      status: result.status,
      completedAt: new Date(),
      error: result.error || null,
    }).where(eq(workflowRuns.id, run.id));

    // Update node execution records
    for (const [nodeId, output] of result.nodeOutputs) {
      await db.update(nodeExecutions).set({
        status: 'completed',
        outputData: output,
        completedAt: new Date(),
      }).where(
        eq(nodeExecutions.nodeId, nodeId),
      );
    }

    for (const [nodeId, error] of result.nodeErrors) {
      await db.update(nodeExecutions).set({
        status: 'failed',
        error,
        completedAt: new Date(),
      }).where(
        eq(nodeExecutions.nodeId, nodeId),
      );
    }
  });

  return json({ runId: run.id, status: 'running' }, { status: 201 });
};
```

- [ ] **Step 2: Create the run list endpoint**

Create `src/routes/api/workflows/[id]/runs/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const runs = await db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, params.id))
    .orderBy(desc(workflowRuns.startedAt));

  return json(runs);
};
```

- [ ] **Step 3: Create the run detail endpoint**

Create `src/routes/api/workflows/[id]/runs/[runId]/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, params.runId));
  if (!run) {
    return json({ error: 'Run not found' }, { status: 404 });
  }

  const executions = await db
    .select()
    .from(nodeExecutions)
    .where(eq(nodeExecutions.runId, params.runId));

  return json({ ...run, nodeExecutions: executions });
};
```

- [ ] **Step 4: Create the SSE stream endpoint**

Create `src/routes/api/workflows/[id]/runs/[runId]/stream/+server.ts`:

```typescript
import type { RequestHandler } from './$types';
import { onWorkflowEvent } from '$lib/workflows/events';
import type { WorkflowEvent } from '$lib/workflows';

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.runId;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      }

      send({ type: 'connected', runId, timestamp: new Date().toISOString() });

      const unsubscribe = onWorkflowEvent(runId, (event: WorkflowEvent) => {
        send(event);
        if (event.type === 'run_completed' || event.type === 'run_failed') {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          unsubscribe();
        }
      }, 15000);

      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
      };
    },
    cancel(controller) {
      if ((controller as any)?._cleanup) {
        (controller as any)._cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/\[id\]/run/+server.ts \
  src/routes/api/workflows/\[id\]/runs/+server.ts \
  src/routes/api/workflows/\[id\]/runs/\[runId\]/+server.ts \
  src/routes/api/workflows/\[id\]/runs/\[runId\]/stream/+server.ts
git commit -m "feat(workflows): add run execution and SSE streaming API routes"
```

---

### Task 14: Canvas Adapter

**Files:**
- Create: `src/lib/components/workflows/adapter.ts`

- [ ] **Step 1: Create the adapter module**

Create `src/lib/components/workflows/adapter.ts`:

```typescript
import type { Node, Edge } from '@xyflow/svelte';
import type { WorkflowNodeDef, WorkflowEdgeDef, Position } from '$lib/workflows';

export interface CanvasNode extends Node {
  data: {
    label: string;
    nodeType: string;
    config: Record<string, unknown>;
    status?: string;
  };
}

export interface CanvasEdge extends Edge {
  data?: {
    animated?: boolean;
  };
}

export function workflowNodesToCanvas(nodes: WorkflowNodeDef[]): CanvasNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: {
      label: n.label,
      nodeType: n.type,
      config: n.config,
    },
  }));
}

export function workflowEdgesToCanvas(edges: WorkflowEdgeDef[]): CanvasEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
}

export function canvasNodesToWorkflow(nodes: CanvasNode[]): WorkflowNodeDef[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data.nodeType,
    position: { x: n.position.x, y: n.position.y },
    config: n.data.config,
    label: n.data.label,
  }));
}

export function canvasEdgesToWorkflow(edges: CanvasEdge[]): WorkflowEdgeDef[] {
  return edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.source,
    targetNodeId: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/adapter.ts
git commit -m "feat(workflows): add canvas adapter for engine ↔ Svelte Flow sync"
```

---

### Task 15: Base Node Component

**Files:**
- Create: `src/lib/components/workflows/nodes/BaseNode.svelte`

- [ ] **Step 1: Create the base node component**

Create `src/lib/components/workflows/nodes/BaseNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';

  let {
    label,
    nodeType,
    status,
    inputs = [],
    outputs = [],
    icon = '',
  }: {
    label: string;
    nodeType: string;
    status?: string;
    inputs?: { name: string }[];
    outputs?: { name: string }[];
    icon?: string;
  } = $props();

  const STATUS_COLORS: Record<string, string> = {
    pending: 'var(--card-border)',
    running: '#569cd6',
    completed: '#2d7d46',
    failed: '#b43232',
    paused_breakpoint: '#b8860b',
    skipped: 'var(--text-ghost)',
  };

  let borderColor = $derived(status ? STATUS_COLORS[status] || 'var(--card-border)' : 'var(--card-border)');
  let isRunning = $derived(status === 'running');
</script>

<div
  class="rounded-lg border-2 min-w-[160px] transition-colors"
  style="background: var(--card-bg); border-color: {borderColor};"
  class:animate-pulse={isRunning}
>
  {#each inputs as input, i}
    <Handle type="target" position={Position.Left} id={input.name} style="top: {30 + i * 20}px;" />
  {/each}

  <div class="px-3 py-2">
    <div class="flex items-center gap-2 mb-1">
      {#if icon}
        <span class="text-sm">{icon}</span>
      {/if}
      <span
        class="text-[10px] uppercase tracking-[0.15em]"
        style="color: var(--text-ghost); font-family: var(--font-mono);"
      >
        {nodeType}
      </span>
      {#if status}
        <span
          class="w-2 h-2 rounded-full ml-auto"
          style="background: {borderColor};"
        ></span>
      {/if}
    </div>
    <div class="text-sm font-medium" style="color: var(--text-primary);">
      {label}
    </div>
  </div>

  {#each outputs as output, i}
    <Handle type="source" position={Position.Right} id={output.name} style="top: {30 + i * 20}px;" />
  {/each}
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/nodes/BaseNode.svelte
git commit -m "feat(workflows): add BaseNode svelte component"
```

---

### Task 16: Custom Node Components

**Files:**
- Create: `src/lib/components/workflows/nodes/ManualTriggerNode.svelte`
- Create: `src/lib/components/workflows/nodes/CodeExecuteNode.svelte`
- Create: `src/lib/components/workflows/nodes/TransformNode.svelte`

- [ ] **Step 1: Create ManualTriggerNode**

Create `src/lib/components/workflows/nodes/ManualTriggerNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';
  import type { NodeProps } from '@xyflow/svelte';

  let { data } = $props();
</script>

<BaseNode
  label={data.label}
  nodeType="trigger"
  status={data.status}
  icon="▶"
  outputs={[{ name: 'output' }]}
/>
```

- [ ] **Step 2: Create CodeExecuteNode**

Create `src/lib/components/workflows/nodes/CodeExecuteNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();

  const langIcons: Record<string, string> = {
    javascript: 'JS',
    python: 'PY',
    bash: 'SH',
  };
  let langLabel = $derived(langIcons[data.config?.language as string] || 'JS');
</script>

<BaseNode
  label={data.label}
  nodeType="code · {langLabel}"
  status={data.status}
  icon="⟩_"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
```

- [ ] **Step 3: Create TransformNode**

Create `src/lib/components/workflows/nodes/TransformNode.svelte`:

```svelte
<script lang="ts">
  import BaseNode from './BaseNode.svelte';

  let { data } = $props();
</script>

<BaseNode
  label={data.label}
  nodeType="transform"
  status={data.status}
  icon="⇄"
  inputs={[{ name: 'input' }]}
  outputs={[{ name: 'output' }]}
/>
```

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/nodes/ManualTriggerNode.svelte \
  src/lib/components/workflows/nodes/CodeExecuteNode.svelte \
  src/lib/components/workflows/nodes/TransformNode.svelte
git commit -m "feat(workflows): add custom node components for trigger, code, transform"
```

---

### Task 17: Node Palette Component

**Files:**
- Create: `src/lib/components/workflows/NodePalette.svelte`

- [ ] **Step 1: Create the node palette**

Create `src/lib/components/workflows/NodePalette.svelte`:

```svelte
<script lang="ts">
  import type { NodeDefinition } from '$lib/workflows';

  let {
    definitions,
    onDragStart,
  }: {
    definitions: NodeDefinition[];
    onDragStart: (type: string, event: DragEvent) => void;
  } = $props();

  let search = $state('');

  let filtered = $derived(
    definitions.filter(
      (d) =>
        d.label.toLowerCase().includes(search.toLowerCase()) ||
        d.description.toLowerCase().includes(search.toLowerCase()),
    ),
  );

  const categories = ['trigger', 'core', 'control', 'integration', 'custom'] as const;

  let grouped = $derived(
    categories
      .map((cat) => ({
        category: cat,
        nodes: filtered.filter((d) => d.category === cat),
      }))
      .filter((g) => g.nodes.length > 0),
  );

  function handleDragStart(type: string, event: DragEvent) {
    event.dataTransfer?.setData('application/workflow-node', type);
    onDragStart(type, event);
  }
</script>

<div class="h-full flex flex-col border-r" style="background: var(--bg); border-color: var(--card-border); width: 220px;">
  <div class="p-3 border-b" style="border-color: var(--card-border);">
    <input
      type="text"
      bind:value={search}
      placeholder="Search nodes..."
      class="w-full px-2 py-1.5 rounded text-sm border"
      style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
    />
  </div>

  <div class="flex-1 overflow-y-auto p-2">
    {#each grouped as group}
      <div class="mb-3">
        <div
          class="text-[10px] uppercase tracking-[0.2em] px-2 py-1 mb-1"
          style="color: var(--text-ghost); font-family: var(--font-mono);"
        >
          {group.category}
        </div>
        {#each group.nodes as nodeDef}
          <div
            class="px-3 py-2 rounded cursor-grab text-sm mb-1 border transition-colors hover:border-[var(--accent)]"
            style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary);"
            draggable="true"
            ondragstart={(e) => handleDragStart(nodeDef.type, e)}
            role="button"
            tabindex="0"
          >
            <div class="font-medium text-xs">{nodeDef.label}</div>
            <div class="text-[11px] mt-0.5" style="color: var(--text-ghost);">
              {nodeDef.description.slice(0, 60)}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/NodePalette.svelte
git commit -m "feat(workflows): add node palette sidebar component"
```

---

### Task 18: Workflow Toolbar Component

**Files:**
- Create: `src/lib/components/workflows/WorkflowToolbar.svelte`

- [ ] **Step 1: Create the toolbar**

Create `src/lib/components/workflows/WorkflowToolbar.svelte`:

```svelte
<script lang="ts">
  let {
    workflowName = '',
    runStatus,
    onSave,
    onRun,
    onStop,
    onNameChange,
  }: {
    workflowName?: string;
    runStatus?: string | null;
    onSave: () => void;
    onRun: () => void;
    onStop: () => void;
    onNameChange: (name: string) => void;
  } = $props();

  let editing = $state(false);
  let nameInput = $state(workflowName);
  let isRunning = $derived(runStatus === 'running');

  function commitName() {
    editing = false;
    if (nameInput.trim() && nameInput !== workflowName) {
      onNameChange(nameInput.trim());
    }
  }
</script>

<div
  class="flex items-center gap-3 px-4 py-2 border-b"
  style="background: var(--bg); border-color: var(--card-border);"
>
  {#if editing}
    <input
      type="text"
      bind:value={nameInput}
      onblur={commitName}
      onkeydown={(e) => { if (e.key === 'Enter') commitName(); }}
      class="px-2 py-1 rounded text-sm border font-medium"
      style="background: var(--card-bg); border-color: var(--accent); color: var(--text-primary);"
      autofocus
    />
  {:else}
    <button
      onclick={() => { editing = true; nameInput = workflowName; }}
      class="text-sm font-medium hover:underline"
      style="color: var(--text-primary);"
    >
      {workflowName || 'Untitled Workflow'}
    </button>
  {/if}

  {#if runStatus}
    <span
      class="text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
      style="font-family: var(--font-mono); background: rgba(100,100,100,0.1); color: var(--text-ghost);"
    >
      {runStatus}
    </span>
  {/if}

  <div class="flex-1"></div>

  <button
    onclick={onSave}
    class="px-3 py-1 rounded text-sm border transition-colors hover:border-[var(--accent)]"
    style="border-color: var(--card-border); color: var(--text-secondary);"
  >
    Save
  </button>

  {#if isRunning}
    <button
      onclick={onStop}
      class="px-3 py-1 rounded text-sm border transition-colors"
      style="border-color: #b43232; color: #b43232;"
    >
      Stop
    </button>
  {:else}
    <button
      onclick={onRun}
      class="px-3 py-1 rounded text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      Run
    </button>
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/WorkflowToolbar.svelte
git commit -m "feat(workflows): add workflow toolbar component"
```

---

### Task 19: Main Canvas Component

**Files:**
- Create: `src/lib/components/workflows/Canvas.svelte`

- [ ] **Step 1: Create the canvas wrapper**

Create `src/lib/components/workflows/Canvas.svelte`:

```svelte
<script lang="ts">
  import { SvelteFlow, Controls, MiniMap, Background, BackgroundVariant } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import type { CanvasNode, CanvasEdge } from './adapter';
  import ManualTriggerNode from './nodes/ManualTriggerNode.svelte';
  import CodeExecuteNode from './nodes/CodeExecuteNode.svelte';
  import TransformNode from './nodes/TransformNode.svelte';

  let {
    nodes = $bindable([]),
    edges = $bindable([]),
    onNodeDoubleClick,
    onEdgeClick,
    onDrop,
  }: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    onNodeDoubleClick?: (nodeId: string) => void;
    onEdgeClick?: (edgeId: string) => void;
    onDrop?: (type: string, position: { x: number; y: number }) => void;
  } = $props();

  const nodeTypes = {
    'manual-trigger': ManualTriggerNode,
    'code-execute': CodeExecuteNode,
    'transform': TransformNode,
  };

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const type = event.dataTransfer?.getData('application/workflow-node');
    if (!type || !onDrop) return;

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const position = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    onDrop(type, position);
  }

  function handleNodeDoubleClick(_event: MouseEvent | TouchEvent, node: any) {
    onNodeDoubleClick?.(node.id);
  }

  function handleEdgeClick(_event: MouseEvent, edge: any) {
    onEdgeClick?.(edge.id);
  }
</script>

<div
  class="flex-1 h-full"
  ondragover={handleDragOver}
  ondrop={handleDrop}
  role="application"
>
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    fitView
    onnodeDoubleClick={handleNodeDoubleClick}
    onedgeclick={handleEdgeClick}
    defaultEdgeOptions={{ type: 'smoothstep', animated: false }}
  >
    <Controls />
    <MiniMap />
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
  </SvelteFlow>
</div>

<style>
  :global(.svelte-flow) {
    --xy-background-color: var(--bg, #ede4d4);
    --xy-node-border-radius: 8px;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/components/workflows/Canvas.svelte
git commit -m "feat(workflows): add main Svelte Flow canvas component"
```

---

### Task 20: Workflow Page Routes

**Files:**
- Create: `src/routes/workflows/+page.server.ts`
- Create: `src/routes/workflows/+page.svelte`
- Create: `src/routes/workflows/[id]/+page.server.ts`
- Create: `src/routes/workflows/[id]/+page.svelte`
- Create: `src/routes/workflows/new/+page.svelte`

- [ ] **Step 1: Create the workflow list page server**

Create `src/routes/workflows/+page.server.ts`:

```typescript
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  const rows = await db.select().from(workflows).orderBy(desc(workflows.createdAt));
  return { workflows: rows };
};
```

- [ ] **Step 2: Create the workflow list page**

Create `src/routes/workflows/+page.svelte`:

```svelte
<script lang="ts">
  let { data } = $props();

  function formatDate(d: string | Date) {
    return new Date(d).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<svelte:head>
  <title>Workflows</title>
</svelte:head>

<div class="p-6 sm:p-10 max-w-5xl mx-auto">
  <div class="flex justify-between items-center mb-8">
    <div>
      <h1 class="display text-[32px] sm:text-[40px]" style="color: var(--text-primary);">
        WORKFLOWS
      </h1>
      <p class="text-sm mt-1" style="color: var(--text-secondary);">
        Visual automation pipelines
      </p>
    </div>
    <a
      href="/workflows/new"
      class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      style="background: var(--accent); color: white;"
    >
      New Workflow
    </a>
  </div>

  {#if data.workflows.length === 0}
    <div
      class="text-center py-16 rounded-xl border"
      style="background: var(--card-bg); border-color: var(--card-border);"
    >
      <p class="text-lg mb-2" style="color: var(--text-secondary);">No workflows yet</p>
      <p class="text-sm" style="color: var(--text-ghost);">
        Create your first workflow to get started.
      </p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each data.workflows as workflow}
        <a
          href="/workflows/{workflow.id}"
          class="group p-5 rounded-xl border transition-colors hover:border-[var(--accent)]"
          style="background: var(--card-bg); border-color: var(--card-border);"
        >
          <div class="flex items-start justify-between mb-2">
            <h2
              class="text-base font-medium group-hover:text-[var(--accent)] transition-colors"
              style="color: var(--text-primary);"
            >
              {workflow.name}
            </h2>
            <span class="text-[11px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {formatDate(workflow.createdAt)}
            </span>
          </div>
          {#if workflow.description}
            <p class="text-sm line-clamp-2" style="color: var(--text-secondary);">
              {workflow.description}
            </p>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Create the workflow editor page server**

Create `src/routes/workflows/[id]/+page.server.ts`:

```typescript
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    throw error(404, 'Workflow not found');
  }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  return { workflow, nodes, edges };
};
```

- [ ] **Step 4: Create the workflow editor page**

Create `src/routes/workflows/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Canvas from '$lib/components/workflows/Canvas.svelte';
  import NodePalette from '$lib/components/workflows/NodePalette.svelte';
  import WorkflowToolbar from '$lib/components/workflows/WorkflowToolbar.svelte';
  import { workflowNodesToCanvas, workflowEdgesToCanvas, canvasNodesToWorkflow, canvasEdgesToWorkflow } from '$lib/components/workflows/adapter';
  import type { CanvasNode, CanvasEdge } from '$lib/components/workflows/adapter';
  import { registry } from '$lib/workflows';

  let { data } = $props();

  let nodes = $state<CanvasNode[]>(workflowNodesToCanvas(data.nodes));
  let edges = $state<CanvasEdge[]>(workflowEdgesToCanvas(data.edges));
  let workflowName = $state(data.workflow.name);
  let runStatus = $state<string | null>(null);
  let eventSource: EventSource | null = null;

  const definitions = registry.listDefinitions();

  function handleDragStart(_type: string, _event: DragEvent) {
    // Svelte Flow handles drag visuals
  }

  function handleDrop(type: string, position: { x: number; y: number }) {
    const def = registry.getDefinition(type);
    if (!def) return;

    const newNode: CanvasNode = {
      id: crypto.randomUUID(),
      type,
      position,
      data: {
        label: def.label,
        nodeType: type,
        config: { ...def.defaultConfig },
      },
    };
    nodes = [...nodes, newNode];
  }

  function handleNodeDoubleClick(nodeId: string) {
    // TODO: Phase 3 — open node inspector
    console.log('Double-click node:', nodeId);
  }

  function handleEdgeClick(edgeId: string) {
    // TODO: Phase 3 — open edge inspector
    console.log('Click edge:', edgeId);
  }

  async function handleSave() {
    const workflowNodes = canvasNodesToWorkflow(nodes);
    const workflowEdges = canvasEdgesToWorkflow(edges);

    await fetch(`/api/workflows/${data.workflow.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workflowName,
        nodes: workflowNodes,
        edges: workflowEdges,
      }),
    });
  }

  async function handleRun() {
    const res = await fetch(`/api/workflows/${data.workflow.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: {} }),
    });
    const result = await res.json();
    if (res.ok) {
      runStatus = 'running';
      connectSSE(result.runId);
    }
  }

  function connectSSE(runId: string) {
    eventSource?.close();
    eventSource = new EventSource(`/api/workflows/${data.workflow.id}/runs/${runId}/stream`);

    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'node_started' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'running');
      } else if (event.type === 'node_completed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'completed');
      } else if (event.type === 'node_failed' && event.nodeId) {
        updateNodeStatus(event.nodeId, 'failed');
      } else if (event.type === 'run_completed') {
        runStatus = 'completed';
        eventSource?.close();
      } else if (event.type === 'run_failed') {
        runStatus = 'failed';
        eventSource?.close();
      }
    };

    eventSource.onerror = () => {
      eventSource?.close();
    };
  }

  function updateNodeStatus(nodeId: string, status: string) {
    nodes = nodes.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, status } } : n,
    );
  }

  function handleStop() {
    eventSource?.close();
    runStatus = null;
    nodes = nodes.map((n) => ({ ...n, data: { ...n.data, status: undefined } }));
  }

  function handleNameChange(name: string) {
    workflowName = name;
  }

  onDestroy(() => {
    eventSource?.close();
  });
</script>

<svelte:head>
  <title>{workflowName} — Workflows</title>
</svelte:head>

<div class="flex flex-col h-screen">
  <WorkflowToolbar
    {workflowName}
    {runStatus}
    onSave={handleSave}
    onRun={handleRun}
    onStop={handleStop}
    onNameChange={handleNameChange}
  />

  <div class="flex flex-1 overflow-hidden">
    <NodePalette {definitions} onDragStart={handleDragStart} />

    <Canvas
      bind:nodes
      bind:edges
      onNodeDoubleClick={handleNodeDoubleClick}
      onEdgeClick={handleEdgeClick}
      onDrop={handleDrop}
    />
  </div>
</div>
```

- [ ] **Step 5: Create the new workflow page**

Create `src/routes/workflows/new/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import Canvas from '$lib/components/workflows/Canvas.svelte';
  import NodePalette from '$lib/components/workflows/NodePalette.svelte';
  import WorkflowToolbar from '$lib/components/workflows/WorkflowToolbar.svelte';
  import { canvasNodesToWorkflow, canvasEdgesToWorkflow } from '$lib/components/workflows/adapter';
  import type { CanvasNode, CanvasEdge } from '$lib/components/workflows/adapter';
  import { registry } from '$lib/workflows';

  let nodes = $state<CanvasNode[]>([
    {
      id: crypto.randomUUID(),
      type: 'manual-trigger',
      position: { x: 100, y: 200 },
      data: { label: 'Start', nodeType: 'manual-trigger', config: {} },
    },
  ]);
  let edges = $state<CanvasEdge[]>([]);
  let workflowName = $state('Untitled Workflow');

  const definitions = registry.listDefinitions();

  function handleDragStart(_type: string, _event: DragEvent) {}

  function handleDrop(type: string, position: { x: number; y: number }) {
    const def = registry.getDefinition(type);
    if (!def) return;

    const newNode: CanvasNode = {
      id: crypto.randomUUID(),
      type,
      position,
      data: {
        label: def.label,
        nodeType: type,
        config: { ...def.defaultConfig },
      },
    };
    nodes = [...nodes, newNode];
  }

  async function handleSave() {
    const res = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: workflowName,
        nodes: canvasNodesToWorkflow(nodes),
        edges: canvasEdgesToWorkflow(edges),
      }),
    });
    const workflow = await res.json();
    if (res.ok) {
      goto(`/workflows/${workflow.id}`);
    }
  }

  function handleRun() {
    // Must save first before running
    handleSave();
  }

  function handleStop() {}

  function handleNameChange(name: string) {
    workflowName = name;
  }
</script>

<svelte:head>
  <title>New Workflow</title>
</svelte:head>

<div class="flex flex-col h-screen">
  <WorkflowToolbar
    {workflowName}
    onSave={handleSave}
    onRun={handleRun}
    onStop={handleStop}
    onNameChange={handleNameChange}
  />

  <div class="flex flex-1 overflow-hidden">
    <NodePalette {definitions} onDragStart={handleDragStart} />

    <Canvas
      bind:nodes
      bind:edges
      onDrop={handleDrop}
    />
  </div>
</div>
```

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/workflows/+page.server.ts \
  src/routes/workflows/+page.svelte \
  src/routes/workflows/\[id\]/+page.server.ts \
  src/routes/workflows/\[id\]/+page.svelte \
  src/routes/workflows/new/+page.svelte
git commit -m "feat(workflows): add workflow list, editor, and new workflow pages"
```

---

### Task 21: Build + Typecheck Verification

**Files:** (no new files)

- [ ] **Step 1: Run all workflow tests**

```bash
cd ~/strange_rambling_svelte && npx vitest run tests/lib/workflows/
```

Expected: All tests PASS.

- [ ] **Step 2: Run svelte-check**

```bash
cd ~/strange_rambling_svelte && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -20
```

Expected: No errors in `src/lib/workflows/` or `src/lib/components/workflows/` or `src/routes/workflows/`. There may be pre-existing warnings in other files — ignore those.

- [ ] **Step 3: Fix any type errors**

If there are errors in workflow files, fix them. Common issues:
- Svelte Flow type mismatches — adjust `CanvasNode`/`CanvasEdge` interfaces in `adapter.ts`
- Missing `$types` imports — run `npx svelte-kit sync` first
- Drizzle column type issues — check that `jsonb` columns use proper casts

- [ ] **Step 4: Run build**

```bash
cd ~/strange_rambling_svelte && npm run build 2>&1 | tail -20
```

Expected: Build completes. If Svelte Flow has SSR issues, the Canvas component may need a dynamic import wrapper — add `{#if browser}` guard using `import { browser } from '$app/environment'` in the canvas page.

- [ ] **Step 5: Commit any fixes**

```bash
cd ~/strange_rambling_svelte
git add -A
git commit -m "fix(workflows): resolve type and build issues"
```

---

### Task 22: Manual Integration Test

**Files:** (no new files)

- [ ] **Step 1: Start the dev server**

```bash
cd ~/strange_rambling_svelte && npm run dev
```

- [ ] **Step 2: Test the workflow list page**

Open `http://localhost:5173/workflows` in a browser. Verify:
- Page loads with "WORKFLOWS" heading
- "New Workflow" button is visible
- Empty state message shows if no workflows exist

- [ ] **Step 3: Test creating a new workflow**

Click "New Workflow". Verify:
- Canvas loads with a Manual Trigger node
- Node palette on the left shows available node types
- Toolbar shows "Untitled Workflow" with Save and Run buttons
- Dragging a Transform node from the palette onto the canvas creates a new node
- Connecting the trigger output handle to the transform input handle creates an edge
- Clicking Save persists the workflow and redirects to the editor page

- [ ] **Step 4: Test running a workflow**

On the saved workflow editor page:
- Click Run
- Verify nodes animate (status indicators change)
- Verify the run status shows in the toolbar

- [ ] **Step 5: Commit final state**

```bash
cd ~/strange_rambling_svelte
git add -A
git commit -m "feat(workflows): complete Phase 1 — core engine + canvas"
```
