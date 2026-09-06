#!/usr/bin/env npx tsx
//
// Score the held mail queue against the graph, and show what a topical rule
// would do with the result.
//
// The scorer runs nightly inside the intel engine, but the numbers it produces
// are the whole basis for choosing a threshold — and a threshold chosen without
// them is the guess this feature exists to replace. So this prints the
// distribution before it prints the rules' backtests, and defaults to a DRY RUN
// so the distribution can be read before anything is written.
//
// Usage:  DATABASE_URL=<target> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/score-mail-relevance.ts [--write] [--limit N]
//
// Against production, read $lib/jkai/intel/mail-gate's note on JKAI_SERVICE_ROLE
// first: importing a server chunk boots the platform services, including a
// second Baileys client that can log the VPS WhatsApp session out.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import {
  loadAnchoredEntities,
  buildSurfaceIndex,
  matchEntities,
  relevanceTextOf,
  scoreMailRelevance,
} from '$lib/jkai/intel/mail-relevance';
import { backtestRule } from '$lib/jkai/intel/mail-rules/backtest';
import { SEED_RULE, RELEVANCE_SEED_RULE } from '$lib/jkai/intel/mail-rules/store';
import { ownerDecisions } from '$lib/jkai/intel/mail-decisions';
import type { CorpusNote } from '$lib/jkai/intel/mail-rules/backtest';

const WRITE = process.argv.includes('--write');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 5000;

function pct(n: number, total: number): string {
  return total ? `${((n / total) * 100).toFixed(1)}%` : '—';
}

async function main() {
  const [counts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'pending')::int`,
      admitted: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'admitted')::int`,
      rejected: sql<number>`count(*) filter (where ${intelNotes.graphState} = 'rejected')::int`,
    })
    .from(intelNotes)
    .where(eq(intelNotes.source, 'email'));
  console.log(
    `mail: ${counts?.pending ?? 0} pending, ${counts?.admitted ?? 0} admitted, ${counts?.rejected ?? 0} rejected\n`,
  );

  const anchored = await loadAnchoredEntities();
  const byWeight = { 3: 0, 2: 0, 1: 0 } as Record<number, number>;
  for (const e of anchored) byWeight[e.weight]++;
  console.log(
    `anchored entities: ${anchored.length}  ` +
      `(foreground ${byWeight[3]}, corroborated ${byWeight[2]}, known ${byWeight[1]})`,
  );
  console.log(`surfaces indexed:  ${buildSurfaceIndex(anchored).size}\n`);
  if (!anchored.length) {
    console.log('Nothing to score against — every thread would report 0.');
    return;
  }

  if (WRITE) {
    const result = await scoreMailRelevance({ states: ['pending', 'admitted'], limit: LIMIT });
    console.log('scored:', JSON.stringify(result, null, 2), '\n');
  } else {
    // Dry run: exactly the lexical half of the scorer, written nowhere. The
    // vector half is skipped because it is the expensive part and the counts
    // that decide a threshold come from the hits.
    const index = buildSurfaceIndex(anchored);
    const notes = await db
      .select({ id: intelNotes.id, title: intelNotes.title, rawContent: intelNotes.rawContent })
      .from(intelNotes)
      .where(and(eq(intelNotes.source, 'email'), inArray(intelNotes.graphState, ['pending'])))
      .limit(LIMIT);

    const buckets = new Map<string, number>();
    let anyHit = 0;
    let twoPlus = 0;
    let watchedHit = 0;
    const examples: string[] = [];
    for (const note of notes) {
      const m = matchEntities(relevanceTextOf(note.title, note.rawContent), index);
      const bucket = m.hits === 0 ? '0' : m.hits === 1 ? '1' : m.hits <= 3 ? '2-3' : m.hits <= 7 ? '4-7' : '8+';
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      if (m.hits > 0) anyHit++;
      if (m.hits >= 2) twoPlus++;
      if (m.topWeight >= 3 && m.hits >= 2) {
        watchedHit++;
        if (examples.length < 8) examples.push(`  ${note.title} — names ${m.names.join(', ')}`);
      }
    }

    console.log(`DRY RUN over ${notes.length} pending threads (pass --write to store):`);
    for (const b of ['0', '1', '2-3', '4-7', '8+']) {
      console.log(`  ${b.padEnd(4)} hits: ${String(buckets.get(b) ?? 0).padStart(5)}  ${pct(buckets.get(b) ?? 0, notes.length)}`);
    }
    console.log(`\n  at least one hit: ${anyHit} (${pct(anyHit, notes.length)})`);
    console.log(`  two or more:      ${twoPlus} (${pct(twoPlus, notes.length)})`);
    console.log(`  the seed rule's shape (>=2 hits, one watched): ${watchedHit} (${pct(watchedHit, notes.length)})`);
    if (examples.length) console.log(`\n  what it would admit:\n${examples.join('\n')}`);
    console.log('');
  }

  // Backtests read the STORED score, so a dry run reports the rule against
  // whatever was scored last — which is honest, and the reason --write exists.
  const corpus = (await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      rawContent: intelNotes.rawContent,
      metadata: intelNotes.metadata,
      observedAt: intelNotes.observedAt,
      createdAt: intelNotes.createdAt,
      graphState: intelNotes.graphState,
    })
    .from(intelNotes)
    .where(eq(intelNotes.source, 'email'))
    .limit(10_000)) as CorpusNote[];
  const decisions = await ownerDecisions();
  const now = Date.now();

  console.log(`backtests over ${corpus.length} threads and ${decisions.length} owner decisions:`);
  for (const rule of [SEED_RULE, RELEVANCE_SEED_RULE]) {
    const b = backtestRule(rule, corpus, decisions, { now });
    console.log(
      `\n  ${rule.key}\n` +
        `    matched ${b.matched}/${b.scanned} (${pct(b.matched, b.scanned)})  per week ${b.perWeek}\n` +
        `    agreed ${b.agreed}  disagreed ${b.disagreed}  falseAdmits ${b.falseAdmits}\n` +
        (b.samples.length ? `    e.g. ${b.samples.slice(0, 3).join(' | ')}` : '    no matches'),
    );
  }
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
