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

import { nodeSlug } from '$lib/workflows/expressions';

interface CanvasNodeLike {
  id: string;
  /** Node label (canvas `name`) — its slug is how `{{nodes.<slug>.x}}` names it. */
  name?: string;
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

/** Svelte context key: the canvas page provides `() => string[]` of full expressions. */
export const TEMPLATE_FIELDS_CONTEXT = 'sr:template-fields';
const NAMESPACED = /^(?:(?:input|nodes|trigger|state)\.|(?:today|now)$)/;

/** Autocomplete candidates: bare run-data paths become `input.<path>` (a bare
 *  `{{body.x}}` never resolves); `extra` adds the page's nodes/trigger entries. */
export function templateCandidates(fields: string[], extra: string[] = []): string[] {
  return [...new Set([...fields.map((f) => (NAMESPACED.test(f) ? f : `input.${f}`)), ...extra])];
}

/** The first `limit` candidates containing what was typed after `{{`. */
export function filterTemplateCandidates(candidates: string[], partial: string, limit = 8): string[] {
  const needle = partial.trim().toLowerCase().replace(/^input\./, '');
  return candidates.filter((f) => !needle || f.toLowerCase().includes(needle)).slice(0, limit);
}

/**
 * Full `{{...}}` expressions for the template autocomplete: the merged view
 * (`input.x`, run data plus any `declared` schema paths), each upstream node
 * on its own (`nodes.<label-slug>.x` — the one that survives a fan-in), and the
 * trigger's payload (`trigger.x`, from the root upstream node's last output).
 */
export function computeTemplateSuggestions(
  targetNodeId: string,
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
  declared: string[] = [],
): string[] {
  const out = new Set<string>();
  for (const p of [...computeUpstreamFields(targetNodeId, nodes, edges), ...declared]) out.add(`input.${p}`);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const sourcesOf = (id: string) => edges.filter((e) => e.targetNodeId === id).map((e) => e.sourceNodeId);
  const seen = new Set<string>();
  const queue = sourcesOf(targetNodeId);
  while (queue.length && out.size < MAX_TOTAL_FIELDS) {
    const id = queue.shift()!;
    if (seen.has(id) || id === targetNodeId) continue;
    seen.add(id);
    const node = byId.get(id);
    const parents = sourcesOf(id);
    queue.push(...parents);
    if (node?.outputData === undefined) continue;
    const paths = new Set<string>();
    walkOutput(node.outputData, '', paths, 0);
    const ref = (node.name && nodeSlug(node.name)) || id;
    for (const p of paths) out.add(`nodes.${ref}.${p}`);
    if (parents.length === 0) for (const p of paths) out.add(`trigger.${p}`);
  }
  return Array.from(out);
}

/**
 * Detect fan-in key collisions: top-level output keys emitted by TWO OR MORE
 * immediate upstream nodes. At runtime the engine merges upstream outputs with
 * a flat last-writer-wins Object.assign, so a colliding key silently overwrites
 * — `{{input.text}}` then resolves to whichever upstream ran last, with no way
 * to disambiguate. Surfacing this at edit time turns a silent footgun into a
 * visible warning. Best-effort: only sees keys from nodes that have run output.
 */
export function computeUpstreamCollisions(
  targetNodeId: string,
  nodes: CanvasNodeLike[],
  edges: CanvasEdgeLike[],
): Array<{ key: string; sources: string[] }> {
  const byId = new Map<string, CanvasNodeLike>();
  for (const n of nodes) byId.set(n.id, n);

  const immediateUpstreamIds = edges
    .filter((e) => e.targetNodeId === targetNodeId)
    .map((e) => e.sourceNodeId);

  const keyToSources = new Map<string, Set<string>>();
  for (const id of immediateUpstreamIds) {
    const out = byId.get(id)?.outputData;
    if (!out || typeof out !== 'object' || Array.isArray(out)) continue;
    for (const key of Object.keys(out as Record<string, unknown>)) {
      if (!keyToSources.has(key)) keyToSources.set(key, new Set());
      keyToSources.get(key)!.add(id);
    }
  }

  const collisions: Array<{ key: string; sources: string[] }> = [];
  for (const [key, sources] of keyToSources) {
    if (sources.size >= 2) collisions.push({ key, sources: Array.from(sources) });
  }
  return collisions.sort((a, b) => a.key.localeCompare(b.key));
}
