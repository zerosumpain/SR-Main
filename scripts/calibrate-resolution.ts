#!/usr/bin/env npx tsx
// Human-reviewed pre-decision snapshots only. Existing merges are not labels,
// and unmerged records are not negative examples. Reports name-side signal
// likelihoods; it never changes thresholds. Run against an explicitly selected
// database with scripts/tsconfig.scripts.json. Keep exported labels private.
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

  // Human decisions are labels; auto merges and unmerged candidates are not ground truth.
  const labelled = await db.execute(sql`SELECT DISTINCT ON (pair_key) pair_key, verdict, features FROM intel_resolution_labels
    WHERE decided_by='human' AND verdict IN ('same','different') ORDER BY pair_key,created_at DESC`);
  const positives: Array<readonly [ResolvableEntity, ResolvableEntity]> = [];
  const negatives: Array<readonly [ResolvableEntity, ResolvableEntity]> = [];
  for (const record of labelled.rows as Array<Record<string, unknown>>) {
    const features = record.features as { entities?: Array<Record<string, unknown>> };
    if (features.entities?.length !== 2) continue;
    const pair = features.entities.map(r => ({ ...asEntity({id:String(r.id),name:String(r.name),typeId:String(r.type_id),properties:r.properties as Row['properties']}),
      typeName:String(r.type_name ?? ''), aliases:(r.aliases ?? []) as string[], noteCount:Number(r.note_count ?? 0),
      embedding:typeof r.embedding === 'string' ? JSON.parse(r.embedding) as number[] : null,
    })) as [ResolvableEntity, ResolvableEntity];
    (record.verdict === 'same' ? positives : negatives).push(pair);
  }
  if (!positives.length || !negatives.length) {
    console.log('Insufficient reviewed labels: record both human same and different decisions before calibrating. No thresholds changed.');
    return;
  }
  console.log(`positives: ${positives.length} human-confirmed pairs`);
  console.log(`negatives: ${negatives.length} human-rejected pairs\n`);

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

  console.log('Name-side diagnostic from human-reviewed snapshots. Embeddings and neighbours are retained in the label export for full evaluation. No thresholds changed.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
