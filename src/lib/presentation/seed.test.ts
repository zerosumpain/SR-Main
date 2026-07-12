// The seeded decks must always satisfy the block registry — this is the same
// validation gate the jkai tools apply to LLM-authored decks.
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import { DECK } from '../../../scripts/seed-deck-data-spine.mjs';
// eslint-disable-next-line import/no-relative-packages
import { DECK as SHOWCASE } from '../../../scripts/seed-deck-showcase.mjs';
import { EFFECT_IDS } from './effects';
import { isLayout } from './layouts';
import { BLOCK_SCHEMAS, validateBlocks } from './registry';
import { PROSE_STYLE_IDS, QUOTE_STYLE_IDS } from './styles';

interface SpecSlide {
  title?: string;
  layout?: string;
  blocks: unknown;
  children?: SpecSlide[];
}

function collect(slides: SpecSlide[], path = 'slides'): { path: string; blocks: unknown }[] {
  return slides.flatMap((s, i) => [
    { path: `${path}[${i}]`, blocks: s.blocks },
    ...(s.children ? collect(s.children, `${path}[${i}].children`) : []),
  ]);
}

describe('seed deck', () => {
  it('every slide validates against the block registry', () => {
    const all = collect((DECK as { slides: SpecSlide[] }).slides);
    expect(all.length).toBeGreaterThan(5);
    for (const { path, blocks } of all) {
      const res = validateBlocks(blocks);
      expect(res.issues, path).toEqual([]);
    }
  });

  it('uses real federation scenario ids', async () => {
    const { scenarioById } = await import('$lib/sim/federation/scenarios');
    const all = collect((DECK as { slides: SpecSlide[] }).slides);
    for (const { blocks } of all) {
      for (const b of blocks as { type: string; embed?: string; config?: { scenario?: string } }[]) {
        if (b.type === 'embed' && b.config?.scenario) {
          expect(scenarioById(b.config.scenario), b.config.scenario).toBeTruthy();
        }
      }
    }
  });
});

describe('showcase deck', () => {
  const all = collect((SHOWCASE as { slides: SpecSlide[] }).slides);

  it('every slide validates (blocks + layout + scenario ids)', async () => {
    const { scenarioById } = await import('$lib/sim/federation/scenarios');
    for (const { path, blocks } of all) {
      const res = validateBlocks(blocks);
      expect(res.issues, path).toEqual([]);
      for (const b of blocks as { type: string; embed?: string; config?: { scenario?: string } }[]) {
        if (b.type === 'embed' && b.config?.scenario) {
          expect(scenarioById(b.config.scenario), b.config.scenario).toBeTruthy();
        }
      }
    }
    for (const s of (SHOWCASE as { slides: SpecSlide[] }).slides) {
      expect(isLayout(s.layout ?? 'default'), String(s.layout)).toBe(true);
    }
  });

  it('exercises every block type, every layout and every chart kind', () => {
    const blockTypes = new Set(
      all.flatMap(({ blocks }) => (blocks as { type: string }[]).map((b) => b.type)),
    );
    const chartKinds = new Set(
      all.flatMap(({ blocks }) =>
        (blocks as { type: string; kind?: string }[]).filter((b) => b.type === 'chart').map((b) => b.kind),
      ),
    );
    const layouts = new Set<string>();
    const walk = (slides: SpecSlide[]) =>
      slides.forEach((s) => {
        layouts.add(s.layout ?? 'default');
        if (s.children) walk(s.children);
      });
    walk((SHOWCASE as { slides: SpecSlide[] }).slides);

    // Ratchet: EVERY registered block type must be demonstrated in the showcase.
    for (const t of Object.keys(BLOCK_SCHEMAS)) {
      expect(blockTypes.has(t), `block ${t}`).toBe(true);
    }
    for (const l of ['default', 'center', 'full-bleed', 'statement', 'statement-left', 'statement-right', 'split', 'split-flip', 'grid', 'poster']) {
      expect(layouts.has(l), `layout ${l}`).toBe(true);
    }
    for (const k of ['line', 'bar', 'area', 'scatter', 'slope', 'donut', 'sankey']) {
      expect(chartKinds.has(k), `chart kind ${k}`).toBe(true);
    }
  });

  it('exercises every effect, every prose register and every quote style', () => {
    const effects = new Set(
      all.flatMap(({ blocks }) =>
        (blocks as { type: string; effect?: string }[]).filter((b) => b.type === 'effect').map((b) => b.effect),
      ),
    );
    const proseStyles = new Set(
      all.flatMap(({ blocks }) =>
        (blocks as { type: string; style?: string; lede?: boolean }[])
          .filter((b) => b.type === 'prose')
          .map((b) => b.style ?? (b.lede ? 'lede' : 'body')),
      ),
    );
    const quoteStyles = new Set(
      all.flatMap(({ blocks }) =>
        (blocks as { type: string; style?: string }[]).filter((b) => b.type === 'quote').map((b) => b.style ?? 'rail'),
      ),
    );
    for (const e of EFFECT_IDS) expect(effects.has(e), `effect ${e}`).toBe(true);
    for (const s of PROSE_STYLE_IDS) expect(proseStyles.has(s), `prose style ${s}`).toBe(true);
    for (const s of QUOTE_STYLE_IDS) expect(quoteStyles.has(s), `quote style ${s}`).toBe(true);
  });

  it('demonstrates build steps (at least one staged slide)', () => {
    const staged = all.some(({ blocks }) =>
      (blocks as { step?: number }[]).some((b) => (b.step ?? 0) >= 1),
    );
    expect(staged).toBe(true);
  });
});
