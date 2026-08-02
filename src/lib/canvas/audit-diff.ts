import { findSensitive, type SensitiveKind } from '$lib/security/sensitive';

export type NodeDiffEntry =
  | { action: 'rename'; details: { old: string; new: string } }
  | { action: 'config'; details: { field: string; old: unknown; new: unknown } };

export type WorkflowDiffEntry = {
  action: 'rename';
  details: { field: string; old: unknown; new: unknown };
};

interface NodeShape {
  label: string;
  config: Record<string, unknown>;
  position?: { x: number; y: number };
}

/**
 * The kind of the first sensitive span in a value, or null. Non-strings are
 * scanned as their JSON, so a credential nested in an object still registers.
 */
function sensitiveKind(value: unknown): SensitiveKind | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      return null;
    }
  }
  return findSensitive(text)[0]?.kind ?? null;
}

/**
 * Placeholder BOTH sides when either one is sensitive.
 *
 * `workflow_audit_log.details` is served raw to the browser and fans out from
 * there, and the leak that prompted this was the `old` side: a PATCH that took
 * a credential *out* of a node config republished it verbatim. Redacting only
 * the side that matched leaves the same string reachable whenever the other
 * side is a near-miss on the patterns, so the pair travels together. The field
 * NAME is always kept — it is what makes the entry actionable.
 */
function redactPair<T>(oldVal: T, newVal: T): { old: T | string; new: T | string } {
  const kind = sensitiveKind(oldVal) ?? sensitiveKind(newVal);
  if (!kind) return { old: oldVal, new: newVal };
  const placeholder = `[redacted:${kind}]`;
  return { old: placeholder, new: placeholder };
}

/**
 * Diff a PATCH body against the stored node, returning audit entries.
 * `position` and `config.size` changes are intentionally excluded —
 * these are considered cosmetic and not part of the edit history.
 */
export function diffNodePatch(
  before: NodeShape,
  patch: Partial<NodeShape>,
): NodeDiffEntry[] {
  const entries: NodeDiffEntry[] = [];

  if (typeof patch.label === 'string' && patch.label !== before.label) {
    entries.push({
      action: 'rename',
      details: redactPair<string>(before.label, patch.label),
    });
  }

  if (patch.config && typeof patch.config === 'object') {
    const beforeCfg = before.config ?? {};
    const afterCfg = patch.config;
    const keys = new Set([...Object.keys(beforeCfg), ...Object.keys(afterCfg)]);
    for (const field of keys) {
      if (field === 'size') continue; // excluded
      const oldVal = beforeCfg[field];
      const newVal = afterCfg[field];
      // Compared raw, emitted redacted — two different secrets must still read
      // as a change, not as `[redacted:api-key]` equalling itself.
      if (!deepEqual(oldVal, newVal)) {
        entries.push({
          action: 'config',
          details: { field, ...redactPair(oldVal, newVal) },
        });
      }
    }
  }

  return entries;
}

interface WorkflowShape {
  name: string;
  description: string | null;
}

export function diffWorkflowPatch(
  before: WorkflowShape,
  patch: Partial<WorkflowShape>,
): WorkflowDiffEntry[] {
  const entries: WorkflowDiffEntry[] = [];
  for (const field of ['name', 'description'] as const) {
    if (patch[field] !== undefined && patch[field] !== before[field]) {
      entries.push({
        action: 'rename',
        details: { field, old: before[field], new: patch[field] },
      });
    }
  }
  return entries;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
