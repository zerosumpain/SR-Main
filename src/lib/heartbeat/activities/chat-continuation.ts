import { db } from '$lib/db';
import { orchestratorChats, heartbeatPulses } from '$lib/db/schema';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { listJobs } from '$lib/workflows/chat/job-store';
import { runHeartbeatTurn, postHeartbeatNote } from '../llm';
import type { ActivityHandler } from '../types';

const NAME = 'chat-continuation';

/** Patterns that indicate the assistant is asking the user for input. */
const QUESTION_PATTERNS: RegExp[] = [
  /\?\s*$/m,                                // ends with a question mark
  /\b(what|which|when|where|who|how|why)\b[^.!?\n]{0,80}\?/i,
  /\b(let me know|let me know if|please share|can you (tell|provide|share))\b/i,
];

/** Patterns indicating a benign pause the orchestrator can self-resume. */
const BENIGN_CONTINUATION_PATTERNS: RegExp[] = [
  /\b(should i|shall i|want me to)\s+(continue|proceed|carry on|keep going|go ahead)\b/i,
  /\b(i'?ll|i will|going to)\s+(wait|pause|hold)\b/i,
  /\b(ready|happy)\s+to\s+(continue|proceed|carry on)\b/i,
  /\bnext step\b[^.!?\n]{0,30}(\?|$)/im,
];

/** Patterns the orchestrator emits when it's blocked needing concrete user input. */
const BLOCKED_PATTERNS: RegExp[] = [
  /\b(needs|requires|need)\s+(additional|more|further)\s+(wiring|info|input|context|configuration)\b/i,
  /\bcannot proceed without\b/i,
  /\bplease (provide|share|specify|confirm|tell me)\b/i,
];

/** Patterns indicating the assistant is mid-task (subagent loop / streaming
 *  status / "still working" interleaves). These turns aren't paused — they're
 *  in the middle of a long-running iteration the user can see is progressing,
 *  so the heartbeat must not nudge them as if the orchestrator had stopped. */
const IN_PROGRESS_PATTERNS: RegExp[] = [
  /⏳\s*still working/i,
  /\biter(?:ation)?\s+\d+\s*\/\s*\d+\b/i,
  /\bwaiting for provider response\b/i,
  /\b(running|processing|generating|fetching|streaming)\b[^.\n!?]{0,80}(\.\.\.|…)\s*$/im,
];

interface CCConfig {
  /** Don't act on conversations whose last assistant message is older than this. */
  maxStaleMinutes?: number;
  /** Don't re-pulse the same conversation more than this often (minutes). */
  perConversationCooldownMinutes?: number;
  /** Cap for how many conversations one tick will touch. */
  maxConversationsPerTick?: number;
  /** Cap for total LLM continuations per conversation per 24h. */
  maxLlmContinuationsPer24h?: number;
  /** How many beats in a row before we stop nudging an unanswered thread. */
  maxConsecutiveBeats?: number;
}

const DEFAULTS: Required<CCConfig> = {
  maxStaleMinutes: 25,
  perConversationCooldownMinutes: 5,
  maxConversationsPerTick: 5,
  // Was 6, which one long self-improvement session exhausted by lunchtime —
  // after that every beat was the cap-nudge, so the thread went quiet exactly
  // when the work was longest. The escalating ladder below is the real brake.
  maxLlmContinuationsPer24h: 12,
  maxConsecutiveBeats: 6,
};

/**
 * Minutes to wait before beat N+1, indexed by how many beats already trail the
 * conversation. Previously there was no ladder: the handler refused outright to
 * act when the newest message was one of its own, so it could post exactly once
 * per user turn and then went silent until the user typed again. A mechanism
 * whose whole purpose is to speak when the user is silent was gated on the user
 * speaking.
 */
const BEAT_BACKOFF_MINUTES = [0, 3, 10, 20, 30, 45];

/**
 * Whether a conversation trailed by `beats` of our own output, whose newest
 * message is `ageMs` old, may be beaten into again.
 *
 * Pure so the ladder is testable — the behaviour it replaces (an unconditional
 * skip) had no test, which is how "posts once per user turn, then never again"
 * survived as long as it did.
 */
export function beatGate(opts: {
  beats: number;
  ageMs: number;
  maxConsecutiveBeats: number;
}): 'act' | 'backoff' | 'capped' {
  if (opts.beats <= 0) return 'act';
  if (opts.beats >= opts.maxConsecutiveBeats) return 'capped';
  const waitMs = (BEAT_BACKOFF_MINUTES[opts.beats] ?? 45) * 60_000;
  return opts.ageMs < waitMs ? 'backoff' : 'act';
}

/** A 'silent' pause this short almost always means the user is reading the
 *  assistant's reply. The user-trigger LLM call is expensive (~1500 prompt
 *  tokens) and the visible "[heartbeat] checking in…" turn-pair clutters the
 *  thread for no benefit. 6 minutes is the floor before we'll consider a
 *  closed-looking turn to be genuinely waiting. */
const SILENT_MIN_STALE_MS = 6 * 60_000;
/** Recent tool-step or token activity on a job for this conversation means
 *  Hermes is actively working in the background. Skip pulse even if the most
 *  recent SvelteKit chat job has finalised. */
const RECENT_ACTIVITY_WINDOW_MS = 90_000;

export function classify(content: string): 'benign' | 'blocked' | 'questioning' | 'silent' | 'in_progress' {
  if (IN_PROGRESS_PATTERNS.some((r) => r.test(content))) return 'in_progress';
  if (BLOCKED_PATTERNS.some((r) => r.test(content))) return 'blocked';
  if (BENIGN_CONTINUATION_PATTERNS.some((r) => r.test(content))) return 'benign';
  if (QUESTION_PATTERNS.some((r) => r.test(content))) return 'questioning';
  return 'silent';
}

export const chatContinuation: ActivityHandler = {
  name: NAME,
  description:
    'Detects paused conversations and either auto-continues benign pauses (LLM call) or posts a single nudge for genuine blocks. Skipped while a job is running for the same conversation.',
  defaultCadenceSeconds: 60,
  defaultEnabled: true,
  defaultActiveHours: { start: '07:00', end: '23:00', tz: 'Europe/London' },
  defaultConfig: DEFAULTS as unknown as Record<string, unknown>,

  async run(ctx) {
    const cfg = { ...DEFAULTS, ...(ctx.config as CCConfig) };
    const cutoffMin = Math.max(2, Math.floor(cfg.maxStaleMinutes / 12)); // assistant message must be at least this old
    const minStaleMs = 2 * 60_000;
    const maxStaleMs = cfg.maxStaleMinutes * 60_000;
    const cooldownMs = cfg.perConversationCooldownMinutes * 60_000;
    const now = ctx.now;

    // 1. Pull recent messages, group by conversation, keep the latest per
    //    conversation. Volume bound is "messages in the last 24h" — typically
    //    well under a few hundred — so JS-side grouping is fine.
    void cutoffMin; // not currently used; threshold enforced via minStaleMs below
    const recent = await db
      .select({
        msgId: orchestratorChats.id,
        convId: orchestratorChats.conversationId,
        role: orchestratorChats.role,
        content: orchestratorChats.content,
        metadata: orchestratorChats.metadata,
        createdAt: orchestratorChats.createdAt,
      })
      .from(orchestratorChats)
      .where(
        and(
          isNotNull(orchestratorChats.conversationId),
          gt(orchestratorChats.createdAt, new Date(now - 24 * 3600_000)),
        ),
      )
      .orderBy(desc(orchestratorChats.createdAt));

    type Latest = (typeof recent)[number];
    const latestByConv = new Map<string, Latest>();
    // How many of our own beats trail each conversation, newest-first. Drives
    // the backoff ladder; `recent` is already ordered desc.
    const consecutiveBeatsByConv = new Map<string, number>();
    const chainClosed = new Set<string>();
    for (const r of recent) {
      if (!r.convId) continue;
      if (!latestByConv.has(r.convId)) latestByConv.set(r.convId, r);
      if (!chainClosed.has(r.convId)) {
        const m = r.metadata as { heartbeat?: { activity?: string } } | null;
        if (m?.heartbeat?.activity === NAME) {
          consecutiveBeatsByConv.set(r.convId, (consecutiveBeatsByConv.get(r.convId) ?? 0) + 1);
        } else {
          chainClosed.add(r.convId);
        }
      }
    }
    const latest = Array.from(latestByConv.values()).filter((r) => r.role === 'assistant');

    if (latest.length === 0) {
      return { outcome: 'ok', summary: 'no paused conversations' };
    }

    // 2. Filter out conversations with an active job in the in-memory job-store.
    // We also treat *recently active* jobs (any status, lastEventAt within
    // RECENT_ACTIVITY_WINDOW_MS) as in-flight: Hermes may have finalised a
    // SvelteKit-side job while still iterating on a subagent internally, and
    // a flurry of tool-step events through the bus updates `lastEventAt`
    // even after the formal `status === 'running'` window ends.
    const allJobs = listJobs();
    const activeJobConvIds = new Set<string>();
    for (const j of allJobs) {
      if (!j.conversationId) continue;
      const isRunning = j.status === 'running';
      const isRecentlyActive = now - j.lastEventAt < RECENT_ACTIVITY_WINDOW_MS;
      if (isRunning || isRecentlyActive) activeJobConvIds.add(j.conversationId);
    }

    // 3. Filter out conversations we've already pulsed within the cooldown.
    const recentPulses = await db
      .select({ conversationId: heartbeatPulses.conversationId, ts: heartbeatPulses.ts })
      .from(heartbeatPulses)
      .where(
        and(
          isNotNull(heartbeatPulses.conversationId),
          gt(heartbeatPulses.ts, new Date(now - cooldownMs)),
        ),
      );
    const recentlyPulsed = new Set(recentPulses.map((p) => p.conversationId));

    // 4. Pulled the LLM-continuation 24h count too so we can rate-limit auto-continues.
    const llm24h = await db
      .select({ conversationId: heartbeatPulses.conversationId, c: sql<number>`count(*)::int` })
      .from(heartbeatPulses)
      .where(
        and(
          isNotNull(heartbeatPulses.conversationId),
          gt(heartbeatPulses.ts, new Date(now - 24 * 3600_000)),
          eq(heartbeatPulses.outcome, 'fired'),
        ),
      )
      .groupBy(heartbeatPulses.conversationId);
    const llmCountBy = new Map(llm24h.map((r) => [r.conversationId, r.c]));

    let actedCount = 0;
    const acted: Array<{ convId: string; mode: string; firstWords: string }> = [];
    const skippedReasons: Record<string, number> = {};

    for (const row of latest) {
      if (actedCount >= cfg.maxConversationsPerTick) break;
      if (!row.convId) continue;
      const convId = row.convId;
      const ageMs = now - new Date(row.createdAt).getTime();
      const beats = consecutiveBeatsByConv.get(convId) ?? 0;
      // A conversation we are actively beating into is not stale — each beat
      // is itself the newest message, so the plain 25-minute ceiling would
      // fire the moment the ladder widened past it.
      const staleCeilingMs = beats > 0 ? Math.max(maxStaleMs, 2 * 60 * 60_000) : maxStaleMs;
      if (ageMs > staleCeilingMs) { skippedReasons.tooStale = (skippedReasons.tooStale ?? 0) + 1; continue; }
      if (ageMs < minStaleMs) { skippedReasons.tooFresh = (skippedReasons.tooFresh ?? 0) + 1; continue; }
      if (activeJobConvIds.has(convId)) { skippedReasons.activeJob = (skippedReasons.activeJob ?? 0) + 1; continue; }
      if (recentlyPulsed.has(convId)) { skippedReasons.cooldown = (skippedReasons.cooldown ?? 0) + 1; continue; }
      // The latest message being one of our own beats used to end the matter
      // permanently. Now it just widens the interval, and we stop after
      // maxConsecutiveBeats so a dead thread still goes quiet.
      const gate = beatGate({ beats, ageMs, maxConsecutiveBeats: cfg.maxConsecutiveBeats });
      if (gate === 'capped') {
        skippedReasons.beatCapReached = (skippedReasons.beatCapReached ?? 0) + 1;
        continue;
      }
      if (gate === 'backoff') {
        skippedReasons.beatBackoff = (skippedReasons.beatBackoff ?? 0) + 1;
        continue;
      }

      const cls = classify(row.content);
      // Silent pauses need a longer reading window than question/blocked
      // nudges. If the user's been quiet for less than SILENT_MIN_STALE_MS,
      // they're almost certainly still reading the previous reply.
      if (cls === 'silent' && ageMs < SILENT_MIN_STALE_MS) {
        skippedReasons.silentTooFresh = (skippedReasons.silentTooFresh ?? 0) + 1;
        continue;
      }
      if (cls === 'in_progress') {
        skippedReasons.inProgress = (skippedReasons.inProgress ?? 0) + 1;
        continue;
      }
      try {
        if (cls === 'benign') {
          const usedLlm24h = llmCountBy.get(convId) ?? 0;
          if (usedLlm24h >= cfg.maxLlmContinuationsPer24h) {
            await postHeartbeatNote({
              conversationId: convId,
              text: "[heartbeat] hit auto-continuation cap for the day — reply when ready and I'll pick it back up.",
              activityName: NAME,
            });
            acted.push({ convId, mode: 'cap-nudge', firstWords: row.content.slice(0, 60) });
          } else {
            await runHeartbeatTurn({
              conversationId: convId,
              userText: '[heartbeat] continuing on your behalf — proceed with the next concrete step. If you genuinely need user input, prefix the reply with NEEDS-USER:',
              activityName: NAME,
              instruction:
                'You previously paused. Take one small step forward; do not summarise the whole task. ' +
                'If a tool is required, describe what you would do but do not invoke it (heartbeat turns have no tools).',
              maxTokens: 700,
            });
            acted.push({ convId, mode: 'auto-continue', firstWords: row.content.slice(0, 60) });
          }
        } else if (cls === 'questioning' || cls === 'blocked') {
          const minsAgo = Math.round(ageMs / 60_000);
          await postHeartbeatNote({
            conversationId: convId,
            text: `[heartbeat] orchestrator paused ${minsAgo} min ago — waiting on your reply.`,
            activityName: NAME,
          });
          acted.push({ convId, mode: 'nudge', firstWords: row.content.slice(0, 60) });
        } else {
          // Silent pause — model just stopped. Try a soft auto-continue.
          const usedLlm24h = llmCountBy.get(convId) ?? 0;
          if (usedLlm24h >= cfg.maxLlmContinuationsPer24h) {
            skippedReasons.llmCap = (skippedReasons.llmCap ?? 0) + 1;
            continue;
          }
          await runHeartbeatTurn({
            conversationId: convId,
            userText: '[heartbeat] checking in — anything more to do here, or have we landed?',
            activityName: NAME,
            instruction:
              'If the previous turn appears to have completed the task, reply briefly confirming completion. ' +
              'If there is a clear next step, take it.',
            maxTokens: 350,
          });
          acted.push({ convId, mode: 'soft-checkin', firstWords: row.content.slice(0, 60) });
        }
        actedCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[heartbeat] chat-continuation failed for conv ${convId}: ${msg}`);
        skippedReasons.error = (skippedReasons.error ?? 0) + 1;
      }
    }

    if (acted.length === 0) {
      return {
        outcome: 'ok',
        summary: `${latest.length} paused convs scanned, none actionable`,
        details: { skippedReasons },
      };
    }

    return {
      outcome: 'fired',
      summary: `${acted.length} action${acted.length === 1 ? '' : 's'}: ${acted.map((a) => a.mode).join(', ')}`,
      details: { acted, skippedReasons },
      // We can't attribute to one conversation when multiple were touched.
      conversationId: acted.length === 1 ? acted[0].convId : null,
    };
  },
};
