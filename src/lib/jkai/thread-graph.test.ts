import { describe, it, expect } from 'vitest';
import { conceptAnchorTurn, countMentions, rankAndTrim } from './thread-graph';
import type { ThreadGraphNode, ThreadGraphEdge } from './thread-graph';

// Regression fixture, from a real thread on homeserv:
//
//   0 assistant  (model-switch notice, no usage stamp)
//   1 user
//   2 assistant  usage stamp -> the model node lives here
//   3 user       heartbeat trigger
//   4 assistant  heartbeat reply, no usage stamp
//
// Concepts used to anchor to index 4, so they formed a clique among themselves
// while the model sat alone on turn 2 with no edges at all — the rail showed
// "Nothing else in this thread connects to it yet" next to a 4-node graph.

describe('conceptAnchorTurn', () => {
  it('anchors to the newest turn that has structure, not the last message', () => {
    expect(conceptAnchorTurn([2], 5)).toBe(2);
  });

  it('picks the newest structural turn when several carry nodes', () => {
    expect(conceptAnchorTurn([0, 2, 6, 4], 9)).toBe(6);
  });

  it('falls back to the last message when the thread has no structure', () => {
    // Nothing to connect to, so the old behaviour is preserved.
    expect(conceptAnchorTurn([], 5)).toBe(4);
  });

  it('does not return -1 for an empty thread', () => {
    expect(conceptAnchorTurn([], 0)).toBe(0);
  });

  it('handles a structural node on turn 0', () => {
    expect(conceptAnchorTurn([0], 3)).toBe(0);
  });
});

function node(over: Partial<ThreadGraphNode> & { id: string }): ThreadGraphNode {
  return {
    kind: 'concept',
    type: 'CONCEPT',
    name: over.id,
    note: null,
    href: null,
    provenance: 'known',
    lastSeen: null,
    turns: [0],
    mentions: 0,
    ...over,
  };
}

describe('countMentions', () => {
  it('counts messages that name a concept, not occurrences within one', () => {
    const n = node({ id: 'a', name: 'Data Spine' });
    countMentions(
      [n],
      ['the data spine, the Data Spine, DATA SPINE again', 'unrelated', 'about the Data Spine'],
    );
    expect(n.mentions).toBe(2);
  });

  it('respects word boundaries', () => {
    const ees = node({ id: 'a', name: 'EES' });
    countMentions([ees], ['school fees rose', 'the EES publication']);
    expect(ees.mentions).toBe(1);
  });

  it('counts the acronym the chat actually uses, not just the full name', () => {
    // The failure this prevents: a thread that says "DfE" throughout scoring the
    // entity it is mostly about at zero, and burying it under junk.
    const n = node({ id: 'a', name: 'Department for Education (DfE)' });
    countMentions([n], ['the DfE published it', 'DFE again', 'nothing relevant']);
    expect(n.mentions).toBe(2);
  });

  it('does not let a two-letter initialism match everything', () => {
    const n = node({ id: 'a', name: 'Data Spine' });
    // "DS" is under the 3-character floor, so this must not count.
    countMentions([n], ['the DS was mentioned']);
    expect(n.mentions).toBe(0);
  });

  it('matches a name carrying regex metacharacters', () => {
    const n = node({ id: 'a', name: 'Ofsted (the inspectorate)' });
    countMentions([n], ['see Ofsted (the inspectorate) for detail']);
    expect(n.mentions).toBe(1);
  });

  it('falls back to turn count for structural nodes, which prose never names', () => {
    const model = node({ id: 'm', kind: 'model', name: 'glm-5.2', turns: [0, 3, 7] });
    countMentions([model], ['nothing here', 'nor here']);
    expect(model.mentions).toBe(3);
  });
});

describe('rankAndTrim', () => {
  // The bug this ordering replaces: co-occurrence joins every node extracted
  // from one turn to every other, so total degree was identical across them and
  // the "ranking" was really insertion order.
  const cooccurrence = (a: string, b: string): ThreadGraphEdge => ({
    source: a,
    target: b,
    verb: 'MENTIONED WITH',
    typed: false,
  });

  it('puts the most-mentioned concept first even in a co-occurrence clique', () => {
    const nodes = [
      node({ id: 'a', mentions: 1 }),
      node({ id: 'b', mentions: 9 }),
      node({ id: 'c', mentions: 4 }),
    ];
    const edges = [cooccurrence('a', 'b'), cooccurrence('b', 'c'), cooccurrence('a', 'c')];
    expect(rankAndTrim(nodes, edges).nodes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('breaks a mention tie on typed degree, which is a real claim', () => {
    const nodes = [node({ id: 'a', mentions: 3 }), node({ id: 'b', mentions: 3 })];
    const edges: ThreadGraphEdge[] = [
      { source: 'b', target: 'a', verb: 'CAUSES', typed: true },
      cooccurrence('a', 'b'),
    ];
    // Both gain one typed edge, so it falls through to name; give b two.
    const withExtra = [...nodes, node({ id: 'c', mentions: 0 })];
    edges.push({ source: 'b', target: 'c', verb: 'SUPERSEDES', typed: true });
    expect(rankAndTrim(withExtra, edges).nodes[0].id).toBe('b');
  });

  it('ranks concepts above structure, so the centre chip is a topic', () => {
    const nodes = [
      node({ id: 'm', kind: 'model', name: 'glm', mentions: 40 }),
      node({ id: 'a', mentions: 1 }),
    ];
    expect(rankAndTrim(nodes, []).nodes[0].id).toBe('a');
  });

  it('keeps room for structure when concepts would fill every slot', () => {
    const nodes = [
      ...Array.from({ length: 20 }, (_, i) => node({ id: `c${i}`, mentions: 20 - i })),
      node({ id: 'm1', kind: 'model', name: 'glm', mentions: 5 }),
      node({ id: 'f1', kind: 'doc', name: 'spec.pdf', mentions: 2 }),
    ];
    const kept = rankAndTrim(nodes, []).nodes;
    expect(kept).toHaveLength(12);
    expect(kept.filter((n) => n.kind !== 'concept').map((n) => n.id)).toEqual(['m1', 'f1']);
  });

  it('gives every slot to structure when the thread has no concepts', () => {
    const nodes = Array.from({ length: 5 }, (_, i) =>
      node({ id: `d${i}`, kind: 'doc', name: `doc ${i}`, mentions: 5 - i }),
    );
    expect(rankAndTrim(nodes, []).nodes).toHaveLength(5);
  });

  it('drops edges that lose an endpoint to the trim', () => {
    const nodes = Array.from({ length: 14 }, (_, i) => node({ id: `c${i}`, mentions: 14 - i }));
    const edges = [cooccurrence('c0', 'c13'), cooccurrence('c0', 'c1')];
    const out = rankAndTrim(nodes, edges);
    expect(out.nodes).toHaveLength(12);
    expect(out.edges).toEqual([cooccurrence('c0', 'c1')]);
  });
});
