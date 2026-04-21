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
      details: { old: before.label, new: patch.label },
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
      if (!deepEqual(oldVal, newVal)) {
        entries.push({
          action: 'config',
          details: { field, old: oldVal, new: newVal },
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
