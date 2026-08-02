// Fan-in collision detection.
//
// The bug being pinned: the engine merges a node's upstream inputs with a flat
// `Object.assign`, so two branches emitting the same top-level key silently lose
// one of them. On 2026-08-02 that broke the daily-spend-summary canvas twice
// over and surfaced three nodes later as an unexplained HTTP 404.
//
// These tests are written against the REAL shape of that canvas, because the
// thing worth locking is not "the function finds duplicates" but "it would have
// caught the actual mistake, and stays quiet on the actual fix".

import { describe, it, expect } from 'vitest';
import { findFanInCollisions, declaredOutputKeys } from './fan-in';
import type { JsonSchema, WorkflowNodeDef, WorkflowEdgeDef } from './types';

/** What every `api-call` node emits — identical for all of them, which is the
 *  whole problem. Mirrors api-call.ts getOutputSchema(). */
const API_CALL_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    api: { type: 'string' },
    status: { type: 'number' },
    url: { type: 'string' },
    json: { type: 'any' },
  },
};

const SCHEMAS: Record<string, JsonSchema> = {
  'api-call': API_CALL_SCHEMA,
  trigger: { type: 'object', properties: { triggeredAt: { type: 'string' } } },
  // A transform's real shape comes from its own config.outputSchema; the
  // executor's fallback is deliberately shapeless.
  transform: { type: 'object', properties: {} },
};

const getSchema = (type: string): JsonSchema | undefined => SCHEMAS[type];

const node = (id: string, type: string, label: string, config: Record<string, unknown> = {}): WorkflowNodeDef => ({
  id,
  type,
  label,
  config,
  position: { x: 0, y: 0 },
});

const edge = (sourceNodeId: string, targetNodeId: string): WorkflowEdgeDef => ({
  id: `${sourceNodeId}->${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
});

describe('declaredOutputKeys', () => {
  it('prefers a transform\'s configured outputSchema over the executor default', () => {
    const t = node('t', 'transform', 'Label accounts', { outputSchema: { accounts: { type: 'array' } } });
    expect(declaredOutputKeys(t, getSchema)).toEqual(['accounts']);
  });

  it('falls back to the executor schema when there is no configured one', () => {
    expect(declaredOutputKeys(node('a', 'api-call', 'Get accounts'), getSchema)).toContain('json');
  });

  it('returns null for an unknown shape rather than guessing', () => {
    // A custom or unregistered node must not be reported as colliding on "no
    // keys" — that would false-alarm on every bespoke node in the canvas.
    expect(declaredOutputKeys(node('x', 'mystery-node', 'Custom'), getSchema)).toBeNull();
    expect(declaredOutputKeys(node('t', 'transform', 'Bare transform'), getSchema)).toBeNull();
  });
});

describe('the daily-spend-summary canvas as it was broken', () => {
  const nodes = [
    node('acc', 'api-call', 'Get accounts'),
    node('card', 'api-call', 'Get cards'),
    node('xtrc', 'transform', 'Extract IDs + dates'),
  ];
  const edges = [edge('acc', 'xtrc'), edge('card', 'xtrc')];

  it('flags the node both api-calls fed into', () => {
    const hits = findFanInCollisions(nodes, edges, getSchema);
    expect(hits).toHaveLength(1);
    expect(hits[0].nodeId).toBe('xtrc');
    // `json` is the one that actually mattered — it carried the results array.
    expect(hits[0].keys).toContain('json');
    expect(hits[0].keys).toContain('status');
    expect(hits[0].sources.map((s) => s.label).sort()).toEqual(['Get accounts', 'Get cards']);
  });

  it('names both branches and the fix in the message', () => {
    const [hit] = findFanInCollisions(nodes, edges, getSchema);
    expect(hit.message).toContain('Get accounts');
    expect(hit.message).toContain('Get cards');
    expect(hit.message).toContain('transform');
    // The trap that cost real time: reaching for a merge node, which collapses
    // identically. The message has to say so.
    expect(hit.message).toContain('merge');
  });

  it('flags the three-way transaction fan-in too', () => {
    const txnNodes = [
      node('t1', 'api-call', 'Current account txns'),
      node('t2', 'api-call', 'Card 1 txns'),
      node('t3', 'api-call', 'Card 2 txns'),
      node('flat', 'transform', 'Flatten transactions'),
    ];
    const hits = findFanInCollisions(
      txnNodes,
      [edge('t1', 'flat'), edge('t2', 'flat'), edge('t3', 'flat')],
      getSchema,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].sources).toHaveLength(3);
  });
});

describe('the canvas as it was fixed', () => {
  it('stays quiet once each branch has its own key', () => {
    const nodes = [
      node('acc', 'api-call', 'Get accounts'),
      node('card', 'api-call', 'Get cards'),
      node('lacc', 'transform', 'Label accounts', { outputSchema: { accounts: { type: 'array' } } }),
      node('lcard', 'transform', 'Label cards', { outputSchema: { cards: { type: 'array' } } }),
      node('xtrc', 'transform', 'Extract IDs + dates'),
    ];
    const edges = [
      edge('acc', 'lacc'),
      edge('card', 'lcard'),
      edge('lacc', 'xtrc'),
      edge('lcard', 'xtrc'),
    ];
    expect(findFanInCollisions(nodes, edges, getSchema)).toEqual([]);
  });

  it('a merge node does NOT silence it — merging is the same flat collapse', () => {
    // Guards against someone "fixing" a reported collision by dropping a merge
    // in front of it, which changes nothing at runtime.
    const nodes = [
      node('acc', 'api-call', 'Get accounts'),
      node('card', 'api-call', 'Get cards'),
      node('m', 'merge', 'Merge'),
    ];
    const hits = findFanInCollisions(nodes, [edge('acc', 'm'), edge('card', 'm')], getSchema);
    expect(hits).toHaveLength(1);
    expect(hits[0].nodeLabel).toBe('Merge');
  });
});

describe('does not cry wolf', () => {
  it('ignores a node with a single upstream', () => {
    const nodes = [node('a', 'api-call', 'Get accounts'), node('b', 'transform', 'Next')];
    expect(findFanInCollisions(nodes, [edge('a', 'b')], getSchema)).toEqual([]);
  });

  it('ignores a duplicate edge between the same two nodes', () => {
    const nodes = [node('a', 'api-call', 'Get accounts'), node('b', 'transform', 'Next')];
    const dup: WorkflowEdgeDef = { id: 'dup', sourceNodeId: 'a', targetNodeId: 'b' };
    expect(findFanInCollisions(nodes, [edge('a', 'b'), dup], getSchema)).toEqual([]);
  });

  it('allows branches whose keys are genuinely disjoint', () => {
    const nodes = [
      node('a', 'transform', 'Left', { outputSchema: { left: { type: 'string' } } }),
      node('b', 'transform', 'Right', { outputSchema: { right: { type: 'string' } } }),
      node('c', 'transform', 'Join'),
    ];
    expect(findFanInCollisions(nodes, [edge('a', 'c'), edge('b', 'c')], getSchema)).toEqual([]);
  });

  it('stays quiet when one branch has an unknown shape', () => {
    // Half-unknown means we cannot prove a collision; a false alarm on every
    // custom node would train the model to ignore the warning entirely.
    const nodes = [
      node('a', 'api-call', 'Get accounts'),
      node('b', 'mystery-node', 'Custom thing'),
      node('c', 'transform', 'Join'),
    ];
    expect(findFanInCollisions(nodes, [edge('a', 'c'), edge('b', 'c')], getSchema)).toEqual([]);
  });

  it('ignores an edge pointing at a node that no longer exists', () => {
    const nodes = [node('a', 'api-call', 'A'), node('b', 'api-call', 'B')];
    expect(findFanInCollisions(nodes, [edge('a', 'gone'), edge('b', 'gone')], getSchema)).toEqual([]);
  });
});
