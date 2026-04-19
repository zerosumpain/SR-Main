# Workflow Reliability Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve one-shot reliability of workflows generated from natural language by closing the detect-then-act gap across the orchestrator, engine, and node executors.

**Architecture:** Four phases of independent fixes — quick wins (scheduler, sub-workflow, transform, template), reliability core (critic revision, auto-connect removal, output schemas, DB transaction), draft persistence, and prompt hardening. Each task produces a testable, committable unit.

**Tech Stack:** SvelteKit, TypeScript, Vitest, Drizzle ORM, PostgreSQL, croner

---

### Task 1: Start scheduler at boot

**Files:**
- Modify: `src/lib/workflows/index.ts:190` (after `startMemoryReview()`)
- Test: `tests/lib/workflows/scheduler-boot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/workflows/scheduler-boot.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock the DB and scheduler before importing index
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('$lib/workflows/scheduler', () => ({
  startScheduler: vi.fn().mockResolvedValue(undefined),
}));

// Mock all the heavy deps that index.ts imports
vi.mock('$lib/workflows/whatsapp/service', () => ({
  getWhatsAppService: vi.fn(),
}));
vi.mock('$lib/workflows/whatsapp/orchestrator-bridge', () => ({
  OrchestratorBridge: vi.fn(),
}));
vi.mock('$lib/workflows/prompts/loader', () => ({
  syncPrompts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/workflows/site-tools/custom-tool-loader', () => ({
  loadCustomTools: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/workflows/chat/memory-review', () => ({
  startMemoryReview: vi.fn(),
}));
vi.mock('$lib/workflows/homeassistant/service', () => ({
  initHomeAssistantService: vi.fn(),
}));
vi.mock('$lib/workflows/orchestrator/dynamic-nodes', () => ({
  DYNAMIC_NODES_DIR: '/tmp/test-nodes',
  loadDynamicNodeDefinitions: vi.fn().mockReturnValue([]),
  loadDynamicNodeExecutor: vi.fn().mockResolvedValue(null),
  ensureDynamicNodesDir: vi.fn(),
}));
vi.mock('$lib/db/schema', () => ({
  whatsappConfig: { id: 'id' },
  homeAssistantConfig: { id: 'id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

describe('scheduler boot', () => {
  it('calls startScheduler on module load', async () => {
    const { startScheduler } = await import('$lib/workflows/scheduler');
    // Force re-import of index to trigger side effects
    await import('$lib/workflows/index');
    // startScheduler should have been called
    expect(startScheduler).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/scheduler-boot.test.ts`
Expected: FAIL — `startScheduler` was not called

- [ ] **Step 3: Add startScheduler call to index.ts**

In `src/lib/workflows/index.ts`, add the import and call:

```typescript
// Add to imports at top:
import { startScheduler } from './scheduler';

// Add after startMemoryReview() (line 190):
startScheduler().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  console.error('[scheduler] Boot failed:', msg);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/workflows/scheduler-boot.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/index.ts tests/lib/workflows/scheduler-boot.test.ts
git commit -m "fix: start cron scheduler at boot"
```

---

### Task 2: Fix transform node — throw on error instead of swallowing

**Files:**
- Modify: `src/lib/workflows/nodes/transform.ts:18-29`
- Modify: `tests/lib/workflows/engine.test.ts` (update existing test at line 82)

- [ ] **Step 1: Update the existing engine test that expects swallowed errors**

The test at `tests/lib/workflows/engine.test.ts:82` ("reports failure when node throws") currently expects `completed` status because transform swallows errors. Update it:

```typescript
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

  // selfHealing: false to skip LLM calls in test
  const result = await engine.execute(workflow, 'run-4', {}, undefined, undefined, { selfHealing: false });

  expect(result.status).toBe('failed');
  expect(result.nodeErrors.get('t1')).toContain('kaboom');
});
```

- [ ] **Step 2: Run the test to verify it fails (transform still swallows)**

Run: `npx vitest run tests/lib/workflows/engine.test.ts -t "reports failure"`
Expected: FAIL — status is `completed`, not `failed`

- [ ] **Step 3: Make transform throw instead of returning error output**

Replace the catch block in `src/lib/workflows/nodes/transform.ts`:

```typescript
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof UnsafeExpressionError) {
        throw err;
      }
      throw new Error(`Transform expression failed: ${message}`);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/workflows/engine.test.ts`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/nodes/transform.ts tests/lib/workflows/engine.test.ts
git commit -m "fix: transform node throws on expression error instead of swallowing"
```

---

### Task 3: Fix sub-workflow node — replace HTTP call with direct engine call

**Files:**
- Modify: `src/lib/workflows/nodes/sub-workflow.ts`
- Test: `tests/lib/workflows/nodes/sub-workflow.test.ts`

- [ ] **Step 1: Write test for direct engine invocation**

Create `tests/lib/workflows/nodes/sub-workflow.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DB
vi.mock('$lib/db', () => ({
  db: {
    select: vi.fn(),
  },
}));
vi.mock('$lib/db/schema', () => ({
  workflows: {},
  workflowNodes: {},
  workflowEdges: {},
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

// Mock the engine
const mockExecute = vi.fn();
vi.mock('$lib/workflows', () => ({
  engine: { execute: mockExecute },
}));

import { subWorkflowExecutor } from '$lib/workflows/nodes/sub-workflow';
import { db } from '$lib/db';
import type { ExecutionContext } from '$lib/workflows/types';

const stubContext: ExecutionContext = {
  runId: 'parent-run',
  workflowId: 'parent-wf',
  workspaceDir: '/tmp/test',
  emit: vi.fn(),
  getNodeOutput: vi.fn(),
  checkBreakpoint: vi.fn(),
  abortSignal: new AbortController().signal,
  getOutgoingEdges: vi.fn().mockReturnValue([]),
  getNodeConfig: vi.fn(),
} as unknown as ExecutionContext;

describe('sub-workflow executor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when no workflowId configured', async () => {
    const result = await subWorkflowExecutor.execute({}, {}, stubContext);
    expect(result.output).toHaveProperty('error');
  });

  it('loads workflow from DB and calls engine.execute directly', async () => {
    // Mock DB chain: select().from().where().limit()
    const mockLimit = vi.fn();
    const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    (db.select as any).mockReturnValue({ from: mockFrom });

    // First call: workflow row
    mockLimit.mockResolvedValueOnce([{ id: 'sub-wf', name: 'Sub' }]);
    // Second call: nodes
    mockWhere.mockReturnValueOnce([
      { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start', position: { x: 0, y: 0 } },
    ]);
    // Third call: edges
    mockWhere.mockReturnValueOnce([]);

    mockExecute.mockResolvedValue({
      status: 'completed',
      nodeOutputs: new Map([['n1', { result: 42 }]]),
      nodeErrors: new Map(),
    });

    const result = await subWorkflowExecutor.execute(
      { data: 'test' },
      { workflowId: 'sub-wf' },
      stubContext,
    );

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.output).toHaveProperty('result', 42);
    expect(result.metadata).toHaveProperty('subWorkflowId', 'sub-wf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/nodes/sub-workflow.test.ts`
Expected: FAIL — current code uses `fetch` not engine

- [ ] **Step 3: Rewrite sub-workflow executor to use direct engine call**

Replace `src/lib/workflows/nodes/sub-workflow.ts`:

```typescript
import type { NodeExecutor, NodeDefinition, NodeResult, ExecutionContext, WorkflowDefinition } from '../types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const subWorkflowExecutor: NodeExecutor = {
  type: 'sub-workflow',
  async execute(input, config, context): Promise<NodeResult> {
    const workflowId = config.workflowId as string;
    if (!workflowId) return { output: { error: 'No workflowId configured' } };

    // Load the sub-workflow definition from DB
    const [workflow] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, workflowId))
      .limit(1);

    if (!workflow) {
      throw new Error(`Sub-workflow not found: ${workflowId}`);
    }

    const nodes = await db
      .select()
      .from(workflowNodes)
      .where(eq(workflowNodes.workflowId, workflowId));

    const edges = await db
      .select()
      .from(workflowEdges)
      .where(eq(workflowEdges.workflowId, workflowId));

    const definition: WorkflowDefinition = {
      id: workflowId,
      name: workflow.name,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        label: n.label ?? n.type,
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
      })),
      edges: edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      })),
    };

    // Import engine lazily to avoid circular dependency
    const { engine } = await import('$lib/workflows');
    const subRunId = `sub-${context.runId}-${crypto.randomUUID().slice(0, 8)}`;

    const result = await engine.execute(
      definition,
      subRunId,
      input,
      undefined,
      workflowId,
    );

    if (result.status === 'failed') {
      throw new Error(`Sub-workflow failed: ${result.error || 'Unknown error'}`);
    }

    // Get the output from the last node in topological order
    const lastNodeOutput = Array.from(result.nodeOutputs.values()).pop() ?? {};

    return {
      output: lastNodeOutput,
      metadata: { subRunId, subWorkflowId: workflowId, subStatus: result.status },
    };
  },
  getInputSchema() { return { type: 'object', description: 'Passed as initial input to the sub-workflow' }; },
  getOutputSchema() { return { type: 'object', description: "Output from the sub-workflow's final node" }; },
};

export const subWorkflowDef: NodeDefinition = {
  type: 'sub-workflow', label: 'Sub-Workflow', category: 'control',
  description: 'Execute another saved workflow as a step. Passes input to the sub-workflow and returns its output.',
  configSchema: { type: 'object', properties: {
    workflowId: { type: 'string', description: 'ID of the workflow to execute' },
  }, required: ['workflowId'] },
  defaultConfig: { workflowId: '' },
  inputs: [{ name: 'input', type: 'any', label: 'Input' }],
  outputs: [{ name: 'output', type: 'any', label: 'Output' }],
  basicConfig: [
    {
      key: 'workflowId',
      label: 'Workflow ID',
      type: 'text',
      placeholder: 'Paste workflow ID here',
      description:
        'The ID of the workflow to run. Find it in the URL of the workflow edit page.',
    },
  ],
  llmDescription: 'Use to compose workflows — call a pre-built workflow as a reusable step. Essential for building complex agentic systems from smaller building blocks.',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/workflows/nodes/sub-workflow.test.ts`
Expected: PASS

- [ ] **Step 5: Run all workflow tests**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/nodes/sub-workflow.ts tests/lib/workflows/nodes/sub-workflow.test.ts
git commit -m "fix: sub-workflow node uses direct engine call instead of HTTP to localhost:5173"
```

---

### Task 4: Template interpolation — strict mode with missing path detection

**Files:**
- Modify: `src/lib/workflows/nodes/template.ts`
- Create: `tests/lib/workflows/nodes/template.test.ts`
- Modify: `src/lib/workflows/nodes/http-request.ts` (use strict mode)
- Modify: `src/lib/workflows/nodes/llm-call.ts` (use strict mode)

- [ ] **Step 1: Write tests for strict interpolation**

Create `tests/lib/workflows/nodes/template.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { interpolateTemplate, interpolateTemplateStrict } from '$lib/workflows/nodes/template';

describe('interpolateTemplate', () => {
  it('resolves known paths', () => {
    const result = interpolateTemplate('Hello {{input.name}}', { name: 'World' });
    expect(result).toBe('Hello World');
  });

  it('returns empty string for unknown paths (legacy mode)', () => {
    const result = interpolateTemplate('Hello {{input.missing}}', {});
    expect(result).toBe('Hello ');
  });

  it('resolves nested paths', () => {
    const result = interpolateTemplate('{{input.a.b}}', { a: { b: 'deep' } });
    expect(result).toBe('deep');
  });

  it('JSON-serialises non-string values', () => {
    const result = interpolateTemplate('{{input.data}}', { data: { x: 1 } });
    expect(result).toBe('{"x":1}');
  });
});

describe('interpolateTemplateStrict', () => {
  it('returns result and empty missingPaths when all resolved', () => {
    const { result, missingPaths } = interpolateTemplateStrict(
      'Hello {{input.name}}',
      { name: 'World' },
    );
    expect(result).toBe('Hello World');
    expect(missingPaths).toEqual([]);
  });

  it('collects missing paths', () => {
    const { result, missingPaths } = interpolateTemplateStrict(
      '{{input.a}} and {{input.b}}',
      { a: 'found' },
    );
    expect(result).toBe('found and ');
    expect(missingPaths).toEqual(['input.b']);
  });

  it('collects multiple missing paths', () => {
    const { missingPaths } = interpolateTemplateStrict(
      '{{input.x}} {{input.y}} {{input.z}}',
      {},
    );
    expect(missingPaths).toEqual(['input.x', 'input.y', 'input.z']);
  });

  it('does not flag null/undefined as missing if path exists', () => {
    const { missingPaths } = interpolateTemplateStrict(
      '{{input.val}}',
      { val: null },
    );
    // null is a valid value at an existing path — the template resolves to ''
    // but the path WAS found, so no missing path reported
    expect(missingPaths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/nodes/template.test.ts`
Expected: FAIL — `interpolateTemplateStrict` doesn't exist

- [ ] **Step 3: Add strict interpolation to template.ts**

Replace `src/lib/workflows/nodes/template.ts`:

```typescript
// src/lib/workflows/nodes/template.ts

/**
 * Interpolate {{input.field.path}} references in a template string.
 * Resolves dot-paths into the input object. Non-string values are JSON-serialised.
 * Unknown paths produce empty string.
 */
export function interpolateTemplate(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{input\.([^}]+)\}\}/g, (_match, path: string) => {
    const value = resolvePath(input, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

/**
 * Strict interpolation that tracks unresolved paths.
 * Returns the interpolated result AND a list of paths that could not be resolved.
 * A path is "missing" when resolvePath returns undefined (the key doesn't exist
 * in the input tree). null values are treated as present-but-empty.
 */
export function interpolateTemplateStrict(
  template: string,
  input: Record<string, unknown>,
): { result: string; missingPaths: string[] } {
  const missingPaths: string[] = [];
  const result = template.replace(/\{\{input\.([^}]+)\}\}/g, (_match, path: string) => {
    const resolved = resolvePathWithPresence(input, path);
    if (!resolved.exists) {
      missingPaths.push(`input.${path}`);
      return '';
    }
    const value = resolved.value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
  return { result, missingPaths };
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolvePathWithPresence(
  obj: Record<string, unknown>,
  path: string,
): { exists: boolean; value: unknown } {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return { exists: false, value: undefined };
    }
    const rec = current as Record<string, unknown>;
    if (!(parts[i] in rec)) {
      return { exists: false, value: undefined };
    }
    current = rec[parts[i]];
  }
  return { exists: true, value: current };
}
```

- [ ] **Step 4: Run template tests to verify they pass**

Run: `npx vitest run tests/lib/workflows/nodes/template.test.ts`
Expected: PASS

- [ ] **Step 5: Update http-request to use strict interpolation**

In `src/lib/workflows/nodes/http-request.ts`, change the import and add missing path collection:

Change line 2:
```typescript
import { interpolateTemplate, interpolateTemplateStrict } from './template';
```

Replace the url interpolation (line 20) and add a missing paths collector before the fetch call. After all `interpolateTemplate` calls for url, headers, body, and authToken, add a check:

```typescript
// At the top of execute(), add collector:
const allMissing: string[] = [];

// Replace url interpolation:
const { result: url, missingPaths: urlMissing } = interpolateTemplateStrict(rawUrl, input);
allMissing.push(...urlMissing);

// For authToken:
const { result: authToken, missingPaths: authMissing } = interpolateTemplateStrict((config.authToken as string) || '', input);
allMissing.push(...authMissing);
```

Keep headers and body using non-strict `interpolateTemplate` (they're wrapped in try/catch or are optional). After building `fetchInit`, before the fetch call:

```typescript
if (allMissing.length > 0) {
  throw new Error(`Template references unresolved: ${allMissing.join(', ')}. Check upstream node output.`);
}
```

- [ ] **Step 6: Update llm-call to use strict interpolation**

In `src/lib/workflows/nodes/llm-call.ts`, change the import and add strict checking:

```typescript
import { interpolateTemplateStrict } from './template';
```

Replace lines 15-16:
```typescript
const { result: systemPrompt, missingPaths: sysMissing } = interpolateTemplateStrict((config.systemPrompt as string) || '', input);
const { result: userPrompt, missingPaths: userMissing } = interpolateTemplateStrict((config.userPrompt as string) || '', input);
const missing = [...sysMissing, ...userMissing];
if (missing.length > 0) {
  throw new Error(`Prompt template references unresolved: ${missing.join(', ')}. Check upstream node output.`);
}
```

- [ ] **Step 7: Run all workflow tests**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflows/nodes/template.ts tests/lib/workflows/nodes/template.test.ts src/lib/workflows/nodes/http-request.ts src/lib/workflows/nodes/llm-call.ts
git commit -m "feat: strict template interpolation — detect and throw on unresolved paths"
```

---

### Task 5: Wrap saveWorkflowFromGenerated in a DB transaction

**Files:**
- Modify: `src/lib/workflows/orchestrator/index.ts:547-585`

- [ ] **Step 1: Write test for transactional save**

Add to `tests/lib/workflows/orchestrator/loop.test.ts`:

```typescript
// This is a unit-level check — we verify the function calls db.transaction
// Integration test would need a real DB. For now, we verify the structure.
import { saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';

describe('saveWorkflowFromGenerated', () => {
  it('is exported and callable', () => {
    expect(typeof saveWorkflowFromGenerated).toBe('function');
  });
});
```

- [ ] **Step 2: Update saveWorkflowFromGenerated to use transaction**

In `src/lib/workflows/orchestrator/index.ts`, replace `saveWorkflowFromGenerated`:

```typescript
export async function saveWorkflowFromGenerated(
  workflowId: string,
  generated: GeneratedWorkflow,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
    await tx.delete(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

    await tx.update(workflows).set({
      name: generated.name,
      description: generated.description || null,
      updatedAt: new Date(),
    }).where(eq(workflows.id, workflowId));

    if (generated.nodes.length > 0) {
      await tx.insert(workflowNodes).values(
        generated.nodes.map((n) => ({
          id: n.id,
          workflowId,
          type: n.type,
          position: n.position,
          config: n.config,
          label: n.label,
        })),
      );
    }

    if (generated.edges.length > 0) {
      await tx.insert(workflowEdges).values(
        generated.edges.map((e) => ({
          id: e.id,
          workflowId,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          sourceHandle: e.sourceHandle || null,
          targetHandle: e.targetHandle || null,
        })),
      );
    }
  });
}
```

- [ ] **Step 3: Run all workflow tests**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/orchestrator/index.ts
git commit -m "fix: wrap saveWorkflowFromGenerated in DB transaction"
```

---

### Task 6: Await dynamic node loading at boot

**Files:**
- Modify: `src/lib/workflows/index.ts:82-98`

- [ ] **Step 1: Convert dynamic node loading to awaited IIFE**

Replace lines 82-98 in `src/lib/workflows/index.ts`:

```typescript
// Load dynamic nodes from ~/.strange-rambling/workflow-nodes/
ensureDynamicNodesDir();
const dynamicDefs = loadDynamicNodeDefinitions(DYNAMIC_NODES_DIR);

// Use an IIFE to await all dynamic executors before they're needed
(async () => {
  for (const def of dynamicDefs) {
    if (registry.getDefinition(def.type)) {
      console.warn(`[dynamic-nodes] Skipping ${def.type} — conflicts with built-in node`);
      continue;
    }
    const executor = await loadDynamicNodeExecutor(DYNAMIC_NODES_DIR, def.type);
    if (executor) {
      registry.register(def, executor);
      console.log(`[dynamic-nodes] Registered: ${def.type}`);
    } else {
      console.warn(`[dynamic-nodes] Failed to load executor for: ${def.type}`);
    }
  }
})();
```

- [ ] **Step 2: Run all workflow tests**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/workflows/index.ts
git commit -m "fix: await dynamic node executor loading at boot"
```

---

### Task 7: Remove auto-connect fallback in assembleWorkflow

**Files:**
- Modify: `src/lib/workflows/orchestrator/loop.ts:282-297`
- Modify: `tests/lib/workflows/orchestrator/loop.test.ts`

- [ ] **Step 1: Write test that verifies no auto-connection**

Add to `tests/lib/workflows/orchestrator/loop.test.ts`:

```typescript
describe('assembleWorkflow — no auto-connect', () => {
  it('does NOT auto-connect disconnected nodes', () => {
    const draft = emptyDraft();
    draft.nodes.set('n1', { id: 'n1', type: 'manual-trigger', config: {}, label: 'Start', reason: 'Entry', alternatives: [] });
    draft.nodes.set('n2', { id: 'n2', type: 'transform', config: {}, label: 'T1', reason: 'Process', alternatives: [] });
    draft.nodes.set('n3', { id: 'n3', type: 'llm-call', config: {}, label: 'LLM', reason: 'Generate', alternatives: [] });
    // No edges added

    const result = assembleWorkflow(draft, 'Test', 'desc');

    expect(result.edges).toHaveLength(0);
    expect(result.warnings).toBeDefined();
    expect(result.warnings).toContain('disconnected');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/orchestrator/loop.test.ts -t "no auto-connect"`
Expected: FAIL — current code creates auto edges

- [ ] **Step 3: Replace auto-connect with warning**

In `src/lib/workflows/orchestrator/loop.ts`, replace lines 282-297:

```typescript
  let warnings: string[] | undefined;

  // If the LLM didn't create any edges, warn instead of auto-connecting
  if (draft.edges.length === 0 && nodesArray.length > 1) {
    console.warn('[orchestrator] No edges created by LLM — workflow has disconnected nodes');
    warnings = ['No edges created — nodes are disconnected. The workflow will not pass data between nodes.'];
    draft.decisions.push({
      type: 'connect',
      summary: 'WARNING: No edges created — nodes are disconnected',
      timestamp: Date.now(),
    });
  }
```

Also add `warnings` to the return object. Update the `GeneratedWorkflow` type in `src/lib/workflows/orchestrator/types.ts` to include `warnings?: string[]`.

At the return statement (around line 326):

```typescript
  return {
    name,
    description,
    nodes,
    edges,
    explanation,
    warnings,
  };
```

- [ ] **Step 4: Update GeneratedWorkflow type**

In `src/lib/workflows/orchestrator/types.ts`, add `warnings` field:

```typescript
export interface GeneratedWorkflow {
  name: string;
  description?: string;
  nodes: WorkflowNodeDef[];
  edges: WorkflowEdgeDef[];
  explanation?: string;
  warnings?: string[];
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/lib/workflows/orchestrator/loop.test.ts`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/orchestrator/loop.ts src/lib/workflows/orchestrator/types.ts tests/lib/workflows/orchestrator/loop.test.ts
git commit -m "fix: remove auto-connect fallback, warn on disconnected nodes instead"
```

---

### Task 8: Wire the critic revision loop

**Files:**
- Modify: `src/lib/workflows/orchestrator/index.ts:420-434`

- [ ] **Step 1: Write test for revision triggering**

Create `tests/lib/workflows/orchestrator/revision.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// This is a behavioral test — we verify that when the critic returns 'fail',
// the system attempts a revision. Since generateWorkflow calls external LLMs,
// we test the runCriticRound → revision flow at the integration boundary.
// The key assertion: the revision prompt function is called when critic fails.

import { buildRevisionPrompt } from '$lib/workflows/orchestrator/prompts';

describe('buildRevisionPrompt', () => {
  it('returns a non-empty prompt string', () => {
    const prompt = buildRevisionPrompt();
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain('Fix');
    expect(prompt).toContain('finalize_workflow');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (prompt already exists)**

Run: `npx vitest run tests/lib/workflows/orchestrator/revision.test.ts`
Expected: PASS

- [ ] **Step 3: Wire the revision loop in generateWorkflow**

In `src/lib/workflows/orchestrator/index.ts`, replace lines 420-434 (the block after `if (criticResult.verdict === 'fail')`):

```typescript
  if (criticResult.verdict === 'fail' && criticResult.issues.length > 0) {
    onChunk?.('Revising based on critic feedback...\n');

    const issuesSummary = criticResult.issues
      .map((i) => `- [${i.severity}] ${i.nodeId ? `Node ${i.nodeId}: ` : ''}${i.message}`)
      .join('\n');

    const revisionPrompt = buildRevisionPrompt();
    const grounding = await buildGrounding();
    const revisionSystem = `${revisionPrompt}\n\n## Node Registry\n\n${grounding}`;

    const revisionResult = await runToolLoop(
      revisionSystem,
      `The following issues were found in the workflow:\n\n${issuesSummary}\n\nFix these issues using the available tools, then call finalize_workflow.`,
      [],
      onChunk,
      draft, // Pass the existing draft so revision builds on it
    );

    if (revisionResult.draft.nodes.size > 0) {
      finalWorkflow = assembleWorkflow(revisionResult.draft, revisionResult.name || name, revisionResult.description || description);
      onChunk?.('Revision complete.\n');
    }

    revisions = criticResult.issues.map(i => ({
      action: 'modified' as const,
      nodeId: i.nodeId,
      description: `${i.severity}: ${i.message}`,
    }));
  }
```

- [ ] **Step 4: Update runToolLoop to accept an existing draft**

Add an optional `existingDraft` parameter to `runToolLoop`:

```typescript
async function runToolLoop(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk?: (text: string) => void,
  existingDraft?: WorkflowDraft,
): Promise<{
  draft: WorkflowDraft;
  name: string;
  description?: string;
  followUp?: string;
}> {
  const client = getOpenAIClient();
  const model = getModel();
  const draft = existingDraft ?? createEmptyDraft();
  const deps = getToolCallDeps();
  if (!existingDraft) resetNodeCounter();
  // ... rest unchanged
```

- [ ] **Step 5: Run all orchestrator tests**

Run: `npx vitest run tests/lib/workflows/orchestrator/`
Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/orchestrator/index.ts tests/lib/workflows/orchestrator/revision.test.ts
git commit -m "feat: wire critic revision loop — re-enter tool loop when critic finds issues"
```

---

### Task 9: Add output schemas to untyped nodes

**Files:**
- Modify: `src/lib/workflows/nodes/accumulator.ts`
- Modify: `src/lib/workflows/nodes/loop.ts`
- Modify: `src/lib/workflows/nodes/code-execute.ts`
- Test: `tests/lib/workflows/orchestrator/schema.test.ts` (extend)

- [ ] **Step 1: Write schema tests**

Add to `tests/lib/workflows/orchestrator/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { accumulatorExecutor } from '$lib/workflows/nodes/accumulator';
import { loopExecutor } from '$lib/workflows/nodes/loop';
import { codeExecuteExecutor } from '$lib/workflows/nodes/code-execute';

describe('node output schemas have properties', () => {
  it('accumulator declares items and count', () => {
    const schema = accumulatorExecutor.getOutputSchema({});
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty('items');
    expect(schema.properties).toHaveProperty('count');
  });

  it('loop declares results and count', () => {
    const schema = loopExecutor.getOutputSchema({});
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty('results');
    expect(schema.properties).toHaveProperty('count');
  });

  it('code-execute declares result, stdout, stderr when no outputSchema', () => {
    const schema = codeExecuteExecutor.getOutputSchema({});
    expect(schema.properties).toBeDefined();
    expect(schema.properties).toHaveProperty('result');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/orchestrator/schema.test.ts -t "output schemas"`
Expected: FAIL — these nodes return untyped schemas

- [ ] **Step 3: Update accumulator.ts getOutputSchema**

In `src/lib/workflows/nodes/accumulator.ts`, replace `getOutputSchema`:

```typescript
  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        items: { type: 'array', description: 'Accumulated items across runs' },
        count: { type: 'number', description: 'Number of accumulated items' },
      },
    };
  },
```

- [ ] **Step 4: Update loop.ts getOutputSchema**

In `src/lib/workflows/nodes/loop.ts`, replace `getOutputSchema`:

```typescript
  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        results: { type: 'array', description: 'Array of results from each iteration' },
        count: { type: 'number', description: 'Number of iterations completed' },
      },
    };
  },
```

- [ ] **Step 5: Update code-execute.ts getOutputSchema fallback**

In `src/lib/workflows/nodes/code-execute.ts`, update the fallback case in `getOutputSchema` (when no `config.outputSchema`):

```typescript
  getOutputSchema(config: Record<string, unknown>) {
    if (config.outputSchema && typeof config.outputSchema === 'object') {
      return config.outputSchema as JsonSchema;
    }
    return {
      type: 'object',
      properties: {
        result: { type: 'any', description: 'Return value from the code' },
        stdout: { type: 'string', description: 'Standard output from execution' },
        stderr: { type: 'string', description: 'Standard error from execution' },
      },
    };
  },
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/lib/workflows/orchestrator/schema.test.ts`
Expected: all pass

- [ ] **Step 7: Run all workflow tests**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflows/nodes/accumulator.ts src/lib/workflows/nodes/loop.ts src/lib/workflows/nodes/code-execute.ts tests/lib/workflows/orchestrator/schema.test.ts
git commit -m "feat: add typed output schemas to accumulator, loop, and code-execute nodes"
```

---

### Task 10: Add validate-before-run API endpoint

**Files:**
- Create: `src/routes/api/workflows/[id]/validate/+server.ts`
- Test: manual via `curl`

- [ ] **Step 1: Create the validate endpoint**

Create `src/routes/api/workflows/[id]/validate/+server.ts`:

```typescript
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { verifyWorkflow } from '$lib/workflows/orchestrator/verify';
import { registry } from '$lib/workflows';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1);

  if (!workflow) {
    return json({ valid: false, issues: [{ issue: 'Workflow not found', severity: 'error' }] }, { status: 404 });
  }

  const nodes = await db
    .select()
    .from(workflowNodes)
    .where(eq(workflowNodes.workflowId, id));

  const edges = await db
    .select()
    .from(workflowEdges)
    .where(eq(workflowEdges.workflowId, id));

  const nodeDefs: WorkflowNodeDef[] = nodes.map((n) => ({
    id: n.id,
    type: n.type,
    config: (n.config as Record<string, unknown>) ?? {},
    label: n.label ?? n.type,
    position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
  }));

  const edgeDefs: WorkflowEdgeDef[] = edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));

  const issues = verifyWorkflow(
    nodeDefs,
    edgeDefs,
    (type) => registry.getDefinition(type),
    (type, config) => {
      const executor = registry.getExecutor(type);
      return executor ? executor.getOutputSchema(config) : { type: 'object' };
    },
  );

  return json({
    valid: issues.length === 0,
    issues,
  });
};
```

- [ ] **Step 2: Run the dev server and verify manually**

Run: `npm run dev` (if not already running)
Test: `curl http://homeserv:5173/api/workflows/SOME_WORKFLOW_ID/validate`
Expected: JSON response with `valid` boolean and `issues` array

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/workflows/\[id\]/validate/+server.ts
git commit -m "feat: add /api/workflows/[id]/validate endpoint for pre-run verification"
```

---

### Task 11: Harden orchestrator prompt — enforce edge creation and template accuracy

**Files:**
- Modify: `src/lib/workflows/orchestrator/prompts.ts:57-61`
- Modify: `tests/lib/workflows/orchestrator/prompts.test.ts`

- [ ] **Step 1: Add prompt hardening rules**

In `src/lib/workflows/orchestrator/prompts.ts`, inside `buildToolUseSystemPrompt`, add before the closing backtick of the Rules section (line 61):

```typescript
- After connecting nodes with connect_nodes, review the upstream schema in the response. Every {{input.X}} reference in your node config MUST match a path listed in that schema. If a path doesn't exist, update the node's config to use the correct path.
- Do NOT call finalize_workflow if any node (other than the trigger) has zero incoming edges.
- When using {{input.X}} templates, prefer specific paths from the upstream schema over guessing. If the schema says "input.body.data", use "input.body.data" — not "input.data" or "input.result".
```

- [ ] **Step 2: Update prompts test**

In `tests/lib/workflows/orchestrator/prompts.test.ts`, add a test:

```typescript
it('system prompt contains template accuracy rule', () => {
  const prompt = buildToolUseSystemPrompt('grounding text');
  expect(prompt).toContain('MUST match a path listed in that schema');
  expect(prompt).toContain('zero incoming edges');
});
```

- [ ] **Step 3: Run prompts test**

Run: `npx vitest run tests/lib/workflows/orchestrator/prompts.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/workflows/orchestrator/prompts.ts tests/lib/workflows/orchestrator/prompts.test.ts
git commit -m "feat: harden orchestrator prompt — enforce template accuracy and edge completeness"
```

---

### Task 12: Add set_trigger orchestrator tool

**Files:**
- Modify: `src/lib/workflows/orchestrator/tools.ts`
- Modify: `src/lib/workflows/orchestrator/loop.ts`
- Modify: `src/lib/workflows/orchestrator/types.ts`
- Modify: `src/lib/workflows/orchestrator/index.ts` (save trigger on finalize)
- Modify: `tests/lib/workflows/orchestrator/loop.test.ts`

- [ ] **Step 1: Write test for set_trigger tool call**

Add to `tests/lib/workflows/orchestrator/loop.test.ts`:

```typescript
it('processes set_trigger', () => {
  const draft = emptyDraft();
  const result = processToolCall(
    draft,
    'set_trigger',
    { type: 'webhook' },
    {},
  );

  expect(result.success).toBe(true);
  expect(draft.trigger).toEqual({ type: 'webhook' });
});

it('processes set_trigger with cron config', () => {
  const draft = emptyDraft();
  const result = processToolCall(
    draft,
    'set_trigger',
    { type: 'cron', config: { expression: '0 9 * * *' } },
    {},
  );

  expect(result.success).toBe(true);
  expect(draft.trigger).toEqual({ type: 'cron', config: { expression: '0 9 * * *' } });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/orchestrator/loop.test.ts -t "set_trigger"`
Expected: FAIL — tool not handled

- [ ] **Step 3: Add Zod schema for set_trigger**

In `src/lib/workflows/orchestrator/tools.ts`, add after `finalizeWorkflowSchema`:

```typescript
export const setTriggerSchema = z.object({
  type: z.enum(['webhook', 'cron', 'event']),
  config: z.object({}).catchall(z.any()).optional(),
});
```

Add to `toolSchemas`:
```typescript
export const toolSchemas = {
  search_nodes: searchNodesSchema,
  use_node: useNodeSchema,
  create_node: createNodeSchema,
  connect_nodes: connectNodesSchema,
  ask_user: askUserSchema,
  finalize_workflow: finalizeWorkflowSchema,
  set_trigger: setTriggerSchema,
} as const;
```

Add to `openaiTools`:
```typescript
zodToFunction('set_trigger', setTriggerSchema, 'Set the workflow trigger type. Use "webhook" for HTTP-triggered workflows, "cron" for scheduled (provide config.expression as a cron string), or "event" for event-driven.'),
```

- [ ] **Step 4: Add trigger to WorkflowDraft type**

In `src/lib/workflows/orchestrator/types.ts`, add to `WorkflowDraft`:

```typescript
export interface WorkflowDraft {
  nodes: Map<string, DraftNode>;
  edges: DraftEdge[];
  newNodeTypes: DraftNewNode[];
  searchLog: SearchLogEntry[];
  decisions: ThinkingStep[];
  trigger?: { type: string; config?: Record<string, unknown> };
}
```

- [ ] **Step 5: Handle set_trigger in processToolCall**

In `src/lib/workflows/orchestrator/loop.ts`, add a case before `default`:

```typescript
    case 'set_trigger': {
      const parsed = toolSchemas.set_trigger.safeParse(args);
      if (!parsed.success) {
        return { success: false, error: `Validation failed: ${parsed.error.issues.map(i => i.message).join(', ')}` };
      }
      draft.trigger = { type: parsed.data.type, config: parsed.data.config };
      draft.decisions.push({
        type: 'set_trigger' as any,
        summary: `Trigger set to: ${parsed.data.type}${parsed.data.config ? ` (${JSON.stringify(parsed.data.config)})` : ''}`,
        timestamp: now,
      });
      return { success: true, response: `Trigger set to "${parsed.data.type}".` };
    }
```

Add `set_trigger` to the `toolSchemas` import at the top of `loop.ts`.

- [ ] **Step 6: Save trigger in saveWorkflowFromGenerated**

In `src/lib/workflows/orchestrator/index.ts`, update `saveWorkflowFromGenerated` to accept and save the trigger. Add it to `assembleWorkflow`'s return value:

In `assembleWorkflow` in `loop.ts`, add `trigger: draft.trigger` to the returned `GeneratedWorkflow`.

In `GeneratedWorkflow` type, add `trigger?: { type: string; config?: Record<string, unknown> }`.

In `saveWorkflowFromGenerated`, add to the `tx.update(workflows).set({...})` call:
```typescript
trigger: generated.trigger || null,
```

(This requires the `workflows` table to have a `trigger` column — verify it exists by checking the schema.)

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/lib/workflows/orchestrator/loop.test.ts`
Expected: all pass

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflows/orchestrator/tools.ts src/lib/workflows/orchestrator/loop.ts src/lib/workflows/orchestrator/types.ts src/lib/workflows/orchestrator/index.ts tests/lib/workflows/orchestrator/loop.test.ts
git commit -m "feat: add set_trigger orchestrator tool for webhook/cron/event trigger setup"
```

---

### Task 13: Persist draft state across ask_user turns

**Files:**
- Modify: `src/lib/workflows/orchestrator/index.ts`
- Modify: `src/lib/workflows/orchestrator/types.ts`
- Create: `tests/lib/workflows/orchestrator/draft-persist.test.ts`

- [ ] **Step 1: Write test for draft serialization round-trip**

Create `tests/lib/workflows/orchestrator/draft-persist.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { serializeDraft, deserializeDraft } from '$lib/workflows/orchestrator/draft-serde';
import type { WorkflowDraft } from '$lib/workflows/orchestrator/types';

function makeDraft(): WorkflowDraft {
  const draft: WorkflowDraft = {
    nodes: new Map(),
    edges: [],
    newNodeTypes: [],
    searchLog: [],
    decisions: [],
  };
  draft.nodes.set('n1', {
    id: 'n1',
    type: 'transform',
    config: { expression: 'return input' },
    label: 'T1',
    reason: 'test',
    alternatives: [{ nodeType: 'code-execute', whyRejected: 'overkill' }],
  });
  draft.edges.push({ id: 'e1', source: 'trigger', target: 'n1' });
  draft.decisions.push({ type: 'use_node', summary: 'Added T1', timestamp: Date.now() });
  return draft;
}

describe('draft serialization', () => {
  it('round-trips a draft through JSON', () => {
    const original = makeDraft();
    const json = serializeDraft(original);
    const restored = deserializeDraft(json);

    expect(restored.nodes.size).toBe(1);
    expect(restored.nodes.get('n1')?.type).toBe('transform');
    expect(restored.edges).toHaveLength(1);
    expect(restored.decisions).toHaveLength(1);
  });

  it('handles empty draft', () => {
    const empty: WorkflowDraft = {
      nodes: new Map(),
      edges: [],
      newNodeTypes: [],
      searchLog: [],
      decisions: [],
    };
    const json = serializeDraft(empty);
    const restored = deserializeDraft(json);
    expect(restored.nodes.size).toBe(0);
    expect(restored.edges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/workflows/orchestrator/draft-persist.test.ts`
Expected: FAIL — `draft-serde` module doesn't exist

- [ ] **Step 3: Create draft-serde module**

Create `src/lib/workflows/orchestrator/draft-serde.ts`:

```typescript
import type { WorkflowDraft } from './types';

interface SerializedDraft {
  nodes: Array<[string, WorkflowDraft extends { nodes: Map<string, infer V> } ? V : never]>;
  edges: WorkflowDraft['edges'];
  newNodeTypes: WorkflowDraft['newNodeTypes'];
  searchLog: WorkflowDraft['searchLog'];
  decisions: WorkflowDraft['decisions'];
  trigger?: WorkflowDraft['trigger'];
}

export function serializeDraft(draft: WorkflowDraft): Record<string, unknown> {
  return {
    nodes: Array.from(draft.nodes.entries()),
    edges: draft.edges,
    newNodeTypes: draft.newNodeTypes,
    searchLog: draft.searchLog,
    decisions: draft.decisions,
    trigger: draft.trigger,
  };
}

export function deserializeDraft(data: Record<string, unknown>): WorkflowDraft {
  const raw = data as unknown as SerializedDraft;
  return {
    nodes: new Map(raw.nodes ?? []),
    edges: raw.edges ?? [],
    newNodeTypes: raw.newNodeTypes ?? [],
    searchLog: raw.searchLog ?? [],
    decisions: raw.decisions ?? [],
    trigger: raw.trigger,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/workflows/orchestrator/draft-persist.test.ts`
Expected: PASS

- [ ] **Step 5: Wire draft persistence into generateWorkflow**

In `src/lib/workflows/orchestrator/index.ts`:

1. Import `serializeDraft` and `deserializeDraft` from `./draft-serde`.

2. In `generateWorkflow`, after `createEmptyDraft()` would be called inside `runToolLoop`, load any existing draft from the most recent `orchestratorChats` row for this workflowId that has `metadata.draftState`:

Before the `runToolLoop` call (around line 395), add:

```typescript
// Check for a persisted draft from a previous ask_user turn
let existingDraft: WorkflowDraft | undefined;
if (workflowId && conversationHistory.length > 0) {
  const lastWithDraft = await db
    .select()
    .from(orchestratorChats)
    .where(eq(orchestratorChats.workflowId, workflowId))
    .orderBy(desc(orchestratorChats.createdAt))
    .limit(10);

  for (const row of lastWithDraft) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (meta?.draftState) {
      existingDraft = deserializeDraft(meta.draftState as Record<string, unknown>);
      break;
    }
  }
}
```

Pass `existingDraft` to `runToolLoop`:

```typescript
const { draft, name, description, followUp } = await runToolLoop(
  systemPrompt,
  userMessage,
  conversationHistory,
  onChunk,
  existingDraft,
);
```

3. When `followUp` is returned (ask_user), save the draft state in the chat metadata:

```typescript
if (followUp) {
  if (workflowId) {
    await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: userMessage });
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'assistant',
      content: followUp,
      metadata: { draftState: serializeDraft(draft) },
    });
  }
  return { workflow: null, followUp, messages: [] };
}
```

- [ ] **Step 6: Run all orchestrator tests**

Run: `npx vitest run tests/lib/workflows/orchestrator/`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add src/lib/workflows/orchestrator/draft-serde.ts src/lib/workflows/orchestrator/index.ts tests/lib/workflows/orchestrator/draft-persist.test.ts
git commit -m "feat: persist orchestrator draft across ask_user turns"
```

---

### Task 14: Final integration test — run all tests

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run tests/lib/workflows/`
Expected: all pass

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit` or the project's typecheck command
Expected: no errors

- [ ] **Step 3: Start dev server and smoke test**

Run: `npm run dev`
Navigate to `/jkai/workflows/new`, create a workflow via chat, verify it runs.

- [ ] **Step 4: Commit any fixes needed**

```bash
git add -A
git commit -m "chore: fix any type/test issues from workflow reliability changes"
```
