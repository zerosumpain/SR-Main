/**
 * Bidirectional WebSocket session for a single build, surfaced over the
 * Unix socket. Replaces the one-way SSE forwarding of phase 3 — phases
 * 5 and 6 need user input flowing back into the iteration loop, which
 * SSE can't carry. SvelteKit's /api/jkai/builds/[id]/session route
 * upgrades the browser WS to its own connection on this side.
 *
 * Wire format: JSON frames in both directions.
 *   Outbound (builder → user):
 *     {kind:'log', id, type, content, iterationId}
 *     {kind:'live', event}     // negative-id streaming deltas
 *     {kind:'pending', queue}  // current pending-message list
 *     {kind:'notes', notes}    // current pinned-notes list
 *     {kind:'shell_chunk', stream:'stdout'|'stderr', text}
 *     {kind:'shell_end', exitCode}
 *   Inbound (user → builder):
 *     {kind:'inject', content}        // queue user message for next turn
 *     {kind:'interrupt'}              // abort current pi child
 *     {kind:'shell', command}         // ad-hoc command in workdir
 *     {kind:'note_add', content}
 *     {kind:'note_remove', id}
 *     {kind:'ping'}                   // server replies {kind:'pong'}
 *
 * Auth: SvelteKit gates the upstream upgrade with the user's Auth.js
 * session — by the time the request reaches this socket, auth is done.
 * The unix-socket origin is the trust boundary.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { onBuildLog } from '$lib/jkai/orchestrator';
import { onBuildLive } from '$lib/jkai/log-emitter';
import { handleInbound } from './inbound';
import { listPendingMessages } from '$lib/jkai/pending-messages';
import { listNotes } from '$lib/jkai/build-notes';

const wss = new WebSocketServer({ noServer: true });

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* socket dead, drop */ }
}

export function handleWsUpgrade(buildId: string, req: IncomingMessage, socket: Duplex, head: Buffer): void {
  wss.handleUpgrade(req, socket, head, (ws) => {
    let closed = false;

    function close(): void {
      if (closed) return;
      closed = true;
      unsubLog();
      unsubLive();
      try { ws.close(); } catch { /* swallow */ }
    }

    const unsubLog = onBuildLog(buildId, (log) => {
      send(ws, { kind: 'log', id: log.id, type: log.type, content: log.content, iterationId: log.iterationId });
    });
    const unsubLive = onBuildLive(buildId, (event) => {
      send(ws, { kind: 'live', event });
    });

    // Initial state snapshot — pending queue + active notes — so the
    // browser can render them on first paint without an extra round-trip.
    void Promise.all([
      listPendingMessages(buildId).catch(() => []),
      listNotes(buildId).catch(() => []),
    ]).then(([queue, notes]) => {
      send(ws, { kind: 'pending', queue });
      send(ws, { kind: 'notes', notes });
    });

    ws.on('message', (data) => {
      let msg: { kind?: string; [k: string]: unknown };
      try { msg = JSON.parse(data.toString('utf-8')); }
      catch { send(ws, { kind: 'error', message: 'invalid json' }); return; }
      if (msg.kind === 'ping') { send(ws, { kind: 'pong', t: Date.now() }); return; }
      void handleInbound(buildId, msg, (out) => send(ws, out)).catch((err) => {
        send(ws, { kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    });

    ws.on('close', close);
    ws.on('error', close);
  });
}
