import { EventEmitter } from 'events';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { SSEEvent, SessionStats, SessionStatus } from './types';
import { runPhase1 } from './phase1';
import { runPhase2 } from './phase2';
import { runPhase3 } from './phase3';
import { runPostProcessing } from './postprocess';

// In-memory map of active session emitters
const activeEmitters = new Map<string, EventEmitter>();
const stopSignals = new Map<string, boolean>();

export function getEmitter(sessionId: string): EventEmitter {
  let emitter = activeEmitters.get(sessionId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(20);
    activeEmitters.set(sessionId, emitter);
  }
  return emitter;
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

export function requestStop(sessionId: string): void {
  stopSignals.set(sessionId, true);
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
      if (!timeLimitMs) return false;
      return Date.now() - startTime > timeLimitMs;
    }

    // Phase 1
    if (!shouldStop(sessionId)) {
      await updateSessionStatus(sessionId, 'phase1');
      emitStatus(sessionId, 'phase1');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 1: Lead Generation');
      await runPhase1(sessionId, session, isTimeUp);
    }

    // Phase 2
    if (!shouldStop(sessionId)) {
      await updateSessionStatus(sessionId, 'phase2');
      emitStatus(sessionId, 'phase2');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 2: Deep Research');
      await runPhase2(sessionId, session, isTimeUp);
    }

    // Phase 3
    if (!shouldStop(sessionId)) {
      await updateSessionStatus(sessionId, 'phase3');
      emitStatus(sessionId, 'phase3');
      emitLog(sessionId, '\u{1F50D}', 'Starting Phase 3: Red Teaming');
      await runPhase3(sessionId, session, isTimeUp);
    }

    // Post-processing
    await updateSessionStatus(sessionId, 'post_processing');
    emitStatus(sessionId, 'post_processing');
    emitLog(sessionId, '\u2139\uFE0F', 'Starting post-processing');
    await runPostProcessing(sessionId, session);

    // Complete
    await updateSessionStatus(sessionId, 'complete');
    emitStatus(sessionId, 'complete');
    emitLog(sessionId, '\u2139\uFE0F', 'Research complete!');
  } finally {
    // Cleanup
    setTimeout(() => {
      activeEmitters.delete(sessionId);
      stopSignals.delete(sessionId);
    }, 30000);
  }
}
