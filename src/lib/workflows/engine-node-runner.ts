// engine-node-runner.ts — pure per-node helpers lifted out of engine.ts: how a
// node's input is gathered and how its config is resolved before it runs.
import type { WorkflowGraph } from './graph';
import type { NodeDefinition } from './types';
import { nodeSlug, resolveConfig, type TemplateWarning } from './expressions';
import { markEngineResolved } from './nodes/template';

/**
 * Attach a hidden (non-enumerable) property: readable as `input.$from.x` by
 * templates, transforms and conditionals, but never spread into an output,
 * persisted as input_data, or merged downstream.
 */
function hide(obj: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(obj, key, { value, enumerable: false, configurable: true, writable: true });
}

/** A copy of `input` with its `$from`/`$ports` made visible — for JSON-serialising sandboxes. */
export function withBranches(input: Record<string, unknown>): Record<string, unknown> {
  return { ...input, $from: input.$from, $ports: input.$ports };
}

/**
 * Build a node's merged input from its upstream nodes' outputs:
 *  - root nodes (no incoming edges) receive a shallow copy of initialInput,
 *  - otherwise each non-skipped upstream output is Object.assign-merged in
 *    edge order (last-writer-wins),
 *  - a fan-in collision (two distinct sources providing the same key with
 *    differing JSON values) logs the same console.warn as before,
 *  - each upstream output ALSO sits unmerged under `input.$from[<id>]` and
 *    `input.$from[<label-slug>]`, and under `input.$ports[<targetHandle>]` when
 *    the edge names one — hidden properties, so the flat view is unchanged.
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
  const from: Record<string, unknown> = {};
  const ports: Record<string, unknown> = {};
  for (const edge of incomingEdges) {
    if (skippedNodes.has(edge.sourceNodeId)) continue;
    const upstream = nodeOutputs.get(edge.sourceNodeId);
    if (upstream) {
      const label = graph.nodeMap.get(edge.sourceNodeId)?.label;
      if (label && nodeSlug(label)) from[nodeSlug(label)] = upstream;
      from[edge.sourceNodeId] = upstream;
      if (edge.targetHandle) ports[edge.targetHandle] = upstream;
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
              `reference {{nodes.<id>.${k}}} instead, or give each branch its own key with a transform)`,
          );
        }
        keyProvenance.set(k, edge.sourceNodeId);
      }
      Object.assign(mergedInput, upstream);
    }
  }
  hide(mergedInput, '$from', from);
  hide(mergedInput, '$ports', ports);
  return mergedInput;
}

/**
 * Resolve a node's config ONCE, before its executor runs, and mark `input` so
 * the per-executor helpers in nodes/template.ts don't resolve it a second time.
 * `{{nodes.X}}` reads any node that has completed in this run, by id or label
 * slug (the verifier insists it is upstream). Code/expression fields named in
 * the definition's `rawConfigKeys` are passed through untouched.
 */
export function resolveNodeConfig(
  config: Record<string, unknown>,
  def: NodeDefinition | undefined,
  input: Record<string, unknown>,
  run: {
    graph: WorkflowGraph;
    nodeOutputs: Map<string, Record<string, unknown>>;
    trigger: Record<string, unknown>;
    store: Map<string, unknown>;
  },
): { config: Record<string, unknown>; warnings: TemplateWarning[] } {
  const typedKeys = new Set(
    Object.entries(def?.configSchema?.properties ?? {})
      .filter(([, p]) => p.type !== undefined && p.type !== 'string')
      .map(([k]) => k),
  );
  const nodes = (ref: string) => {
    if (run.nodeOutputs.has(ref)) return run.nodeOutputs.get(ref);
    for (const [id, n] of run.graph.nodeMap) {
      if (n.label && nodeSlug(n.label) === ref) return run.nodeOutputs.get(id);
    }
    return undefined;
  };
  // {{trigger.x}}: the trigger node's output (e.g. gmail-trigger's from/subject),
  // over the raw payload the run was started with.
  const roots = run.graph.nodeIds.filter((id) => !run.graph.incomingCount.get(id));
  const trigger = Object.assign({}, run.trigger, ...roots.map((id) => run.nodeOutputs.get(id) ?? {}));
  const r = resolveConfig(config, { input, nodes, trigger, state: run.store, now: new Date() }, {
    rawKeys: def?.rawConfigKeys,
    typedKeys,
  });
  markEngineResolved(input, r.missingByText);
  return { config: r.config, warnings: r.warnings };
}
