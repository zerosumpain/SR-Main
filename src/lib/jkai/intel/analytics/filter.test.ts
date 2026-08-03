import { describe, it, expect } from 'vitest';
import { buildIndex, type GraphSnapshot } from './model';
import { applyGraphFilter, nodeMatches, parseCsv } from './filter';

// A small graph with two separated regions, so "did the expansion leak?" is
// answerable rather than a matter of opinion:
//
//   ada — bob — cat        dee — eve
//
// ada/bob/cat carry the 'work' category; dee/eve carry 'home'.

let seq = 0;
function node(
  id: string,
  over: Partial<GraphSnapshot['nodes'][number]> = {},
): GraphSnapshot['nodes'][number] {
  return {
    id,
    name: id.toUpperCase(),
    typeId: 'type-person',
    typeName: 'person',
    icon: '👤',
    color: '#fff',
    summary: null,
    confidence: 'high',
    confirmed: true,
    createdAt: 0,
    updatedAt: 0,
    noteCount: 1,
    lastSeenAt: 0,
    aliases: [],
    categories: [],
    sources: [],
    ...over,
  };
}
function edge(a: string, b: string): GraphSnapshot['edges'][number] {
  return {
    id: `e${seq++}`,
    source: a,
    target: b,
    type: 'knows',
    label: null,
    confidence: 'high',
    strength: 'moderate',
    createdAt: 0,
    weight: 0.5,
    lastSeenAt: 0,
    sourceKind: null,
  };
}

function fixture() {
  const snapshot: GraphSnapshot = {
    nodes: [
      node('ada', { categories: ['work'], aliases: ['A. Lovelace'] }),
      node('bob', { categories: ['work'], summary: 'Runs the analytics team.' }),
      node('cat', { categories: ['work'] }),
      node('dee', { categories: ['home'], typeId: 'type-place', typeName: 'place' }),
      node('eve', { categories: ['home'] }),
    ],
    edges: [edge('ada', 'bob'), edge('bob', 'cat'), edge('dee', 'eve')],
  };
  const index = buildIndex(snapshot);
  const community = new Map<string, number>([
    ['ada', 0],
    ['bob', 0],
    ['cat', 0],
    ['dee', 1],
    ['eve', 1],
  ]);
  return { index, community };
}

describe('nodeMatches', () => {
  it('matches on name, alias, summary and type', () => {
    const ada = node('ada', { aliases: ['A. Lovelace'], summary: 'Wrote the first program.' });
    expect(nodeMatches(ada, 'ada')).toBe(true);
    expect(nodeMatches(ada, 'lovelace')).toBe(true);
    expect(nodeMatches(ada, 'first program')).toBe(true);
    expect(nodeMatches(ada, 'person')).toBe(true);
    expect(nodeMatches(ada, 'nothing here')).toBe(false);
  });
});

describe('applyGraphFilter', () => {
  it('returns everything when no filter is given', () => {
    const { index, community } = fixture();
    const { keep, matched } = applyGraphFilter(index, community, {});
    expect(keep.size).toBe(5);
    expect(matched).toEqual([]);
  });

  it('filters by category', () => {
    const { index, community } = fixture();
    const { keep } = applyGraphFilter(index, community, { categories: ['home'] });
    expect([...keep].sort()).toEqual(['dee', 'eve']);
  });

  it('treats multiple categories as OR', () => {
    const { index, community } = fixture();
    const { keep } = applyGraphFilter(index, community, { categories: ['home', 'work'] });
    expect(keep.size).toBe(5);
  });

  it('restricts to an explicit entity set', () => {
    const { index, community } = fixture();
    const { keep } = applyGraphFilter(index, community, { entityIds: ['ada', 'eve'] });
    expect([...keep].sort()).toEqual(['ada', 'eve']);
  });

  it('reports keyword matches separately from the context around them', () => {
    const { index, community } = fixture();
    const { keep, matched } = applyGraphFilter(index, community, { q: 'bob', qHops: 1 });
    expect(matched).toEqual(['bob']);
    // bob plus its neighbours — the connective tissue that makes it a network.
    expect([...keep].sort()).toEqual(['ada', 'bob', 'cat']);
  });

  it('returns only the literal hits at qHops = 0', () => {
    const { index, community } = fixture();
    const { keep } = applyGraphFilter(index, community, { q: 'bob', qHops: 0 });
    expect([...keep]).toEqual(['bob']);
  });

  it('searches aliases as well as names', () => {
    const { index, community } = fixture();
    const { matched } = applyGraphFilter(index, community, { q: 'lovelace', qHops: 0 });
    expect(matched).toEqual(['ada']);
  });

  // The regression this ordering exists to prevent: expanding a keyword hit by
  // one hop must not drag in nodes the category filter already excluded.
  it('does not let keyword expansion leak past the other filters', () => {
    const { index, community } = fixture();
    const snapshotIndex = index;
    // Join the two regions so an expansion COULD cross if it were unguarded.
    snapshotIndex.neighbours.get('cat')!.add('dee');
    snapshotIndex.neighbours.get('dee')!.add('cat');

    const { keep } = applyGraphFilter(snapshotIndex, community, {
      q: 'cat',
      qHops: 1,
      categories: ['work'],
    });
    expect(keep.has('dee')).toBe(false);
    expect([...keep].sort()).toEqual(['bob', 'cat']);
  });

  it('applies type and minimum-degree filters', () => {
    const { index, community } = fixture();
    expect([...applyGraphFilter(index, community, { typeId: 'type-place' }).keep]).toEqual(['dee']);
    // bob is the only node with two neighbours.
    expect([...applyGraphFilter(index, community, { minDegree: 2 }).keep]).toEqual(['bob']);
  });

  it('filters by community', () => {
    const { index, community } = fixture();
    const { keep } = applyGraphFilter(index, community, { communityId: 1 });
    expect([...keep].sort()).toEqual(['dee', 'eve']);
  });
});

describe('parseCsv', () => {
  it('trims, drops blanks and de-duplicates', () => {
    expect(parseCsv(' a , b ,, a ')).toEqual(['a', 'b']);
    expect(parseCsv(null)).toEqual([]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('source filter', () => {
  /** ada/bob from email, cat from a file, dee from research, eve unsourced. */
  function sourced() {
    const snapshot: GraphSnapshot = {
      nodes: [
        node('ada', { sources: ['email'] }),
        node('bob', { sources: ['email', 'file'] }),
        node('cat', { sources: ['file'] }),
        node('dee', { sources: ['research'] }),
        node('eve', { sources: [] }),
      ],
      edges: [edge('ada', 'bob'), edge('bob', 'cat'), edge('dee', 'eve')],
    };
    return { index: buildIndex(snapshot), community: new Map<string, number>() };
  }

  it('keeps only entities asserted by the chosen source', () => {
    const { index, community } = sourced();
    const { keep } = applyGraphFilter(index, community, { sources: ['research'] });
    expect(keep.has('dee')).toBe(true);
    expect(keep.has('ada')).toBe(false);
    expect(keep.has('cat')).toBe(false);
  });

  it('keeps an entity carrying ANY of several chosen sources', () => {
    const { index, community } = sourced();
    const { keep } = applyGraphFilter(index, community, { sources: ['email', 'research'] });
    expect([...keep].sort()).toEqual(['ada', 'bob', 'dee', 'eve'].sort());
  });

  it('keeps a multi-source entity when only one of its sources is chosen', () => {
    // bob is both email and file; picking file must not lose him.
    const { index, community } = sourced();
    const { keep } = applyGraphFilter(index, community, { sources: ['file'] });
    expect(keep.has('bob')).toBe(true);
    expect(keep.has('cat')).toBe(true);
  });

  it('keeps unsourced entities rather than deleting history', () => {
    // Notes predating the source column, and anything hand-created, have none.
    const { index, community } = sourced();
    const { keep } = applyGraphFilter(index, community, { sources: ['email'] });
    expect(keep.has('eve')).toBe(true);
  });

  it('applies no filter at all when the list is empty', () => {
    const { index, community } = sourced();
    expect(applyGraphFilter(index, community, { sources: [] }).keep.size).toBe(5);
    expect(applyGraphFilter(index, community, {}).keep.size).toBe(5);
  });

  it('composes with the category filter rather than replacing it', () => {
    const snapshot: GraphSnapshot = {
      nodes: [
        node('ada', { sources: ['email'], categories: ['work'] }),
        node('bob', { sources: ['email'], categories: ['home'] }),
      ],
      edges: [edge('ada', 'bob')],
    };
    const index = buildIndex(snapshot);
    const { keep } = applyGraphFilter(index, new Map(), {
      sources: ['email'],
      categories: ['work'],
    });
    expect([...keep]).toEqual(['ada']);
  });
});
