import type { NodeDefinition } from './types';

/**
 * Test runs: what a side-effecting node is replaced by. Client-safe — the
 * canvas lists which nodes a test run will stub before it starts one.
 *
 * The decision is the ENGINE's, from `NodeDefinition.sideEffects`, not each
 * node's: builder-canvas, file-build and apple-calendar never honoured the
 * old per-node `dryRun` flag, so a "dry" run really built, wrote and booked.
 */

/** A node's saved test output: used in place of running it in a test run. */
export interface PinnedOutput {
  output: Record<string, unknown>;
  /** The branch it took (conditional, switch, approval), replayed with the output. */
  handle?: string | null;
}

/** Does running this node, with this config, change something outside the run? */
export function hasSideEffects(def: Pick<NodeDefinition, 'sideEffects'> | undefined, config: Record<string, unknown>): boolean {
  const s = def?.sideEffects;
  if (typeof s === 'function') {
    try {
      return s(config ?? {});
    } catch {
      return true; // cannot tell → treat as a write
    }
  }
  return s === true;
}

/** Operation-keyed nodes: a write when `config[key]` is one of `ops` (default when unset). */
export function opIn(key: string, ops: readonly string[], fallback: string) {
  return (config: Record<string, unknown>) => ops.includes(String(config[key] ?? fallback));
}

const clip = (v: unknown): unknown =>
  typeof v === 'string' && v.length > 400 ? `${v.slice(0, 399)}…` : v;

/**
 * The output a stubbed node hands downstream. `wouldHave` is the node's own
 * one-line summary of its RESOLVED config — what it would have sent, written or
 * called — and `config` the resolved values themselves (engine keys dropped,
 * long strings clipped).
 */
export function stubOutput(def: NodeDefinition | undefined, type: string, config: Record<string, unknown>): Record<string, unknown> {
  let line = '';
  try {
    line = def?.summarize?.(config).line ?? '';
  } catch {
    /* a summary is a nicety */
  }
  const shown = Object.fromEntries(
    Object.entries(config).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, clip(v)]),
  );
  return { _stubbed: true, wouldHave: line || `run ${def?.label ?? type}`, config: shown };
}
