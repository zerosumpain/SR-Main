/**
 * Per-build event log endpoint.
 *
 * POST /api/jkai/builds/[id]/events
 *   Body: any JSON object — must include a non-empty `type` string.
 *   Persists one row to `jkai_build_events` with the full body in
 *   `payload` and a server-side `createdAt` timestamp. Returns the
 *   inserted row id.
 *
 * GET /api/jkai/builds/[id]/events?since=<iso>&limit=<n>
 *   Returns most-recent events (default 200, max 1000), optionally
 *   filtered by `since` (timestamp) or `type`.
 *
 * Auth: protected by the standard /api auth gate in hooks.server.ts.
 * Apps emit from same-origin proxy iframes, so the user's session
 * cookie flows automatically — no public-write surface.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiBuildEvents } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';

const MAX_PAYLOAD_BYTES = 64 * 1024;

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id;
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) return json({ error: 'build not found' }, { status: 404 });

  const raw = await request.text();
  if (raw.length > MAX_PAYLOAD_BYTES) {
    return json({ error: `payload too large (max ${MAX_PAYLOAD_BYTES} bytes)` }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'body must be JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'body must be a JSON object' }, { status: 400 });
  }
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!type) return json({ error: 'body.type is required (non-empty string)' }, { status: 400 });

  const [row] = await db.insert(jkaiBuildEvents).values({
    buildId,
    type,
    payload: body as Record<string, unknown>,
  }).returning();

  return json({ ok: true, id: row.id, createdAt: row.createdAt }, { status: 201 });
};

export const GET: RequestHandler = async ({ params, url }) => {
  const buildId = params.id;
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) return json({ error: 'build not found' }, { status: 404 });

  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 200));
  const sinceParam = url.searchParams.get('since');
  const typeFilter = url.searchParams.get('type');

  const conds = [eq(jkaiBuildEvents.buildId, buildId)];
  if (sinceParam) {
    const since = new Date(sinceParam);
    if (!Number.isNaN(since.getTime())) conds.push(gte(jkaiBuildEvents.createdAt, since));
  }
  if (typeFilter) conds.push(eq(jkaiBuildEvents.type, typeFilter));

  const rows = await db
    .select()
    .from(jkaiBuildEvents)
    .where(and(...conds))
    .orderBy(desc(jkaiBuildEvents.createdAt))
    .limit(limit);

  return json({ events: rows, count: rows.length });
};
