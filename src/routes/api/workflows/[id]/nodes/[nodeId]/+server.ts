import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowNodes, workflowEdges } from '$lib/db/schema';
import { and, eq, or } from 'drizzle-orm';
import { recordAudit } from '$lib/canvas/audit';
import {
  mutateNodeConfig,
  NodeNotFoundError,
  SensitiveRefusalError,
  VersionConflictError,
} from '$lib/canvas/mutate.server';
import { registry } from '$lib/workflows';
import { resolveUpstreamSchema, schemaToVariablePaths } from '$lib/workflows/schema-propagation';

/**
 * Declared upstream field paths for this node — derived from each upstream
 * node's executor.getOutputSchema(config), NOT from run data. Lets the config
 * panel's `{{` field picker show available fields BEFORE the node has ever run
 * (the canvas merges these with computeUpstreamFields' run-data paths). Closes
 * the chicken-and-egg gap where pickers were empty on a fresh canvas.
 */
export const GET: RequestHandler = async ({ params }) => {
  const [nodes, edges] = await Promise.all([
    db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id)),
    db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id)),
  ]);

  const getOutputSchema = (type: string, config: Record<string, unknown>) => {
    try {
      const exec = registry.getExecutor(type);
      return exec ? exec.getOutputSchema(config ?? {}) : { type: 'object' as const };
    } catch {
      return { type: 'object' as const };
    }
  };

  try {
    const schema = resolveUpstreamSchema(
      params.nodeId,
      nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: (n.config as Record<string, unknown>) ?? {},
        position: (n.position as { x: number; y: number }) ?? { x: 0, y: 0 },
        label: n.label,
      })),
      edges.map((e) => ({ id: e.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId })),
      getOutputSchema,
    );
    const paths = schemaToVariablePaths(schema).map((v) => v.path);
    return json({ paths });
  } catch {
    return json({ paths: [] });
  }
};

/**
 * The read-modify-write, the version check and the redacted audit entry all
 * live in `mutateNodeConfig` now, so the nightly workflow doctor and this route
 * cannot diverge on any of them. Status codes and body shapes are unchanged.
 *
 * One nuance: `config` is now MERGED over the stored value rather than
 * replacing it, because that is what the doctor needs and there must be one
 * door. Every in-tree client already sends `{ ...node.config, ...changes }`, so
 * the result is identical for them — and a partial body no longer silently
 * wipes the keys it omitted.
 */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));

  const wantsConfig = body.config !== undefined;
  const wantsLabel = typeof body.label === 'string';
  const wantsPosition = body.position && typeof body.position === 'object';
  if (!wantsConfig && !wantsLabel && !wantsPosition) {
    return json({ error: 'No updatable fields provided' }, { status: 400 });
  }
  if (wantsConfig && (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config))) {
    return json({ error: 'config must be an object' }, { status: 400 });
  }

  try {
    const result = await mutateNodeConfig({
      workflowId: params.id,
      nodeId: params.nodeId,
      patch: wantsConfig ? (body.config as Record<string, unknown>) : undefined,
      label: wantsLabel ? (body.label as string) : undefined,
      position: wantsPosition ? (body.position as { x: number; y: number }) : undefined,
      expectedVersion:
        typeof body.expectedVersion === 'number' ? body.expectedVersion : undefined,
      actor: 'owner',
      reason: 'canvas edit',
    });
    return json({ node: result.node });
  } catch (err) {
    if (err instanceof VersionConflictError) {
      return json({ error: 'conflict', currentVersion: err.currentVersion }, { status: 409 });
    }
    if (err instanceof SensitiveRefusalError) {
      // 422, not 409: nothing the client can retry. Patching a node that holds
      // a credential republishes it through workflow_audit_log.details, so the
      // node has to be deleted and recreated with the value in the secret
      // registry instead. Field names only — the response is a log surface too.
      return json(
        {
          error:
            `This node holds a credential in: ${err.fields.join(', ')}. ` +
            'Editing it would republish the value through the workflow audit log. ' +
            'Delete the node and recreate it, keeping the secret in /admin/ai/apis.',
          sensitiveFields: err.fields,
        },
        { status: 422 },
      );
    }
    if (err instanceof NodeNotFoundError) {
      return json({ error: 'Node not found' }, { status: 404 });
    }
    throw err;
  }
};

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

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const action = body.action as string | undefined;

  const [src] = await db
    .select()
    .from(workflowNodes)
    .where(and(eq(workflowNodes.id, params.nodeId), eq(workflowNodes.workflowId, params.id)));
  if (!src) return json({ error: 'Node not found' }, { status: 404 });

  if (action === 'detach') {
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
    return json({ detached: params.nodeId });
  }

  if (action === 'branch') {
    const pos = (src.position as { x?: number; y?: number }) || { x: 0, y: 0 };
    const [cloned] = await db
      .insert(workflowNodes)
      .values({
        workflowId: params.id,
        type: src.type,
        label: `${src.label} (branch)`,
        position: { x: (pos.x ?? 0) + 24, y: (pos.y ?? 0) + 120 },
        config: src.config,
      })
      .returning();
    return json({ node: cloned });
  }

  return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
