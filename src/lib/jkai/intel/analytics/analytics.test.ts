import { describe, it, expect } from 'vitest';
import {
  buildIndex,
  hopNeighbourhood,
  components,
  pairKey,
  resolveEntitySources,
  isCoLocationEdge,
  type GraphSnapshot,
} from './model';
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
    weight: 0.5,
    lastSeenAt: 0,
    sourceKind: null,
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
  it('builds undirected adjacency and degrees', async () => {
    const index = buildIndex(barbell());
    expect(index.degree.get('b')).toBe(3); // a, x, c
    expect(index.degree.get('a')).toBe(2);
    expect(index.neighbours.get('c')!.has('b')).toBe(true);
    expect(index.neighbours.get('b')!.has('c')).toBe(true);
  });

  it('ignores edges pointing outside the snapshot and self-loops', async () => {
    const index = buildIndex({
      nodes: [node('a'), node('b')],
      edges: [edge('a', 'b'), edge('a', 'ghost'), edge('a', 'a')],
    });
    expect(index.degree.get('a')).toBe(1);
    expect(index.byId.has('ghost')).toBe(false);
  });

  it('measures hop distance outward from a node', async () => {
    const index = buildIndex(barbell());
    const reach = hopNeighbourhood(index, 'a', 3);
    expect(reach.get('a')).toBe(0);
    expect(reach.get('b')).toBe(1);
    expect(reach.get('c')).toBe(2);
    expect(reach.get('d')).toBe(3);
  });

  it('respects the hop ceiling', async () => {
    const index = buildIndex(barbell());
    const reach = hopNeighbourhood(index, 'a', 2);
    expect(reach.has('c')).toBe(true);
    expect(reach.has('d')).toBe(false);
  });

  it('separates disconnected components, largest first', async () => {
    const index = buildIndex({
      nodes: ['a', 'b', 'c', 'lonely'].map((n) => node(n)),
      edges: [edge('a', 'b'), edge('b', 'c')],
    });
    const comps = components(index);
    expect(comps).toHaveLength(2);
    expect(comps[0]).toHaveLength(3);
    expect(comps[1]).toEqual(['lonely']);
  });

  it('produces a stable key regardless of pair order', async () => {
    expect(pairKey('z', 'a')).toBe(pairKey('a', 'z'));
  });
});

describe('centrality', () => {
  it('ranks the bridge nodes highest on betweenness', async () => {
    const index = buildIndex(barbell());
    const btw = await betweenness(index);
    // b and c are the only route between the two triangles.
    expect(btw.get('b')!).toBeGreaterThan(btw.get('a')!);
    expect(btw.get('c')!).toBeGreaterThan(btw.get('d')!);
    expect(btw.get('b')!).toBeCloseTo(btw.get('c')!, 6);
  });

  it('gives a leaf node zero betweenness', async () => {
    const index = buildIndex({
      nodes: ['hub', 'l1', 'l2'].map((n) => node(n)),
      edges: [edge('hub', 'l1'), edge('hub', 'l2')],
    });
    const btw = await betweenness(index);
    expect(btw.get('l1')).toBe(0);
    expect(btw.get('hub')!).toBeGreaterThan(0);
  });

  it('produces a pagerank vector that sums to one', async () => {
    const index = buildIndex(barbell());
    const pr = pagerank(index);
    const total = [...pr.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it('ranks a hub above its leaves on pagerank', async () => {
    const index = buildIndex({
      nodes: ['hub', 'l1', 'l2', 'l3'].map((n) => node(n)),
      edges: [edge('hub', 'l1'), edge('hub', 'l2'), edge('hub', 'l3')],
    });
    const pr = pagerank(index);
    expect(pr.get('hub')!).toBeGreaterThan(pr.get('l1')!);
  });

  it('handles an empty graph without throwing', async () => {
    const index = buildIndex({ nodes: [], edges: [] });
    expect((await computeCentrality(index)).pagerank.size).toBe(0);
  });

  it('scores a low-degree broker above a high-degree hub', async () => {
    // A star hub has high betweenness but no brokerage merit; the barbell
    // bridge earns its position with only three links.
    const index = buildIndex(barbell());
    const scores = await computeCentrality(index);
    expect(brokerageScore('b', scores, index)).toBeGreaterThan(brokerageScore('a', scores, index));
  });

  it('gives a node with fewer than two links no brokerage score', async () => {
    const index = buildIndex({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
    const scores = await computeCentrality(index);
    expect(brokerageScore('a', scores, index)).toBe(0);
  });
});

describe('community detection', () => {
  it('finds the two triangles of a barbell', async () => {
    const index = buildIndex(barbell());
    const result = detectCommunities(index);
    expect(result.communities.size).toBe(2);
    // a and x sit with b; d and y sit with c.
    expect(result.membership.get('a')).toBe(result.membership.get('x'));
    expect(result.membership.get('d')).toBe(result.membership.get('y'));
    expect(result.membership.get('a')).not.toBe(result.membership.get('d'));
  });

  it('reports positive modularity for a genuinely clustered graph', async () => {
    const result = detectCommunities(buildIndex(barbell()));
    expect(result.modularity).toBeGreaterThan(0.2);
  });

  it('numbers communities by size, largest first', async () => {
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

  it('is deterministic across runs', async () => {
    const index = buildIndex(barbell());
    const a = detectCommunities(index);
    const b = detectCommunities(index);
    expect([...a.membership.entries()].sort()).toEqual([...b.membership.entries()].sort());
  });

  it('survives an edgeless graph', async () => {
    const index = buildIndex({ nodes: [node('a'), node('b')], edges: [] });
    const result = detectCommunities(index);
    expect(result.modularity).toBe(0);
    expect(result.membership.size).toBe(2);
  });

  it('scores a random-ish partition below the detected one', async () => {
    const index = buildIndex(barbell());
    const detected = detectCommunities(index);
    const bad = new Map(index.ids.map((id, i) => [id, i % 2]));
    expect(detected.modularity).toBeGreaterThan(modularity(index, bad));
  });
});

describe('paths', () => {
  it('finds the shortest route across the bridge', async () => {
    const index = buildIndex(barbell());
    const path = shortestPath(index, 'a', 'd');
    expect(path).not.toBeNull();
    expect(path!.nodes[0]).toBe('a');
    expect(path!.nodes.at(-1)).toBe('d');
    expect(path!.hops).toBe(3); // a-b-c-d
  });

  it('attaches the real edges to each step', async () => {
    const index = buildIndex(barbell());
    const path = shortestPath(index, 'a', 'c')!;
    expect(path.steps).toHaveLength(2);
    expect(path.steps[0].edges.length).toBeGreaterThan(0);
    expect(path.steps[0].edges[0].type).toBe('knows');
  });

  it('returns null when there is no route', async () => {
    const index = buildIndex({
      nodes: [node('a'), node('b')],
      edges: [],
    });
    expect(shortestPath(index, 'a', 'b')).toBeNull();
  });

  it('returns nothing for a node paired with itself', async () => {
    const index = buildIndex(barbell());
    expect(findPaths(index, 'a', 'a')).toEqual([]);
  });

  it('respects the hop ceiling', async () => {
    const index = buildIndex(barbell());
    expect(shortestPath(index, 'a', 'd', 2)).toBeNull();
    expect(shortestPath(index, 'a', 'd', 3)).not.toBeNull();
  });

  it('returns a directly-connected pair exactly once', async () => {
    // Regression: a direct edge has no intermediates to penalise, so the
    // alternative-route loop re-found it every iteration and callers got
    // `limit` identical copies of the same one-hop path.
    const index = buildIndex({ nodes: [node('a'), node('b')], edges: [edge('a', 'b')] });
    const paths = findPaths(index, 'a', 'b', { limit: 3 });
    expect(paths).toHaveLength(1);
    expect(paths[0].nodes).toEqual(['a', 'b']);
  });

  it('never returns the same route twice', async () => {
    const index = buildIndex(barbell());
    const paths = findPaths(index, 'a', 'd', { limit: 4, maxHops: 5 });
    const signatures = paths.map((p) => p.nodes.join('>'));
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it('finds genuinely different alternative routes', async () => {
    // Two parallel routes from s to t: via m1 and via m2.
    const index = buildIndex({
      nodes: ['s', 'm1', 'm2', 't'].map((n) => node(n)),
      edges: [edge('s', 'm1'), edge('m1', 't'), edge('s', 'm2'), edge('m2', 't')],
    });
    const paths = findPaths(index, 's', 't', { limit: 2 });
    expect(paths).toHaveLength(2);
    expect(paths[0].nodes[1]).not.toBe(paths[1].nodes[1]);
  });

  it('counts common neighbours symmetrically', async () => {
    const index = buildIndex(barbell());
    expect(commonNeighbours(index, 'a', 'b')).toEqual(['x']);
    expect(commonNeighbours(index, 'b', 'a')).toEqual(['x']);
  });

  it('weights a niche shared connection above a hub one in Adamic-Adar', async () => {
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

  it('ranks the cross-cluster bridge as the most surprising link', async () => {
    const links = await scoreSurprisingLinks(ctx(), { maxHops: 2 });
    expect(links.length).toBeGreaterThan(0);
    const top = links[0];
    expect(pairKey(top.a, top.b)).toBe(pairKey('b', 'c'));
    expect(top.crossCommunity).toBe(true);
    expect(top.hops).toBe(1);
  });

  it('explains itself in readable reasons', async () => {
    const links = await scoreSurprisingLinks(ctx(), { maxHops: 2 });
    expect(links[0].reasons).toContain('joins two separate clusters');
    expect(links[0].reasons.join(' ')).toMatch(/directly connected|hops apart/);
  });

  it('treats a pair inside one triangle as unremarkable', async () => {
    const links = await scoreSurprisingLinks(ctx(), { maxHops: 2, minScore: 0 });
    const ax = links.find((l) => pairKey(l.a, l.b) === pairKey('a', 'x'))!;
    const bc = links.find((l) => pairKey(l.a, l.b) === pairKey('b', 'c'))!;
    expect(ax.score).toBeLessThan(bc.score);
  });

  it('uses embeddings to raise semantically distant pairs', async () => {
    const index = buildIndex(barbell());
    const membership = detectCommunities(index).membership;
    const near = new Map([['b', [1, 0]], ['c', [1, 0]]]);
    const far = new Map([['b', [1, 0]], ['c', [-1, 0]]]);

    const scoreWith = async (embeddings: Map<string, number[]>) =>
      (await scoreSurprisingLinks({ index, membership, embeddings }, { maxHops: 1, minScore: 0 }))
        .find((l) => pairKey(l.a, l.b) === pairKey('b', 'c'))!.score;

    expect(await scoreWith(far)).toBeGreaterThan(await scoreWith(near));
  });

  it('never lets an unknown embedding count as evidence either way', async () => {
    const links = await scoreSurprisingLinks(ctx(), { maxHops: 1, minScore: 0 });
    expect(links.every((l) => l.semanticDistance === null)).toBe(true);
  });


  it('discounts links to a hub as expected rather than surprising', async () => {
    // `hub` touches everything; `p`–`q` is an isolated pair. Under the
    // configuration model a hub link is the LEAST surprising thing here.
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [...leaves.map((l) => edge('hub', l)), edge('p', 'q')],
    });
    const membership = detectCommunities(index).membership;
    const links = await scoreSurprisingLinks({ index, membership }, { maxHops: 1, minScore: 0 });
    const pq = links.find((l) => pairKey(l.a, l.b) === pairKey('p', 'q'))!;
    const hubLink = links.find((l) => l.a === 'hub' || l.b === 'hub')!;
    expect(pq.score).toBeGreaterThan(hubLink.score);
  });

  it('says so when neither endpoint is a hub', async () => {
    // Expectedness is deg(a)·deg(b)/2m, so the pair must be peripheral in a
    // graph with enough edges for "hub" to mean anything.
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [...leaves.map((l) => edge('hub', l)), edge('p', 'q')],
    });
    const membership = detectCommunities(index).membership;
    const links = await scoreSurprisingLinks({ index, membership }, { maxHops: 1, minScore: 0 });
    const pq = links.find((l) => pairKey(l.a, l.b) === pairKey('p', 'q'))!;
    expect(pq.reasons).toContain('neither is a hub');

    const hubLink = links.find((l) => l.a === 'hub' || l.b === 'hub')!;
    expect(hubLink.reasons).not.toContain('neither is a hub');
  });

  it('does not gate out a pair that is also joined through a non-hub', async () => {
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
    const links = await scoreSurprisingLinks({ index, membership }, { maxHops: 2, minScore: 0, limit: 500 });
    const pq = links.find((l) => pairKey(l.a, l.b) === pairKey('p', 'q'));
    expect(pq).toBeDefined();
    expect(pq!.reasons.join(' ').toLowerCase()).toContain('niche');
  });

  it('still gates out a pair joined ONLY through hubs', async () => {
    const leaves = Array.from({ length: 20 }, (_, i) => `leaf${i}`);
    const index = buildIndex({
      nodes: ['hub', 'p', 'q', ...leaves].map((n) => node(n)),
      edges: [...leaves.map((l) => edge('hub', l)), edge('p', 'hub'), edge('q', 'hub')],
    });
    const membership = detectCommunities(index).membership;
    const links = await scoreSurprisingLinks({ index, membership }, { maxHops: 2, minScore: 0, limit: 500 });
    expect(links.some((l) => pairKey(l.a, l.b) === pairKey('p', 'q'))).toBe(false);
  });

  it('honours the result limit', async () => {
    const links = await scoreSurprisingLinks(ctx(), { maxHops: 3, minScore: 0, limit: 2 });
    expect(links).toHaveLength(2);
  });

  it('predicts the link between two nodes that share a neighbour', async () => {
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

  it('never predicts a link that already exists', async () => {
    const index = buildIndex(barbell());
    const preds = predictMissingLinks({ index, membership: new Map() }, { minScore: 0 });
    for (const p of preds) {
      expect(index.neighbours.get(p.a)!.has(p.b)).toBe(false);
    }
  });

  it('identifies the nodes joining two communities', async () => {
    const c = ctx();
    const bridges = findBridges(c);
    const ids = bridges.map((b) => b.id);
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).not.toContain('x');
  });

  it('computes cosine distance over the full range', async () => {
    expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(1, 6);
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(0.5, 6);
  });

  it('falls back to neutral on mismatched or empty vectors', async () => {
    expect(cosineDistance([1, 0], [1, 0, 0])).toBe(0.5);
    expect(cosineDistance([], [])).toBe(0.5);
    expect(cosineDistance([0, 0], [1, 0])).toBe(0.5);
  });
});

describe('resolveEntitySources', () => {
  // The channel filter must answer with the channel that was asked for. On the
  // live graph 187 entities had note links whose sources did not include the
  // first-seen note's, and unioning it in meant 48 of the 167 entities returned
  // for 'email' had no email note at all — "GitHub", asserted by six chat notes,
  // among them.
  it('lets the note links decide whenever there are any', () => {
    expect(resolveEntitySources(['chat'], 'email')).toEqual(['chat']);
    expect(resolveEntitySources(['chat', 'file'], 'research')).toEqual(['chat', 'file']);
  });

  it('keeps the first-seen source only for an entity with no note links', () => {
    // 482 entities on the live graph. Without this they carry no source at all
    // and disappear from every filtered view.
    expect(resolveEntitySources([], 'research')).toEqual(['research']);
  });

  it('reports no source rather than inventing one', () => {
    expect(resolveEntitySources([], null)).toEqual([]);
  });

  it('does not alias the array it was given', () => {
    const notes = ['chat'];
    const out = resolveEntitySources(notes, 'email');
    out.push('email');
    expect(notes).toEqual(['chat']);
  });
});

describe('isCoLocationEdge', () => {
  const byId = new Map(
    [node('london', 'location'), node('hany', 'person'), node('venue', 'organisation')].map((n) => [
      n.id,
      n,
    ]),
  );

  it('is true for an incidental position with a place at one end', () => {
    expect(isCoLocationEdge(edge('hany', 'london', 'based_in'), byId)).toBe(true);
    expect(isCoLocationEdge(edge('venue', 'london', 'located_in'), byId)).toBe(true);
    // Either end may be the place.
    expect(isCoLocationEdge(edge('london', 'hany', 'visited'), byId)).toBe(true);
  });

  it('is false without a place at either end, however the relation is named', () => {
    // `part_of` has 147 edges in the live graph and only 27 touch a location.
    // Matching on the relation alone would take out 120 statements about
    // organisations and systems.
    expect(isCoLocationEdge(edge('hany', 'venue', 'located_in'), byId)).toBe(false);
  });

  it('is false for COMPOSITION, which is real structure', () => {
    // The wide version of this rule scattered `Norfolk Broads` and a running
    // route into singletons. A place made of places is a cluster worth having.
    for (const type of ['includes', 'contains', 'route_stop', 'passes_through', 'part_of', 'location_of']) {
      expect(isCoLocationEdge(edge('london', 'venue', type), byId)).toBe(false);
    }
  });

  it('is false for a relation that only LOOKS spatial because of a conflation', () => {
    // `Home owned_by <device>` touches a location 11 times, but only because the
    // house had absorbed the Home Assistant install. splitEntity repairs that.
    expect(isCoLocationEdge(edge('london', 'venue', 'owned_by'), byId)).toBe(false);
    expect(isCoLocationEdge(edge('london', 'venue', 'flagged_risk'), byId)).toBe(false);
  });
});

describe('community detection ignores co-location', () => {
  // Testing the MECHANISM, not the emergent effect. On a small synthetic graph
  // Louvain separates a co-location star anyway — the merging this exists to stop
  // only happens once the place is embedded in a dense real neighbourhood, where
  // it is not reproducible in a unit test. What IS deterministic is whether the
  // pair is adjacent at all for clustering purposes, so that is what is asserted.
  // The effect on the live graph was measured instead: `Hany Shoukry` and
  // `ebay.co.uk` shared a community before and do not after, and the eBay
  // cluster went from 60 members to 22.

  it('does not make a pair adjacent when co-location is ALL they share', () => {
    const snapshot: GraphSnapshot = {
      nodes: [node('london', 'location'), node('hany', 'person')],
      edges: [edge('hany', 'london', 'based_in')],
    };
    const index = buildIndex(snapshot);
    const { membership, communities } = detectCommunities(index);
    // Joined in the graph, not joined for clustering.
    expect(index.degree.get('london')).toBe(1);
    expect(index.degree.get('hany')).toBe(1);
    expect(membership.get('hany')).not.toBe(membership.get('london'));
    expect(communities.size).toBe(2);
  });

  it('still clusters a pair that has any substantive edge as well', () => {
    const snapshot: GraphSnapshot = {
      nodes: [node('london', 'location'), node('a', 'person')],
      edges: [
        edge('a', 'london', 'based_in'),
        // One real relation anywhere between the two and the pair counts.
        edge('a', 'london', 'owns'),
      ],
    };
    const { membership } = detectCommunities(buildIndex(snapshot));
    expect(membership.get('a')).toBe(membership.get('london'));
  });

  it('leaves a place made of places alone', () => {
    // Composition is real structure — the wide version of this rule scattered
    // `Norfolk Broads` into singletons and was measured and rejected.
    const snapshot: GraphSnapshot = {
      nodes: [node('broads', 'location'), node('spot', 'location')],
      edges: [edge('broads', 'spot', 'includes')],
    };
    const { membership } = detectCommunities(buildIndex(snapshot));
    expect(membership.get('spot')).toBe(membership.get('broads'));
  });
});
