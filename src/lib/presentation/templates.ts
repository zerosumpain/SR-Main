// Starter shapes for each block type — what the editor inserts when the owner
// adds a block. Every template validates against BLOCK_SCHEMAS (see
// registry.test.ts).

import type { Block, BlockType } from './types';

export const BLOCK_TEMPLATES: Record<BlockType, Block> = {
  masthead: { type: 'masthead', kicker: 'KICKER', title: 'Headline', thesis: 'One-sentence thesis.' },
  prose: { type: 'prose', body: 'A paragraph. **Bold** for emphasis; [links](/projects) allowed.' },
  bigNumber: { type: 'bigNumber', value: 100, label: 'the measure', unit: 'unit' },
  statRow: {
    type: 'statRow',
    stats: [
      { n: '1', label: 'first' },
      { n: '2', label: 'second' },
    ],
  },
  quote: { type: 'quote', text: 'The quotation.', attribution: 'Source' },
  timeline: {
    type: 'timeline',
    items: [
      { year: '2024', label: 'First moment' },
      { year: '2026', label: 'Second moment' },
    ],
  },
  image: { type: 'image', src: '/images/placeholder.png', alt: 'Describe the image' },
  chart: {
    type: 'chart',
    kind: 'bar',
    title: 'Chart title',
    series: [
      {
        label: 'series',
        points: [
          { x: 0, y: 10 },
          { x: 1, y: 20 },
        ],
      },
    ],
    xLabels: ['A', 'B'],
  },
  embed: { type: 'embed', embed: 'federation-sim', config: { scenario: 'attendance', autoplay: true } },
  iframe: { type: 'iframe', src: '/projects', title: 'Projects', height: 520 },
};
