// src/routes/api/curate/sessions/[id]/messages/+server.ts
//
// GET  /api/curate/sessions/[id]/messages  — SSE stream
// POST /api/curate/sessions/[id]/messages  — send user message

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession } from '$lib/curate/session-store';
import { subscribe } from '$lib/curate/event-bus';
import { runScopeChat, runIteration } from '$lib/curate/engine';

// ── GET — SSE stream ──────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ params, request }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);

  const sessionId = params.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Send initial connected event.
      try {
        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ sessionId, status: session.status })}\n\n`,
          ),
        );
      } catch {
        // Already closed before first byte — nothing to do.
        return;
      }

      // Register with the event bus.
      const unsubscribe = subscribe(sessionId, controller);

      // Keepalive ping every 15 s to prevent proxy/browser timeouts.
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(keepalive);
          unsubscribe();
        }
      }, 15_000);

      // Store cleanup so cancel() can reach it.
      (controller as unknown as Record<string, unknown>)._cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
      };

      // Clean up if the client disconnects.
      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      });
    },

    cancel(controller) {
      const c = controller as unknown as Record<string, unknown>;
      if (typeof c._cleanup === 'function') {
        (c._cleanup as () => void)();
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

// ── POST — user message ────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ params, request }) => {
  const session = await getSession(params.id);
  if (!session) throw error(404, `Curate session not found: ${params.id}`);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw error(400, 'Missing required field: text');

  const { status } = session;

  if (status === 'scoping') {
    // Fire-and-forget: scope chat runs in the background.
    void runScopeChat(params.id, text).catch(() => undefined);
    return json({ queued: true, routing: 'scope-chat' });
  }

  if (status === 'discovering') {
    // Fire-and-forget: interjection re-runs discovery in the background.
    void runIteration(params.id, text).catch(() => undefined);
    return json({ queued: true, routing: 'discovery-interjection' });
  }

  // Any other status doesn't accept user messages via this endpoint.
  throw error(409, `Session status '${status}' does not accept user messages`);
};
