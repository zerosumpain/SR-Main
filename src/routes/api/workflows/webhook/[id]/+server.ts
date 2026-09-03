import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowRuns } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from '$lib/workflows';
import {
  isWebhookSignatureAuthorized,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type TriggerLike,
} from '$lib/workflows/webhook-secret';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';
import { readLimitedText } from '$lib/server/service-auth';
import { isOwnerEmail } from '$lib/server/access';

const seenSignatures = new Map<string, number>();

function acceptOnce(signature: string, now = Date.now()): boolean {
  for (const [key, expires] of seenSignatures) if (expires <= now) seenSignatures.delete(key);
  if (seenSignatures.has(signature)) return false;
  seenSignatures.set(signature, now + 5 * 60_000);
  return true;
}

export const POST: RequestHandler = async (event) => {
  const { params, request, locals } = event;
  assertPublicRequestBudget(event, {
    scope: `workflow-webhook:${params.id}`,
    perClient: { capacity: 20, refillPerSecond: 20 / 60 },
    global: { capacity: 120, refillPerSecond: 120 / 60 },
  });
  const [workflow] = await db.select().from(workflows).where(eq(workflows.id, params.id));
  if (!workflow) {
    return json({ error: 'Workflow not found' }, { status: 404 });
  }

  // Check trigger type is webhook
  const trigger = workflow.trigger as TriggerLike | null;
  if (trigger?.type !== 'webhook') {
    return json({ error: 'Workflow does not accept webhook triggers' }, { status: 400 });
  }

  const rawBody = await readLimitedText(request, 64 * 1024);
  let owner = false;
  try {
    owner = isOwnerEmail((await locals.auth())?.user?.email);
  } catch {
    owner = false;
  }
  const signature = request.headers.get(WEBHOOK_SIGNATURE_HEADER);
  if (!owner && !isWebhookSignatureAuthorized(
    trigger,
    request.headers.get(WEBHOOK_TIMESTAMP_HEADER),
    signature,
    rawBody,
  )) {
    return json({ error: 'Invalid, missing, or expired webhook signature' }, { status: 401 });
  }
  if (!owner && signature && !acceptOnce(signature)) {
    return json({ error: 'Webhook signature already used' }, { status: 409 });
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = rawBody ? JSON.parse(rawBody) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json({ error: 'Webhook body must be a JSON object' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  const nodes = await db.select().from(workflowNodes).where(eq(workflowNodes.workflowId, params.id));
  const edges = await db.select().from(workflowEdges).where(eq(workflowEdges.workflowId, params.id));

  const [run] = await db.insert(workflowRuns).values({
    workflowId: params.id,
    status: 'running',
    trigger: 'webhook',
    startedAt: new Date(),
    // Persist the webhook payload so the enqueue path (worker mode) can replay
    // it; the in-process path below passes `body` directly and ignores this.
    inputData: body,
  }).returning();

  const definition: WorkflowDefinition = {
    id: workflow.id,
    name: workflow.name,
    nodes: nodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position as { x: number; y: number },
      config: (n.config || {}) as Record<string, unknown>,
      label: n.label,
    })),
    edges: edges.map(e => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  };

  // #19 DISPATCH SWITCH (ADDITIVE, FEATURE-FLAGGED): in worker mode, enqueue the
  // run (payload already persisted to input_data above) for the out-of-process
  // worker and return. When the flag is OFF this is skipped and execution runs
  // in-process below, byte-for-byte as before.
  if (process.env.JKAI_RUN_WORKER === '1') {
    const { enqueue } = await import('$lib/workflows/run-queue');
    await enqueue(run.id);
    return json({ runId: run.id, status: 'accepted' }, { status: 202 });
  }

  // Execute in background
  engine.execute(definition, run.id, body, undefined, params.id).then(async (result) => {
    await db.update(workflowRuns).set({
      status: result.status,
      completedAt: new Date(),
      error: result.error || null,
    }).where(eq(workflowRuns.id, run.id));
  });

  return json({ runId: run.id, status: 'accepted' }, { status: 202 });
};
