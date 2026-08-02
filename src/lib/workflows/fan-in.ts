// Detecting the fan-in collision — two upstream nodes whose outputs overwrite
// each other where they converge.
//
// WHY THIS EXISTS
// ---------------
// When several nodes feed one node, the engine builds that node's input with a
// flat `Object.assign` per upstream (see `mergeUpstreamInput` in
// engine-node-runner.ts). There is no namespacing by source node. So if two
// upstreams declare the same top-level key, the one processed last silently
// wins and the other's data is gone before the target node ever sees it.
//
// Two `api-call` nodes are the worst case, because every api-call emits the
// SAME keys — `success`, `api`, `status`, `url`, `json`. Wiring both straight
// into one node therefore throws away one of them every time.
//
// On 2026-08-02 the `daily-spend-summary` canvas did exactly that, twice: the
// accounts branch was wiped out by the cards branch, and all three transaction
// branches collapsed into one. The transform downstream found nothing where it
// expected data, emitted empty strings rather than failing, and the run died
// three nodes later with an unexplained HTTP 404. Nothing in the build, the
// save or the canvas UI had flagged it.
//
// `merge` does NOT fix this — it is literally `{...input}`, so it collapses the
// same way. The fix is always to give each branch its own key BEFORE the
// branches converge, with a small `transform` on each:
//
//     return { accounts: input.json.results };   // on one branch
//     return { cards: input.json.results };      // on the other
//
// This module is pure and takes an injected schema getter, matching
// schema-propagation.ts, so it can be unit-tested without the node registry.

import type { JsonSchema, WorkflowNodeDef, WorkflowEdgeDef } from './types';

type OutputSchemaGetter = (type: string, config: Record<string, unknown>) => JsonSchema | undefined;

export interface FanInCollision {
  nodeId: string;
  nodeLabel: string;
  /** Keys declared by more than one upstream. Last writer wins; the rest are lost. */
  keys: string[];
  sources: Array<{ nodeId: string; label: string }>;
  /** Owner/model-facing explanation, including how to fix it. */
  message: string;
}

/**
 * Top-level keys a node is declared to output.
 *
 * A `transform` node's shape comes from its own `outputSchema` config rather
 * than the executor, which is why the config is consulted first — that is also
 * what makes the recommended fix (a transform that renames the payload)
 * detectable as NON-colliding.
 *
 * Returns null when the shape is genuinely unknown, so an unregistered or
 * schema-less node type is treated as "cannot judge" rather than "no keys".
 * Guessing here would produce false alarms on every custom node.
 */
export function declaredOutputKeys(
  node: WorkflowNodeDef,
  getOutputSchema: OutputSchemaGetter,
): string[] | null {
  const configured = (node.config ?? {}).outputSchema;
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    const keys = Object.keys(configured as Record<string, unknown>);
    if (keys.length) return keys;
  }

  const schema = getOutputSchema(node.type, node.config ?? {});
  const props = schema?.properties;
  if (props && typeof props === 'object') {
    const keys = Object.keys(props);
    if (keys.length) return keys;
  }
  return null;
}

function describe(nodeLabel: string, keys: string[], sources: Array<{ label: string }>): string {
  const keyList = keys.map((k) => `"${k}"`).join(', ');
  const srcList = sources.map((s) => `"${s.label}"`).join(' and ');
  return (
    `"${nodeLabel}" receives ${keyList} from more than one upstream node (${srcList}). ` +
    `Inputs are merged flat, so whichever finishes last overwrites the others and that data is ` +
    `lost before this node runs. Adding a "merge" node does not help — it merges the same way. ` +
    `Put a small transform on each branch first to give it its own key ` +
    `(e.g. \`return { accounts: input.json.results };\` on one and ` +
    `\`return { cards: input.json.results };\` on the other), then read those keys here.`
  );
}

/**
 * Every node in the graph whose upstreams would overwrite one another.
 *
 * Deliberately reports rather than throws: a collision is usually a bug, but
 * not always (two branches that genuinely produce the same value, or a diamond
 * where only one side ever runs). Callers decide how loud to be — the tools
 * attach it as a warning, and the engine logs it per run.
 */
export function findFanInCollisions(
  nodes: WorkflowNodeDef[],
  edges: WorkflowEdgeDef[],
  getOutputSchema: OutputSchemaGetter,
): FanInCollision[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const byTarget = new Map<string, string[]>();

  for (const edge of edges) {
    const list = byTarget.get(edge.targetNodeId) ?? [];
    // A duplicate edge between the same pair is not a fan-in.
    if (!list.includes(edge.sourceNodeId)) list.push(edge.sourceNodeId);
    byTarget.set(edge.targetNodeId, list);
  }

  const out: FanInCollision[] = [];

  for (const [targetId, sourceIds] of byTarget) {
    if (sourceIds.length < 2) continue;
    const target = nodeMap.get(targetId);
    if (!target) continue;

    // key -> the source nodes declaring it
    const owners = new Map<string, string[]>();
    for (const sourceId of sourceIds) {
      const source = nodeMap.get(sourceId);
      if (!source) continue;
      const keys = declaredOutputKeys(source, getOutputSchema);
      if (!keys) continue; // unknown shape — cannot judge, stay quiet
      for (const key of keys) {
        owners.set(key, [...(owners.get(key) ?? []), sourceId]);
      }
    }

    const collidingKeys = [...owners.entries()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key]) => key)
      .sort();
    if (!collidingKeys.length) continue;

    const involved = new Set(collidingKeys.flatMap((k) => owners.get(k) ?? []));
    const sources = [...involved].map((id) => ({
      nodeId: id,
      label: nodeMap.get(id)?.label ?? id,
    }));

    out.push({
      nodeId: targetId,
      nodeLabel: target.label ?? targetId,
      keys: collidingKeys,
      sources,
      message: describe(target.label ?? targetId, collidingKeys, sources),
    });
  }

  return out;
}
