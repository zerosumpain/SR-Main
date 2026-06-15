import { describe, it, expect } from 'vitest';
import {
  groupBy,
  ISOLATED_KEY,
  SIM_UNCLUSTERED_KEY,
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

describe('groupBy — sentiment (relationship sentiment)', () => {
  it('buckets an entity by the sentiment of the relationship it participates in', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'positive')];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
    expect(memberOf.get('e1')).toContain('positive');
  });

  it('separates entities by differing relationship sentiment', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), entity('e3', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'positive'), edge('r2', 'e3', 'e2', 'negative')];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    // e2 is in BOTH a positive and a negative relationship → mixed
    expect(memberOf.get('e2')).toContain('mixed');
    expect(memberOf.get('e1')).toContain('positive');
    expect(memberOf.get('e3')).toContain('negative');
    expect(memberOf.get('e1')).not.toBe(memberOf.get('e3'));
  });

  it('places a card touched by no relationship into the no-sentiment bucket', () => {
    const cards = [entity('lonely', 'person'), fact('f1')];
    const edges = [edge('r1', 'a', 'b', 'positive')]; // touches neither card
    const { memberOf, groups } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('lonely')).toBe(memberOf.get('f1'));
    const g = groups.find((x) => x.key === memberOf.get('lonely'))!;
    expect(g.count).toBe(2);
    expect(g.label.toLowerCase()).toContain('no sentiment');
  });

  it('treats a null/blank relationship sentiment as "neutral"', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person')];
    const edges = [edge('r1', 'e1', 'e2', null)];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect(memberOf.get('e1')).toContain('neutral');
  });

  it('normalises sentiment casing (POSITIVE == positive)', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), entity('e3', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'POSITIVE'), edge('r2', 'e3', 'e2', 'positive')];
    const { memberOf } = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    // e1 (POSITIVE) and e3 (positive) share the positive sentiment, both via e2;
    // e2 sees only positive → not mixed.
    expect(memberOf.get('e2')).toContain('positive');
    expect(memberOf.get('e2')).not.toContain('mixed');
  });

  it('is deterministic for the same inputs', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person')];
    const edges = [edge('r1', 'e1', 'e2', 'positive')];
    const a = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    const b = groupBy('sentiment', cards, edges, NO_MENTIONS, NO_SIM);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
  });
});

function mention(entityId: string, factId: string): EntityMention {
  return { entityId, factId };
}

describe('groupBy — cooccurrence (shared-fact components)', () => {
  it('puts two entities that share a fact into the same component', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), fact('f1')];
    const mentions = [mention('e1', 'f1'), mention('e2', 'f1')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('e2'));
    expect(memberOf.get('e1')).toBe(memberOf.get('f1')); // the fact joins too
  });

  it('merges components transitively through a shared entity', () => {
    // e1—f1, e1—f2  ⇒ f1 and f2 join via e1
    const cards = [entity('e1', 'person'), fact('f1'), fact('f2')];
    const mentions = [mention('e1', 'f1'), mention('e1', 'f2')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('f1')).toBe(memberOf.get('f2'));
    expect(memberOf.get('f1')).toBe(memberOf.get('e1'));
  });

  it('keeps disjoint mention sets in separate components', () => {
    const cards = [
      entity('e1', 'person'), fact('f1'),
      entity('e2', 'person'), fact('f2'),
    ];
    const mentions = [mention('e1', 'f1'), mention('e2', 'f2')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('e1')).toBe(memberOf.get('f1'));
    expect(memberOf.get('e2')).toBe(memberOf.get('f2'));
    expect(memberOf.get('e1')).not.toBe(memberOf.get('e2'));
  });

  it('routes a card not present in any mention to the isolated bucket', () => {
    const cards = [entity('e1', 'person'), fact('f1'), entity('lonely', 'person')];
    const mentions = [mention('e1', 'f1')];
    const { memberOf, groups } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.get('lonely')).toBe(ISOLATED_KEY);
    expect(groups.find((g) => g.key === ISOLATED_KEY)!.count).toBe(1);
  });

  it('uses the smallest member id as the component key (order-independent)', () => {
    const cardsA = [entity('e2', 'person'), entity('e1', 'person'), fact('f1')];
    const cardsB = [fact('f1'), entity('e1', 'person'), entity('e2', 'person')];
    const m = [mention('e1', 'f1'), mention('e2', 'f1')];
    const a = groupBy('cooccurrence', cardsA, NO_EDGES, m, NO_SIM);
    const b = groupBy('cooccurrence', cardsB, NO_EDGES, m, NO_SIM);
    // Same component key regardless of card-array order.
    expect(a.memberOf.get('e1')).toBe(b.memberOf.get('e1'));
    // Key is the lexicographically-smallest id in the component.
    const key = a.memberOf.get('e1')!;
    expect(['e1', 'e2', 'f1'].includes(key)).toBe(true);
    expect(key).toBe('e1'); // 'e1' < 'e2' < 'f1'
  });

  it('ignores mentions whose ids are not loaded as cards', () => {
    // Mention references a fact not in cards; e1 still becomes its own component
    // (a singleton, since its only partner is absent).
    const cards = [entity('e1', 'person')];
    const mentions = [mention('e1', 'ghost-fact')];
    const { memberOf } = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect(memberOf.has('e1')).toBe(true);
    // e1's only connection is to a non-card; it is effectively isolated.
    expect(memberOf.get('e1')).toBe(ISOLATED_KEY);
  });

  it('is deterministic', () => {
    const cards = [entity('e1', 'person'), entity('e2', 'person'), fact('f1')];
    const mentions = [mention('e1', 'f1'), mention('e2', 'f1')];
    const a = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    const b = groupBy('cooccurrence', cards, NO_EDGES, mentions, NO_SIM);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
    expect(a.groups).toEqual(b.groups);
  });
});

describe('groupBy — similarity (server cluster map)', () => {
  it('groups facts by their clusterId from the similarity map', () => {
    const cards = [fact('f1'), fact('f2'), fact('f3')];
    const sim = new Map<string, string>([
      ['f1', 'sc-0'],
      ['f2', 'sc-0'],
      ['f3', 'sc-1'],
    ]);
    const { memberOf } = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect(memberOf.get('f1')).toBe('sc-0');
    expect(memberOf.get('f2')).toBe('sc-0');
    expect(memberOf.get('f3')).toBe('sc-1');
    expect(memberOf.get('f1')).not.toBe(memberOf.get('f3'));
  });

  it('routes a card absent from the map into the unclustered bucket', () => {
    const cards = [fact('f1'), fact('f2')];
    const sim = new Map<string, string>([['f1', 'sc-0']]);
    const { memberOf, groups } = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect(memberOf.get('f1')).toBe('sc-0');
    expect(memberOf.get('f2')).toBe(SIM_UNCLUSTERED_KEY);
    expect(groups.find((g) => g.key === SIM_UNCLUSTERED_KEY)!.count).toBe(1);
  });

  it('counts members per cluster correctly and orders by descending count', () => {
    const cards = [fact('f1'), fact('f2'), fact('f3'), fact('f4')];
    const sim = new Map<string, string>([
      ['f1', 'sc-0'],
      ['f2', 'sc-0'],
      ['f3', 'sc-0'],
      ['f4', 'sc-1'],
    ]);
    const { groups } = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect(groups[0].key).toBe('sc-0');
    expect(groups[0].count).toBe(3);
    expect(groups[1].key).toBe('sc-1');
  });

  it('with an empty map, every card is unclustered (single group)', () => {
    const cards = [fact('f1'), fact('f2')];
    const { memberOf, groups } = groupBy(
      'similarity', cards, NO_EDGES, NO_MENTIONS, new Map(),
    );
    expect(memberOf.get('f1')).toBe(SIM_UNCLUSTERED_KEY);
    expect(memberOf.get('f2')).toBe(SIM_UNCLUSTERED_KEY);
    expect(groups.length).toBe(1);
    expect(groups[0].count).toBe(2);
  });

  it('is deterministic', () => {
    const cards = [fact('f1'), fact('f2')];
    const sim = new Map<string, string>([['f1', 'sc-0'], ['f2', 'sc-1']]);
    const a = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    const b = groupBy('similarity', cards, NO_EDGES, NO_MENTIONS, sim);
    expect([...a.memberOf.entries()]).toEqual([...b.memberOf.entries()]);
    expect(a.groups).toEqual(b.groups);
  });
});
