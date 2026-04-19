import type { WorkflowDraft, ThinkingStep } from './types';

type DraftNode = WorkflowDraft['nodes'] extends Map<string, infer V> ? V : never;
type DraftEdge = WorkflowDraft['edges'][number];
type DraftNewNode = WorkflowDraft['newNodeTypes'][number];
type SearchLogEntry = WorkflowDraft['searchLog'][number];

/**
 * Convert WorkflowDraft to a plain JSON-safe object for DB storage.
 * Maps become arrays of [key, value] pairs.
 */
export function serializeDraft(draft: WorkflowDraft): Record<string, unknown> {
  return {
    nodes: Array.from(draft.nodes.entries()),
    edges: draft.edges,
    newNodeTypes: draft.newNodeTypes,
    searchLog: draft.searchLog,
    decisions: draft.decisions,
    trigger: draft.trigger,
  };
}

/**
 * Rehydrate a WorkflowDraft from its serialized form.
 * Missing fields default to empty structures so partial data doesn't crash.
 */
export function deserializeDraft(data: Record<string, unknown>): WorkflowDraft {
  const raw = data as {
    nodes?: Array<[string, DraftNode]>;
    edges?: DraftEdge[];
    newNodeTypes?: DraftNewNode[];
    searchLog?: SearchLogEntry[];
    decisions?: ThinkingStep[];
    trigger?: { type: string; config?: Record<string, unknown> };
  };

  return {
    nodes: new Map(raw.nodes ?? []),
    edges: raw.edges ?? [],
    newNodeTypes: raw.newNodeTypes ?? [],
    searchLog: raw.searchLog ?? [],
    decisions: raw.decisions ?? [],
    trigger: raw.trigger,
  };
}
