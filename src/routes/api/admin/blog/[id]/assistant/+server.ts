import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getLLMClient } from '$lib/jkai/llm-client';
import { runAssistant } from '$lib/blog/assistant/runner';
import { appendMessage, loadHistory } from '$lib/blog/assistant/messages';

export const POST: RequestHandler = async ({ params, request }) => {
  const postId = Number(params.id);
  if (!Number.isFinite(postId)) throw error(400, 'invalid id');

  const body = await request.json().catch(() => ({}));
  const userMessage = String(body.message ?? '').trim();
  if (!userMessage) throw error(400, 'empty message');

  console.log(`[blog-assistant] post=${postId} user=${userMessage.slice(0, 80).replace(/\n/g, ' ')}`);

  const ctx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(ctx);
  const history = await loadHistory(postId);

  console.log(`[blog-assistant] post=${postId} model=${model} history=${history.length} starting stream`);

  await appendMessage(postId, 'user', userMessage);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let assistantText = '';
      const counts = { text: 0, proposal: 0, error: 0 };
      try {
        for await (const ev of runAssistant({ postId, userMessage, history, client, model })) {
          send(ev);
          if (ev.type === 'text') { assistantText += ev.delta; counts.text++; }
          if (ev.type === 'proposal') {
            counts.proposal++;
            await appendMessage(postId, 'proposal', JSON.stringify(ev.proposal));
          }
          if (ev.type === 'error') counts.error++;
        }
      } catch (e) {
        send({ type: 'error', message: e instanceof Error ? e.message : 'unknown error' });
        console.error(`[blog-assistant] post=${postId} stream error:`, e);
      } finally {
        if (assistantText) {
          await appendMessage(postId, 'assistant', assistantText).catch(() => undefined);
        }
        console.log(`[blog-assistant] post=${postId} done text=${counts.text} proposals=${counts.proposal} errors=${counts.error} replyChars=${assistantText.length}`);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
