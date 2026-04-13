import type { JsonSchema, WorkflowNodeDef, WorkflowEdgeDef } from './types';

export interface VariablePath {
  path: string;
  type: string;
  description: string | undefined;
}

/**
 * Walks the graph backwards from a target node, finds all immediate upstream
 * nodes, gets their output schemas via the callback, and merges them into a
 * single schema keyed by upstream node id.
 *
 * Returns `{ type: 'object', properties: { [upstreamNodeId]: outputSchema } }`.
 */
export function resolveUpstreamSchema(
  targetNodeId: string,
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  getOutputSchema: (node: WorkflowNodeDef) => JsonSchema,
): JsonSchema {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Find all edges targeting this node
  const incomingEdges = edges.filter((e) => e.targetNodeId === targetNodeId);

  // No incoming edges = trigger node or unknown node
  if (incomingEdges.length === 0) {
    return { type: 'object', properties: {} };
  }

  const properties: Record<string, JsonSchema> = {};

  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    if (!sourceNode) continue;

    const outputSchema = getOutputSchema(sourceNode);
    // Key by source node id — later edges overwrite earlier (Object.assign semantics)
    properties[sourceNode.id] = outputSchema;
  }

  return { type: 'object', properties };
}

/**
 * Flattens a JsonSchema into a list of variable paths for autocomplete.
 * Nested objects produce dot-separated paths.
 *
 * Example: `{ usage: { promptTokens: number } }` produces
 * `["usage", "usage.promptTokens"]`.
 */
export function schemaToVariablePaths(
  schema: JsonSchema,
  prefix?: string,
): VariablePath[] {
  const results: VariablePath[] = [];

  if (!schema.properties) {
    return results;
  }

  for (const [key, value] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;

    results.push({
      path,
      type: value.type,
      description: value.description as string | undefined,
    });

    // Recurse into nested objects
    if (value.type === 'object' && value.properties) {
      results.push(...schemaToVariablePaths(value, path));
    }
  }

  return results;
}
