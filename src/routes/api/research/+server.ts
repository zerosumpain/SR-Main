/**
 * Unified research API.
 *
 * One endpoint creates a run at any depth. Before v3 the tier decided which
 * ENDPOINT you called (`/quickanswer` form action vs `POST /api/deepdive`),
 * which meant every caller — the launcher, two workflow nodes, the site tools —
 * carried its own branch on tier. Depth is now a parameter, not a route.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { desc, eq, inArray } from 'drizzle-orm';
import { coerceDepth, depthPreset } from '$lib/deepdive/depth';
import { coerceScope } from '$lib/deepdive/scope';
import { startResearch } from '$lib/deepdive/worker';
import { depthTimings } from '$lib/deepdive/timings';

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : '';
  if (!topic) return json({ error: 'A topic is required' }, { status: 400 });

  const depth = coerceDepth(body.depth);
  const preset = depthPreset(depth);
  const scope = coerceScope(body.scope);

  const goals = Array.isArray(body.goals)
    ? (body.goals as unknown[]).filter((g): g is string => typeof g === 'string' && !!g.trim())
    : [];

  // A caller may narrow the budget but never widen it past the tier's promise —
  // otherwise "brief" stops meaning "under two minutes".
  const requested = typeof body.budgetMs === 'number' && body.budgetMs > 0 ? body.budgetMs : null;
  const budgetMs =
    preset.budgetMs == null
      ? requested
      : requested
        ? Math.min(requested, preset.budgetMs)
        : preset.budgetMs;

  const [session] = await db
    .insert(researchSessions)
    .values({
      topic,
      goals,
      depth,
      scope,
      budgetMs,
      config: preset.config,
      plan: (body.plan as object | undefined) ?? null,
      status: 'draft',
      parentSessionId: typeof body.parentSessionId === 'string' ? body.parentSessionId : null,
      seedContext: (body.seedContext as object | undefined) ?? null,
    })
    .returning();

  startResearch(session.id);

  return json(session, { status: 201 });
};

/**
 * Recent runs across every tier, plus the measured p50 per depth.
 *
 * The launcher quotes those p50s instead of a promised duration: "how long will
 * this take" deserves an answer from this machine's own history rather than a
 * number someone typed into a blurb.
 */
export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50);

  const runs = await db
    .select({
      id: researchSessions.id,
      topic: researchSessions.topic,
      status: researchSessions.status,
      depth: researchSessions.depth,
      durationMs: researchSessions.durationMs,
      createdAt: researchSessions.createdAt,
      completedAt: researchSessions.completedAt,
    })
    .from(researchSessions)
    .orderBy(desc(researchSessions.createdAt))
    .limit(limit);

  return json({ runs, timings: await depthTimings() });
};

/** Bulk delete, used by the launcher's history list. */
export const DELETE: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((i): i is string => typeof i === 'string')
    : [];
  if (!ids.length) return json({ error: 'No ids given' }, { status: 400 });
  await db.delete(researchSessions).where(inArray(researchSessions.id, ids));
  return json({ deleted: ids.length });
};
