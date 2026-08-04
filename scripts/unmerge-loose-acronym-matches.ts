#!/usr/bin/env npx tsx
//
// One-off: reverse the merges the LOOSE acronym rule made.
//
// Until this was tightened, two names matched as an acronym pair whenever the
// short side was 2-12 characters and appeared either as the initials of the
// long side or anywhere in its brackets. Both halves misfired:
//
//   - two letters collide with everything. "CI" had absorbed Compound
//     Interest, client_id, Contact info and Competing Ideologies; "AI" had
//     absorbed Apple ID, Academic institutions and All-Inclusive.
//   - a bracket usually means "a related thing", not "my abbreviation".
//     "7-Day Greek Isles from Athens (Piraeus) to Venice" ate the port of
//     Piraeus; "Independent Church (Morecambe)" ate the town.
//
// Selection is deliberately narrow. A merge is reversed only when ALL of:
//   1. the OLD rule explains it (re-implemented below — it no longer exists in
//      $lib, and reversing merges made on other evidence would be vandalism),
//   2. the tightened rule rejects it,
//   3. no other signal would have justified it — identical names, canonical
//      equality, initial expansion, reordering, subset or high overlap,
//   4. it is not in KEEP, the handful the old rule got right.
//
// Usage:  DATABASE_URL=<target> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/unmerge-loose-acronym-matches.ts [--apply]
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { unmergeEntity } from '$lib/jkai/intel/resolve/merge';
import {
  acronymsOf,
  isAcronymPair,
  isCanonicalMatch,
  isTokenSubset,
  isInitialExpansion,
  isNameReordering,
  tokenOverlap,
  normaliseName,
  significantTokens,
} from '$lib/jkai/intel/resolve/match';

const APPLY = process.argv.includes('--apply');

/**
 * The rule as it stood before the tightening. Kept here, and only here, so the
 * clean-up can identify its output; nothing else should use it.
 */
function matchedByLooseRule(a: string, b: string): boolean {
  const na = normaliseName(a).replace(/\s/g, '');
  const nb = normaliseName(b).replace(/\s/g, '');
  if (!na || !nb || na === nb) return false;
  const shortSide = na.length <= nb.length ? na : nb;
  const longName = na.length <= nb.length ? b : a;
  if (shortSide.length < 2 || shortSide.length > 12) return false;
  if (significantTokens(longName).length < 2) return false;
  return acronymsOf(longName).has(shortSide);
}

/** Would any signal OTHER than the acronym rule have justified this merge? */
function otherwiseJustified(a: string, b: string): string | null {
  if (normaliseName(a) === normaliseName(b)) return 'identical names';
  if (isCanonicalMatch(a, b)) return 'canonical equality';
  if (isInitialExpansion(a, b)) return 'initial expansion';
  if (isNameReordering(a, b)) return 'name reordering';
  if (isTokenSubset(a, b)) return 'token subset';
  if (tokenOverlap(a, b) >= 0.7) return 'high token overlap';
  return null;
}

/**
 * Merges the loose rule made that are nonetheless RIGHT, and must survive.
 * Each is an expansion everybody would recognise, or a person's initials.
 */
const KEEP: Array<[string, string]> = [
  ['artificial intelligence', 'ai'],
  ['uk', 'united kingdom'],
  ['us', 'united states'],
  ['executive committee (exco)', 'exco'],
  ['gb', 'gordon brown'],
];

function isKept(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return KEEP.some(([p, q]) => (x === p && y === q) || (x === q && y === p));
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to guess a target.');
  console.log(`target: ${url.replace(/^[^@]*@/, '').split('?')[0]}`);
  console.log(APPLY ? 'mode:   APPLY (writes)\n' : 'mode:   dry run (no writes)\n');

  const res = await db.execute(sql`
    SELECT l.id AS loser_id, l.name AS loser_name, s.name AS survivor_name
    FROM intel_entities l
    JOIN intel_entities s ON s.id = l.merged_into_id
    ORDER BY s.name, l.name
  `);

  const rows = (res.rows as Array<Record<string, unknown>>).map((r) => ({
    loserId: String(r.loser_id),
    loser: String(r.loser_name ?? ''),
    survivor: String(r.survivor_name ?? ''),
  }));

  const kept: string[] = [];
  const justified: string[] = [];
  const target = rows.filter((r) => {
    if (!matchedByLooseRule(r.loser, r.survivor)) return false;
    if (isAcronymPair(r.loser, r.survivor)) return false; // tightened rule still agrees
    if (isKept(r.loser, r.survivor)) {
      kept.push(`"${r.loser}" -> "${r.survivor}"`);
      return false;
    }
    const why = otherwiseJustified(r.loser, r.survivor);
    if (why) {
      justified.push(`"${r.loser}" -> "${r.survivor}" (${why})`);
      return false;
    }
    return true;
  });

  console.log(`held as correct (${kept.length}):`);
  for (const k of kept) console.log(`    ${k}`);
  if (justified.length) {
    console.log(`\nheld — another signal justifies them (${justified.length}):`);
    for (const j of justified) console.log(`    ${j}`);
  }

  console.log(`\nto reverse: ${target.length}`);
  let last = '';
  for (const r of target) {
    if (r.survivor !== last) {
      console.log(`\n  absorbed into "${r.survivor}"`);
      last = r.survivor;
    }
    console.log(`    ${APPLY ? 'unmerging' : 'would unmerge'}: ${r.loser}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    return;
  }

  let restored = 0;
  let failed = 0;
  for (const r of target) {
    try {
      restored += (await unmergeEntity(r.loserId)).restored;
    } catch (err) {
      failed++;
      console.error(`    FAILED ${r.loser}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nunmerged ${target.length - failed}, ${restored} links restored, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
