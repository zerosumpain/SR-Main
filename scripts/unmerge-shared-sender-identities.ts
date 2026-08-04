#!/usr/bin/env npx tsx
//
// One-off: reverse the merges caused by trusting a notification address as
// proof of identity.
//
// `same_email` is the matcher's strongest signal (0.98, above the auto-merge
// bar on its own) on the reasoning that two records sharing an address ARE the
// same person. True of a personal mailbox; false of a sending service.
// `invitations@linkedin.com` appears in the From line of every invitation
// LinkedIn has ever sent, so production ended up with forty-one unrelated
// people folded into one entity.
//
// The rule is fixed in $lib/jkai/intel/resolve/match (findSharedSenderAddresses).
// This undoes the damage that rule already did, using the SANCTIONED primitive
// `unmergeEntity`, which replays each merge's ledger entry and hands back
// exactly the relationships, note links and timeline events that merge took.
// Raw SQL would clear the tombstone and leave the entity stripped of every
// connection.
//
// Scope is deliberately narrow: a merge is reversed ONLY when the survivor and
// the merged entity carry the SAME address AND that address is a shared sender
// by the same test the live matcher now applies. Merges made on any other
// evidence — acronyms, identical names, the owner's own aliases — are left
// alone, including the ten under johnkelly.main@gmail.com, whose display names
// collapse to a single identity and are therefore correct.
//
// This one runs against PRODUCTION (that is where the damage is), so it prints
// the database it is pointed at and changes nothing without --apply.
//
// Usage:  DATABASE_URL=<production> npx tsx --tsconfig scripts/tsconfig.scripts.json \
//           scripts/unmerge-shared-sender-identities.ts [--apply]
import { sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { loadAddressNames, unmergeEntity } from '$lib/jkai/intel/resolve/merge';
import { findSharedSenderAddresses, countNameGroups } from '$lib/jkai/intel/resolve/match';

const APPLY = process.argv.includes('--apply');

interface MergeRow {
  loserId: string;
  loserName: string;
  survivorId: string;
  survivorName: string;
  email: string;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refusing to guess a target.');
  // Host and database only; never the credentials.
  const target = url.replace(/^[^@]*@/, '').split('?')[0];
  console.log(`target: ${target}`);
  console.log(APPLY ? 'mode:   APPLY (writes)\n' : 'mode:   dry run (no writes)\n');

  const namesByAddress = await loadAddressNames();
  const shared = findSharedSenderAddresses(namesByAddress);

  console.log(`addresses classed as shared senders: ${shared.size}`);
  for (const address of shared) {
    const names = namesByAddress.get(address) ?? [];
    console.log(`  ${address} — ${new Set(names).size} names, ${countNameGroups(names)} identities`);
  }

  const res = await db.execute(sql`
    SELECT l.id   AS loser_id,
           l.name AS loser_name,
           s.id   AS survivor_id,
           s.name AS survivor_name,
           lower(s.properties->>'email') AS email
    FROM intel_entities l
    JOIN intel_entities s ON s.id = l.merged_into_id
    WHERE lower(l.properties->>'email') = lower(s.properties->>'email')
      AND l.properties->>'email' IS NOT NULL
    ORDER BY email, l.name
  `);

  const affected: MergeRow[] = (res.rows as Array<Record<string, unknown>>)
    .map((r) => ({
      loserId: String(r.loser_id),
      loserName: String(r.loser_name ?? ''),
      survivorId: String(r.survivor_id),
      survivorName: String(r.survivor_name ?? ''),
      email: String(r.email ?? ''),
    }))
    .filter((r) => shared.has(r.email));

  console.log(`\nmerges to reverse: ${affected.length}`);
  let lastEmail = '';
  for (const row of affected) {
    if (row.email !== lastEmail) {
      console.log(`\n  ${row.email} → surviving as "${row.survivorName}"`);
      lastEmail = row.email;
    }
    console.log(`    ${APPLY ? 'unmerging' : 'would unmerge'}: ${row.loserName}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing was written. Re-run with --apply.');
    return;
  }

  let restored = 0;
  let failed = 0;
  for (const row of affected) {
    try {
      const result = await unmergeEntity(row.loserId);
      restored += result.restored;
    } catch (err) {
      failed++;
      console.error(`    FAILED ${row.loserName}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\nunmerged ${affected.length - failed} entities, ${restored} links restored, ${failed} failed.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
