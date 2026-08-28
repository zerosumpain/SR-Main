// The slide art director. Raw content in (text + media links + picker-attached
// blocks), one composed slide out: an LLM (through the resilient workflow
// gateway — timeout, primary→fallback failover, concurrency cap) chooses the
// most impactful layout and blocks; the deterministic heuristic composes
// instead whenever the LLM is unavailable or returns something the registry
// rejects. Every output passes the same validation gate the editor and jkai
// tools use.

import { resilientChatCompletion } from '$lib/llm/workflow-gateway';
import { withActivity } from '$lib/context/activity';
import {
  composeHeuristic,
  pickStatementLayout,
  type ComposedSlide,
  type ComposeInput,
} from '$lib/presentation/compose-heuristic';
import { fitIssues } from '$lib/presentation/fit';
import { isLayout, layoutDocsForLLM } from '$lib/presentation/layouts';
import { BLOCK_DOCS, BLOCK_SCHEMAS, validateBlocks } from '$lib/presentation/registry';
import type { Block, QuoteBlock } from '$lib/presentation/types';

/** Art direction is a one-shot composition, not an agentic loop, so a slower
 *  higher-quality model earns its latency here where the agentic roles cannot
 *  afford it. Settable from the model picker as the `art-director` workload;
 *  DEFAULT_ART_DIRECTOR_MODEL_ID is the fallback. Resolved per call rather than
 *  captured at module load, or a change would need a restart to take effect. */
async function artDirectorModel(): Promise<string> {
  const { resolveArtDirectorModel } = await import('$lib/server/models/workload-settings');
  return (await resolveArtDirectorModel()).modelId;
}

export interface ComposeContext {
  deckTitle?: string;
  /** Layouts of the neighbouring slides, so the composer varies the rhythm. */
  recentLayouts?: string[];
}

const craftRules = (ctx: ComposeContext): string[] => [
    'Editorial craft (non-negotiable):',
    '- Whitespace is the loudest signal of importance. Fewer, bigger elements: 1–3 blocks. Never fill the page.',
    '- The page is a FIXED 1280×720 canvas — nothing scrolls; overflow is CUT OFF. Never compose more than fits: roughly 120 words of body prose on a full page, HALF that beside a visual or at statement scale; a chart, image or embed leaves room for only ~40 words beside it. When the content is too much, do NOT overfill — tighten the words, choose a denser register (columns/ledger/cards), or split it across two slides.',
    '- An assertive fact or claim = a headline block (kicker → ≤12-word statement, sentence case, no full stop → optional one-line dek) on a statement-left or statement-right layout. Ragged, aligned display type beats centered text — reserve centered `statement` for openings and codas.',
    '- Format rules by block: masthead (title/section-opener) slides take `center` — NEVER statement-left/right. An aligned statement page carries exactly ONE dominant element (headline, bigNumber or short quote), nothing else.',
    '- quote is for REAL quotations and aphorisms only, ≤140 characters. A paragraph is prose (style "lede" for the opening); a claim is a headline. NEVER pour long text into a quote.',
    '- Prose styles are presets — choose deliberately: a short rhythmic creed ("Refusal. Auditability. Blast radius.") → style "band" (inverted emphasis band, add an *italic* second line) or "manifesto" (huge display lines on paper — lighter than the band); three-or-more parallel points of detail → style "cards" (each paragraph a card opened by a **bold title**) instead of a wall of text; an ordered argument or phases → "numbered" (bold opener = step title); specifications or facts-at-a-glance → "ledger" (each row opens with a **bold label**); a Q&A exchange → "interview" (bold speaker opener; question/answer paragraphs alternate); a line worth lingering on that is NOT a quotation → "pull"; a lyrical or reflective passage → "verse"; dense reference text → "columns"; a warning or key takeaway → "callout" (bold opener = its title); commitments kept or what ships → "checklist" ("- " lines render ticked); sources/footnotes → style "aside". Bullet lists: lines starting "- ".',
    '- Quote styles: "rail" (default) for a quote inside a busier page; "pull" when the quotation IS the page (one quote on a statement layout); "boxed" for a documentary aside beside other content.',
    '- A number worth feeling goes in bigNumber. Several figures go in statRow.',
    '- Charts: trend→line/area, comparison→bar, before/after→slope, share-of-whole→donut, correlation→scatter, flow/allocation→sankey.',
    '- Atmosphere (effect blocks) is seasoning, not sauce: at most ONE background effect on a slide that earns it, and only where the metaphor fits — heartbeat behind living data, starfield behind a vast number, drift behind a quiet statement, plexus behind networks/federation, currents behind movement and flows, orbits behind cycles and the long view, sea behind calm scale, murmuration behind coordination/collective behaviour, rain behind patience/weathering, meteors behind sudden change, phyllotaxis behind growth/compounding, halftone/letterpress/scribe/ridgeline/grain behind print-language-and-archive material. Transition wipes (melt, shatter, inkbleed, slats, dissolve, iris, erode) only on chapter openers — never on consecutive slides; melt and shatter are the boldest, at most once or twice per deck; slats and iris are the lightest.',
    '- Photography is editorial material, not decoration: a dramatic image can BE the page (poster — image + short masthead); a documentary image sits beside its argument (split/split-flip with prose). NEVER discard an image\'s caption — it carries the photographer\'s credit and licence.',
    '- Code is editorial material too: a short snippet (≤20 lines) that carries the argument goes in a code block (lang + a filename title), usually on a split layout beside its prose. Video: a video block takes a YouTube/Vimeo URL or a site-hosted file; prefer full-bleed or split layouts.',
    '- Build steps: any content block may carry step: N (1–12) — it stays hidden until the presenter\'s Nth forward press. Use SPARINGLY for a staged argument (reveal 2–3 points one press at a time on ONE slide, steps 1, 2, 3…); never stage a whole deck.',
    '- Reformat and tighten the given content. NEVER invent facts, numbers or quotes that are not in it.',
    '- Every provided media URL must appear as an image block (or iframe for site-relative pages).',
    `- Vary the rhythm: the neighbouring slides use [${(ctx.recentLayouts ?? []).join(', ') || 'none yet'}] — prefer a DIFFERENT layout and a different alignment when the content allows.`,
    '',
    `Layouts: ${layoutDocsForLLM()}`,
    '',
    `Blocks: ${Object.entries(BLOCK_DOCS)
      .map(([k, v]) => `${k} — ${v}`)
      .join(' | ')}`,
];

const RESPONSE_SHAPE =
  'Respond with ONLY a JSON object: {"title": string|null, "layout": string, "blocks": Block[]} — or, ONLY when the content genuinely needs two pages, {"slides": [slide, slide]} (max 2, each complete in that shape). Every block object MUST include its "type" field, e.g. {"type": "headline", "kicker": "...", "text": "..."}. No markdown fences, no commentary.';

function systemPrompt(ctx: ComposeContext): string {
  return [
    'You are the art director for sr. decks — bold, editorial presentation slides (Fraunces serif, paper-and-ink).',
    'Given raw content, compose EXACTLY ONE slide: pick the most impactful layout and typed blocks.',
    '',
    ...craftRules(ctx),
    '',
    'If ATTACHED BLOCKS are provided they are pre-built and must appear in your blocks array VERBATIM (do not edit them); choose the layout and any companion text around them.',
    '',
    RESPONSE_SHAPE,
  ].join('\n');
}

function revisePrompt(ctx: ComposeContext): string {
  return [
    'You are the art director for sr. decks — bold, editorial presentation slides (Fraunces serif, paper-and-ink).',
    'You are given ONE existing slide (as JSON) and an instruction. Return the REVISED slide.',
    '',
    'Revision discipline:',
    '- Lightest touch wins: every block the instruction does not concern must come back VERBATIM (identical JSON), in the same order.',
    '- Change the layout only if the instruction asks for it, or the revised content clearly demands a different one.',
    '- Keep the slide title unless asked to change it.',
    '- NEVER invent facts, numbers or quotes that are not in the slide or the instruction.',
    '- The revised slide must still FIT the fixed page. If the instruction adds content, make room: tighten other text or switch to a denser register. You CANNOT split into two slides here — condense instead.',
    '',
    // "Vary the rhythm" would nudge the reviser toward gratuitous layout swaps.
    ...craftRules(ctx).filter((l) => !l.startsWith('- Vary the rhythm')),
    '',
    RESPONSE_SHAPE,
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
 *  append the original to the last slide (dedupe by exact JSON). */
function enforceAttached(slides: ComposedSlide[], attached: Block[]): ComposedSlide[] {
  if (!attached.length) return slides;
  const have = new Set(slides.flatMap((s) => s.blocks.map((b) => JSON.stringify(b))));
  const missing = attached.filter((b) => !have.has(JSON.stringify(b)));
  if (!missing.length) return slides;
  const last = slides[slides.length - 1];
  return [...slides.slice(0, -1), { ...last, blocks: [...last.blocks, ...missing] }];
}

function normalizeSlide(obj: { title?: unknown; layout?: unknown; blocks?: unknown }): ComposedSlide | null {
  if (!Array.isArray(obj.blocks) || obj.blocks.length === 0 || obj.blocks.length > 6) {
    console.warn('[decks composer] LLM slide had no usable blocks array');
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

/** Parse the LLM reply into 1–2 slides — a bare slide object, or the
 *  {"slides":[…]} split form the fit rule allows. */
function parseLLMSlides(raw: string): ComposedSlide[] | null {
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
  const obj = parsed as { slides?: unknown };
  const rawSlides = Array.isArray(obj.slides) && obj.slides.length ? obj.slides.slice(0, 2) : [parsed];
  const slides = rawSlides.map((s) => normalizeSlide(s as { title?: unknown; layout?: unknown; blocks?: unknown }));
  return slides.every((s): s is ComposedSlide => s !== null) ? slides : null;
}

export async function composeSlide(
  input: ComposeInput,
  ctx: ComposeContext = {},
): Promise<{ slides: ComposedSlide[]; source: 'llm' | 'heuristic' }> {
  const attached = input.attachedBlocks ?? [];
  const userContent = [
    ctx.deckTitle ? `Deck: "${ctx.deckTitle}"` : null,
    input.text?.trim() ? `CONTENT:\n${input.text.trim()}` : null,
    input.mediaUrls?.length ? `MEDIA URLS:\n${input.mediaUrls.join('\n')}` : null,
    attached.length ? `ATTACHED BLOCKS (include verbatim):\n${JSON.stringify(attached)}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt(ctx) },
    { role: 'user', content: userContent },
  ];
  // Fit gate: one corrective round-trip when the estimator says the page
  // overflows. A still-overfull retry beats the heuristic, so keep the best.
  let best: ComposedSlide[] | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = '';
    try {
      const artDirector = await artDirectorModel();
      const completion = await withActivity('art-director', () =>
        resilientChatCompletion(artDirector, {
          messages,
          temperature: 0.4,
          // GLM burns reasoning tokens from max_tokens and 5.2 reasons hard — an
          // undersized ceiling comes back as EMPTY content after ~30s of thinking
          // (see feedback_glm_reasoning_tokens). Keep this very generous.
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        }, { fallbackModel: artDirector }),
      );
      text = completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      console.warn('[decks composer] LLM unavailable:', err instanceof Error ? err.message : err);
      break;
    }
    const parsed = parseLLMSlides(text);
    if (!parsed) break;
    const finals = enforceAttached(parsed.map((s) => applyEditorialGuardrails(s, ctx)), attached);
    // Guardrails only ever swap block types/layouts inside the registry, but
    // re-validate so a bug here can never store an invalid slide.
    if (!finals.every((f) => validateBlocks(f.blocks).ok)) break;
    const issues = finals.flatMap((f, i) => fitIssues(f.layout, f.blocks).map((m) => `slide ${i + 1}: ${m}`));
    if (!issues.length) return { slides: finals, source: 'llm' };
    best = finals;
    messages.push(
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `Your composition overflows the fixed page — ${issues.join('; ')}. Return a corrected version: tighten the text, use a denser register, or split into {"slides": [...]} (max 2).`,
      },
    );
  }
  if (best) {
    console.warn('[decks composer] still estimated overfull after fit retry — accepting best effort');
    return { slides: best, source: 'llm' };
  }
  console.warn('[decks composer] LLM output failed validation — using heuristic');
  return { slides: [composeHeuristic(input, { recentLayouts: ctx.recentLayouts })], source: 'heuristic' };
}

/** LLM revision of an existing slide. Unlike composeSlide there is no
 *  deterministic fallback — an arbitrary instruction cannot be applied
 *  heuristically, so failure returns null and the caller reports it. */
export async function reviseSlide(
  current: { title: string | null; layout: string; blocks: Block[] },
  instruction: string,
  mediaUrls: string[] = [],
  ctx: ComposeContext = {},
): Promise<ComposedSlide | null> {
  const userContent = [
    ctx.deckTitle ? `Deck: "${ctx.deckTitle}"` : null,
    `CURRENT SLIDE:\n${JSON.stringify(current)}`,
    `INSTRUCTION:\n${instruction.trim()}`,
    mediaUrls.length ? `MEDIA URLS (each must appear as an image block, or iframe for site-relative pages):\n${mediaUrls.join('\n')}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: revisePrompt(ctx) },
    { role: 'user', content: userContent },
  ];
  // Same fit gate as composeSlide, but a revision can never split — the
  // corrective retry asks for condensing only.
  let best: ComposedSlide | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = '';
    try {
      const artDirector = await artDirectorModel();
      const completion = await withActivity('art-director', () =>
        resilientChatCompletion(artDirector, {
          messages,
          temperature: 0.3,
          // Same generous ceiling as composeSlide — GLM reasoning burns from it.
          max_tokens: 8000,
          response_format: { type: 'json_object' },
        }, { fallbackModel: artDirector }),
      );
      text = completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      console.warn('[decks composer] revise LLM unavailable:', err instanceof Error ? err.message : err);
      break;
    }
    const parsed = parseLLMSlides(text)?.[0];
    if (!parsed) break;
    const final = applyEditorialGuardrails(parsed, ctx);
    if (!validateBlocks(final.blocks).ok) {
      console.warn('[decks composer] revise output failed validation');
      break;
    }
    // A revision keeps the slide's title unless the LLM deliberately set one.
    const slide = { ...final, title: final.title ?? current.title };
    const issues = fitIssues(slide.layout, slide.blocks);
    if (!issues.length) return slide;
    best = slide;
    messages.push(
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `Your revision overflows the fixed page — ${issues.join('; ')}. Return a corrected revision: tighten the text or use a denser register (you cannot split into two slides).`,
      },
    );
  }
  if (best) console.warn('[decks composer] revise still estimated overfull after fit retry — accepting best effort');
  return best;
}
