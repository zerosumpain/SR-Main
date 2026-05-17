// SSE stream of workflow-update events for the canvas page.
//
// Subscribes to the in-process workflow-updates-bus for a specific workflowId
// and forwards every event as a single SSE message. The canvas page opens
// this stream when it loads and calls invalidateAll() on each event so the
// node/edge layout re-renders with whatever changed.
//
// Heartbeat comment every 15s to keep proxies (Caddy, Cloudflare) from
// dropping idle connections.

import type { RequestHandler } from './$types';
import { subscribeWorkflowUpdates, type WorkflowUpdateEvent } from '$lib/jkai/workflow-updates-bus';

export const GET: RequestHandler = async ({ params, request }) => {
  const workflowId = params.id;
  if (!workflowId) {
    return new Response('workflow id required', { status: 400 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: WorkflowUpdateEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          // Stream already closed (client disconnect); ignore.
        }
      };

      // Initial hello so the client knows the channel is alive even before
      // the first mutation event.
      controller.enqueue(encoder.encode(`: subscribed workflow=${workflowId}\n\n`));

      unsubscribe = subscribeWorkflowUpdates(workflowId, send);

      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          // Stream closed; teardown via cancel().
        }
      }, 15_000);

      // Tear down when the client navigates away.
      request.signal.addEventListener('abort', () => {
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable buffering on Caddy / nginx-style upstream proxies.
      'X-Accel-Buffering': 'no',
    },
  });
};
