import { describe, it, expect } from 'vitest';
import {
  buildNetwork,
  directoryOf,
  layerOf,
  recencyOf,
  worstVerdict,
  historyOf,
  MAX_NODES,
  type NodeRow,
  type EdgeRow,
} from './network';

const NOW = Date.UTC(2026, 7, 17);
const day = (n: number) => new Date(NOW - n * 86_400_000);

function node(path: string, extra: Partial<NodeRow> = {}): NodeRow {
  return {
    id: `n:${path}`,
    canonicalPath: path,
    kind: 'file',
    displayName: path.split('/').pop() ?? path,
    summary: null,
    episodeCount: 0,
    lessonCount: 0,
    existsOnHead: true,
    lastSeenAt: day(1),
    ...extra,
  };
}

function edge(a: string, b: string, extra: Partial<EdgeRow> = {}): EdgeRow {
  return {
    id: `e:${a}:${b}`,
    sourceId: `n:${a}`,
    targetId: `n:${b}`,
    kind: 'co_change',
    weight: 1,
    lastSeenAt: day(1),
    ...extra,
  };
}

const base = { groupBy: 'directory' as const, liveness: 'all' as const };

describe('slicing dimensions', () => {
  it('groups by directory two segments deep, where the meaning is', () => {
    // `src` alone says nothing; `src/lib/jkai` says a great deal.
    expect(directoryOf('src/lib/jkai/executor.ts')).toBe('src/lib/jkai');
    expect(directoryOf('scripts/ci-release.sh')).toBe('scripts');
    expect(directoryOf('README.md')).toBe('(root)');
  });

  it('groups by layer, with tests recognised by filename not location', () => {
    expect(layerOf('src/routes/api/jkai/x/+server.ts')).toBe('API routes');
    expect(layerOf('src/routes/jkai/+page.svelte')).toBe('Pages');
    expect(layerOf('src/lib/components/intel/NetworkGraph.svelte')).toBe('Components');
    expect(layerOf('src/lib/workflows/site-tools/registry.ts')).toBe('Workflows');
    expect(layerOf('scripts/ci-release.sh')).toBe('Scripts');
    // A test beside its subject is still a test.
    expect(layerOf('src/lib/codegraph/query.test.ts')).toBe('Tests');
  });

  it('assigns one community id per group label, stable across nodes', () => {
    const net = buildNetwork({
      nodes: [
        node('src/lib/jkai/a.ts'),
        node('src/lib/jkai/b.ts'),
        node('scripts/c.mjs'),
      ],
      edges: [],
      filters: { ...base, groupBy: 'directory' },
      now: NOW,
    });
    // Looked up by name, not by position: output order is the deterministic
    // history-then-path ranking, not input order.
    const find = (n: string) => net.nodes.find((x) => x.name === n)!;
    expect(find('a.ts').community).toBe(find('b.ts').community);
    expect(find('c.mjs').community).not.toBe(find('a.ts').community);
    expect(net.communities.map((x) => x.label).sort()).toEqual(['scripts', 'src/lib/jkai']);
  });

  it('re-slices the same graph by outcome', () => {
    const net = buildNetwork({
      nodes: [
        node('a.ts', { verdict: 'verified', episodeCount: 1 }),
        node('b.ts', { verdict: 'repaired', episodeCount: 1 }),
        node('c.ts', { verdict: 'verified', episodeCount: 1 }),
      ],
      edges: [],
      filters: { ...base, groupBy: 'verdict' },
      now: NOW,
    });
    const labels = net.communities.map((c) => c.label).sort();
    expect(labels).toEqual(['repaired', 'verified']);
    const byName = (n: string) => net.nodes.find((x) => x.name === n)!;
    expect(byName('a.ts').community).toBe(byName('c.ts').community);
    expect(byName('b.ts').community).not.toBe(byName('a.ts').community);
  });

  it('bands by activity when asked', () => {
    const net = buildNetwork({
      nodes: [
        node('cold.ts'),
        node('warm.ts', { episodeCount: 2 }),
        node('hot.ts', { episodeCount: 6, lessonCount: 6 }),
      ],
      edges: [],
      filters: { ...base, groupBy: 'activity' },
      now: NOW,
    });
    expect(net.communities.map((c) => c.label).sort()).toEqual([
      'Hot path',
      'No history',
      'Some history',
    ]);
  });
});

describe('filters', () => {
  it('records keyword hits but does NOT remove the context around them', () => {
    // The components dim non-matches. Filtering them out would leave a keyword
    // view with no edges, which says nothing about a network.
    const net = buildNetwork({
      nodes: [node('src/lib/jkai/executor.ts'), node('src/lib/other/thing.ts')],
      edges: [edge('src/lib/jkai/executor.ts', 'src/lib/other/thing.ts')],
      filters: { ...base, q: 'executor' },
      now: NOW,
    });
    expect(net.nodes).toHaveLength(2);
    expect(net.edges).toHaveLength(1);
    expect(net.matched).toEqual(['n:src/lib/jkai/executor.ts']);
  });

  it('filters by liveness, and a deleted file is drawn as unconfirmed', () => {
    const nodes = [node('live.ts'), node('gone.ts', { existsOnHead: false })];
    expect(buildNetwork({ nodes, edges: [], filters: { ...base, liveness: 'live' }, now: NOW }).nodes)
      .toHaveLength(1);
    const deleted = buildNetwork({
      nodes,
      edges: [],
      filters: { ...base, liveness: 'deleted' },
      now: NOW,
    });
    expect(deleted.nodes).toHaveLength(1);
    expect(deleted.nodes[0].confirmed).toBe(false);
  });

  it('drops the silent majority on request', () => {
    const net = buildNetwork({
      nodes: [node('quiet.ts'), node('loud.ts', { episodeCount: 3 })],
      edges: [],
      filters: { ...base, onlyWithHistory: true },
      now: NOW,
    });
    expect(net.nodes.map((n) => n.name)).toEqual(['loud.ts']);
  });

  it('filters edges by kind without dropping their endpoints', () => {
    const net = buildNetwork({
      nodes: [node('a.ts'), node('b.ts')],
      edges: [edge('a.ts', 'b.ts', { kind: 'needs_context' })],
      filters: { ...base, edgeKinds: ['co_change'] },
      now: NOW,
    });
    expect(net.nodes).toHaveLength(2);
    expect(net.edges).toHaveLength(0);
  });

  it('never draws a self-edge', () => {
    const net = buildNetwork({
      nodes: [node('a.ts')],
      edges: [edge('a.ts', 'a.ts')],
      filters: base,
      now: NOW,
    });
    expect(net.edges).toHaveLength(0);
  });
});

describe('encodings the components rely on', () => {
  it('sizes by history carried, normalised to the busiest file', () => {
    const net = buildNetwork({
      nodes: [node('hot.ts', { episodeCount: 8, lessonCount: 2 }), node('cold.ts')],
      edges: [],
      filters: base,
      now: NOW,
    });
    expect(net.nodes[0].importance).toBe(1);
    expect(net.nodes[1].importance).toBe(0);
  });

  it('fades old files to a floor rather than to nothing', () => {
    expect(recencyOf(day(1), NOW)).toBe(1);
    expect(recencyOf(day(365), NOW)).toBeCloseTo(0.35, 5);
    // A file with no last-seen is unknown, not ancient.
    expect(recencyOf(null, NOW)).toBe(0.5);
  });

  it('marks cross-community edges so the component can accent them', () => {
    const net = buildNetwork({
      nodes: [node('src/lib/a.ts'), node('scripts/b.mjs')],
      edges: [edge('src/lib/a.ts', 'scripts/b.mjs')],
      filters: base,
      now: NOW,
    });
    expect(net.edges[0].crossCommunity).toBe(true);
  });

  it('counts isolated nodes — in a code graph most files really are', () => {
    const net = buildNetwork({
      nodes: [node('a.ts'), node('b.ts'), node('lonely.ts')],
      edges: [edge('a.ts', 'b.ts')],
      filters: base,
      now: NOW,
    });
    expect(net.stats.isolated).toBe(1);
  });
});

describe('trimming', () => {
  it('keeps the busiest files and says so', () => {
    const nodes = Array.from({ length: 50 }, (_, i) =>
      node(`src/f${String(i).padStart(2, '0')}.ts`, { episodeCount: i }),
    );
    const net = buildNetwork({ nodes, edges: [], filters: { ...base, limit: 10 }, now: NOW });
    expect(net.nodes).toHaveLength(10);
    expect(net.trimmed).toBe(true);
    expect(net.stats.totalNodes).toBe(50);
    // The busiest survived, the quietest did not.
    expect(net.nodes[0].name).toBe('f49.ts');
  });

  it('never exceeds the hard cap even when asked to', () => {
    const net = buildNetwork({
      nodes: [node('a.ts')],
      edges: [],
      filters: { ...base, limit: 99_999 },
      now: NOW,
    });
    expect(net.stats.shown).toBeLessThanOrEqual(MAX_NODES);
  });

  it('draws the same graph the same way twice', () => {
    const nodes = [node('b.ts', { episodeCount: 2 }), node('a.ts', { episodeCount: 2 })];
    const one = buildNetwork({ nodes, edges: [], filters: base, now: NOW });
    const two = buildNetwork({ nodes: [...nodes].reverse(), edges: [], filters: base, now: NOW });
    expect(one.nodes.map((n) => n.id)).toEqual(two.nodes.map((n) => n.id));
  });
});

describe('verdict ranking', () => {
  it('surfaces the worst outcome on a file, not the latest', () => {
    // A file that was verified and later repaired is a file that needed
    // repairing — that is the fact worth colouring.
    expect(worstVerdict(['verified', 'repaired'])).toBe('repaired');
    expect(worstVerdict(['landed', 'verified'])).toBe('landed');
    expect(worstVerdict([])).toBeNull();
    expect(worstVerdict(['nonsense'])).toBeNull();
  });

  it('counts history as episodes plus lessons', () => {
    expect(historyOf({ episodeCount: 2, lessonCount: 3 })).toBe(5);
  });
});
