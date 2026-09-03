import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { workflowInteractions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { listInteractiveSessions } from '$lib/workflows/scraper/interactive';
import { env } from '$env/dynamic/private';
import {
  issueVncAccessTicket,
  VNC_ACCESS_COOKIE,
  VNC_ACCESS_TTL_SECONDS,
} from '$lib/server/vnc-ticket';

export const GET: RequestHandler = async ({ params, cookies }) => {
  const runId = params.id!;
  const rows = await db
    .select()
    .from(workflowInteractions)
    .where(eq(workflowInteractions.runId, runId));

  const sessions = new Map(listInteractiveSessions().map((s) => [s.id, s]));

  const enriched = rows.map((r) => {
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
    });

  // Caddy protects vnc.strangeramblings.com by forwarding each request to
  // /api/auth/session-check. Auth.js is intentionally host-only, so issue a
  // separate 15-minute, VNC-only credential when the authenticated owner has a
  // live interaction. It cannot be used as an application session.
  if (enriched.some((row) => !row.resolvedAt && !row.cancelled && (row.wsPort || row.vncUrl))) {
    const ticket = issueVncAccessTicket(env.AUTH_SECRET!);
    cookies.set(VNC_ACCESS_COOKIE, ticket, {
      httpOnly: true,
      secure: import.meta.env.PROD,
      sameSite: 'lax',
      path: '/',
      maxAge: VNC_ACCESS_TTL_SECONDS,
      ...(import.meta.env.PROD ? { domain: '.strangeramblings.com' } : {}),
    });
  }

  return json(enriched);
};
