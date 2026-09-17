import { db } from '$lib/db';
import { integrationCredentials } from '$lib/db/schema';
import { inArray } from 'drizzle-orm';

/**
 * The integration types these tests invent. Anything written under one of these
 * is fixture litter and must not outlive the run that made it.
 *
 * This list exists because it did outlive them. `createCredential()` writes a
 * real row, neither test had any teardown, and on 2026-09-17 production held
 * **143 fixture rows** — 71 `test-e2e`, 71 `test-callback`, 1
 * `test-creds-wrong-kind` — against 2 genuine credentials (apple-calendar and
 * mapbox). They rendered on /admin/connections/credentials as orphaned
 * credentials, because `activity_connections.credential_id` is ON DELETE SET
 * NULL and nothing owned them.
 *
 * Two things made that invisible for six weeks. The rows carry no marker saying
 * they are fixtures beyond their type name, and `pg_stat_user_tables.n_live_tup`
 * — the cheap way to ask how big a table is — reported this table as EMPTY,
 * because it is an estimate maintained by autovacuum and not a count. Ask
 * `count(*)` when the answer matters.
 */
export const FIXTURE_INTEGRATION_TYPES = ['test-e2e', 'test-callback', 'test-creds-wrong-kind'];

/** Delete every credential row these tests could have written. Safe to call twice. */
export async function clearIntegrationFixtures(): Promise<void> {
  await db
    .delete(integrationCredentials)
    .where(inArray(integrationCredentials.integrationType, FIXTURE_INTEGRATION_TYPES));
}
