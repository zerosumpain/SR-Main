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
    rows.map((r) => {
      // Local session lookup works when the session lives on THIS host
      // (homeserv canvas → homeserv VNC). When the VPS canvas proxies to
      // homeserv for the VNC session, listInteractiveSessions() on the VPS
      // is empty — fall back to the wsPort/vncUrl values stashed in
      // configSnapshot at interaction-creation time by the stealth-scrape
      // executor.
      const session = r.vncSessionId ? sessions.get(r.vncSessionId) : null;
      const snap = (r.configSnapshot ?? {}) as Record<string, unknown>;
      const wsPort =
        session?.wsPort ??
        (typeof snap.wsPort === 'number' ? (snap.wsPort as number) : null);
      const vncUrl =
        session?.vncUrl ??
        (typeof snap.vncUrl === 'string' ? (snap.vncUrl as string) : null);
      return { ...r, wsPort, vncUrl };
    }),
  );
};
