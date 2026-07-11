// The slide art director. Raw content in (text + media links), one composed
// slide out: an LLM (through the resilient workflow gateway — timeout,
// z.ai→OpenRouter failover, concurrency cap) chooses the most impactful
// layout and blocks; the deterministic heuristic composes instead whenever
// the LLM is unavailable or returns something the registry rejects. Every
// output passes the same validation gate the editor and jkai tools use.

import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { composeHeuristic, type ComposedSlide, type ComposeInput } from '$lib/presentation/compose-heuristic';
import { isLayout, layoutDocsForLLM } from '$lib/presentation/layouts';
import { BLOCK_DOCS, validateBlocks } from '$lib/presentation/registry';
import type { Block } from '$lib/presentation/types';

export interface ComposeContext {
  deckTitle?: string;
  /** Layouts of the neighbouring slides, so the composer varies the rhythm. */
  recentLayouts?: string[];
}

function systemPrompt(ctx: ComposeContext): string {
  return [
    'You are the art director for sr. decks — bold, editorial presentation slides (Fraunces serif, paper-and-ink).',
    'Given raw content, compose EXACTLY ONE slide: pick the most impactful layout and typed blocks.',
    '',
    'Rules:',
    '- Reformat and tighten the given content. NEVER invent facts, numbers or quotes that are not in it.',
    '- Fewer, bigger elements beat many small ones. 1–4 blocks. Cut filler words; keep meaning.',
    '- A number worth feeling goes in bigNumber. Several figures go in statRow. A line worth saying aloud goes in quote.',
    '- Every provided media URL must appear as an image block (or iframe for site-relative pages).',
    `- Vary the rhythm: the neighbouring slides use [${(ctx.recentLayouts ?? []).join(', ') || 'none yet'}] — prefer a DIFFERENT layout when the content allows.`,
    '',
    `Layouts: ${layoutDocsForLLM()}`,
    '',
    `Blocks: ${Object.entries(BLOCK_DOCS)
      .map(([k, v]) => `${k} — ${v}`)
      .join(' | ')}`,
    '',
    'Respond with ONLY a JSON object: {"title": string|null, "layout": string, "blocks": Block[]}. No markdown fences, no commentary.',
  ].join('\n');
}

function parseLLMSlide(raw: string): ComposedSlide | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  const obj = parsed as { title?: unknown; layout?: unknown; blocks?: unknown };
  if (!Array.isArray(obj.blocks) || obj.blocks.length === 0 || obj.blocks.length > 6) return null;
  const check = validateBlocks(obj.blocks);
  if (!check.ok) return null;
  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 120) : null,
    layout: isLayout(obj.layout) ? obj.layout : 'default',
    blocks: obj.blocks as Block[],
  };
}

export async function composeSlide(
  input: ComposeInput,
  ctx: ComposeContext = {},
): Promise<{ slide: ComposedSlide; source: 'llm' | 'heuristic' }> {
  const userContent = [
    ctx.deckTitle ? `Deck: "${ctx.deckTitle}"` : null,
    input.text?.trim() ? `CONTENT:\n${input.text.trim()}` : null,
    input.mediaUrls?.length ? `MEDIA URLS:\n${input.mediaUrls.join('\n')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const completion = await resilientChatCompletion(undefined, {
      messages: [
        { role: 'system', content: systemPrompt(ctx) },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
      // GLM burns reasoning tokens from max_tokens — keep the ceiling generous
      // (see feedback_glm_reasoning_tokens).
      max_tokens: 3200,
      response_format: { type: 'json_object' },
    });
    const text = completion.choices[0]?.message?.content ?? '';
    const slide = parseLLMSlide(text);
    if (slide) return { slide, source: 'llm' };
    console.warn('[decks composer] LLM output failed validation — using heuristic');
  } catch (err) {
    console.warn('[decks composer] LLM unavailable — using heuristic:', err instanceof Error ? err.message : err);
  }
  return { slide: composeHeuristic(input), source: 'heuristic' };
}
