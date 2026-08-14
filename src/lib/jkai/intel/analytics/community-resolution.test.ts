import { describe, it, expect } from 'vitest';
import { buildIndex } from './model';
import type { GraphNode, GraphEdge } from './model';
import {
  detectCommunities,
  autoTuneResolution,
  DOMINANCE_CAP,
  RESOLUTION_SWEEP,
} from './community';

const node = (id: string): GraphNode => ({
  id,
  name: id,
  typeId: 't',
  typeName: 't',
  icon: '',
  color: '',
  summary: null,
  confidence: 'medium',
  confidenceScore: null,
  confirmed: false,
  createdAt: 0,
  updatedAt: 0,
  noteCount: 0,
  lastSeenAt: 0,
  evidenceAt: 0,
  aliases: [],
  categories: [],
  sources: [],
});

const edge = (s: string, t: string): GraphEdge => ({
  id: `${s}-${t}`,
  source: s,
  target: t,
  type: 'r',
  label: null,
  confidence: 'medium',
  strength: 'moderate',
  createdAt: 0,
  weight: 0.5,
  lastSeenAt: 0,
  sourceKind: null,
});

/** Two 4-cliques joined by a single edge: one cluster at low γ, two at γ=1. */
function barbell() {
  const groups = [
    ['a1', 'a2', 'a3', 'a4'],
    ['b1', 'b2', 'b3', 'b4'],
  ];
  const edges: GraphEdge[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) edges.push(edge(group[i], group[j]));
    }
  }
  edges.push(edge('a1', 'b1'));
  return buildIndex({ nodes: groups.flat().map(node), edges });
}

/** A ring of six 5-cliques — enough structure for the sweep to have choices. */
function ringOfCliques() {
  const edges: GraphEdge[] = [];
  const nodes: GraphNode[] = [];
  const rings = 6;
  for (let r = 0; r < rings; r++) {
    const group = Array.from({ length: 5 }, (_, i) => `r${r}n${i}`);
    for (const id of group) nodes.push(node(id));
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) edges.push(edge(group[i], group[j]));
    }
    edges.push(edge(`r${r}n0`, `r${(r + 1) % rings}n0`));
  }
  return buildIndex({ nodes, edges });
}

describe('resolution', () => {
  it('defaults to 1 and reports it', () => {
    expect(detectCommunities(barbell()).resolution).toBe(1);
  });

  it('splits the barbell into its two cliques at γ=1', () => {
    expect(detectCommunities(barbell(), 1).communities.size).toBe(2);
  });

  it('merges the barbell into one cluster at a low resolution', () => {
    expect(detectCommunities(barbell(), 0.05).communities.size).toBe(1);
  });

  it('is deterministic — the same graph and γ give the same membership', () => {
    const a = detectCommunities(ringOfCliques(), 1.25);
    const b = detectCommunities(ringOfCliques(), 1.25);
    expect([...a.membership]).toEqual([...b.membership]);
  });

  it('a higher resolution never yields fewer clusters than a lower one', () => {
    const low = detectCommunities(ringOfCliques(), 0.5).communities.size;
    const high = detectCommunities(ringOfCliques(), 3).communities.size;
    expect(high).toBeGreaterThanOrEqual(low);
  });
});

describe('autoTuneResolution', () => {
  it('returns a resolution from the sweep', () => {
    const { resolution } = autoTuneResolution(ringOfCliques());
    expect(RESOLUTION_SWEEP).toContain(resolution);
  });

  it('scores every resolution in the sweep', () => {
    const { candidates } = autoTuneResolution(ringOfCliques());
    expect(candidates.map((c) => c.resolution)).toEqual([...RESOLUTION_SWEEP]);
  });

  it('prefers the best modularity among resolutions no cluster dominates', () => {
    const { resolution, candidates } = autoTuneResolution(ringOfCliques());
    const chosen = candidates.find((c) => c.resolution === resolution)!;
    const eligible = candidates.filter((c) => c.largestShare <= DOMINANCE_CAP);
    if (eligible.length) {
      expect(chosen.largestShare).toBeLessThanOrEqual(DOMINANCE_CAP);
      expect(chosen.modularity).toBe(Math.max(...eligible.map((c) => c.modularity)));
    } else {
      expect(chosen.largestShare).toBe(Math.min(...candidates.map((c) => c.largestShare)));
    }
  });

  it('falls back to the least dominated when nothing clears the cap', () => {
    // Every partition of a barbell puts at least half the graph in one cluster,
    // so no candidate can satisfy an 8% cap.
    const { resolution, candidates } = autoTuneResolution(barbell());
    const chosen = candidates.find((c) => c.resolution === resolution)!;
    expect(candidates.every((c) => c.largestShare > DOMINANCE_CAP)).toBe(true);
    expect(chosen.largestShare).toBe(Math.min(...candidates.map((c) => c.largestShare)));
  });

  it('measures dominance against connected entities, not the whole graph', () => {
    // Twenty isolates alongside the ring must not make the largest cluster look
    // small — they are unclusterable at every resolution.
    const ring = ringOfCliques();
    const isolates = Array.from({ length: 20 }, (_, i) => node(`iso${i}`));
    const withIsolates = buildIndex({
      nodes: [...ring.ids.map((id) => ring.byId.get(id)!), ...isolates],
      edges: [...ring.edgesBetween.values()].flat(),
    });
    const a = autoTuneResolution(ring);
    const b = autoTuneResolution(withIsolates);
    const shareA = a.candidates.map((c) => c.largestShare);
    const shareB = b.candidates.map((c) => c.largestShare);
    expect(shareB).toEqual(shareA);
  });

  it('counts only clusters worth naming', () => {
    const { candidates } = autoTuneResolution(ringOfCliques());
    // Six 5-cliques: every cluster clears the minimum, none is a fragment.
    expect(candidates[0].clusters).toBeGreaterThan(0);
  });
});
