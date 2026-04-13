# Workflow Engine Phase 6: Scheduling & Events

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side scheduling (cron + event triggers + webhook triggers), a schedule management UI in the workflow editor, schedule API routes, and wire event emissions from existing Strava/Whoop sync code.

**Architecture:**
- `src/lib/workflows/scheduler.ts` — `croner`-based cron scheduler, loaded once in `hooks.server.ts`
- `src/lib/workflows/event-bus.ts` — in-process EventEmitter for platform events
- `src/routes/api/workflows/webhook/[id]/+server.ts` — POST endpoint for webhook triggers
- `src/routes/api/workflows/[id]/schedule/+server.ts` — GET/PUT/DELETE schedule API
- `WorkflowToolbar.svelte` modified to add a trigger config button + modal

**Dependencies:** Phase 1 (engine + DB), Phase 4 (all core nodes). Phase 5 (Strava/Whoop nodes) is helpful but not required for scheduling itself.

**DB tables used:** `workflowSchedules` (already in schema from Phase 1 migration). `workflows` table `trigger` jsonb column stores the trigger type/config.

**Tech Stack:** `croner` (verify installed: `npm ls croner`; if missing, `npm install croner`), Node.js `EventEmitter`, SvelteKit server hooks.

---

## Task 1: Cron Scheduler

**Files:**
- Create: `src/lib/workflows/scheduler.ts`
- Modify: `src/hooks.server.ts`

- [ ] **Step 1.1: Verify croner is installed**

```bash
npm ls croner
```

If missing: `npm install croner`

- [ ] **Step 1.2: Create the scheduler module**

Create `src/lib/workflows/scheduler.ts`:

```typescript
import { Cron } from 'croner';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowRuns } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import { registry } from '$lib/workflows';

// Tracks active Cron instances keyed by schedule ID
const activeJobs = new Map<string, Cron>();

export async function startScheduler(): Promise<void> {
  console.log('[scheduler] Starting cron scheduler...');
  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'cron'), eq(workflowSchedules.enabled, true)));

  for (const schedule of schedules) {
    registerCronJob(schedule);
  }
  console.log(`[scheduler] Registered ${schedules.length} cron jobs`);
}

export async function stopScheduler(): Promise<void> {
  for (const [id, job] of activeJobs) {
    job.stop();
    activeJobs.delete(id);
  }
  console.log('[scheduler] All cron jobs stopped');
}

export function registerCronJob(schedule: {
  id: string;
  workflowId: string;
  config: Record<string, unknown>;
}): void {
  // Remove existing job for this schedule if any
  activeJobs.get(schedule.id)?.stop();
  activeJobs.delete(schedule.id);

  const expression = schedule.config.expression as string;
  if (!expression) {
    console.warn(`[scheduler] Schedule ${schedule.id} has no cron expression — skipping`);
    return;
  }

  const job = new Cron(expression, async () => {
    await runScheduledWorkflow(schedule.workflowId, schedule.id);
  });

  activeJobs.set(schedule.id, job);
}

export function unregisterCronJob(scheduleId: string): void {
  activeJobs.get(scheduleId)?.stop();
  activeJobs.delete(scheduleId);
}

async function runScheduledWorkflow(workflowId: string, scheduleId: string): Promise<void> {
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, workflowId)).limit(1);
  if (!workflow) {
    console.warn(`[scheduler] Workflow ${workflowId} not found, stopping job`);
    unregisterCronJob(scheduleId);
    return;
  }

  const runId = crypto.randomUUID();
  const now = new Date();

  await db.insert(workflowRuns).values({
    id: runId,
    workflowId,
    status: 'running',
    trigger: 'scheduled',
    startedAt: now,
  });

  console.log(`[scheduler] Starting run ${runId} for workflow ${workflowId}`);

  try {
    // Build workflow definition from DB nodes/edges
    const { workflowNodes, workflowEdges } = await import('$lib/db/schema');
    const { eq: eqFn } = await import('drizzle-orm');
    const nodes = await db.select().from(workflowNodes).where(eqFn(workflowNodes.workflowId, workflowId));
    const edges = await db.select().from(workflowEdges).where(eqFn(workflowEdges.workflowId, workflowId));

    const def = {
      id: workflowId,
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

    const result = await engine.execute(def, runId, {}, undefined, workflowId);

    await db
      .update(workflowRuns)
      .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
      .where(eq(workflowRuns.id, runId));

    // Update lastRunAt/nextRunAt on the schedule
    const job = activeJobs.get(scheduleId);
    await db
      .update(workflowSchedules)
      .set({
        lastRunAt: now,
        nextRunAt: job?.nextRun() ?? null,
      })
      .where(eq(workflowSchedules.id, scheduleId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(workflowRuns)
      .set({ status: 'failed', completedAt: new Date(), error: message })
      .where(eq(workflowRuns.id, runId));
    console.error(`[scheduler] Run ${runId} failed:`, message);
  }
}

// Hot-reload: called when a schedule is created/updated/deleted via API
export async function reloadSchedule(scheduleId: string): Promise<void> {
  const [schedule] = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.id, scheduleId))
    .limit(1);

  if (!schedule || !schedule.enabled || schedule.type !== 'cron') {
    unregisterCronJob(scheduleId);
    return;
  }
  registerCronJob(schedule as Parameters<typeof registerCronJob>[0]);
}
```

- [ ] **Step 1.3: Wire into hooks.server.ts**

In `src/hooks.server.ts`, import and call `startScheduler()` on server startup. If the file doesn't exist yet, create it:

```typescript
import { startScheduler } from '$lib/workflows/scheduler';

// Server startup hook
startScheduler().catch((err) => {
  console.error('[hooks.server] Scheduler failed to start:', err);
});
```

If `hooks.server.ts` already exists, add the import and call within the existing server init section, after any DB setup.

---

## Task 2: Event Bus

**Files:**
- Create: `src/lib/workflows/event-bus.ts`

- [ ] **Step 2.1: Create the event bus**

Create `src/lib/workflows/event-bus.ts`:

```typescript
import { EventEmitter } from 'events';
import { db } from '$lib/db';
import { workflowSchedules, workflows, workflowRuns, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { engine } from '$lib/workflows';

export type PlatformEventType =
  | 'strava_activity_synced'
  | 'whoop_recovery_updated'
  | 'workflow_completed';

export interface PlatformEvent {
  type: PlatformEventType;
  payload?: Record<string, unknown>;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emit(type: PlatformEventType, payload?: Record<string, unknown>): void {
  emitter.emit(type, { type, payload });
}

export function on(
  type: PlatformEventType,
  handler: (event: PlatformEvent) => void
): () => void {
  emitter.on(type, handler);
  return () => emitter.off(type, handler);
}

// Internal: start any event-triggered workflows matching this event type
async function handlePlatformEvent(event: PlatformEvent): Promise<void> {
  const schedules = await db
    .select()
    .from(workflowSchedules)
    .where(and(eq(workflowSchedules.type, 'event'), eq(workflowSchedules.enabled, true)));

  const matching = schedules.filter((s) => {
    const config = s.config as Record<string, unknown>;
    return config.eventType === event.type;
  });

  for (const schedule of matching) {
    const [wf] = await db
      .select()
      .from(workflows)
      .where(eq(workflows.id, schedule.workflowId))
      .limit(1);
    if (!wf) continue;

    const runId = crypto.randomUUID();
    const now = new Date();

    await db.insert(workflowRuns).values({
      id: runId,
      workflowId: schedule.workflowId,
      status: 'running',
      trigger: 'event',
      startedAt: now,
    });

    const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, schedule.workflowId));
    const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, schedule.workflowId));

    const def = {
      id: schedule.workflowId,
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

    engine
      .execute(def, runId, { event: event.payload ?? {} }, undefined, schedule.workflowId)
      .then(async (result) => {
        await db
          .update(workflowRuns)
          .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
          .where(eq(workflowRuns.id, runId));
      })
      .catch(console.error);
  }
}

// Register global listeners
(['strava_activity_synced', 'whoop_recovery_updated', 'workflow_completed'] as PlatformEventType[])
  .forEach((type) => emitter.on(type, handlePlatformEvent));
```

---

## Task 3: Webhook Trigger Endpoint

**Files:**
- Create: `src/routes/api/workflows/webhook/[id]/+server.ts`

- [ ] **Step 3.1: Create the endpoint**

Create `src/routes/api/workflows/webhook/[id]/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowRuns, workflowNodes, workflowEdges } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';

export const POST: RequestHandler = async ({ params, request }) => {
  const workflowId = params.id;

  const [workflow] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  if (!workflow) throw error(404, 'Workflow not found');

  // Verify this workflow has a webhook trigger type
  const trigger = workflow.trigger as Record<string, unknown> | null;
  if (trigger?.type !== 'webhook') {
    throw error(400, 'This workflow does not have a webhook trigger');
  }

  // Parse the incoming body as the initial workflow input
  let body: Record<string, unknown> = {};
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      body = await request.json();
    } catch {
      // ignore parse errors
    }
  }

  const runId = crypto.randomUUID();
  const now = new Date();

  await db.insert(workflowRuns).values({
    id: runId,
    workflowId,
    status: 'running',
    trigger: 'webhook',
    startedAt: now,
  });

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, workflowId));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, workflowId));

  const def = {
    id: workflowId,
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

  // Run async — respond immediately with the run ID
  engine
    .execute(def, runId, body, undefined, workflowId)
    .then(async (result) => {
      await db
        .update(workflowRuns)
        .set({ status: result.status, completedAt: new Date(), error: result.error ?? null })
        .where(eq(workflowRuns.id, runId));
    })
    .catch(console.error);

  return json({ runId, status: 'running' }, { status: 202 });
};
```

---

## Task 4: Schedule API Routes

**Files:**
- Create: `src/routes/api/workflows/[id]/schedule/+server.ts`

- [ ] **Step 4.1: Create GET/PUT/DELETE endpoint**

Create `src/routes/api/workflows/[id]/schedule/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowSchedules } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { reloadSchedule } from '$lib/workflows/scheduler';

export const GET: RequestHandler = async ({ params }) => {
  const [schedule] = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, params.id))
    .limit(1);

  return json({ schedule: schedule ?? null });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json();

  const { type, config, enabled = true } = body as {
    type: 'cron' | 'event';
    config: Record<string, unknown>;
    enabled?: boolean;
  };

  if (!type || !config) throw error(400, 'type and config are required');

  // Upsert schedule — delete existing then insert
  await db.delete(workflowSchedules).where(eq(workflowSchedules.workflowId, params.id));

  const [schedule] = await db
    .insert(workflowSchedules)
    .values({ workflowId: params.id, type, config, enabled })
    .returning();

  // Hot-reload the cron job if it's a cron type
  if (type === 'cron') {
    await reloadSchedule(schedule.id);
  }

  return json({ schedule });
};

export const DELETE: RequestHandler = async ({ params }) => {
  const [existing] = await db
    .select()
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, params.id))
    .limit(1);

  if (existing) {
    // Unregister cron job before deleting
    const { unregisterCronJob } = await import('$lib/workflows/scheduler');
    unregisterCronJob(existing.id);
    await db.delete(workflowSchedules).where(eq(workflowSchedules.id, existing.id));
  }

  return json({ success: true });
};
```

---

## Task 5: Schedule Management UI

**Files:**
- Modify: `src/lib/components/workflows/WorkflowToolbar.svelte`
- Create: `src/lib/components/workflows/TriggerConfigModal.svelte`

- [ ] **Step 5.1: Create TriggerConfigModal.svelte**

Create `src/lib/components/workflows/TriggerConfigModal.svelte`:

```svelte
<script lang="ts">
  let {
    workflowId,
    onClose,
  }: {
    workflowId: string;
    onClose: () => void;
  } = $props();

  type TriggerType = 'manual' | 'cron' | 'event' | 'webhook';

  let triggerType = $state<TriggerType>('manual');
  let cronExpression = $state('0 8 * * *');
  let eventType = $state('strava_activity_synced');
  let saving = $state(false);
  let loading = $state(true);

  const CRON_PRESETS = [
    { label: 'Every day at 8am', value: '0 8 * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
    { label: 'Every Monday 9am', value: '0 9 * * 1' },
  ];

  const EVENT_TYPES = [
    { label: 'Strava activity synced', value: 'strava_activity_synced' },
    { label: 'Whoop recovery updated', value: 'whoop_recovery_updated' },
    { label: 'Workflow completed', value: 'workflow_completed' },
  ];

  const webhookUrl = $derived(`${window.location.origin}/api/workflows/webhook/${workflowId}`);

  // Load existing schedule
  $effect(() => {
    fetch(`/api/workflows/${workflowId}/schedule`)
      .then((r) => r.json())
      .then(({ schedule }) => {
        if (schedule) {
          triggerType = schedule.type === 'cron' ? 'cron' : schedule.type === 'event' ? 'event' : 'manual';
          if (schedule.type === 'cron') cronExpression = schedule.config.expression ?? '0 8 * * *';
          if (schedule.type === 'event') eventType = schedule.config.eventType ?? 'strava_activity_synced';
        }
      })
      .finally(() => { loading = false; });
  });

  async function save() {
    saving = true;
    try {
      if (triggerType === 'manual') {
        await fetch(`/api/workflows/${workflowId}/schedule`, { method: 'DELETE' });
      } else if (triggerType === 'webhook') {
        // Webhook trigger is stored on workflow.trigger column — just close
        // The webhook endpoint checks for trigger.type === 'webhook' set via PUT /api/workflows/[id]
        await fetch(`/api/workflows/${workflowId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: { type: 'webhook' } }),
        });
      } else {
        const config = triggerType === 'cron'
          ? { expression: cronExpression }
          : { eventType };
        await fetch(`/api/workflows/${workflowId}/schedule`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: triggerType, config, enabled: true }),
        });
      }
      onClose();
    } finally {
      saving = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog">
  <div class="rounded-xl border p-6 w-[440px] space-y-4" style="background: var(--card-bg); border-color: var(--card-border);">
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold" style="color: var(--text-primary);">Trigger Configuration</h2>
      <button onclick={onClose} class="text-xs" style="color: var(--text-ghost);">✕</button>
    </div>

    {#if loading}
      <p class="text-xs" style="color: var(--text-ghost);">Loading...</p>
    {:else}
      <div class="space-y-1">
        <label class="text-xs" style="color: var(--text-ghost);">Trigger type</label>
        <div class="flex gap-2 flex-wrap">
          {#each (['manual', 'cron', 'event', 'webhook'] as TriggerType[]) as t}
            <button
              onclick={() => { triggerType = t; }}
              class="text-xs px-3 py-1.5 rounded border transition-colors"
              style="
                background: {triggerType === t ? 'var(--accent)' : 'var(--card-bg)'};
                border-color: {triggerType === t ? 'var(--accent)' : 'var(--card-border)'};
                color: {triggerType === t ? '#fff' : 'var(--text-secondary)'};
              "
            >
              {t}
            </button>
          {/each}
        </div>
      </div>

      {#if triggerType === 'cron'}
        <div class="space-y-2">
          <label class="text-xs" style="color: var(--text-ghost);">Cron expression</label>
          <input
            bind:value={cronExpression}
            class="w-full text-xs px-3 py-2 rounded border"
            style="background: var(--input-bg); border-color: var(--card-border); color: var(--text-primary); font-family: var(--font-mono);"
            placeholder="0 8 * * *"
          />
          <div class="flex flex-wrap gap-1">
            {#each CRON_PRESETS as preset}
              <button
                onclick={() => { cronExpression = preset.value; }}
                class="text-[10px] px-2 py-1 rounded"
                style="background: var(--card-bg-alt, var(--card-bg)); color: var(--text-ghost); border: 1px solid var(--card-border);"
              >
                {preset.label}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if triggerType === 'event'}
        <div class="space-y-1">
          <label class="text-xs" style="color: var(--text-ghost);">Event type</label>
          <select
            bind:value={eventType}
            class="w-full text-xs px-3 py-2 rounded border"
            style="background: var(--input-bg); border-color: var(--card-border); color: var(--text-primary);"
          >
            {#each EVENT_TYPES as et}
              <option value={et.value}>{et.label}</option>
            {/each}
          </select>
        </div>
      {/if}

      {#if triggerType === 'webhook'}
        <div class="space-y-1">
          <label class="text-xs" style="color: var(--text-ghost);">Webhook URL (POST to trigger)</label>
          <div class="flex gap-2 items-center">
            <code class="text-[10px] flex-1 px-2 py-1.5 rounded border truncate" style="background: var(--card-bg-alt, var(--card-bg)); border-color: var(--card-border); color: var(--text-secondary); font-family: var(--font-mono);">
              {webhookUrl}
            </code>
            <button
              onclick={() => navigator.clipboard.writeText(webhookUrl)}
              class="text-[10px] px-2 py-1.5 rounded border"
              style="border-color: var(--card-border); color: var(--text-ghost);"
            >
              Copy
            </button>
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-2 pt-2">
        <button
          onclick={onClose}
          class="text-xs px-3 py-1.5 rounded border"
          style="border-color: var(--card-border); color: var(--text-ghost);"
        >
          Cancel
        </button>
        <button
          onclick={save}
          disabled={saving}
          class="text-xs px-4 py-1.5 rounded"
          style="background: var(--accent); color: #fff; opacity: {saving ? 0.6 : 1};"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 5.2: Add trigger button to WorkflowToolbar.svelte**

In `src/lib/components/workflows/WorkflowToolbar.svelte`:

1. Add props: `workflowId: string`
2. Add `showTriggerModal = $state(false)`
3. Import `TriggerConfigModal` (dynamic import since it uses `window`)
4. Add a "Trigger" button in the toolbar that sets `showTriggerModal = true`
5. Render `{#if showTriggerModal}<TriggerConfigModal {workflowId} onClose={() => showTriggerModal = false} />{/if}`

Also update `src/routes/workflows/[id]/+page.svelte` to pass `workflowId={data.workflow.id}` to `WorkflowToolbar`.

---

## Task 6: Wire Event Emissions

**Files:**
- Modify: `src/lib/health/sync-service.ts`
- Modify: `src/lib/workflows/engine.ts`

- [ ] **Step 6.1: Emit events from sync-service**

In `src/lib/health/sync-service.ts`, after a successful Strava sync completes (at the end of the Strava sync section where `updateSyncState('strava', 'success', ...)` is called), add:

```typescript
import { emit as emitWorkflowEvent } from '$lib/workflows/event-bus';

// After successful Strava sync:
emitWorkflowEvent('strava_activity_synced', { recordsSynced, syncedAt: new Date().toISOString() });

// After successful Whoop sync:
emitWorkflowEvent('whoop_recovery_updated', { recordsSynced, syncedAt: new Date().toISOString() });
```

Wrap the import in a try/catch or use a dynamic import to avoid circular dependency issues if they arise:

```typescript
try {
  const { emit } = await import('$lib/workflows/event-bus');
  emit('strava_activity_synced', { recordsSynced });
} catch {
  // event-bus not available in this context
}
```

- [ ] **Step 6.2: Emit workflow_completed from engine**

In `src/lib/workflows/engine.ts`, after `emit('run_completed')` and before `cleanupRunEmitter(runId)`:

```typescript
// Emit to platform event bus so event-triggered workflows can chain
try {
  const { emit: emitPlatform } = await import('./event-bus');
  emitPlatform('workflow_completed', { workflowId: workflowId ?? workflow.id, runId });
} catch {
  // event-bus not critical path
}
```
