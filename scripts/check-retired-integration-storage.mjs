#!/usr/bin/env node
// Schema reconciliation must never discard history before the explicit copy.
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const { rows } = await client.query(`
    SELECT to_regclass('strava_activities') AS activity_table,
           to_regclass('webdav_credentials') AS credential_table
  `);
  if (rows[0].activity_table || rows[0].credential_table) {
    throw new Error(
      'Retired integration storage still exists. Complete the coordinated ' +
      'cutover and scripts/migrations/2026-09-27-retire-integrations.sql ' +
      'before Main schema reconciliation. No tables were changed.',
    );
  }
  console.log('Retired integration storage migration is complete.');
} finally {
  await client.end();
}
