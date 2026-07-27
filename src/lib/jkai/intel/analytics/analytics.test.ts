import { describe, it, expect } from 'vitest';
import { buildIndex, hopNeighbourhood, components, pairKey, type GraphSnapshot } from './model';
import { betweenness, pagerank, computeCentrality, brokerageScore } from './centrality';
import { detectCommunities, modularity } from './community';
import { findPaths, shortestPath, commonNeighbours, adamicAdar } from './paths';
import { scoreSurprisingLinks, predictMissingLinks, findBridges, cosineDistance } from './surprise';

let seq = 0;
function node(id: string, typeName = 'person'): GraphSnapshot['nodes'][number] {
  return {
    id,
    name: id.toUpperCase(),
    typeId: `type-${typeName}`,
    typeName,
    icon: '🔷',
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
  };
}
function edge(a: string, b: string, type = 'knows'): GraphSnapshot['edges'][number] {
  return {
    id: `e${seq++}`,
    source: a,
    target: b,
    type,
    label: null,
    confidence: 'high',
    strength: 'moderate',
    createdAt: 0,
  };
}

/**
 * Two triangles joined by a single edge b–c. `b` and `c` are the brokers, and
 * the two triangles are the two communities.
 *   a─b─c─d
 *   │ │ │ │   (a,b,x) and (c,d,y) are triangles
 *   x─┘ └─y
 */
function barbell(): GraphSnapshot {
  return {
    nodes: ['a', 'b', 'x', 'c', 'd', 'y'].map((n) => node(n)),
    edges: [
      edge('a', 'b'),
      edge('a', 'x'),
      edge('b', 'x'),
      edge('c', 'd'),
      edge('c', 'y'),
      edge('d', 'y'),
      edge('b', 'c'), // the bridge
    ],
  };
}

describe('model', () => {
  it('builds undirected adjacency and degrees', () => {
    const index = buildIndex(barbell());
    expect(index.degree.get('b')).toBe(3); // a, x, c
    expect(index.degree.get('a')).toBe(2);
    expect(index.neighbours.get('c')!.has('b')).toBe(true);
    expect(index.neighbours.get('b')!.has('c')).toBe(true);
  });

  it('ignores edges pointing outside the snapshot and self-loops', () => {
    const index = buildIndex({
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b'), edge('a', 'ghost'), edge('a', 'a')],
    });
    expect(index.degree.get('a')).toBe(1);
    expect(index.byId.has('ghost')).toBe(false);
  });

  it('measures hop distance outward from a node', () => {
    const index = buildIndex(barbell());
    const reach = hopNeighbourhood(index, 'a', 3);
    expect(reach.get('a')).toBe(0);
    expect(reach.get('b')).toBe(1);
    expect(reach.get('c')).toBe(2);
    expect(reach.get('d')).toBe(3);
  });

  it('respects the hop ceiling', () => {
    const index = buildIndex(barbell());
    const reach = hopNeighbourhood(index, 'a', 2);
    expect(reach.has('c')).toBe(true);
    expect(reach.has('d')).toBe(false);
  });

  it('separates disconnected components, largest first', () => {
    const index = buildIndex({
      nodes: ['a', 'b', 'c', 'lonely'].map((n) => node(n)),
      edges: [edge('a', 'b'), edge('b', 'c')],
    });
    const comps = components(index);
    expect(comps).toHaveLength(2);
    expect(comps[0]).toHaveLength(3);
    expect(comps[1]).toEqual(['lonely']);
  });

  it('produces a stable key regardless of pair order', () => {
    expect(pairKey('z', 'a')).toBe(pairKey('a', 'z'));
  });
});

describe('centrality', () => {
  it('ranks the bridge nodes highest on betweenness', () => {
    const index = buildIndex(barbell());
    const btw = betweenness(index);
    // b and c are the only route between the two triangles.
    expect(btw.get('b')!).toBeGreaterThan(btw.get('a')!);
    expect(btw.get('c')!).toBeGreaterThan(btw.get('d')!);
    expect(btw.get('b')!).toBeCloseTo(btw.get('c')!, 6);
  });

  it('gives a leaf node zero betweenness', () => {
    const index = buildIndex({
      nodes: ['hub', 'l1', 'l2'].map((n) => node(n)),
      edges: [edge('hub', 'l1'), edge('hub', 'l2')],
    });
    const btw = betweenness(index);
    expect(btw.get('l1')).toBe(0);
    expect(btw.get('hub')!).toBeGreaterThan(0);
  });

  it('produces a pagerank vector that sums to one', () => {
    const index = buildIndex(barbell());
    const pr = pagerank(index);
    const total = [...pr.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('ranks a hub above its leaves on pagerank', () => {
    const index = buildIndex({
      nodes: ['hub', 'l1', 'l2', 'l3'].map((n) => node(n)),
      edges: [edge('hub', 'l1'), edge('hub', 'l2'), edge('hub', 'l3')],
    });
    const pr = pagerank(index);
    expect(pr.get('hub')!).toBeGreaterThan(pr.get('l1')!);
  });

  it('handles an empty graph without throwing', () => {
    const index = buildIndex({ nodes: [], edges: [] });
    expect(computeCentrality(index).pagerank.size).toBe(0);
  });

  it('scores a low-degree broker above a high-degree hub', () => {
    // A star hub has high betweenness but no brokerage merit; the barbell
    // bridge earns its position with only three links.
    const index = buildIndex(barbell());
    const scores = computeCentrality(index);
    expect(brokerageScore('b', scores, index)).toBeGreaterThan(brokerageScore('a', scores, index));
  });

  it('gives a node with fewer than two links no brokerage score', () => {
    const index = buildIndex({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
    const scores = computeCentrality(index);
    expect(brokerageScore('a', scores, index)).toBe(0);
  });
});

describe('community detection', () => {
  it('finds the two triangles of a barbell', () => {
    const index = buildIndex(barbell());
    const result = detectCommunities(index);
    expect(result.communities.size).toBe(2);
    // a and x sit with b; d and y sit with c.
    expect(result.membership.get('a')).toBe(result.membership.get('x'));
    expect(result.membership.get('d')).toBe(result.membership.get('y'));
    expect(result.membership.get('a')).not.toBe(result.membership.get('d'));
  });

  it('reports positive modularity for a genuinely clustered graph', () => {
    const result = detectCommunities(buildIndex(barbell()));
    expect(result.modularity).toBeGreaterThan(0.2);
  });

  it('numbers communities by size, largest first', () => {
    const snapshot: GraphSnapshot = {
      nodes: ['a', 'b', 'c', 'd', 'p', 'q'].map((n) => node(n)),
      edges: [
        edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'c'), edge('b', 'd'), edge('a', 'd'),
        edge('p', 'q'),
      ],
    };
    const result = detectCommunities(buildIndex(snapshot));
    expect(result.communities.get(0)!.length).toBeGreaterThanOrEqual(result.communities.get(1)!.length);
  });

  it('is deterministic across runs', () => {
    const index = buildIndex(barbell());
    const a = detectCommunities(index);
    const b = detectCommunities(index);
    expect([...a.membership.entries()].sort()).toEqual([...b.membership.entries()].sort());
  });

  it('survives an edgeless graph', () => {
    const index = buildIndex({ nodes: [node('a'), node('b')], edges: [] });
    const result = detectCommunities(index);
    expect(result.modularity).toBe(0);
    expect(result.membership.size).toBe(2);
  });

  it('scores a random-ish partition below the detected one', () => {
    const index = buildIndex(barbell());
    const detected = detectCommunities(index);
    const bad = new Map(index.ids.map((id, i) => [id, i % 2]));
    expect(detected.modularity).toBeGreaterThan(modularity(index, bad));
  });
});

describe('paths', () => {
  it('finds the shortest route across the bridge', () => {
    const index = buildIndex(barbell());
    const path = shortestPath(index, 'a', 'd');
    expect(path).not.toBeNull();
    expect(path!.nodes[0]).toBe('a');
    expect(path!.nodes.at(-1)).toBe('d');
    expect(path!.hops).toBe(3); // a-b-c-d
  });

  it('attaches the real edges to each step', () => {
    const index = buildIndex(barbell());
    const path = shortestPath(index, 'a', 'c')!;
    expect(path.steps).toHaveLength(2);
    expect(path.steps[0].edges.length).toBeGreaterThan(0);
    expect(path.steps[0].edges[0].type).toBe('knows');
  });

  it('returns null when there is no route', () => {
    const index = buildIndex({
      nodes: [node('a'), node('b')],
      edges: [],
    });
    expect(shortestPath(index, 'a', 'b')).toBeNull();
  });

  it('returns nothing for a node paired with itself', () => {
    const index = buildIndex(barbell());
    expect(findPaths(index, 'a', 'a')).toEqual([]);
  });

  it('respects the hop ceiling', () => {
    const index = buildIndex(barbell());
    expect(shortestPath(index, 'a', 'd', 2)).toBeNull();
    expect(shortestPath(index, 'a', 'd', 3)).not.toBeNull();
  });

  it('returns a directly-connected pair exactly once', () => {
    // Regression: a direct edge has no intermediates to penalise, so the
    // alternative-route loop re-found it every iteration and callers got
    // `limit` identical copies of the same one-hop path.
    const index = buildIndex({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
    const paths = findPaths(index, 'a', 'b', { limit: 3 });
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['a', 'b']);
  });

  it('never returns the same route twice', () => {
    const index = buildIndex(barbell());
    const paths = findPaths(index, 'a', 'd', { limit: 4, maxHops: 5 });
    const signatures = paths.map((p) => p.nodes.join('>'));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('finds genuinely different alternative routes', () => {
    // Two parallel routes from s to t: via m1 and via m2.
    const index = buildIndex({
      nodes: ['s', 'm1', 'm2', 't'].map((n) => node(n)),
      edges: [edge('s', 'm1'), edge('m1', 't'), edge('s', 'm2'), edge('m2', 't')],
    });
    const paths = findPaths(index, 's', 't', { limit: 2 });
    expect(paths).toHaveLength(2);
    expect(paths[0].nodes[1]).not.toBe(paths[1].nodes[1]);
  });

  it('counts common neighbours symmetrically', () => {
    const index = buildIndex(barbell());
    expect(commonNeighbours(index, 'a', 'b')).toEqual(['x']);
    expect(commonNeighbours(index, 'b', 'a')).toEqual(['x']);
  });

  it('weights a niche shared connection above a hub one in Adamic-Adar', () => {
    // a and b share the niche node `n` (degree 2); c and d share hub (degree 20).
    const hubLeaves = Array.from({ length: 18 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['a', 'b', 'n', 'c', 'd', 'hub', ...hubLeaves].map((x) => node(x)),
      edges: [
        edge('a', 'n'), edge('b', 'n'),
        edge('c', 'hub'), edge('d', 'hub'),
        ...hubLeaves.map((l) => edge('hub', l)),
      ],
    });
    expect(adamicAdar(index, 'a', 'b')).toBeGreaterThan(adamicAdar(index, 'c', 'd'));
  });
});

describe('surprise scoring', () => {
  const ctx = () => {
    const index = buildIndex(barbell());
    return { index, membership: detectCommunities(index).membership };
  };

  it('ranks the cross-cluster bridge as the most surprising link', () => {
    const links = scoreSurprisingLinks(ctx(), { maxHops: 2 });
    expect(links.length).toBeGreaterThan(0);
    const top = links[0];
    expect(pairKey(top.a, top.b)).toBe(pairKey('b', 'c'));
    expect(top.crossCommunity).toBe(true);
    expect(top.hops).toBe(1);
  });

  it('explains itself in readable reasons', () => {
    const links = scoreSurprisingLinks(ctx(), { maxHops: 2 });
    expect(links[0].reasons).toContain('joins two separate clusters');
    expect(links[0].reasons.join(' ')).toMatch(/directly connected|hops apart/);
  });

  it('treats a pair inside one triangle as unremarkable', () => {
    const links = scoreSurprisingLinks(ctx(), { maxHops: 2, minScore: 0 });
    const ax = links.find((l) => pairKey(l.a, l.b) === pairKey('a', 'x'))!;
    const bc = links.find((l) => pairKey(l.a, l.b) === pairKey('b', 'c'))!;
    expect(ax.score).toBeLessThan(bc.score);
  });

  it('uses embeddings to raise semantically distant pairs', () => {
    const index = buildIndex(barbell());
    const membership = detectCommunities(index).membership;
    const near = new Map([['b', [1, 0]], ['c', [1, 0]]]);
    const far = new Map([['b', [1, 0]], ['c', [-1, 0]]]);

    const scoreWith = (embeddings: Map<string, number[]>) =>
      scoreSurprisingLinks({ index, membership, embeddings }, { maxHops: 1, minScore: 0 })
        .find((l) => pairKey(l.a, l.b) === pairKey('b', 'c'))!.score;

    expect(scoreWith(far)).toBeGreaterThan(scoreWith(near));
  });

  it('never lets an unknown embedding count as evidence either way', () => {
    const links = scoreSurprisingLinks(ctx(), { maxHops: 1, minScore: 0 });
    expect(links.every((l) => l.semanticDistance === null)).toBe(true);
  });


  it('discounts links to a hub as expected rather than surprising', () => {
    // `hub` touches everything; `p`–`q` is an isolated pair. Under the
    // configuration model a hub link is the LEAST surprising thing here.
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [...leaves.map((l) => edge('hub', l)), edge('p', 'q')],
    });
    const membership = detectCommunities(index).membership;
    const links = scoreSurprisingLinks({ index, membership }, { maxHops: 1, minScore: 0 });
    const pq = links.find((l) => pairKey(l.a, l.b) === pairKey('p', 'q'))!;
    const hubLink = links.find((l) => l.a === 'hub' || l.b === 'hub')!;
    expect(pq.score).toBeGreaterThan(hubLink.score);
  });

  it('says so when neither endpoint is a hub', () => {
    // Expectedness is deg(a)·deg(b)/2m, so the pair must be peripheral in a
    // graph with enough edges for "hub" to mean anything.
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [...leaves.map((l) => edge('hub', l)), edge('p', 'q')],
    });
    const membership = detectCommunities(index).membership;
    const links = scoreSurprisingLinks({ index, membership }, { maxHops: 1, minScore: 0 });
    const pq = links.find((l) => pairKey(l.a, l.b) === pairKey('p', 'q'))!;
    expect(pq.reasons).toContain('neither is a hub');

    const hubLink = links.find((l) => l.a === 'hub' || l.b === 'hub')!;
    expect(hubLink.reasons).not.toContain('neither is a hub');
  });

  it('does not gate out a pair that is also joined through a non-hub', () => {
    // p and q are joined BOTH through a hub and through an obscure node. The
    // hub gate must not fire, because a genuinely specific route exists — this
    // used to depend on whichever route BFS reached first.
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'niche', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [
        ...leaves.map((l) => edge('hub', l)),
        edge('p', 'hub'), edge('q', 'hub'),
        edge('p', 'niche'), edge('q', 'niche'),
      ],
    });
    const membership = detectCommunities(index).membership;
    // High limit: this graph produces many low-scoring pairs and the point here
    // is presence, not rank.
    const links = scoreSurprisingLinks({ index, membership }, { maxHops: 2, minScore: 0, limit: 500 });
    const pq = links.find((l) => pairKey(l.a, l.b) === pairKey('p', 'q'));
    expect(pq).toBeDefined();
    expect(pq!.reasons.join(' ').toLowerCase()).toContain('niche');
  });

  it('still gates out a pair joined ONLY through hubs', () => {
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [...leaves.map((l) => edge('hub', l)), edge('p', 'hub'), edge('q', 'hub')],
    });
    const membership = detectCommunities(index).membership;
    const links = scoreSurprisingLinks({ index, membership }, { maxHops: 2, minScore: 0, limit: 500 });
    expect(links.some((l) => pairKey(l.a, l.b) === pairKey('p', 'q'))).toBe(false);
  });

  it('honours the result limit', () => {
    const links = scoreSurprisingLinks(ctx(), { maxHops: 3, minScore: 0, limit: 2 });
    expect(links).toHaveLength(2);
  });

  it('predicts the link between two nodes that share a neighbour', () => {
    const index = buildIndex({
      nodes: ['a', 'b', 'n1', 'n2', 'n3'].map((n) => node(n)),
      edges: [
        edge('a', 'n1'), edge('a', 'n2'), edge('a', 'n3'),
        edge('b', 'n1'), edge('b', 'n2'), edge('b', 'n3'),
      ],
    });
    const preds = predictMissingLinks({ index, membership: new Map() }, { minScore: 0 });
    const ab = preds.find((p) => pairKey(p.a, p.b) === pairKey('a', 'b'));
    expect(ab).toBeDefined();
    expect(ab!.sharedNeighbours.sort()).toEqual(['n1', 'n2', 'n3']);
    expect(ab!.reason).toMatch(/Share 3 connections/);
  });

  it('never predicts a link that already exists', () => {
    const index = buildIndex(barbell());
    const preds = predictMissingLinks({ index, membership: new Map() }, { minScore: 0 });
    for (const p of preds) {
      expect(index.neighbours.get(p.a)!.has(p.b)).toBe(false);
    }
  });

  it('identifies the nodes joining two communities', () => {
    const c = ctx();
    const bridges = findBridges(c);
    const ids = bridges.map((b) => b.id);
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).not.toContain('x');
  });

  it('computes cosine distance over the full range', () => {
    expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(1, 6);
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(0.5, 6);
  });

  it('falls back to neutral on mismatched or empty vectors', () => {
    expect(cosineDistance([1, 0], [1, 0, 0])).toBe(0.5);
    expect(cosineDistance([], [])).toBe(0.5);
    expect(cosineDistance([0, 0], [1, 0])).toBe(0.5);
  });
});
