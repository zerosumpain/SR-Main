// The seeded decks must always satisfy the block registry — this is the same
// validation gate the jkai tools apply to LLM-authored decks.
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import { DECK } from '../../../scripts/seed-deck-data-spine.mjs';
// eslint-disable-next-line import/no-relative-packages
import { DECK as SHOWCASE } from '../../../scripts/seed-deck-showcase.mjs';
import { isLayout } from './layouts';
import { validateBlocks } from './registry';

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

    for (const t of ['masthead', 'headline', 'prose', 'bigNumber', 'statRow', 'quote', 'timeline', 'image', 'chart', 'embed', 'iframe']) {
      expect(blockTypes.has(t), `block ${t}`).toBe(true);
    }
    for (const l of ['default', 'center', 'full-bleed', 'statement', 'statement-left', 'statement-right', 'split', 'split-flip', 'grid', 'poster']) {
      expect(layouts.has(l), `layout ${l}`).toBe(true);
    }
    for (const k of ['line', 'bar', 'area', 'scatter', 'slope', 'donut', 'sankey']) {
      expect(chartKinds.has(k), `chart kind ${k}`).toBe(true);
    }
  });
});
