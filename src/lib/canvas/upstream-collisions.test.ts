import { describe, it, expect } from 'vitest';
import { computeUpstreamCollisions } from './upstream-fields';

const edge = (sourceNodeId: string, targetNodeId: string) => ({ sourceNodeId, targetNodeId });

describe('computeUpstreamCollisions', () => {
  it('flags a key emitted by two immediate upstream nodes', () => {
    const nodes = [
      { id: 'a', outputData: { text: 'x', extra: 1 } },
      { id: 'b', outputData: { text: 'y' } },
      { id: 'target', outputData: undefined },
    ];
    const edges = [edge('a', 'target'), edge('b', 'target')];
    const cols = computeUpstreamCollisions('target', nodes, edges);
    expect(cols).toEqual([{ key: 'text', sources: ['a', 'b'] }]);
  });

  it('does not flag keys unique to one upstream node', () => {
    const nodes = [
      { id: 'a', outputData: { foo: 1 } },
      { id: 'b', outputData: { bar: 2 } },
    ];
    const edges = [edge('a', 'target'), edge('b', 'target')];
    expect(computeUpstreamCollisions('target', nodes, edges)).toEqual([]);
  });

  it('ignores non-immediate (transitive) upstream nodes', () => {
    // a -> b -> target. `a` is not immediate to target, so its keys don't collide.
    const nodes = [
      { id: 'a', outputData: { text: 'x' } },
      { id: 'b', outputData: { text: 'y' } },
    ];
    const edges = [edge('a', 'b'), edge('b', 'target')];
    expect(computeUpstreamCollisions('target', nodes, edges)).toEqual([]);
  });

  it('skips upstream nodes with no run output yet', () => {
    const nodes = [
      { id: 'a', outputData: { text: 'x' } },
      { id: 'b', outputData: undefined },
    ];
    const edges = [edge('a', 'target'), edge('b', 'target')];
    expect(computeUpstreamCollisions('target', nodes, edges)).toEqual([]);
  });
});
