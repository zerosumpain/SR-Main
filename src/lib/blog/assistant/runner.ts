import type OpenAI from 'openai';
import { getPostById } from '$lib/blog';
import { buildSystemPrompt } from './prompt';
import { runTool, toolDefinitions, type PostSnapshot } from './tools';
import { undoStore } from './undo-store';
import type { ChatMessage } from './messages';

const MAX_TOOL_CALLS = 6;

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; result?: unknown; error?: string; undoToken?: string }
  | { type: 'post_state'; post: PostSnapshot }
  | { type: 'done'; reason: 'stop' | 'cap' }
  | { type: 'error'; message: string };

export type RunOptions = {
  postId: number;
  userMessage: string;
  history: ChatMessage[];
  client: OpenAI;
  model: string;
};

function toRowSnapshot(row: Awaited<ReturnType<typeof getPostById>>): PostSnapshot {
  if (!row) throw new Error('Post not found');
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    slug: row.slug,
    content: row.content,
    contentFormat: (row.contentFormat as 'html' | 'markdown') ?? 'html',
    status: (row.status as 'draft' | 'published') ?? 'draft',
    coverImageUrl: row.coverImageUrl ?? null,
    coverImageAlt: (row as { coverImageAlt?: string | null }).coverImageAlt ?? null,
    publishedAt: row.publishedAt ?? null,
    previewToken: row.previewToken ?? null,
    tags: row.tags ?? [],
  };
}

export async function* runAssistant(opts: RunOptions): AsyncGenerator<AssistantEvent> {
  const { postId, userMessage, history, client, model } = opts;
  const row = await getPostById(postId);
  if (!row) {
    yield { type: 'error', message: `Post ${postId} not found.` };
    return;
  }
  const snapshot = toRowSnapshot(row);

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildSystemPrompt(snapshot) },
    ...history.map((h) => ({ role: h.role === 'tool' ? 'assistant' : h.role, content: h.content })),
    { role: 'user', content: userMessage },
  ];

  let toolCalls = 0;

  while (true) {
    let resp;
    try {
      resp = await client.chat.completions.create({
        model,
        messages: messages as never,
        tools: toolDefinitions as never,
        tool_choice: 'auto' as never,
      });
    } catch (e) {
      yield { type: 'error', message: e instanceof Error ? e.message : 'LLM call failed' };
      return;
    }

    const choice = resp.choices[0];
    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });

      for (const tc of msg.tool_calls) {
        if (toolCalls >= MAX_TOOL_CALLS) {
          yield { type: 'done', reason: 'cap' };
          return;
        }
        toolCalls++;
        const name = tc.function.name;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore parse error */ }

        yield { type: 'tool_call', name, arguments: args };

        const result = await runTool(name, args, { postId, snapshot, undoStore });
        if (result.ok) {
          yield {
            type: 'tool_result',
            name,
            ok: true,
            result: result.result,
            undoToken: result.undoToken,
          };
        } else {
          yield { type: 'tool_result', name, ok: false, error: result.error };
        }

        if (name !== 'read_post') {
          yield { type: 'post_state', post: { ...snapshot } };
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result.ok ? { ok: true, result: result.result } : { ok: false, error: result.error }),
        });
      }
      continue; // let the model react to tool results
    }

    const text = msg.content ?? '';
    if (text) yield { type: 'text', delta: text };
    yield { type: 'done', reason: 'stop' };
    return;
  }
}
