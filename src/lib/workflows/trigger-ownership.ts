import { sql } from 'drizzle-orm';

/**
 * Which queue triggers belong to an independently deployed application.
 *
 * The durable run queue is shared: every application writes into `workflow_runs`
 * and the row's `trigger` says who is meant to execute it. When a domain is
 * extracted, its worker becomes the only legitimate claimant, and Main's generic
 * worker must stop picking those rows up — otherwise two owners race for the same
 * lease and a run is executed twice.
 *
 * Policy Analysis established this by hard-coding `trigger IS DISTINCT FROM
 * 'policy-analysis'` in two queries, a third (spelled differently) in the engine
 * runtime, and a fourth and fifth in the two deploy drains, which are bash. That
 * works for one domain and stops working at two: the next extraction either adds
 * a literal somewhere and misses the others, or edits a production SQL string
 * under time pressure. Listing the triggers in one place makes the next
 * extraction a one-line change and the rollback an environment variable.
 *
 * The bash half reads `scripts/external-queue-triggers.txt` through
 * `scripts/lib/queue-triggers.sh`, which honours the same override. The list and
 * the file are held together by a test.
 */

/**
 * Triggers whose work is executed outside this process. Add an entry when a
 * domain's dedicated worker goes live, not when its repository is created.
 */
export const EXTRACTED_TRIGGERS = ['policy-analysis'] as const;

function parse(env: NodeJS.ProcessEnv): string[] {
  const raw = env.EXTERNAL_QUEUE_TRIGGERS;
  if (raw === undefined) return [...EXTRACTED_TRIGGERS];

  const listed = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  // A typo here silently hands a lane back to Main while the dedicated worker is
  // still running — two owners, no error.
  for (const name of listed) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error(`EXTERNAL_QUEUE_TRIGGERS contains an invalid trigger name: ${name}`);
    }
  }
  return listed;
}

/**
 * Resolved once, at module load, so a malformed override stops the process
 * starting.
 *
 * Re-reading the environment per query looks harmless and is not: the throw then
 * lands inside `claimNext` on every claim and inside `reapStaleRuns`, whose
 * caller logs and swallows it — so the reaper would print a warning every five
 * minutes and never run again, which is not a failure anyone would notice.
 */
const RESOLVED = parse(process.env);

/**
 * The live set, with an override for handover and rollback.
 *
 * `EXTERNAL_QUEUE_TRIGGERS` replaces the list outright rather than adding to it,
 * so setting it to the empty string returns every lane to Main's worker. That is
 * the rollback lever, and it is deliberately the same shape as the one the policy
 * handover used: stop the dedicated worker, confirm it has exited and no lease is
 * active, and only then hand ownership back. Never run both owners at once.
 *
 * Pass `env` only in tests; production reads the value resolved at load.
 */
export function externalTriggers(env?: NodeJS.ProcessEnv): string[] {
  return env ? parse(env) : [...RESOLVED];
}

/** True when this process must leave the trigger's runs alone. */
export function isExternallyOwned(trigger: string | null | undefined, env?: NodeJS.ProcessEnv): boolean {
  if (!trigger) return false;
  return externalTriggers(env).includes(trigger);
}

/**
 * A SQL predicate selecting only the runs this process may touch.
 *
 * `workflow_runs.trigger` is `notNull().default('manual')`, so `trigger <> 'x'`
 * and this are equivalent today. The IS NULL arm is deliberate anyway: it is what
 * keeps the predicate correct if the column ever becomes nullable, and it means
 * the SQL here and the SQL in the bash drains read the same. The engine runtime's
 * copy was `<>` while the queue's was `IS DISTINCT FROM` — two spellings of one
 * rule is how they drift apart.
 */
export function claimableTriggerSql(env?: NodeJS.ProcessEnv) {
  const external = externalTriggers(env);
  if (external.length === 0) return sql`true`;
  // Composed with the tag alone rather than sql.join, so this stays usable under
  // the minimal `sql` stub that run-queue.test.ts mocks drizzle with.
  let list = sql`${external[0]}`;
  for (const name of external.slice(1)) list = sql`${list}, ${name}`;
  return sql`(trigger IS NULL OR trigger NOT IN (${list}))`;
}
