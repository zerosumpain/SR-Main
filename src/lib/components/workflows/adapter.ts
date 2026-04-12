import type { Node, Edge } from '@xyflow/svelte';
import type { WorkflowNodeDef, WorkflowEdgeDef, Position } from '$lib/workflows';

export interface CanvasNode extends Node {
  data: {
    label: string;
    nodeType: string;
    config: Record<string, unknown>;
    status?: string;
  };
}

export interface CanvasEdge extends Edge {
  data?: {
    animated?: boolean;
  };
}

export function workflowNodesToCanvas(nodes: WorkflowNodeDef[]): CanvasNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position.x, y: n.position.y },
    data: {
      label: n.label,
      nodeType: n.type,
      config: n.config,
    },
  }));
}

export function workflowEdgesToCanvas(edges: WorkflowEdgeDef[]): CanvasEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
}

export function canvasNodesToWorkflow(nodes: CanvasNode[]): WorkflowNodeDef[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.data.nodeType,
    position: { x: n.position.x, y: n.position.y },
    config: n.data.config,
    label: n.data.label,
  }));
}

export function canvasEdgesToWorkflow(edges: CanvasEdge[]): WorkflowEdgeDef[] {
  return edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.source,
    targetNodeId: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));
}
