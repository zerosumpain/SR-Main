import { describe, it, expect } from 'vitest';
import { buildIndex, type GraphSnapshot } from './model';
import {
  applyGraphFilter,
  nodeMatches,
  parseCsv,
  nodeTimeUnder,
  edgeTimeUnder,
  inWindow,
} from './filter';

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
    confidenceScore: 0.7,
    confirmed: true,
    createdAt: 0,
    updatedAt: 0,
    noteCount: 1,
    lastSeenAt: 0,
    evidenceAt: 0,
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
    expect([...keep].sort()).toEqual(['ada', 'bob', 'dee'].sort());
  });

  it('keeps a multi-source entity when only one of its sources is chosen', () => {
    // bob is both email and file; picking file must not lose him.
    const { index, community } = sourced();
    const { keep } = applyGraphFilter(index, community, { sources: ['file'] });
    expect(keep.has('bob')).toBe(true);
    expect(keep.has('cat')).toBe(true);
  });

  it('drops an entity with no source rather than showing it under every source', () => {
    // The regression this exists for: an entity with no recorded source used to
    // be exempt from the filter, so asking for 'email' returned entities whose
    // only footprint was a deep dive or a chat thread. `loadSnapshot` now falls
    // back to `first_seen_in`, so an entity reaching here with nothing is a data
    // defect and must not be presented as email.
    const { index, community } = sourced();
    const { keep } = applyGraphFilter(index, community, { sources: ['email'] });
    expect(keep.has('eve')).toBe(false);
    expect(keep.has('ada')).toBe(true);
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

// ---------------------------------------------------------------------------
// The time window
//
// Shape of the fixture, and every part of it is load-bearing:
//
//   old1 ——(new edge)—— old2        fresh ——(old edge)—— touched      stale
//
// old1/old2 are months old and so is everything about them EXCEPT the edge
// joining them, which appeared yesterday. That is the case a node-only recency
// filter gets wrong: neither endpoint is recent, so the one genuinely new fact
// in the graph vanishes at the moment it appears.
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 7, 22);

function timedFixture() {
  const snapshot: GraphSnapshot = {
    nodes: [
      node('old1', { createdAt: NOW - 90 * DAY, updatedAt: NOW - 90 * DAY, categories: ['work'] }),
      node('old2', { createdAt: NOW - 90 * DAY, updatedAt: NOW - 90 * DAY, categories: ['home'] }),
      node('fresh', { createdAt: NOW - DAY, updatedAt: NOW - DAY, categories: ['work'] }),
      // Known for months, changed the day before yesterday — the whole reason
      // there are two clocks rather than one.
      node('touched', { createdAt: NOW - 90 * DAY, updatedAt: NOW - 2 * DAY, categories: ['work'] }),
      // No timestamps at all. Must never be claimed as recent.
      node('stale', { createdAt: 0, updatedAt: 0, categories: ['work'] }),
    ],
    edges: [
      { ...edge('old1', 'old2'), id: 'e-new', createdAt: NOW - DAY, lastSeenAt: NOW - DAY },
      { ...edge('fresh', 'touched'), id: 'e-old', createdAt: NOW - 90 * DAY, lastSeenAt: NOW - 90 * DAY },
      { ...edge('old1', 'stale'), id: 'e-ancient', createdAt: NOW - 90 * DAY, lastSeenAt: NOW - 90 * DAY },
    ],
  };
  const index = buildIndex(snapshot);
  const community = new Map<string, number>(snapshot.nodes.map((n) => [n.id, 0]));
  return { index, community };
}

describe('nodeTimeUnder / edgeTimeUnder', () => {
  it('reads created_at under the added clock', () => {
    const n = node('x', { createdAt: 100, updatedAt: 900 });
    expect(nodeTimeUnder(n, 'added')).toBe(100);
  });

  it('reads the later of updated_at and created_at under the updated clock', () => {
    expect(nodeTimeUnder(node('x', { createdAt: 100, updatedAt: 900 }), 'updated')).toBe(900);
    // A row written but never updated must not read as older than it is.
    expect(nodeTimeUnder(node('x', { createdAt: 100, updatedAt: 0 }), 'updated')).toBe(100);
  });

  it('falls back to created_at for an edge with no observation date', () => {
    const e = { ...edge('a', 'b'), createdAt: 500, lastSeenAt: 0 };
    expect(edgeTimeUnder(e, 'updated')).toBe(500);
    expect(edgeTimeUnder(e, 'added')).toBe(500);
  });
});

describe('inWindow', () => {
  it('treats an unknown timestamp as outside any window', () => {
    expect(inWindow(0, NOW - DAY, null)).toBe(false);
  });

  it('honours an open-ended bound on either side', () => {
    expect(inWindow(NOW, NOW - DAY, null)).toBe(true);
    expect(inWindow(NOW, null, NOW + DAY)).toBe(true);
    expect(inWindow(NOW, NOW + DAY, null)).toBe(false);
    expect(inWindow(NOW, null, NOW - DAY)).toBe(false);
  });
});

describe('applyGraphFilter — time window', () => {
  it('reports nothing as recent when no window is set', () => {
    const { index, community } = timedFixture();
    const res = applyGraphFilter(index, community, {});
    expect(res.recentNodes).toEqual([]);
    expect(res.recentEdges).toEqual([]);
    expect(res.keep.size).toBe(5);
  });

  it('keeps only nodes added inside the window, under the added clock', () => {
    const { index, community } = timedFixture();
    const res = applyGraphFilter(index, community, { since: NOW - 7 * DAY, clock: 'added' });
    // `touched` was added months ago — recently changed is not recently added.
    expect(res.recentNodes).toEqual(['fresh']);
  });

  it('counts a recently changed node under the updated clock', () => {
    const { index, community } = timedFixture();
    const res = applyGraphFilter(index, community, { since: NOW - 7 * DAY, clock: 'updated' });
    expect([...res.recentNodes].sort()).toEqual(['fresh', 'touched']);
  });

  it('pulls both endpoints of a new edge in, even though neither is recent', () => {
    const { index, community } = timedFixture();
    const res = applyGraphFilter(index, community, { since: NOW - 7 * DAY, clock: 'updated' });
    expect(res.recentEdges).toEqual(['e-new']);
    expect(res.keep.has('old1')).toBe(true);
    expect(res.keep.has('old2')).toBe(true);
    // …but they are not themselves reported as recent. They came along.
    expect(res.recentNodes).not.toContain('old1');
    expect(res.recentNodes).not.toContain('old2');
  });

  it('drops everything outside the window', () => {
    const { index, community } = timedFixture();
    const res = applyGraphFilter(index, community, { since: NOW - 7 * DAY, clock: 'updated' });
    expect([...res.keep].sort()).toEqual(['fresh', 'old1', 'old2', 'touched']);
    // Undated, unconnected to anything recent.
    expect(res.keep.has('stale')).toBe(false);
  });

  it('honours an upper bound', () => {
    const { index, community } = timedFixture();
    const res = applyGraphFilter(index, community, {
      since: NOW - 5 * DAY,
      until: NOW - 36 * 3600_000, // yesterday is out; the day before is in
      clock: 'updated',
    });
    expect(res.recentNodes).toEqual(['touched']);
    expect(res.recentEdges).toEqual([]);
  });

  it('does not let a recent edge leak back a node an attribute filter excluded', () => {
    const { index, community } = timedFixture();
    // old2 is 'home'; narrowing to 'work' must remove it, and e-new must not
    // reinstate it through the endpoint expansion.
    const res = applyGraphFilter(index, community, {
      since: NOW - 7 * DAY,
      clock: 'updated',
      categories: ['work'],
    });
    expect(res.keep.has('old2')).toBe(false);
    expect(res.recentEdges).toEqual([]);
    expect(res.keep.has('old1')).toBe(false);
  });
});
