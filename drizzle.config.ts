import { defineConfig } from 'drizzle-kit';

// DATABASE_URL is pre-loaded from .env by the caller (deploy.sh, `npm run`, etc.)
const url =
  process.env.DATABASE_URL ??
  'postgresql://app:test@localhost:5433/strange_rambling';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema.ts',
  // Tables that exist in the database on purpose but are NOT declared in
  // schema.ts. Every one of them must be listed here, and the reason is sharper
  // than tidiness: drizzle pairs an undeclared table it would drop with a new
  // one it would create and reads the two as a RENAME, which needs a TTY it does
  // not have in CI. The release then fails — or, before the guard in
  // ci-release.sh, exited 0 having applied nothing.
  //
  // That is exactly what happened on 2026-09-13: adding drive_intel_outbox while
  // geo_capture_events_weight_backup_20260911 sat undeclared took the deploy down
  // with "Interactive prompts require a TTY terminal".
  //
  // Do not remove an exclusion without an explicit data migration or deletion.
  tablesFilter: [
    // Core owns this SQL-migrated retry ledger. Main must never reconcile it
    // away when adding another table; conversation deletion uses its FK.
    '!chat_request_receipts',
    // Parked module data, retained in place outside this application's schema.
    '!policy_lab_projects',
    '!policy_lab_versions',
    '!policy_lab_runs',
    // A backup taken during the landgrab capture-weight migration (2026-09-11).
    // Keeping the rows is deliberate; declaring them is not wanted. Drop the
    // table when the migration is trusted, and delete this line with it.
    '!geo_capture_events_weight_backup_20260911',
    // Compatibility VIEWS left in public by
    // scripts/migrations/2026-10-02-app-owned-schemas.sql when these tables
    // moved into their applications' own schemas (drive, policy, dfe, dsd).
    // Push drops an undeclared view, so each is excluded until the release that
    // drops the views and Main's pgSchema declarations together.
    '!rag_collections',
    '!rag_messages',
    '!policy_indicator_snapshots',
    '!keystone_intel',
    '!keystone_intel_runs',
    '!standard_registry_entries',
    '!standard_registry_source_runs',
  ],
  // Main manages `public` and nothing else. Explicit rather than drizzle-kit's
  // default because it is load-bearing: schema.ts still declares the app-owned
  // tables above with pgSchema('drive' | 'policy' | 'dfe' | 'dsd'), and this
  // filter is what keeps push from creating, altering or dropping anything in
  // those schemas. Adding one of them here would hand it back to Main.
  schemaFilter: ['public'],
  dbCredentials: { url },
});
