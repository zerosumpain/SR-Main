import { EventEmitter } from 'events';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { SSEEvent, SessionStats, SessionStatus } from './types';
import { runPhase1 } from './phase1';
import { runPhase2 } from './phase2';
import { runPhase3 } from './phase3';
import { runPostProcessing } from './postprocess';
import { linkSessionEntitiesToGlobal } from './cross-session';
import { extractResearchIntoIntel } from './intel-bridge';
import { disposeArtefacts } from './desk-events';

// In-memory map of active session emitters
const activeEmitters = new Map<string, EventEmitter>();
const stopSignals = new Map<string, boolean>();
const skipSignals = new Map<string, boolean>();
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

async function updateSessionStatus(sessionId: string, status: SessionStatus): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (status === 'complete' || status === 'failed') {
    update.completedAt = new Date();
  }
  await db.update(researchSessions).set(update).where(eq(researchSessions.id, sessionId));
}

export async function startResearch(sessionId: string): Promise<void> {
  // Don't await — run in background
  runResearch(sessionId).catch((err) => {
    console.error(`[deepdive] Research failed for session ${sessionId}:`, err);
    emit(sessionId, { type: 'error', message: err.message });
    updateSessionStatus(sessionId, 'failed').catch(console.error);
  });
}

async function runResearch(sessionId: string): Promise<void> {
  const emitter = getEmitter(sessionId);
  const ac = new AbortController();
  abortControllers.set(sessionId, ac);

  try {
    // Load session
    const [session] = await db
      .select()
      .from(researchSessions)
      .where(eq(researchSessions.id, sessionId));

    if (!session) throw new Error('Session not found');

    const startTime = Date.now();
    const timeLimitMs = session.timeLimitMinutes
      ? session.timeLimitMinutes * 60 * 1000
      : null;

    function isTimeUp(): boolean {
      if (shouldStop(sessionId)) return true;
      if (shouldSkipPhase(sessionId)) return true;
      if (!timeLimitMs) return false;
      return Date.now() - startTime > timeLimitMs;
    }

    // Phase 1
    if (!shouldStop(sessionId)) {
      skipSignals.delete(sessionId);
      await updateSessionStatus(sessionId, 'phase1');
      emitStatus(sessionId, 'phase1');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 1: Lead Generation');
      try {
        await runPhase1(sessionId, session, isTimeUp);
      } catch (err: any) {
        if (err?.name === 'AbortError' || shouldStop(sessionId)) {
          emitLog(sessionId, '\u2139\uFE0F', 'Phase 1 stopped.');
        } else {
          console.error('[deepdive] Phase 1 error:', err);
          emitLog(sessionId, '\u26A0\uFE0F', `Phase 1 error: ${err.message ?? 'unknown'}. Continuing...`);
        }
      }
      if (shouldSkipPhase(sessionId)) {
        emitLog(sessionId, '\u2139\uFE0F', 'Skipping to next phase...');
      }
    }

    // Phase 2
    if (!shouldStop(sessionId)) {
      skipSignals.delete(sessionId);
      await updateSessionStatus(sessionId, 'phase2');
      emitStatus(sessionId, 'phase2');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 2: Deep Research');
      try {
        await runPhase2(sessionId, session, isTimeUp);
      } catch (err: any) {
        if (err?.name === 'AbortError' || shouldStop(sessionId)) {
          emitLog(sessionId, '\u2139\uFE0F', 'Phase 2 stopped.');
        } else {
          console.error('[deepdive] Phase 2 error:', err);
          emitLog(sessionId, '\u26A0\uFE0F', `Phase 2 error: ${err.message ?? 'unknown'}. Continuing...`);
        }
      }
      if (shouldSkipPhase(sessionId)) {
        emitLog(sessionId, '\u2139\uFE0F', 'Skipping to next phase...');
      }
    }

    // Phase 3
    if (!shouldStop(sessionId)) {
      skipSignals.delete(sessionId);
      await updateSessionStatus(sessionId, 'phase3');
      emitStatus(sessionId, 'phase3');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 3: Red Teaming');
      try {
        await runPhase3(sessionId, session, isTimeUp);
      } catch (err: any) {
        if (err?.name === 'AbortError' || shouldStop(sessionId)) {
          emitLog(sessionId, '\u2139\uFE0F', 'Phase 3 stopped.');
        } else {
          console.error('[deepdive] Phase 3 error:', err);
          emitLog(sessionId, '\u26A0\uFE0F', `Phase 3 error: ${err.message ?? 'unknown'}. Continuing...`);
        }
      }
    }

    // Post-processing
    await updateSessionStatus(sessionId, 'post_processing');
    emitStatus(sessionId, 'post_processing');
    emitLog(sessionId, '\u2139\uFE0F', 'Starting post-processing');
    try {
      await runPostProcessing(sessionId, session);
    } catch (err: any) {
      console.error('[deepdive] Post-processing error:', err);
      emitLog(sessionId, '\u26A0\uFE0F', `Post-processing error: ${err.message ?? 'unknown'}`);
    }

    // Cross-session entity linking
    try {
      await linkSessionEntitiesToGlobal(sessionId);
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
      await extractResearchIntoIntel(sessionId);
    } catch (err: any) {
      console.error('[deepdive] Intel extraction error:', err);
    }

    // Complete
    await updateSessionStatus(sessionId, 'complete');
    emitStatus(sessionId, 'complete');
    emitLog(sessionId, '\u2139\uFE0F', 'Research complete!');
  } finally {
    // Cleanup
    setTimeout(() => {
      activeEmitters.delete(sessionId);
      stopSignals.delete(sessionId);
      skipSignals.delete(sessionId);
      abortControllers.delete(sessionId);
      disposeArtefacts(sessionId);
    }, 30000);
  }
}
