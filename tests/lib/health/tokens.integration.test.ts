import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

const mocks = vi.hoisted(() => ({ db: null as any, refresh: vi.fn() }));
vi.mock('$lib/db', () => ({ db: mocks.db }));
vi.mock('$lib/health/whoop', () => ({ refreshWhoopToken: mocks.refresh }));
vi.mock('$lib/health/strava', () => ({ refreshStravaToken: mocks.refresh }));

// Explicit opt-in: synthetic credentials, private schema, local PostgreSQL only.
const enabled = process.env.HEALTH_TOKEN_LOCAL_TESTS === '1';
describe.skipIf(!enabled)('health token refresh concurrency', () => {
  let admin: Pool;
  let pool: Pool;
  const schema = `token_race_${process.pid}`;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!['news-db', '127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/news_local') {
      throw new Error('Token race tests require the isolated news_local database');
    }
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}`, max: 5 });
    await pool.query(`CREATE TABLE oauth_tokens (
      id serial PRIMARY KEY, service text NOT NULL, refresh_token text NOT NULL,
      access_token text, expires_at integer, created_at integer, updated_at integer
    )`);
    mocks.db = drizzle(pool);
  });
  beforeEach(async () => {
    vi.resetModules();
    mocks.refresh.mockReset();
    await pool.query('TRUNCATE oauth_tokens');
    await pool.query(`INSERT INTO oauth_tokens (service, access_token, refresh_token, expires_at)
      VALUES ('whoop', 'old-access', 'old-refresh', 1)`);
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('coalesces concurrent callers and persists the rotated credentials', async () => {
    mocks.refresh.mockResolvedValue({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 });
    const { getValidToken } = await import('$lib/health/tokens');
    expect(await Promise.all(Array.from({ length: 12 }, () => getValidToken('whoop'))))
      .toEqual(Array(12).fill('new-access'));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    const { rows } = await pool.query('SELECT access_token, refresh_token FROM oauth_tokens');
    expect(rows).toEqual([{ access_token: 'new-access', refresh_token: 'new-refresh' }]);
  });

  it('returns a valid token without exchanging it', async () => {
    await pool.query('UPDATE oauth_tokens SET expires_at = $1', [Math.floor(Date.now() / 1000) + 3600]);
    const { getValidToken } = await import('$lib/health/tokens');
    expect(await getValidToken('whoop')).toBe('old-access');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('leaves an unconnected account unconnected', async () => {
    await pool.query('TRUNCATE oauth_tokens');
    const { getValidToken } = await import('$lib/health/tokens');
    expect(await getValidToken('whoop')).toBeNull();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('preserves Strava absolute expiry semantics in the shared token helper', async () => {
    await pool.query("UPDATE oauth_tokens SET service = 'strava'");
    const expiry = Math.floor(Date.now() / 1000) + 21600;
    mocks.refresh.mockResolvedValue({ access_token: 'strava-new', refresh_token: 'strava-refresh', expires_at: expiry });
    const { getValidToken } = await import('$lib/health/tokens');
    expect(await getValidToken('strava')).toBe('strava-new');
    expect((await pool.query('SELECT expires_at FROM oauth_tokens')).rows[0].expires_at).toBe(expiry);
  });

  it('serializes independent workers and re-reads after waiting for the lock', async () => {
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(r => { started = r; });
    const barrier = new Promise<void>(r => { release = r; });
    mocks.refresh.mockImplementation(async () => {
      started();
      await barrier;
      return { access_token: 'winner-access', refresh_token: 'winner-refresh', expires_in: 3600 };
    });
    const firstWorker = await import('$lib/health/tokens');
    vi.resetModules();
    const secondWorker = await import('$lib/health/tokens');
    const first = firstWorker.getValidToken('whoop');
    await entered;
    const second = secondWorker.getValidToken('whoop');
    // Wait for PostgreSQL to confirm the second worker is blocked on the lock.
    try {
      await vi.waitFor(async () => {
        const { rows } = await pool.query(`SELECT count(*)::int AS waiting FROM pg_locks
          WHERE locktype = 'advisory' AND NOT granted AND pid IN
          (SELECT pid FROM pg_stat_activity WHERE query LIKE '%health-oauth%'
            OR query LIKE '%pg_advisory_xact_lock%')`);
        expect(rows[0].waiting).toBeGreaterThan(0);
      });
    } finally { release(); }
    expect(await Promise.all([first, second])).toEqual(['winner-access', 'winner-access']);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('releases the lock and pending request after a provider failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.refresh.mockRejectedValueOnce(new Error('temporary provider failure'))
        .mockResolvedValueOnce({ access_token: 'recovered', expires_in: 3600 });
      const { getValidToken } = await import('$lib/health/tokens');
      expect(await getValidToken('whoop')).toBeNull();
      expect(await getValidToken('whoop')).toBe('recovered');
      expect(mocks.refresh).toHaveBeenCalledTimes(2);
      expect((await pool.query('SELECT refresh_token FROM oauth_tokens')).rows[0].refresh_token).toBe('old-refresh');
    } finally { log.mockRestore(); }
  });
});
