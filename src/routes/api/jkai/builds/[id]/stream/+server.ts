import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiLogs } from '$lib/db/schema';
import { eq, gt, and, asc } from 'drizzle-orm';
import { onBuildLog } from '$lib/jkai/orchestrator';

export const GET: RequestHandler = async ({ params, request }) => {
  const buildId = params.id;
  const lastEventId = request.headers.get('Last-Event-ID');

  let unsub: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  function cleanup() {
    if (closed) return;
    closed = true;
    if (keepalive) clearInterval(keepalive);
    if (unsub) unsub();
    keepalive = null;
    unsub = null;
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(id: number, data: any) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      }

      // Replay missed events
      if (lastEventId) {
        const parsedId = parseInt(lastEventId, 10);
        if (!isNaN(parsedId) && parsedId > 0) {
          const missed = await db
            .select()
            .from(jkaiLogs)
            .where(
              and(
                eq(jkaiLogs.buildId, buildId),
                gt(jkaiLogs.id, parsedId),
              ),
            )
            .orderBy(asc(jkaiLogs.id))
            .limit(500);

          for (const log of missed) {
            send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
          }
        }
      }

      // Live events
      unsub = onBuildLog(buildId, (log) => {
        send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
      });

      // Keepalive every 15s — also serves as liveness check
      keepalive = setInterval(() => {
        if (closed) {
          cleanup();
          return;
        }
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
