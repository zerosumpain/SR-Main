// Sweep marked Gmail threads into the intel graph.
//
//   GET  ?query=&limit=&accountId=   what a sweep WOULD touch — thread list,
//                                    participant counts, and which are already
//                                    ingested. No LLM calls, no writes.
//   POST { query?, limit?, accountId? }  run the sweep
//
// Owner-gated by hooks.server.ts like every other /api/jkai route. The work
// lives in $lib/jkai/intel/gmail-ingest; this route only validates and shapes.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAutoExtractEnabled } from '$lib/jkai/intel/auto-extract';
import {
  DEFAULT_GMAIL_INTEL_QUERY,
  ROLLING_GMAIL_INTEL_QUERY,
  ingestGmailThreads,
  previewGmailSweep,
  clampThreadLimit,
  type GmailSweepMode,
} from '$lib/jkai/intel/gmail-ingest';

/** A Gmail query longer than this is a mistake, not a query. */
const MAX_QUERY_CHARS = 500;

/** 'rolling' sweeps the 12-week window; anything else keeps the marked sweep. */
function readMode(raw: unknown): GmailSweepMode {
  return raw === 'rolling' ? 'rolling' : 'marked';
}

function readBudget(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function readAccountId(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function readQuery(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const q = raw.trim();
  if (!q) return undefined;
  return q.slice(0, MAX_QUERY_CHARS);
}

/** Gmail auth and quota failures are the caller's problem to fix, not a 500. */
function statusFor(message: string): number {
  if (/not found|no active gmail account/i.test(message)) return 404;
  if (/re-authentication|invalid_grant|auth expired/i.test(message)) return 409;
  return 502;
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const preview = await previewGmailSweep({
      query: readQuery(url.searchParams.get('query')),
      limit: clampThreadLimit(url.searchParams.get('limit') ?? undefined),
      accountId: readAccountId(url.searchParams.get('accountId')),
      mode: readMode(url.searchParams.get('mode')),
    });
    return json({
      ...preview,
      enabled: isAutoExtractEnabled(),
      defaultQuery: DEFAULT_GMAIL_INTEL_QUERY,
      rollingQuery: ROLLING_GMAIL_INTEL_QUERY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, { status: statusFor(message) });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  if (!isAutoExtractEnabled()) {
    return json({ error: 'Intel auto-extraction is disabled (INTEL_AUTO_EXTRACT=0).' }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    limit?: unknown;
    accountId?: unknown;
    mode?: unknown;
    extractBudget?: unknown;
    includeAttachments?: unknown;
  };

  const mode = readMode(body.mode);
  const startedAt = new Date();

  // Recorded BEFORE the sweep, not just after it. A sweep killed mid-flight —
  // which is exactly what the watchdog was doing — writes nothing on its way
  // out, so recording only on completion left the run history silent in the one
  // case it existed for. The nightly path already did this; this one did not.
  await logSweep(startedAt, null);

  try {
    const result = await ingestGmailThreads({
      query: readQuery(body.query),
      // A rolling sweep pages the whole window; clamping to the marked sweep's
      // 100-thread ceiling here would silently cap the backfill at one page.
      limit: mode === 'rolling' ? (Number(body.limit) || undefined) : clampThreadLimit(body.limit),
      accountId: readAccountId(body.accountId),
      mode,
      extractBudget: readBudget(body.extractBudget),
      includeAttachments: body.includeAttachments !== false,
    });
    await logSweep(startedAt, true, {
      threads: result.threads,
      extracted: result.extracted,
      entities: result.entities,
      links: result.edges,
      deferred: result.deferred,
      failed: result.failed,
    });
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logSweep(startedAt, false, undefined, message);
    return json({ error: message }, { status: statusFor(message) });
  }
};

/**
 * Record a hand-run sweep alongside the nightly ones.
 *
 * The same failure hits both paths — they share `ingestGmailThreads` — so a
 * history that only covered the scheduled run would leave the button's
 * failures nowhere, and would show nothing at all until the next 04:15.
 * Best-effort throughout: bookkeeping must never turn a completed sweep into
 * an error response.
 */
async function logSweep(
  startedAt: Date,
  ok: boolean | null,
  counts?: Record<string, number>,
  error?: string,
): Promise<void> {
  try {
    const { ensureIntelRunCollection, recordIntelRun, localDayOf } = await import(
      '$lib/jkai/intel/run-log'
    );
    await ensureIntelRunCollection();
    const now = new Date();
    const elapsed = now.getTime() - startedAt.getTime();
    const running = ok === null;
    await recordIntelRun({
      startedAt: startedAt.toISOString(),
      // A run still in flight has no finish time. Stamping one would make an
      // interrupted sweep read as a completed one in the history.
      ...(running ? {} : { finishedAt: now.toISOString(), totalMs: elapsed }),
      day: localDayOf(startedAt),
      trigger: 'manual',
      status: running ? 'running' : ok ? 'ok' : 'failed',
      stages: [
        {
          stage: 'gmail',
          ok: ok !== false,
          ...(counts ? { counts } : {}),
          ...(error ? { error } : {}),
          ms: elapsed,
        },
      ],
    });
  } catch (err) {
    console.error('[intel:gmail-ingest] could not record manual sweep:', err);
  }
}
