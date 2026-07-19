import { describe, it, expect } from 'vitest';
import { createUndoHistory, type UndoAction } from './undo';

const move = (nodeId: string): UndoAction => ({
  kind: 'node-move',
  nodeId,
  from: { x: 0, y: 0 },
  to: { x: 10, y: 10 },
});

describe('createUndoHistory', () => {
  it('push → popUndo returns LIFO and empties', () => {
    const h = createUndoHistory();
    h.push(move('a'));
    h.push(move('b'));
    expect(h.canUndo()).toBe(true);
    expect(h.popUndo()).toMatchObject({ nodeId: 'b' });
    expect(h.popUndo()).toMatchObject({ nodeId: 'a' });
    expect(h.popUndo()).toBeNull();
    expect(h.canUndo()).toBe(false);
  });

  it('push clears the redo stack; pushRedo/popRedo round-trips', () => {
    const h = createUndoHistory();
    h.push(move('a'));
    const undone = h.popUndo()!;
    h.pushRedo(undone);
    expect(h.canRedo()).toBe(true);
    // A fresh edit invalidates redo history.
    h.push(move('b'));
    expect(h.canRedo()).toBe(false);
  });

  it('pushUndoOnly re-arms undo WITHOUT clearing redo', () => {
    const h = createUndoHistory();
    h.push(move('a'));
    h.push(move('b'));
    h.pushRedo(h.popUndo()!); // undo b
    h.pushRedo(h.popUndo()!); // undo a
    const redoA = h.popRedo()!;
    h.pushUndoOnly(redoA);
    expect(h.canRedo()).toBe(true); // b still redoable
    expect(h.depth()).toEqual({ undo: 1, redo: 1 });
  });

  it('bounds the stack at 50 entries', () => {
    const h = createUndoHistory();
    for (let i = 0; i < 60; i++) h.push(move(`n${i}`));
    expect(h.depth().undo).toBe(50);
    // Oldest 10 dropped — the top is still the newest.
    expect(h.popUndo()).toMatchObject({ nodeId: 'n59' });
  });

  it('remapNodeId rewrites ids in node-delete entries and their edges', () => {
    const h = createUndoHistory();
    h.push({
      kind: 'node-delete',
      node: { id: 'old', type: 'llm-call', label: 'L', position: { x: 1, y: 2 }, config: {} },
      edges: [
        { sourceNodeId: 'up', targetNodeId: 'old', sourceHandle: null, targetHandle: null },
        { sourceNodeId: 'old', targetNodeId: 'down', sourceHandle: 'out', targetHandle: 'in' },
      ],
    });
    h.remapNodeId('old', 'new');
    const a = h.popUndo()!;
    expect(a.kind).toBe('node-delete');
    if (a.kind === 'node-delete') {
      expect(a.node.id).toBe('new');
      expect(a.edges[0].targetNodeId).toBe('new');
      expect(a.edges[1].sourceNodeId).toBe('new');
      expect(a.edges[0].sourceNodeId).toBe('up');
    }
  });
});
