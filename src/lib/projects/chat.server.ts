import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { withActivity } from '$lib/context/activity';
import { getLLMClient } from '$lib/llm/client';
import { requireProjectPublic } from '$lib/projects/guard';
import { rateLimit } from '$lib/server/rate-limit';
import { resolveProjectChatModel } from '$lib/server/models/workload-settings';

export interface ProjectChatChunk {
  title: string;
  text: string;
  url?: string | null;
  sourceType?: string;
}

interface ProjectChatContext {
  body: Record<string, unknown>;
  question: string;
}

interface ProjectChatOptions {
  slug: string;
  systemPrompt: string;
  retrieve: (question: string, limit: number) => ProjectChatChunk[] | Promise<ProjectChatChunk[]>;
  corpusLabel?: string;
  answerScope?: string;
  scopeLabel?: string;
  supplement?: (context: ProjectChatContext) => string;
  historyHeading?: string;
  timeoutMs?: number;
}

function clientIp(event: Parameters<RequestHandler>[0]): string {
  return event.request.headers.get('cf-connecting-ip')
    ?? event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? event.getClientAddress?.()
    ?? 'unknown';
}

function contextPassages(chunks: ProjectChatChunk[]): string {
  return chunks
    .map((chunk, index) =>
      `[${index + 1}] (${chunk.title}${chunk.url ? `, ${chunk.url}` : ''})\n${chunk.text.slice(0, 1400)}`,
    )
    .join('\n\n');
}

export function createProjectChatHandler(options: ProjectChatOptions): RequestHandler {
  const handle: RequestHandler = async (event) => {
    await requireProjectPublic(options.slug, event);

    const limit = rateLimit(`project-chat:${options.slug}:${clientIp(event)}`, {
      capacity: 20,
      refillPerSecond: 20 / 60,
    });
    if (!limit.allowed) throw error(429, 'Too many requests — please wait a moment.');

    const body = await event.request.json().catch(() => ({})) as Record<string, unknown>;
    const question = String(body.question ?? '').slice(0, 2000).trim();
    if (!question) throw error(400, 'Empty question.');

    const history = Array.isArray(body.history)
      ? body.history.slice(-6).map((message: unknown) => {
          const value = message && typeof message === 'object'
            ? message as Record<string, unknown>
            : {};
          return {
            role: value.role === 'assistant' ? 'assistant' : 'user',
            content: String(value.content ?? '').slice(0, 2000),
          };
        })
      : [];
    const historyBlock = history.length
      ? `\n\n${options.historyHeading ?? 'RECENT CONVERSATION (for context)'}:\n${history
          .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${message.content}`)
          .join('\n')}`
      : '';

    const chunks = await options.retrieve(question, 10);
    const sources = chunks.map((chunk, index) => ({
      n: index + 1,
      title: chunk.title,
      sourceType: chunk.sourceType,
      url: chunk.url,
    }));
    const supplement = options.supplement?.({ body, question }) ?? '';
    const userPrompt =
      `CONTEXT PASSAGES (retrieved from the ${options.corpusLabel ?? "project's corpus"} — cite with [n]):\n\n` +
      `${contextPassages(chunks)}${supplement}${historyBlock}\n\nQUESTION: ${question}\n\n` +
      `Answer using only the ${options.answerScope ?? 'context above'}, citing [n] markers. ` +
      `If it's outside the ${options.scopeLabel ?? 'project'}'s scope, decline briefly.`;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (value: unknown) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
          } catch {
            // The browser closed the stream.
          }
        };

        send({ type: 'sources', sources });
        try {
          const { client, model } = await getLLMClient(await resolveProjectChatModel());
          const completion = await client.chat.completions.create(
            {
              model,
              messages: [
                { role: 'system', content: options.systemPrompt },
                { role: 'user', content: userPrompt },
              ],
              temperature: 0.3,
              max_tokens: 1000,
              stream: true,
            },
            { signal: AbortSignal.timeout(options.timeoutMs ?? 120_000) as never },
          );

          let answered = false;
          for await (const chunk of completion) {
            const token = chunk?.choices?.[0]?.delta?.content;
            if (token) {
              answered = true;
              send({ type: 'token', token });
            }
          }
          if (!answered) {
            send({
              type: 'token',
              token: 'Sorry — I could not generate an answer for that. Try rephrasing.',
            });
          }
          send({ type: 'done' });
        } catch (cause: unknown) {
          const message = cause instanceof Error ? cause.message : 'generation failed';
          send({ type: 'error', message: message.slice(0, 120) });
        } finally {
          try {
            controller.close();
          } catch {
            // The browser already closed the stream.
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

  return (event) => withActivity('project-chat', async () => handle(event));
}
