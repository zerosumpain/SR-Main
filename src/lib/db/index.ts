import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 5,
});

export const db = drizzle(pool, { schema });

/**
 * Something that can run a statement: the pool-backed `db`, or the handle
 * `db.transaction()` passes its callback.
 *
 * A writer that closes over the `db` singleton cannot be composed — calling it
 * from inside `db.transaction(async (tx) => …)` runs it on a DIFFERENT
 * connection, so a rollback leaves its rows behind. Writers that take a
 * `DbExecutor` and default it to `db` compose without changing any existing
 * call site.
 */
export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
