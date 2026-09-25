import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { workflows, workflowSchedules } from '$lib/db/schema';
import { withDevice } from '$lib/server/native-handler';
import { deleteCanvas } from '$lib/canvas/adapter.server';
import { recordAuditBatch } from '$lib/canvas/audit';
import { diffWorkflowPatch } from '$lib/canvas/audit-diff';
import { unregisterCronJob } from '$lib/workflows/scheduler';
import { findCanvas, loadWorkflowDetail, titleOf } from '$lib/workflows/native/workflows.server';

/**
 * GET    /api/native/workflows/:slug — the workflow as the phone draws it.
 * PATCH  { title } — rename. The title lives in `workflows.description`, which
 *        is where the canvas keeps it; there is no separate description, so
 *        `description` is not accepted (and always reads null).
 * DELETE — the canvas and everything cascaded to it, as the web's DELETE.
 */
export const GET: RequestHandler = withDevice(async ({ params }) => {
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });
  return loadWorkflowDetail(workflow);
});

export const PATCH: RequestHandler = withDevice(async ({ params, request }) => {
  let body: { title?: unknown };
  try {
    body = ((await request.json()) ?? {}) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  if (typeof body.title !== 'string' || !body.title.trim()) {
    return json({ error: 'Give it a name.', field: 'title' }, { status: 400 });
  }
  const title = body.title.trim().slice(0, 200);

  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  // Audited as the web's PUT audits a rename — same diff, same entity.
  const entries = diffWorkflowPatch(
    { name: workflow.name, description: workflow.description },
    { description: title },
  );
  await db.update(workflows).set({ description: title, updatedAt: new Date() }).where(eq(workflows.id, workflow.id));
  if (entries.length > 0) {
    await recordAuditBatch(
      entries.map((e) => ({
        workflowId: workflow.id,
        entity: 'workflow' as const,
        entityId: workflow.id,
        action: e.action,
        details: { ...e.details, actor: 'native' },
      })),
    );
  }
  return { slug: params.slug, title: titleOf({ name: workflow.name, description: title }) };
});

export const DELETE: RequestHandler = withDevice(async ({ params }) => {
  const workflow = await findCanvas(params.slug);
  if (!workflow) return json({ error: 'Workflow not found' }, { status: 404 });

  // The schedule rows cascade with the workflow, but a live Cron job is held in
  // memory by id and would keep firing at a workflow that no longer exists.
  const schedules = await db
    .select({ id: workflowSchedules.id })
    .from(workflowSchedules)
    .where(eq(workflowSchedules.workflowId, workflow.id));
  for (const s of schedules) unregisterCronJob(s.id);

  const ok = await deleteCanvas(params.slug);
  if (!ok) return json({ error: 'Workflow not found' }, { status: 404 });
  return { ok: true, deleted: params.slug };
});
