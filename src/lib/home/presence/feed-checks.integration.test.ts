import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('$lib/db', () => ({ db: { execute: h.execute } }));
const { loadFeedChecks } = await import('./feed-checks');

// Temporary tables on one connection exercise the real query without changing
// the cumulative preview's household or activity history.
describe.skipIf(process.env.PEOPLE_LOCAL_TESTS !== '1')('feed checks against local PostgreSQL', () => {
  let pool: Pool;
  let client: PoolClient;
  const stamp = new Date(Date.now() - 60_000);
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.port !== '15445' || url.pathname !== '/workflows_jkai_local') {
      throw new Error('Requires the isolated local household preview database');
    }
    pool = new Pool({ connectionString: url.toString() });
    client = await pool.connect();
    await client.query(`begin;
      create temp table household_member (subject text, source text) on commit drop;
      create temp table heartbeat_actions (id text, name text) on commit drop;
      create temp table heartbeat_pulses (action_id text, ts timestamptz, outcome text, details jsonb) on commit drop;
      insert into household_member values ('app', 'companion'), ('ha', 'life360'), ('other', 'life360'), ('off', 'none');
      insert into heartbeat_actions values ('app-action', 'household-live'), ('ha-action', 'daydream-observe');
    `);
    const database = drizzle(client);
    h.execute.mockImplementation((query) => database.execute(query));
    const pulse = (action: string, at: Date, outcome: string, details: unknown) =>
      client.query('insert into heartbeat_pulses values ($1, $2, $3, $4)', [action, at, outcome, JSON.stringify(details)]);
    await pulse('app-action', stamp, 'ok', { companion: { pages: 1, written: 0, more: false } });
    await pulse('ha-action', stamp, 'ok', { ha: { trailId: 42 } });
    const later = new Date(stamp.getTime() + 30_000);
    await pulse('app-action', later, 'ok', { companion: { pages: 1, more: false, error: 'unreachable' } });
    await pulse('app-action', later, 'ok', { companion: { pages: 1, more: true } });
    await pulse('app-action', later, 'ok', { companion: { pages: 0, more: false } });
    await pulse('app-action', later, 'error', { companion: { pages: 1, more: false } });
    await pulse('ha-action', later, 'ok', { ha: { gap: true }, other: { trailId: 43 } });
  });
  afterAll(async () => {
    if (client) { await client.query('rollback'); client.release(); }
    if (pool) await pool.end();
  });

  it('counts a completed empty check, but not failures, unconfigured checks or a backlog', async () => {
    const checks = await loadFeedChecks(['app']);
    expect(checks).toEqual({ app: { source: 'companion', checkedAt: stamp } });
  });
  it('requires a successful observation of the particular HA subject', async () => {
    const checks = await loadFeedChecks(['ha', 'off']);
    expect(checks).toEqual({ ha: { source: 'life360', checkedAt: stamp } });
  });
  it('does not read or expose any subjects outside the requested scope', async () => {
    h.execute.mockClear();
    expect(await loadFeedChecks([])).toEqual({});
    expect(h.execute).not.toHaveBeenCalled();
    expect(await loadFeedChecks(['missing'])).toEqual({});
  });
});
