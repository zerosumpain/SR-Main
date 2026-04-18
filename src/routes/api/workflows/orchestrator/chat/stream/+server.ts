// SSE endpoint for live token streaming of an orchestrator chat job.
// Mirrors the pattern used by `/api/jkai/events` but keyed by jobId.
import type { RequestHandler } from './$types';
import { subscribeJob, getJob } from '$lib/workflows/chat/job-store';

export const GET: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return new Response('jobId required', { status: 400 });

  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        try { controller.close(); } catch { /* already closed */ }
      };

      send(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

      // If the job already finished before the client subscribed, the buffer
      // will replay events synchronously via subscribeJob — including the
      // terminal 'done'/'error'. We still close the connection after that.
      unsubscribe = subscribeJob(jobId, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done' || event.type === 'error') {
          // Allow event to flush before closing
          setTimeout(cleanup, 10);
        }
      });

      // If the job doesn't exist (e.g., invalid jobId) and no buffered events
      // exist, close with error.
      if (!getJob(jobId)) {
        send(`data: ${JSON.stringify({ type: 'error', message: 'job not found' })}\n\n`);
        setTimeout(cleanup, 10);
      }

      keepaliveTimer = setInterval(() => send(': keepalive\n\n'), 30_000);
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};
