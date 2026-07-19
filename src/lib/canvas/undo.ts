/**
 * Canvas undo/redo history — a bounded, window-free stack module (unit-testable
 * in isolation, like keymap.ts).
 *
 * Scope: STRUCTURAL edits — node add, node delete (with its attached edges),
 * node move, edge delete. Config-panel edits and edge-adds are out of scope
 * (config has its own draft/save cycle; an added edge is one click to remove).
 *
 * The canvas graph is server-persisted with server-generated node ids, so
 * undoing a node-delete recreates the node under a NEW id. `remapNodeId`
 * rewrites both stacks after such a restore so older entries referencing the
 * dead id stay applicable.
 */

export type UndoAction =
  | {
      kind: 'node-delete';
      node: { id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, unknown> };
      edges: Array<{ sourceNodeId: string; targetNodeId: string; sourceHandle: string | null; targetHandle: string | null }>;
    }
  | { kind: 'node-add'; nodeId: string }
  | { kind: 'node-move'; nodeId: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | {
      kind: 'edge-delete';
      edge: { sourceNodeId: string; targetNodeId: string; sourceHandle: string | null; targetHandle: string | null };
    };

const MAX_ENTRIES = 50;

export interface UndoHistory {
  /** Record a user edit. Clears the redo stack (standard history semantics). */
  push(action: UndoAction): void;
  /** Pop the entry to undo (caller applies the inverse, then calls pushRedo). */
  popUndo(): UndoAction | null;
  /** Pop the entry to redo (caller re-applies it, then calls pushUndoOnly). */
  popRedo(): UndoAction | null;
  /** Re-arm the redo stack after a successful undo application. */
  pushRedo(action: UndoAction): void;
  /** Re-arm the undo stack after a successful redo application (no redo clear). */
  pushUndoOnly(action: UndoAction): void;
  /** Rewrite a node id across both stacks (post-restore id remap). */
  remapNodeId(oldId: string, newId: string): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** Sizes, for tests/UI. */
  depth(): { undo: number; redo: number };
}

function remapAction(a: UndoAction, oldId: string, newId: string): UndoAction {
  const swap = (id: string) => (id === oldId ? newId : id);
  switch (a.kind) {
    case 'node-add':
    case 'node-move':
      return { ...a, nodeId: swap(a.nodeId) };
    case 'node-delete':
      return {
        ...a,
        node: { ...a.node, id: swap(a.node.id) },
        edges: a.edges.map((e) => ({
          ...e,
          sourceNodeId: swap(e.sourceNodeId),
          targetNodeId: swap(e.targetNodeId),
        })),
      };
    case 'edge-delete':
      return {
        ...a,
        edge: {
          ...a.edge,
          sourceNodeId: swap(a.edge.sourceNodeId),
          targetNodeId: swap(a.edge.targetNodeId),
        },
      };
  }
}

export function createUndoHistory(): UndoHistory {
  let undoStack: UndoAction[] = [];
  let redoStack: UndoAction[] = [];

  return {
    push(action) {
      undoStack.push(action);
      if (undoStack.length > MAX_ENTRIES) undoStack.shift();
      redoStack = [];
    },
    popUndo() {
      return undoStack.pop() ?? null;
    },
    popRedo() {
      return redoStack.pop() ?? null;
    },
    pushRedo(action) {
      redoStack.push(action);
      if (redoStack.length > MAX_ENTRIES) redoStack.shift();
    },
    pushUndoOnly(action) {
      undoStack.push(action);
      if (undoStack.length > MAX_ENTRIES) undoStack.shift();
    },
    remapNodeId(oldId, newId) {
      undoStack = undoStack.map((a) => remapAction(a, oldId, newId));
      redoStack = redoStack.map((a) => remapAction(a, oldId, newId));
    },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    depth: () => ({ undo: undoStack.length, redo: redoStack.length }),
  };
}
