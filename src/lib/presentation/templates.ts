// Starter shapes for each block type — what the editor inserts when the owner
// adds a block. Every template validates against BLOCK_SCHEMAS (see
// registry.test.ts).

import type { Block, BlockType, ChartBlock, ChartKind } from './types';

export const BLOCK_TEMPLATES: Record<BlockType, Block> = {
  masthead: { type: 'masthead', kicker: 'KICKER', title: 'Headline', thesis: 'One-sentence thesis.' },
  headline: { type: 'headline', kicker: 'THE FACT', text: 'The statement, said with authority', dek: 'One supporting line under it.' },
  prose: { type: 'prose', body: 'A paragraph. **Bold** for emphasis, *italic*, __underline__; [links](/projects) allowed.', style: 'body' },
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
  code: {
    type: 'code',
    lang: 'ts',
    title: 'example.ts',
    code: "export function greet(name: string): string {\n  return `hello, ${name}`;\n}",
  },
  video: { type: 'video', src: 'https://www.youtube.com/watch?v=YE7VzlLtp-4', caption: 'VIDEO — CAPTION' },
  effect: { type: 'effect', effect: 'drift', role: 'background', intensity: 0.5, tint: 'ink' },
  embed: { type: 'embed', embed: 'federation-sim', config: { scenario: 'attendance', autoplay: true } },
  iframe: { type: 'iframe', src: '/projects', title: 'Projects', height: 520 },
};

/** Starter data per chart kind — the editor's add-block menu expands `chart`
 *  into one entry per kind so the shape-driven form gets the right fields. */
export const CHART_TEMPLATES: Record<ChartKind, ChartBlock> = {
  bar: BLOCK_TEMPLATES.chart as ChartBlock,
  line: {
    type: 'chart',
    kind: 'line',
    title: 'Trend',
    series: [
      { label: 'series', points: [{ x: 2020, y: 10 }, { x: 2023, y: 24 }, { x: 2026, y: 31 }] },
    ],
  },
  area: {
    type: 'chart',
    kind: 'area',
    title: 'Magnitude over time',
    series: [
      { label: 'series', points: [{ x: 2020, y: 10 }, { x: 2023, y: 24 }, { x: 2026, y: 31 }] },
    ],
  },
  scatter: {
    type: 'chart',
    kind: 'scatter',
    title: 'Correlation',
    series: [
      { label: 'group', points: [{ x: 10, y: 30 }, { x: 24, y: 42 }, { x: 40, y: 55 }, { x: 61, y: 71 }] },
    ],
  },
  slope: {
    type: 'chart',
    kind: 'slope',
    title: 'Before → after',
    series: [
      { label: 'first', points: [{ x: 0, y: 32 }, { x: 1, y: 64 }] },
      { label: 'second', points: [{ x: 0, y: 51 }, { x: 1, y: 38 }] },
    ],
    xLabels: ['2020', '2026'],
  },
  donut: {
    type: 'chart',
    kind: 'donut',
    title: 'Share of the whole',
    segments: [
      { label: 'first', value: 45 },
      { label: 'second', value: 30 },
      { label: 'third', value: 25 },
    ],
  },
  sankey: {
    type: 'chart',
    kind: 'sankey',
    title: 'Where it flows',
    flows: [
      { from: 'source', to: 'stage one', value: 60 },
      { from: 'source', to: 'stage two', value: 40 },
      { from: 'stage one', to: 'outcome', value: 45 },
      { from: 'stage two', to: 'outcome', value: 25 },
    ],
  },
};
