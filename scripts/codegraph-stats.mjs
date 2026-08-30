#!/usr/bin/env node
/**
 * codegraph-stats.mjs — print the codegraph corpus size.
 *
 * Run on the VPS (or anywhere with the app database available):
 *   node scripts/codegraph-stats.mjs  # DATABASE_URL from env or ../.env
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const line = env.split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
  } catch {
    /* fall through */
  }
  throw new Error('DATABASE_URL not set and no ../.env found');
}

async function main() {
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();
  try {
    const {
      rows: [counts],
    } = await client.query(`
      SELECT
        (SELECT count(*) FROM codegraph_nodes) AS nodes,
        (SELECT count(*) FROM codegraph_edges) AS edges,
        (SELECT count(*) FROM codegraph_episodes) AS episodes,
        (SELECT count(*) FROM codegraph_lessons) AS lessons
    `);
    console.log(`Codegraph corpus: ${counts.nodes} nodes · ${counts.edges} edges · ${counts.episodes} episodes · ${counts.lessons} lessons`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('codegraph-stats failed:', e.message);
  process.exit(1);
});
