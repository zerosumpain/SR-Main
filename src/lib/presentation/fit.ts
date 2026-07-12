// Deterministic fit estimate for the fixed 1280×720 stage. Pure and server-
// safe: the composer uses it to catch LLM slides that would overflow the page
// (and retry with feedback), the jkai builder surfaces it as warnings. It is
// a coarse upper-bound model of SlideView's design-px metrics — calibrated so
// every curated showcase slide passes (fit.test.ts ratchets that) — not a
// renderer. Prefer false negatives over false positives: only flag slides
// that are clearly too full.

import { VISUAL_BLOCK_TYPES, type SlideLayoutId } from './layouts';
import type { Block } from './types';

const PAGE_H = 720;
const PAD = 64;
/** Vertical rhythm between stacked blocks. */
const GAP = 28;
/** Estimates are rough — only call overflow beyond this slack. */
const TOLERANCE = 1.2;

/** Wrapped line count for text at a font size within a column width.
 *  charW is the average glyph width as a fraction of the font size. */
function lines(text: string | undefined, width: number, font: number, charW = 0.52): number {
  if (!text) return 0;
  const cpl = Math.max(6, Math.floor(width / (font * charW)));
  return text
    .split(/\n+/)
    .filter((p) => p.trim())
    .reduce((n, p) => n + Math.max(1, Math.ceil(p.length / cpl)), 0);
}

function proseHeight(body: string, style: string, width: number, scale: number): number {
  switch (style) {
    case 'band':
    case 'manifesto':
    case 'pull':
      return lines(body, width, 34 * scale, 0.55) * 54 * scale;
    case 'lede':
      return lines(body, width, 26 * scale) * 42 * scale;
    case 'columns':
      return Math.ceil(lines(body, width / 2, 16) / 2) * 26 + 20;
    case 'cards': {
      // Paragraphs become cards in a two-column grid.
      const cards = body.split(/\n\n+/).filter((p) => p.trim());
      const per = cards.map((c) => 56 + lines(c, width / 2 - 24, 16) * 26);
      let h = 0;
      for (let i = 0; i < per.length; i += 2) h += Math.max(per[i], per[i + 1] ?? 0) + 16;
      return h;
    }
    default:
      // body + the labelled registers (numbered/ledger/interview/checklist/
      // callout/aside/verse) — body type with opener/label overhead per para.
      return lines(body, width, 19 * scale) * 32 * scale + body.split(/\n\n+/).length * 10;
  }
}

/** Estimated rendered height of one block in design px. `statement` marks the
 *  statement-left/right layouts, which scale display type up. */
function blockHeight(b: Block, width: number, statement: boolean): number {
  const s = statement ? 1.35 : 1;
  switch (b.type) {
    case 'effect':
      return 0;
    case 'masthead':
      return (
        (b.kicker ? 34 : 0) +
        lines(b.title, width, (statement ? 115 : 89.5), 0.55) * (statement ? 122 : 96) +
        lines(b.thesis, width, 22) * 36 +
        (b.asks?.length ?? 0) * 28 +
        40
      );
    case 'headline':
      return (
        (b.kicker ? 34 : 0) +
        lines(b.text, width, (statement ? 102 : 76), 0.55) * (statement ? 116 : 88) +
        lines(b.dek, width, 21) * 34
      );
    case 'prose':
      return proseHeight(b.body, b.style ?? (b.lede ? 'lede' : 'body'), width, s);
    case 'quote': {
      const font = statement ? 68 : b.style === 'pull' ? 58 : b.style === 'boxed' ? 26 : 40;
      return lines(b.text, width, font, 0.5) * font * 1.25 + (b.attribution ? 40 : 0) + 24;
    }
    case 'bigNumber':
      return (statement ? 300 : 210) + (b.sub ? 30 : 0) + 40;
    case 'statRow':
      return 150;
    case 'timeline':
      return b.items.length * 78 + 20;
    case 'code':
      return 70 + Math.min(b.code.split('\n').length, 30) * 24 + (b.caption ? 30 : 0);
    case 'chart':
      return 430;
    case 'image':
      return 400;
    case 'video':
      return 430;
    case 'iframe':
    case 'embed':
      return 470;
    default:
      return 120;
  }
}

/** Estimated content height vs the page budget for a slide. */
export function estimateFit(
  layout: string,
  blocks: Block[],
): { estimate: number; budget: number; over: boolean } {
  const l = layout as SlideLayoutId;
  const statement = l === 'statement-left' || l === 'statement-right';
  const budget = l === 'full-bleed' || l === 'poster' ? PAGE_H : PAGE_H - PAD * 2;

  const stack = (bs: Block[], width: number): number =>
    bs.reduce((h, b) => {
      const bh = blockHeight(b, width, statement);
      return bh === 0 ? h : h + bh + (h > 0 ? GAP : 0);
    }, 0);

  let estimate: number;
  if (l === 'split' || l === 'split-flip') {
    // Parallel columns: text 38%, visuals 62% — the taller column governs.
    const visual = blocks.filter((b) => VISUAL_BLOCK_TYPES.has(b.type));
    const text = blocks.filter((b) => !VISUAL_BLOCK_TYPES.has(b.type));
    estimate = Math.max(stack(text, 420), stack(visual, 690));
  } else if (l === 'grid') {
    // Leading block full width, the rest in two columns.
    const [head, ...rest] = blocks;
    estimate = (head ? blockHeight(head, 1152, false) + GAP : 0) + stack(rest, 560) / 2 + GAP;
  } else if (l === 'poster') {
    // The backdrop image doesn't stack; text overlays the scrim.
    estimate = stack(blocks.filter((b) => b.type !== 'image'), 640);
  } else if (statement) {
    estimate = stack(blocks, 653);
  } else {
    estimate = stack(blocks, 1152);
  }
  return { estimate: Math.round(estimate), budget, over: estimate > budget * TOLERANCE };
}

/** Human/LLM-readable fit problems for a slide — empty when it fits. */
export function fitIssues(layout: string, blocks: Block[]): string[] {
  const { estimate, budget, over } = estimateFit(layout, blocks);
  if (!over) return [];
  return [
    `content is ~${Math.round((estimate / budget) * 100)}% of the ${layout} page height (est. ${estimate}px against ${budget}px) — tighten the words, use a denser register (columns/ledger/cards), or split across two slides`,
  ];
}
