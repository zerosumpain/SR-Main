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
import { BLOCK_DOCS, BLOCK_SCHEMAS, validateBlocks } from '$lib/presentation/registry';
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
    '- Format rules by block: masthead (title/section-opener) slides take `center` — NEVER statement-left/right. An aligned statement page carries exactly ONE dominant element (headline, bigNumber or short quote), nothing else.',
    '- quote is for REAL quotations and aphorisms only, ≤140 characters. A paragraph is prose (style "lede" for the opening); a claim is a headline. NEVER pour long text into a quote.',
    '- Prose styles are presets — choose deliberately: a short rhythmic creed ("Refusal. Auditability. Blast radius.") → style "band" (inverted emphasis band, add an *italic* second line); three-or-more parallel points of detail → style "cards" (each paragraph a card opened by a **bold title**) instead of a wall of text; a line worth lingering on that is NOT a quotation → "pull"; dense reference text → "columns"; a warning or key takeaway → "callout" (bold opener = its title); sources/footnotes → style "aside". Bullet lists: lines starting "- ".',
    '- A number worth feeling goes in bigNumber. Several figures go in statRow.',
    '- Charts: trend→line/area, comparison→bar, before/after→slope, share-of-whole→donut, correlation→scatter, flow/allocation→sankey.',
    '- Photography is editorial material, not decoration: a dramatic image can BE the page (poster — image + short masthead); a documentary image sits beside its argument (split/split-flip with prose). NEVER discard an image\'s caption — it carries the photographer\'s credit and licence.',
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
    'Respond with ONLY a JSON object: {"title": string|null, "layout": string, "blocks": Block[]}. Every block object MUST include its "type" field, e.g. {"type": "headline", "kicker": "...", "text": "..."}. No markdown fences, no commentary.',
  ].join('\n');
}

/** Known LLM drift: blocks arriving without a "type" field (GLM 5.2 does this
 *  on the OpenRouter path) or wrapped as {"headline": {...}}. Repair the
 *  unambiguous shapes; anything still wrong dies in validateBlocks as before. */
function repairBlock(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const b = raw as Record<string, unknown>;
  if (typeof b.type === 'string') return b;
  const keys = Object.keys(b);
  if (keys.length === 1 && keys[0] in BLOCK_SCHEMAS && typeof b[keys[0]] === 'object' && b[keys[0]] !== null) {
    return { type: keys[0], ...(b[keys[0]] as Record<string, unknown>) };
  }
  const has = (k: string) => k in b;
  if (has('stats')) return { type: 'statRow', ...b };
  if (has('items')) return { type: 'timeline', ...b };
  if (has('embed')) return { type: 'embed', ...b };
  if (has('kind') && (has('series') || has('segments') || has('flows'))) return { type: 'chart', ...b };
  if (has('src') && has('alt')) return { type: 'image', ...b };
  if (has('src') && has('title')) return { type: 'iframe', ...b };
  if (has('value') && has('label')) return { type: 'bigNumber', ...b };
  if (has('body')) return { type: 'prose', ...b };
  if (has('title') && (has('thesis') || has('asks') || has('kicker'))) return { type: 'masthead', ...b };
  if (has('text') && has('attribution')) return { type: 'quote', ...b };
  if (has('text')) return { type: 'headline', ...b };
  return b;
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
  // Title slides never rag against a half page — mastheads take center.
  if ((layout === 'statement-left' || layout === 'statement-right') && blocks.some((b) => b.type === 'masthead')) {
    layout = 'center';
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
  // The OpenRouter failover path strips response_format (some providers reject
  // it), and reasoning models then wrap the JSON in prose/fences — extract the
  // outermost object instead of requiring a bare JSON reply.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    console.warn(`[decks composer] no JSON object in LLM reply (${cleaned.length} chars):`, cleaned.slice(0, 200));
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    console.warn('[decks composer] unparseable LLM reply head:', cleaned.slice(0, 200));
    return null;
  }
  const obj = parsed as { title?: unknown; layout?: unknown; blocks?: unknown };
  if (!Array.isArray(obj.blocks) || obj.blocks.length === 0 || obj.blocks.length > 6) {
    console.warn('[decks composer] LLM reply had no usable blocks array');
    return null;
  }
  const blocks = obj.blocks.map(repairBlock);
  const check = validateBlocks(blocks);
  if (!check.ok) {
    console.warn('[decks composer] LLM blocks rejected:', check.issues.join('; '));
    return null;
  }
  return {
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 120) : null,
    layout: isLayout(obj.layout) ? obj.layout : 'default',
    blocks: blocks as Block[],
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
      // GLM burns reasoning tokens from max_tokens and 5.2 reasons hard — an
      // undersized ceiling comes back as EMPTY content after ~30s of thinking
      // (see feedback_glm_reasoning_tokens). Keep this very generous.
      max_tokens: 8000,
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
