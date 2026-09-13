import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';

const connection = vi.hoisted(() => ({ execute: null as any }));
vi.mock('$lib/db', () => ({ db: { execute: (sql: unknown) => connection.execute(sql) } }));
import { claimNext, releaseExpiredLeases } from '../../../src/lib/workflows/run-queue';

const url = process.env.POLICY_QUEUE_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite('Main respects external Policy queue ownership', () => {
  let client: pg.Client;
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/jkai_local') {
      throw new Error('Use the isolated loopback jkai_local database only');
    }
    client = new pg.Client({ connectionString: url });
    await client.connect();
    // Session-local shadow: no application tables or data are changed.
    await client.query(`CREATE TEMP TABLE workflow_runs (
      id text PRIMARY KEY, workflow_id text, trigger text, input_data jsonb,
      status text, claimed_by text, claimed_at timestamptz, lease_expires_at timestamptz,
      started_at timestamptz, heartbeat_at timestamptz
    )`);
    const dialect = new PgDialect();
    connection.execute = (sql: any) => {
      const query = dialect.sqlToQuery(sql);
      return client.query(query.sql, query.params);
    };
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query('TRUNCATE pg_temp.workflow_runs');
    await client.query(`INSERT INTO pg_temp.workflow_runs (id, trigger, status, started_at)
      VALUES ('policy', 'policy-analysis', 'pending', now() - interval '1 hour'),
      ('manual', 'manual', 'pending', now()), ('legacy', NULL, 'pending', now())`);
  });
  it('claims ordinary and legacy jobs while leaving the oldest policy job untouched', async () => {
    const ids = [(await claimNext('main'))?.id, (await claimNext('main'))?.id].sort();
    expect(ids).toEqual(['legacy', 'manual']);
    expect(await claimNext('main')).toBeNull();
    expect((await client.query("SELECT status, claimed_by FROM pg_temp.workflow_runs WHERE id='policy'")).rows)
      .toEqual([{ status: 'pending', claimed_by: null }]);
  });
  it('cannot override ownership with an explicit policy trigger or run id', async () => {
    expect(await claimNext('main', 60000, 'policy-analysis', 'policy')).toBeNull();
  });
  it('leaves both pending and running policy leases to the dedicated worker', async () => {
    await client.query(`UPDATE pg_temp.workflow_runs SET claimed_by='expired', lease_expires_at=now()-interval '1 hour'`);
    expect(await releaseExpiredLeases()).toBe(2);
    await client.query("UPDATE pg_temp.workflow_runs SET status='running' WHERE id='policy'");
    expect(await releaseExpiredLeases()).toBe(0);
    expect((await client.query("SELECT status, claimed_by FROM pg_temp.workflow_runs WHERE id='policy'")).rows)
      .toEqual([{ status: 'running', claimed_by: 'expired' }]);
  });
});
