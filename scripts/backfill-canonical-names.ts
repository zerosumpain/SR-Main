#!/usr/bin/env npx tsx
//
// Backfill `intel_entities.canonical_name`.
//
// The column is derived from the name — file extension, namespace prefix and
// legal suffix removed — and is what makes write-time resolution a single
// indexed lookup. New rows fill it on insert; everything already in the table
// needs this once. Safe to re-run: it recomputes rather than patches, so a
// change to the canonical rules is applied by running it again.
//
// Usage:  DATABASE_URL=<target> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/backfill-canonical-names.ts [--apply]
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalName } from '$lib/jkai/intel/resolve/match';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to guess a target.');
  console.log(`target: ${url.replace(/^[^@]*@/, '').split('?')[0]}`);
  console.log(APPLY ? 'mode:   APPLY (writes)' : 'mode:   dry run (no writes)');

  const res = await db.execute(sql`SELECT id, name, canonical_name FROM intel_entities`);
  const rows = (res.rows as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    current: r.canonical_name === null ? null : String(r.canonical_name),
  }));

  const changed = rows
    .map((r) => ({ ...r, next: canonicalName(r.name) || null }))
    .filter((r) => r.next !== r.current);

  console.log(`\n${rows.length} entities, ${changed.length} to write`);
  for (const r of changed.slice(0, 15)) console.log(`  "${r.name}" -> ${r.next ?? 'null'}`);
  if (changed.length > 15) console.log(`  … and ${changed.length - 15} more`);

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    return;
  }

  let written = 0;
  for (const r of changed) {
    await db.execute(sql`UPDATE intel_entities SET canonical_name = ${r.next} WHERE id = ${r.id}`);
    written++;
  }
  console.log(`\nwrote ${written}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
