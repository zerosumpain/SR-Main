import type { RequestHandler } from './$types';
import { onWorkflowEvent } from '$lib/workflows/events';
import type { WorkflowEvent } from '$lib/workflows';

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.runId;

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

      send({ type: 'connected', runId, timestamp: new Date().toISOString() });

      const unsubscribe = onWorkflowEvent(runId, (event: WorkflowEvent) => {
        send(event as unknown as Record<string, unknown>);
        if (
          event.type === 'run_completed' ||
          event.type === 'run_completed_with_errors' ||
          event.type === 'run_failed'
        ) {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });

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
