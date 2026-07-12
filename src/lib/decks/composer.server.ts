// The slide art director. Raw content in (text + media links + picker-attached
// blocks), one composed slide out: an LLM (through the resilient workflow
// gateway — timeout, z.ai→OpenRouter failover, concurrency cap) chooses the
// most impactful layout and blocks; the deterministic heuristic composes
// instead whenever the LLM is unavailable or returns something the registry
// rejects. Every output passes the same validation gate the editor and jkai
// tools use.

import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import {
  composeHeuristic,
  pickStatementLayout,
  type ComposedSlide,
  type ComposeInput,
} from '$lib/presentation/compose-heuristic';
import { isLayout, layoutDocsForLLM } from '$lib/presentation/layouts';
import { BLOCK_DOCS, validateBlocks } from '$lib/presentation/registry';
import type { Block, QuoteBlock } from '$lib/presentation/types';

/** Art direction is a one-shot composition, not an agentic loop — GLM 5.2's
 *  quality is worth its latency here (turbo/5.1 stay the agentic models).
 *  The failover pin keeps 5.2 across providers when z.ai is down/limited. */
const ART_DIRECTOR_MODEL = 'glm-5.2';
const ART_DIRECTOR_FALLBACK = 'z-ai/glm-5.2';

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
    'Editorial craft (non-negotiable):',
    '- Whitespace is the loudest signal of importance. Fewer, bigger elements: 1–3 blocks. Never fill the page.',
    '- An assertive fact or claim = a headline block (kicker → ≤12-word statement, sentence case, no full stop → optional one-line dek) on a statement-left or statement-right layout. Ragged, aligned display type beats centered text — reserve centered `statement` for openings and codas.',
    '- quote is for REAL quotations and aphorisms only, ≤140 characters. A paragraph is prose (lede: true for the opening); a claim is a headline. NEVER pour long text into a quote.',
    '- A number worth feeling goes in bigNumber. Several figures go in statRow.',
    '- Charts: trend→line/area, comparison→bar, before/after→slope, share-of-whole→donut, correlation→scatter, flow/allocation→sankey.',
    '- Reformat and tighten the given content. NEVER invent facts, numbers or quotes that are not in it.',
    '- Every provided media URL must appear as an image block (or iframe for site-relative pages).',
    `- Vary the rhythm: the neighbouring slides use [${(ctx.recentLayouts ?? []).join(', ') || 'none yet'}] — prefer a DIFFERENT layout and a different alignment when the content allows.`,
    '',
    `Layouts: ${layoutDocsForLLM()}`,
    '',
    `Blocks: ${Object.entries(BLOCK_DOCS)
      .map(([k, v]) => `${k} — ${v}`)
      .join(' | ')}`,
    '',
    'If ATTACHED BLOCKS are provided they are pre-built and must appear in your blocks array VERBATIM (do not edit them); choose the layout and any companion text around them.',
    '',
    'Respond with ONLY a JSON object: {"title": string|null, "layout": string, "blocks": Block[]}. No markdown fences, no commentary.',
  ].join('\n');
}

/** Deterministic editorial guardrails over the LLM's output. A quote that is
 *  really a paragraph becomes prose; one that is really a claim becomes an
 *  aligned headline (the documented misuse mode we correct, not reject). */
function applyEditorialGuardrails(slide: ComposedSlide, ctx: ComposeContext): ComposedSlide {
  let layout = slide.layout;
  const blocks = slide.blocks.map((b): Block => {
    if (b.type !== 'quote') return b;
    const q = b as QuoteBlock;
    const isQuotation = Boolean(q.attribution) || /^["“]/.test(q.text.trim());
    if (q.text.length <= 140 || isQuotation) return b;
    if (q.text.length <= 180) {
      if (layout === 'statement') layout = pickStatementLayout(ctx.recentLayouts);
      return { type: 'headline', text: q.text.replace(/\.$/, '') };
    }
    return { type: 'prose', body: `**${q.text}**`, lede: true };
  });
  if (layout === 'statement' && blocks.some((b) => b.type === 'headline')) {
    layout = pickStatementLayout(ctx.recentLayouts);
  }
  return { ...slide, layout, blocks };
}

/** Attached picker blocks are a contract: if the LLM dropped or edited one,
 *  append the original (dedupe by exact JSON). */
function enforceAttached(slide: ComposedSlide, attached: Block[]): ComposedSlide {
  if (!attached.length) return slide;
  const have = new Set(slide.blocks.map((b) => JSON.stringify(b)));
  const missing = attached.filter((b) => !have.has(JSON.stringify(b)));
  return missing.length ? { ...slide, blocks: [...slide.blocks, ...missing] } : slide;
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
  const attached = input.attachedBlocks ?? [];
  const userContent = [
    ctx.deckTitle ? `Deck: "${ctx.deckTitle}"` : null,
    input.text?.trim() ? `CONTENT:\n${input.text.trim()}` : null,
    input.mediaUrls?.length ? `MEDIA URLS:\n${input.mediaUrls.join('\n')}` : null,
    attached.length ? `ATTACHED BLOCKS (include verbatim):\n${JSON.stringify(attached)}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const completion = await resilientChatCompletion(ART_DIRECTOR_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt(ctx) },
        { role: 'user', content: userContent },
      ],
      temperature: 0.4,
      // GLM burns reasoning tokens from max_tokens — keep the ceiling generous
      // (see feedback_glm_reasoning_tokens; 5.2 reasons more than 5.1).
      max_tokens: 4000,
      response_format: { type: 'json_object' },
    }, { fallbackModel: ART_DIRECTOR_FALLBACK });
    const text = completion.choices[0]?.message?.content ?? '';
    const slide = parseLLMSlide(text);
    if (slide) {
      const final = enforceAttached(applyEditorialGuardrails(slide, ctx), attached);
      // Guardrails only ever swap block types/layouts inside the registry, but
      // re-validate so a bug here can never store an invalid slide.
      if (validateBlocks(final.blocks).ok) return { slide: final, source: 'llm' };
    }
    console.warn('[decks composer] LLM output failed validation — using heuristic');
  } catch (err) {
    console.warn('[decks composer] LLM unavailable — using heuristic:', err instanceof Error ? err.message : err);
  }
  return { slide: composeHeuristic(input, { recentLayouts: ctx.recentLayouts }), source: 'heuristic' };
}
