// The fit estimator is only trustworthy if the curated seed decks — every
// block type, layout and register in real editorial proportions — all pass.
// This calibrates against false positives; the synthetic cases pin the
// failure mode it exists to catch (walls of text the page cannot hold).
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import { DECK } from '../../../scripts/seed-deck-data-spine.mjs';
// eslint-disable-next-line import/no-relative-packages
import { DECK as SHOWCASE } from '../../../scripts/seed-deck-showcase.mjs';
import { estimateFit, fitIssues } from './fit';
import type { Block } from './types';

interface SpecSlide {
  title?: string;
  layout?: string;
  blocks: Block[];
  children?: SpecSlide[];
}

function collect(slides: SpecSlide[], path = 'slides'): { path: string; layout: string; blocks: Block[] }[] {
  return slides.flatMap((s, i) => [
    { path: `${path}[${i}] (${s.title ?? 'untitled'})`, layout: s.layout ?? 'default', blocks: s.blocks },
    ...(s.children ? collect(s.children, `${path}[${i}].children`) : []),
  ]);
}

const para = (words: number) => Array.from({ length: words }, (_, i) => `word${i}`).join(' ');

describe('fit estimator', () => {
  it('every curated seed slide fits (no false positives)', () => {
    const all = [
      ...collect((DECK as { slides: SpecSlide[] }).slides),
      ...collect((SHOWCASE as { slides: SpecSlide[] }).slides),
    ];
    expect(all.length).toBeGreaterThan(40);
    for (const { path, layout, blocks } of all) {
      const { estimate, budget } = estimateFit(layout, blocks);
      expect(fitIssues(layout, blocks), `${path}: est ${estimate} vs ${budget}`).toEqual([]);
    }
  });

  it('flags a wall of prose on a default page', () => {
    const blocks: Block[] = [
      { type: 'headline', kicker: 'THE PROBLEM', text: 'Far too much text on one page' },
      { type: 'prose', body: `${para(160)}\n\n${para(160)}\n\n${para(160)}` },
    ];
    expect(fitIssues('default', blocks)).toHaveLength(1);
  });

  it('flags long prose crammed beside a chart on a split', () => {
    const blocks: Block[] = [
      { type: 'prose', body: `${para(120)}\n\n${para(120)}\n\n${para(120)}` },
      { type: 'chart', kind: 'line', series: [{ label: 'a', points: [{ x: 1, y: 1 }] }] } as unknown as Block,
    ];
    expect(fitIssues('split', blocks)).toHaveLength(1);
  });

  it('flags a long passage forced into statement scale', () => {
    const blocks: Block[] = [{ type: 'headline', text: para(60) }];
    expect(fitIssues('statement-left', blocks)).toHaveLength(1);
  });

  it('a lean statement page passes', () => {
    const blocks: Block[] = [
      { type: 'headline', kicker: 'THE ASK', text: 'The question travels, the data stays' },
    ];
    expect(fitIssues('statement-left', blocks)).toEqual([]);
  });
});
