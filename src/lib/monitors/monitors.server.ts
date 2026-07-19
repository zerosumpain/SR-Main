// Natural-language Monitors — "watch X, tell me when Y". createMonitor turns a
// description into a SCHEDULED workflow (via the existing generator), attaches a
// cron schedule (the generate path does not create the schedule row itself), and
// records a marker in the `monitors` datastore collection so the /jkai/monitors
// page can list + manage them. SERVER ONLY (generator + DB + scheduler).
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowSchedules, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { ensureCollection, upsertRecord, queryRecords, deleteRecord, DatastoreError } from '$lib/datastore';

export const MONITORS_COLLECTION = 'monitors';
const ACTOR = 'jkai';
const DEFAULT_CRON = '0 */6 * * *'; // every 6 hours when the description gives no cadence

export interface MonitorMarker {
  workflowId: string;
  slug: string;
  description: string;
  cron: string;
  createdAt: string;
  /** ISO timestamp until which the monitor is snoozed (schedule disabled).
   *  listMonitors lazily re-enables once past. Absent/null = not snoozed. */
  snoozeUntil?: string | null;
}

export interface MonitorHit {
  at: string;
  newCount: number;
  preview: string;
}

export interface MonitorStatus extends MonitorMarker {
  enabled: boolean;
  scheduleId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  hits: MonitorHit[];
  url: string;
}

/**
 * Recent "hits" a monitor surfaced — runs where a dedupe node reported new items
 * (`outputData.newCount > 0`). This is the "what did it find" view. Best-effort.
 */
export async function getMonitorHits(workflowId: string, limit = 4): Promise<MonitorHit[]> {
  const runs = await db
    .select({ id: workflowRuns.id, startedAt: workflowRuns.startedAt })
    .from(workflowRuns)
    .where(eq(workflowRuns.workflowId, workflowId))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(30);
  if (!runs.length) return [];
  const runAt = new Map(runs.map((r) => [r.id, r.startedAt?.toISOString() ?? '']));
  const execs = await db
    .select({ runId: nodeExecutions.runId, outputData: nodeExecutions.outputData })
    .from(nodeExecutions)
    .where(inArray(nodeExecutions.runId, runs.map((r) => r.id)));
  const hits: MonitorHit[] = [];
  for (const ex of execs) {
    const out = ex.outputData as { newCount?: number; items?: unknown[]; newItems?: unknown[] } | null;
    const newCount = out && typeof out.newCount === 'number' ? out.newCount : 0;
    if (newCount > 0) {
      const items = Array.isArray(out?.newItems) ? out!.newItems : Array.isArray(out?.items) ? out!.items : [];
      const preview = items
        .slice(0, 3)
        .map((i) => (typeof i === 'string' ? i : JSON.stringify(i)))
        .join(' · ')
        .slice(0, 300);
      hits.push({ at: runAt.get(ex.runId) ?? '', newCount, preview });
    }
  }
  return hits.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

const PERMS = { read: ['owner', 'jkai', 'system'], write: ['owner', 'jkai', 'system'], delete: ['owner', 'system'] };

export async function ensureMonitorsCollection(): Promise<void> {
  await ensureCollection(
    MONITORS_COLLECTION,
    { name: 'Monitors', description: 'Natural-language monitors (scheduled watch workflows)', isSystem: true, defaultPermissions: PERMS },
    ACTOR,
  );
}

function baseUrl(): string {
  return (process.env.PUBLIC_SITE_URL || 'https://strangeramblings.com').replace(/\/+$/, '');
}

/**
 * Build a monitor from a natural-language description: generate the workflow,
 * persist it as a new canvas, attach a cron schedule, and record a marker.
 * `onProgress` surfaces the generator's planning steps. Returns the marker.
 */
export async function createMonitor(
  description: string,
  cron: string | undefined,
  onProgress?: (text: string) => void,
): Promise<MonitorMarker> {
  const desc = (description ?? '').trim();
  if (!desc) throw new Error('description is required');

  const { generateWorkflow } = await import('$lib/workflows/orchestrator');
  const emit = onProgress ?? (() => {});

  // Nudge the generator toward the monitor shape (recurring check → notify).
  const prompt =
    `Build a recurring MONITOR workflow that runs on a schedule and notifies me when something of interest is found. ` +
    `It should: fetch/check the relevant source, keep only genuinely new items (use a dedupe step), and send me a WhatsApp message only when there is something new. ` +
    `Monitor request: ${desc}`;

  const result = await generateWorkflow(prompt, null, (t) => emit(t.trimEnd()));
  if (result.followUp) throw new Error(`The monitor needs clarification: ${result.followUp}`);
  const workflow = result.workflow;
  if (!workflow || workflow.nodes.length === 0) {
    throw new Error('Could not generate a monitor workflow from that description — try being more specific about what to watch and when.');
  }

  const { allocateCanvasName } = await import('$lib/canvas/adapter.server');
  const { name: canvasName, slug } = await allocateCanvasName(workflow.name || `monitor: ${desc.slice(0, 40)}`);

  // Prefer an explicit cron; else the generator's cron trigger; else the default.
  const genCron =
    workflow.trigger?.type === 'cron'
      ? (workflow.trigger.config?.expression as string | undefined) ?? (workflow.trigger.config?.cron as string | undefined)
      : undefined;
  let effectiveCron = (cron ?? genCron ?? DEFAULT_CRON).trim();
  // Validate BEFORE persisting — an invalid expression would make `new Cron()`
  // throw at registration time: the monitor would report as created but never
  // fire, and the poison row would break scheduler boot for later schedules.
  try {
    const { Cron } = await import('croner');
    new Cron(effectiveCron, { paused: true }).stop();
  } catch {
    if (cron) throw new Error(`"${cron}" is not a valid cron expression (e.g. "0 8 * * *" = daily at 8am).`);
    // A generator-produced bad cron falls back to the safe default.
    console.warn(`[monitors] generated cron "${effectiveCron}" invalid — using default ${DEFAULT_CRON}`);
    effectiveCron = DEFAULT_CRON;
  }

  const workflowId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(workflows)
      .values({
        name: canvasName,
        description: workflow.description || desc,
        trigger: { type: 'cron', config: { expression: effectiveCron } },
      })
      .returning();
    await tx.insert(workflowNodes).values(
      workflow.nodes.map((n) => ({ id: n.id, workflowId: row.id, type: n.type, position: n.position, config: n.config, label: n.label })),
    );
    if (workflow.edges.length > 0) {
      await tx.insert(workflowEdges).values(
        workflow.edges.map((e) => ({ id: e.id, workflowId: row.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null })),
      );
    }
    return row.id;
  });

  // Attach + register the cron schedule (the generate path skips the schedule row).
  const [schedule] = await db
    .insert(workflowSchedules)
    .values({ workflowId, type: 'cron', config: { expression: effectiveCron } })
    .returning();
  try {
    const { reloadSchedule } = await import('$lib/workflows/scheduler');
    await reloadSchedule(schedule.id);
  } catch (err) {
    console.error('[monitors] reloadSchedule failed:', err instanceof Error ? err.message : err);
  }

  const marker: MonitorMarker = { workflowId, slug, description: desc, cron: effectiveCron, createdAt: new Date().toISOString() };
  await ensureMonitorsCollection();
  await upsertRecord(MONITORS_COLLECTION, { key: workflowId, data: marker as unknown as Record<string, unknown> }, ACTOR);
  return marker;
}

/** List monitors joined with their schedule state + latest run status.
 *  Lazily re-enables any snoozed monitor whose snoozeUntil has passed.
 *  Batched: schedules in one query, per-monitor run/hit lookups in parallel
 *  (was a ~4N sequential round-trip N+1). */
export async function listMonitors(): Promise<MonitorStatus[]> {
  await ensureMonitorsCollection();
  const { records } = await queryRecords(MONITORS_COLLECTION, { sort: { field: 'createdAt', dir: 'desc' }, limit: 200 }, ACTOR);
  const markers = records.map((r) => r.data as unknown as MonitorMarker);

  // Snooze expiry: re-enable + clear markers whose snooze has lapsed. Best-effort.
  for (const m of markers) {
    if (m.snoozeUntil && new Date(m.snoozeUntil).getTime() <= Date.now()) {
      try {
        await setMonitorEnabled(m.workflowId, true);
        m.snoozeUntil = null;
        await upsertRecord(MONITORS_COLLECTION, { key: m.workflowId, data: m as unknown as Record<string, unknown> }, ACTOR);
      } catch (err) {
        console.error('[monitors] snooze re-enable failed:', err instanceof Error ? err.message : err);
      }
    }
  }

  const ids = markers.map((m) => m.workflowId);
  const scheds = ids.length
    ? await db.select().from(workflowSchedules).where(inArray(workflowSchedules.workflowId, ids))
    : [];
  const schedByWf = new Map(scheds.map((s) => [s.workflowId, s]));

  return Promise.all(
    markers.map(async (m) => {
      const sched = schedByWf.get(m.workflowId);
      const [[lastRun], hits] = await Promise.all([
        db
          .select({ status: workflowRuns.status })
          .from(workflowRuns)
          .where(eq(workflowRuns.workflowId, m.workflowId))
          .orderBy(desc(workflowRuns.startedAt))
          .limit(1),
        getMonitorHits(m.workflowId),
      ]);
      return {
        ...m,
        enabled: sched?.enabled ?? false,
        scheduleId: sched?.id ?? null,
        lastRunAt: sched?.lastRunAt ? sched.lastRunAt.toISOString() : null,
        nextRunAt: sched?.nextRunAt ? sched.nextRunAt.toISOString() : null,
        lastStatus: lastRun?.status ?? null,
        hits,
        url: `${baseUrl()}/jkai/canvas/${m.slug}`,
      };
    }),
  );
}

export async function setMonitorEnabled(workflowId: string, enabled: boolean): Promise<{ ok: boolean }> {
  const [sched] = await db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, workflowId)).limit(1);
  if (!sched) return { ok: false };
  await db.update(workflowSchedules).set({ enabled }).where(eq(workflowSchedules.id, sched.id));
  try {
    const { reloadSchedule } = await import('$lib/workflows/scheduler');
    await reloadSchedule(sched.id);
  } catch (err) {
    console.error('[monitors] reloadSchedule failed:', err instanceof Error ? err.message : err);
  }
  return { ok: true };
}

/**
 * Snooze a monitor for N hours: disable its schedule and stamp snoozeUntil on
 * the marker. Re-enabling is LAZY — checked on listMonitors (the /jkai/monitors
 * page load). Passing hours <= 0 clears the snooze and re-enables now.
 */
export async function snoozeMonitor(workflowId: string, hours: number): Promise<{ ok: boolean; snoozeUntil: string | null }> {
  await ensureMonitorsCollection();
  let marker: MonitorMarker;
  try {
    const { getRecordByKey } = await import('$lib/datastore/records');
    const record = await getRecordByKey(MONITORS_COLLECTION, workflowId, ACTOR);
    marker = record.data as unknown as MonitorMarker;
  } catch {
    return { ok: false, snoozeUntil: null };
  }
  if (hours <= 0) {
    marker.snoozeUntil = null;
    await upsertRecord(MONITORS_COLLECTION, { key: workflowId, data: marker as unknown as Record<string, unknown> }, ACTOR);
    await setMonitorEnabled(workflowId, true);
    return { ok: true, snoozeUntil: null };
  }
  const until = new Date(Date.now() + hours * 3600_000).toISOString();
  marker.snoozeUntil = until;
  await upsertRecord(MONITORS_COLLECTION, { key: workflowId, data: marker as unknown as Record<string, unknown> }, ACTOR);
  await setMonitorEnabled(workflowId, false);
  return { ok: true, snoozeUntil: until };
}

/** Remove the monitor marker + disable its schedule (the workflow itself is kept). */
export async function deleteMonitor(workflowId: string): Promise<{ deleted: boolean }> {
  await setMonitorEnabled(workflowId, false);
  try {
    await deleteRecord(MONITORS_COLLECTION, { key: workflowId }, ACTOR);
    return { deleted: true };
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return { deleted: false };
    throw err;
  }
}
