// Nightly intel maintenance.
//
// Everything phase 2 added has a batch half that nothing was calling: the
// watchlist only diffs when someone hits its endpoint, live-query lenses only
// evaluate on demand, and confidence scores only refresh for entities that get
// touched. A watchlist that only tells you what changed when you remember to
// ask is not a watchlist.
//
// Modelled on $lib/selfimprove/engine and $lib/briefing/engine: an interval
// that checks the wall clock, prod-gated by hostname, with a kill switch. Not
// a cron dependency, so it survives a host with no crontab.
import { runWatchlistCheck } from './watchlist';
import { runDueLensChecks } from './lenses.server';
import { backfillConfidence } from './trust-refresh';
import { invalidateGraphAnalysis } from './analytics/load';
import { beginBatch } from '$lib/workflows/engine-runtime';
import {
  ensureIntelRunCollection,
  recordIntelRun,
  hasScheduledRunFor,
  statusFrom,
  localDayOf,
  type IntelRunData,
  type IntelStageResult,
} from './run-log';

/** Local hour the sweep runs at. After the 03:30 self-improvement pass. */
const RUN_HOUR = 4;
const RUN_MINUTE = 15;
/** How often the clock is checked. Coarse on purpose — this is not urgent. */
const TICK_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunDay: string | null = null;

export function isIntelEngineEnabled(): boolean {
  if (process.env.JKAI_BUILDER_PROCESS === '1') return false;
  return process.env.INTEL_ENGINE !== '0';
}

/**
 * The rolling Gmail sweep is separately switchable from the rest of the engine.
 * It is the only stage that reaches a third-party API and the only one that
 * spends money, so it needs its own off switch — turning the whole engine off
 * to stop mail ingestion would also stop the watchlist and lens checks.
 */
export function isGmailRollingEnabled(): boolean {
  return process.env.INTEL_GMAIL_ROLLING !== '0';
}

export interface IntelSweepResult {
  confidenceScored: number;
  watchChanges: number;
  lensChanges: number;
  /** Threads swept from the rolling Gmail window, if enabled. */
  gmailThreads: number;
  gmailExtracted: number;
  errors: string[];
  /** Per-stage outcome, persisted to `intel_runs` and shown on /jkai/intel. */
  stages: IntelStageResult[];
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.stack?.split('\n').slice(0, 3).join(' | ') ?? err.message;
  return String(err);
}

/**
 * Run one stage, timing it and capturing its failure as TEXT rather than as a
 * tally. The old shape pushed `errors.push(...)` and then logged only
 * `errors.length`, which is how a stage that had never once succeeded looked
 * identical to a healthy night with a transient blip.
 */
async function runStage(
  stage: IntelStageResult['stage'],
  fn: () => Promise<Record<string, number>>,
  batch?: { beat(phase?: string): void },
): Promise<IntelStageResult> {
  const t0 = Date.now();
  batch?.beat(stage);
  try {
    const counts = await fn();
    return { stage, ok: true, counts, ms: Date.now() - t0 };
  } catch (err) {
    const error = messageOf(err);
    console.error(`[intel:engine] stage ${stage} failed: ${error}`);
    return { stage, ok: false, error, ms: Date.now() - t0 };
  }
}

/**
 * One maintenance pass. Ordered deliberately: confidence first, because both
 * the watchlist diff and any lens with a confidence floor read it, and a NULL
 * score silently excludes an entity from every such filter.
 */
export async function runIntelSweep(
  opts: { trigger?: IntelRunData['trigger'] } = {},
): Promise<IntelSweepResult> {
  const trigger = opts.trigger ?? 'scheduled';
  const startedAt = new Date();
  const day = localDayOf(startedAt);
  const stages: IntelStageResult[] = [];

  // Best-effort: a bookkeeping failure must not stop the night's real work.
  await ensureIntelRunCollection().catch((err) =>
    console.error('[intel:engine] run collection unavailable:', messageOf(err)),
  );
  const persist = async (status: IntelRunData['status'], finished?: Date) => {
    try {
      await recordIntelRun({
        startedAt: startedAt.toISOString(),
        ...(finished ? { finishedAt: finished.toISOString(), totalMs: finished.getTime() - startedAt.getTime() } : {}),
        day,
        trigger,
        status,
        stages,
      });
    } catch (err) {
      console.error('[intel:engine] could not record run:', messageOf(err));
    }
  };
  // Written BEFORE any work, so a sweep that is killed mid-flight — which is
  // exactly what the watchdog was doing — still leaves a 'running' record
  // behind instead of vanishing without trace.
  await persist('running');

  // Tells the health probe this process is busy, not wedged. Without it a
  // stage heavy enough to stall the loop gets the service restarted underneath
  // it, and the sweep never completes on any night.
  const batch = beginBatch('intel:sweep', 'starting');
  try {

  // Mail FIRST, so everything downstream scores the graph the mail just added:
  // confidence backfill, the watchlist diff and lens checks all read the graph,
  // and running them before ingestion would leave a night's correspondence
  // unscored and unwatched until the following day.
  if (isGmailRollingEnabled()) {
    // The previous version noted that a host with no Gmail account connected
    // "must not read as a broken engine", and swallowed the error to that end.
    // That instinct is right about fresh installs and wrong about this one: the
    // same silence hid a real fault for the entire life of the feature. A
    // stage that did not run is now reported as failed WITH its reason, and the
    // reason for an unconnected host — "connect one at /admin/connections/gmail"
    // — is its own fix. Nothing is dressed up as success.
    stages.push(
      await runStage('gmail', async () => {
        const { ingestGmailThreads } = await import('./gmail-ingest');
        const sweep = await ingestGmailThreads({ mode: 'rolling' });
        return {
          threads: sweep.threads,
          extracted: sweep.extracted,
          entities: sweep.entities,
          links: sweep.edges,
          deferred: sweep.deferred,
          failed: sweep.failed,
        };
      }, batch),
    );
  }

  // Each stage is isolated: one failing must not cost the others, since a
  // silent no-op is exactly the failure mode this engine exists to prevent.
  stages.push(
    await runStage(
      'confidence',
      async () => ({
        scored: (
          await backfillConfidence({
            onProgress: (done, total) => batch.beat(`confidence ${done}/${total}`),
          })
        ).scored,
      }),
      batch,
    ),
  );
  stages.push(
    await runStage('watchlist', async () => {
      invalidateGraphAnalysis();
      return { changes: (await runWatchlistCheck()).changes?.length ?? 0 };
    }, batch),
  );
  stages.push(
    await runStage('lenses', async () => ({ changes: (await runDueLensChecks()).length }), batch),
  );

  } finally {
    batch.end();
  }

  const finished = new Date();
  const status = statusFrom(stages);
  await persist(status, finished);

  const find = (s: IntelStageResult['stage']) => stages.find((x) => x.stage === s);
  const result: IntelSweepResult = {
    gmailThreads: find('gmail')?.counts?.threads ?? 0,
    gmailExtracted: find('gmail')?.counts?.extracted ?? 0,
    confidenceScored: find('confidence')?.counts?.scored ?? 0,
    watchChanges: find('watchlist')?.counts?.changes ?? 0,
    lensChanges: find('lenses')?.counts?.changes ?? 0,
    errors: stages.filter((s) => !s.ok).map((s) => `${s.stage}: ${s.error}`),
    stages,
  };

  console.log(
    `[intel:engine] sweep ${status} in ${finished.getTime() - startedAt.getTime()}ms — ` +
      `${result.gmailThreads} gmail threads (${result.gmailExtracted} extracted), ` +
      `${result.confidenceScored} scored, ${result.watchChanges} watch changes, ` +
      `${result.lensChanges} lens changes` +
      // The messages, not the count. This line is the whole reason the Gmail
      // failure went unseen for as long as it did.
      (result.errors.length ? ` — FAILED: ${result.errors.join('; ')}` : ''),
  );
  return result;
}

/**
 * One clock check. Guarded on the DAY so a restart at 04:20 does not re-run a
 * sweep that already happened — but the in-memory flag alone was not enough,
 * because the restarts were caused BY the sweep: it blocked the event loop past
 * the workflow-engine health probe's 5s threshold, systemd's watchdog restarted
 * the service, and the new process woke up with `lastRunDay` empty and the
 * clock still inside the window. That loop ran eight times a night. The durable
 * check in `hasScheduledRunFor` is what actually stops it.
 */
async function tick(): Promise<void> {
  const now = new Date();
  const day = localDayOf(now);
  if (day === lastRunDay) return;
  if (now.getHours() !== RUN_HOUR || now.getMinutes() < RUN_MINUTE) return;
  if (await hasScheduledRunFor(day)) {
    // Claim it in memory too, so a restarted process stops asking the database
    // every five minutes for the rest of the window.
    lastRunDay = day;
    console.log(`[intel:engine] sweep for ${day} already recorded — skipping`);
    return;
  }
  lastRunDay = day;
  await runIntelSweep({ trigger: 'scheduled' }).catch((err) =>
    console.error('[intel:engine] sweep failed:', err),
  );
}

export function startIntelEngine(): void {
  if (timer || !isIntelEngineEnabled()) return;

  timer = setInterval(() => {
    void tick();
  }, TICK_MS);

  // Node keeps the process alive for an interval otherwise, which would hold a
  // deploy's SIGTERM open for up to five minutes.
  timer.unref?.();
  console.log(`[intel:engine] started — nightly sweep at ${RUN_HOUR}:${String(RUN_MINUTE).padStart(2, '0')}`);
}

export function stopIntelEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
