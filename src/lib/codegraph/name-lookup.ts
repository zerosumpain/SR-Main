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
import { and, eq, inArray, or, like } from 'drizzle-orm';
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

/**
 * Which of these paths does the graph actually hold a live node for?
 *
 * The file lane seeds from `pathsInText(prompt)`, which is a REGEX over the task
 * text and checks nothing. So a task that names a file it is about to CREATE —
 * the ordinary shape of "add scripts/foo.mjs" — planned a file query for a path
 * with no node behind it. `resolveSeed` then returned an empty seed, and
 * `pickLessons` answered an empty seed with the N most recently observed lessons
 * in the whole corpus, unrelated to anything.
 *
 * Measured on build 4cda9a8d, seeded `file:scripts/codegraph-stats.mjs`: the
 * four lessons served were about the Landgrab territory game, the jkai model
 * picker, the nightly conflation detector and pgvector neighbour ranking. None
 * of them had anything to do with the task, and the serve was still recorded as
 * `served` — 3,686 characters of a build's context budget spent on noise, and
 * indistinguishable in the ledger from a real hit.
 *
 * Filtering here rather than inside `planBuildQuery` keeps that function pure
 * and database-free, exactly as `lookupNamedFiles` already does for bare names.
 * Fails OPEN — on a query error it returns the paths unchanged, because losing
 * retrieval is better than losing the build.
 */
export async function filterKnownPaths(paths: string[], repo = 'SR-Main'): Promise<string[]> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return [];
  try {
    const rows = await db
      .select({ path: codegraphNodes.canonicalPath })
      .from(codegraphNodes)
      .where(
        and(
          eq(codegraphNodes.repo, repo),
          eq(codegraphNodes.existsOnHead, true),
          inArray(codegraphNodes.canonicalPath, unique.slice(0, 200)),
        ),
      );
    const known = new Set(rows.map((r) => r.path));
    return unique.filter((p) => known.has(p));
  } catch {
    return unique;
  }
}
