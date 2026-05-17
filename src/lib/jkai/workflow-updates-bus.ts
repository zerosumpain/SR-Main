// In-process pubsub for workflow mutations.
//
// When a tool mutates a workflow (adds a node, an edge, changes config) and the
// canvas page is open, we want the canvas to re-fetch and animate the change.
// The canvas already does this on its own actions via invalidateAll(); for
// external mutations driven by Hermes / a site-tool / a scheduled job, this
// bus broadcasts the event and the canvas's SSE consumer triggers an
// invalidate.
//
// In-memory, per-process, lost on restart. Same reasoning as tool-step-bus:
// the prod systemd service is long-lived; dev iteration is short-lived; the
// canvas refreshes via its normal load() on reconnect anyway, so a missed
// event is recoverable.

export type WorkflowUpdateKind =
  | 'workflow_created'
  | 'node_added'
  | 'node_updated'
  | 'node_removed'
  | 'edge_added'
  | 'edge_removed'
  | 'build_started'
  | 'build_complete';

export interface WorkflowUpdateEvent {
  workflowId: string;
  kind: WorkflowUpdateKind;
  /** Optional node id the event relates to (for node_* events). */
  nodeId?: string;
  /** Optional edge id (for edge_* events). */
  edgeId?: string;
  /** Optional human-readable summary the canvas can flash inline. */
  summary?: string;
  /** Full node row for node_added / node_updated. Lets the canvas patch
   *  its local state in place instead of paying a full invalidateAll round
   *  trip — so nodes appear one at a time as they're built, not in a
   *  batch when the orchestrator's tool burst ends. */
  node?: {
    id: string;
    type: string;
    label: string;
    config: unknown;
    position: unknown;
  };
  /** Full edge row for edge_added. Same in-place-patch rationale. */
  edge?: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourceHandle: string | null;
    targetHandle: string | null;
  };
  ts: number;
}

type Listener = (e: WorkflowUpdateEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishWorkflowUpdate(e: WorkflowUpdateEvent): void {
  const set = listeners.get(e.workflowId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(e);
    } catch {
      // Broken subscriber must not poison the publish loop.
    }
  }
}

export function subscribeWorkflowUpdates(workflowId: string, fn: Listener): () => void {
  if (!workflowId) return () => {};
  let set = listeners.get(workflowId);
  if (!set) {
    set = new Set();
    listeners.set(workflowId, set);
  }
  set.add(fn);
  return () => {
    const current = listeners.get(workflowId);
    if (!current) return;
    current.delete(fn);
    if (current.size === 0) listeners.delete(workflowId);
  };
}

export function _resetWorkflowUpdatesBusForTests(): void {
  listeners.clear();
}
