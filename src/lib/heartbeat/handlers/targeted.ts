import { runHeartbeatTurn, postHeartbeatNote } from '../llm';
import type { ActivityResult } from '../types';
import type { HeartbeatAction } from '$lib/db/schema';
import { db } from '$lib/db';
import { conversations, jkaiBuilds, researchSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getModelDefaultPrice, costFromUsage } from '../cost';

/**
 * Pull the current state of the watched task from the DB and format it as
 * a system-context block to be prepended to the action's prompt. Lets the
 * LLM running the heartbeat see actual values without needing tool calls.
 */
async function buildTaskStateContext(action: HeartbeatAction): Promise<string | null> {
  const config = (action.config as { taskKind?: string; taskId?: string } | null) ?? {};
  if (!config.taskKind || !config.taskId) return null;
  if (config.taskKind === 'build') {
    const [b] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, config.taskId)).limit(1);
    if (!b) return `(build ${config.taskId} not found)`;
    return [
      `LATEST BUILD STATE`,
      `  id:                ${b.id}`,
      `  status:            ${b.status}`,
      `  iterations done:   ${b.iterationsCompleted}`,
      `  active minutes:    ${b.activeMinutesUsed?.toFixed?.(1) ?? b.activeMinutesUsed}`,
      `  cost so far:       $${b.costUsd}`,
      `  consecutive fails: ${b.consecutiveFailures}`,
      `  updated_at:        ${b.updatedAt}`,
      b.failure ? `  failure:           ${JSON.stringify(b.failure).slice(0, 200)}` : '',
      b.publishedSlug ? `  published:         /${b.publishedSlug}` : '',
    ].filter(Boolean).join('\n');
  }
  if (config.taskKind === 'research') {
    const [r] = await db.select().from(researchSessions).where(eq(researchSessions.id, config.taskId)).limit(1);
    if (!r) return `(research ${config.taskId} not found)`;
    return [
      `LATEST RESEARCH STATE`,
      `  id:      ${r.id}`,
      `  status:  ${(r as { status?: string }).status ?? '(unknown)'}`,
      `  topic:   ${(r as { topic?: string }).topic?.slice(0, 80) ?? ''}`,
      `  updated: ${(r as { updatedAt?: unknown }).updatedAt ?? ''}`,
    ].join('\n');
  }
  return null;
}

/**
 * Run one tick of a 'targeted' action: load the conversation history, run a
 * focused LLM turn with the action's prompt + goal, persist user-trigger +
 * assistant reply, and parse the reply for a "DONE: " prefix.
 *
 * The orchestrator (or the user) registered this action with a goal; on
 * each tick the LLM is asked to make one step toward the goal or declare
 * the goal met. There is no retry limit — actions run forever until they
 * mark themselves done.
 */
export async function runTargetedAction(action: HeartbeatAction): Promise<ActivityResult> {
  if (!action.conversationId) {
    return { outcome: 'error', summary: 'targeted action missing conversation_id' };
  }
  if (!action.prompt) {
    return { outcome: 'error', summary: 'targeted action missing prompt' };
  }

  const [conv] = await db
    .select({
      modelProvider: conversations.modelProvider,
      modelId: conversations.modelId,
      priceSnapshot: conversations.priceSnapshot,
    })
    .from(conversations)
    .where(eq(conversations.id, action.conversationId))
    .limit(1);
  if (!conv) {
    return { outcome: 'error', summary: 'conversation not found — pausing action' };
  }

  const goal = action.goal?.trim() || '(no goal set — continue indefinitely until removed by orchestrator)';
  const taskState = await buildTaskStateContext(action);

  const instruction =
    `You are running on heartbeat for action "${action.name}".\n\n` +
    (taskState ? `${taskState}\n\n` : '') +
    `GOAL: ${goal}\n\n` +
    `On each tick (this is run #${(action.totalRuns ?? 0) + 1}), do exactly one of:\n` +
    `  • If the goal is now met, reply starting with "DONE: " followed by a one-sentence outcome. The action is removed from the queue.\n` +
    `  • Otherwise take one concrete step. Be specific — "still waiting" is only acceptable if you can describe what you're waiting on.\n\n` +
    `Be terse. ≤80 words for status updates, ≤30 words for DONE replies.`;

  const turn = await runHeartbeatTurn({
    conversationId: action.conversationId,
    userText: `[heartbeat:${action.name}] ${action.prompt}`,
    activityName: action.name,
    instruction,
    maxTokens: 700,
  });

  const reply = turn.reply.trim();
  const markDone = /^DONE:\s*/i.test(reply);

  // Cost estimate. Prefer the conversation's pinned priceSnapshot (only set
  // for openrouter); otherwise fall back to the model-default table.
  const snapshot = conv.priceSnapshot as { promptPrice: number; completionPrice: number } | null;
  const price = snapshot ?? getModelDefaultPrice(conv.modelId);
  const costUsd = costFromUsage(price, turn.promptTokens, turn.completionTokens);

  return {
    outcome: markDone ? 'completed' : 'fired',
    summary: reply.slice(0, 200),
    details: {
      reply,
      tokens: { prompt: turn.promptTokens, completion: turn.completionTokens },
      model: `${conv.modelProvider}:${conv.modelId}`,
      runNumber: (action.totalRuns ?? 0) + 1,
    },
    conversationId: action.conversationId,
    costUsd,
    markDone,
  };
}
