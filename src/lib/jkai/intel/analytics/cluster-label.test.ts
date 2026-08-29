import { describe, it, expect } from 'vitest';
import {
  composeClusterLabel,
  labelForView,
  describeComposition,
  findUbiquitousEntities,
  UBIQUITY_REACH,
  KNOWN_SOURCES,
} from './cluster-label';
import type { GraphNode } from './model';

const n = (
  id: string,
  name: string,
  typeName: string,
  sources: string[] = ['email'],
  noteCount = 1,
): GraphNode => ({
  id,
  name,
  typeId: typeName,
  typeName,
  icon: '',
  color: '',
  summary: null,
  confidence: 'medium',
  confidenceScore: null,
  confirmed: false,
  createdAt: 0,
  updatedAt: 0,
  noteCount,
  lastSeenAt: 0,
  evidenceAt: 0,
  aliases: [],
  categories: [],
  sources,
});

/** Rank by the order given: first id is the most central. */
const ctx = (order: string[], ubiquitous: string[] = []) => ({
  pagerank: new Map(order.map((id, i) => [id, order.length - i])),
  ubiquitous: new Set(ubiquitous),
});

describe('composeClusterLabel', () => {
  it('names the cluster after its two leading members', () => {
    const members = [
      n('1', 'Costco UK', 'organisation'),
      n('2', 'Brakeburn', 'organisation'),
      n('3', 'Socks', 'product'),
    ];
    expect(composeClusterLabel(members, ctx(['1', '2', '3']))).toBe('Costco UK · Brakeburn');
  });

  it('lets specific names take both slots over an entity that touches everything', () => {
    const members = [
      n('1', 'John Kelly', 'person'),
      n('2', 'IBCA', 'organisation'),
      n('3', 'Data Strategy', 'policy'),
    ];
    expect(composeClusterLabel(members, ctx(['1', '2', '3'], ['1']))).toBe('IBCA · Data Strategy');
  });

  it('demotes rather than drops — a ubiquitous name still fills a spare slot', () => {
    const members = [n('1', 'John Kelly', 'person'), n('2', 'IBCA', 'organisation')];
    expect(composeClusterLabel(members, ctx(['1', '2'], ['1']))).toBe('IBCA · John Kelly');
  });

  it('keeps a ubiquitous name when it is all there is', () => {
    const members = [n('1', 'jkai', 'system'), n('2', 'User', 'person')];
    expect(composeClusterLabel(members, ctx(['1', '2'], ['1', '2']))).toBe('jkai · User');
  });

  it('does not spend the second slot repeating the first', () => {
    // The real case: the IBCA cluster's two most central members.
    const members = [
      n('1', 'IBCA', 'organisation'),
      n('2', 'IBCA Data Strategy', 'policy'),
      n('3', 'Responsible AI Strategy', 'policy'),
    ];
    expect(composeClusterLabel(members, ctx(['1', '2', '3']))).toBe('IBCA · Responsible AI Strategy');
  });

  it('falls back to the composition when nothing is nameable', () => {
    const members = [n('1', '  ', 'person'), n('2', '', 'person')];
    expect(composeClusterLabel(members, ctx(['1', '2']))).toBe('2 people');
  });

  it('pluralises a multi-word type readably', () => {
    const members = [n('1', '', 'process_step'), n('2', '  ', 'process_step')];
    expect(composeClusterLabel(members, ctx(['1', '2']))).toBe('2 process steps');
  });

  it('uses one leader when only one is available', () => {
    const members = [n('1', 'IBCA', 'organisation')];
    expect(composeClusterLabel(members, ctx(['1']))).toBe('IBCA');
  });

  it('never returns an empty label', () => {
    expect(composeClusterLabel([], ctx([]))).toBe('Unnamed cluster');
  });

  it('ignores an entity with a blank name rather than emitting a stray separator', () => {
    const members = [n('1', '   ', 'organisation'), n('2', 'IBCA', 'organisation')];
    expect(composeClusterLabel(members, ctx(['1', '2']))).toBe('IBCA');
  });

  it('prefers a name that fits over a more central one that does not', () => {
    // The real case: the competitions cluster's most central members.
    const members = [
      n('1', 'LinkedIn', 'organisation'),
      n('2', '2023 Volkswagen Caddy & 30 Piece DeWalt XR Kit competition', 'product'),
      n('3', 'Storm Competitions', 'organisation'),
    ];
    expect(composeClusterLabel(members, ctx(['1', '2', '3']))).toBe('LinkedIn · Storm Competitions');
  });

  it('clips an overlong name rather than dropping the cluster to a count', () => {
    const members = [n('1', '2023 Volkswagen Caddy & 30 Piece DeWalt XR Kit competition', 'product')];
    const label = composeClusterLabel(members, ctx(['1']));
    expect(label.length).toBeLessThanOrEqual(34);
    expect(label.endsWith('…')).toBe(true);
    expect(label.startsWith('2023 Volkswagen')).toBe(true);
  });

  it('is deterministic when two members tie on centrality', () => {
    const members = [n('1', 'Alpha', 'organisation'), n('2', 'Beta', 'organisation')];
    const tied = { pagerank: new Map([['1', 1], ['2', 1]]), ubiquitous: new Set<string>() };
    expect(composeClusterLabel(members, tied)).toBe(composeClusterLabel([...members].reverse(), tied));
  });
});

describe('findUbiquitousEntities', () => {
  /**
   * A hub wired into `reach` clusters, each cluster otherwise self-contained.
   * Mirrors the real shape: one entity with neighbours everywhere.
   */
  function hubGraph(reach: number) {
    const ids = ['hub'];
    const neighbours = new Map<string, Set<string>>([['hub', new Set()]]);
    const membership = new Map<string, number>([['hub', 0]]);
    const tracked = new Set<number>();
    for (let c = 0; c < reach; c++) {
      const member = `m${c}`;
      ids.push(member);
      membership.set(member, c);
      tracked.add(c);
      neighbours.set(member, new Set(['hub']));
      neighbours.get('hub')!.add(member);
    }
    return { index: { ids, neighbours }, membership, tracked };
  }

  it('flags an entity with neighbours in more clusters than the threshold', () => {
    const { index, membership, tracked } = hubGraph(UBIQUITY_REACH + 5);
    expect(findUbiquitousEntities(index, membership, tracked).has('hub')).toBe(true);
  });

  it('spares an entity just under the threshold', () => {
    const { index, membership, tracked } = hubGraph(UBIQUITY_REACH - 2);
    expect(findUbiquitousEntities(index, membership, tracked).has('hub')).toBe(false);
  });

  it('counts only tracked clusters — fragments are not reach', () => {
    const { index, membership, tracked } = hubGraph(UBIQUITY_REACH + 5);
    // Everything the hub touches is an untracked fragment.
    expect(findUbiquitousEntities(index, membership, new Set()).size).toBe(0);
  });

  it('never flags anything when there is nothing to be ubiquitous across', () => {
    const { index, membership } = hubGraph(3);
    expect(findUbiquitousEntities(index, membership, new Set([0])).size).toBe(0);
  });

  it('leaves an ordinary entity alone', () => {
    const { index, membership, tracked } = hubGraph(UBIQUITY_REACH + 5);
    expect(findUbiquitousEntities(index, membership, tracked).has('m0')).toBe(false);
  });
});

describe('describeComposition', () => {
  it('counts types and sources, and flags entities with no provenance', () => {
    const members = [
      n('1', 'A', 'product', ['email']),
      n('2', 'B', 'product', ['email', 'chat']),
      n('3', 'C', 'person', []),
    ];
    const c = describeComposition(members);
    expect(c.size).toBe(3);
    expect(c.types[0]).toEqual(['product', 2]);
    expect(c.sources[0]).toEqual(['email', 2]);
    expect(c.sourceless).toBe(1);
  });

  it('counts each source once per entity, however many notes carried it', () => {
    const members = [n('1', 'A', 'product', ['email', 'email' as string])];
    expect(describeComposition(members).sources).toEqual([['email', 1]]);
  });

  it('totals the evidence behind the cluster', () => {
    const members = [n('1', 'A', 'product', ['email'], 4), n('2', 'B', 'product', ['chat'], 6)];
    expect(describeComposition(members).noteTotal).toBe(10);
  });

  it('orders types and sources by count, breaking ties by name', () => {
    const members = [
      n('1', 'A', 'product', ['chat']),
      n('2', 'B', 'person', ['email']),
      n('3', 'C', 'person', ['email']),
    ];
    const c = describeComposition(members);
    expect(c.types[0]).toEqual(['person', 2]);
    expect(c.sources[0]).toEqual(['email', 2]);
  });

  it('handles an empty cluster without dividing by zero', () => {
    const c = describeComposition([]);
    expect(c).toEqual({
      size: 0,
      types: [],
      sources: [],
      sourceless: 0,
      noteTotal: 0,
      diversity: 0,
    });
  });
});

describe('diversity', () => {
  const from = (sources: string[][]) =>
    describeComposition(sources.map((s, i) => n(String(i), `e${i}`, 'product', s))).diversity;

  it('is 0 for a cluster whose every entity came from one source', () => {
    // The real case: Brakeburn, Zavvi, CMaxOwnersClub — single-source mailshots.
    expect(from([['email'], ['email'], ['email']])).toBe(0);
  });

  it('rises as evidence spreads across kinds of source', () => {
    const single = from([['email'], ['email'], ['email'], ['email']]);
    const two = from([['email'], ['email'], ['file'], ['file']]);
    const three = from([['email'], ['file'], ['chat'], ['research']]);
    expect(two).toBeGreaterThan(single);
    expect(three).toBeGreaterThan(two);
  });

  it('separates a corroborated subject from a feed', () => {
    // IBCA-shaped: file-led, corroborated by chat and research.
    const subject = from([
      ...Array.from({ length: 14 }, () => ['file']),
      ...Array.from({ length: 6 }, () => ['chat']),
      ['research'],
      ['research'],
    ]);
    // Costco-shaped: everything from one mailbox.
    const feed = from(Array.from({ length: 22 }, () => ['email']));
    expect(subject).toBeGreaterThan(feed);
    expect(feed).toBe(0);
  });

  it('stays within 0..1', () => {
    const spread = from(KNOWN_SOURCES.map((s) => [s]));
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThanOrEqual(1);
  });

  it('ignores entities with no provenance rather than counting them as a source', () => {
    expect(from([['email'], ['email'], []])).toBe(0);
  });
});

describe('labelForView', () => {
  // Production, 2026-08-29: filtered to important email, the row for the cluster
  // holding one eBay order read "Hany Shoukry · Silent dev box deals" — a
  // consultant and a shopping habit, neither of which appears in any email. They
  // share the cluster with the order only because "England" and "London" are also
  // the seller's address.
  const rank = (ids: string[]) =>
    new Map(ids.map((id, i) => [id, (ids.length - i) / ids.length]));

  const cluster = [
    n('hany', 'Hany Shoukry', 'person', ['chat']),
    n('dev', 'Silent dev box deals', 'concept', ['chat']),
    n('england', 'England', 'location', ['email:important']),
    n('ebay', 'ebay.co.uk', 'organisation', ['email:important']),
    n('dell', 'Dell Micro Desktop PC', 'product', ['email:important']),
  ];
  // Global centrality: England leads the whole graph on its football edges.
  const ctx = {
    pagerank: rank(['england', 'hany', 'dev', 'ebay', 'dell']),
    ubiquitous: new Set<string>(),
  };
  const inView = new Set(['england', 'ebay', 'dell']);
  // Degree among the visible nodes only: England's football edges are out of view.
  const degreeInView = new Map([
    ['ebay', 6],
    ['dell', 5],
    ['england', 2],
  ]);

  it('names the cluster after what the filter admits', () => {
    expect(labelForView(cluster, (id) => inView.has(id), ctx, degreeInView)).toBe(
      'ebay.co.uk · Dell Micro Desktop PC',
    );
  });

  it('ranks within the slice, not by global centrality', () => {
    // The regression this exists for: ranking the slice by `ctx.pagerank` puts
    // England first on connections that are not on screen.
    const byGlobal = labelForView(cluster, (id) => inView.has(id), ctx, ctx.pagerank);
    expect(byGlobal).toBe('England · ebay.co.uk');
    expect(labelForView(cluster, (id) => inView.has(id), ctx, degreeInView)).not.toContain(
      'England',
    );
  });

  it('falls back to the whole cluster, on its own ordering, when nothing is in view', () => {
    expect(labelForView(cluster, () => false, ctx, degreeInView)).toBe(
      composeClusterLabel(cluster, ctx),
    );
  });

  it('still demotes the entities that are everywhere', () => {
    const hubCtx = { pagerank: ctx.pagerank, ubiquitous: new Set(['ebay']) };
    const label = labelForView(cluster, (id) => inView.has(id), hubCtx, degreeInView);
    expect(label.startsWith('Dell')).toBe(true);
  });
});
