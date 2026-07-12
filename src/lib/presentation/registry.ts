// Block registry — zod schema + LLM-facing doc per block type. Server-safe
// (no Svelte imports); the component map lives in
// $lib/components/presentation/block-components.ts. Same registry shape as the
// workflow node registry: one place the editor, the player, the jkai tool and
// validation all agree on.

import { z } from 'zod';
import { sankeyDepths } from './chartkit';
import { EMBEDS } from './embeds';
import type { BlockType } from './types';

const statSchema = z.object({ n: z.string().min(1), label: z.string().min(1) }).strict();

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
    })
    .strict(),
  headline: z
    .object({
      type: z.literal('headline'),
      kicker: z.string().optional(),
      text: z.string().min(1).max(160),
      dek: z.string().optional(),
      align: z.enum(['left', 'center', 'right']).optional(),
    })
    .strict(),
  prose: z
    .object({
      type: z.literal('prose'),
      body: z.string().min(1),
      lede: z.boolean().optional(),
      style: z.enum(['body', 'lede', 'band', 'cards', 'aside', 'pull', 'columns', 'callout']).optional(),
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
    })
    .strict(),
  statRow: z
    .object({
      type: z.literal('statRow'),
      stats: z.array(statSchema).min(1).max(6),
    })
    .strict(),
  quote: z
    .object({
      type: z.literal('quote'),
      text: z.string().min(1),
      attribution: z.string().optional(),
      url: z.string().optional(),
    })
    .strict(),
  timeline: z
    .object({
      type: z.literal('timeline'),
      items: z
        .array(z.object({ year: z.string().min(1), label: z.string().min(1), detail: z.string().optional() }).strict())
        .min(2)
        .max(12),
    })
    .strict(),
  image: z
    .object({
      type: z.literal('image'),
      src: z.string().min(1),
      alt: z.string().min(1),
      caption: z.string().optional(),
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
  embed: z
    .object({
      type: z.literal('embed'),
      embed: z.string().min(1),
      config: z.record(z.string(), z.unknown()).optional(),
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
    })
    .strict(),
};

/** One-liner per block type, consumed by the phase-2 jkai tool description. */
export const BLOCK_DOCS: Record<BlockType, string> = {
  masthead: 'Title slide header: { kicker?, title, thesis?, asks?: string[] }. Use once, usually slide 1.',
  headline:
    'Editorial statement headline — the bold assertive-fact page: { kicker? (mono eyebrow), text (the statement, ≤12 words, sentence case, no full stop), dek? (one-line support), align?: left|center|right (default left) }. Use for a claim or fact stated with authority; pair with statement-left/statement-right layouts.',
  prose:
    'Editorial text: { body (markdown-lite: # …#### headings, **bold**, *italic*, __underline__, "- " bullet lines, [text](url), blank-line paragraphs), style?: body|lede|band|cards|aside|pull|columns|callout }. Styles — lede: large opening type; band: full-width INVERTED emphasis band for short rhythmic creeds ("Refusal. Auditability. Blast radius." — an *italic* line renders amber); cards: each paragraph becomes a bordered card (bold opener = card title) for detail-dense content instead of long paragraphs; aside: small mono footnote/source note; pull: oversized italic pull-text between hairlines (a line worth lingering on that is NOT a quotation); columns: body flowed into two columns for dense reference text; callout: a tinted petrol note box (bold opener = its title) for warnings/key takeaways.',
  bigNumber: 'One huge count-up numeral: { value: number, label, unit?, sub?, dp? }.',
  statRow: 'Row of 1-6 stat chips: { stats: [{ n: preformatted string, label }] }.',
  quote:
    'Pull quote for a REAL quotation or aphorism ONLY: { text (≤140 chars — never a paragraph; long text belongs in prose, assertive claims in headline), attribution?, url? }.',
  timeline: 'Vertical timeline of 2-12 moments: { items: [{ year, label, detail? }] }.',
  image: 'Figure: { src, alt, caption? }.',
  chart:
    'Bespoke SVG chart: { kind: line|bar|area|scatter|slope|donut|sankey, title?, xLabel?, yLabel? }. Data by kind — line/bar/area/scatter: series: [{label, points:[{x,y}]}] (max 5; xLabels?: string[] names distinct x ranks for bar); slope: series with 2 points each (before→after; xLabels = the two ends); donut: segments: [{label, value}] (2-8 shares of a whole); sankey: flows: [{from, to, value}] (acyclic; shows allocation/movement between named stages). Pick: trend→line/area, comparison→bar, before/after→slope, share-of-whole→donut, correlation→scatter, flow/allocation→sankey.',
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
