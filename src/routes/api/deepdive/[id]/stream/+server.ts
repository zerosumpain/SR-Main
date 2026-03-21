import type { RequestHandler } from './$types';
import { getEmitter } from '$lib/deepdive/worker';
import type { SSEEvent } from '$lib/deepdive/types';

export const GET: RequestHandler = async ({ params }) => {
  const sessionId = params.id;
  const emitter = getEmitter(sessionId);

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function onEvent(event: SSEEvent) {
        try {
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          // Stream closed
        }
      }

      emitter.on('event', onEvent);

      // Send initial keepalive
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', message: 'connected' })}\n\n`));

      // Cleanup on close
      const cleanup = () => {
        emitter.off('event', onEvent);
      };

      // Periodic keepalive to prevent timeout
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          cleanup();
        }
      }, 15000);

      // Store cleanup for when stream is cancelled
      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        cleanup();
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
