import { runHeartbeatTurn, postHeartbeatNote } from '../llm';
import type { ActivityResult } from '../types';
import type { HeartbeatAction } from '$lib/db/schema';
import { db } from '$lib/db';
import { conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getModelDefaultPrice, costFromUsage } from '../cost';
import { getTaskStateProvider, type TaskStateSnapshot } from '../state-providers';

/**
 * Pull the current state of the watched task using its kind-registered
 * state provider. Lets the LLM running the heartbeat see actual values
 * without needing tool calls. Returns null when the action has no task
 * binding or the kind is unknown.
 */
async function buildTaskStateContext(action: HeartbeatAction): Promise<TaskStateSnapshot | null> {
  const config = (action.config as { taskKind?: string; taskId?: string } | null) ?? {};
  if (!config.taskKind || !config.taskId) return null;
  const provider = getTaskStateProvider(config.taskKind);
  if (!provider) return { contextBlock: `(no state provider registered for kind '${config.taskKind}')`, terminal: false };
  return provider(config.taskId);
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
  const terminalHint = taskState?.terminal
    ? `THE TASK HAS REACHED A TERMINAL STATE. You MUST reply with "DONE: <one-sentence summary>" — no other output.\n\n`
    : '';

  const instruction =
    `You are running on heartbeat for action "${action.name}".\n\n` +
    (taskState ? `${taskState.contextBlock}\n\n` : '') +
    terminalHint +
    `GOAL: ${goal}\n\n` +
    `On each tick (this is run #${(action.totalRuns ?? 0) + 1}), do exactly one of:\n` +
    `  • If the goal is now met (or the live state above shows a terminal status), reply starting with "DONE: " followed by a one-sentence outcome. The action is removed from the queue.\n` +
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
