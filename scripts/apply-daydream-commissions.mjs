#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Migration DATABASE_URL is required');
const client = new Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  const sql = await readFile(new URL('./migrations/2026-09-28-daydream-commissions.sql', import.meta.url), 'utf8');
  await client.query(sql);
  console.log('Daydream commissioning tables, constraints and runtime grants are installed.');
} finally {
  await client.end();
}
