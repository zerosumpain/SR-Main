import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workflowInteractions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveInteraction } from '$lib/workflows/engine-resume';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();
  const runId = params.id!;
  const nodeId = params.nodeId!;

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const formValues = (body.formValues ?? {}) as Record<string, unknown>;
  const resolvedBy =
    ((session?.user as Record<string, unknown> | undefined)?.email as string | null) ?? null;

  // Resolve through the shared engine helper (same path the WhatsApp approval
  // handler uses). It flips resolvedAt, emits the SSE event, and — only when the
  // run is awaiting_human — calls resumeRun. A stealth-scrape CAPTCHA
  // interaction leaves the run `running`; its executor polls resolvedAt itself.
  const result = await resolveInteraction({ runId, nodeId, formValues, resolvedBy });

  if (!result.resolved) {
    if (result.reason === 'cancelled') {
      return json({ error: 'interaction was cancelled' }, { status: 410 });
    }
    return json({ error: 'no pending interaction' }, { status: 404 });
  }

  return json({ ok: true });
};

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.id!;
  const nodeId = params.nodeId!;

  const [row] = await db
    .select()
    .from(workflowInteractions)
    .where(
      and(
        eq(workflowInteractions.runId, runId),
        eq(workflowInteractions.nodeId, nodeId),
      ),
    );

  if (!row) return json({ error: 'not found' }, { status: 404 });
  return json(row);
};
