/**
 * Hear `workflow.completed` from the Workflows process.
 *
 * Runs finish in SR-Workflows, which raises `workflow.completed` on ITS bus
 * and writes the row to the shared `platform_events` table. This process never
 * saw those: its bus is in memory, so `registerDeliveryListener` only ever
 * heard runs this process finished, and it finishes none. A build subscribed
 * to a workflow was therefore never told the workflow had run.
 *
 * This is the missing ear: on an interval, read the `workflow.completed` rows
 * written since the cursor and hand each to `deliverCompletionOnce`, the same
 * entry point the in-process listener uses. It does NOT put the event back on
 * the bus and does not call the dispatcher: the Workflows process already
 * dispatched it, and a second dispatch would start every listening workflow
 * twice.
 *
 * The cursor is `(created_at, id)` and starts a few minutes BEFORE process
 * start (`TAIL_START_LOOKBACK_MS`): a run that finished while this process was
 * restarting is a row nobody was listening for, and starting at the restart
 * itself lost it for good. Nothing older is ever read, so a restart still does
 * not replay history, and a run that WAS delivered just before the restart is
 * not delivered twice: `deliverRunToSubscribers` passes over a build that
 * already holds it. Each pass re-reads a short overlap behind the cursor:
 * `created_at` is stamped when a row is written, not when it becomes visible,
 * so a row can appear behind one already read. `deliverCompletionOnce`
 * remembers what it has fanned out, which is what makes the overlap (and an
 * event this process raised itself, which is also a row here) harmless.
 *
 * One process only: started from hooks.server.ts under the `background`
 * service, beside the listener it completes. No table, no schema change.
 */
import { sql } from 'drizzle-orm';
import { deliverCompletionOnce } from './workflow-deliveries';

const DEFAULT_POLL_MS = 15_000;
/** Rows read per query; a full page is followed at once by the next. */
export const TAIL_PAGE = 50;
/** Pages one pass will read before it yields to the next interval. */
export const TAIL_MAX_PAGES = 10;
/** How far behind the cursor each pass looks again. */
export const TAIL_OVERLAP_MS = 60_000;

/** How far before process start the first pass reads: the length of a restart, with room. */
export const TAIL_START_LOOKBACK_MS = 5 * 60_000;

const ZERO_ID = '00000000-0000-0000-0000-000000000000';

export interface TailCursor {
  /** ISO timestamp, to the microsecond when it came from a row. */
  at: string;
  id: string;
}

export interface CompletionRow {
  id: string;
  /** `created_at` as text with microseconds: a JS Date would round it and re-read the row. */
  at: string;
  workflowId: string | null;
  runId: string | null;
}

export interface TailDeps {
  read: (after: TailCursor, limit: number) => Promise<CompletionRow[]>;
  deliver: (workflowId: string, runId: string) => Promise<unknown>;
}

async function readCompletions(after: TailCursor, limit: number): Promise<CompletionRow[]> {
  const { db } = await import('$lib/db');
  const res = await db.execute(sql`
    select
      id::text as id,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,
      payload->>'workflowId' as "workflowId",
      payload->>'runId' as "runId"
    from platform_events
    where type = 'workflow.completed'
      and (created_at, id) > (${after.at}::timestamptz, ${after.id}::uuid)
    order by created_at, id
    limit ${limit}
  `);
  return (res.rows ?? []) as unknown as CompletionRow[];
}

const defaultDeps: TailDeps = { read: readCompletions, deliver: (workflowId, runId) => deliverCompletionOnce(workflowId, runId) };

/**
 * The tail's state and one pass over it. Separate from the timer so the cursor
 * can be tested without a clock or a database.
 */
export function createCompletionTail(startedAt: Date, deps: TailDeps = defaultDeps, lookbackMs = TAIL_START_LOOKBACK_MS) {
  const floor = startedAt.getTime() - Math.max(0, lookbackMs);
  let cursor: TailCursor = { at: new Date(floor).toISOString(), id: ZERO_ID };

  /** One pass. Returns how many rows it handed on. A failed read moves nothing. */
  async function pass(): Promise<number> {
    // Look again a little behind the cursor, but never behind where the tail began.
    const back = Math.max(floor, Date.parse(cursor.at) - TAIL_OVERLAP_MS);
    let from: TailCursor = { at: new Date(back).toISOString(), id: ZERO_ID };
    let handed = 0;
    for (let page = 0; page < TAIL_MAX_PAGES; page++) {
      const rows = await deps.read(from, TAIL_PAGE);
      for (const row of rows) {
        if (row.workflowId && row.runId) {
          try {
            await deps.deliver(row.workflowId, row.runId);
          } catch (err) {
            // Logged and passed: one run that cannot be delivered must not hold every later one.
            console.error('[workflow-tail] could not hand on run', row.runId, err instanceof Error ? err.message : err);
          }
          handed++;
        }
        from = { at: row.at, id: row.id };
        if (isAfter(from, cursor)) cursor = from;
      }
      if (rows.length < TAIL_PAGE) break;
    }
    return handed;
  }

  return { pass, cursor: (): TailCursor => ({ ...cursor }) };
}

/** `(at, id)` order. Both timestamps are fixed-width UTC ISO text once read from a row. */
function isAfter(a: TailCursor, b: TailCursor): boolean {
  const ta = micros(a.at), tb = micros(b.at);
  return ta !== tb ? ta > tb : a.id > b.id;
}

/** An ISO timestamp as a comparable string of microseconds: `…:05.123Z` and `…:05.123000Z` are the same instant. */
function micros(iso: string): string {
  const [head, frac = ''] = iso.replace(/Z$/, '').split('.');
  return `${head}.${frac.padEnd(6, '0').slice(0, 6)}`;
}

let timer: ReturnType<typeof setInterval> | undefined;
let busy = false;

export function startWorkflowCompletionTail(deps: TailDeps = defaultDeps): void {
  if (timer) return;
  const tail = createCompletionTail(new Date(), deps);
  const raw = parseInt(process.env.WORKFLOW_COMPLETION_TAIL_MS || '', 10);
  const ms = Number.isFinite(raw) && raw >= 1_000 ? raw : DEFAULT_POLL_MS;
  console.log(`[workflow-tail] listening for finished workflows every ${ms}ms`);
  timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void tail
      .pass()
      .catch((err) => console.warn('[workflow-tail] pass failed:', err instanceof Error ? err.message : err))
      .finally(() => {
        busy = false;
      });
  }, ms);
  timer.unref?.();
}

export function stopWorkflowCompletionTail(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  busy = false;
}
