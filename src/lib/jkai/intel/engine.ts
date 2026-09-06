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

/**
 * Duplicate resolution is separately switchable because it is the only stage
 * that MUTATES entities other stages merely read.
 */
export function isAutoResolveEnabled(): boolean {
  return process.env.INTEL_AUTO_RESOLVE !== '0';
}

/**
 * Adjudication is separately switchable because it is the only stage that
 * spends money PER PAIR. Everything else in the sweep costs a fixed amount or
 * nothing; this one scales with how many ambiguous duplicates the graph has,
 * which is not a number anybody controls.
 */
export function isAdjudicationEnabled(): boolean {
  return process.env.INTEL_ADJUDICATE !== '0';
}

/**
 * Merges one night may apply.
 *
 * Not a performance limit — the whole pass costs one query and some
 * arithmetic. It is a blast radius. If a future signal starts proposing
 * nonsense, the cap is the difference between reading about it over breakfast
 * and finding a week of it. Every merge is reversible through the ledger, but
 * reversing twenty-five is an afternoon and reversing four hundred is not.
 */
const AUTO_RESOLVE_LIMIT = 25;

export interface IntelSweepResult {
  confidenceScored: number;
  /** Candidate pairs the adjudicator read and answered. */
  pairsAdjudicated: number;
  watchChanges: number;
  lensChanges: number;
  /** Threads swept from the rolling Gmail window, if enabled. */
  gmailThreads: number;
  gmailExtracted: number;
  /** Duplicates merged automatically, if enabled. */
  duplicatesMerged: number;
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

  stages.push(await runStage('cleanup', async () => {
    const { cleanupIntelligence } = await import('./cleanup.server');
    return (await cleanupIntelligence({ apply: true })).counts;
  }, batch));

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
          // Under the gate this is the number that means something: threads
          // captured and waiting at /jkai/intel/mail. `extracted` is 0 by design
          // on a gated night, and a stage line of nothing but zeros reads as a
          // broken sweep rather than a working one.
          held: sweep.held,
          extracted: sweep.extracted,
          entities: sweep.entities,
          links: sweep.edges,
          deferred: sweep.deferred,
          failed: sweep.failed,
          // The three the run log used to leave out, and the omission is how a
          // 54%-wasted budget looked like a healthy "ok" every night for weeks.
          //
          // `extracted` alone cannot tell you whether a low number means a
          // quiet mailbox or a budget being burned on threads that can never
          // succeed. `budgetLeft > 0` says the sweep ran out of work;
          // `budgetLeft === 0` with a low `extracted` says it ran out of budget
          // and the difference went somewhere — which is the question.
          unchanged: sweep.unchanged,
          skipped: sweep.skipped,
          budgetLeft: sweep.budgetLeft,
        };
      }, batch),
    );
  }

  // Score the queue against the graph BEFORE the rules read it, and after the
  // sweep that captured tonight's mail.
  //
  // The ordering is load-bearing in both directions. Score before the rules or
  // a topical rule decides on last night's numbers — and on a thread swept an
  // hour ago, on no numbers at all, which reads as "irrelevant" rather than as
  // "unknown". Score after the sweep or tonight's mail waits a full day for its
  // first look. Costs no model calls: one pass over the entity names plus one
  // kNN per thread against vectors the gate already paid for.
  stages.push(
    await runStage('mail-relevance', async () => {
      const { scoreMailRelevance } = await import('./mail-relevance');
      const scored = await scoreMailRelevance();
      return {
        scanned: scored.scanned,
        scored: scored.scored,
        withHits: scored.withHits,
        remaining: scored.remaining,
        // Anchored entities the matcher was built from. Zero is the number that
        // matters: it means nothing in the graph is known from outside email, so
        // every thread scores 0 and a topical rule admits nothing — which is
        // correct, and indistinguishable from a broken stage without this line.
        entities: scored.entities,
        // 0 here means no topical rule can match tonight or any night until
        // something is watched. It is the difference between "nothing relevant
        // arrived" and "the signal is not armed".
        foreground: scored.foreground,
        blocked: scored.blocked,
        similarityFailed: scored.similarityFailed ? 1 : 0,
      };
    }, batch),
  );

  // The owner's approved rules, immediately after the sweep that captured the
  // mail they act on. A rule that ran before the sweep would be a night behind
  // for ever, always deciding about yesterday's post.
  //
  // Unconditional: with no active rule this is a single datastore read that
  // returns `ran: false`, which is the normal state until the owner approves
  // one. Reporting it as a stage anyway means "no rules are on" is visible in
  // the run log rather than being indistinguishable from "the stage is broken".
  stages.push(
    await runStage('mail-rules', async () => {
      const { applyMailRules } = await import('./mail-rules/apply');
      const applied = await applyMailRules();
      return {
        activeRules: applied.activeRules,
        scanned: applied.scanned,
        admitted: applied.admitted,
        rejected: applied.rejected,
        deferred: applied.deferred,
        failed: applied.failed,
      };
    }, batch),
  );

  // Catch up on embeddings that an outage left behind.
  //
  // Embeddings are the ONE thing that cannot fall back to Codex — the bridge has
  // no such endpoint and there is nothing upstream to call, so while the
  // OpenRouter key is out of credit every vector write on the site fails. That
  // is survivable (extraction falls back, admission still works, entities still
  // land) but it is only survivable because of this stage: without something
  // that goes back for the misses, an outage leaves a permanently half-embedded
  // corpus and the gap is invisible until a search quietly returns nothing.
  //
  // Both backfills stop early when the provider is still refusing, so a night
  // during an outage costs one call rather than several hundred.
  stages.push(
    await runStage('embeddings', async () => {
      const [{ backfillPendingEmbeddings }, { backfillMailIndex }, { backfillEntityEmbeddings }] =
        await Promise.all([
          import('./mail-queue'),
          import('$lib/mail-index/store'),
          import('./embed'),
        ]);
      const notes = await backfillPendingEmbeddings();
      const passages = await backfillMailIndex();
      // Entities too. #515 wired the two mail backfills and left this one out,
      // which showed up immediately: 135 entities carried no vector after the
      // outage, and an unembedded entity cannot be matched against — so the next
      // extraction forks a duplicate rather than binding to it (see extract.ts,
      // which filters candidates on `embedding IS NOT NULL`).
      const entities = await backfillEntityEmbeddings();
      return {
        notesEmbedded: notes.embedded,
        notesRemaining: notes.remaining,
        threadsIndexed: passages.indexed,
        entitiesEmbedded: entities.embedded,
        entitiesRemaining: entities.remaining,
        // Reported as a number because the run log stores numbers. 1 means the
        // provider was still refusing, which is why the other figures are low.
        providerRefused: notes.stopped || passages.stopped ? 1 : 0,
      };
    }, batch),
  );

  // Resolution BEFORE scoring, and after mail: the night's new entities are
  // exactly the ones most likely to duplicate something, and confidence,
  // watchlist and lenses should all run against the merged graph rather than
  // score two halves of the same thing separately.
  //
  // Until now this existed and nothing called it — a resolver that runs only
  // when somebody remembers to open a page is how forty-one people came to be
  // filed as one and stayed that way.
  if (isAutoResolveEnabled()) {
    stages.push(
      await runStage('resolve', async () => {
        const { autoMergeDuplicates, backfillAliasesFromTombstones } = await import('./resolve/merge');
        // Recover the surface forms every merge before this discarded. Runs
        // first, so the night's matching can already use them: the alias list is
        // what lets the resolver recognise a name it has seen lose an argument
        // before, and for 490 merges it was silently thrown away.
        const aliases = await backfillAliasesFromTombstones({
          onProgress: (done, total) => batch.beat(`aliases ${done}/${total}`),
        });
        const swept = await autoMergeDuplicates(undefined, { limit: AUTO_RESOLVE_LIMIT });
        for (const d of swept.details) {
          // Named in the journal, because a merge nobody can see is a merge
          // nobody can question.
          console.log(`[intel:resolve] merged "${d.merge}" into "${d.keep}" (${d.confidence.toFixed(2)})`);
        }
        return {
          candidates: swept.candidates,
          merged: swept.merged,
          skipped: swept.skipped,
          chainsBroken: swept.chainsBroken,
          aliasesLearned: aliases.aliasesAdded,
          entitiesRelabelled: aliases.updated,
        };
      }, batch),
    );
  }

  if (isAutoResolveEnabled()) {
    stages.push(await runStage('taxonomy', async () => {
      const { runTaxonomyQuality } = await import('./taxonomy-governance.server');
      return runTaxonomyQuality();
    }, batch));
  }

  // Adjudication AFTER the auto-merge, on what the rules could not settle.
  //
  // Ordered this way on purpose: running it first would spend a model call on
  // pairs the threshold was about to merge anyway. What is left after the merge
  // is exactly the band the string rules cannot reach — names that resemble each
  // other and mean different things, or mean the same thing and look nothing
  // alike — and the only way through it is to read the evidence.
  //
  // It writes verdicts, never merges. A verdict of 'same' lifts the pair's
  // score, so the NEXT night's resolve stage may carry it over the auto-merge
  // line; that line, its chain guard and its 25-merge cap are untouched.
  if (isAdjudicationEnabled()) {
    stages.push(
      await runStage('adjudicate', async () => {
        const [{ sweepDuplicates }, { adjudicateCandidates, ADJUDICATION_BAND }] = await Promise.all([
          import('./resolve/merge'),
          import('./resolve/adjudicate'),
        ]);
        const sweep = await sweepDuplicates(ADJUDICATION_BAND.min);
        batch.beat('adjudicate 0');
        const run = await adjudicateCandidates(sweep.reports, {
          // The batch heartbeat goes stale after 120s and a stale batch stops
          // suppressing the stall alarm. Model calls are seconds each and this
          // stage makes up to forty of them in a row, so it beats per pair.
          onProgress: (done, total) => batch.beat(`adjudicate ${done}/${total}`),
        });
        return {
          // `considered` is what was actually sent; `skipped` is everything the
          // band or an existing verdict held back. Both, because a stage that
          // reported only its verdicts would look identical whether it had read
          // forty pairs or none.
          considered: run.considered,
          skipped: run.skipped,
          decided: run.decided,
          same: run.same,
          different: run.different,
          unsure: run.unsure,
          failed: run.failed,
          // How many candidates the vector pass contributed. Zero here with a
          // healthy graph means embeddings are missing, not that nothing matched.
          semanticPairs: sweep.semanticPairs,
          ruledOut: sweep.ruledOut,
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
  // Conflation, AFTER the watchlist invalidated the analysis, so the shortlist is
  // computed on a graph that includes the night's ingest rather than a cached one
  // from before it.
  //
  // The three conflations this repairs were found by hand — a person reading
  // relation lists over SSH — which fixes one night's graph and nothing about the
  // next. Budgeted rather than exhaustive: a verdict is cached against the
  // entity's relation vocabulary, so a night where nothing changed shape costs no
  // model calls at all, and the ceiling bounds the first night.
  //
  // Counts only, because that is all a run record holds. WHICH entities were
  // repaired is in the split ledger and the verdict collection, which are the
  // durable records and outlive the run log's retention.
  //
  // Applies only a CORROBORATED proposal — one an earlier night made identically.
  // The proposals are not stable: three runs over the same twelve entities, same
  // prompt, temperature 0, gave `IBCA Data Strategy -> IBCA Board (18)` once and
  // `IBCA Data Strategy -> IBCA (4)` the next, because requests are
  // throughput-routed across providers. Asking twice on different days is the
  // cheapest filter on that, and it is why a `proposed` verdict is deliberately
  // NOT cache-suppressed. `INTEL_CONFLATION_APPLY=0` switches applying off.
  stages.push(
    await runStage('conflation', async () => {
      const { runConflationSweep } = await import('./resolve/conflation.server');
      const out = await runConflationSweep();
      return {
        shortlisted: out.shortlisted,
        judged: out.judged,
        cached: out.cached,
        applied: out.applied,
        proposed: out.proposed,
        corroborated: out.corroborated,
        queued: out.queued,
        skipped: out.skipped,
        failed: out.failed,
      };
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
    duplicatesMerged: find('resolve')?.counts?.merged ?? 0,
    pairsAdjudicated: find('adjudicate')?.counts?.decided ?? 0,
    confidenceScored: find('confidence')?.counts?.scored ?? 0,
    watchChanges: find('watchlist')?.counts?.changes ?? 0,
    lensChanges: find('lenses')?.counts?.changes ?? 0,
    errors: stages.filter((s) => !s.ok).map((s) => `${s.stage}: ${s.error}`),
    stages,
  };

  console.log(
    `[intel:engine] sweep ${status} in ${finished.getTime() - startedAt.getTime()}ms — ` +
      `${result.gmailThreads} gmail threads (${result.gmailExtracted} extracted), ` +
      `${result.duplicatesMerged} duplicates merged, ` +
      `${result.pairsAdjudicated} pairs adjudicated, ` +
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
