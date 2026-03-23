import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiLogs } from '$lib/db/schema';
import { eq, gt, and, asc } from 'drizzle-orm';
import { onBuildLog } from '$lib/jkai/orchestrator';
import { authorize } from '../../../auth';

export const GET: RequestHandler = async ({ params, cookies, request, url }) => {
  if (!authorize(cookies, url))
    return new Response('Unauthorized', { status: 401 });

  const buildId = params.id;
  const lastEventId = request.headers.get('Last-Event-ID');

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      function send(id: number, data: any) {
        try {
          controller.enqueue(encoder.encode(`id: ${id}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {}
      }

      if (lastEventId) {
        const missed = await db
          .select()
          .from(jkaiLogs)
          .where(and(eq(jkaiLogs.buildId, buildId), gt(jkaiLogs.id, parseInt(lastEventId, 10))))
          .orderBy(asc(jkaiLogs.id));
        for (const log of missed) {
          send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
        }
      }

      const unsub = onBuildLog(buildId, (log) => {
        send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          unsub();
        }
      }, 15000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        unsub();
        try { controller.close(); } catch {}
      });
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
