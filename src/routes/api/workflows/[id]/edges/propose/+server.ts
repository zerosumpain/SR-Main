import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { proposeEdgeMapping } from '$lib/workflows/mapping/propose.server';

/**
 * Propose an auto-mapping for a freshly-connected edge A→B: how A's output
 * should flow into B, as user-approvable config actions (LLM-assisted, with a
 * deterministic fallback). Owner-gated by hooks like the sibling workflow routes.
 * A slow/failed proposal never blocks the connection — the client fires this
 * after the edge is already persisted and ignores failures.
 */
export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => ({}));
  const sourceNodeId = body.sourceNodeId as string | undefined;
  const targetNodeId = body.targetNodeId as string | undefined;
  if (!sourceNodeId || !targetNodeId) {
    return json({ error: 'sourceNodeId and targetNodeId required' }, { status: 400 });
  }
  if (sourceNodeId === targetNodeId) {
    return json({ error: 'A node cannot map to itself' }, { status: 400 });
  }

  // Bound the LLM call so a slow model doesn't hang the request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const proposal = await proposeEdgeMapping({
      workflowId: params.id,
      sourceNodeId,
      targetNodeId,
      signal: controller.signal,
    });
    if (!proposal) return json({ error: 'nodes not found in workflow' }, { status: 404 });
    return json({ proposal });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'proposal failed' }, { status: 500 });
  } finally {
    clearTimeout(timer);
  }
};
