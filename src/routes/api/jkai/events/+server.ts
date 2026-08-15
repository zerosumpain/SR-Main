// SSE endpoint for real-time follow-up message delivery.
//
// Takes EITHER `conversationId=<id>` (one thread) or `conversationIds=a,b,c`
// (several). The multi form exists because the chat page now keeps one mounted
// pane per open tab: a connection each would put five SSE streams plus their
// job streams against a six-per-origin HTTP/1.1 budget on the dev server, and
// the ones over the line stall silently rather than erroring. One connection
// carries the whole working set instead.
//
// Every frame is tagged with its `conversationId` so the client can route it —
// the single-id form is tagged too, so both shapes are handled identically
// downstream.
import type { RequestHandler } from './$types';
import { subscribeToConversation } from '$lib/workflows/chat/followup-queue';

const MAX_CONVERSATIONS = 8;

export const GET: RequestHandler = async ({ url }) => {
  const single = url.searchParams.get('conversationId');
  const multi = url.searchParams.get('conversationIds');
  const ids = [
    ...new Set(
      (multi ? multi.split(',') : single ? [single] : [])
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_CONVERSATIONS);

  if (ids.length === 0) {
    return new Response('conversationId or conversationIds required', { status: 400 });
  }

  let unsubscribes: Array<() => void> = [];
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Stream closed
          cleanup();
        }
      };

      const cleanup = () => {
        for (const off of unsubscribes) off();
        unsubscribes = [];
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      };

      // Subscribe to follow-up messages for every requested thread.
      unsubscribes = ids.map((id) =>
        subscribeToConversation(id, (convId, message) => {
          send(`data: ${JSON.stringify({ ...(message as object), conversationId: convId ?? id })}\n\n`);
        }),
      );

      // Keepalive every 30s
      keepaliveTimer = setInterval(() => send(': keepalive\n\n'), 30_000);

      // Initial connection event
      send(`data: ${JSON.stringify({ type: 'connected', conversationIds: ids })}\n\n`);
    },
    cancel() {
      for (const off of unsubscribes) off();
      unsubscribes = [];
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
