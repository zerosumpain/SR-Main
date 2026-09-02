import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ToolTrace } from '$lib/jkai/tool-trace';
import { loadTraceRow } from '$lib/jkai/tool-trace.server';

// One turn's recorded tool-call chain, as JSON. Owner-gated by hooks, like the
// rest of /api/jkai.
//
// The trace page renders the same row through its own loader; this exists for
// the thread inspector, which wants ONE step's arguments and result inline
// without sending the user to another page. Fetched on demand rather than
// published through the hub bus: a `web_extract` result can be the better part
// of a page of text, and pushing that into shared client state on every token
// of every turn to serve a click that usually never comes is the wrong trade.
export const GET: RequestHandler = async ({ params }) => {
  const row = await loadTraceRow(params.traceId);
  if (!row) return json({ error: 'No tool trace for that turn' }, { status: 404 });

  const trace = row.steps as ToolTrace;
  return json({
    id: row.id,
    messageId: row.messageId,
    conversationId: row.conversationId,
    prompt: row.prompt,
    createdAt: row.createdAt,
    trace,
  });
};
