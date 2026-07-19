import type { RequestHandler } from './$types';
import { delegateToAgent } from '$lib/agents/delegate';

/**
 * Streaming delegation — runs a specialist agent and forwards its tool steps +
 * tokens live over SSE, so /jkai/agents can show the agent working. Owner-gated
 * by hooks. Frames: {type:'connected'} · {type:'event',event:JobEvent} ·
 * {type:'done',result} · {type:'error',message}.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const agent = typeof body.agent === 'string' ? body.agent : '';
  const task = typeof body.task === 'string' ? body.task : '';
  if (!agent || !task) return new Response('agent and task are required', { status: 400 });

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller closed */
        }
      };
      void (async () => {
        try {
          send({ type: 'connected' });
          const result = await delegateToAgent(agent, task, (e) => send({ type: 'event', event: e }));
          send({ type: 'done', result });
        } catch (err) {
          send({ type: 'error', message: err instanceof Error ? err.message : 'delegation failed' });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
};
