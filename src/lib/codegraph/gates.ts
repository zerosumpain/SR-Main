/**
 * Gates as first-class nodes.
 *
 * The graph was designed with two node kinds that matter — files and gates —
 * and only files were ever created. `resolveSeed` in `retrieve.ts` answers a
 * `gate:` seed with `eq(kind, 'gate')`, and production held **zero** such rows,
 * so `gate:vitest | hops 1` returned an empty seed every time it was asked. One
 * agent-written CGQL query used that lane; it got nothing back and no error.
 *
 * The entities were never missing, only unmodelled: `codegraph_episodes.gate`
 * already carried them as loose text, in five values across 108 episodes —
 * `vitest` 95, `typecheck` 5, `cmd` 4, `svelte-check` 3, and a literal `gate` 1.
 * That last pair is the reason this file exists rather than a `SELECT DISTINCT`:
 * an unnormalised vocabulary makes `gate:typecheck` and `gate:tsc` different
 * nodes, and the whole value of a gate node is that every episode which ever
 * tripped over the same wall hangs off exactly one of them.
 *
 * A PURE FUNCTION OF THE NAME, for the same reason `familyOf` is a pure function
 * of the path: the same rules have to run in the ingest route, in the backfill
 * scanner (plain node, no TS build step) and in a test, without three
 * implementations drifting apart.
 *
 * NO `gated_by` EDGES, deliberately. The obvious move is to join every file an
 * episode touched to that episode's gate node, and it is wrong: `vitest` alone
 * would take an edge to every file in 95 episodes and become the largest hub in
 * the graph by an order of magnitude — the exact problem `walk()`'s degree cap
 * exists to contain. Gate nodes reach their episodes through
 * `codegraph_node_episodes`, the join that already exists, which is also why
 * this needs no change to `retrieve.ts` at all.
 */

/**
 * The canonical gate names. Anything we cannot place becomes `cmd`, matching
 * `gateOf()` in `fingerprint.ts` — the two vocabularies must agree, because a
 * fingerprint is prefixed with the gate and a node is named after it.
 */
export const GATE_NAMES = [
  'vitest',
  'typecheck',
  'svelte-check',
  'build',
  'lint',
  'gate',
  'cmd',
] as const;
export type GateName = (typeof GATE_NAMES)[number];

const ALIASES: Array<{ name: GateName; test: RegExp }> = [
  { name: 'svelte-check', test: /^(svelte-?check|sveltecheck)$/ },
  { name: 'vitest', test: /^(vitest|jest|test|tests|npm-test|unit)$/ },
  { name: 'typecheck', test: /^(typecheck|tsc|types|type-check|tsc-check)$/ },
  { name: 'build', test: /^(build|vite-build|npm-build|compile)$/ },
  { name: 'lint', test: /^(lint|eslint|prettier|ruff|format)$/ },
  // `gate` is the whole-chain runner. It stays distinct from `cmd`: "the gate
  // chain failed" and "some ad-hoc command failed" are different facts, and the
  // fingerprint vocabulary already separates them.
  { name: 'gate', test: /^(gate|gate-all|npm-run-gate)$/ },
];

/**
 * Normalise a raw gate string to one of `GATE_NAMES`.
 *
 * Returns `cmd` rather than null for anything unrecognised, because a gate node
 * has to exist for every episode — an episode with no gate node is one the
 * `gate:` lane can never reach, which is the bug this file is fixing.
 */
export function normaliseGate(raw: string | null | undefined): GateName {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^gate:/, '')
    .replace(/[\s_]+/g, '-');
  if (!s) return 'cmd';
  for (const a of ALIASES) if (a.test.test(s)) return a.name;
  return (GATE_NAMES as readonly string[]).includes(s) ? (s as GateName) : 'cmd';
}

/**
 * The `canonical_path` a gate node is stored under.
 *
 * Namespaced with a `gate:` prefix and NOT slash-separated, so it can never
 * collide with a repo-relative file path — `canonical_path` is unique per repo
 * across every node kind, and a repo that one day contains a file called
 * `vitest` must not merge with the vitest gate.
 */
export function gateNodePath(raw: string | null | undefined): string {
  return `gate:${normaliseGate(raw)}`;
}

/** Is this canonical path a gate node? The inverse of `gateNodePath`. */
export function isGatePath(path: string | null | undefined): boolean {
  return typeof path === 'string' && path.startsWith('gate:');
}

/**
 * The gate name a CGQL `gate:` seed is asking for, as a node path.
 *
 * The seed is written by a human or an agent (`gate:vitest`, `gate:tsc`,
 * `gate:svelte_check`), so it goes through the same normaliser as ingest —
 * otherwise the lane resolves for the spellings we happened to store and
 * silently misses the rest, which is a quieter version of the bug it replaces.
 */
export function gateSeedToPath(seed: string): string {
  return gateNodePath(seed);
}
