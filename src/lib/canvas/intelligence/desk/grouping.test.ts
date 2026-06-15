import { describe, it, expect } from 'vitest';
import {
  groupBy,
  type GroupDim,
  type GroupCard,
  type GroupEdge,
  type EntityMention,
} from './grouping';

// ——— fixtures ———

function src(id: string, fields: Record<string, unknown> = {}): GroupCard {
  return { id, kind: 'source', fields };
}
function fact(id: string, fields: Record<string, unknown> = {}): GroupCard {
  return { id, kind: 'fact', fields };
}
function entity(id: string, type: string): GroupCard {
  return { id, kind: 'entity', fields: { type } };
}
function withCat(c: GroupCard, deskCategory: string | null): GroupCard {
  return { ...c, deskCategory };
}
function edge(
  id: string,
  fromEntityId: string,
  toEntityId: string,
  sentiment: string | null = null,
): GroupEdge {
  return { id, fromEntityId, toEntityId, sentiment };
}

const NO_EDGES: GroupEdge[] = [];
const NO_MENTIONS: EntityMention[] = [];
const NO_SIM = new Map<string, string>();

describe('groupBy — common contract', () => {
  it('returns a memberOf entry for every card and groups with summed counts', () => {
    const cards = [
      withCat(fact('f1'), 'cat-a'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-b'),
    ];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.size).toBe(3);
    for (const c of cards) expect(memberOf.has(c.id)).toBe(true);
    // counts in groups sum to (the number of cards that landed in a group)
    const total = groups.reduce((n, g) => n + g.count, 0);
    expect(total).toBe(3);
  });

  it('is deterministic — same inputs produce identical memberOf + groups', () => {
    const cards = [withCat(fact('f1'), 'cat-a'), withCat(fact('f2'), 'cat-b')];
    const a = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    const b = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
    expect(a.groups).toEqual(b.groups);
  });

  it('handles an empty card list', () => {
    const { memberOf, groups } = groupBy('cluster', [], NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.size).toBe(0);
    expect(groups).toEqual([]);
  });

  it('group counts equal the number of memberOf entries pointing at each key', () => {
    const cards = [
      withCat(fact('f1'), 'cat-a'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-b'),
    ];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    for (const g of groups) {
      const members = [...memberOf.values()].filter((k) => k === g.key).length;
      expect(g.count).toBe(members);
    }
  });
});

describe('groupBy — cluster (deskCategory)', () => {
  it('groups cards by deskCategory; same category → same group key', () => {
    const cards = [
      withCat(fact('f1'), 'cat-a'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-b'),
    ];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
    expect(memberOf.get('f1')).not.toBe(memberOf.get('f3'));
    expect(groups.find((g) => g.key === memberOf.get('f1'))!.count).toBe(2);
  });

  it('routes null/undefined deskCategory into a stable "uncategorised" group', () => {
    const cards = [withCat(fact('f1'), null), { ...fact('f2') }];
    const { memberOf, groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
    const g = groups.find((x) => x.key === memberOf.get('f1'))!;
    expect(g.count).toBe(2);
    expect(g.label.toLowerCase()).toContain('uncategor');
  });

  it('orders groups by descending count then key (stable)', () => {
    const cards = [
      withCat(fact('f1'), 'cat-b'),
      withCat(fact('f2'), 'cat-a'),
      withCat(fact('f3'), 'cat-a'),
    ];
    const { groups } = groupBy('cluster', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(groups[0].key).toBe('cat-a'); // count 2 first
    expect(groups[0].count).toBe(2);
    expect(groups[1].key).toBe('cat-b');
  });
});

describe('groupBy — theme (reuses themeOf)', () => {
  it('buckets by KIND/type theme', () => {
    const cards = [
      src('s1', { domain: 'example.com' }), // sites
      src('s2', { domain: 'youtube.com' }), // videos
      fact('f1', { isCounterfactual: false }), // facts
      fact('f2', { isCounterfactual: true }), // challenges
      entity('p1', 'person'), // people
    ];
    const { memberOf, groups } = groupBy('theme', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('s1')).toBe('sites');
    expect(memberOf.get('s2')).toBe('videos');
    expect(memberOf.get('f1')).toBe('facts');
    expect(memberOf.get('f2')).toBe('challenges');
    expect(memberOf.get('p1')).toBe('people');
    // labels are the human THEMES labels
    expect(groups.find((g) => g.key === 'sites')!.label).toBe('Sites');
    expect(groups.find((g) => g.key === 'facts')!.label).toBe('Facts');
  });

  it('two facts share the facts theme', () => {
    const cards = [fact('f1'), fact('f2')];
    const { memberOf } = groupBy('theme', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
  });
});

describe('groupBy — entityType', () => {
  it('groups entities by their type field; non-entities fall into a non-entity group', () => {
    const cards = [
      entity('e1', 'person'),
      entity('e2', 'person'),
      entity('e3', 'organisation'),
      fact('f1'),
    ];
    const { memberOf, groups } = groupBy('entityType', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
    expect(memberOf.get('e1')).not.toBe(memberOf.get('e3'));
    // non-entity cards are kept (so memberOf covers every card) in a dedicated bucket
    expect(memberOf.has('f1')).toBe(true);
    expect(memberOf.get('f1')).not.toBe(memberOf.get('e1'));
    expect(groups.find((g) => g.key === memberOf.get('e1'))!.count).toBe(2);
  });

  it('normalises entity type casing/whitespace into one group', () => {
    const cards = [entity('e1', 'Person'), entity('e2', ' person ')];
    const { memberOf } = groupBy('entityType', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
  });

  it('routes an entity with a missing type into an "other" entity group', () => {
    const cards = [{ id: 'e1', kind: 'entity' as const, fields: {} }];
    const { memberOf, groups } = groupBy('entityType', cards, NO_EDGES, NO_MENTIONS, NO_SIM);
    expect(memberOf.has('e1')).toBe(true);
    expect(groups.length).toBe(1);
  });
});
