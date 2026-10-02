#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Migration DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const sql = await readFile(new URL('./migrations/2026-10-02-app-owned-schemas.sql', import.meta.url), 'utf8');
  await client.query(sql);
  console.log('App-owned tables are in the drive, policy, dfe and dsd schemas, with public compatibility views.');
} finally {
  await client.end();
}
