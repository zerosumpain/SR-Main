import type { RequestHandler } from './$types';
import { onActivity } from '$lib/agent/events';
import type { ActivityEvent } from '$lib/agent/events';

export const GET: RequestHandler = async () => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      }

      // Send initial connection event
      send({ type: 'connected', timestamp: new Date().toISOString() });

      // Listen for activity events
      const unsubscribe = onActivity((event: ActivityEvent) => {
        send({
          type: 'activity',
          ...event,
        });
      });

      // Keepalive every 15 seconds
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          unsubscribe();
        }
      }, 15000);

      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
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
