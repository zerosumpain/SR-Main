#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Migration DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const sql = await readFile(new URL('./migrations/2026-09-28-security-lifecycle.sql', import.meta.url), 'utf8');
  await client.query(sql);
  console.log('Access revocation, privacy barriers and device preferences are installed.');
} finally {
  await client.end();
}
