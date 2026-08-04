#!/usr/bin/env npx tsx
//
// Price the matcher's signals against the merges that actually happened.
//
// Every confidence in resolve/match.ts is a hand-picked constant: 0.97 for an
// identical name, 0.93 for canonical equality, 0.55 for a token subset. They
// were reasonable guesses and nothing has ever checked them. The graph now
// holds a few hundred merges a human accepted or rejected, which is enough to
// ask the Fellegi–Sunter question of each signal:
//
//   m = how often it fires on pairs that ARE the same entity
//   u = how often it fires on pairs picked at random
//
// The likelihood ratio m/u is what a signal is worth as evidence. A signal
// that fires on 90% of true matches and 30% of random pairs is nearly
// worthless; one that fires on 40% of true matches and 0.01% of random pairs
// is close to proof.
//
// It REPORTS. It does not retune anything. The labelled set is small and its
// negatives are sampled, so fitting constants to four significant figures off
// 250 rows would be false precision — the numbers are here to be argued with.
//
// Splink would do this properly at scale, in Python. That is the right tool if
// this graph ever reaches a size where EM over comparison vectors beats
// counting; today the arithmetic is the arithmetic and the nightly path is
// Node on a VPS with no Python step.
//
// Usage:  DATABASE_URL=<target> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/calibrate-resolution.ts [--negatives 20000]
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { loadAddressNames } from '$lib/jkai/intel/resolve/merge';
import {
  countIdentitiesByAddress,
  emailOf,
  emailTrust,
  isCanonicalMatch,
  isAcronymPair,
  isTokenSubset,
  isInitialExpansion,
  isNameReordering,
  tokenOverlap,
  normaliseName,
  significantTokens,
  type ResolvableEntity,
} from '$lib/jkai/intel/resolve/match';

interface Row {
  id: string;
  name: string;
  typeId: string;
  properties: Record<string, unknown> | null;
}

const argOf = (flag: string, fallback: number): number => {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const asEntity = (r: Row): ResolvableEntity => ({
  id: r.id,
  name: r.name,
  typeId: r.typeId,
  typeName: '',
  degree: 0,
  noteCount: 0,
  embedding: null,
  properties: r.properties,
});

/** Which signals fire on a pair, name-side only. */
function signalsFor(
  a: ResolvableEntity,
  b: ResolvableEntity,
  identities: Map<string, number>,
): string[] {
  const out: string[] = [];
  const ea = emailOf(a, identities);
  const eb = emailOf(b, identities);
  if (ea && eb && ea === eb) out.push(emailTrust(ea, identities) === 'proof' ? 'same_email' : 'same_email_weak');
  if (normaliseName(a.name) === normaliseName(b.name)) out.push('identical_name');
  if (isCanonicalMatch(a.name, b.name)) out.push('canonical_name');
  if (isAcronymPair(a.name, b.name)) out.push('acronym');
  if (isInitialExpansion(a.name, b.name)) out.push('initial_expansion');
  if (isNameReordering(a.name, b.name)) out.push('name_reordering');
  if (isTokenSubset(a.name, b.name)) out.push('token_subset');
  if (tokenOverlap(a.name, b.name) >= 0.7) out.push('high_token_overlap');
  if (a.typeId !== b.typeId) out.push('(type mismatch)');
  return out;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to guess a target.');
  console.log(`target: ${url.replace(/^[^@]*@/, '').split('?')[0]}`);
  const negativeCount = argOf('--negatives', 20000);

  const identities = countIdentitiesByAddress(await loadAddressNames());

  // Positives: pairs a merge asserted are one entity.
  const pos = await db.execute(sql`
    SELECT l.id AS l_id, l.name AS l_name, l.type_id AS l_type, l.properties AS l_props,
           s.id AS s_id, s.name AS s_name, s.type_id AS s_type, s.properties AS s_props
    FROM intel_entities l
    JOIN intel_entities s ON s.id = l.merged_into_id
  `);
  const positives = (pos.rows as Array<Record<string, unknown>>).map((r) => [
    asEntity({ id: String(r.l_id), name: String(r.l_name ?? ''), typeId: String(r.l_type ?? ''), properties: r.l_props as Row['properties'] }),
    asEntity({ id: String(r.s_id), name: String(r.s_name ?? ''), typeId: String(r.s_type ?? ''), properties: r.s_props as Row['properties'] }),
  ] as const);

  // Negatives: random live pairs. Two entities picked at random are
  // overwhelmingly not the same thing, which is exactly the base rate wanted.
  const all = await db.execute(sql`
    SELECT id, name, type_id, properties FROM intel_entities WHERE merged_into_id IS NULL
  `);
  const live = (all.rows as Array<Record<string, unknown>>).map((r) =>
    asEntity({ id: String(r.id), name: String(r.name ?? ''), typeId: String(r.type_id ?? ''), properties: r.properties as Row['properties'] }),
  );

  // Negatives are drawn from BLOCKED pairs — two entities that share at least
  // one significant word — not from pairs picked uniformly at random.
  //
  // The uniform version was measured first and is useless: no name signal fired
  // on any of 20,000 random pairs, so every likelihood ratio pinned at the
  // ceiling and the table said only "all of these beat picking two entities out
  // of a hat", which was never in doubt. The population that matters is the one
  // the matcher is actually asked to judge.
  const blocks = new Map<string, ResolvableEntity[]>();
  for (const e of live) {
    for (const t of significantTokens(e.name)) {
      const list = blocks.get(t);
      if (list) list.push(e);
      else blocks.set(t, [e]);
    }
  }
  const merged = new Set(positives.map(([l, s2]) => (l.id < s2.id ? `${l.id}|${s2.id}` : `${s2.id}|${l.id}`)));
  const negatives: Array<readonly [ResolvableEntity, ResolvableEntity]> = [];
  const seenPair = new Set<string>();
  for (const group of blocks.values()) {
    if (group.length < 2 || group.length > 60) continue;
    for (let i = 0; i < group.length && negatives.length < negativeCount; i++) {
      for (let j = i + 1; j < group.length && negatives.length < negativeCount; j++) {
        const [a, b] = [group[i], group[j]];
        const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        if (seenPair.has(key) || merged.has(key)) continue;
        seenPair.add(key);
        negatives.push([a, b] as const);
      }
    }
  }

  console.log(`positives: ${positives.length} merged pairs`);
  console.log(`negatives: ${negatives.length} blocked-but-unmerged pairs from ${live.length} live entities\n`);

  const tally = (pairs: ReadonlyArray<readonly [ResolvableEntity, ResolvableEntity]>) => {
    const counts = new Map<string, number>();
    for (const [a, b] of pairs) {
      for (const s of signalsFor(a, b, identities)) counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return counts;
  };

  const mCounts = tally(positives);
  const uCounts = tally(negatives);
  const signals = [...new Set([...mCounts.keys(), ...uCounts.keys()])];

  console.log('signal                 fires on merges     on blocked pairs   likelihood ratio');
  console.log('─'.repeat(80));
  const rows = signals
    .map((s) => {
      const m = (mCounts.get(s) ?? 0) / Math.max(1, positives.length);
      // Half a count, so a signal that never fires on a random pair still has a
      // finite ratio instead of an infinite one.
      const u = Math.max((uCounts.get(s) ?? 0), 0.5) / Math.max(1, negatives.length);
      return { s, m, u, lr: m / u, hits: mCounts.get(s) ?? 0 };
    })
    .sort((a, b) => b.lr - a.lr);

  for (const r of rows) {
    console.log(
      `${r.s.padEnd(22)} ${(r.m * 100).toFixed(1).padStart(6)}% (${String(r.hits).padStart(3)})   ` +
        `${(r.u * 100).toFixed(3).padStart(8)}%          ${r.lr >= 1000 ? '>1000' : r.lr.toFixed(0).padStart(5)}`,
    );
  }

  console.log(
    '\nRead this as evidence strength, not as a confidence. A high ratio means the\n' +
      'signal is rare among the pairs the blocker proposes and common among true\n' +
      'ones. Signals that fire on a large share of BLOCKED pairs are the ones filling\n' +
      'the review queue,\n' +
      'and no amount of tuning makes them proof.\n\n' +
      'Not measurable here: shared_neighbours and semantic similarity. A merge moves\n' +
      "the loser's edges onto the survivor, so the structure that would have been\n" +
      'evidence is destroyed by the act of recording the label.',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
