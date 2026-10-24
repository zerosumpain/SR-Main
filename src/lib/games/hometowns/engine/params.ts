// Every tunable constant lives in a versioned params file, never in a module
// global: a county pins its version, the Lab walks the file to enumerate
// tunables, and a new version is adopted only at a season boundary (§11.5,
// A38). Each leaf of the file carries {value, min, max, unit, doc, loop}; the
// engine reads the resolved form, where every leaf is replaced by its value.
//
// The engine keeps every params file it has ever shipped. A behaviour change
// ships as a new file with a `rules` flag that the code path reads, so an
// already-pinned county never changes mid-season.

import v1 from './params.v1.json';

/** One documented tunable. */
export interface ParamLeaf<V = unknown> {
  value: V;
  min: V;
  max: V;
  unit: string;
  doc: string;
  /** The named feedback loop it mainly drives (§5.21), if any. */
  loop: string | null;
}

/** The resolved shape: each `{value, …}` leaf replaced by its value. */
export type Resolved<T> = T extends { value: infer V; doc: string } ? V : T extends object ? { readonly [K in keyof T]: Resolved<T[K]> } : T;

export type ParamsFile = typeof v1;
export type Params = Resolved<ParamsFile>;
export type ParamsVersion = 'v1';

export const PARAMS_VERSIONS: readonly ParamsVersion[] = ['v1'];
const FILES: Record<ParamsVersion, unknown> = { v1 };

export function isLeaf(node: unknown): node is ParamLeaf {
  return !!node && typeof node === 'object' && !Array.isArray(node) && 'value' in node && 'doc' in node;
}

function resolve(node: unknown): unknown {
  if (isLeaf(node)) return node.value;
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node as Record<string, unknown>)) out[k] = resolve((node as Record<string, unknown>)[k]);
    return out;
  }
  return node;
}

const RESOLVED: Partial<Record<ParamsVersion, Params>> = {};

/** The resolved, frozen params of a version (built once; never mutated). */
export function paramsFor(version: ParamsVersion): Params {
  const hit = RESOLVED[version];
  if (hit) return hit;
  const file = FILES[version];
  if (!file) throw new Error(`unknown params version ${String(version)}`);
  const out = deepFreeze(resolve(file)) as Params;
  RESOLVED[version] = out;
  return out;
}

/** The raw file of a version, with its metadata (the Lab reads this). */
export function paramsFile(version: ParamsVersion): ParamsFile {
  const file = FILES[version];
  if (!file) throw new Error(`unknown params version ${String(version)}`);
  return file as ParamsFile;
}

/**
 * Resolves an arbitrary params-shaped object (the Lab's sweeps and A/B runs
 * build modified copies of a file). Not cached.
 */
export function resolveParams(file: unknown): Params {
  return deepFreeze(resolve(file)) as Params;
}

/** Every leaf path in a file, in file order: the Lab's list of tunables. */
export function leafPaths(file: unknown, prefix = ''): string[] {
  const out: string[] = [];
  if (!file || typeof file !== 'object') return out;
  for (const k of Object.keys(file as Record<string, unknown>)) {
    const v = (file as Record<string, unknown>)[k];
    const p = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out.push(p);
    else if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p));
  }
  return out;
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x as object)) deepFreeze((x as Record<string, unknown>)[k]);
    Object.freeze(x);
  }
  return x;
}

/** The variant of a rivalry-dependent parameter: `{friendly, spirited}` → the county's. */
export function byRivalry<V>(p: { readonly friendly: V; readonly spirited: V }, rivalry: 'friendly' | 'spirited'): V {
  return rivalry === 'spirited' ? p.spirited : p.friendly;
}
