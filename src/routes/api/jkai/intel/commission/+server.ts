// Commissioning — turning something the graph noticed into work that happens.
//
// The point of the Intel dashboard is that a finding never dead-ends. Every
// insight, entity and unlikely relation carries an action, and this endpoint is
// where that action is actually executed: start a deep dive, create a monitor,
// open a canvas, ask jkai. One place, so the UI does not need to know the shape
// of five different subsystems' APIs.
//
// Work that CAN be started server-side is (research, monitors, workflows) and
// the caller gets back a URL to watch it. Work that is inherently interactive
// (asking jkai, opening a canvas) returns a deep link instead.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, intelCommissions } from '$lib/db/schema';
import { desc, inArray } from 'drizzle-orm';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';

export type CommissionKind =
  | 'research'
  | 'ask'
  | 'monitor'
  | 'workflow'
  | 'canvas'
  | 'briefing'
  | 'review'
  | 'confirm_link'
  | 'reject_link';

export interface CommissionResult {
  kind: CommissionKind;
  /** Where the user should go to see the result. */
  url: string;
  /** Set when something was actually created. */
  id?: string;
  label: string;
  started: boolean;
}

/** Context lines about the entities involved, so commissioned work starts informed. */
async function entityContext(entityIds: string[]): Promise<string> {
  if (!entityIds.length) return '';
  const { index } = await getGraphAnalysis();
  const lines = entityIds
    .map((id) => index.byId.get(id))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => {
      const neighbours = [...(index.neighbours.get(n.id) ?? [])]
        .slice(0, 6)
        .map((nb) => index.byId.get(nb)?.name)
        .filter(Boolean);
      return (
        `- ${n.name} (${n.typeName})` +
        (n.summary ? `: ${n.summary}` : '') +
        (neighbours.length ? `\n  Connected to: ${neighbours.join(', ')}` : '')
      );
    });
  if (!lines.length) return '';
  return `What my intel graph already knows:\n${lines.join('\n')}`;
}

export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(body.kind ?? '') as CommissionKind;
  const payload = String(body.payload ?? '').trim();
  const entityIds = Array.isArray(body.entityIds) ? body.entityIds.map(String) : [];

  if (!kind) throw error(400, 'kind is required');
  if (!payload && kind !== 'review') throw error(400, 'payload is required');

  const context = await entityContext(entityIds);
  const insightId = typeof body.insightId === 'string' ? body.insightId : null;

  /**
   * Record what was commissioned. Without this a deep dive started from a
   * finding was orphaned the moment the user navigated away — no way to see
   * what is running, what it came from, or where its output landed. `review`
   * is excluded: it is a navigation link, not work.
   */
  const record = async (result: CommissionResult) => {
    if (kind === 'review') return result;
    try {
      await db.insert(intelCommissions).values({
        insightId,
        entityId: entityIds[0] ?? null,
        kind,
        payload: payload.slice(0, 4000),
        externalId: result.id ?? null,
        externalUrl: result.url,
        status: result.started ? 'running' : 'queued',
      });
    } catch (err) {
      // Bookkeeping must never cost the user the work they asked for.
      console.warn('[intel] could not record commission:', err instanceof Error ? err.message : err);
    }
    return result;
  };

  switch (kind) {
    case 'research': {
      // Seeded with what the graph already knows so the dive does not re-derive
      // the context that prompted it.
      const [session] = await db
        .insert(researchSessions)
        .values({
          topic: payload.slice(0, 2000),
          goals: [],
          config: {},
          // ALWAYS marked, context or not. Research no longer merges itself
          // into the graph when it finishes (see $lib/deepdive/graph-commit) —
          // and a commission is the graph asking to learn something, so this
          // flag is what tells the worker to commit this one on the way out.
          // Gated on `context` before, so a commission with nothing to seed it
          // carried no mark at all.
          seedContext: { fromIntel: true, ...(context ? { context } : {}) },
        })
        .returning({ id: researchSessions.id });

      // Kick the worker off without blocking the response — the same
      // fire-and-forget the /api/deepdive route uses.
      try {
        const { startResearch } = await import('$lib/deepdive/worker');
        void startResearch(session.id);
      } catch (err) {
        console.error('[intel:commission] could not start research:', err);
      }

      return json(
        await record({
          kind,
          id: session.id,
          url: `/deepdive/${session.id}`,
          label: 'Deep dive started',
          started: true,
        }),
      );
    }

    case 'monitor': {
      const res = await fetch('/api/jkai/monitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: payload }),
      });
      if (!res.ok) throw error(502, 'monitor creation failed');
      const created = (await res.json()) as { monitor?: { workflowId?: string } };
      return json(
        await record({
          kind,
          id: created.monitor?.workflowId,
          url: '/jkai/daydreams/watches',
          label: 'Monitor created',
          started: true,
        }),
      );
    }

    case 'ask':
    case 'briefing': {
      // Interactive by nature — hand the user a prefilled composer.
      //
      // `new=1` starts a FRESH conversation. Without it the prompt was pushed
      // into whatever thread happened to be open, so a question commissioned
      // from the graph arrived mid-way through an unrelated one and inherited
      // its context.
      const prompt = context ? `${payload}\n\n${context}` : payload;
      return json(
        await record({
          kind,
          url: `/jkai?new=1&ask=${encodeURIComponent(prompt)}`,
          label: kind === 'briefing' ? 'Briefing prompt ready' : 'Ask jkai',
          started: false,
        }),
      );
    }

    /**
     * Record a predicted link as a real relationship.
     *
     * This is what "Confirm the link" always claimed to do. It was declared
     * with `action: 'ask'`, so it fell into the branch above and deep-linked to
     * jkai with a prefilled question — the graph never learned anything from
     * the confirmation. The edge is written `manual`, which persistExtraction
     * treats as the user's and never overwrites.
     */
    case 'confirm_link': {
      if (entityIds.length < 2) throw error(400, 'confirm_link needs two entity ids');
      const [sourceEntityId, targetEntityId] = entityIds;
      if (sourceEntityId === targetEntityId) throw error(400, 'cannot link an entity to itself');

      const { confirmRelationship } = await import('$lib/jkai/intel/confirm-link');
      const outcome = await confirmRelationship({
        sourceEntityId,
        targetEntityId,
        label: payload || null,
      });

      return json(
        await record({
          kind,
          id: outcome.relationshipId,
          url: `/jkai/intel?focus=${encodeURIComponent(sourceEntityId)}`,
          label: outcome.created ? 'Link recorded' : 'Link already recorded',
          started: true,
        }),
      );
    }

    /**
     * The companion to confirming: say these two are NOT related.
     *
     * Suppression (not deletion) is what makes the answer stick — the columns
     * existed and nothing wrote them, so a rejected prediction came back on
     * every run and the same wrong pair had to be dismissed forever.
     */
    case 'reject_link': {
      if (entityIds.length < 2) throw error(400, 'reject_link needs two entity ids');
      const [sourceEntityId, targetEntityId] = entityIds;

      const { rejectRelationship } = await import('$lib/jkai/intel/confirm-link');
      const outcome = await rejectRelationship({
        sourceEntityId,
        targetEntityId,
        reason: payload || 'Rejected from the intel dashboard',
      });

      return json(
        await record({
          kind,
          url: '/jkai/intel',
          label: outcome.suppressed ? 'Marked as unrelated' : 'Already marked',
          started: true,
        }),
      );
    }

    case 'workflow':
    case 'canvas': {
      return json(
        await record({
          kind,
          url: `/jkai/canvas?prompt=${encodeURIComponent(payload)}`,
          label: 'Open canvas',
          started: false,
        }),
      );
    }

    case 'review': {
      // The payload IS the destination for review actions.
      return json({
        kind,
        url: payload || '/jkai/intel/review',
        label: 'Open review',
        started: false,
      } satisfies CommissionResult);
    }

    default:
      throw error(400, `unknown commission kind "${kind}"`);
  }
};

/**
 * What has been commissioned, newest first — the "what did I set running"
 * view. Research sessions are joined so a completed dive shows as complete
 * without a separate poller.
 */
export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 25), 1), 100);
  const rows = await db
    .select()
    .from(intelCommissions)
    .orderBy(desc(intelCommissions.createdAt))
    .limit(limit);

  // A research commission's real status lives on the research session; reading
  // it here keeps the list honest without a background job.
  const researchIds = rows
    .filter((r) => r.kind === 'research' && r.externalId)
    .map((r) => r.externalId as string);
  const sessions = researchIds.length
    ? await db
        .select({ id: researchSessions.id, status: researchSessions.status })
        .from(researchSessions)
        .where(inArray(researchSessions.id, researchIds))
    : [];
  const statusById = new Map(sessions.map((s) => [s.id, s.status]));

  return json({
    commissions: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: r.payload,
      url: r.externalUrl,
      entityId: r.entityId,
      insightId: r.insightId,
      status:
        r.kind === 'research' && r.externalId
          ? (statusById.get(r.externalId) ?? r.status)
          : r.status,
      createdAt: r.createdAt,
    })),
  });
};
