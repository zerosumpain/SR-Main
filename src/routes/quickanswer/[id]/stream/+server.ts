import type { RequestHandler } from './$types';
import { getEmitter, startQuickAnswer } from '$lib/quickanswer/worker';
import { db } from '$lib/db';
import { quickAnswers } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { QuickAnswerSSEEvent } from '$lib/quickanswer/types';

export const GET: RequestHandler = async ({ params }) => {
  const id = params.id;

  // Start the worker if still pending
  const [row] = await db.select({ status: quickAnswers.status }).from(quickAnswers).where(eq(quickAnswers.id, id));
  if (row?.status === 'pending') {
    await startQuickAnswer(id);
  }

  const emitter = getEmitter(id);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function onEvent(event: QuickAnswerSSEEvent) {
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream closed
        }
      }

      emitter.on('event', onEvent);

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'status', data: { status: 'connected' } })}\n\n`),
      );

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          emitter.off('event', onEvent);
        }
      }, 15000);

      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        emitter.off('event', onEvent);
      };
    },
    cancel(controller) {
      if ((controller as any)?._cleanup) {
        (controller as any)._cleanup();
      }
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
