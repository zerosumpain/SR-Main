// Deterministic slide composition — the fallback art director. Given raw
// text and/or media links, produce a bold, valid slide without an LLM:
// punchy line → statement/quote, leading number → bigNumber, "n — label"
// lines → statRow, media → image/iframe with split/poster/full-bleed
// placement. Pure and unit-tested; the LLM composer (composer.server.ts)
// falls back to this when unavailable.

import type { Block, ImageBlock, IframeBlock } from './types';

export interface ComposeInput {
  text: string;
  mediaUrls: string[];
}

export interface ComposedSlide {
  title: string | null;
  layout: string;
  blocks: Block[];
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function fileLabel(url: string): string {
  const base = url.split('/').pop()?.split('?')[0] ?? 'image';
  return decodeURIComponent(base).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') || 'image';
}

/** "24,000 — state schools" / "£1.2bn: annual cost" → a statRow stat.
 *  Requires an explicit separator so number-led SENTENCES stay prose/bigNumber. */
const STAT_LINE = /^([£$€]?\d[\d,.]*\s?(?:%|bn|m|k|x)?)\s*[—–:-]\s*(.{2,60})$/i;

/** "24,000 schools connected" (number-led short line) → bigNumber. */
const NUMBER_LEAD = /^([£$€]?)(\d[\d,]*(?:\.\d+)?)\s?(%|bn|m|k)?\s+(.{2,60})$/i;

export function composeHeuristic(input: ComposeInput): ComposedSlide {
  const text = (input.text ?? '').trim();
  const mediaBlocks: Block[] = [];
  const looseLinks: string[] = [];

  for (const raw of input.mediaUrls ?? []) {
    const url = raw.trim();
    if (!url) continue;
    if (IMAGE_EXT.test(url) || url.includes('/api/files/')) {
      mediaBlocks.push({ type: 'image', src: url, alt: fileLabel(url) } satisfies ImageBlock);
    } else if (/^\/(?!\/|\\)/.test(url)) {
      mediaBlocks.push({ type: 'iframe', src: url, title: fileLabel(url) || 'Embedded page' } satisfies IframeBlock);
    } else {
      looseLinks.push(url);
    }
  }

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // Collect "n — label" stat lines; whatever remains is prose material.
  const stats: { n: string; label: string }[] = [];
  const proseLines: string[] = [];
  for (const line of lines) {
    const m = line.match(STAT_LINE);
    if (m && words(m[2]) <= 8) stats.push({ n: m[1].trim(), label: m[2].trim() });
    else proseLines.push(line);
  }

  // A short leading line becomes the slide title when more content follows.
  let title: string | null = null;
  if (proseLines.length > 1 && words(proseLines[0]) <= 8 && !/[.!?]$/.test(proseLines[0])) {
    title = proseLines.shift() ?? null;
  }

  const body = proseLines.join('\n\n');
  const bodyWords = words(body);
  const blocks: Block[] = [];
  const linkLine = looseLinks.map((u) => `[${u.replace(/^https?:\/\//, '')}](${u})`).join(' · ');

  // --- decide the page ---

  // Media-only: let the media be the page.
  if (!body && stats.length === 0 && mediaBlocks.length > 0) {
    return { title, layout: 'full-bleed', blocks: mediaBlocks };
  }

  // One image + a short statement: poster.
  const firstImage = mediaBlocks.find((b) => b.type === 'image');
  if (firstImage && mediaBlocks.length === 1 && bodyWords > 0 && bodyWords <= 30 && stats.length === 0) {
    blocks.push(firstImage);
    if (title) {
      blocks.push({ type: 'masthead', title, thesis: body });
    } else {
      blocks.push({ type: 'prose', body: `**${body}**`, lede: true });
    }
    if (linkLine) blocks.push({ type: 'prose', body: linkLine });
    return { title, layout: 'poster', blocks };
  }

  // Number-led one-liner: a gut-punch bigNumber.
  const single = !title && proseLines.length === 1 ? proseLines[0].match(NUMBER_LEAD) : null;
  if (single && stats.length === 0 && mediaBlocks.length === 0) {
    const value = Number(single[2].replaceAll(',', ''));
    if (Number.isFinite(value)) {
      const unit = [single[1], single[3]].filter(Boolean).join('') || undefined;
      blocks.push({ type: 'bigNumber', value, label: single[4].trim(), unit });
      return { title, layout: 'statement', blocks };
    }
  }

  // Short punchy line, nothing else: statement quote.
  if (!title && bodyWords > 0 && bodyWords <= 16 && stats.length === 0 && mediaBlocks.length === 0) {
    blocks.push({ type: 'quote', text: body.replace(/^["“]|["”]$/g, '') });
    return { title, layout: 'statement', blocks };
  }

  // General assembly: text (+stats) (+media).
  if (title && !body && stats.length === 0) {
    blocks.push({ type: 'masthead', title });
  }
  if (body) {
    const paragraphs = body.split(/\n{2,}/);
    blocks.push({ type: 'prose', body: paragraphs[0], lede: true });
    if (paragraphs.length > 1) blocks.push({ type: 'prose', body: paragraphs.slice(1).join('\n\n') });
  }
  if (stats.length > 0) blocks.push({ type: 'statRow', stats: stats.slice(0, 6) });
  if (linkLine) blocks.push({ type: 'prose', body: linkLine });
  blocks.push(...mediaBlocks);

  let layout = 'default';
  if (mediaBlocks.length > 0) layout = 'split';
  else if (stats.length >= 2 && blocks.length >= 3) layout = 'grid';

  if (blocks.length === 0) blocks.push({ type: 'prose', body: text || '…' });
  return { title, layout, blocks };
}
