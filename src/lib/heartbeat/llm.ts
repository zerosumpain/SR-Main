import { db } from '$lib/db';
import { conversations, orchestratorChats } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { resolveHeartbeatModel } from '$lib/server/models/workload-settings';
import { coerceModelContext } from '$lib/constants/default-models';
import type { ModelContext } from '$lib/server/models/types';
import { notifySubscribers } from '$lib/jkai/chat/followup-queue';
import { normaliseConversationId } from '$lib/jkai/conversation-id';
import { assertOwnerThread } from '$lib/jkai/owner-threads';
import { chatTurn, isCoreUnreachable } from '$lib/jkai/chat/turn';
import { assistantTurnMetadata } from '$lib/jkai/chat/turn-metadata';

export interface RunHeartbeatTurnOpts {
  conversationId: string;
  userText: string;
  maxTokens?: number;
  model?: ModelContext;
  activityName: string;
  instruction: string;
  /**
   * If true, the turn is offered the background-task toolsets (follow-ups,
   * heartbeat, schedule) and home, and may call them. Used by
   * orchestrator-turn callbacks (where the agent might need to actually do
   * something, e.g. turn off lights). Off for cheap watcher pulses.
   */
  toolsEnabled?: boolean;
}

export interface HeartbeatTurnResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
  messageId: string;
  /** Names of any tools the LLM called during this turn (not reported by Core; empty). */
  toolsCalled: string[];
}

/**
 * Core could not be reached, so the turn did not run and nothing was written.
 * The caller tries again on its next tick; a heartbeat is never answered by a
 * generic persona standing in for jkai.
 */
export class HeartbeatSkipped extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeartbeatSkipped';
  }
}

/** Tool rounds a tooled heartbeat turn may take, plus the final reply. */
const MAX_TOOL_ROUNDS = 3;
/** The toolsets a tooled turn is offered. Home on purpose: "lights off at 11". */
const HEARTBEAT_TOOLSETS = ['followups', 'heartbeat', 'schedule', 'home'] as const;

/**
 * The names a tooled heartbeat turn offers, and so the only names it may run.
 * Core gets them as the turn's `toolWhitelist`, carries them on the sealed
 * principal (`allowedTools`), and Main's `executeTool` holds the call to them:
 * the home tools (mutates) run because they are listed; nothing destructive,
 * no build, no mail can.
 */
export async function heartbeatToolNames(): Promise<string[]> {
  const { getToolsetDefinitions } = await import('$lib/tools/llm-tools');
  const names = new Set<string>();
  for (const toolset of HEARTBEAT_TOOLSETS) {
    try {
      for (const t of await getToolsetDefinitions(toolset)) names.add(t.function.name);
    } catch {
      /* a toolset may not exist in dev (home without Home Assistant) */
    }
  }
  return [...names];
}

/**
 * Run one heartbeat turn in an existing conversation, as jkai.
 *
 * Slice 9: the turn is a chat turn run by SR-Jkai-Core (`chatTurn`, surface
 * 'heartbeat'), so it has the soul, the owner facts, memory and the heartbeat
 * overlay (the NEEDS-USER: rule lives there), on the unattended `heartbeat`
 * principal. It used to build its own "heartbeat-driven assistant" prompt and
 * tool loop here. The cost is tagged `heartbeat` by Core (`options.activity`).
 *
 * Main still writes both rows, stamped `metadata.heartbeat` (so the UI styles
 * them) and `metadata.channel: 'heartbeat'`. Nothing is written until Core has
 * answered: if Core is down the turn throws `HeartbeatSkipped` and the thread
 * is untouched.
 *
 * NOT TO BE RELEASED WHILE JOHN IS TRAVELLING (Rome, until 30 Oct 2026): a
 * heartbeat that misbehaves acts in his threads and his home unattended.
 */
export async function runHeartbeatTurn(opts: RunHeartbeatTurnOpts): Promise<HeartbeatTurnResult> {
  // Belt and braces: callers should hand us a bare uuid, but a `chat_`-prefixed
  // id here reads as "conversation not found" and writes here are rejected
  // outright by orchestrator_chats' FK. Normalise so no caller can reintroduce it.
  const conversationId = normaliseConversationId(opts.conversationId);
  const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conv) throw new Error(`conversation ${conversationId} not found`);
  // A heartbeat turn runs with the owner's tools and memory: never in a
  // member's thread, whoever scheduled it.
  if (conv.principalId !== 'owner') throw new Error(`conversation ${conversationId} is not the owner's — heartbeat turn refused`);

  const modelContext = opts.model ?? (
    conv.modelProvider && conv.modelId
      ? coerceModelContext({ provider: conv.modelProvider, modelId: conv.modelId })
      : await resolveHeartbeatModel()
  );

  // Newest 40, restored to chronological order. This was `asc(...).limit(40)`,
  // i.e. the OLDEST 40 — so on any thread longer than the window the heartbeat
  // reasoned over the opening of the conversation and none of the recent work,
  // which is exactly the long autonomous session it exists to report on.
  const history = (
    await db
      .select()
      .from(orchestratorChats)
      .where(eq(orchestratorChats.conversationId, conversationId))
      .orderBy(desc(orchestratorChats.createdAt))
      .limit(40)
  ).reverse();

  // `[]` is "no tools", which Core honours; a tool-less pulse offers nothing.
  const offered = opts.toolsEnabled ? await heartbeatToolNames() : [];
  // The caller's instruction is this turn's, so it rides with the message;
  // the persona and the NEEDS-USER: rule come from Core's heartbeat overlay.
  const text = opts.instruction.trim()
    ? `${opts.userText}\n\n[Heartbeat instruction] ${opts.instruction.trim()}`
    : opts.userText;

  let turn: Awaited<ReturnType<typeof chatTurn>>;
  try {
    turn = await chatTurn(
      { text },
      history.map((m) => ({ role: m.role, content: m.content, createdAt: m.createdAt })),
      {
        conversationId,
        modelContext,
        priceSnapshot: null,
        toolWhitelist: offered,
        maxRounds: opts.toolsEnabled ? MAX_TOOL_ROUNDS + 1 : 1,
        envelope: { surface: 'heartbeat' },
        activity: 'heartbeat',
      },
    );
  } catch (err) {
    if (isCoreUnreachable(err)) {
      throw new HeartbeatSkipped(`jkai core unreachable, heartbeat turn skipped: ${err instanceof Error ? err.message : err}`);
    }
    throw err;
  }
  const finalReply = turn.response.trim();

  const [userMsg] = await db
    .insert(orchestratorChats)
    .values({
      conversationId,
      role: 'user',
      content: opts.userText,
      metadata: { heartbeat: { activity: opts.activityName, kind: 'user-trigger' }, channel: 'heartbeat' },
    })
    .returning({ id: orchestratorChats.id });

  const [asstMsg] = await db
    .insert(orchestratorChats)
    .values({
      conversationId,
      role: 'assistant',
      content: finalReply || '(empty heartbeat reply)',
      metadata: {
        ...assistantTurnMetadata(turn, 'heartbeat'),
        heartbeat: {
          activity: opts.activityName,
          kind: 'reply',
          replyToHeartbeatMessageId: userMsg.id,
        },
      },
    })
    .returning({ id: orchestratorChats.id });

  // Push the reply onto the live SSE stream so an open /jkai chat session
  // sees the progress note in real time. Without this the message only
  // appears on next page reload, which is what the user means by "the pulse
  // didn't keep me posted with the build progress".
  notifySubscribers(conversationId, {
    role: 'assistant',
    content: finalReply || '(empty heartbeat reply)',
    source: 'followup',
    // Same metadata the row carries, so the live frame and the reloaded row
    // render identically.
    metadata: { heartbeat: { activity: opts.activityName, kind: 'reply' } },
  });

  // Tokens are Core's to count: the turn's spend is in the ledger under
  // `heartbeat`, beside every other chat turn.
  return { reply: finalReply, promptTokens: 0, completionTokens: 0, messageId: asstMsg.id, toolsCalled: [] };
}

/**
 * Insert a system-style note into a conversation without calling the LLM.
 * Used for cheap "still working" / "paused N min ago" status nudges that
 * don't justify an LLM round.
 */
export async function postHeartbeatNote(opts: {
  conversationId: string;
  text: string;
  activityName: string;
}): Promise<{ messageId: string }> {
  // Same normalisation as runHeartbeatTurn: a `chat_`-prefixed id here is an
  // FK violation on insert, and the SSE registry is keyed on the bare uuid too,
  // so the note would miss both the durable and the live channel.
  const conversationId = normaliseConversationId(opts.conversationId);
  // Background notes land in the owner's threads only.
  await assertOwnerThread(conversationId, 'heartbeat note');
  const [row] = await db
    .insert(orchestratorChats)
    .values({
      conversationId,
      role: 'assistant',
      content: opts.text,
      metadata: { heartbeat: { activity: opts.activityName, kind: 'note' } },
    })
    .returning({ id: orchestratorChats.id });
  // Live SSE push (same reason as the LLM-reply path above).
  notifySubscribers(conversationId, {
    role: 'assistant',
    content: opts.text,
    source: 'followup',
    metadata: { heartbeat: { activity: opts.activityName, kind: 'note' } },
  });
  return { messageId: row.id };
}
