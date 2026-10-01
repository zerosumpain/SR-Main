import { describe, expect, it } from 'vitest';
import { nativeArtifacts, nativePanel, nativeSources, TABLE_ROW_CAP } from './native-rich';

const step = (artifact: unknown) => ({ tool: 'render_chart', status: 'done', result: { success: true, data: { artifact } } });

describe('charts for the phone', () => {
  it('reduces a one-mark spec to the fields it encodes', () => {
    const [chart] = nativeArtifacts([
      step({
        type: 'chart',
        spec: {
          mark: 'bar',
          encoding: {
            x: { field: 'week', type: 'ordinal', title: 'Week' },
            y: { field: 'km', type: 'quantitative' },
          },
        },
        data: [{ week: 'W1', km: 31.2, notes: 'ignored' }, { week: 'W2', km: 38 }],
        caption: 'Weekly distance',
      }),
    ]);
    expect(chart).toEqual({
      type: 'chart',
      simple: true,
      mark: 'bar',
      x: { field: 'week', title: 'Week', type: 'ordinal' },
      y: { field: 'km', title: 'km', type: 'quantitative' },
      color: null,
      rows: [{ week: 'W1', km: 31.2 }, { week: 'W2', km: 38 }],
      caption: 'Weekly distance',
    });
  });

  it('reads rows from spec.data.values when no data argument came', () => {
    const [chart] = nativeArtifacts([
      step({ type: 'chart', spec: { mark: { type: 'line' }, data: { values: [{ d: '2026-09-01', v: 1 }] }, encoding: { x: { field: 'd', type: 'temporal' }, y: { field: 'v', type: 'quantitative' } } }, data: [] }),
    ]);
    expect(chart).toMatchObject({ simple: true, mark: 'line', rows: [{ d: '2026-09-01', v: 1 }] });
  });

  it('refuses to draw what it would draw wrong', () => {
    const cases = [
      { mark: 'bar', layer: [], encoding: {} },
      { mark: 'bar', transform: [{ filter: 'x' }], encoding: { x: { field: 'a' }, y: { field: 'b' } } },
      { mark: 'bar', encoding: { x: { field: 'a' }, y: { field: 'b', aggregate: 'sum' } } },
      { mark: 'arc', encoding: { x: { field: 'a' }, y: { field: 'b' } } },
    ];
    for (const spec of cases) {
      const [chart] = nativeArtifacts([step({ type: 'chart', spec, data: [{ a: 1, b: 2 }], caption: 'c' })]);
      expect(chart).toEqual({ type: 'chart', simple: false, caption: 'c' });
    }
  });
});

describe('tables and diagrams', () => {
  it('caps a long table and says how long it was', () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ n: i, nested: { a: i } }));
    const [table] = nativeArtifacts([step({ type: 'table', columns: [{ key: 'n', label: 'N', align: 'right' }, { key: 'nested', label: 'Nested' }], rows })]);
    expect(table).toMatchObject({ type: 'table', totalRows: 250 });
    if (table.type !== 'table') throw new Error('not a table');
    expect(table.rows).toHaveLength(TABLE_ROW_CAP);
    expect(table.rows[1]).toEqual({ n: 1, nested: '{"a":1}' });
    expect(table.columns[1].align).toBe('left');
  });

  it('passes a diagram through, and skips steps with no artifact', () => {
    const out = nativeArtifacts([
      { tool: 'file_search', result: { data: { hits: [] } } },
      step({ type: 'diagram', code: 'graph TD; A-->B', caption: 'Flow' }),
    ]);
    expect(out).toEqual([{ type: 'diagram', code: 'graph TD; A-->B', caption: 'Flow' }]);
  });

  it('survives metadata that is not what it expects', () => {
    expect(nativeArtifacts(undefined)).toEqual([]);
    expect(nativeArtifacts([null, 3, 'x'])).toEqual([]);
  });
});

describe('sources', () => {
  it('names research by its page and files by their basename, deduplicated', () => {
    const sources = nativeSources({
      researchRefs: [
        { sourceTitle: 'Marathon taper', sourceUrl: 'https://ex.org/t', domain: 'ex.org', passage: 'Cut volume\n by 40%.' },
        { sourceTitle: 'Marathon taper', sourceUrl: 'https://ex.org/t', domain: 'ex.org', passage: 'dup' },
      ],
      fileRefs: [{ source: 'plans/week-7.md', passage: 'Sat long run' }],
    });
    expect(sources).toEqual([
      { kind: 'research', title: 'Marathon taper', passage: 'Cut volume by 40%.', url: 'https://ex.org/t', domain: 'ex.org' },
      { kind: 'file', title: 'week-7.md', passage: 'Sat long run', url: null, domain: null },
    ]);
  });
});

describe('the desk page for the drawer', () => {
  const page = (blocks: unknown[]) => ({
    panel: {
      producer: 'turn',
      head: { kicker: 'Health', context: ['health'], title: 'Readiness' },
      sections: [{ id: 'health', label: 'Readiness', blocks }],
    },
  });

  it('passes a valid page through', () => {
    const p = nativePanel(page([{ id: 'f', type: 'figures', items: [{ label: 'Readiness', value: '73' }] }]));
    expect(p?.head.title).toBe('Readiness');
    expect(p?.sections[0].blocks.map((b) => b.id)).toEqual(['f']);
  });

  it('drops artifact blocks and actions the phone should not tap', () => {
    const p = nativePanel(page([
      { id: 'a', type: 'artifact', artifact: { type: 'chart', spec: {}, data: [] } },
      { id: 'b', type: 'actions', items: [
        { id: 'x', label: 'Ask', kind: 'ask', ask: { label: 'Ask', detail: 'Why?' } },
        { id: 'y', label: 'Run', kind: 'post', endpoint: '/api/x' },
      ] },
    ]));
    expect(p?.sections[0].blocks.map((b) => b.id)).toEqual(['b']);
    const acts = p!.sections[0].blocks[0];
    expect(acts.type === 'actions' && acts.items.map((a) => a.kind)).toEqual(['ask']);
  });

  it('is null for no page, an invalid page, or a page left empty', () => {
    expect(nativePanel({})).toBeNull();
    expect(nativePanel({ panel: { head: {} } })).toBeNull();
    expect(nativePanel(page([{ id: 'a', type: 'artifact', artifact: {} }]))).toBeNull();
  });
});
