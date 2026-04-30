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
  /** When true, the system prompt is biased toward producing at most two
   *  unobtrusive proposals and no chat output. */
  autoReview?: boolean;
};

/**
 * Strip stylistic strikethrough tags before showing the body to the LLM.
 * The patch engine matches against the editor's plain-text content, which
 * doesn't include `<s>` markup; if the LLM copies `<s>` into its `find`
 * argument the patch will never anchor. (Suggestions are now overlays —
 * decorations — so they never appear in saved HTML and no longer need
 * stripping at this layer.)
 */
function stripSuggestionMarks(html: string): string {
  return html.replace(/<\/?(?:s|strike)>/gi, '');
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
  const { postId, userMessage, history, client, model, autoReview } = opts;
  const row = await getPostById(postId);
  if (!row) {
    yield { type: 'error', message: `Post ${postId} not found.` };
    return;
  }
  const snapshot = toRowSnapshot(row);

  // proposal_resolved rows are non-conversational; we use them only to build
  // the style cues block. They're filtered out of the messages array fed to
  // the model so they don't pollute the chat thread.
  const conversational = history.filter((h) => h.role !== 'proposal_resolved' && h.role !== 'tool' && h.role !== 'proposal');

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: buildSystemPrompt(snapshot, history, { autoReview: !!autoReview }) },
    ...conversational.map((h) => ({ role: h.role, content: h.content })),
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
