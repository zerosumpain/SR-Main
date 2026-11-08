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
  const out = deepFreeze(fastCopy(resolve(file))) as Params;
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
  return deepFreeze(fastCopy(resolve(file))) as Params;
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

/**
 * The same object rebuilt so V8 keeps it in fast (hidden-class) mode: built a
 * key at a time, the larger sections (fields, develop, county: 30–60 keys)
 * fell into dictionary mode, which made every params read in a hot loop a
 * hash lookup. A JSON round trip rebuilds it with the same keys, order and
 * values; it is used only when it is exact (the files are JSON, but the Lab's
 * variants are built in code).
 */
function fastCopy<T>(x: T): T {
  let y: unknown;
  try {
    y = JSON.parse(JSON.stringify(x));
  } catch {
    return x;
  }
  return sameTree(x, y) ? (y as T) : x;
}

function sameTree(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b);
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  // Only plain objects and arrays survive JSON: a Map, typed array or class instance in a
  // code-built variant would come back as a plain object with the same keys.
  const pa = Object.getPrototypeOf(a);
  if (pa !== Object.prototype && pa !== Array.prototype) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    if (!sameTree((a as Record<string, unknown>)[ka[i]], (b as Record<string, unknown>)[kb[i]])) return false;
  }
  return true;
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
