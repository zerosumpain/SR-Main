#!/usr/bin/env npx tsx
//
// One-off: remove the API registry from homeserv.
//
// homeserv held a second copy of api_secrets / api_catalog / api_integrations
// that jkai never read (the MCP gateway's upstream is production) but which
// could still rotate production's TrueLayer refresh token whenever anything
// listed secrets. See $lib/apis/registry-enabled for the full reasoning.
//
// This uses the SANCTIONED primitives rather than raw SQL, because
// `deleteSecret` enforces the ordering that stops a half-registered OAuth pair
// existing even momentarily: a `<provider>` ref row must go BEFORE its
// `<provider>-oauth` vault row.
//
// Run AFTER:
//   1. API_REGISTRY_DISABLED=1 is in homeserv's .env and the app has restarted
//      on a build containing the gate — otherwise the seeder puts it all back.
//   2. The OpenRouter credit alert is live and proven on PRODUCTION.
//   3. A backup exists (~/registry-backups/, 0600, gitignored).
//
// Usage:  set -a && . ./.env && set +a
//         npx tsx --tsconfig scripts/tsconfig.scripts.json scripts/purge-homeserv-registry.ts [--apply]
// Without --apply it prints what it WOULD do and touches nothing.

import os from 'node:os';

const APPLY = process.argv.includes('--apply');

// Two independent guards. Running this against production would destroy a live
// registry holding a working TrueLayer refresh token (use_count 93) and the
// paypal-oauth vault row — so neither guard alone is trusted.
function assertHomeserv(): void {
  const host = os.hostname();
  if (host !== 'homeserv') {
    throw new Error(`Refusing to run on host "${host}" — this script is homeserv-only.`);
  }
  const url = process.env.DATABASE_URL ?? '';
  if (!/localhost:5433|127\.0\.0\.1:5433/.test(url)) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not point at homeserv\'s local Postgres (localhost:5433). ' +
        'This is the guard that stops a stray env from pointing this at production.',
    );
  }
}

// Ref rows first, then vault rows — deleteSecret enforces this and throws
// otherwise, but ordering here means the guard never has to fire.
const SECRET_ORDER = ['openrouter', 'paypal', 'truelayer', 'paypal-oauth', 'truelayer-oauth'];

async function main(): Promise<void> {
  assertHomeserv();

  // Enumerate straight from the table. We deliberately do NOT call
  // listSecrets(): it resolves every ref row to compute `available`, and for
  // TrueLayer that performs a LIVE OAuth exchange which rotates the refresh
  // token — the exact hazard this purge exists to end.
  const { db } = await import('$lib/db');
  const { sql } = await import('drizzle-orm');

  const secretRows = await db.execute<{ handle: string }>(
    sql`select handle from api_secrets order by handle`,
  );
  const present = new Set((secretRows.rows ?? []).map((r) => r.handle));

  const { deleteSecret } = await import('$lib/secrets/registry');
  const { queryRecords, deleteRecord } = await import('$lib/datastore');

  const plan: string[] = [];
  for (const handle of SECRET_ORDER) {
    if (present.has(handle)) plan.push(`api_secrets: ${handle}`);
  }
  for (const h of present) {
    if (!SECRET_ORDER.includes(h)) plan.push(`api_secrets: ${h} (unexpected — review before applying)`);
  }

  for (const slug of ['api_catalog', 'api_integrations'] as const) {
    try {
      const { records } = await queryRecords(slug, { limit: 500 }, 'owner');
      for (const r of records) plan.push(`${slug}: ${r.key}`);
    } catch {
      plan.push(`${slug}: (collection absent — nothing to do)`);
    }
  }

  console.log(`\n${APPLY ? 'DELETING' : 'WOULD DELETE'} ${plan.length} item(s) on ${os.hostname()}:`);
  for (const p of plan) console.log(`  - ${p}`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to execute.\n');
    return;
  }

  for (const slug of ['api_catalog', 'api_integrations'] as const) {
    try {
      const { records } = await queryRecords(slug, { limit: 500 }, 'owner');
      for (const r of records) {
        await deleteRecord(slug, { key: r.key as string }, 'owner');
        console.log(`  deleted ${slug}/${r.key}`);
      }
    } catch {
      /* collection already absent */
    }
  }

  for (const handle of SECRET_ORDER) {
    if (!present.has(handle)) continue;
    await deleteSecret(handle);
    console.log(`  deleted secret ${handle}`);
  }

  const left = await db.execute<{ n: number }>(sql`select count(*)::int as n from api_secrets`);
  console.log(`\napi_secrets remaining: ${left.rows?.[0]?.n ?? '?'}\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
