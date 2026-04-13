import type { GeneratedWorkflow } from './types';

export function extractJsonFromResponse(text: string): Record<string, unknown> | null {
  // Try parsing the whole string as JSON
  try {
    return JSON.parse(text.trim());
  } catch {
    // Not pure JSON
  }

  // Try extracting from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // Invalid JSON in fence
    }
  }

  // Try finding a JSON object in the text
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    try {
      return JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      // Not valid JSON
    }
  }

  return null;
}

export function parseWorkflowResponse(text: string): GeneratedWorkflow | null {
  const json = extractJsonFromResponse(text);
  if (!json) return null;

  const nodes = json.nodes;
  const edges = Array.isArray(json.edges) ? json.edges : [];

  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  // Normalize nodes — ensure IDs and positions
  const normalizedNodes = nodes.map((n: any, i: number) => ({
    id: n.id || `node-${crypto.randomUUID().slice(0, 8)}`,
    type: n.type || 'transform',
    position: n.position || { x: 0, y: 0 },
    config: n.config || {},
    label: n.label || n.type || `Node ${i + 1}`,
  }));

  // Build a map of old ID → new ID for edges
  const idMap = new Map<string, string>();
  nodes.forEach((n: any, i: number) => {
    if (n.id) idMap.set(n.id, normalizedNodes[i].id);
  });

  // Normalize edges — handle both sourceNodeId/targetNodeId and source/target field names
  let normalizedEdges = edges.map((e: any) => {
    const srcId = e.sourceNodeId || e.source || e.from;
    const tgtId = e.targetNodeId || e.target || e.to;
    return {
      id: e.id || `edge-${crypto.randomUUID().slice(0, 8)}`,
      sourceNodeId: idMap.get(srcId) || srcId,
      targetNodeId: idMap.get(tgtId) || tgtId,
      sourceHandle: e.sourceHandle || undefined,
      targetHandle: e.targetHandle || undefined,
    };
  });

  // If no edges provided, auto-connect nodes in sequence
  if (normalizedEdges.length === 0 && normalizedNodes.length > 1) {
    normalizedEdges = normalizedNodes.slice(0, -1).map((node: any, i: number) => ({
      id: `edge-auto-${i}`,
      sourceNodeId: node.id,
      targetNodeId: normalizedNodes[i + 1].id,
      sourceHandle: undefined,
      targetHandle: undefined,
    }));
  }

  return {
    name: (json.name as string) || 'Generated Workflow',
    description: (json.description as string) || undefined,
    nodes: normalizedNodes,
    edges: normalizedEdges,
    explanation: (json.explanation as string) || '',
  };
}
