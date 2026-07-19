// Edge auto-mapping — deterministic engine. Isomorphic (client + server); NO
// DB, NO LLM. Reuses the existing handle-kind system (`$lib/canvas/handles` +
// the `$lib/canvas/adapter` palette) rather than inventing a new type model.
import { byType } from '$lib/canvas/adapter';
import type {
  CompatibilityReport,
  EdgeCompatibilityIssue,
  MappingAction,
  MappingContext,
} from './types';

/** Handle-kind compatibility between two node types (mirrors handles.ts `compatibility`, but explains itself). */
export function edgeCompatibility(sourceType: string, targetType: string): CompatibilityReport {
  const outHandles = byType(sourceType)?.handles.outputs ?? [];
  const inHandles = byType(targetType)?.handles.inputs ?? [];
  const outputKinds = [...new Set(outHandles.flatMap((h) => h.kinds))];
  const inputKinds = [...new Set(inHandles.flatMap((h) => h.kinds))];

  // One side declares no kinds -> we cannot judge; treat as compatible (no warning).
  if (outputKinds.length === 0 || inputKinds.length === 0) {
    return {
      kindMatch: true,
      level: 'unknown',
      outputKinds,
      inputKinds,
      reasons: ['handle kinds unspecified for one side — assuming compatible'],
    };
  }

  const anyWild = outputKinds.includes('any') || inputKinds.includes('any');
  const shared = outputKinds.filter((k) => inputKinds.includes(k));
  if (anyWild || shared.length > 0) {
    return {
      kindMatch: true,
      level: 'direct',
      outputKinds,
      inputKinds,
      reasons: [anyWild ? 'wildcard "any" handle accepts anything' : `shared kind(s): ${shared.join(', ')}`],
    };
  }

  return {
    kindMatch: false,
    level: 'incompatible',
    outputKinds,
    inputKinds,
    reasons: [`${sourceType} emits [${outputKinds.join(', ')}] but ${targetType} accepts [${inputKinds.join(', ')}]`],
  };
}

/**
 * Batch compatibility check over a whole workflow's edges — the generator /
 * auto-created-workflow validator. Emits a WARNING (never a hard error) per
 * kind-incompatible edge so it surfaces without regressing the zero-error gate.
 */
export function validateWorkflowCompatibility(
  nodes: Array<{ id: string; type: string }>,
  edges: Array<{ sourceNodeId: string; targetNodeId: string }>,
): EdgeCompatibilityIssue[] {
  const typeById = new Map(nodes.map((n) => [n.id, n.type]));
  const issues: EdgeCompatibilityIssue[] = [];
  for (const e of edges) {
    const sourceType = typeById.get(e.sourceNodeId);
    const targetType = typeById.get(e.targetNodeId);
    if (!sourceType || !targetType) continue;
    const rep = edgeCompatibility(sourceType, targetType);
    if (rep.level === 'incompatible') {
      issues.push({
        sourceNodeId: e.sourceNodeId,
        targetNodeId: e.targetNodeId,
        sourceType,
        targetType,
        severity: 'warning',
        issue: `Connection ${sourceType} → ${targetType}: ${rep.reasons[0]}. Consider a transform node to bridge the data, or a different target.`,
      });
    }
  }
  return issues;
}

// ── Heuristic (LLM-free) mapping ─────────────────────────────────────────────

// Order of preference when guessing the "primary" data path an upstream emits.
const PREFERRED_PATHS = [
  'json', 'body', 'data', 'records', 'results', 'output', 'result', 'items', 'rows',
  'text', 'content', 'message', 'value',
];

// Target config fields that typically want a data/content value fed in.
const CONTENT_FIELDS = new Set([
  'data', 'text', 'message', 'content', 'prompt', 'query', 'input', 'body', 'value', 'spec', 'patch',
]);

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Best guess at the upstream's primary output path (for a {{input.PATH}} ref). */
export function primaryDataPath(paths: string[]): string | undefined {
  for (const p of PREFERRED_PATHS) if (paths.includes(p)) return p;
  const topLevel = paths.filter((p) => !p.includes('.') && !/\.\d+$/.test(p));
  return topLevel[0] ?? paths[0];
}

/**
 * Deterministic best-effort mapping — the LLM-free fallback and the seed for
 * validation. Fills empty templated target fields from the available upstream
 * paths, with a couple of high-value node-pair specials (database, deck-build).
 */
export function heuristicMapping(ctx: MappingContext): {
  actions: MappingAction[];
  configPatch: Record<string, unknown>;
  rationale: string;
  confidence: number;
} {
  const actions: MappingAction[] = [];
  const patch: Record<string, unknown> = {};
  const primary = primaryDataPath(ctx.availablePaths);
  const ref = primary ? `{{input.${primary}}}` : '{{input}}';
  const cfg = ctx.targetConfig;
  const keys = new Set(ctx.targetConfigKeys);

  const isEmpty = (k: string) => cfg[k] === undefined || cfg[k] === null || cfg[k] === '';
  const add = (field: string, value: unknown, label: string, detail: string) => {
    actions.push({ kind: 'set-config', field, value, label, detail, unverifiedRef: !primary });
    patch[field] = value;
  };

  if (ctx.targetType === 'database') {
    if (keys.has('operation') && isEmpty('operation')) {
      add('operation', 'upsert', 'Upsert each record', 'Idempotent write — re-runs update the same row instead of duplicating');
    }
    if (keys.has('collection') && isEmpty('collection')) {
      const coll = slug(ctx.sourceLabel) || 'records';
      add('collection', coll, `Store in collection "${coll}"`, `Derived from the source "${ctx.sourceLabel}"`);
    }
    const idPath = ctx.availablePaths.find((p) => {
      const seg = p.split('.').pop() ?? '';
      return /(^|_)(id|urn|slug|number|key|uid)$/i.test(seg);
    });
    if (idPath && keys.has('key') && isEmpty('key')) {
      add('key', `{{input.${idPath}}}`, `Key each record by ${idPath}`, 'A stable natural key so upserts dedupe');
    }
    if (keys.has('data') && isEmpty('data')) {
      add('data', ref, 'Store the upstream payload', `Writes ${ref} into each record`);
    }
  } else {
    // Generic: feed the primary data path into the first empty content-ish field.
    for (const k of ctx.targetConfigKeys) {
      if (CONTENT_FIELDS.has(k) && isEmpty(k)) {
        add(k, ref, `Feed the upstream data into "${k}"`, `Sets ${k} = ${ref}`);
        break;
      }
    }
  }

  const rationale = actions.length
    ? `Proposed ${actions.length} setting${actions.length > 1 ? 's' : ''} to feed ${ctx.sourceLabel}'s output into ${ctx.targetLabel}.`
    : `No obvious automatic mapping — open ${ctx.targetLabel}'s panel to wire its fields from the upstream.`;

  return { actions, configPatch: patch, rationale, confidence: actions.length ? 0.5 : 0.1 };
}
