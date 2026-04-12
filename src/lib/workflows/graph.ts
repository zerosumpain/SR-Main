import type { WorkflowNodeDef, WorkflowEdgeDef } from './types';

export interface WorkflowGraph {
  nodeIds: string[];
  adjacency: Map<string, string[]>;
  incomingCount: Map<string, number>;
  edgesBySource: Map<string, WorkflowEdgeDef[]>;
  edgesByTarget: Map<string, WorkflowEdgeDef[]>;
  nodeMap: Map<string, WorkflowNodeDef>;
}

export function buildGraph(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
): WorkflowGraph {
  const nodeIds = nodes.map((n) => n.id);
  const adjacency = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const edgesBySource = new Map<string, WorkflowEdgeDef[]>();
  const edgesByTarget = new Map<string, WorkflowEdgeDef[]>();
  const nodeMap = new Map<string, WorkflowNodeDef>();

  for (const node of nodes) {
    adjacency.set(node.id, []);
    incomingCount.set(node.id, 0);
    edgesBySource.set(node.id, []);
    edgesByTarget.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    adjacency.get(edge.sourceNodeId)!.push(edge.targetNodeId);
    incomingCount.set(
      edge.targetNodeId,
      (incomingCount.get(edge.targetNodeId) ?? 0) + 1,
    );
    edgesBySource.get(edge.sourceNodeId)!.push(edge);
    edgesByTarget.get(edge.targetNodeId)!.push(edge);
  }

  return { nodeIds, adjacency, incomingCount, edgesBySource, edgesByTarget, nodeMap };
}

export function topologicalSort(graph: WorkflowGraph): string[][] {
  const inDegree = new Map(graph.incomingCount);
  const levels: string[][] = [];
  let remaining = graph.nodeIds.length;

  while (remaining > 0) {
    const level: string[] = [];
    for (const id of graph.nodeIds) {
      if (inDegree.get(id) === 0) {
        level.push(id);
      }
    }

    if (level.length === 0) {
      throw new Error('Workflow graph contains a cycle');
    }

    for (const id of level) {
      inDegree.set(id, -1); // mark processed
      for (const neighbour of graph.adjacency.get(id)!) {
        inDegree.set(neighbour, inDegree.get(neighbour)! - 1);
      }
    }

    levels.push(level);
    remaining -= level.length;
  }

  return levels;
}
