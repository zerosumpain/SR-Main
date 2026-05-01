import type { JsonSchema, WorkflowNodeDef, WorkflowEdgeDef } from './types';

export interface VariablePath {
  path: string;
  type: string;
  description: string | undefined;
}

type OutputSchemaGetter = (type: string, config: Record<string, unknown>) => JsonSchema;

/**
 * Walk the graph backwards from targetNodeId and compute the merged
 * output schema of all immediate upstream nodes. This gives the
 * "available variables" for the target node's config.
 *
 * Properties are merged flat (matching runtime Object.assign behavior).
 */
export function resolveUpstreamSchema(
  targetNodeId: string,
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  getOutputSchema: OutputSchemaGetter,
): JsonSchema {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Find all edges targeting this node
  const incomingEdges = edges.filter((e) => e.targetNodeId === targetNodeId);

  // No incoming edges = trigger node or unknown node
  if (incomingEdges.length === 0) {
    return { type: 'object', properties: {} };
  }

  // Loop body special case: when the immediate upstream is a `loop` node,
  // each iteration sees the array element as `input`, NOT the loop's own
  // {results, count} output. We can't statically infer the element shape
  // without tracing through arrayPath, so we surface an "unknown" schema
  // (no properties). The downstream verifier already skips reference
  // checks when the upstream schema has zero properties — this prevents
  // false positives like "input.title not found in upstream {results, count}"
  // for nodes that legitimately read per-element fields inside a loop.
  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    if (sourceNode?.type === 'loop') {
      return { type: 'object', properties: {} };
    }
  }

  const mergedProperties: Record<string, JsonSchema> = {};

  for (const edge of incomingEdges) {
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    if (!sourceNode) continue;

    const outputSchema = getOutputSchema(sourceNode.type, sourceNode.config);
    if (outputSchema.properties) {
      Object.assign(mergedProperties, outputSchema.properties);
    }
  }

  return { type: 'object', properties: mergedProperties };
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
