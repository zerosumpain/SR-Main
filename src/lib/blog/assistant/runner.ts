import type OpenAI from 'openai';
import { getPostById } from '$lib/blog';
import { buildSystemPrompt } from './prompt';
import { runTool, toolDefinitions, type PostSnapshot } from './tools';
import type { Proposal } from './proposal';
import type { ChatMessage } from './messages';

const MAX_TOOL_CALLS = 6;

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'done'; reason: 'stop' | 'cap' }
  | { type: 'error'; message: string };

export type RunOptions = {
  postId: number;
  userMessage: string;
  history: ChatMessage[];
  client: OpenAI;
  model: string;
};

/**
 * Strip pending-suggestion marks that prior assistant runs left in the saved
 * HTML. The LLM should see the post as if all unaccepted proposals had been
 * resolved as "keep the original":
 *   - <ins data-suggestion-id="…" class="sg-add">X</ins> → drop entirely (X
 *     is a not-yet-accepted insertion).
 *   - <del data-suggestion-id="…" class="sg-remove">X</del> → unwrap, keep X
 *     (the original text the user hasn't yet agreed to delete).
 */
function stripSuggestionMarks(html: string): string {
  let out = html;
  // Remove <ins data-suggestion-id="…" …>…</ins> entirely.
  out = out.replace(/<ins\s+[^>]*data-suggestion-id=[^>]*>[\s\S]*?<\/ins>/gi, '');
  // Unwrap <del data-suggestion-id="…" …>…</del> — keep inner content.
  out = out.replace(/<del\s+[^>]*data-suggestion-id=[^>]*>([\s\S]*?)<\/del>/gi, '$1');
  // Unwrap <s>…</s> and <strike>…</strike>. The user's stored content can
  // contain these as legitimate styling, but the LLM's find/replace patch
  // engine matches against TipTap's textContent which doesn't include the
  // tag markup — and the LLM, when shown raw HTML, will copy <s> tags into
  // its `find` argument and the patch will fail to anchor. Stripping them
  // before the prompt means the LLM sees the rendered prose and proposes
  // patches against that. (Stylistic strikethrough may be inadvertently
  // un-struck by an accepted proposal — the user can re-apply via the
  // toolbar.)
  out = out.replace(/<\/?(?:s|strike)>/gi, '');
  return out;
}

function toRowSnapshot(row: Awaited<ReturnType<typeof getPostById>>): PostSnapshot {
  if (!row) throw new Error('Post not found');
  const rawContent = row.content;
  const cleaned = stripSuggestionMarks(rawContent);
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    slug: row.slug,
    content: cleaned,
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
    ...history.map((h) => ({ role: h.role === 'tool' || h.role === 'proposal' ? 'assistant' : h.role, content: h.content })),
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

        const result = await runTool(name, args, { postId, snapshot });

        if (result.ok && 'proposal' in result) {
          yield { type: 'proposal', proposal: result.proposal };
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify({ ok: true, proposalId: result.proposal.id, summary: summarise(result.proposal) }),
          });
        } else if (result.ok && 'snapshot' in result) {
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ ok: true, snapshot: result.snapshot }),
          });
        } else if (!result.ok) {
          messages.push({
            role: 'tool', tool_call_id: tc.id,
            content: JSON.stringify({ ok: false, error: result.error }),
          });
        }
      }
      continue;
    }

    const text = msg.content ?? '';
    if (text) yield { type: 'text', delta: text };
    yield { type: 'done', reason: 'stop' };
    return;
  }
}

function summarise(p: Proposal): string {
  if (p.kind === 'meta') return `proposed ${p.field} → ${JSON.stringify(p.suggestedValue).slice(0, 60)}`;
  return `proposed prose change at ${p.anchor.from}–${p.anchor.to}`;
}
