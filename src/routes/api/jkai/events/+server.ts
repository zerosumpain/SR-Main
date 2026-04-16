// SSE endpoint for real-time follow-up message delivery
import type { RequestHandler } from './$types';
import { subscribeToConversation } from '$lib/workflows/chat/followup-queue';

export const GET: RequestHandler = async ({ url }) => {
  const conversationId = url.searchParams.get('conversationId');
  if (!conversationId) {
    return new Response('conversationId required', { status: 400 });
  }

  let unsubscribe: (() => void) | null = null;
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
        unsubscribe?.();
        unsubscribe = null;
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      };

      // Subscribe to follow-up messages
      unsubscribe = subscribeToConversation(conversationId, (_convId, message) => {
        send(`data: ${JSON.stringify(message)}\n\n`);
      });

      // Keepalive every 30s
      keepaliveTimer = setInterval(() => send(': keepalive\n\n'), 30_000);

      // Initial connection event
      send(`data: ${JSON.stringify({ type: 'connected', conversationId })}\n\n`);
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
