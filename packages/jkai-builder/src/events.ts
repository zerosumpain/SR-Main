/**
 * SSE event stream for a single build, surfaced over the Unix socket.
 *
 * SvelteKit's /api/jkai/builds/[id]/stream endpoint proxies to this so the
 * browser still sees one logical SSE connection while the underlying event
 * source moved to the builder process. Cross-process bridging via PG
 * LISTEN/NOTIFY would also work but is heavier; this direct pipe is simpler
 * and the only consumer of these events is the SvelteKit handler anyway.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { onBuildLog } from '$lib/jkai/orchestrator';
import { onBuildLive } from '$lib/jkai/log-emitter';

export function handleEvents(buildId: string, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });

  let closed = false;
  let liveSeq = 0;

  function send(id: number, payload: unknown): void {
    if (closed) return;
    try {
      res.write(`id: ${id}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      cleanup();
    }
  }

  const unsubLog = onBuildLog(buildId, (log) => {
    send(log.id, { type: log.type, content: log.content, iterationId: log.iterationId });
  });
  const unsubLive = onBuildLive(buildId, (ev) => {
    liveSeq += 1;
    send(-liveSeq, ev);
  });

  // Keepalive every 15s. SvelteKit's proxy does its own keepalive too,
  // but doubling up costs nothing and helps detect stuck pipes early.
  const keepalive = setInterval(() => {
    if (closed) return;
    try { res.write(': keepalive\n\n'); } catch { cleanup(); }
  }, 15000);

  function cleanup(): void {
    if (closed) return;
    closed = true;
    clearInterval(keepalive);
    unsubLog();
    unsubLive();
    try { res.end(); } catch { /* swallow */ }
  }

  req.on('close', cleanup);
  req.on('aborted', cleanup);
  req.on('error', cleanup);
}
