import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { playerFor } from '$lib/games/players.server';
import { asHttp, subscribe } from '$lib/games/rooms.server';

const KEEPALIVE_MS = 15_000;

/**
 * GET /api/native/games/[id]/stream — the room as SSE, one
 * `{"type":"room","room":…}` frame now and on every change; a
 * `{"type":"gone"}` frame and the end of the stream when the room is dropped.
 *
 * The shape of `api/research/[id]/stream`: replay on connect, a keepalive
 * comment so cloudflared does not reap a quiet lobby, cleanup on cancel.
 */
export const GET: RequestHandler = withNativeAccess('games', async (event, identity) => {
  const me = await playerFor(identity.ownerEmail);
  const encoder = new TextEncoder();
  let cleanup = () => {};

  // Subscribing throws for a room that is gone or not theirs; do it before the
  // stream exists so that comes back as a status, not a stream that dies.
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const pending: Uint8Array[] = [];
  let closed = false;
  const write = (text: string) => {
    if (closed) return;
    const chunk = encoder.encode(text);
    if (!controllerRef) {
      pending.push(chunk);
      return;
    }
    try {
      controllerRef.enqueue(chunk);
    } catch {
      closed = true;
      cleanup();
    }
  };

  const unsubscribe = asHttp(() =>
    subscribe(
      event.params.id,
      me.id,
      (room) => write(`data: ${JSON.stringify({ type: 'room', room })}\n\n`),
      () => {
        write(`data: ${JSON.stringify({ type: 'gone' })}\n\n`);
        closed = true;
        cleanup();
        try {
          controllerRef?.close();
        } catch {
          /* already closed */
        }
      },
    ),
  );

  const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
  cleanup = () => {
    closed = true;
    clearInterval(keepalive);
    unsubscribe();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of pending.splice(0)) controller.enqueue(chunk);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Caddy/cloudflared will happily buffer an event stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
});
