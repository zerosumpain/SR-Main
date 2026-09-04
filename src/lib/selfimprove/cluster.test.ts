import { describe, it, expect } from 'vitest';
import {
  clusterBacklog,
  clusterSlug,
  clusterWeight,
  labelFor,
  sharedKeywords,
} from './cluster';
import { looksSameSubject } from './narrative';
import type { BacklogItemData } from './types';

function item(slug: string, title: string, over: Partial<BacklogItemData> = {}): BacklogItemData {
  return {
    slug,
    title,
    detail: '',
    kind: 'tool',
    status: 'open',
    priority: 2,
    attempts: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

/** The real shape the clusterer was built for: ten ways of asking for one
 *  tool. Verbatim from production's `improvement_backlog`. */
const OPENROUTER = [
  item('a', 'Live OpenRouter account balance API'),
  item('b', 'Live OpenRouter balance'),
  item('c', 'Live OpenRouter balance query'),
  item('d', 'Live OpenRouter balance query via API'),
  item('e', 'OpenRouter account balance API'),
];

const DELIVERY = [
  item('p', 'Delivery-status monitoring and alerts'),
  item('q', 'Delivery-status monitoring'),
  item('r', 'Delivery status monitoring with alerts'),
];

describe('clusterBacklog', () => {
  it('groups every restatement of one idea when nothing bridges out of it', () => {
    const res = clusterBacklog(OPENROUTER, new Set(), { linksPerItem: 99 });
    expect(res.clusters).toHaveLength(1);
    expect(res.clusters[0].memberSlugs.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(res.singletons).toBe(0);
  });

  // The default is conservative on purpose. It can split one theme into two
  // tight sub-themes rather than risk welding two themes together — measured
  // on production as 113 clusters covering 380 of 455 rows with no runaway,
  // against a 309-item blob at single linkage. Two lanes to fold by hand is a
  // better failure than the wrong items abandoned on a matcher's say-so.
  it('groups every member of a theme, whether into one lane or two', () => {
    const res = clusterBacklog(OPENROUTER);
    expect(res.singletons).toBe(0);
    const grouped = res.clusters.flatMap((c) => c.memberSlugs).sort();
    expect(grouped).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps two unrelated themes apart', () => {
    const res = clusterBacklog([...OPENROUTER, ...DELIVERY], new Set(), { linksPerItem: 99 });
    expect(res.clusters).toHaveLength(2);
    const sizes = res.clusters.map((c) => c.memberSlugs.length).sort();
    expect(sizes).toEqual([3, 5]);
    // No cluster mixes the two subjects, at any link setting.
    for (const c of clusterBacklog([...OPENROUTER, ...DELIVERY]).clusters) {
      const hasOr = c.memberSlugs.some((s) => 'abcde'.includes(s));
      const hasDel = c.memberSlugs.some((s) => 'pqr'.includes(s));
      expect(hasOr && hasDel).toBe(false);
    }
  });

  it('leaves an unrelated item alone rather than forcing it somewhere', () => {
    const res = clusterBacklog([...OPENROUTER, item('z', 'Tide times for the Norfolk Broads')]);
    expect(res.clusters.flatMap((c) => c.memberSlugs)).not.toContain('z');
    expect(res.singletons).toBe(1);
  });

  // Every verdict comes from narrative.ts. If this file ever grows its own
  // matcher, this is the test that should stop it.
  it('never groups a pair the shared predicate rejects', () => {
    const items = [...OPENROUTER, ...DELIVERY, item('z', 'Tide times for the Norfolk Broads')];
    const res = clusterBacklog(items, new Set(), { linksPerItem: 99 });
    const titleOf = new Map(items.map((i) => [i.slug, i.title]));
    for (const c of res.clusters) {
      for (const s of c.memberSlugs) {
        const linked = c.memberSlugs.some(
          (o) => o !== s && looksSameSubject(titleOf.get(s) ?? '', titleOf.get(o) ?? ''),
        );
        expect(linked).toBe(true);
      }
    }
  });

  it('reports how much work the pre-filter saved', () => {
    const res = clusterBacklog([...OPENROUTER, ...DELIVERY]);
    const allPairs = (8 * 7) / 2;
    expect(res.pairsConsidered).toBeLessThan(allPairs);
    expect(res.pairsPassed).toBeGreaterThan(0);
  });

  // Single linkage chained 309 of production's 455 rows into one component.
  // Joining only the strongest partner is what stops that, and the difference
  // must stay visible in a test rather than living in a comment.
  it('resists chaining two themes through a bridging title', () => {
    const bridge = item('bridge', 'Live OpenRouter balance delivery status monitoring');
    const items = [...OPENROUTER, ...DELIVERY, bridge];
    const single = clusterBacklog(items, new Set(), { linksPerItem: 99 });
    const strongest = clusterBacklog(items, new Set(), { linksPerItem: 1 });
    const biggest = (r: ReturnType<typeof clusterBacklog>) =>
      Math.max(...r.clusters.map((c) => c.memberSlugs.length));
    // Single linkage swallows both themes and the bridge into one component.
    expect(biggest(single)).toBe(9);
    // Strongest-link refuses: the bridge can only take its own best partner.
    expect(biggest(strongest)).toBeLessThan(9);
  });

  it('drops a runaway component whole, and says how big it was', () => {
    const res = clusterBacklog(OPENROUTER, new Set(), { maxClusterSize: 3, linksPerItem: 99 });
    expect(res.clusters).toHaveLength(0);
    expect(res.oversized).toEqual([{ label: 'Live OpenRouter balance', size: 5 }]);
    // Its members are counted as ungrouped, not silently lost.
    expect(res.singletons).toBe(5);
  });

  it('separates open from shipped members and counts the served ones', () => {
    const res = clusterBacklog(
      [...OPENROUTER.slice(0, 3), item('done', 'Live OpenRouter balance tool', { status: 'shipped' })],
      new Set(['a', 'b']),
      { linksPerItem: 99 },
    );
    const [c] = res.clusters;
    expect(c.shippedSlugs).toEqual(['done']);
    expect(c.openSlugs).toHaveLength(3);
    expect(c.servedCount).toBe(2);
  });

  it('orders members oldest first, the way the queue reads', () => {
    const res = clusterBacklog([
      item('new', 'Live OpenRouter balance query', { createdAt: '2026-08-20T00:00:00.000Z' }),
      item('old', 'Live OpenRouter balance', { createdAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(res.clusters[0].memberSlugs).toEqual(['old', 'new']);
  });

  it('puts the theme with the most open work first', () => {
    const res = clusterBacklog([...DELIVERY, ...OPENROUTER], new Set(), { linksPerItem: 99 });
    expect(res.clusters[0].memberSlugs).toHaveLength(5);
  });

  it('survives an empty queue', () => {
    const res = clusterBacklog([]);
    expect(res.clusters).toEqual([]);
    expect(res.pairsConsidered).toBe(0);
  });
});

describe('clusterSlug', () => {
  it('is stable across member order', () => {
    expect(clusterSlug(['b', 'a', 'c'])).toBe(clusterSlug(['a', 'b', 'c']));
  });

  // Membership changing is a different grouping, so a different claim — which
  // is what lets a declined theme be re-proposed once its members change.
  it('changes when the membership changes', () => {
    expect(clusterSlug(['a', 'b'])).not.toBe(clusterSlug(['a', 'b', 'c']));
  });

  it('carries the member count, so a hash collision cannot merge two sizes', () => {
    expect(clusterSlug(['a', 'b'])).toMatch(/^epic:2-/);
    expect(clusterSlug(['a', 'b', 'c'])).toMatch(/^epic:3-/);
  });
});

describe('labelFor and sharedKeywords', () => {
  // Nothing in this engine writes a sentence about its own work — a stored
  // line always renders as recorded, so an invented one would stamp full
  // confidence on a guess.
  it('takes the shortest title verbatim rather than composing one', () => {
    const titles = OPENROUTER.map((i) => i.title);
    expect(titles).toContain(labelFor(titles));
    expect(labelFor(titles)).toBe('Live OpenRouter balance');
  });

  it('is deterministic when two titles tie on length', () => {
    expect(labelFor(['bbbb', 'aaaa'])).toBe('aaaa');
  });

  it('returns words the members actually share, commonest first', () => {
    const words = sharedKeywords(OPENROUTER.map((i) => i.title), 5);
    expect(words).toContain('openrouter');
    expect(words).toContain('balance');
    // Function words are not content.
    expect(words).not.toContain('via');
  });

  it('returns nothing for a single title, which shares nothing', () => {
    expect(sharedKeywords(['Live OpenRouter balance'], 5)).toEqual([]);
  });
});

describe('clusterWeight', () => {
  it('scores a bigger, more-duplicated theme higher', () => {
    const small = clusterWeight({
      slug: 'x', label: 'x', keywords: [], memberSlugs: ['a', 'b'],
      openSlugs: ['a', 'b'], shippedSlugs: [], servedCount: 0,
    });
    const big = clusterWeight({
      slug: 'y', label: 'y', keywords: [], memberSlugs: ['a', 'b', 'c', 'd', 'e'],
      openSlugs: ['a', 'b', 'c', 'd'], shippedSlugs: ['e'], servedCount: 3,
    });
    expect(big.score).toBeGreaterThan(small.score);
  });

  // A number nobody can decompose is a number nobody should act on — the rule
  // `scoreCapability` set.
  it('names every input', () => {
    const { components } = clusterWeight({
      slug: 'y', label: 'y', keywords: [], memberSlugs: ['a', 'b'],
      openSlugs: ['a', 'b'], shippedSlugs: [], servedCount: 1,
    });
    expect(Object.keys(components).sort()).toEqual(['served', 'shipped', 'size']);
  });
});
