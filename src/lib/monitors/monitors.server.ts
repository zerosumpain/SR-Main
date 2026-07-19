// Natural-language Monitors — "watch X, tell me when Y". createMonitor turns a
// description into a SCHEDULED workflow (via the existing generator), attaches a
// cron schedule (the generate path does not create the schedule row itself), and
// records a marker in the `monitors` datastore collection so the /jkai/monitors
// page can list + manage them. SERVER ONLY (generator + DB + scheduler).
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowSchedules, workflowRuns } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
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
}

export interface MonitorStatus extends MonitorMarker {
  enabled: boolean;
  scheduleId: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  url: string;
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
  const effectiveCron = (cron ?? genCron ?? DEFAULT_CRON).trim();

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

/** List monitors joined with their schedule state + latest run status. */
export async function listMonitors(): Promise<MonitorStatus[]> {
  await ensureMonitorsCollection();
  const { records } = await queryRecords(MONITORS_COLLECTION, { sort: { field: 'createdAt', dir: 'desc' }, limit: 200 }, ACTOR);
  const out: MonitorStatus[] = [];
  for (const r of records) {
    const m = r.data as unknown as MonitorMarker;
    const [sched] = await db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, m.workflowId)).limit(1);
    const [lastRun] = await db
      .select({ status: workflowRuns.status })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, m.workflowId))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(1);
    out.push({
      ...m,
      enabled: sched?.enabled ?? false,
      scheduleId: sched?.id ?? null,
      lastRunAt: sched?.lastRunAt ? sched.lastRunAt.toISOString() : null,
      nextRunAt: sched?.nextRunAt ? sched.nextRunAt.toISOString() : null,
      lastStatus: lastRun?.status ?? null,
      url: `${baseUrl()}/jkai/canvas/${m.slug}`,
    });
  }
  return out;
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
