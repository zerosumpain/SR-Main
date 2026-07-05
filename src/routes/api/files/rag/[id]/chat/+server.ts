// RAG chat over a built collection — SSE-over-POST, mirroring the deepdive chat
// endpoint. Body: { question }. Events: connected | token{token} | done{citations}
// | error{message}. Persists both the user turn and the assistant turn.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { ragMessages } from '$lib/db/schema';
import { getOwnedCollection, answer } from '$lib/rag/pipeline';

export const POST: RequestHandler = async ({ params, request, locals }) => {
  const session = await locals.auth();
  const owner = session?.user?.email ?? null;
  const col = await getOwnedCollection(params.id!, owner ?? '');
  if (!col) return json({ error: 'not found' }, { status: 404 });
  if (col.status !== 'ready') return json({ error: 'collection is not ready' }, { status: 409 });

  const body = await request.json().catch(() => ({}));
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  if (!question) return json({ error: 'question required' }, { status: 400 });

  // Optional generation-model override (from the chat's ModelPicker). Validate the
  // shape; anything malformed falls back to the site default inside answer().
  const m = body.model;
  const model =
    m && (m.provider === 'zai' || m.provider === 'openrouter') && typeof m.modelId === 'string' && m.modelId
      ? { provider: m.provider as 'zai' | 'openrouter', modelId: m.modelId }
      : undefined;

  // Persist the user turn immediately so the transcript survives a disconnect.
  await db.insert(ragMessages).values({ collectionId: col.id, role: 'user', content: question });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller already closed */
        }
      };
      send({ type: 'connected' });
      try {
        const { text, citations } = await answer(col.id, question, {
          signal: request.signal,
          model,
          onToken: (token) => send({ type: 'token', token }),
        });
        const finalText = text.trim() || 'Sorry — I could not generate an answer for that. Try rephrasing.';
        await db
          .insert(ragMessages)
          .values({ collectionId: col.id, role: 'assistant', content: finalText, citations });
        send({ type: 'done', citations });
      } catch (e: unknown) {
        const aborted = (e as Error)?.name === 'AbortError';
        const message = aborted ? 'answer interrupted' : String((e as Error)?.message ?? 'generation failed').slice(0, 160);
        // Persist an assistant turn so a reloaded transcript isn't left with a
        // dangling user question and no reply.
        await db
          .insert(ragMessages)
          .values({ collectionId: col.id, role: 'assistant', content: `_⚠ ${message}_` })
          .catch(() => {});
        send({ type: 'error', message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
