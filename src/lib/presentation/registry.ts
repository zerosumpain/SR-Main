// Block registry — zod schema + LLM-facing doc per block type. Server-safe
// (no Svelte imports); the component map lives in
// $lib/components/presentation/block-components.ts. Same registry shape as the
// workflow node registry: one place the editor, the player, the jkai tool and
// validation all agree on.

import { z } from 'zod';
import { sankeyDepths } from './chartkit';
import { EFFECTS } from './effects';
import { EMBEDS } from './embeds';
import { PROSE_STYLES, PROSE_STYLE_IDS, QUOTE_STYLES, QUOTE_STYLE_IDS, styleDocsForLLM } from './styles';
import { parseVideoSrc } from './video';
import type { BlockType } from './types';

const statSchema = z.object({ n: z.string().min(1), label: z.string().min(1) }).strict();

/** Build step — every content block may stage itself behind N forward presses. */
const STEP = z.number().int().min(1).max(12).optional();

const seriesSchema = z
  .array(
    z
      .object({
        label: z.string().min(1),
        points: z.array(z.object({ x: z.number(), y: z.number() }).strict()).min(1),
      })
      .strict(),
  )
  .min(1)
  .max(5);

/** Chart kinds that read `series` (everything except donut/sankey). */
const SERIES_KINDS = new Set(['line', 'bar', 'area', 'scatter', 'slope']);

export const BLOCK_SCHEMAS: Record<BlockType, z.ZodTypeAny> = {
  masthead: z
    .object({
      type: z.literal('masthead'),
      kicker: z.string().optional(),
      title: z.string().min(1),
      thesis: z.string().optional(),
      asks: z.array(z.string().min(1)).optional(),
      step: STEP,
    })
    .strict(),
  headline: z
    .object({
      type: z.literal('headline'),
      kicker: z.string().optional(),
      text: z.string().min(1).max(160),
      dek: z.string().optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
      step: STEP,
    })
    .strict(),
  prose: z
    .object({
      type: z.literal('prose'),
      body: z.string().min(1),
      lede: z.boolean().optional(),
      style: z.enum(PROSE_STYLE_IDS as [string, ...string[]]).optional(),
      step: STEP,
    })
    .strict(),
  bigNumber: z
    .object({
      type: z.literal('bigNumber'),
      value: z.number(),
      label: z.string().min(1),
      unit: z.string().optional(),
      sub: z.string().optional(),
      dp: z.number().int().min(0).max(3).optional(),
      step: STEP,
    })
    .strict(),
  statRow: z
    .object({
      type: z.literal('statRow'),
      stats: z.array(statSchema).min(1).max(6),
      step: STEP,
    })
    .strict(),
  quote: z
    .object({
      type: z.literal('quote'),
      text: z.string().min(1),
      attribution: z.string().optional(),
      url: z.string().optional(),
      style: z.enum(QUOTE_STYLE_IDS as [string, ...string[]]).optional(),
      step: STEP,
    })
    .strict(),
  timeline: z
    .object({
      type: z.literal('timeline'),
      items: z
        .array(z.object({ year: z.string().min(1), label: z.string().min(1), detail: z.string().optional() }).strict())
        .min(2)
        .max(12),
      step: STEP,
    })
    .strict(),
  image: z
    .object({
      type: z.literal('image'),
      src: z.string().min(1),
      alt: z.string().min(1),
      caption: z.string().optional(),
      step: STEP,
    })
    .strict(),
  chart: z
    .object({
      type: z.literal('chart'),
      kind: z.enum(['line', 'bar', 'area', 'scatter', 'slope', 'donut', 'sankey']),
      title: z.string().optional(),
      series: seriesSchema.optional(),
      segments: z
        .array(z.object({ label: z.string().min(1), value: z.number().nonnegative() }).strict())
        .min(2)
        .max(8)
        .optional(),
      flows: z
        .array(
          z.object({ from: z.string().min(1), to: z.string().min(1), value: z.number().positive() }).strict(),
        )
        .min(1)
        .max(24)
        .optional(),
      xLabel: z.string().optional(),
      yLabel: z.string().optional(),
      xLabels: z.array(z.string()).optional(),
      step: STEP,
    })
    .strict()
    .superRefine((val, ctx) => {
      if (SERIES_KINDS.has(val.kind)) {
        if (!val.series?.length) {
          ctx.addIssue({ code: 'custom', message: `kind "${val.kind}" requires series` });
        } else if (val.kind === 'slope' && val.series.some((s) => s.points.length < 2)) {
          ctx.addIssue({ code: 'custom', message: 'slope charts need ≥2 points per series (first vs last)' });
        }
      }
      if (val.kind === 'donut' && !val.segments?.length) {
        ctx.addIssue({ code: 'custom', message: 'kind "donut" requires segments: [{label, value}]' });
      }
      if (val.kind === 'sankey') {
        if (!val.flows?.length) {
          ctx.addIssue({ code: 'custom', message: 'kind "sankey" requires flows: [{from, to, value}]' });
        } else if (!sankeyDepths(val.flows)) {
          ctx.addIssue({ code: 'custom', message: 'sankey flows must be acyclic (a→b→a is a cycle)' });
        }
      }
    }),
  code: z
    .object({
      type: z.literal('code'),
      code: z.string().min(1).max(4000),
      lang: z.string().max(30).optional(),
      title: z.string().max(120).optional(),
      caption: z.string().optional(),
      step: STEP,
    })
    .strict(),
  video: z
    .object({
      type: z.literal('video'),
      src: z.string().min(1),
      caption: z.string().optional(),
      autoplay: z.boolean().optional(),
      loop: z.boolean().optional(),
      poster: z.string().optional(),
      step: STEP,
    })
    .strict()
    .superRefine((val, ctx) => {
      if (!parseVideoSrc(val.src)) {
        ctx.addIssue({
          code: 'custom',
          message: 'video src must be a site-relative .mp4/.webm file or a YouTube/Vimeo URL',
        });
      }
    }),
  effect: z
    .object({
      type: z.literal('effect'),
      effect: z.string().min(1),
      role: z.enum(['background', 'transition']),
      intensity: z.number().min(0.1).max(1).optional(),
      tint: z.enum(['ink', 'accent', 'petrol']).optional(),
    })
    .strict()
    .superRefine((val, ctx) => {
      const def = EFFECTS[val.effect];
      if (!def) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown effect "${val.effect}" — registered: ${Object.keys(EFFECTS).join(', ')}`,
        });
        return;
      }
      if (!def.roles.includes(val.role)) {
        ctx.addIssue({ code: 'custom', message: `effect "${val.effect}" cannot play role "${val.role}" (allowed: ${def.roles.join(', ')})` });
      }
    }),
  embed: z
    .object({
      type: z.literal('embed'),
      embed: z.string().min(1),
      config: z.record(z.string(), z.unknown()).optional(),
      step: STEP,
    })
    .strict()
    .superRefine((val, ctx) => {
      const def = EMBEDS[val.embed];
      if (!def) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown embed "${val.embed}" — registered: ${Object.keys(EMBEDS).join(', ')}`,
        });
        return;
      }
      const parsed = def.configSchema.safeParse(val.config ?? {});
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: `embed config: ${parsed.error.issues.map((i) => i.message).join('; ')}` });
      }
    }),
  iframe: z
    .object({
      type: z.literal('iframe'),
      // Site-relative ONLY. "//host" is protocol-relative (external!) and "/\"
      // gets browser-normalized to "//" — both must fail, not just non-"/".
      src: z
        .string()
        .min(1)
        .regex(/^\/(?!\/|\\)/, { message: 'iframe src must be a site-relative URL (start with /, not // or /\\)' }),
      title: z.string().min(1),
      height: z.number().int().min(120).max(2000).optional(),
      step: STEP,
    })
    .strict(),
};

/** One-liner per block type, consumed by the phase-2 jkai tool description. */
export const BLOCK_DOCS: Record<BlockType, string> = {
  masthead: 'Title slide header: { kicker?, title, thesis?, asks?: string[] }. Use once, usually slide 1.',
  headline:
    'Editorial statement headline — the bold assertive-fact page: { kicker? (mono eyebrow), text (the statement, ≤12 words, sentence case, no full stop), dek? (one-line support), align?: left|center|right (default left) }. Use for a claim or fact stated with authority; pair with statement-left/statement-right layouts.',
  prose: `Editorial text: { body (markdown-lite: # …#### headings, **bold**, *italic*, __underline__, "- " bullet lines, [text](url), blank-line paragraphs), style?: ${PROSE_STYLE_IDS.join('|')} }. Styles — ${styleDocsForLLM(PROSE_STYLES)}.`,
  bigNumber: 'One huge count-up numeral: { value: number, label, unit?, sub?, dp? }.',
  statRow: 'Row of 1-6 stat chips: { stats: [{ n: preformatted string, label }] }.',
  quote: `Pull quote for a REAL quotation or aphorism ONLY: { text (≤140 chars — never a paragraph; long text belongs in prose, assertive claims in headline), attribution?, url?, style?: ${QUOTE_STYLE_IDS.join('|')} }. Styles — ${styleDocsForLLM(QUOTE_STYLES)}.`,
  timeline: 'Vertical timeline of 2-12 moments: { items: [{ year, label, detail? }] }.',
  image: 'Figure: { src, alt, caption? }.',
  chart:
    'Bespoke SVG chart: { kind: line|bar|area|scatter|slope|donut|sankey, title?, xLabel?, yLabel? }. Data by kind — line/bar/area/scatter: series: [{label, points:[{x,y}]}] (max 5; xLabels?: string[] names distinct x ranks for bar); slope: series with 2 points each (before→after; xLabels = the two ends); donut: segments: [{label, value}] (2-8 shares of a whole); sankey: flows: [{from, to, value}] (acyclic; shows allocation/movement between named stages). Pick: trend→line/area, comparison→bar, before/after→slope, share-of-whole→donut, correlation→scatter, flow/allocation→sankey.',
  code: 'Syntax-highlighted source panel: { code (keep snippets ≤20 lines), lang? (shiki id: ts|python|bash|json|sql|yaml…), title? (mono header, usually a filename), caption? }. A visual block — pairs well with split layouts (argument beside code).',
  video:
    'Motion figure: { src (a site-relative .mp4/.webm — e.g. an uploaded /api/blog/images/deck-media/… file — OR a YouTube/Vimeo URL, rendered as a privacy-enhanced embed), caption?, autoplay? (file videos, plays muted), loop?, poster? }.',
  effect: `Atmosphere layer: { effect: name, role: "background"|"transition", intensity?: 0.1-1 (default 0.5), tint?: ink|accent|petrol }. role background renders BEHIND the slide's content; role transition plays as the camera moves INTO the slide. At most one background effect per slide, used sparingly. Registered: ${Object.keys(
    EFFECTS,
  )
    .map((k) => `"${k}" (${EFFECTS[k].doc}; roles: ${EFFECTS[k].roles.join('/')})`)
    .join('; ')}`,
  embed: `Registered interactive: { embed: name, config? }. Registered: ${Object.keys(EMBEDS)
    .map((k) => `"${k}" (${EMBEDS[k].doc})`)
    .join('; ')}`,
  iframe: 'Embed an existing site page: { src: site-relative URL, title, height? }.',
};

/**
 * Validate an untrusted jsonb `blocks` payload. Returns human-readable,
 * path-labelled issues (empty when ok) — the shape both the editor and the
 * jkai tool surface directly.
 */
export function validateBlocks(blocks: unknown): { ok: boolean; issues: string[] } {
  if (!Array.isArray(blocks)) return { ok: false, issues: ['blocks must be an array'] };
  const issues: string[] = [];
  blocks.forEach((raw, i) => {
    const type = (raw as { type?: unknown })?.type;
    if (typeof type !== 'string' || !(type in BLOCK_SCHEMAS)) {
      issues.push(`blocks[${i}]: unknown block type "${String(type)}" — known: ${Object.keys(BLOCK_SCHEMAS).join(', ')}`);
      return;
    }
    const parsed = BLOCK_SCHEMAS[type as BlockType].safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
        issues.push(`blocks[${i}] (${type}): ${path}${issue.message}`);
      }
    }
  });
  return { ok: issues.length === 0, issues };
}
