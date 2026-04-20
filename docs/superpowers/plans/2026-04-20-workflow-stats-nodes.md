# Workflow Statistics Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three display-only canvas nodes (`stats-summary`, `stats-trends`, `stats-per-node`) that show run statistics and recent edits for a single canvas, driven by a shared URL-bound time-period filter in the toolbar.

**Architecture:** New Drizzle table `workflow_audit_log` is populated from existing mutation endpoints via a small `recordAudit()` helper. Three new API endpoints under `/api/canvas/[slug]/stats/{summary,trends,per-node}` aggregate from `workflow_runs`, `node_executions`, and `workflow_audit_log`. Three new Svelte components render the nodes, using the existing `layerchart` dependency for charts. Stats nodes are filtered out of the execution pipeline at the two call sites (`/run` endpoint and `scheduler.ts`); edges to/from stats nodes are rejected at the edge-create endpoint.

**Tech Stack:** SvelteKit 2 / Svelte 5 (runes), Drizzle ORM (Postgres), layerchart, Vitest.

**Reference spec:** `docs/superpowers/specs/2026-04-20-workflow-stats-nodes-design.md`

---

## File Structure

**Create:**
- `src/lib/canvas/audit.ts` — `recordAudit()` helper
- `src/lib/canvas/audit-diff.ts` — pure diff helpers used by PATCH routes
- `src/lib/canvas/stats/resolvePeriod.ts` — URL preset → `{from, to, granularity}`
- `src/lib/canvas/stats/format.ts` — ms / date formatting helpers
- `src/lib/canvas/stats/useStats.svelte.ts` — rune-based fetch helper
- `src/lib/canvas/stats/TimeFilter.svelte` — toolbar dropdown
- `src/lib/canvas/stats/SummaryNode.svelte`
- `src/lib/canvas/stats/TrendsNode.svelte`
- `src/lib/canvas/stats/PerNodeNode.svelte`
- `src/routes/api/canvas/[slug]/stats/summary/+server.ts`
- `src/routes/api/canvas/[slug]/stats/trends/+server.ts`
- `src/routes/api/canvas/[slug]/stats/per-node/+server.ts`
- `tests/lib/canvas/audit-diff.test.ts`
- `tests/lib/canvas/stats/resolvePeriod.test.ts`
- `tests/lib/canvas/stats/format.test.ts`
- `tests/lib/db/audit-schema.test.ts`

**Modify:**
- `src/lib/db/schema.ts` — add `workflowAuditLog` table
- `src/lib/canvas/adapter.ts` — add `'stats'` NodeKind, three entries under new `'Observability'` group, `mapTypeToKind` cases
- `src/routes/api/workflows/[id]/nodes/+server.ts` — audit on POST
- `src/routes/api/workflows/[id]/nodes/[nodeId]/+server.ts` — audit on PATCH / DELETE (filter position + `config.size`)
- `src/routes/api/workflows/[id]/edges/+server.ts` — audit on POST / DELETE; reject edges touching stats nodes
- `src/routes/api/workflows/[id]/+server.ts` — audit name/description changes on PUT (only)
- `src/routes/api/workflows/[id]/trigger/+server.ts` — audit on PUT
- `src/routes/api/workflows/[id]/run/+server.ts` — filter stats nodes from execution pipeline
- `src/lib/workflows/scheduler.ts` — filter stats nodes from execution pipeline
- `src/routes/jkai/canvas/[slug]/+page.svelte` — render stats nodes, toolbar TimeFilter, period wiring, scroll-to-node, disable edge drag from stats nodes
- `tests/lib/workflows/engine.test.ts` — new test: stats nodes are not passed into the engine via the filtered definition (this lives in a new integration-style test file since the filtering happens in the route/scheduler, not the engine itself)

**Schema migration:** `npx drizzle-kit push` after Task 1 adds the table.

---

## Task 1: Database schema — workflow_audit_log

**Files:**
- Modify: `src/lib/db/schema.ts`
- Create: `tests/lib/db/audit-schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Create `tests/lib/db/audit-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { workflowAuditLog } from '$lib/db/schema';

describe('workflowAuditLog schema', () => {
  it('has expected columns', () => {
    expect(workflowAuditLog.id).toBeDefined();
    expect(workflowAuditLog.workflowId).toBeDefined();
    expect(workflowAuditLog.entity).toBeDefined();
    expect(workflowAuditLog.entityId).toBeDefined();
    expect(workflowAuditLog.action).toBeDefined();
    expect(workflowAuditLog.details).toBeDefined();
    expect(workflowAuditLog.at).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/db/audit-schema.test.ts`
Expected: FAIL — `workflowAuditLog` not exported.

- [ ] **Step 3: Add the table to schema**

In `src/lib/db/schema.ts`, add after the `nodeExecutions` table (around line 630):

```ts
export const workflowAuditLog = pgTable(
  'workflow_audit_log',
  {
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    workflowId: text('workflow_id')
      .notNull()
      .references(() => workflows.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(), // 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule'
    entityId: text('entity_id'),
    action: text('action').notNull(), // 'create' | 'delete' | 'rename' | 'config' | 'update'
    details: jsonb('details').notNull().default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byWorkflowAt: index('workflow_audit_log_workflow_at_idx').on(t.workflowId, t.at.desc()),
  }),
);

export type WorkflowAuditLog = typeof workflowAuditLog.$inferSelect;
export type NewWorkflowAuditLog = typeof workflowAuditLog.$inferInsert;
```

If `index` is not yet imported at the top of the file, add it to the existing `drizzle-orm/pg-core` import list.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/db/audit-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Push schema to dev DB**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit push`
Expected: prompts to create `workflow_audit_log`; accept.

- [ ] **Step 6: Verify table exists**

Run: `cd ~/strange_rambling_svelte && npx drizzle-kit introspect --out=/tmp/introspect 2>&1 | head -5 || true` (introspect may not be wired; alternate: query via psql. Quick sanity: list tables.)

Run: `psql "$DATABASE_URL" -c '\d workflow_audit_log'` (or use pgweb at `http://homeserv:8085/pgweb/`)
Expected: table with columns `id, workflow_id, entity, entity_id, action, details, at` and a FK to workflows.

- [ ] **Step 7: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/db/schema.ts tests/lib/db/audit-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(canvas): add workflow_audit_log table

Backs the "recent edits" panel on the stats-summary node. Zero-cost
until write hooks land.
EOF
)"
```

---

## Task 2: recordAudit() helper

**Files:**
- Create: `src/lib/canvas/audit.ts`

- [ ] **Step 1: Write the helper**

Create `src/lib/canvas/audit.ts`:

```ts
import { db } from '$lib/db';
import { workflowAuditLog } from '$lib/db/schema';

export type AuditEntity = 'workflow' | 'node' | 'edge' | 'trigger' | 'schedule';
export type AuditAction = 'create' | 'delete' | 'rename' | 'config' | 'update';

export interface AuditInput {
  workflowId: string;
  entity: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  details?: Record<string, unknown>;
}

/**
 * Record a workflow audit event. Never throws — audit-log write failures
 * are logged and swallowed so mutation paths never break.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.insert(workflowAuditLog).values({
      workflowId: input.workflowId,
      entity: input.entity,
      entityId: input.entityId ?? null,
      action: input.action,
      details: input.details ?? {},
    });
  } catch (err) {
    console.error('[audit] failed to record', input, err);
  }
}

/** Convenience wrapper: record many in one insert. */
export async function recordAuditBatch(entries: AuditInput[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    await db.insert(workflowAuditLog).values(
      entries.map((e) => ({
        workflowId: e.workflowId,
        entity: e.entity,
        entityId: e.entityId ?? null,
        action: e.action,
        details: e.details ?? {},
      })),
    );
  } catch (err) {
    console.error('[audit] failed to record batch', entries, err);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/strange_rambling_svelte && npx svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -E 'audit\.ts|Error' | head -20`
Expected: no errors referencing `audit.ts`.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/audit.ts
git commit -m "feat(canvas): add recordAudit() helper for audit log writes"
```

---

## Task 3: Audit-diff helper (pure function)

**Files:**
- Create: `src/lib/canvas/audit-diff.ts`
- Create: `tests/lib/canvas/audit-diff.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/canvas/audit-diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffNodePatch, diffWorkflowPatch } from '$lib/canvas/audit-diff';

describe('diffNodePatch', () => {
  const base = {
    label: 'LLM',
    config: { model: 'glm-4', temperature: 0.7, size: { w: 300, h: 200 } },
    position: { x: 0, y: 0 },
  };

  it('returns empty array when only position changes', () => {
    const entries = diffNodePatch(base, { position: { x: 40, y: 60 } });
    expect(entries).toEqual([]);
  });

  it('returns empty array when only config.size changes', () => {
    const entries = diffNodePatch(base, {
      config: { ...base.config, size: { w: 500, h: 400 } },
    });
    expect(entries).toEqual([]);
  });

  it('emits one rename entry when label changes', () => {
    const entries = diffNodePatch(base, { label: 'Claude' });
    expect(entries).toEqual([
      { action: 'rename', details: { old: 'LLM', new: 'Claude' } },
    ]);
  });

  it('emits one config entry per changed config field (excluding size)', () => {
    const entries = diffNodePatch(base, {
      config: {
        ...base.config,
        model: 'glm-4.5',
        temperature: 0.2,
        size: { w: 999, h: 999 },
      },
    });
    expect(entries).toEqual(
      expect.arrayContaining([
        { action: 'config', details: { field: 'model', old: 'glm-4', new: 'glm-4.5' } },
        { action: 'config', details: { field: 'temperature', old: 0.7, new: 0.2 } },
      ]),
    );
    expect(entries).toHaveLength(2);
  });

  it('combines label change and config change into two entries', () => {
    const entries = diffNodePatch(base, {
      label: 'Claude',
      config: { ...base.config, model: 'glm-4.5' },
    });
    expect(entries).toHaveLength(2);
  });
});

describe('diffWorkflowPatch', () => {
  const base = { name: 'canvas:demo', description: 'Old title' };

  it('emits nothing for empty patch', () => {
    expect(diffWorkflowPatch(base, {})).toEqual([]);
  });

  it('emits a rename entry for description change', () => {
    const entries = diffWorkflowPatch(base, { description: 'New title' });
    expect(entries).toEqual([
      { action: 'rename', details: { field: 'description', old: 'Old title', new: 'New title' } },
    ]);
  });

  it('emits a rename entry for name change', () => {
    const entries = diffWorkflowPatch(base, { name: 'canvas:demo2' });
    expect(entries).toEqual([
      { action: 'rename', details: { field: 'name', old: 'canvas:demo', new: 'canvas:demo2' } },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/canvas/audit-diff.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/canvas/audit-diff.ts`:

```ts
export type NodeDiffEntry =
  | { action: 'rename'; details: { old: string; new: string } }
  | { action: 'config'; details: { field: string; old: unknown; new: unknown } };

export type WorkflowDiffEntry = {
  action: 'rename';
  details: { field: string; old: unknown; new: unknown };
};

interface NodeShape {
  label: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

/**
 * Diff a PATCH body against the stored node, returning audit entries.
 * `position` and `config.size` changes are intentionally excluded —
 * these are considered cosmetic and not part of the edit history.
 */
export function diffNodePatch(
  before: NodeShape,
  patch: Partial<NodeShape>,
): NodeDiffEntry[] {
  const entries: NodeDiffEntry[] = [];

  if (typeof patch.label === 'string' && patch.label !== before.label) {
    entries.push({
      action: 'rename',
      details: { old: before.label, new: patch.label },
    });
  }

  if (patch.config && typeof patch.config === 'object') {
    const beforeCfg = before.config ?? {};
    const afterCfg = patch.config;
    const keys = new Set([...Object.keys(beforeCfg), ...Object.keys(afterCfg)]);
    for (const field of keys) {
      if (field === 'size') continue; // excluded
      const oldVal = beforeCfg[field];
      const newVal = afterCfg[field];
      if (!deepEqual(oldVal, newVal)) {
        entries.push({
          action: 'config',
          details: { field, old: oldVal, new: newVal },
        });
      }
    }
  }

  return entries;
}

interface WorkflowShape {
  name: string;
  description: string | null;
}

export function diffWorkflowPatch(
  before: WorkflowShape,
  patch: Partial<WorkflowShape>,
): WorkflowDiffEntry[] {
  const entries: WorkflowDiffEntry[] = [];
  for (const field of ['name', 'description'] as const) {
    if (patch[field] !== undefined && patch[field] !== before[field]) {
      entries.push({
        action: 'rename',
        details: { field, old: before[field], new: patch[field] },
      });
    }
  }
  return entries;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/canvas/audit-diff.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/audit-diff.ts tests/lib/canvas/audit-diff.test.ts
git commit -m "feat(canvas): add audit-diff helpers (position + size excluded)"
```

---

## Task 4: Wire audit into node routes

**Files:**
- Modify: `src/routes/api/workflows/[id]/nodes/+server.ts`
- Modify: `src/routes/api/workflows/[id]/nodes/[nodeId]/+server.ts`

- [ ] **Step 1: Audit on node CREATE**

Edit `src/routes/api/workflows/[id]/nodes/+server.ts`, adding after the `const [node] = await db.insert(workflowNodes)...` block (around line 41):

Add imports at the top:

```ts
import { recordAudit } from '$lib/canvas/audit';
```

Then, right before `return json({ node });`:

```ts
  await recordAudit({
    workflowId: params.id,
    entity: 'node',
    entityId: node.id,
    action: 'create',
    details: { nodeType: node.type, label: node.label },
  });
```

- [ ] **Step 2: Audit on node PATCH**

Edit `src/routes/api/workflows/[id]/nodes/[nodeId]/+server.ts`. Replace the whole `PATCH` export with:

```ts
export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.config !== undefined) updates.config = body.config;
  if (typeof body.label === 'string') updates.label = body.label;
  if (body.position && typeof body.position === 'object') updates.position = body.position;

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  // Load current state BEFORE the update so we can diff.
  const [before] = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)));
  if (!before) return json({ error: 'Node not found' }, { status: 404 });

  const [updated] = await db
    .update(workflowNodes)
    .set(updates)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)))
    .returning();

  if (!updated) {
    return json({ error: 'Node not found' }, { status: 404 });
  }

  // Emit audit entries for non-cosmetic changes.
  const entries = diffNodePatch(
    {
      label: before.label,
      config: (before.config as Record<string, unknown>) ?? {},
      position: (before.position as { x: number; y: number }) ?? { x: 0, y: 0 },
    },
    {
      label: typeof body.label === 'string' ? body.label : undefined,
      config: body.config as Record<string, unknown> | undefined,
    },
  );
  if (entries.length > 0) {
    await recordAuditBatch(
      entries.map((e) => ({
        workflowId: params.id,
        entity: 'node' as const,
        entityId: params.nodeId,
        action: e.action,
        details: { ...e.details, label: updated.label, nodeType: updated.type },
      })),
    );
  }

  return json({ node: updated });
};
```

Add imports at top of file:

```ts
import { recordAuditBatch } from '$lib/canvas/audit';
import { diffNodePatch } from '$lib/canvas/audit-diff';
```

- [ ] **Step 3: Audit on node DELETE**

In the same file, replace the `DELETE` handler's body. Insert the audit call AFTER the successful delete, BEFORE the `return`:

```ts
export const DELETE: RequestHandler = async ({ params }) => {
  // Remove inbound/outbound edges first to keep FK clean
  await db
    .delete(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, params.id),
        or(
          eq(workflowEdges.sourceNodeId, params.nodeId),
          eq(workflowEdges.targetNodeId, params.nodeId),
        ),
      ),
    );

  const [removed] = await db
    .delete(workflowNodes)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)))
    .returning();

  if (!removed) return json({ error: 'Node not found' }, { status: 404 });

  await recordAudit({
    workflowId: params.id,
    entity: 'node',
    entityId: removed.id,
    action: 'delete',
    details: { nodeType: removed.type, label: removed.label },
  });

  return json({ deleted: removed.id });
};
```

Ensure `recordAudit` is in the import list at the top of the file:

```ts
import { recordAudit, recordAuditBatch } from '$lib/canvas/audit';
```

- [ ] **Step 4: Smoke-test the routes**

Run: `cd ~/strange_rambling_svelte && npm run dev`
In another shell, hit a canvas, add a node, rename it, change config, delete it, then:

```sh
psql "$DATABASE_URL" -c "select entity, action, details, at from workflow_audit_log order by at desc limit 10"
```

Expected: rows for `node/create`, `node/rename` or `node/config`, `node/delete`.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/\[id\]/nodes/+server.ts src/routes/api/workflows/\[id\]/nodes/\[nodeId\]/+server.ts
git commit -m "feat(canvas): record audit entries for node create/patch/delete"
```

---

## Task 5: Wire audit into edge routes + reject stats-node edges

**Files:**
- Modify: `src/routes/api/workflows/[id]/edges/+server.ts`

- [ ] **Step 1: Add imports and a helper**

Replace the top of `src/routes/api/workflows/[id]/edges/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowEdges, workflowNodes } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { recordAudit } from '$lib/canvas/audit';

function isStatsType(type: string): boolean {
  return type.startsWith('stats-');
}
```

- [ ] **Step 2: Reject edges touching stats nodes, audit on create**

Replace the `POST` handler's body (insert the stats-node guard after the 2-node-lookup success, and audit after the insert):

```ts
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const sourceNodeId = body.sourceNodeId as string | undefined;
  const targetNodeId = body.targetNodeId as string | undefined;
  if (!sourceNodeId || !targetNodeId) {
    return json({ error: 'sourceNodeId and targetNodeId required' }, { status: 400 });
  }
  if (sourceNodeId === targetNodeId) {
    return json({ error: 'A node cannot pipe to itself' }, { status: 400 });
  }

  const both = await db
    .select()
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, params.id),
        inArray(workflowNodes.id, [sourceNodeId, targetNodeId]),
      ),
    );
  if (both.length !== 2) {
    return json({ error: 'Source or target node not in this workflow' }, { status: 404 });
  }

  // Reject edges touching display-only stats nodes.
  if (both.some((n) => isStatsType(n.type))) {
    return json(
      { error: 'Stats nodes are display-only and cannot be connected.' },
      { status: 400 },
    );
  }

  const [existing] = await db
    .select()
    .from(workflowEdges)
    .where(
      and(
        eq(workflowEdges.workflowId, params.id),
        eq(workflowEdges.sourceNodeId, sourceNodeId),
        eq(workflowEdges.targetNodeId, targetNodeId),
      ),
    );
  if (existing) return json({ edge: existing });

  const [edge] = await db
    .insert(workflowEdges)
    .values({ workflowId: params.id, sourceNodeId, targetNodeId })
    .returning();

  const src = both.find((n) => n.id === sourceNodeId);
  const tgt = both.find((n) => n.id === targetNodeId);
  await recordAudit({
    workflowId: params.id,
    entity: 'edge',
    entityId: edge.id,
    action: 'create',
    details: {
      from: sourceNodeId,
      to: targetNodeId,
      fromLabel: src?.label ?? null,
      toLabel: tgt?.label ?? null,
    },
  });

  return json({ edge });
};
```

- [ ] **Step 3: Audit on edge DELETE**

Replace the `DELETE` handler:

```ts
export const DELETE: RequestHandler = async ({ params, url }) => {
  const edgeId = url.searchParams.get('id');
  const sourceNodeId = url.searchParams.get('source');
  const targetNodeId = url.searchParams.get('target');

  async function auditRemoved(ids: string[], edges: Array<{ sourceNodeId: string; targetNodeId: string }>) {
    if (ids.length === 0) return;
    // Look up labels for the nodes referenced by these edges.
    const nodeIds = Array.from(new Set(edges.flatMap((e) => [e.sourceNodeId, e.targetNodeId])));
    const nodes = nodeIds.length
      ? await db
          .select({ id: workflowNodes.id, label: workflowNodes.label })
          .from(workflowNodes)
          .where(inArray(workflowNodes.id, nodeIds))
      : [];
    const labelById = new Map(nodes.map((n) => [n.id, n.label]));
    for (let i = 0; i < ids.length; i++) {
      const e = edges[i];
      await recordAudit({
        workflowId: params.id,
        entity: 'edge',
        entityId: ids[i],
        action: 'delete',
        details: {
          from: e.sourceNodeId,
          to: e.targetNodeId,
          fromLabel: labelById.get(e.sourceNodeId) ?? null,
          toLabel: labelById.get(e.targetNodeId) ?? null,
        },
      });
    }
  }

  if (edgeId) {
    const [removed] = await db
      .delete(workflowEdges)
      .where(and(eq(workflowEdges.id, edgeId), eq(workflowEdges.workflowId, params.id)))
      .returning();
    if (!removed) return json({ error: 'Edge not found' }, { status: 404 });
    await auditRemoved([removed.id], [{ sourceNodeId: removed.sourceNodeId, targetNodeId: removed.targetNodeId }]);
    return json({ deleted: removed.id });
  }

  if (sourceNodeId && targetNodeId) {
    const removed = await db
      .delete(workflowEdges)
      .where(
        and(
          eq(workflowEdges.workflowId, params.id),
          eq(workflowEdges.sourceNodeId, sourceNodeId),
          eq(workflowEdges.targetNodeId, targetNodeId),
        ),
      )
      .returning();
    await auditRemoved(
      removed.map((r) => r.id),
      removed.map((r) => ({ sourceNodeId: r.sourceNodeId, targetNodeId: r.targetNodeId })),
    );
    return json({ deleted: removed.map((r) => r.id) });
  }

  return json({ error: 'Provide ?id=… or ?source=&target=' }, { status: 400 });
};
```

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/\[id\]/edges/+server.ts
git commit -m "feat(canvas): audit edge changes; reject edges touching stats nodes"
```

---

## Task 6: Wire audit into root workflow PUT + trigger PUT

**Files:**
- Modify: `src/routes/api/workflows/[id]/+server.ts`
- Modify: `src/routes/api/workflows/[id]/trigger/+server.ts`

- [ ] **Step 1: Audit name/description on root PUT**

Edit `src/routes/api/workflows/[id]/+server.ts`. In the `PUT` handler, after the `existing` lookup and before the update, compute + record diff for `name` and `description` only (nodes/edges are handled granularly by other endpoints and are out of scope for audit here):

Add imports:

```ts
import { recordAuditBatch } from '$lib/canvas/audit';
import { diffWorkflowPatch } from '$lib/canvas/audit-diff';
```

Inside `PUT`, after the `existing` check succeeds and before `await db.update(workflows)...`:

```ts
  const wfEntries = diffWorkflowPatch(
    { name: existing.name, description: existing.description },
    {
      name: typeof name === 'string' ? name : undefined,
      description: typeof description === 'string' ? description : undefined,
    },
  );
  if (wfEntries.length > 0) {
    await recordAuditBatch(
      wfEntries.map((e) => ({
        workflowId: params.id,
        entity: 'workflow' as const,
        entityId: params.id,
        action: e.action,
        details: e.details,
      })),
    );
  }
```

- [ ] **Step 2: Audit trigger PUT**

Edit `src/routes/api/workflows/[id]/trigger/+server.ts`. Add to imports:

```ts
import { recordAudit } from '$lib/canvas/audit';
```

Find the point after the DB writes complete and before the route returns success. Insert:

```ts
  await recordAudit({
    workflowId: params.id,
    entity: 'trigger',
    entityId: params.id,
    action: 'update',
    details: {
      old: (workflow.trigger as Record<string, unknown>) ?? null,
      new: { kind, cron: kind === 'cron' ? cron : null, eventType: kind === 'event' ? eventType : null, enabled },
    },
  });
```

(The exact variable `workflow` — the row loaded earlier in the handler — is already in scope. If the PUT handler lacks a single post-write return point, wrap the existing writes in a try block and call `recordAudit` on success.)

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/\[id\]/+server.ts src/routes/api/workflows/\[id\]/trigger/+server.ts
git commit -m "feat(canvas): audit workflow rename + trigger updates"
```

---

## Task 7: Period resolver (pure)

**Files:**
- Create: `src/lib/canvas/stats/resolvePeriod.ts`
- Create: `tests/lib/canvas/stats/resolvePeriod.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/canvas/stats/resolvePeriod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

// Anchor: Mon 2026-04-20 12:00:00 UTC
const NOW = new Date('2026-04-20T12:00:00Z');

describe('resolvePeriod', () => {
  it('unknown/empty preset defaults to 30d', () => {
    const r = resolvePeriod('bogus', NOW);
    expect(r.preset).toBe('30d');
    expect(r.granularity).toBe('day');
    expect(r.to.toISOString()).toBe('2026-04-20T12:00:00.000Z');
    expect(r.from.toISOString()).toBe('2026-03-21T12:00:00.000Z');
  });

  it('24h returns hour granularity', () => {
    const r = resolvePeriod('24h', NOW);
    expect(r.granularity).toBe('hour');
    expect(r.from.toISOString()).toBe('2026-04-19T12:00:00.000Z');
  });

  it('this-week starts on Monday 00:00 UTC', () => {
    const r = resolvePeriod('this-week', NOW);
    expect(r.granularity).toBe('day');
    expect(r.from.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  it('last-week spans the previous Monday..Sunday', () => {
    const r = resolvePeriod('last-week', NOW);
    expect(r.from.toISOString()).toBe('2026-04-13T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-20T00:00:00.000Z');
  });

  it('last-month spans the previous calendar month', () => {
    const r = resolvePeriod('last-month', NOW);
    expect(r.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('all with 100d span uses week granularity', () => {
    const earliest = new Date('2026-01-01T00:00:00Z');
    const r = resolvePeriod('all', NOW, earliest);
    expect(r.granularity).toBe('week');
  });

  it('all with 10d span uses day granularity', () => {
    const earliest = new Date('2026-04-10T00:00:00Z');
    const r = resolvePeriod('all', NOW, earliest);
    expect(r.granularity).toBe('day');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/canvas/stats/resolvePeriod.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/canvas/stats/resolvePeriod.ts`:

```ts
export type PeriodPreset = '24h' | 'this-week' | 'last-week' | '30d' | 'last-month' | 'all';
export type Granularity = 'hour' | 'day' | 'week';

export interface ResolvedPeriod {
  preset: PeriodPreset;
  from: Date;
  to: Date;
  granularity: Granularity;
}

const VALID = new Set<PeriodPreset>(['24h', 'this-week', 'last-week', '30d', 'last-month', 'all']);

function coerce(p: string | null | undefined): PeriodPreset {
  if (p && (VALID as Set<string>).has(p)) return p as PeriodPreset;
  return '30d';
}

/** ISO week: Monday 00:00 UTC of the week containing `d`. */
function startOfISOWeekUTC(d: Date): Date {
  const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = c.getUTCDay(); // 0=Sun..6=Sat
  const delta = dow === 0 ? 6 : dow - 1;
  c.setUTCDate(c.getUTCDate() - delta);
  return c;
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function resolvePeriod(
  rawPreset: string | null | undefined,
  now: Date,
  earliestForAll?: Date,
): ResolvedPeriod {
  const preset = coerce(rawPreset);

  switch (preset) {
    case '24h': {
      const to = new Date(now);
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { preset, from, to, granularity: 'hour' };
    }
    case 'this-week': {
      const from = startOfISOWeekUTC(now);
      return { preset, from, to: new Date(now), granularity: 'day' };
    }
    case 'last-week': {
      const thisStart = startOfISOWeekUTC(now);
      const from = new Date(thisStart);
      from.setUTCDate(from.getUTCDate() - 7);
      return { preset, from, to: thisStart, granularity: 'day' };
    }
    case '30d': {
      const to = new Date(now);
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { preset, from, to, granularity: 'day' };
    }
    case 'last-month': {
      const thisMonth = startOfMonthUTC(now);
      const prev = new Date(thisMonth);
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      return { preset, from: prev, to: thisMonth, granularity: 'day' };
    }
    case 'all': {
      const from = earliestForAll ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const to = new Date(now);
      const spanMs = to.getTime() - from.getTime();
      const granularity: Granularity = spanMs > 90 * 24 * 60 * 60 * 1000 ? 'week' : 'day';
      return { preset, from, to, granularity };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/canvas/stats/resolvePeriod.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/resolvePeriod.ts tests/lib/canvas/stats/resolvePeriod.test.ts
git commit -m "feat(canvas/stats): add period preset resolver"
```

---

## Task 8: Formatters (pure)

**Files:**
- Create: `src/lib/canvas/stats/format.ts`
- Create: `tests/lib/canvas/stats/format.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/canvas/stats/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatDurationMs, formatPercent, formatRelative } from '$lib/canvas/stats/format';

describe('formatDurationMs', () => {
  it('<1s → ms', () => {
    expect(formatDurationMs(523)).toBe('523ms');
  });
  it('<60s → seconds with 1 decimal', () => {
    expect(formatDurationMs(1500)).toBe('1.5s');
    expect(formatDurationMs(12345)).toBe('12.3s');
  });
  it('<1h → m:ss', () => {
    expect(formatDurationMs(65_000)).toBe('1m 05s');
    expect(formatDurationMs(3_599_000)).toBe('59m 59s');
  });
  it('>=1h → h:mm', () => {
    expect(formatDurationMs(3_600_000)).toBe('1h 00m');
    expect(formatDurationMs(3_720_000)).toBe('1h 02m');
  });
  it('null/0 → —', () => {
    expect(formatDurationMs(null)).toBe('—');
    expect(formatDurationMs(0)).toBe('0ms');
  });
});

describe('formatPercent', () => {
  it('renders 0..1 → integer % with a trailing sign', () => {
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(1)).toBe('100%');
    expect(formatPercent(0.933)).toBe('93%');
  });
});

describe('formatRelative', () => {
  it('just now', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-20T11:59:50Z'), now)).toBe('just now');
  });
  it('minutes', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-20T11:55:00Z'), now)).toBe('5m ago');
  });
  it('hours', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-20T09:00:00Z'), now)).toBe('3h ago');
  });
  it('days', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(formatRelative(new Date('2026-04-17T12:00:00Z'), now)).toBe('3d ago');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/canvas/stats/format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the formatters**

Create `src/lib/canvas/stats/format.ts`:

```ts
export function formatDurationMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const mins = Math.floor(ms / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    return `${mins}m ${String(secs).padStart(2, '0')}s`;
  }
  const hrs = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  return `${hrs}h ${String(mins).padStart(2, '0')}m`;
}

export function formatPercent(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}

export function formatRelative(d: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 30_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return `${Math.floor(diffMs / 86_400_000)}d ago`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/strange_rambling_svelte && npx vitest run tests/lib/canvas/stats/format.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/format.ts tests/lib/canvas/stats/format.test.ts
git commit -m "feat(canvas/stats): add formatters for duration / percent / relative time"
```

---

## Task 9: Summary stats API endpoint

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/summary/+server.ts`

- [ ] **Step 1: Implement the endpoint**

Create `src/routes/api/canvas/[slug]/stats/summary/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import {
  workflows,
  workflowRuns,
  workflowAuditLog,
} from '$lib/db/schema';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  // If 'all' preset: find earliest run for this workflow
  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(url.searchParams.get('period'), new Date(), earliestRow?.t ?? undefined);

  // Counters
  const rows = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
      healingHistory: workflowRuns.healingHistory,
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, wf.id),
        gte(workflowRuns.startedAt, period.from),
        lt(workflowRuns.startedAt, period.to),
      ),
    );

  let success = 0,
    failed = 0,
    healing = 0,
    totalDuration = 0,
    durCount = 0;
  for (const r of rows) {
    if (r.status === 'completed') success++;
    else if (r.status === 'failed') failed++;
    if (Array.isArray(r.healingHistory) && r.healingHistory.length > 0) healing++;
    if (r.startedAt && r.completedAt) {
      totalDuration += r.completedAt.getTime() - r.startedAt.getTime();
      durCount++;
    }
  }
  const runs = rows.length;
  const successRate = runs > 0 ? success / runs : 0;
  const avgDurationMs = durCount > 0 ? Math.round(totalDuration / durCount) : null;

  // Sparkline — bucket by granularity
  const bucketExpr =
    period.granularity === 'hour'
      ? sql`date_trunc('hour', ${workflowRuns.startedAt})`
      : period.granularity === 'week'
        ? sql`date_trunc('week', ${workflowRuns.startedAt})`
        : sql`date_trunc('day', ${workflowRuns.startedAt})`;

  const sparkRows = await db
    .select({
      bucket: bucketExpr.as('bucket'),
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workflowId, wf.id),
        gte(workflowRuns.startedAt, period.from),
        lt(workflowRuns.startedAt, period.to),
      ),
    )
    .groupBy(sql`bucket`)
    .orderBy(sql`bucket`);

  const sparkline = sparkRows.map((r) => ({
    bucket: (r.bucket instanceof Date ? r.bucket : new Date(r.bucket as unknown as string)).toISOString(),
    count: Number(r.count),
  }));

  // Recent runs
  const recentRuns = rows
    .filter((r) => r.startedAt)
    .sort((a, b) => (b.startedAt!.getTime() - a.startedAt!.getTime()))
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt!.toISOString(),
      durationMs: r.startedAt && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
    }));

  // Recent edits (always top 5, regardless of period — the edit history is most useful as "what changed lately")
  const editRows = await db
    .select()
    .from(workflowAuditLog)
    .where(eq(workflowAuditLog.workflowId, wf.id))
    .orderBy(desc(workflowAuditLog.at))
    .limit(5);

  const recentEdits = editRows.map((e) => ({
    at: e.at.toISOString(),
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    details: (e.details as Record<string, unknown>) ?? {},
  }));

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: {
      counters: { runs, success, failed, healing, successRate, avgDurationMs },
      sparkline,
      recentRuns,
      recentEdits,
    },
  });
};
```

- [ ] **Step 2: Smoke test**

Run: `cd ~/strange_rambling_svelte && npm run dev`, then in another shell:

```sh
curl -s 'http://homeserv:5173/api/canvas/canvas-sample/stats/summary?period=30d' | jq .
```

Expected: JSON with `window` + `data.counters`, `data.sparkline`, `data.recentRuns`, `data.recentEdits`.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/canvas/\[slug\]/stats/summary/+server.ts
git commit -m "feat(canvas/stats): add summary stats API endpoint"
```

---

## Task 10: Trends stats API endpoint

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/trends/+server.ts`

- [ ] **Step 1: Implement the endpoint**

Create `src/routes/api/canvas/[slug]/stats/trends/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowRuns } from '$lib/db/schema';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { resolvePeriod, type Granularity } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

/** Zero-fill buckets between from..to at the granularity step. */
function buildBuckets(from: Date, to: Date, granularity: Granularity): Date[] {
  const stepMs =
    granularity === 'hour' ? 3_600_000 : granularity === 'week' ? 604_800_000 : 86_400_000;
  const startMs =
    granularity === 'hour'
      ? Math.floor(from.getTime() / stepMs) * stepMs
      : Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const out: Date[] = [];
  for (let t = startMs; t < to.getTime(); t += stepMs) out.push(new Date(t));
  return out;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(url.searchParams.get('period'), new Date(), earliestRow?.t ?? undefined);

  const trunc =
    period.granularity === 'hour'
      ? sql`date_trunc('hour', ${workflowRuns.startedAt})`
      : period.granularity === 'week'
        ? sql`date_trunc('week', ${workflowRuns.startedAt})`
        : sql`date_trunc('day', ${workflowRuns.startedAt})`;

  // One query for per-bucket run counts by status + duration percentiles.
  // duration_ms := completedAt - startedAt (ms), null if not completed.
  const rows = await db.execute<{
    bucket: Date;
    status: string;
    cnt: number;
    p50: number | null;
    p95: number | null;
    avg_ms: number | null;
    healed: number;
  }>(sql`
    SELECT
      ${trunc} AS bucket,
      ${workflowRuns.status} AS status,
      COUNT(*)::int AS cnt,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (${workflowRuns.completedAt} - ${workflowRuns.startedAt})) * 1000
      ) FILTER (WHERE ${workflowRuns.completedAt} IS NOT NULL) AS p50,
      percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (${workflowRuns.completedAt} - ${workflowRuns.startedAt})) * 1000
      ) FILTER (WHERE ${workflowRuns.completedAt} IS NOT NULL) AS p95,
      AVG(EXTRACT(EPOCH FROM (${workflowRuns.completedAt} - ${workflowRuns.startedAt})) * 1000)
        FILTER (WHERE ${workflowRuns.completedAt} IS NOT NULL) AS avg_ms,
      COUNT(*) FILTER (
        WHERE jsonb_array_length(COALESCE(${workflowRuns.healingHistory}, '[]'::jsonb)) > 0
      )::int AS healed
    FROM ${workflowRuns}
    WHERE ${workflowRuns.workflowId} = ${wf.id}
      AND ${workflowRuns.startedAt} >= ${period.from}
      AND ${workflowRuns.startedAt} < ${period.to}
    GROUP BY bucket, ${workflowRuns.status}
    ORDER BY bucket
  `);

  type Row = (typeof rows.rows)[number];
  const bucketsIndex = new Map<
    string,
    { success: number; failed: number; healing: number; p50: number | null; p95: number | null; avg: number | null }
  >();

  for (const r of rows.rows as unknown as Row[]) {
    const key = new Date(r.bucket).toISOString();
    const entry = bucketsIndex.get(key) ?? {
      success: 0,
      failed: 0,
      healing: 0,
      p50: null as number | null,
      p95: null as number | null,
      avg: null as number | null,
    };
    if (r.status === 'completed') entry.success += r.cnt;
    else if (r.status === 'failed') entry.failed += r.cnt;
    entry.healing += r.healed;
    // percentiles: pick the widest bucket-level values we see (runs may span statuses)
    if (r.p50 !== null) entry.p50 = Math.max(entry.p50 ?? 0, Math.round(r.p50));
    if (r.p95 !== null) entry.p95 = Math.max(entry.p95 ?? 0, Math.round(r.p95));
    if (r.avg_ms !== null) entry.avg = Math.round(r.avg_ms);
    bucketsIndex.set(key, entry);
  }

  const skeleton = buildBuckets(period.from, period.to, period.granularity);
  const buckets = skeleton.map((t) => {
    const key = t.toISOString();
    const e = bucketsIndex.get(key);
    return {
      t: key,
      runs: {
        success: e?.success ?? 0,
        failed: e?.failed ?? 0,
        healing: e?.healing ?? 0,
      },
      durationMs: {
        p50: e?.p50 ?? null,
        p95: e?.p95 ?? null,
        avg: e?.avg ?? null,
      },
    };
  });

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { buckets },
  });
};
```

- [ ] **Step 2: Smoke test**

```sh
curl -s 'http://homeserv:5173/api/canvas/canvas-sample/stats/trends?period=30d' | jq '.data.buckets | length'
```

Expected: 30 (or fewer if `last-month`). Returns 200.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/canvas/\[slug\]/stats/trends/+server.ts
git commit -m "feat(canvas/stats): add trends stats API endpoint"
```

---

## Task 11: Per-node stats API endpoint

**Files:**
- Create: `src/routes/api/canvas/[slug]/stats/per-node/+server.ts`

- [ ] **Step 1: Implement the endpoint**

Create `src/routes/api/canvas/[slug]/stats/per-node/+server.ts`:

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { and, desc, eq, gte, inArray, lt, like, sql, not } from 'drizzle-orm';
import { resolvePeriod } from '$lib/canvas/stats/resolvePeriod';

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, url }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) return json({ error: 'Canvas not found' }, { status: 404 });

  const [earliestRow] = await db
    .select({ t: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, wf.id))
    .orderBy(workflowRuns.startedAt)
    .limit(1);
  const period = resolvePeriod(url.searchParams.get('period'), new Date(), earliestRow?.t ?? undefined);

  // All non-stats nodes for this workflow
  const nodes = await db
    .select({
      id: workflowNodes.id,
      label: workflowNodes.label,
      type: workflowNodes.type,
    })
    .from(workflowNodes)
    .where(
      and(
        eq(workflowNodes.workflowId, wf.id),
        not(like(workflowNodes.type, 'stats-%')),
      ),
    );

  if (nodes.length === 0) {
    return json({
      window: {
        preset: period.preset,
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        granularity: period.granularity,
      },
      data: { nodes: [] },
    });
  }

  // Aggregate node_executions in the window, joined to workflow_runs so we can filter by started_at
  const aggRows = await db.execute<{
    node_id: string;
    runs: number;
    success: number;
    failed: number;
    avg_ms: number | null;
    p95_ms: number | null;
  }>(sql`
    SELECT
      ne.node_id AS node_id,
      COUNT(*)::int AS runs,
      COUNT(*) FILTER (WHERE ne.status = 'completed')::int AS success,
      COUNT(*) FILTER (WHERE ne.status = 'failed')::int AS failed,
      AVG(EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000)
        FILTER (WHERE ne.completed_at IS NOT NULL) AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (ne.completed_at - ne.started_at)) * 1000
      ) FILTER (WHERE ne.completed_at IS NOT NULL) AS p95_ms
    FROM node_executions ne
    INNER JOIN workflow_runs wr ON wr.id = ne.run_id
    WHERE wr.workflow_id = ${wf.id}
      AND wr.started_at >= ${period.from}
      AND wr.started_at < ${period.to}
      AND ne.node_id = ANY(${nodes.map((n) => n.id)})
    GROUP BY ne.node_id
  `);

  const aggByNodeId = new Map<string, (typeof aggRows.rows)[number]>();
  for (const r of aggRows.rows) aggByNodeId.set(r.node_id, r);

  // Most-recent error per node in window
  const errRows = await db.execute<{
    node_id: string;
    completed_at: Date;
    error: string;
  }>(sql`
    SELECT DISTINCT ON (ne.node_id)
      ne.node_id,
      ne.completed_at,
      ne.error
    FROM node_executions ne
    INNER JOIN workflow_runs wr ON wr.id = ne.run_id
    WHERE wr.workflow_id = ${wf.id}
      AND wr.started_at >= ${period.from}
      AND wr.started_at < ${period.to}
      AND ne.status = 'failed'
      AND ne.error IS NOT NULL
      AND ne.node_id = ANY(${nodes.map((n) => n.id)})
    ORDER BY ne.node_id, ne.completed_at DESC NULLS LAST
  `);

  const errByNodeId = new Map<string, (typeof errRows.rows)[number]>();
  for (const r of errRows.rows) errByNodeId.set(r.node_id, r);

  const result = nodes.map((n) => {
    const agg = aggByNodeId.get(n.id);
    const err = errByNodeId.get(n.id);
    return {
      nodeId: n.id,
      label: n.label,
      type: n.type,
      runs: agg ? Number(agg.runs) : 0,
      success: agg ? Number(agg.success) : 0,
      failed: agg ? Number(agg.failed) : 0,
      avgMs: agg?.avg_ms !== null && agg?.avg_ms !== undefined ? Math.round(Number(agg.avg_ms)) : null,
      p95Ms: agg?.p95_ms !== null && agg?.p95_ms !== undefined ? Math.round(Number(agg.p95_ms)) : null,
      lastError: err
        ? { at: new Date(err.completed_at).toISOString(), message: err.error }
        : null,
    };
  });

  return json({
    window: {
      preset: period.preset,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      granularity: period.granularity,
    },
    data: { nodes: result },
  });
};
```

- [ ] **Step 2: Smoke test**

```sh
curl -s 'http://homeserv:5173/api/canvas/canvas-sample/stats/per-node?period=30d' | jq '.data.nodes[].label'
```

Expected: labels for every non-stats node in the canvas. 200 response.

- [ ] **Step 3: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/canvas/\[slug\]/stats/per-node/+server.ts
git commit -m "feat(canvas/stats): add per-node stats API endpoint"
```

---

## Task 12: Register stats node types

**Files:**
- Modify: `src/lib/canvas/adapter.ts`

- [ ] **Step 1: Add `'stats'` to `NodeKind`**

In `src/lib/canvas/adapter.ts`, update the `NodeKind` union:

```ts
export type NodeKind =
  | 'input' | 'llm' | 'parse' | 'output' | 'intel' | 'agent'
  | 'chat' | 'trigger' | 'inspector' | 'stats';
```

- [ ] **Step 2: Add `'Observability'` group**

Update the `CANVAS_NODE_GROUPS` tuple:

```ts
export const CANVAS_NODE_GROUPS = [
  'Trigger & Flow',
  'LLM & AI',
  'Parse & Transform',
  'Intel & Web',
  'Integrations',
  'Observability',
] as const;
```

- [ ] **Step 3: Register the three stats node types**

Append to the `CANVAS_NODE_TYPES` array (after the existing `'inspector'` entry):

```ts
  // ————————————————————————— Observability
  {
    type: 'stats-summary',
    label: 'Stats · summary',
    kind: 'stats',
    group: 'Observability',
    description: 'Headline counters, sparkline, recent runs, recent edits. Uses shared time filter.',
    defaultConfig: { size: { w: 300, h: 280 } },
  },
  {
    type: 'stats-trends',
    label: 'Stats · trends',
    kind: 'stats',
    group: 'Observability',
    description: 'Runs over time (stacked) and run duration (p50 / p95) over time.',
    defaultConfig: { size: { w: 520, h: 360 } },
  },
  {
    type: 'stats-per-node',
    label: 'Stats · per-node',
    kind: 'stats',
    group: 'Observability',
    description: 'Table of every node with run count, success rate, avg / p95 duration, last error.',
    defaultConfig: { size: { w: 420, h: 400 } },
  },
```

- [ ] **Step 4: Update `mapTypeToKind`**

In the same file, in `mapTypeToKind()`, add after the `inspector` case:

```ts
  if (type === 'stats-summary' || type === 'stats-trends' || type === 'stats-per-node') return 'stats';
```

- [ ] **Step 5: Smoke: node type appears in picker**

Run `npm run dev`, open a canvas, click `+`, go to the new `Observability` group — the three entries should appear. Adding a `stats-summary` node should insert a row with `type='stats-summary'` in `workflow_nodes`. Canvas renders it with no executor-related errors (rendering fallback is the default node box until Task 14 lands).

- [ ] **Step 6: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/adapter.ts
git commit -m "feat(canvas): register stats-summary / stats-trends / stats-per-node node types"
```

---

## Task 13: Filter stats nodes out of execution pipeline

**Files:**
- Modify: `src/routes/api/workflows/[id]/run/+server.ts`
- Modify: `src/lib/workflows/scheduler.ts`

- [ ] **Step 1: Add a tiny predicate**

In `src/lib/workflows/types.ts` (or a new `src/lib/workflows/helpers.ts` if you prefer), add:

```ts
export function isDisplayOnlyType(type: string): boolean {
  return type.startsWith('stats-');
}
```

Add to the exports list.

- [ ] **Step 2: Filter in the /run endpoint**

Edit `src/routes/api/workflows/[id]/run/+server.ts`. Near the top of the handler, after `const [run] = await db.insert(workflowRuns)...` and BEFORE the `for (const node of nodes)` pre-populate loop:

```ts
import { isDisplayOnlyType } from '$lib/workflows/types';
// ...
  const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
  const runnableEdges = edges.filter((e) => {
    const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
    const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
    return src && tgt;
  });
```

Then change the pre-populate loop to iterate `runnableNodes` instead of `nodes`:

```ts
  for (const node of runnableNodes) {
    await db.insert(nodeExecutions).values({
      runId: run.id,
      nodeId: node.id,
      status: 'pending',
    });
  }
```

And change the `definition` to use `runnableNodes` / `runnableEdges`:

```ts
  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: runnableNodes.map((n) => ({ /* unchanged */ })),
    edges: runnableEdges.map((e) => ({ /* unchanged */ })),
  };
```

- [ ] **Step 3: Filter in the scheduler**

Edit `src/lib/workflows/scheduler.ts`. Mirror the same filter around line 100-130:

```ts
import { isDisplayOnlyType } from '$lib/workflows/types';
// ...
    const runnableNodes = nodes.filter((n) => !isDisplayOnlyType(n.type));
    const runnableEdges = edges.filter((e) => {
      const src = runnableNodes.find((n) => n.id === e.sourceNodeId);
      const tgt = runnableNodes.find((n) => n.id === e.targetNodeId);
      return src && tgt;
    });
```

Replace the `nodes.map` and `edges.map` in the `definition` with `runnableNodes.map` / `runnableEdges.map`. Replace the pre-populate loop to iterate `runnableNodes`.

- [ ] **Step 4: Manual test**

1. `npm run dev`
2. Open canvas, add a `stats-summary` node (no edges to/from it).
3. Click Run.
4. Verify: other nodes execute normally; no `node_executions` row exists for the stats node.

```sh
psql "$DATABASE_URL" -c "
  select ne.node_id, wn.type, ne.status
  from node_executions ne
  join workflow_nodes wn on wn.id = ne.node_id
  where ne.run_id = '<latest run id>'
  order by wn.type
"
```

Expected: no rows where `type` starts with `stats-`.

- [ ] **Step 5: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/workflows/types.ts src/routes/api/workflows/\[id\]/run/+server.ts src/lib/workflows/scheduler.ts
git commit -m "feat(canvas): exclude stats nodes from workflow execution pipeline"
```

---

## Task 14: useStats fetch helper (Svelte 5 rune)

**Files:**
- Create: `src/lib/canvas/stats/useStats.svelte.ts`

- [ ] **Step 1: Implement**

Create `src/lib/canvas/stats/useStats.svelte.ts`:

```ts
export type StatsEndpoint = 'summary' | 'trends' | 'per-node';

export interface StatsState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useStats<T>(
  slug: () => string,
  endpoint: StatsEndpoint,
  period: () => string,
) {
  let state = $state<StatsState<T>>({ data: null, loading: true, error: null });
  let abortController: AbortController | null = null;

  async function load() {
    abortController?.abort();
    abortController = new AbortController();
    state.loading = true;
    state.error = null;
    try {
      const res = await fetch(
        `/api/canvas/${slug()}/stats/${endpoint}?period=${encodeURIComponent(period())}`,
        { signal: abortController.signal },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      const json = await res.json();
      state.data = json.data as T;
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      state.error = err instanceof Error ? err.message : String(err);
    } finally {
      state.loading = false;
    }
  }

  $effect(() => {
    // Re-run when period() or slug() changes
    slug();
    period();
    load();
  });

  return {
    get data() {
      return state.data;
    },
    get loading() {
      return state.loading;
    },
    get error() {
      return state.error;
    },
    refresh: load,
  };
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/useStats.svelte.ts
git commit -m "feat(canvas/stats): add useStats rune helper"
```

---

## Task 15: TimeFilter component

**Files:**
- Create: `src/lib/canvas/stats/TimeFilter.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/canvas/stats/TimeFilter.svelte`:

```svelte
<script lang="ts">
  interface Props {
    value: string;
    onchange: (preset: string) => void;
  }
  let { value, onchange }: Props = $props();

  const OPTIONS: Array<{ value: string; label: string }> = [
    { value: '24h', label: 'Last 24h' },
    { value: 'this-week', label: 'This week' },
    { value: 'last-week', label: 'Last week' },
    { value: '30d', label: 'Last 30 days' },
    { value: 'last-month', label: 'Last full month' },
    { value: 'all', label: 'All time' },
  ];
</script>

<select
  class="time-filter"
  {value}
  onchange={(e) => onchange((e.currentTarget as HTMLSelectElement).value)}
  title="Period applied to all stats nodes on this canvas"
>
  {#each OPTIONS as opt (opt.value)}
    <option value={opt.value}>{opt.label}</option>
  {/each}
</select>

<style>
  .time-filter {
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.1));
    background: var(--bg-subtle, rgba(255, 255, 255, 0.04));
    color: var(--text-primary, #e6e6e6);
    font: 11px / 1 ui-monospace, Menlo, monospace;
    cursor: pointer;
  }
  .time-filter:hover {
    background: var(--bg-hover, rgba(255, 255, 255, 0.07));
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/TimeFilter.svelte
git commit -m "feat(canvas/stats): add TimeFilter dropdown component"
```

---

## Task 16: SummaryNode component

**Files:**
- Create: `src/lib/canvas/stats/SummaryNode.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/canvas/stats/SummaryNode.svelte`:

```svelte
<script lang="ts">
  import { Chart, Svg, Area, Spline } from 'layerchart';
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent, formatRelative } from './format';

  interface SummaryData {
    counters: {
      runs: number;
      success: number;
      failed: number;
      healing: number;
      successRate: number;
      avgDurationMs: number | null;
    };
    sparkline: Array<{ bucket: string; count: number }>;
    recentRuns: Array<{ id: string; status: string; startedAt: string; durationMs: number | null }>;
    recentEdits: Array<{ at: string; entity: string; action: string; details: Record<string, unknown> }>;
  }

  interface Props {
    slug: string;
    period: string;
  }
  let { slug, period }: Props = $props();

  const stats = useStats<SummaryData>(
    () => slug,
    'summary',
    () => period,
  );

  function editLine(e: SummaryData['recentEdits'][number]): string {
    const d = e.details as Record<string, string>;
    if (e.entity === 'node' && e.action === 'create') return `+ node ${d.label ?? ''} (${d.nodeType ?? ''})`;
    if (e.entity === 'node' && e.action === 'delete') return `− node ${d.label ?? ''} (${d.nodeType ?? ''})`;
    if (e.entity === 'node' && e.action === 'rename') return `renamed ${d.old} → ${d.new}`;
    if (e.entity === 'node' && e.action === 'config') return `config ${d.field}: ${fmt(d.old)} → ${fmt(d.new)}`;
    if (e.entity === 'edge' && e.action === 'create') return `+ edge ${d.fromLabel ?? d.from} → ${d.toLabel ?? d.to}`;
    if (e.entity === 'edge' && e.action === 'delete') return `− edge ${d.fromLabel ?? d.from} → ${d.toLabel ?? d.to}`;
    if (e.entity === 'trigger') return `trigger updated`;
    if (e.entity === 'workflow' && e.action === 'rename') return `${d.field}: ${fmt(d.old)} → ${fmt(d.new)}`;
    return `${e.entity} ${e.action}`;
  }
  function fmt(v: unknown): string {
    if (typeof v === 'string') return `"${v}"`;
    return JSON.stringify(v);
  }
</script>

<div class="stats-node stats-summary">
  <header>
    <span class="title">Stats · summary</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    {@const c = stats.data.counters}
    <div class="counters">
      <div class="counter"><span class="v">{c.runs}</span><span class="l">runs</span></div>
      <div class="counter"><span class="v ok">{c.success}</span><span class="l">success</span></div>
      <div class="counter"><span class="v fail">{c.failed}</span><span class="l">failed</span></div>
      <div class="counter"><span class="v">{formatPercent(c.successRate)}</span><span class="l">rate</span></div>
      <div class="counter"><span class="v">{formatDurationMs(c.avgDurationMs)}</span><span class="l">avg</span></div>
    </div>

    <div class="spark" aria-hidden>
      {#if stats.data.sparkline.length > 1}
        <Chart
          data={stats.data.sparkline.map((p) => ({ t: new Date(p.bucket), v: p.count }))}
          x="t"
          y="v"
          padding={{ top: 4, bottom: 4 }}
        >
          <Svg>
            <Area fill="var(--accent)" fillOpacity={0.15} />
            <Spline stroke="var(--accent)" strokeWidth={1.5} />
          </Svg>
        </Chart>
      {/if}
    </div>

    <section class="list">
      <h4>Recent runs</h4>
      {#if stats.data.recentRuns.length === 0}
        <div class="empty">No runs in this window</div>
      {:else}
        <ul>
          {#each stats.data.recentRuns as r (r.id)}
            <li>
              <span class={`dot s-${r.status}`}></span>
              <span class="dur">{formatDurationMs(r.durationMs)}</span>
              <span class="when">{formatRelative(new Date(r.startedAt))}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="list">
      <h4>Recent edits</h4>
      {#if stats.data.recentEdits.length === 0}
        <div class="empty">No edits recorded yet</div>
      {:else}
        <ul>
          {#each stats.data.recentEdits as e (e.at + e.entity + e.action)}
            <li>
              <span class="when">{formatRelative(new Date(e.at))}</span>
              <span class="edit">{editLine(e)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .stats-node {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 10px;
    gap: 8px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh {
    background: transparent; border: none; color: var(--text-muted, #888);
    cursor: pointer; font-size: 14px; padding: 0 4px;
  }
  .refresh:hover { color: var(--text-primary, #e6e6e6); }
  .counters { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
  .counter { display: flex; flex-direction: column; align-items: center; }
  .counter .v { font-size: 14px; font-weight: 600; }
  .counter .v.ok { color: #3a8a56; }
  .counter .v.fail { color: #c44; }
  .counter .l { color: var(--text-muted, #888); font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; }
  .spark { height: 32px; }
  .list h4 { font-size: 10px; margin: 4px 0 2px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
  .list ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; max-height: 120px; overflow-y: auto; }
  .list li { display: flex; gap: 6px; align-items: center; font-size: 10px; }
  .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-muted, #888); }
  .dot.s-completed { background: #3a8a56; }
  .dot.s-failed { background: #c44; }
  .dot.s-running { background: #ffcf40; }
  .dur { min-width: 40px; color: var(--text-muted, #888); }
  .when { color: var(--text-muted, #888); }
  .edit { color: var(--text-primary, #e6e6e6); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty, .skel { color: var(--text-muted, #888); font-style: italic; font-size: 10px; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/SummaryNode.svelte
git commit -m "feat(canvas/stats): add SummaryNode component"
```

---

## Task 17: TrendsNode component

**Files:**
- Create: `src/lib/canvas/stats/TrendsNode.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/canvas/stats/TrendsNode.svelte`:

```svelte
<script lang="ts">
  import { Chart, Svg, Bars, Spline, Axis } from 'layerchart';
  import { useStats } from './useStats.svelte';
  import { formatDurationMs } from './format';

  interface TrendsData {
    buckets: Array<{
      t: string;
      runs: { success: number; failed: number; healing: number };
      durationMs: { p50: number | null; p95: number | null; avg: number | null };
    }>;
  }

  interface Props {
    slug: string;
    period: string;
  }
  let { slug, period }: Props = $props();

  const stats = useStats<TrendsData>(
    () => slug,
    'trends',
    () => period,
  );

  const runsSeries = $derived(
    stats.data?.buckets.map((b) => ({
      t: new Date(b.t),
      success: b.runs.success,
      failed: b.runs.failed,
      healing: b.runs.healing,
      total: b.runs.success + b.runs.failed + b.runs.healing,
    })) ?? [],
  );

  const durationSeries = $derived(
    stats.data?.buckets.map((b) => ({
      t: new Date(b.t),
      p50: b.durationMs.p50 ?? null,
      p95: b.durationMs.p95 ?? null,
    })) ?? [],
  );
</script>

<div class="stats-node stats-trends">
  <header>
    <span class="title">Stats · trends</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <section class="chart-block">
      <h4>Runs over time</h4>
      <div class="chart-host">
        <Chart data={runsSeries} x="t" y="total" padding={{ top: 8, right: 8, bottom: 24, left: 32 }}>
          <Svg>
            <Axis placement="left" rule grid ticks={3} />
            <Axis placement="bottom" rule />
            <Bars y="success" fill="#3a8a56" strokeWidth={0} />
            <Bars y="failed" fill="#c44" strokeWidth={0} />
            <Bars y="healing" fill="#ffcf40" strokeWidth={0} />
          </Svg>
        </Chart>
      </div>
    </section>

    <section class="chart-block">
      <h4>Run duration (p50 / p95)</h4>
      <div class="chart-host">
        <Chart data={durationSeries} x="t" y="p95" padding={{ top: 8, right: 8, bottom: 24, left: 40 }}>
          <Svg>
            <Axis placement="left" rule grid ticks={3} format={(v: number) => formatDurationMs(v)} />
            <Axis placement="bottom" rule />
            <Spline y="p50" stroke="var(--accent)" strokeWidth={1.5} />
            <Spline y="p95" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" />
          </Svg>
        </Chart>
      </div>
    </section>
  {/if}
</div>

<style>
  .stats-node {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    padding: 10px; gap: 8px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted, #888); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .chart-block { display: flex; flex-direction: column; gap: 2px; flex: 1; min-height: 0; }
  .chart-block h4 { font-size: 10px; margin: 0; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: 0.5px; }
  .chart-host { flex: 1; min-height: 80px; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
  .skel { color: var(--text-muted, #888); font-style: italic; font-size: 10px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/TrendsNode.svelte
git commit -m "feat(canvas/stats): add TrendsNode component"
```

---

## Task 18: PerNodeNode component

**Files:**
- Create: `src/lib/canvas/stats/PerNodeNode.svelte`

- [ ] **Step 1: Implement**

Create `src/lib/canvas/stats/PerNodeNode.svelte`:

```svelte
<script lang="ts">
  import { useStats } from './useStats.svelte';
  import { formatDurationMs, formatPercent } from './format';

  interface PerNodeRow {
    nodeId: string;
    label: string;
    type: string;
    runs: number;
    success: number;
    failed: number;
    avgMs: number | null;
    p95Ms: number | null;
    lastError: { at: string; message: string } | null;
  }

  interface PerNodeData { nodes: PerNodeRow[]; }

  interface Props {
    slug: string;
    period: string;
    onrowclick?: (nodeId: string) => void;
  }
  let { slug, period, onrowclick }: Props = $props();

  const stats = useStats<PerNodeData>(() => slug, 'per-node', () => period);

  type SortKey = 'label' | 'runs' | 'successRate' | 'avgMs' | 'p95Ms';
  let sortKey = $state<SortKey>('runs');
  let sortDesc = $state(true);

  const rows = $derived.by(() => {
    const src = stats.data?.nodes ?? [];
    const sorted = [...src].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortKey === 'label') { av = a.label; bv = b.label; }
      else if (sortKey === 'runs') { av = a.runs; bv = b.runs; }
      else if (sortKey === 'successRate') {
        av = a.runs ? a.success / a.runs : -1;
        bv = b.runs ? b.success / b.runs : -1;
      }
      else if (sortKey === 'avgMs') { av = a.avgMs ?? -1; bv = b.avgMs ?? -1; }
      else if (sortKey === 'p95Ms') { av = a.p95Ms ?? -1; bv = b.p95Ms ?? -1; }
      if (av < bv) return sortDesc ? 1 : -1;
      if (av > bv) return sortDesc ? -1 : 1;
      return 0;
    });
    return sorted;
  });

  function toggleSort(k: SortKey) {
    if (sortKey === k) sortDesc = !sortDesc;
    else { sortKey = k; sortDesc = true; }
  }
</script>

<div class="stats-node stats-pernode">
  <header>
    <span class="title">Stats · per-node</span>
    <button class="refresh" onclick={() => stats.refresh()} title="Refresh">⟳</button>
  </header>

  {#if stats.error}
    <div class="error-strip">{stats.error}</div>
  {:else if stats.loading && !stats.data}
    <div class="skel">Loading…</div>
  {:else if stats.data}
    <div class="table-host">
      <table>
        <thead>
          <tr>
            <th onclick={() => toggleSort('label')} class:active={sortKey === 'label'}>Node</th>
            <th onclick={() => toggleSort('runs')} class:active={sortKey === 'runs'} class="num">Runs</th>
            <th onclick={() => toggleSort('successRate')} class:active={sortKey === 'successRate'} class="num">Success</th>
            <th onclick={() => toggleSort('avgMs')} class:active={sortKey === 'avgMs'} class="num">Avg</th>
            <th onclick={() => toggleSort('p95Ms')} class:active={sortKey === 'p95Ms'} class="num">p95</th>
            <th>Last error</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as r (r.nodeId)}
            <tr onclick={() => onrowclick?.(r.nodeId)} class:clickable={!!onrowclick}>
              <td>
                <div class="label">{r.label}</div>
                <div class="type">{r.type}</div>
              </td>
              <td class="num">{r.runs}</td>
              <td class="num">{r.runs ? formatPercent(r.success / r.runs) : '—'}</td>
              <td class="num">{formatDurationMs(r.avgMs)}</td>
              <td class="num">{formatDurationMs(r.p95Ms)}</td>
              <td class="err" title={r.lastError?.message ?? ''}>
                {r.lastError ? r.lastError.message.slice(0, 60) : '—'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .stats-node {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    padding: 10px; gap: 8px;
    background: var(--bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
    border-radius: 8px;
    font: 11px / 1.4 ui-monospace, Menlo, monospace;
    color: var(--text-primary, #e6e6e6);
    overflow: hidden;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  .title { font-weight: 600; font-size: 12px; }
  .refresh { background: transparent; border: none; color: var(--text-muted, #888); cursor: pointer; font-size: 14px; padding: 0 4px; }
  .table-host { flex: 1; overflow: auto; min-height: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.06)); }
  th { cursor: pointer; user-select: none; color: var(--text-muted, #888); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; font-size: 9px; }
  th.active { color: var(--text-primary, #e6e6e6); }
  th.num, td.num { text-align: right; }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover { background: var(--bg-hover, rgba(255, 255, 255, 0.05)); }
  .label { font-weight: 500; }
  .type { color: var(--text-muted, #888); font-size: 9px; }
  .err { color: #c44; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .error-strip { color: #c44; font-size: 10px; padding: 4px; border: 1px solid #c44; border-radius: 4px; }
  .skel { color: var(--text-muted, #888); font-style: italic; font-size: 10px; }
</style>
```

- [ ] **Step 2: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/lib/canvas/stats/PerNodeNode.svelte
git commit -m "feat(canvas/stats): add PerNodeNode component"
```

---

## Task 19: Page integration — render stats nodes, TimeFilter, period wiring

**Files:**
- Modify: `src/routes/jkai/canvas/[slug]/+page.svelte`

- [ ] **Step 1: Imports + page-level period state**

In the `<script lang="ts">` block of `src/routes/jkai/canvas/[slug]/+page.svelte`, add imports near the top (with the existing import block):

```ts
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import TimeFilter from '$lib/canvas/stats/TimeFilter.svelte';
  import SummaryNode from '$lib/canvas/stats/SummaryNode.svelte';
  import TrendsNode from '$lib/canvas/stats/TrendsNode.svelte';
  import PerNodeNode from '$lib/canvas/stats/PerNodeNode.svelte';
```

Then, alongside the other `$derived` / `$state` declarations, add:

```ts
  const period = $derived(($page.url.searchParams.get('period') ?? '30d') as string);
  async function changePeriod(next: string) {
    const url = new URL($page.url);
    url.searchParams.set('period', next);
    await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
  const hasStatsNode = $derived(viewNodes.some((n) => n.kind === 'stats'));
```

- [ ] **Step 2: Add TimeFilter to the toolbar**

Find the `<div class="toolbar-right">` block (around line 1244). Immediately before the `<button class="composer-pill run-btn"` button, add:

```svelte
      {#if hasStatsNode}
        <TimeFilter value={period} onchange={changePeriod} />
      {/if}
```

- [ ] **Step 3: Render stats nodes in the node loop**

Locate the existing `{#each viewNodes as n (n.id)}` render block. Inside the loop, find the branching by `n.kind`. Add branches for the stats kind:

```svelte
    {:else if n.kind === 'stats'}
      <div
        class="node-wrap stats-wrap"
        style="left: {n.x}px; top: {n.y}px; width: {nodeW(n)}px; height: {nodeH(n)}px;"
        data-node-id={n.id}
        onpointerdown={(e) => startDrag(e, n.id)}
      >
        {#if n.type === 'stats-summary'}
          <SummaryNode slug={canvas.slug} period={period} />
        {:else if n.type === 'stats-trends'}
          <TrendsNode slug={canvas.slug} period={period} />
        {:else if n.type === 'stats-per-node'}
          <PerNodeNode
            slug={canvas.slug}
            period={period}
            onrowclick={(nodeId) => scrollToNode(nodeId)}
          />
        {/if}
        <span
          class="resize-handle"
          onpointerdown={(e) => onChatResizeDown(e, n)}
          onpointermove={onChatResizeMove}
          onpointerup={onChatResizeUp}
        ></span>
      </div>
```

(Use the same `startDrag` / resize helpers the chat/inspector branches use. If those branches use specific handlers named differently, match their names.)

- [ ] **Step 4: Enable resize for stats nodes**

In `resizableSize(n)` (near line 55), the existing code handles chat and inspector sizing. Stats nodes already have a `config.size` default. Extend the `defaultW`/`defaultH` resolution:

```ts
  function resizableSize(n: CanvasNode): { w: number; h: number } {
    const override = chatSizes[n.id];
    if (override) return override;
    const cfgSize = (n.config?.size as { w?: number; h?: number } | undefined) ?? null;
    const defaults: Record<string, { w: number; h: number }> = {
      chat: { w: CHAT_NODE_W, h: CHAT_NODE_H },
      inspector: { w: INSPECTOR_NODE_W, h: INSPECTOR_NODE_H },
      stats: { w: 420, h: 360 },
    };
    const { w: defaultW, h: defaultH } = defaults[n.kind] ?? { w: NODE_W, h: NODE_H };
    return {
      w: typeof cfgSize?.w === 'number' ? cfgSize.w : defaultW,
      h: typeof cfgSize?.h === 'number' ? cfgSize.h : defaultH,
    };
  }
```

And in `nodeW` / `nodeH`, add the `stats` kind alongside `chat`/`inspector`:

```ts
  function nodeW(n: CanvasNode | { kind: string }) {
    if (n.kind === 'chat' || n.kind === 'inspector' || n.kind === 'stats') return resizableSize(n as CanvasNode).w;
    if (n.kind === 'trigger') return 188;
    return NODE_W;
  }
  function nodeH(n: CanvasNode | { kind: string }) {
    if (n.kind === 'chat' || n.kind === 'inspector' || n.kind === 'stats') return resizableSize(n as CanvasNode).h;
    return NODE_H;
  }
```

- [ ] **Step 5: Add the `stats` colour to `KIND_COLOR`**

```ts
  const KIND_COLOR: Record<string, string> = {
    trigger: '#3a8a56',
    input: 'var(--text-muted)',
    llm: 'var(--accent)',
    parse: '#c44',
    output: 'var(--text-primary)',
    intel: 'var(--accent)',
    agent: 'var(--text-primary)',
    chat: 'var(--accent)',
    inspector: '#567',
    stats: '#7a6cd4',
  };
```

- [ ] **Step 6: Implement `scrollToNode` + flash**

Inside `<script>`, add:

```ts
  let flashNodeId = $state<string | null>(null);
  async function scrollToNode(nodeId: string) {
    const n = byId[nodeId];
    if (!n) return;
    // Centre the viewport on the node; re-use the existing pan/zoom state.
    const cx = n.x + nodeW(n) / 2;
    const cy = n.y + nodeH(n) / 2;
    // Update the pan offsets used by the existing transform (match the existing state names).
    // Most canvases expose `panX` / `panY` and a viewport element rect; if names differ, adapt here.
    panX = (typeof window !== 'undefined' ? window.innerWidth / 2 : 0) - cx * zoom;
    panY = (typeof window !== 'undefined' ? window.innerHeight / 2 : 0) - cy * zoom;
    flashNodeId = nodeId;
    setTimeout(() => {
      if (flashNodeId === nodeId) flashNodeId = null;
    }, 800);
  }
```

Then add a class binding on every rendered node element (look for the main `<div class="node-wrap"` blocks and add):

```svelte
class:flash={flashNodeId === n.id}
```

Add to the page `<style>`:

```css
  .node-wrap.flash {
    outline: 2px solid var(--accent, #7a6cd4);
    outline-offset: 3px;
    animation: node-flash 0.8s ease-out;
  }
  @keyframes node-flash {
    0% { outline-color: var(--accent, #7a6cd4); outline-offset: 0; }
    50% { outline-color: var(--accent, #7a6cd4); outline-offset: 6px; }
    100% { outline-color: transparent; outline-offset: 3px; }
  }
```

(If the canvas uses `transform: translate(panX, panY) scale(zoom)` under different names, adjust. If you're unsure of the pan state variable names, grep for `transform:` inside the existing `+page.svelte` to find them.)

- [ ] **Step 7: Disable edge drag on stats nodes**

Locate the edge-drag handlers (they usually live on each node's port/handle element — grep for `onPointerDown` or `startEdge`). Where the handler begins, add an early return:

```ts
  // In whatever function starts an edge drag from a node:
  if (n.kind === 'stats') return;
```

And where a drop target is resolved for an incoming edge-drag, reject stats kinds the same way. As a belt-and-braces backstop, the API already rejects them (Task 5), so this is purely UX.

- [ ] **Step 8: Refresh stats after run completion**

Inside `<script>`, find where `runMeta.state` transitions to `completed`/`failed` (search for `runMeta.state = 'completed'` and `runMeta.state = 'failed'`). Right after each such transition, dispatch a custom event the stats nodes can listen to, OR (simpler) use a `$state` counter incremented on completion, then pass it to the nodes as a prop. Quickest option: the existing code already calls `invalidateAll()` after completion — and stats node `useStats` re-fetches on `period` change only. Add a lightweight refresh key:

```ts
  let refreshKey = $state(0);
  // After run completion, in the handler that flips runMeta.state:
  refreshKey += 1;
```

Pass it to the stats components:

```svelte
        {#if n.type === 'stats-summary'}
          <SummaryNode slug={canvas.slug} period={period} refreshKey={refreshKey} />
        {:else if n.type === 'stats-trends'}
          <TrendsNode slug={canvas.slug} period={period} refreshKey={refreshKey} />
        {:else if n.type === 'stats-per-node'}
          <PerNodeNode
            slug={canvas.slug}
            period={period}
            refreshKey={refreshKey}
            onrowclick={(nodeId) => scrollToNode(nodeId)}
          />
        {/if}
```

Update `useStats.svelte.ts`, `SummaryNode.svelte`, `TrendsNode.svelte`, `PerNodeNode.svelte` to accept `refreshKey: number` and include it in the `$effect` read-set so the fetch re-runs when it changes:

```ts
// in each node component:
interface Props { slug: string; period: string; refreshKey?: number; onrowclick?: (id: string) => void; }
let { slug, period, refreshKey = 0, onrowclick }: Props = $props();

const stats = useStats<…>(() => slug, '…', () => period, () => refreshKey);

// in useStats.svelte.ts:
export function useStats<T>(
  slug: () => string,
  endpoint: StatsEndpoint,
  period: () => string,
  refreshKey: () => number = () => 0,
) {
  // …
  $effect(() => {
    slug(); period(); refreshKey();
    load();
  });
  // …
}
```

- [ ] **Step 9: Smoke test end-to-end**

1. `cd ~/strange_rambling_svelte && npm run dev`
2. Open `http://homeserv:5173/jkai/canvas/canvas-sample`
3. Add each of the three stats nodes (+ menu → Observability → one each).
4. Verify TimeFilter appears in the toolbar.
5. Change the filter; verify each node refetches.
6. Click Run; verify nodes refresh after completion.
7. Try dragging an edge from a stats node → nothing happens (Step 7 gate).
8. Click a row in the per-node table; canvas should pan to the referenced node and flash it.
9. Change the description of a node via the config UI; reload the summary node — new "recent edit" should appear.

- [ ] **Step 10: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/jkai/canvas/\[slug\]/+page.svelte src/lib/canvas/stats/
git commit -m "feat(canvas): render stats nodes + shared time filter on canvas page"
```

---

## Task 20: Deploy

Per `feedback_always_deploy.md`: after pushing to `master`, run the deploy script.

- [ ] **Step 1: Push**

```bash
cd ~/strange_rambling_svelte
git push origin master
```

- [ ] **Step 2: Deploy**

```bash
cd ~/strange_rambling_svelte && bash scripts/deploy.sh
```

- [ ] **Step 3: Verify live**

Open `https://strangeramblings.com/jkai/canvas/canvas-sample` and repeat the Task 19 smoke checks. If the DB migration hasn't propagated to VPS, run `drizzle-kit push` against the production `DATABASE_URL` (follow the deploy script's existing conventions — if it handles migrations automatically, great; if not, run them manually).

---

## Self-Review

**Spec coverage:**
- Node registration (spec §1): Task 12 ✓
- Display-only enforcement (spec §Display-only enforcement): Task 13 (executor), Task 5 (edge), Task 19 Step 7 (UI) ✓
- Shared time filter URL + dropdown (spec §Shared Time Filter): Tasks 15, 19 ✓
- Period resolver (spec §Period → window resolution): Task 7 ✓
- Audit log schema (spec §Audit Log): Task 1 ✓
- Audit helper (spec §Helper): Task 2 ✓
- Audit write points (spec §Write points, all rows of the table): Tasks 4 (node), 5 (edge), 6 (workflow + trigger) ✓
  - **Gap:** `schedule` entity write points not covered in my plan. Added as Task 21 below.
- Summary API (spec §Stats API summary): Task 9 ✓
- Trends API (spec §Stats API trends): Task 10 ✓
- Per-node API (spec §Stats API per-node): Task 11 ✓
- useStats helper (spec §useStats.svelte.ts): Task 14 ✓
- Node rendering components (spec §Rendering): Tasks 16, 17, 18 ✓
- Per-node table row click (spec §Per-node table): Task 19 Step 6 ✓
- Refresh on run completion (spec §Refresh semantics): Task 19 Step 8 ✓

**Placeholder scan:** grep for "TBD", "TODO", "implement later", "etc.", "similar to" → none introduced.

**Type consistency:** `SummaryData`, `TrendsData`, `PerNodeData` match the API response `data` shape in Tasks 9/10/11. `PeriodPreset` / `Granularity` exported and reused. `isDisplayOnlyType` exported from `$lib/workflows/types` and imported at both call sites.

**Fix-inline — add schedule audit task:**

---

## Task 21: Audit schedule mutations

**Files:**
- Modify: any existing schedule-mutating route(s) — these live under `src/routes/api/workflows/[id]/schedule/+server.ts` or similar (grep `workflowSchedules` under `src/routes/api/workflows/` to find them).

- [ ] **Step 1: Find the routes**

Run: `cd ~/strange_rambling_svelte && grep -rln 'workflowSchedules' src/routes/api/workflows/`
Expected output lists the schedule mutation routes (POST / PATCH / DELETE handlers).

- [ ] **Step 2: Add audit calls**

For each handler that inserts, updates, or deletes from `workflowSchedules`:

```ts
import { recordAudit } from '$lib/canvas/audit';
// …
await recordAudit({
  workflowId: params.id,
  entity: 'schedule',
  entityId: /* schedule.id */,
  action: /* 'create' | 'update' | 'delete' */,
  details: { cron: /* … */, enabled: /* … */ },
});
```

- [ ] **Step 3: Smoke**

Toggle a schedule in the UI. Verify a `workflow_audit_log` row appears with `entity='schedule'`.

- [ ] **Step 4: Commit**

```bash
cd ~/strange_rambling_svelte
git add src/routes/api/workflows/\[id\]/schedule/
git commit -m "feat(canvas): audit workflow schedule mutations"
```
