/**
 * SSE bridge: forwards the builder's `/events/<buildId>` stream into the
 * browser's SSE connection. Phase 3 moved authoritative event emission into
 * the jkai-builder process, so the SvelteKit web app no longer has the
 * in-process onBuildLog/onBuildLive event sources to subscribe to. This
 * handler dials the Unix socket and pipes the SSE bytes through.
 *
 * Replay-on-reconnect: we forward Last-Event-ID upstream by passing it as a
 * query param, the builder uses it to rewind the in-memory log replay (and
 * the persisted-row scan still runs server-side). Behaviour the browser sees
 * is unchanged.
 */
import type { RequestHandler } from './$types';
import { request as httpRequest } from 'node:http';
import { BUILDER_SOCKET_PATH } from '$lib/jkai/builder-client';

export const GET: RequestHandler = async ({ params, request }) => {
  const buildId = params.id;
  const lastEventId = request.headers.get('Last-Event-ID') ?? '';
  const path = `/events/${encodeURIComponent(buildId)}${lastEventId ? `?lastEventId=${encodeURIComponent(lastEventId)}` : ''}`;

  let upstreamReq: ReturnType<typeof httpRequest> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function close(): void {
        if (closed) return;
        closed = true;
        try { upstreamReq?.destroy(); } catch { /* swallow */ }
        try { controller.close(); } catch { /* already closed */ }
      }

      upstreamReq = httpRequest(
        {
          socketPath: BUILDER_SOCKET_PATH,
          method: 'GET',
          path,
          headers: { 'Last-Event-ID': lastEventId },
          // No timeout — SSE streams are long-lived. Keepalive frames every 15s
          // (sent by the builder) keep the underlying socket alive.
        },
        (upstream) => {
          upstream.on('data', (chunk: Buffer) => {
            if (closed) return;
            try { controller.enqueue(chunk); } catch { close(); }
          });
          upstream.on('end', close);
          upstream.on('error', close);
        },
      );
      upstreamReq.on('error', (err) => {
        if (closed) return;
        // Connection error to the builder — surface as a one-shot SSE
        // comment so the client sees something rather than a silent close.
        try {
          controller.enqueue(
            encoder.encode(`: builder unreachable: ${err.message}\n\n`),
          );
        } catch { /* swallow */ }
        close();
      });
      upstreamReq.end();

      request.signal.addEventListener('abort', close);
    },
    cancel() {
      closed = true;
      try { upstreamReq?.destroy(); } catch { /* swallow */ }
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
