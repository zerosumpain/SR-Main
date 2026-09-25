import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import {
  isWebhookSignatureAuthorized,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type TriggerLike,
} from '$lib/workflows/webhook-secret';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';
import { readLimitedText } from '$lib/server/service-auth';
import { isOwnerEmail } from '$lib/server/access';
import { startRun } from '$lib/workflows/start-run';

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

  // The run kernel records pausedAtNodeId (so a webhook run that hits an
  // approval can resume), node rows and workflow_completed; in worker mode it
  // enqueues with the payload persisted for replay.
  const started = await startRun({ workflowId: params.id, trigger: 'webhook', input: body, label: 'webhook' });
  if (!started) return json({ error: 'Workflow not found' }, { status: 404 });
  return json({ runId: started.runId, status: 'accepted' }, { status: 202 });
};
