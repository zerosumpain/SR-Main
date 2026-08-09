import { postHeartbeatNote } from '../llm';
import type { ActivityResult } from '../types';
import type { HeartbeatAction } from '$lib/db/schema';
import { db } from '$lib/db';
import { conversations, heartbeatPulses } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getTaskStateProvider, type TaskStateSnapshot } from '../state-providers';
import { normaliseConversationId } from '$lib/jkai/conversation-id';

/**
 * Pull the current state of the watched task using its kind-registered
 * state provider. Returns null when the action has no task binding or the
 * kind is unknown.
 */
async function buildTaskState(action: HeartbeatAction): Promise<TaskStateSnapshot | null> {
  const config = (action.config as { taskKind?: string; taskId?: string } | null) ?? {};
  if (!config.taskKind || !config.taskId) return null;
  const provider = getTaskStateProvider(config.taskKind);
  if (!provider) return { contextBlock: `(no state provider registered for kind '${config.taskKind}')`, terminal: false };
  return provider(config.taskId);
}

/** Minutes since the watch was registered, rounded so the line changes slowly. */
function elapsedLabel(since: Date, now: Date, granularityMin: number): string {
  const mins = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (mins < granularityMin) return 'just started';
  const rounded = Math.floor(mins / granularityMin) * granularityMin;
  if (rounded < 60) return `${rounded} min`;
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Run one tick of a 'targeted' action.
 *
 * This used to run a second LLM against the Postgres transcript. That agent
 * was not the one in the chat — Hermes never saw a single beat, and the beat
 * never saw Hermes' tools or session — so the two contradicted each other in
 * the same thread (one beat announced "this session no longer exposes
 * build_inspect" ten minutes before Hermes used build_inspect). With no way to
 * observe the work it could only narrate, which is a fabrication surface on a
 * 30-second timer.
 *
 * So a beat is now a fact, not an opinion: the watched task's live state,
 * rendered as a status line, posted only when it says something new. No second
 * agent, no cost, nothing to hallucinate. When the task settles, the watch
 * reports the outcome once and retires itself.
 */
export async function runTargetedAction(action: HeartbeatAction): Promise<ActivityResult> {
  if (!action.conversationId) {
    return { outcome: 'error', summary: 'targeted action missing conversation_id' };
  }

  // Rows written before registration normalised the id still carry Hermes'
  // `chat_<uuid>` form. Normalise on read so they resolve instead of erroring
  // on every tick forever.
  const conversationId = normaliseConversationId(action.conversationId);
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!conv) {
    // Say what actually happened. The old text claimed the action was being
    // paused; nothing paused it, and the same string covered both a bad id and
    // a deleted conversation. The failure budget in audit.ts pauses it now.
    return { outcome: 'error', summary: `conversation ${conversationId} not found` };
  }

  const now = new Date();
  const label = action.goal?.trim() || action.description || action.name;
  const state = await buildTaskState(action);

  let line: string;
  let terminal = false;
  if (state) {
    terminal = state.terminal;
    line = terminal
      ? `✓ ${label} — ${state.summary ?? 'finished'}`
      : `${label} — ${state.summary ?? 'running'}`;
  } else {
    // No task binding, so there is nothing factual to report beyond how long
    // we have been watching. Say exactly that rather than inventing progress.
    // The 5-minute granularity is what paces the posts: the line only changes
    // when the rounded elapsed time does.
    line = `${label} — still watching (${elapsedLabel(action.createdAt, now, 5)})`;
  }
  const summary = line.slice(0, 200);

  // Don't repeat ourselves. A watch that has nothing new to say should be
  // silent, not chatty — repeated near-identical notes are what got heartbeat
  // output collapsed out of the thread in the first place.
  const [lastFired] = await db
    .select({ summary: heartbeatPulses.summary })
    .from(heartbeatPulses)
    .where(and(eq(heartbeatPulses.actionId, action.id), eq(heartbeatPulses.outcome, 'fired')))
    .orderBy(desc(heartbeatPulses.ts))
    .limit(1);
  const unchanged = lastFired?.summary === summary;

  if (unchanged && !terminal) {
    return {
      outcome: 'ok',
      summary: `no change — ${summary}`,
      conversationId,
      details: { suppressed: true, taskBound: !!state },
    };
  }

  await postHeartbeatNote({ conversationId, text: line, activityName: action.name });

  return {
    outcome: terminal ? 'completed' : 'fired',
    summary,
    details: {
      line,
      taskBound: !!state,
      terminal,
      runNumber: (action.totalRuns ?? 0) + 1,
    },
    conversationId,
    costUsd: 0,
    markDone: terminal,
  };
}
