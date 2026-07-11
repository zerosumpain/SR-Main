import { describe, expect, it } from 'vitest';
import { BLOCK_DOCS, BLOCK_SCHEMAS, validateBlocks } from './registry';

describe('validateBlocks', () => {
  it('accepts a representative valid block list', () => {
    const res = validateBlocks([
      { type: 'masthead', kicker: 'FIELD STUDY', title: 'The Data Spine', thesis: 'One thesis.' },
      { type: 'headline', kicker: 'THE FACT', text: 'Move the questions, not the records', dek: 'One line under it.', align: 'left' },
      { type: 'prose', body: 'Some **bold** text.', lede: true },
      { type: 'bigNumber', value: 24000, label: 'schools', unit: 'connected' },
      { type: 'statRow', stats: [{ n: '15', label: 'suppliers' }] },
      { type: 'quote', text: 'A quote.', attribution: 'Someone' },
      {
        type: 'timeline',
        items: [
          { year: '2002', label: 'First attempt' },
          { year: '2026', label: 'Announced' },
        ],
      },
      { type: 'image', src: '/images/x.png', alt: 'x' },
      {
        type: 'chart',
        kind: 'line',
        series: [{ label: 's', points: [{ x: 0, y: 1 }] }],
      },
      { type: 'embed', embed: 'federation-sim', config: { scenario: 'x', autoplay: true } },
      { type: 'iframe', src: '/projects/data-spine', title: 'Study' },
    ]);
    expect(res.issues).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('rejects an unknown block type with an indexed issue', () => {
    const res = validateBlocks([{ type: 'hologram' }]);
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toContain('blocks[0]');
    expect(res.issues[0]).toContain('hologram');
  });

  it('rejects a missing required prop, naming the path', () => {
    const res = validateBlocks([{ type: 'bigNumber', label: 'schools' }]);
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toContain('blocks[0]');
    expect(res.issues[0]).toContain('value');
  });

  it('rejects an unregistered embed', () => {
    const res = validateBlocks([{ type: 'embed', embed: 'nonexistent-widget' }]);
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toContain('nonexistent-widget');
  });

  it('rejects off-site iframe URLs', () => {
    const res = validateBlocks([{ type: 'iframe', src: 'https://evil.example', title: 'x' }]);
    expect(res.ok).toBe(false);
  });

  it('rejects protocol-relative and backslash iframe URLs', () => {
    expect(validateBlocks([{ type: 'iframe', src: '//evil.example', title: 'x' }]).ok).toBe(false);
    expect(validateBlocks([{ type: 'iframe', src: '/\\evil.example', title: 'x' }]).ok).toBe(false);
    expect(validateBlocks([{ type: 'iframe', src: '/projects/data-spine', title: 'x' }]).ok).toBe(true);
  });

  it('rejects a non-array payload', () => {
    expect(validateBlocks({ not: 'an array' }).ok).toBe(false);
  });

  it('documents every schema for the LLM', () => {
    expect(Object.keys(BLOCK_DOCS).sort()).toEqual(Object.keys(BLOCK_SCHEMAS).sort());
  });
});

describe('chart kinds', () => {
  const series = [{ label: 's', points: [{ x: 0, y: 1 }, { x: 1, y: 2 }] }];

  it('requires the right data field per kind', () => {
    expect(validateBlocks([{ type: 'chart', kind: 'area', series }]).ok).toBe(true);
    expect(validateBlocks([{ type: 'chart', kind: 'area' }]).ok).toBe(false);
    expect(validateBlocks([{ type: 'chart', kind: 'donut', segments: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }]).ok).toBe(true);
    expect(validateBlocks([{ type: 'chart', kind: 'donut', series }]).ok).toBe(false);
    expect(validateBlocks([{ type: 'chart', kind: 'sankey', flows: [{ from: 'a', to: 'b', value: 3 }] }]).ok).toBe(true);
    expect(validateBlocks([{ type: 'chart', kind: 'sankey', series }]).ok).toBe(false);
  });

  it('rejects cyclic sankey flows', () => {
    const res = validateBlocks([
      { type: 'chart', kind: 'sankey', flows: [{ from: 'a', to: 'b', value: 1 }, { from: 'b', to: 'a', value: 1 }] },
    ]);
    expect(res.ok).toBe(false);
    expect(res.issues[0]).toContain('acyclic');
  });

  it('rejects slope series with a single point', () => {
    expect(validateBlocks([{ type: 'chart', kind: 'slope', series: [{ label: 's', points: [{ x: 0, y: 1 }] }] }]).ok).toBe(false);
    expect(validateBlocks([{ type: 'chart', kind: 'slope', series }]).ok).toBe(true);
  });
});

describe('block templates', () => {
  it('every editor template validates', async () => {
    const { BLOCK_TEMPLATES, CHART_TEMPLATES } = await import('./templates');
    const res = validateBlocks([...Object.values(BLOCK_TEMPLATES), ...Object.values(CHART_TEMPLATES)]);
    expect(res.issues).toEqual([]);
  });

  it('covers every chart kind with a template', async () => {
    const { CHART_TEMPLATES } = await import('./templates');
    expect(Object.keys(CHART_TEMPLATES).sort()).toEqual(['area', 'bar', 'donut', 'line', 'sankey', 'scatter', 'slope']);
  });
});
