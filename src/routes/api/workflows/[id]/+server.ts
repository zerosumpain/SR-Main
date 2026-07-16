import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, type WorkflowNotifications } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { recordAudit, recordAuditBatch } from '$lib/canvas/audit';
import { diffWorkflowPatch } from '$lib/canvas/audit-diff';

/** Normalise an arbitrary body value into a stored WorkflowNotifications config,
 *  or `null` to clear it. Only known fields are kept; unknown keys are dropped. */
function normaliseNotifications(raw: unknown): WorkflowNotifications | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: WorkflowNotifications = {};
  if (typeof r.onFailure === 'boolean') out.onFailure = r.onFailure;
  if (typeof r.onCompletion === 'boolean') out.onCompletion = r.onCompletion;
  if (typeof r.approvals === 'boolean') out.approvals = r.approvals;
  if (r.channel === 'whatsapp') out.channel = 'whatsapp';
  if (typeof r.digestField === 'string' && r.digestField.trim()) {
    out.digestField = r.digestField.trim().slice(0, 200);
  }
  // Nothing meaningful set → store null so the default-silent path holds.
  if (out.onFailure !== true && out.onCompletion !== true && out.approvals !== true) return null;
  return out;
}

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

/**
 * PATCH /api/workflows/:id — partial workflow-level metadata updates.
 * Currently accepts `{ notifications }` (D1 run-outcome notifications). Additive:
 * only fields present in the body are touched; the rest of the row is untouched.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));

  const [existing] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!existing) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if ('notifications' in body) {
    patch.notifications = normaliseNotifications(body.notifications);
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No supported fields to update' }, { status: 400 });
  }

  patch.updatedAt = new Date();
  await db.update(workflows).set(patch).where(eq(workflows.id, params.id));

  if ('notifications' in patch) {
    await recordAudit({
      workflowId: params.id,
      entity: 'workflow',
      entityId: params.id,
      action: 'update',
      details: {
        field: 'notifications',
        old: (existing.notifications as WorkflowNotifications | null) ?? null,
        new: patch.notifications ?? null,
      },
    }).catch(() => {});
  }

  return json({ success: true, notifications: patch.notifications ?? null });
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(workflows).where(eq(workflows.id, params.id));
  return json({ success: true });
};
