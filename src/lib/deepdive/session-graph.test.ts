import { describe, it, expect } from 'vitest';
import { buildSessionSnapshot, iconForType, type SessionEntityRow, type SessionRelationshipRow } from './session-graph';
import { buildIndex } from '$lib/jkai/intel/analytics/model';
import { pagerank } from '$lib/jkai/intel/analytics/centrality';
import { detectCommunities } from '$lib/jkai/intel/analytics/community';

const ent = (id: string, type = 'person'): SessionEntityRow => ({ id, name: `E${id}`, type });
const rel = (id: string, a: string | null, b: string | null, strength = 0.5): SessionRelationshipRow => ({
  id,
  fromEntityId: a,
  toEntityId: b,
  relationshipType: 'works_with',
  strength,
});

describe('buildSessionSnapshot', () => {
  it('produces a snapshot the intel analytics accept unchanged', () => {
    const snap = buildSessionSnapshot(
      [ent('a'), ent('b'), ent('c')],
      [rel('r1', 'a', 'b'), rel('r2', 'b', 'c')],
    );
    // The whole point of the module: these three run on it with no adaptation.
    const index = buildIndex(snap);
    expect(index.ids).toHaveLength(3);
    expect(index.degree.get('b')).toBe(2);
    expect(pagerank(index).get('b')).toBeGreaterThan(pagerank(index).get('a')!);
    expect(() => detectCommunities(index)).not.toThrow();
  });

  it('drops self-loops and edges pointing at entities that do not exist', () => {
    const snap = buildSessionSnapshot(
      [ent('a'), ent('b')],
      [rel('r1', 'a', 'a'), rel('r2', 'a', 'ghost'), rel('r3', null, 'b'), rel('r4', 'a', 'b')],
    );
    expect(snap.edges.map((e) => e.id)).toEqual(['r4']);
    // The reported total must match what survived, or the caption lies.
    expect(snap.totalEdges).toBe(1);
  });

  it('trims to the best-connected nodes and says that it did', () => {
    const entities = Array.from({ length: 10 }, (_, i) => ent(`e${i}`));
    // e0 is a hub; the rest are isolated.
    const rels = Array.from({ length: 5 }, (_, i) => rel(`r${i}`, 'e0', `e${i + 1}`));
    const snap = buildSessionSnapshot(entities, rels, { maxNodes: 4 });

    expect(snap.nodes).toHaveLength(4);
    expect(snap.trimmed).toBe(true);
    expect(snap.totalNodes).toBe(10);
    expect(snap.nodes[0].id).toBe('e0');
    // Every retained edge must have both ends retained, or d3 throws on a
    // link whose endpoint is not in the node list.
    const ids = new Set(snap.nodes.map((n) => n.id));
    for (const e of snap.edges) {
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });

  it('does not mark a graph trimmed when it fits', () => {
    const snap = buildSessionSnapshot([ent('a'), ent('b')], [rel('r', 'a', 'b')], { maxNodes: 50 });
    expect(snap.trimmed).toBe(false);
  });

  it('carries the extractor strength through as the edge weight', () => {
    const snap = buildSessionSnapshot([ent('a'), ent('b')], [rel('r', 'a', 'b', 0.9)]);
    expect(snap.edges[0].weight).toBe(0.9);
    expect(snap.edges[0].strength).toBe('strong');
  });

  it('clamps an out-of-range strength rather than passing it on', () => {
    const snap = buildSessionSnapshot([ent('a'), ent('b')], [rel('r', 'a', 'b', 4)]);
    expect(snap.edges[0].weight).toBe(1);
  });

  it('handles a session with entities but no relationships', () => {
    const snap = buildSessionSnapshot([ent('a'), ent('b')], []);
    expect(snap.nodes).toHaveLength(2);
    expect(snap.edges).toEqual([]);
    expect(() => buildIndex(snap)).not.toThrow();
  });

  it('handles an empty session', () => {
    const snap = buildSessionSnapshot([], []);
    expect(snap).toMatchObject({ nodes: [], edges: [], totalNodes: 0, totalEdges: 0, trimmed: false });
  });
});

describe('iconForType', () => {
  it('covers the types the extractor actually emits', () => {
    for (const t of ['person', 'organisation', 'concept', 'product', 'location', 'event', 'other']) {
      expect(iconForType(t)).toBeTruthy();
    }
  });

  it('falls back rather than returning undefined for an unseen type', () => {
    expect(iconForType('spaceship')).toBe(iconForType('other'));
    expect(iconForType('ORGANISATION')).toBe(iconForType('organisation'));
  });
});
