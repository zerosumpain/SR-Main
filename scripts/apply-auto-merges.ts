#!/usr/bin/env npx tsx
//
// Apply the duplicate merges the resolver is already confident about.
//
// `autoMergeDuplicates` exists and does exactly this, but takes no exclusions,
// and a review of the first batch turned up one pair worth keeping apart
// ("Monthly Subscription" the concept vs "canvas:monthly-subscription" the
// workflow — a generic name colliding with a slug). So this mirrors its loop
// with a --skip filter and prints every decision.
//
// Merges are reversible: each one writes an `intel_entity_merges` ledger row
// that `unmergeEntity` replays.
//
// Usage:  DATABASE_URL=<target> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/apply-auto-merges.ts [--apply] [--skip "substring"]...
import { findDuplicates, mergeEntities } from '$lib/jkai/intel/resolve/merge';
import { AUTO_MERGE_THRESHOLD } from '$lib/jkai/intel/resolve/match';

const APPLY = process.argv.includes('--apply');
const SKIPS = process.argv.reduce<string[]>((acc, arg, i) => {
  if (arg === '--skip' && process.argv[i + 1]) acc.push(process.argv[i + 1].toLowerCase());
  return acc;
}, []);

function skipped(a: string, b: string): string | null {
  const pair = `${a} ${b}`.toLowerCase();
  return SKIPS.find((s) => pair.includes(s)) ?? null;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to guess a target.');
  console.log(`target: ${url.replace(/^[^@]*@/, '').split('?')[0]}`);
  console.log(APPLY ? 'mode:   APPLY (writes)' : 'mode:   dry run (no writes)');
  if (SKIPS.length) console.log(`skips:  ${SKIPS.join(' | ')}`);

  const reports = (await findDuplicates(AUTO_MERGE_THRESHOLD)).filter(
    (r) => r.candidate.confidence >= AUTO_MERGE_THRESHOLD,
  );
  console.log(`\ncandidates at or above ${AUTO_MERGE_THRESHOLD}: ${reports.length}\n`);

  // An entity that has already been merged away this run cannot take part in
  // another pair; the next run picks up whatever that leaves (mergeEntities
  // flattens chains, so nothing is stranded).
  const gone = new Set<string>();
  let merged = 0;
  let held = 0;

  for (const r of reports) {
    const reason = skipped(r.keep.name, r.merge.name);
    if (reason) {
      console.log(`  SKIP     "${r.merge.name}" -> "${r.keep.name}"  (matched --skip "${reason}")`);
      held++;
      continue;
    }
    if (gone.has(r.keep.id) || gone.has(r.merge.id)) {
      console.log(`  DEFER    "${r.merge.name}" -> "${r.keep.name}"  (endpoint merged earlier this run)`);
      continue;
    }
    if (!APPLY) {
      console.log(`  would    "${r.merge.name}" -> "${r.keep.name}"  ${r.candidate.confidence.toFixed(2)} ${r.candidate.signals.join('+')}`);
      gone.add(r.merge.id);
      merged++;
      continue;
    }
    try {
      const out = await mergeEntities(r.keep.id, r.merge.id);
      gone.add(r.merge.id);
      merged++;
      console.log(
        `  merged   "${r.merge.name}" -> "${r.keep.name}"  ` +
          `(${out.relationshipsMoved} edges moved, ${out.relationshipsDropped} dropped, ${out.notesMoved} notes)`,
      );
    } catch (err) {
      console.error(`  FAILED   "${r.merge.name}" -> "${r.keep.name}": ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n${APPLY ? 'merged' : 'would merge'} ${merged}, held back ${held}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
