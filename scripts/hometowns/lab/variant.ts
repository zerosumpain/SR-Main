// Params variants for sweeps and A/B runs (spec §11.3, §11.5). A county
// always runs the params of its pinned version, and the engine resolves a
// version once per process (params.ts paramsFor), so a variant is applied to
// the version's raw file in a fresh worker before anything resolves it. The
// worker then runs every job of that variant. A variant never leaks into
// another run: each variant gets its own worker (pool.ts).

import { isLeaf, leafPaths, paramsFile, paramsFor } from '../../../src/lib/games/hometowns/engine/params';

/** One override: a new value, or a multiplier on every number inside the leaf's value. */
export type Override = { mul: number } | { set: unknown };

export interface Variant {
  label: string;
  overrides: Record<string, Override>;
}

function leafAt(file: unknown, path: string): { value: unknown; min: unknown; max: unknown } {
  let node: unknown = file;
  for (const k of path.split('.')) {
    if (!node || typeof node !== 'object') throw new Error(`params path ${path} not found`);
    node = (node as Record<string, unknown>)[k];
  }
  if (!isLeaf(node)) throw new Error(`params path ${path} is not a tunable leaf`);
  return node as { value: unknown; min: unknown; max: unknown };
}

/** Multiplies every number inside a value (numbers, arrays, {friendly, spirited} objects). */
export function scaleValue(v: unknown, mul: number): unknown {
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) >= 10 ? Math.round(v * mul) : v * mul;
  if (Array.isArray(v)) return v.map((x) => scaleValue(x, mul));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) out[k] = scaleValue((v as Record<string, unknown>)[k], mul);
    return out;
  }
  return v;
}

/** The value an override gives a leaf. */
export function overriddenValue(path: string, o: Override): unknown {
  const leaf = leafAt(paramsFile('v1'), path);
  return 'mul' in o ? scaleValue(leaf.value, o.mul) : o.set;
}

let applied: string | null = null;

/**
 * Applies a variant to the v1 file. Must run before the first paramsFor('v1')
 * in this process (a worker's first act); throws if params were already
 * resolved, since the change would then silently not take effect.
 */
export function applyVariant(v: Variant | null): void {
  if (!v || Object.keys(v.overrides).length === 0) return;
  if (applied !== null) throw new Error(`a variant (${applied}) is already applied in this process`);
  const file = paramsFile('v1');
  const want: [string, unknown][] = [];
  for (const [path, o] of Object.entries(v.overrides)) {
    const value = overriddenValue(path, o);
    leafAt(file, path).value = value;
    want.push([path, value]);
  }
  const p = paramsFor('v1') as unknown as Record<string, unknown>;
  for (const [path, value] of want) {
    let node: unknown = p;
    for (const k of path.split('.')) node = (node as Record<string, unknown>)[k];
    if (JSON.stringify(node) !== JSON.stringify(value)) throw new Error(`variant ${v.label}: params were resolved before the variant was applied (${path})`);
  }
  applied = v.label;
}

/** Leaves a sweep can move: numeric (or arrays/objects of numbers) with a real min–max range. */
export function sweepablePaths(): string[] {
  const file = paramsFile('v1');
  return leafPaths(file).filter((path) => {
    const leaf = leafAt(file, path);
    if (JSON.stringify(leaf.min) === JSON.stringify(leaf.max)) return false;
    const numeric = (x: unknown): boolean => typeof x === 'number' || (Array.isArray(x) && x.every(numeric)) || (!!x && typeof x === 'object' && Object.values(x as object).every(numeric));
    return numeric(leaf.value) && JSON.stringify(leaf.value) !== JSON.stringify(scaleValue(leaf.value, 1.2));
  });
}

/** Parses an A/B file: {"label": "…", "overrides": {"develop.pGrow": {"mul": 1.1}, "migration.T": {"set": {…}}}} or a bare overrides map. */
export function parseVariant(json: unknown, fallbackLabel: string): Variant {
  const o = json as Record<string, unknown>;
  if (o && typeof o === 'object' && 'overrides' in o) return { label: String(o.label ?? fallbackLabel), overrides: o.overrides as Record<string, Override> };
  const overrides: Record<string, Override> = {};
  for (const [k, v] of Object.entries(o ?? {})) overrides[k] = v && typeof v === 'object' && ('mul' in (v as object) || 'set' in (v as object)) ? (v as Override) : { set: v };
  return { label: fallbackLabel, overrides };
}
