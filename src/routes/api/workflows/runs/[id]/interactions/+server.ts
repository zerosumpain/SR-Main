import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workflowInteractions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { listInteractiveSessions } from '$lib/workflows/scraper/interactive';

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.id!;
  const rows = await db
    .select()
    .from(workflowInteractions)
    .where(eq(workflowInteractions.runId, runId));

  const sessions = new Map(listInteractiveSessions().map((s) => [s.id, s]));

  return json(
    rows.map((r) => ({
      ...r,
      wsPort: r.vncSessionId ? (sessions.get(r.vncSessionId)?.wsPort ?? null) : null,
    })),
  );
};
