import { describe, expect, it } from 'vitest';
import { affectedNodeIds, describeOp, type ProposedOp } from './amend-words';

const names: Record<string, string> = { a: 'Fetch news', b: 'Send WhatsApp' };
const ctx = {
  nodeName: (id: string) => names[id] ?? null,
  typeLabel: (t: string) => (t === 'delay' ? 'Delay' : t),
  edgeName: (id: string) => (id === 'e1' ? '“Fetch news” → “Send WhatsApp”' : null),
};

describe('describeOp', () => {
  it('names an inserted step and both ends', () => {
    const op: ProposedOp = {
      op: 'insert_between',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      type: 'delay',
      label: 'Wait 5 min',
    };
    expect(describeOp(op, [op], ctx)).toEqual({
      kind: 'add',
      text: 'Insert step “Wait 5 min” (Delay) between “Fetch news” and “Send WhatsApp”',
    });
  });

  it('resolves a #ref to the step added earlier in the proposal', () => {
    const ops: ProposedOp[] = [
      { op: 'add_node', ref: 'n1', type: 'delay', label: 'Pause' },
      { op: 'add_edge', sourceNodeId: 'a', targetNodeId: '#n1' },
    ];
    expect(describeOp(ops[1], ops, ctx).text).toBe('Connect “Fetch news” → the new “Pause”');
  });

  it('lists the config keys an update changes and clears', () => {
    const op: ProposedOp = {
      op: 'update_node',
      nodeId: 'b',
      config: { message: 'x', to: 'y' },
      removeConfigKeys: ['legacy'],
    };
    expect(describeOp(op, [op], ctx)).toEqual({
      kind: 'change',
      text: 'Change “Send WhatsApp” — set message, to; clear legacy',
    });
  });

  it('says so when a node id is not on the canvas', () => {
    const op: ProposedOp = { op: 'remove_node', nodeId: 'gone' };
    expect(describeOp(op, [op], ctx).text).toBe(
      'Remove a step that is no longer on the canvas and its connections',
    );
  });

  it('names a removed edge by its ends when known', () => {
    const op: ProposedOp = { op: 'remove_edge', edgeId: 'e1' };
    expect(describeOp(op, [op], ctx).text).toBe('Disconnect “Fetch news” → “Send WhatsApp”');
  });
});

describe('affectedNodeIds', () => {
  it('collects existing ids, skips #refs, and follows removed edges', () => {
    const ops: ProposedOp[] = [
      { op: 'update_node', nodeId: 'a', label: 'x' },
      { op: 'add_edge', sourceNodeId: '#n1', targetNodeId: 'b' },
      { op: 'remove_edge', edgeId: 'e9' },
    ];
    const ids = affectedNodeIds(ops, (id) => (id === 'e9' ? ['c', 'd'] : []));
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
