/**
 * engine-node-runner.ts
 *
 * Conservative extractions from engine.ts (#13). Only PURE, side-effect-free
 * (modulo console.warn) helpers live here, lifted verbatim with zero behaviour,
 * control-flow, or event change. Risky pieces — the self-healing loop, the
 * retry wrapper, the per-node abort/timeout wiring, and all event emission —
 * intentionally stay inline in engine.ts because their correctness depends on
 * closures over a dozen run-scoped locals and on exact ordering of emits; a
 * mechanical extraction would be high-risk for no real readability gain.
 */
import type { WorkflowGraph } from './graph';

/**
 * Build a node's merged input from its upstream nodes' outputs.
 *
 * Lifted verbatim from engine.execute()'s "Gather input from upstream nodes"
 * block. Behaviour is identical:
 *  - root nodes (no incoming edges) receive a shallow copy of initialInput,
 *  - otherwise each non-skipped upstream output is Object.assign-merged in
 *    edge order (last-writer-wins),
 *  - a fan-in collision (two distinct sources providing the same key with
 *    differing JSON values) logs the same console.warn as before.
 *
 * Pure aside from the warn log: reads only the maps/sets it's handed and
 * returns a fresh object.
 */
export function mergeUpstreamInput(
  nodeId: string,
  runId: string,
  graph: WorkflowGraph,
  nodeOutputs: Map<string, Record<string, unknown>>,
  skippedNodes: Set<string>,
  initialInput: Record<string, unknown>,
): Record<string, unknown> {
  const incomingEdges = graph.edgesByTarget.get(nodeId) || [];

  if (incomingEdges.length === 0) {
    return { ...initialInput };
  }

  const mergedInput: Record<string, unknown> = {};
  // Track which upstream source contributed each top-level key so we
  // can warn on fan-in collisions (two sources providing the same key
  // with differing values). The merge itself stays last-writer-wins;
  // this only surfaces the silent overwrite for debuggability.
  const keyProvenance = new Map<string, string>();
  for (const edge of incomingEdges) {
    if (skippedNodes.has(edge.sourceNodeId)) continue;
    const upstream = nodeOutputs.get(edge.sourceNodeId);
    if (upstream) {
      for (const [k, v] of Object.entries(upstream)) {
        const prevSource = keyProvenance.get(k);
        if (
          prevSource !== undefined &&
          prevSource !== edge.sourceNodeId &&
          JSON.stringify(mergedInput[k]) !== JSON.stringify(v)
        ) {
          console.warn(
            `[engine] fan-in collision run=${runId} node=${nodeId} key=${k}: ` +
              `value from ${edge.sourceNodeId} overwrites differing value from ${prevSource} ` +
              `(last-writer-wins — the overwritten data is LOST before this node runs; ` +
              `give each branch its own key with a transform, a merge node will not help)`,
          );
        }
        keyProvenance.set(k, edge.sourceNodeId);
      }
      Object.assign(mergedInput, upstream);
    }
  }
  return mergedInput;
}
