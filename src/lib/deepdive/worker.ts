import { EventEmitter } from 'events';
import { db } from '$lib/db';
import { researchSessions, researchLeads } from '$lib/db/schema';
import type { ResearchSession } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { SSEEvent, SessionStats, SessionStatus } from './types';
import { runPhase1 } from './phase1';
import { runPhase2 } from './phase2';
import { runPhase3 } from './phase3';
import { runPostProcessing } from './postprocess';
import { linkSessionEntitiesToGlobal } from './cross-session';
import { extractResearchIntoIntel } from './intel-bridge';
import { disposeArtefacts, flushArtefacts } from './desk-events';
import { coerceDepth, depthPreset } from './depth';
import { createBudget, NO_BUDGET } from './budget';
import { runInstant, runScan } from './fast';
import { runBrief } from './brief';
import { PHASE_ORDER, resumePhase, startPhaseIndex, type ResearchPhase } from './phase-order';
import { runWithResearchMeter } from './meter';

// In-memory map of active session emitters
const activeEmitters = new Map<string, EventEmitter>();
const stopSignals = new Map<string, boolean>();
const skipSignals = new Map<string, boolean>();
const pauseSignals = new Map<string, boolean>();
const abortControllers = new Map<string, AbortController>();

export function getEmitter(sessionId: string): EventEmitter {
  let emitter = activeEmitters.get(sessionId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    activeEmitters.set(sessionId, emitter);
  }
  return emitter;
}

/**
 * Guaranteed emitter accessor for callers that may run AFTER a session's
 * 30s post-completion cleanup has torn the emitter down (e.g. on-demand
 * synthesis on a completed session). Re-creates the emitter if absent so
 * the SSE stream keeps flowing; returns the existing one for live sessions.
 */
export function ensureEmitter(sessionId: string): EventEmitter {
  return getEmitter(sessionId);
}

export function emit(sessionId: string, event: SSEEvent): void {
  const emitter = activeEmitters.get(sessionId);
  if (emitter) {
    emitter.emit('event', event);
  }
}

export function emitLog(sessionId: string, icon: string, message: string): void {
  emit(sessionId, {
    type: 'log',
    message: `${icon}  ${message}`,
    data: { icon, timestamp: Date.now() },
  });
}

export function emitStats(sessionId: string, stats: SessionStats): void {
  emit(sessionId, { type: 'stats', data: stats as unknown as Record<string, unknown> });
}

export function emitStatus(sessionId: string, status: SessionStatus): void {
  emit(sessionId, { type: 'status', data: { status } });
}

export function shouldStop(sessionId: string): boolean {
  return stopSignals.get(sessionId) === true;
}

/**
 * Whether THIS process is currently running the session.
 *
 * Process-local by design: it answers "should I start work" for the node that
 * asks, and a second node must be free to reach its own conclusion. Durable
 * cross-process liveness is what `heartbeatAt` is for.
 */
export function isRunning(sessionId: string): boolean {
  return abortControllers.has(sessionId);
}

export function shouldSkipPhase(sessionId: string): boolean {
  return skipSignals.get(sessionId) === true;
}

export function requestStop(sessionId: string): void {
  stopSignals.set(sessionId, true);
  // Abort any in-flight HTTP requests
  const ac = abortControllers.get(sessionId);
  if (ac) ac.abort();
}

export function getAbortSignal(sessionId: string): AbortSignal | undefined {
  return abortControllers.get(sessionId)?.signal;
}

/** Throws if session has been stopped — call this between async operations */
export function throwIfStopped(sessionId: string): void {
  if (shouldStop(sessionId)) {
    const err = new Error('Research stopped');
    err.name = 'AbortError';
    throw err;
  }
}

export function requestSkipPhase(sessionId: string): void {
  skipSignals.set(sessionId, true);
}

/**
 * Ask a run to stop where it is and keep its place.
 *
 * Pause is cooperative — it sets a flag the phases notice at the top of their
 * loops, and does NOT abort the in-flight request the way `requestStop` does.
 * The difference matters: a paused run is one you intend to finish, so
 * discarding the source currently being extracted would cost real money to
 * re-fetch. The trade is that pausing takes until the end of the current lead,
 * usually a few seconds.
 */
export function requestPause(sessionId: string): void {
  pauseSignals.set(sessionId, true);
}

export function shouldPause(sessionId: string): boolean {
  return pauseSignals.get(sessionId) === true;
}

/**
 * Forget any stop/skip/pause asked of this session.
 *
 * Signals are only swept 30 seconds after a run ends, so resuming a run that
 * was paused (or stopped) moments ago would otherwise re-read the old flag and
 * halt again immediately.
 */
export function clearSignals(sessionId: string): void {
  stopSignals.delete(sessionId);
  skipSignals.delete(sessionId);
  pauseSignals.delete(sessionId);
}

/**
 * Worker heartbeat.
 *
 * Liveness is written EXPLICITLY, never derived by subtracting `updatedAt`: a
 * row touched by an unrelated write would read as alive, and a worker sitting
 * inside one long LLM call would read as dead. Only a running worker calls
 * this, so a stale `heartbeatAt` means exactly one thing — nobody is working on
 * this session — which is what lets the resume sweep adopt it safely.
 *
 * Throttled, because the natural call sites are inside per-source loops and a
 * write per source would be hundreds of pointless UPDATEs on a long run.
 */
const HEARTBEAT_INTERVAL_MS = 10_000;
const lastBeat = new Map<string, number>();

export function beat(sessionId: string, force = false): void {
  const now = Date.now();
  if (!force && now - (lastBeat.get(sessionId) ?? 0) < HEARTBEAT_INTERVAL_MS) return;
  lastBeat.set(sessionId, now);
  db.update(researchSessions)
    .set({ heartbeatAt: new Date() })
    .where(eq(researchSessions.id, sessionId))
    .catch((err) => console.error('[deepdive] heartbeat failed:', err));
}

async function updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (status === 'complete' || status === 'failed') {
    update.completedAt = new Date();
  }
  await db.update(researchSessions).set(update).where(eq(researchSessions.id, sessionId));
}

/**
 * Terminal bookkeeping shared by every tier: stamp the wall-clock duration,
 * mark the session complete and tell the stream.
 *
 * `durationMs` is stored rather than recomputed from `completedAt - createdAt`,
 * because a session can sit in `draft` for minutes before a worker picks it up
 * and a resumed session's createdAt is older still. The tier picker quotes
 * measured p50s off this column, so it has to mean "time actually spent
 * researching".
 *
 * `priorMs` carries what earlier legs of a paused-and-resumed run already
 * spent. Without it a run paused after fifty minutes and resumed for one would
 * report a one-minute investigation, and the p50s would drift towards fiction.
 */
async function finish(sessionId: string, startTime: number, priorMs = 0): Promise<void> {
  const durationMs = priorMs + (Date.now() - startTime);
  await db
    .update(researchSessions)
    .set({ status: 'complete', completedAt: new Date(), durationMs, resumeFrom: null })
    .where(eq(researchSessions.id, sessionId));
  emitStatus(sessionId, 'complete');
  emit(sessionId, { type: 'complete', data: { durationMs } });
  emitLog(sessionId, 'ℹ️', `Research complete in ${Math.round(durationMs / 1000)}s.`);
}

/**
 * Park a run: record where it got to, hand its in-flight leads back to the
 * queue, and leave the row in a state the resume sweep will not touch.
 *
 * Requeueing matters as much as the status. A lead left `running` belongs to a
 * worker that no longer exists, and `takeLeads` only ever claims `queued` rows
 * — so without this the six leads in flight at the moment of the pause would
 * be silently dropped from the frontier and never researched.
 */
export async function pauseRun(sessionId: string, phase: ResearchPhase, spentMs = 0): Promise<void> {
  await db
    .update(researchLeads)
    .set({ status: 'queued', startedAt: null })
    .where(and(eq(researchLeads.sessionId, sessionId), eq(researchLeads.status, 'running')));

  await db
    .update(researchSessions)
    .set({
      status: 'paused',
      resumeFrom: phase,
      // Null, not stale: nobody is working on this session, and saying so is
      // what keeps a paused run honest on the ops views.
      heartbeatAt: null,
      // Everything spent so far, across every leg — so a run paused twice does
      // not forget the first two.
      durationMs: spentMs,
    })
    .where(eq(researchSessions.id, sessionId));

  emitStatus(sessionId, 'paused');
  emitLog(sessionId, '⏸️', `Paused during ${phase}. Nothing is lost — resume when you are ready.`);
}

export async function startResearch(sessionId: string): Promise<void> {
  // Don't await — run in background
  runResearch(sessionId).catch((err) => {
    console.error(`[deepdive] Research failed for session ${sessionId}:`, err);
    emit(sessionId, { type: 'error', message: err.message });
    db.update(researchSessions)
      .set({ status: 'failed', completedAt: new Date(), errorMessage: err?.message ?? 'Unknown error' })
      .where(eq(researchSessions.id, sessionId))
      .catch(console.error);
  });
}

/**
 * Run a session to completion in-process and return the final row.
 *
 * The workflow node used to start a session and then poll `research_status`
 * every five seconds for up to fifteen minutes. For the budgeted tiers that is
 * both slower than the work itself and a source of phantom timeouts, so they
 * get a direct await instead.
 */
export async function runResearchSync(sessionId: string): Promise<ResearchSession> {
  try {
    await runResearch(sessionId);
  } catch (err: any) {
    console.error(`[deepdive] Research failed for session ${sessionId}:`, err);
    await db
      .update(researchSessions)
      .set({ status: 'failed', completedAt: new Date(), errorMessage: err?.message ?? 'Unknown error' })
      .where(eq(researchSessions.id, sessionId))
      .catch(() => {});
  }
  const [row] = await db.select().from(researchSessions).where(eq(researchSessions.id, sessionId)).limit(1);
  if (!row) throw new Error('Research session missing after run');
  return row;
}

/**
 * Everything a run spends — LLM tokens, cash, Tavily credits — is metered
 * against this session id for as long as the run is inside this call. The
 * meter is ambient rather than threaded through the phases because `search()`
 * sits eight call sites deep and is shared with code that has no session.
 */
function runResearch(sessionId: string): Promise<void> {
  return runWithResearchMeter(sessionId, () => runResearchPhases(sessionId));
}

async function runResearchPhases(sessionId: string): Promise<void> {
  const emitter = getEmitter(sessionId);
  const ac = new AbortController();
  abortControllers.set(sessionId, ac);
  const startTime = Date.now();

  try {
    // Load session
    const [session] = await db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId));

    if (!session) throw new Error('Session not found');

    const preset = depthPreset(coerceDepth(session.depth));
    beat(sessionId, true);

    /**
     * Time this run has already spent on earlier legs, and the phase it should
     * pick up at. Both are stored facts: a run that was paused, or whose worker
     * was lost to a deploy, is resumed rather than restarted. See
     * `$lib/deepdive/phase-order` for the nine-hour run that made this
     * necessary.
     */
    const priorMs = session.durationMs ?? 0;
    const startAt = startPhaseIndex(resumePhase(session));
    /** The phase in flight, so a pause records where to come back to. */
    let currentPhase: ResearchPhase = PHASE_ORDER[startAt];
    const elapsed = (): number => priorMs + (Date.now() - startTime);

    // The stored budget wins over the preset's (a caller may have narrowed it),
    // then the legacy timeLimitMinutes, then the preset default.
    const budgetMs =
      session.budgetMs ??
      (session.timeLimitMinutes ? session.timeLimitMinutes * 60_000 : null) ??
      preset.budgetMs;
    const budget = budgetMs ? createBudget(budgetMs, preset.reserves) : NO_BUDGET;

    // The budgeted tiers each have a purpose-built runner; only `investigation`
    // walks the phase chain. See $lib/deepdive/depth for why the chain cannot
    // be squeezed into a clock by configuration alone.
    if (preset.runner !== 'phases') {
      const run =
        preset.runner === 'instant' ? runInstant : preset.runner === 'scan' ? runScan : runBrief;
      await updateSessionStatus(sessionId, 'phase1');
      emitStatus(sessionId, 'phase1');
      await run(sessionId, session, budget);
      flushArtefacts(sessionId);
      await finish(sessionId, startTime, priorMs);
      return;
    }

    /**
     * Per-phase deadlines, not one shared clock.
     *
     * A single whole-run deadline lets phase 1 spend everything: a budgeted
     * investigation measured 18 sources gathered and then ZERO facts, because
     * phase 2 found the budget already gone and broke on its first batch. That
     * is the same starvation the fast tiers reserve synthesis time to avoid,
     * and the phase chain needs the equivalent.
     *
     * The split is deliberately extraction-heavy: sources nobody analysed are
     * worth less than fewer sources turned into facts, entities and edges.
     */
    const PHASE_SHARE: Record<string, number> = { phase1: 0.3, phase2: 0.4, phase3: 0.15, post: 0.15 };
    let phaseDeadline = Infinity;

    function startPhase(name: string): void {
      if (budgetMs == null) {
        phaseDeadline = Infinity;
        return;
      }
      // Share of the ORIGINAL budget, floored at what is actually left, so an
      // overrunning phase cannot hand its debt to the next one.
      phaseDeadline = Date.now() + Math.min(budget.remaining(), budgetMs * (PHASE_SHARE[name] ?? 0.25));
    }

    function isTimeUp(): boolean {
      if (shouldStop(sessionId)) return true;
      if (shouldSkipPhase(sessionId)) return true;
      // Pause rides the same wind-down path a deadline uses: the phase finishes
      // the lead in its hand and returns, rather than being torn out of an
      // in-flight extraction whose fetch has already been paid for.
      if (shouldPause(sessionId)) return true;
      // `beat` is throttled, so calling it on every check is cheap and keeps
      // the heartbeat alive through long phases without extra plumbing.
      beat(sessionId);
      return budget.expired() || Date.now() > phaseDeadline;
    }

    /**
     * Stop here if a pause has been asked for, recording the phase in flight so
     * resuming comes back to it. Returns true when the run should unwind.
     */
    async function pauseIfAsked(): Promise<boolean> {
      if (!shouldPause(sessionId)) return false;
      flushArtefacts(sessionId);
      await pauseRun(sessionId, currentPhase, elapsed());
      return true;
    }

    if (startAt > 0) {
      emitLog(sessionId, 'ℹ️', `Resuming at ${currentPhase} — earlier phases are already done.`);
    }

    // Phase 1
    if (startAt <= 0 && !shouldStop(sessionId)) {
      currentPhase = 'phase1';
      skipSignals.delete(sessionId);
      startPhase('phase1');
      await updateSessionStatus(sessionId, 'phase1');
      emitStatus(sessionId, 'phase1');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 1: Lead Generation');
      try {
        await runPhase1(sessionId, session, isTimeUp);
      } catch (err: any) {
        if (err?.name === 'AbortError' || shouldStop(sessionId) || shouldPause(sessionId)) {
          emitLog(sessionId, '\u2139\uFE0F', 'Phase 1 stopped.');
        } else {
          console.error('[deepdive] Phase 1 error:', err);
          emitLog(sessionId, '\u26A0\uFE0F', `Phase 1 error: ${err.message ?? 'unknown'}. Continuing...`);
        }
      }
      if (await pauseIfAsked()) return;
      if (shouldSkipPhase(sessionId)) {
        emitLog(sessionId, '\u2139\uFE0F', 'Skipping to next phase...');
      }
    }

    // Phase 2
    if (startAt <= 1 && !shouldStop(sessionId)) {
      currentPhase = 'phase2';
      skipSignals.delete(sessionId);
      startPhase('phase2');
      await updateSessionStatus(sessionId, 'phase2');
      emitStatus(sessionId, 'phase2');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 2: Deep Research');
      try {
        await runPhase2(sessionId, session, isTimeUp);
      } catch (err: any) {
        if (err?.name === 'AbortError' || shouldStop(sessionId) || shouldPause(sessionId)) {
          emitLog(sessionId, '\u2139\uFE0F', 'Phase 2 stopped.');
        } else {
          console.error('[deepdive] Phase 2 error:', err);
          emitLog(sessionId, '\u26A0\uFE0F', `Phase 2 error: ${err.message ?? 'unknown'}. Continuing...`);
        }
      }
      if (await pauseIfAsked()) return;
      if (shouldSkipPhase(sessionId)) {
        emitLog(sessionId, '\u2139\uFE0F', 'Skipping to next phase...');
      }
    }

    // Phase 3
    if (startAt <= 2 && !shouldStop(sessionId)) {
      currentPhase = 'phase3';
      skipSignals.delete(sessionId);
      startPhase('phase3');
      await updateSessionStatus(sessionId, 'phase3');
      emitStatus(sessionId, 'phase3');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 3: Red Teaming');
      try {
        await runPhase3(sessionId, session, isTimeUp);
      } catch (err: any) {
        if (err?.name === 'AbortError' || shouldStop(sessionId) || shouldPause(sessionId)) {
          emitLog(sessionId, '\u2139\uFE0F', 'Phase 3 stopped.');
        } else {
          console.error('[deepdive] Phase 3 error:', err);
          emitLog(sessionId, '\u26A0\uFE0F', `Phase 3 error: ${err.message ?? 'unknown'}. Continuing...`);
        }
      }
      if (await pauseIfAsked()) return;
    }

    // Post-processing. Not pausable: it is the step that turns everything
    // gathered into the report, it is short, and stopping halfway through would
    // leave a run with evidence and no answer.
    currentPhase = 'post_processing';
    startPhase('post');
    await updateSessionStatus(sessionId, 'post_processing');
    emitStatus(sessionId, 'post_processing');
    emitLog(sessionId, '\u2139\uFE0F', 'Starting post-processing');
    try {
      await runPostProcessing(sessionId, session, isTimeUp);
    } catch (err: any) {
      console.error('[deepdive] Post-processing error:', err);
      emitLog(sessionId, '\u26A0\uFE0F', `Post-processing error: ${err.message ?? 'unknown'}`);
    }

    // Cross-session entity linking. Skipped when the budget is spent — it is
    // useful housekeeping, not part of the answer, and it used to run
    // unconditionally after a run had already overshot.
    try {
      if (!budget.expired()) await linkSessionEntitiesToGlobal(sessionId);
    } catch (err: any) {
      console.error('[deepdive] Cross-session linking error:', err);
      emitLog(sessionId, '\u26A0\uFE0F', `Cross-session linking error: ${err.message ?? 'unknown'}`);
    }

    // Feed the finished research into the intel graph. Deep dive keeps its own
    // cross-session entity index (for dedup within research); this is the
    // separate step that puts the findings in front of the intel graph the rest
    // of jkai reasons over. One LLM call per completed session, on the report
    // digest rather than every fact.
    try {
      if (!budget.expired()) await extractResearchIntoIntel(sessionId);
    } catch (err: any) {
      console.error('[deepdive] Intel extraction error:', err);
    }

    // Complete
    await finish(sessionId, startTime, priorMs);
  } finally {
    // Ownership ends the moment the run does. `isRunning` reads this map to
    // answer "is this process working on the session", and leaving the entry
    // for another 30 seconds made a run that had just been paused look busy —
    // so resuming it immediately, which is the normal thing to do, was refused.
    abortControllers.delete(sessionId);
    // The rest lingers: a browser still has the stream open and should receive
    // the closing frames.
    setTimeout(() => {
      activeEmitters.delete(sessionId);
      stopSignals.delete(sessionId);
      skipSignals.delete(sessionId);
      pauseSignals.delete(sessionId);
      disposeArtefacts(sessionId);
    }, 30000);
  }
}
