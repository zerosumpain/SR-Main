// Compute the set of dot-paths that an `input.X` template can reference
// for a given canvas node, by walking upstream edges and collecting keys
// from every upstream node's most-recent run output.
//
// We use real run output rather than NodeDefinition.getOutputSchema()
// because (a) most of our schemas are loose `{ type: 'object' }`, and
// (b) actual run data tells the user the EXACT shape — including arrays
// and nested objects — that the orchestrator's templates need to address.
// When upstream nodes haven't run yet, the picker falls back to a free
// text input and the user types the path manually.

interface CanvasEdgeLike {
  sourceNodeId: string;
  targetNodeId: string;
}

interface CanvasNodeLike {
  id: string;
  outputData?: unknown;
}

const MAX_DEPTH = 4;
const MAX_FIELDS_PER_NODE = 200;
const MAX_TOTAL_FIELDS = 600;

/**
 * Walks one upstream node's outputData and returns dot-paths usable
 * inside `input.X` templates.
 *
 * Behaviour:
 *  - Plain objects: recurse and emit `key`, `key.nested`, etc.
 *  - Arrays: emit the bare path (so `body.results` references the array)
 *    AND recurse into the FIRST element with index `0`, so the user can
 *    target `body.results.0.id` if that's what the upstream produces.
 *  - Primitives: stop (the parent path is the final reference).
 */
function walkOutput(value: unknown, prefix: string, out: Set<string>, depth: number): void {
  if (out.size >= MAX_TOTAL_FIELDS) return;
  if (depth > MAX_DEPTH) return;
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    if (prefix) out.add(prefix);
    if (value.length > 0) walkOutput(value[0], prefix ? `${prefix}.0` : '0', out, depth + 1);
    return;
  }

  if (typeof value === 'object') {
    if (prefix) out.add(prefix);
    let count = 0;
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (count++ >= MAX_FIELDS_PER_NODE) break;
      const next = prefix ? `${prefix}.${key}` : key;
      out.add(next);
      walkOutput((value as Record<string, unknown>)[key], next, out, depth + 1);
    }
    return;
  }

  // Primitives — the prefix is the final addressable path.
  if (prefix) out.add(prefix);
}

/**
 * Compute the upstream-field set for a target node. Walks `edges`
 * backwards from `targetNodeId`, collecting paths from each upstream
 * node's `outputData`. Returns a sorted, de-duplicated array.
 *
 * Cycles (which the engine forbids but the in-progress canvas may
 * temporarily contain) are guarded with a visited set.
 */
export function computeUpstreamFields(
  targetNodeId: string,
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): string[] {
  const byId = new Map<string, CanvasNodeLike>();
  for (const n of nodes) byId.set(n.id, n);

  const upstreamOf = new Map<string, string[]>();
  for (const e of edges) {
    const arr = upstreamOf.get(e.targetNodeId) ?? [];
    arr.push(e.sourceNodeId);
    upstreamOf.set(e.targetNodeId, arr);
  }

  const visited = new Set<string>();
  const out = new Set<string>();
  const queue: string[] = [targetNodeId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    if (id !== targetNodeId) {
      const node = byId.get(id);
      if (node?.outputData !== undefined) {
        walkOutput(node.outputData, '', out, 0);
      }
    }

    for (const src of upstreamOf.get(id) ?? []) {
      if (!visited.has(src)) queue.push(src);
    }

    if (out.size >= MAX_TOTAL_FIELDS) break;
  }

  return Array.from(out).sort();
}
