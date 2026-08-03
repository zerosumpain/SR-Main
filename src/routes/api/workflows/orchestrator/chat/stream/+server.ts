// SSE endpoint for live token streaming of an orchestrator chat job.
// Mirrors the pattern used by `/api/jkai/events` but keyed by jobId.
import type { RequestHandler } from './$types';
import { subscribeJob, getJob } from '$lib/workflows/chat/job-store';

export const GET: RequestHandler = async ({ url, request }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return new Response('jobId required', { status: 400 });

  // Resume point. The browser's own EventSource reconnect sends the last `id:`
  // it saw back as `Last-Event-ID`; a manual reopen (the gap detector in
  // $lib/jkai/chat-stream) passes the same number as `?after=`. Either way we
  // replay only what the client missed — replaying the whole buffer into a
  // handler that appends is what silently doubled the bubble on every
  // reconnect.
  const resumeRaw = request.headers.get('Last-Event-ID') || url.searchParams.get('after');
  const resumeFrom = resumeRaw ? Number(resumeRaw) : NaN;
  const fromSeq = Number.isFinite(resumeFrom) && resumeFrom >= 0 ? Math.floor(resumeFrom) + 1 : 0;

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
      // Every frame carries its sequence number as `id:` so a reconnect can
      // resume from it rather than replay from the start.
      unsubscribe = subscribeJob(jobId, (event, seq) => {
        send(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'done' || event.type === 'error') {
          // Allow event to flush before closing
          setTimeout(cleanup, 10);
        }
      }, fromSeq);

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
      // Matches every other SSE route in the repo (see
      // /api/canvas/[slug]/stream) — without it a buffering proxy can hold
      // frames back and turn a live stream into a burst.
      'X-Accel-Buffering': 'no',
    },
  });
};
