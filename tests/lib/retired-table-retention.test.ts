import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgSchema } from 'drizzle-orm/pg-core';
import { pushSchema } from 'drizzle-kit/api';
import config from '../../drizzle.config';

// Real Drizzle diff against disposable synthetic tables. This proves the removal
// cannot turn a normal schema push into deletion of parked user analyses.
it.skipIf(!process.env.DATABASE_URL)('retains retired tables while still managing active tables', async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const name = `retention_${randomUUID().replaceAll('-', '')}`;
  const retired = ['policy_lab_projects', 'policy_lab_versions', 'policy_lab_runs'];
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${name}"`);
    for (const table of retired) {
      await client.query(`CREATE TABLE "${name}"."${table}" (id integer PRIMARY KEY, marker text NOT NULL)`);
      await client.query(`INSERT INTO "${name}"."${table}" VALUES (1, 'SYNTHETIC retention probe')`);
    }
    const schema = pgSchema(name);
    const probe = schema.table('active_retention_probe', { id: integer('id').primaryKey() });
    const plan = await pushSchema({ schema, probe }, drizzle(client), [name], config.tablesFilter as string[]);
    expect(plan.statementsToExecute.some(sql => sql.includes('CREATE TABLE'))).toBe(true);
    expect(plan.statementsToExecute.join('\n')).not.toMatch(/DROP|policy_lab_/i);
    await plan.apply();
    for (const table of retired) expect((await client.query(`SELECT marker FROM "${name}"."${table}"`)).rows).toEqual([{ marker: 'SYNTHETIC retention probe' }]);
    expect((await client.query('SELECT to_regclass($1) AS name', [`${name}.active_retention_probe`])).rows[0].name).toBeTruthy();
  } finally { await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`); await client.end(); }
}, 30000);
