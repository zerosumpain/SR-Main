// The seeded deck must always satisfy the block registry — this is the same
// validation gate the phase-2 jkai tool applies to LLM-authored decks.
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import { DECK } from '../../../scripts/seed-deck-data-spine.mjs';
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
