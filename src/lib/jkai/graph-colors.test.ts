import { describe, it, expect } from 'vitest';
import { nodeStyle, edgeStyle, legendFor, PROVENANCE_STYLE, EDGE_STYLE } from './graph-colors';

const node = (provenance: 'known' | 'new' | 'thread') => ({ provenance });
const edge = (typed: boolean) => ({ typed });

describe('nodeStyle', () => {
  it('gives known and new visibly different colours', () => {
    expect(nodeStyle(node('known')).color).not.toBe(nodeStyle(node('new')).color);
  });

  it('falls back to the thread style for an unrecognised provenance', () => {
    // Old cached payloads predate the field; they must not render colourless.
    expect(nodeStyle({ provenance: 'nonsense' as never })).toBe(PROVENANCE_STYLE.thread);
  });
});

describe('edgeStyle', () => {
  it('draws an established relation solid and co-occurrence dashed', () => {
    expect(edgeStyle(edge(true)).dash).toBeUndefined();
    expect(edgeStyle(edge(false)).dash).toBe('3 3');
  });

  it('does not rely on colour alone to separate the two', () => {
    // Colour-blind readers get the dash; the hue only reinforces it.
    expect(EDGE_STYLE.typed.dash).not.toBe(EDGE_STYLE.cooccurrence.dash);
  });
});

describe('legendFor', () => {
  it('lists only the provenances actually present', () => {
    const rows = legendFor([node('thread'), node('thread')], []);
    expect(rows.map((r) => r.label)).toEqual([PROVENANCE_STYLE.thread.legend]);
  });

  it('covers nodes and edges together, nodes first', () => {
    const rows = legendFor([node('known'), node('new')], [edge(true), edge(false)]);
    expect(rows.map((r) => r.kind)).toEqual(['node', 'node', 'edge', 'edge']);
    expect(rows.map((r) => r.label)).toEqual([
      PROVENANCE_STYLE.known.legend,
      PROVENANCE_STYLE.new.legend,
      EDGE_STYLE.typed.legend,
      EDGE_STYLE.cooccurrence.legend,
    ]);
  });

  it('is empty for an empty graph, so no legend is drawn at all', () => {
    expect(legendFor([], [])).toEqual([]);
  });

  it('does not claim a co-occurrence key when every edge is typed', () => {
    const rows = legendFor([node('known')], [edge(true)]);
    expect(rows.some((r) => r.label === EDGE_STYLE.cooccurrence.legend)).toBe(false);
  });
});
