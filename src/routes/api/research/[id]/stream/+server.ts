/**
 * Unified research stream — every tier, one event shape.
 *
 * Two things this does that the old per-tier streams did not:
 *
 *  - **Replays state on connect.** The old stream attached an emitter listener
 *    and sent nothing else, so a client that connected a second after the run
 *    started — or reconnected after a dropped socket — saw an empty screen
 *    until the next event happened to fire. A run whose events all landed
 *    before the browser attached looked like a run that had died.
 *  - **Starts the work if nobody has.** A `draft` session with no worker is
 *    what a page load after a server restart looks like; opening the stream is
 *    the moment to notice.
 */
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { researchSessions, sources, facts, entities, relationships } from '$lib/db/schema';
import { eq, and, count } from 'drizzle-orm';
import { getEmitter, startResearch, isRunning } from '$lib/deepdive/worker';
import type { SSEEvent } from '$lib/deepdive/types';

const KEEPALIVE_MS = 15_000;

async function currentStats(sessionId: string) {
  const [[srcs], [fcts], [ents], [cfs], [rels]] = await Promise.all([
    db.select({ n: count() }).from(sources).where(eq(sources.sessionId, sessionId)),
    db
      .select({ n: count() })
      .from(facts)
      .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, false))),
    db.select({ n: count() }).from(entities).where(eq(entities.sessionId, sessionId)),
    db
      .select({ n: count() })
      .from(facts)
      .where(and(eq(facts.sessionId, sessionId), eq(facts.isCounterfactual, true))),
    // Counted alongside the entities, deliberately. Entities with no
    // relationships is the failure mode this stream could not show.
    db
      .select({ n: count() })
      .from(relationships)
      .where(eq(relationships.sessionId, sessionId)),
  ]);
  return {
    sourcesFound: srcs?.n ?? 0,
    factsExtracted: fcts?.n ?? 0,
    entitiesIdentified: ents?.n ?? 0,
    counterfactualsRaised: cfs?.n ?? 0,
    relationshipsFound: rels?.n ?? 0,
  };
}

export const GET: RequestHandler = async ({ params }) => {
  const sessionId = params.id;

  const [session] = await db
    .select()
    .from(researchSessions)
    .where(eq(researchSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  // A draft session with no live worker has nobody to produce events. Adopting
  // it here is what makes "open the page and it runs" true after a restart.
  if (session.status === 'draft' && !isRunning(sessionId)) {
    startResearch(sessionId);
  }

  const emitter = getEmitter(sessionId);
  const stats = await currentStats(sessionId);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const send = (event: SSEEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      function onEvent(event: SSEEvent) {
        send(event);
      }
      emitter.on('event', onEvent);

      // --- replay: everything a late joiner needs to render immediately ---
      send({ type: 'status', data: { status: session.status, depth: session.depth } });
      send({ type: 'stats', data: stats });
      const summary = (session.report as { executive_summary?: string } | null)?.executive_summary;
      if (summary) send({ type: 'synthesis', data: { executive_summary: summary } });
      if (session.status === 'complete') {
        send({ type: 'complete', data: { durationMs: session.durationMs ?? null } });
      }
      if (session.status === 'failed') {
        send({ type: 'error', message: session.errorMessage ?? 'Research failed' });
      }

      const keepalive = setInterval(() => {
        if (closed) {
          clearInterval(keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          closed = true;
          clearInterval(keepalive);
          emitter.off('event', onEvent);
        }
      }, KEEPALIVE_MS);

      (controller as unknown as { _cleanup?: () => void })._cleanup = () => {
        closed = true;
        clearInterval(keepalive);
        emitter.off('event', onEvent);
      };
    },
    cancel(controller) {
      (controller as unknown as { _cleanup?: () => void })._cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Caddy/cloudflared will happily buffer an event stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
};
