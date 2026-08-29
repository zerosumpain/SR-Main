/**
 * The order-independent key for a pair of entity ids.
 *
 * Its own module because both the matcher and the decision store need it and
 * neither should import the other: `merge.ts` already exported a `pairKey` and
 * pulling that in from `decisions.ts` would make a store depend on the module
 * that performs merges, which is the wrong way round and circular.
 */
export function pairKeyOf(x: string, y: string): string {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}
