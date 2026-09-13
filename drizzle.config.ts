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
    // Parked module data, retained in place outside this application's schema.
    '!policy_lab_projects',
    '!policy_lab_versions',
    '!policy_lab_runs',
    // A backup taken during the landgrab capture-weight migration (2026-09-11).
    // Keeping the rows is deliberate; declaring them is not wanted. Drop the
    // table when the migration is trusted, and delete this line with it.
    '!geo_capture_events_weight_backup_20260911',
  ],
  dbCredentials: { url },
});
