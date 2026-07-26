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
import { researchSessions } from '$lib/db/schema';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';

export type CommissionKind = 'research' | 'ask' | 'monitor' | 'workflow' | 'canvas' | 'briefing' | 'review';

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
          seedContext: context ? { fromIntel: true, context } : null,
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

      return json({
        kind,
        id: session.id,
        url: `/deepdive/${session.id}`,
        label: 'Deep dive started',
        started: true,
      } satisfies CommissionResult);
    }

    case 'monitor': {
      const res = await fetch('/api/jkai/monitors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: payload }),
      });
      if (!res.ok) throw error(502, 'monitor creation failed');
      const created = (await res.json()) as { monitor?: { workflowId?: string } };
      return json({
        kind,
        id: created.monitor?.workflowId,
        url: '/jkai/monitors',
        label: 'Monitor created',
        started: true,
      } satisfies CommissionResult);
    }

    case 'ask':
    case 'briefing': {
      // Interactive by nature — hand the user a prefilled composer.
      const prompt = context ? `${payload}\n\n${context}` : payload;
      return json({
        kind,
        url: `/jkai?ask=${encodeURIComponent(prompt)}`,
        label: kind === 'briefing' ? 'Briefing prompt ready' : 'Ask jkai',
        started: false,
      } satisfies CommissionResult);
    }

    case 'workflow':
    case 'canvas': {
      return json({
        kind,
        url: `/jkai/canvas?prompt=${encodeURIComponent(payload)}`,
        label: 'Open canvas',
        started: false,
      } satisfies CommissionResult);
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
