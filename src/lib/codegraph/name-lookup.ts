/**
 * Turning the filenames a person actually types into paths the graph knows.
 *
 * The pure half — which names appear, which directories narrow them, and when a
 * name is too ambiguous to use — lives in `build-context.ts` and is tested
 * without a database. This module is only the lookup: given some bare names,
 * what does the node table hold that could match?
 *
 * One query, bounded by the caller's name cap, and it fails to an empty list.
 * A build must never wait on, or die from, its own context retrieval.
 */
import { and, eq, or, like } from 'drizzle-orm';
import { db } from '$lib/db';
import { codegraphNodes } from '$lib/db/schema';
import { pickNamedFiles } from './build-context';

export interface NameLookup {
  /** Canonical paths that each landed on exactly one file. */
  resolved: string[];
  /** Names that matched several files and were deliberately not used. */
  ambiguous: string[];
}

/**
 * Resolve bare filenames against the file nodes in the graph.
 *
 * Matching is on the basename via a `%/<name>` suffix, which is exact rather
 * than fuzzy: `body.ts` must not match `rescue-body.ts`, or a query would be
 * seeded from a file nobody mentioned.
 */
export async function lookupNamedFiles(names: string[], dirHints: string[]): Promise<NameLookup> {
  if (!names.length) return { resolved: [], ambiguous: [] };

  try {
    const rows = await db
      .select({ path: codegraphNodes.canonicalPath })
      .from(codegraphNodes)
      .where(
        and(
          eq(codegraphNodes.kind, 'file'),
          or(...names.map((n) => like(codegraphNodes.canonicalPath, `%/${n}`))),
        ),
      )
      .limit(2000);

    return pickNamedFiles(names, dirHints, rows.map((r) => r.path));
  } catch {
    return { resolved: [], ambiguous: [] };
  }
}
