// Edge auto-mapping — pure LLM-output sanitisation. Isomorphic (no DB/LLM), so
// it is unit-testable in isolation. The proposer NEVER trusts raw model output:
// only real target config keys are accepted, ops are never invented, and
// {{input.*}} refs are checked against the known upstream paths.
import type { MappingAction } from './types';

/** Tolerant JSON extraction — models sometimes wrap the object in prose/fences. */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** True when a value references an {{input.PATH}} the upstream is not known to emit. */
export function unknownRefs(value: unknown, knownPaths: Set<string>): boolean {
  if (typeof value !== 'string') return false;
  const refs = [...value.matchAll(/\{\{\s*input\.([^}\s]+)\s*\}\}/g)].map((m) => m[1]);
  return refs.some((r) => {
    const root = r.split('.')[0];
    return !knownPaths.has(r) && !knownPaths.has(root);
  });
}

/** Node types safe to auto-suggest inserting as a bridge. Anything else → advisory note. */
export const KNOWN_SAFE_INSERT_TYPES = new Set([
  'transform', 'llm-call', 'text-parser', 'validator', 'template',
]);

/**
 * Turn the model's raw `actions` array into validated MappingActions + a merged
 * config patch. Drops set-config on unknown target keys; downgrades unknown
 * insert-node types to advisory notes; flags unverified {{input.*}} refs.
 */
export function sanitizeActions(
  raw: unknown,
  targetKeys: string[],
  availablePaths: string[],
): { actions: MappingAction[]; configPatch: Record<string, unknown> } {
  const keySet = new Set(targetKeys);
  const pathSet = new Set(availablePaths);
  const actions: MappingAction[] = [];
  const configPatch: Record<string, unknown> = {};
  if (!Array.isArray(raw)) return { actions, configPatch };

  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const act = a as Record<string, unknown>;
    const kind = act.kind;
    const label = typeof act.label === 'string' && act.label.trim() ? act.label.trim() : undefined;
    const detail = typeof act.detail === 'string' ? act.detail : undefined;

    if (kind === 'set-config') {
      const field = typeof act.field === 'string' ? act.field : '';
      if (!keySet.has(field)) continue; // never write an unknown config key
      if (act.value === undefined) continue;
      actions.push({
        kind: 'set-config',
        field,
        value: act.value,
        label: label ?? `Set ${field}`,
        detail,
        unverifiedRef: unknownRefs(act.value, pathSet),
      });
      configPatch[field] = act.value;
    } else if (kind === 'insert-node') {
      const nodeType = typeof act.nodeType === 'string' ? act.nodeType : '';
      const safe = KNOWN_SAFE_INSERT_TYPES.has(nodeType);
      actions.push({
        kind: safe ? 'insert-node' : 'note',
        nodeType: safe ? nodeType : undefined,
        nodeConfig: safe ? ((act.nodeConfig as Record<string, unknown>) ?? undefined) : undefined,
        label: label ?? (nodeType ? `Insert a ${nodeType} node` : 'Add a bridging node'),
        detail,
      });
    } else if (kind === 'note') {
      if (label) actions.push({ kind: 'note', label, detail });
    }
  }
  return { actions, configPatch };
}
