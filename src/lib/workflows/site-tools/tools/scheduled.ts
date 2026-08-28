// LLM-callable tools for the scheduled-callbacks lane.
//
// This is the OpenClaw "cron lane": one-shot time-based fires. Distinct
// from the heartbeat lane (periodic agent turns) and from background
// tasks (long-running watched work).
//
// Use these tools when:
//   • The user asks for something to happen at a specific time ("turn the
//     lights off in 90 seconds", "remind me at 5pm to check the dishwasher").
//   • You want to defer a single action without polling — you know exactly
//     when it should fire.
//   • A direct tool call should run later with no LLM round in between.
//
// Three callback kinds:
//   reply              — post a fixed message into the conversation
//   tool               — call a specific site-tool with given args (no LLM)
//   orchestrator-turn  — re-engage the conversation with a synthetic user
//                        message; the LLM will respond as if the user wrote it

import { register, type ToolExecContext } from '../registry-internal';
import { requiredString, optionalString } from '../tool-args';
import { normaliseConversationId } from '$lib/jkai/conversation-id';
import { db } from '$lib/db';
import { scheduledCallbacks, conversations } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Which conversation a callback belongs to — asked of the runtime, not the model.
 *
 * `conversation_id` used to be a REQUIRED argument on the reply and
 * orchestrator-turn tools. Nothing tells a chat its own id, so over WhatsApp on
 * 2026-08-28 the model answered "Remind me in 3 minutes" by inventing one:
 * `07767f2e-…`, a row that has never existed. The tool returned success, the
 * assistant said "Done.", and three minutes later the fire died on the
 * `orchestrator_chats.conversation_id` foreign key. Nothing surfaced it — a
 * failed callback tells nobody, so the reminder simply never arrived and the
 * user had every reason to believe it would.
 *
 * Two rules follow. Default from `ctx.conversationId`, which the chat loop has
 * always known; and CONFIRM the row exists here, where the model can still be
 * told it got it wrong, rather than at fire time when nobody is listening.
 */
async function resolveConversation(
  args: Record<string, unknown>,
  ctx: ToolExecContext | undefined,
  opts: { required: boolean },
): Promise<
  | { ok: true; id: string | null; whatsappPhoneNumber: string | null }
  | { ok: false; error: string }
> {
  const explicit = optionalString(args, 'conversation_id');
  const raw = explicit || ctx?.conversationId || '';
  if (!raw) {
    if (!opts.required) return { ok: true, id: null, whatsappPhoneNumber: null };
    return {
      ok: false,
      error:
        'No conversation to deliver into: none was passed and this caller has no chat context. ' +
        'Do not invent a conversation_id — a callback pointing at a conversation that does not ' +
        'exist is accepted here and then fails silently when it fires.',
    };
  }
  const id = normaliseConversationId(raw);
  const [row] = await db
    .select({ id: conversations.id, phone: conversations.whatsappPhoneNumber })
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);
  if (!row) {
    return {
      ok: false,
      error:
        `No conversation ${id} exists, so a callback delivered there would fail at fire time ` +
        `with nobody watching. Omit conversation_id and it defaults to the current chat.`,
    };
  }
  return { ok: true, id: row.id, whatsappPhoneNumber: row.phone };
}

function parseFireAt(args: Record<string, unknown>): Date | null {
  if (typeof args.fire_at_iso === 'string') {
    const d = new Date(args.fire_at_iso);
    if (!isNaN(d.getTime())) return d;
  }
  if (typeof args.in_seconds === 'number' && Number.isFinite(args.in_seconds)) {
    return new Date(Date.now() + Math.max(0, Math.round(args.in_seconds * 1000)));
  }
  return null;
}

register({
  name: 'schedule_reply_at',
  description:
    'Schedule a fixed text reply to land in this conversation at a specific time. No LLM round at fire time — the message you provide is what gets posted. Use for simple time-based notifications: "remind me to leave at 17:30", "ping me in 90 seconds".',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'Conversation to deliver into. OMIT IT — it defaults to the current chat. Never guess a value.' },
      name: { type: 'string', description: 'DISTINCT identifier for this callback, specific to what it is about (e.g. "claude-renewal-sep-9", not "reminder"). A name already in use by a pending callback is REFUSED — two reminders sharing one name would collapse into one.' },
      text: { type: 'string', description: 'The exact text to post. ≤4000 chars.' },
      fire_at_iso: { type: 'string', description: 'ISO-8601 wall-clock time to fire (e.g. "2026-05-06T17:30:00Z"). Use this OR in_seconds.' },
      in_seconds: { type: 'number', description: 'Fire this many seconds from now. Use this OR fire_at_iso.' },
      replace_existing: { type: 'boolean', description: 'Only when you mean to MOVE or rewrite the existing callback of this name. Never set it to work around a name clash between two different reminders — pick a distinct name instead.' },
      notify_whatsapp: { type: 'boolean', description: 'Push via WhatsApp as well as posting into the chat. Defaults to TRUE for a WhatsApp conversation — a reminder asked for on WhatsApp has to arrive there.' },
    },
    required: ['name', 'text'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args, ctx) => {
    const fireAt = parseFireAt(args);
    if (!fireAt) return { success: false, error: 'must provide fire_at_iso or in_seconds' };
    const textArg = requiredString(args, 'text');
    if (!textArg.ok) return { success: false, error: textArg.error };
    const nameArg = requiredString(args, 'name');
    if (!nameArg.ok) return { success: false, error: nameArg.error };
    const conv = await resolveConversation(args, ctx, { required: true });
    if (!conv.ok) return { success: false, error: conv.error };
    const text = textArg.value.slice(0, 4000);
    const name = nameArg.value;
    const conversationId = conv.id;
    // A reply posted into a WhatsApp conversation is invisible unless it is
    // also pushed: the chat row lands in the DB and the phone stays silent.
    // So the default follows the conversation, not the model's omission.
    const notifyWhatsApp =
      typeof args.notify_whatsapp === 'boolean' ? args.notify_whatsapp : !!conv.whatsappPhoneNumber;

    return upsertCallback({
      name,
      description: `Scheduled reply (${text.slice(0, 60)}…)`,
      kind: 'reply',
      conversationId,
      payload: { text, notifyWhatsApp },
      fireAt,
      replaceExisting: args.replace_existing === true,
    });
  },
});

register({
  name: 'schedule_tool_call_at',
  description:
    'Schedule a direct call to a registered site-tool at a specific time. No LLM round at fire time — the tool runs with the args you provide right now. Use for deferred actions: "turn off the lights in 90 seconds", "send an email at 9am".',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'Conversation to notify when the tool fires. OMIT IT — it defaults to the current chat. Never guess a value.' },
      name: { type: 'string', description: 'DISTINCT identifier, specific to what this call is about. A name already in use by a pending callback is REFUSED.' },
      tool_name: { type: 'string', description: 'Name of a registered site-tool (e.g. "ha_call_service", "blog_create_post").' },
      args: { type: 'object', description: 'Args object passed to the tool exactly as if it were called now.' },
      fire_at_iso: { type: 'string', description: 'ISO-8601 wall-clock time. Use this OR in_seconds.' },
      in_seconds: { type: 'number', description: 'Fire this many seconds from now.' },
      replace_existing: { type: 'boolean', description: 'Only when you mean to MOVE or rewrite the existing callback of this name. Never set it to work around a name clash between two different reminders — pick a distinct name instead.' },
    },
    required: ['name', 'tool_name', 'args'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args, ctx) => {
    const fireAt = parseFireAt(args);
    if (!fireAt) return { success: false, error: 'must provide fire_at_iso or in_seconds' };
    const toolNameArg = requiredString(args, 'tool_name');
    if (!toolNameArg.ok) return { success: false, error: toolNameArg.error };
    const toolName = toolNameArg.value;
    // Gate-bypass guard: a deferred call fires with no LLM round and no
    // confirmation UI, so it must not be allowed to run a destructive tool
    // behind the confirmation gate. Refuse to schedule those — the caller
    // should invoke them directly (so they can be confirmed) or defer a
    // reply / orchestrator-turn instead.
    const { getTool } = await import('../registry');
    if (getTool(toolName)?.destructive) {
      return {
        success: false,
        error: `Cannot defer "${toolName}" — it is a destructive action that must be confirmed at call time. Call it directly, or schedule a reply/orchestrator-turn instead.`,
      };
    }
    const toolArgs = (args.args as Record<string, unknown>) ?? {};
    const conv = await resolveConversation(args, ctx, { required: false });
    if (!conv.ok) return { success: false, error: conv.error };
    const conversationId = conv.id;
    const nameArg = requiredString(args, 'name');
    if (!nameArg.ok) return { success: false, error: nameArg.error };
    const name = nameArg.value;

    return upsertCallback({
      name,
      description: `Scheduled call ${toolName}`,
      kind: 'tool',
      conversationId,
      payload: { toolName, args: toolArgs },
      fireAt,
      replaceExisting: args.replace_existing === true,
    });
  },
});

register({
  name: 'schedule_orchestrator_turn_at',
  description:
    'Schedule a re-engagement of this conversation at a specific time. At fire time the LLM runs a focused turn with the synthetic user message you provide; this lets you say "in 30 seconds I want to re-think this with fresh context" without writing a fixed reply.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'Conversation to re-engage. OMIT IT — it defaults to the current chat. Never guess a value.' },
      name: { type: 'string', description: 'DISTINCT identifier, specific to what this turn is about. A name already in use by a pending callback is REFUSED.' },
      message: { type: 'string', description: 'The synthetic user message that triggers the LLM turn.' },
      fire_at_iso: { type: 'string', description: 'ISO-8601 wall-clock time. Use this OR in_seconds.' },
      in_seconds: { type: 'number', description: 'Fire this many seconds from now.' },
      replace_existing: { type: 'boolean', description: 'Only when you mean to MOVE or rewrite the existing callback of this name. Never set it to work around a name clash between two different reminders — pick a distinct name instead.' },
    },
    required: ['name', 'message'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args, ctx) => {
    const fireAt = parseFireAt(args);
    if (!fireAt) return { success: false, error: 'must provide fire_at_iso or in_seconds' };
    const messageArg = requiredString(args, 'message');
    if (!messageArg.ok) return { success: false, error: messageArg.error };
    const nameArg = requiredString(args, 'name');
    if (!nameArg.ok) return { success: false, error: nameArg.error };
    const conv = await resolveConversation(args, ctx, { required: true });
    if (!conv.ok) return { success: false, error: conv.error };
    const message = messageArg.value;
    const name = nameArg.value;
    const conversationId = conv.id;

    return upsertCallback({
      name,
      description: `Scheduled orchestrator turn (${message.slice(0, 60)}…)`,
      kind: 'orchestrator-turn',
      conversationId,
      payload: { message },
      fireAt,
      replaceExisting: args.replace_existing === true,
    });
  },
});

register({
  name: 'cancel_scheduled_callback',
  description: 'Cancel a pending scheduled callback by name. Already-fired callbacks are not affected.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args) => {
    const nameArg = requiredString(args, 'name');
    if (!nameArg.ok) return { success: false, error: nameArg.error };
    const name = nameArg.value;
    const [row] = await db
      .update(scheduledCallbacks)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(scheduledCallbacks.name, name))
      .returning();
    if (!row) return { success: false, error: `no scheduled callback named ${name}` };
    return { success: true, data: { id: row.id, name: row.name, status: row.status } };
  },
});

register({
  name: 'list_scheduled_callbacks',
  description: 'List pending scheduled callbacks, optionally filtered to one conversation.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'Limit to callbacks owned by this conversation.' },
      include_fired: { type: 'boolean', description: 'Include fired/failed/cancelled rows. Default false.' },
    },
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args) => {
    const includeFired = !!args.include_fired;
    const conversationId = args.conversation_id as string | undefined;
    const rows = await db.select().from(scheduledCallbacks);
    const filtered = rows.filter((r) => {
      if (conversationId && r.conversationId !== conversationId) return false;
      if (!includeFired && r.status !== 'pending') return false;
      return true;
    });
    return {
      success: true,
      data: {
        count: filtered.length,
        callbacks: filtered.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          status: r.status,
          fireAt: r.fireAt,
          conversationId: r.conversationId,
          source: r.source,
        })),
      },
    };
  },
});

async function upsertCallback(opts: {
  name: string;
  description: string;
  kind: 'reply' | 'tool' | 'orchestrator-turn';
  conversationId: string | null;
  payload: Record<string, unknown>;
  fireAt: Date;
  /** Caller states that replacing a still-pending callback of this name is intended. */
  replaceExisting?: boolean;
}) {
  const existing = await db.select().from(scheduledCallbacks).where(eq(scheduledCallbacks.name, opts.name)).limit(1);
  if (existing.length > 0) {
    // `name` is globally unique, and a match used to mean "update" unconditionally.
    // The name is invented by the model, so two unrelated reminders that happen to
    // land on the same generic word ("reminder") silently became ONE: the second
    // overwrote the first's text, time and conversation, and nobody was told the
    // first had stopped existing. That is the same silent-loss shape as the
    // conversation-id bug this file was fixed for.
    //
    // Both intents are real — "move my 5pm to 6pm" and "a second, different
    // reminder" — and only the caller knows which. So ask, rather than guess:
    // a LIVE row is refused unless replace_existing says otherwise. A spent row
    // (fired/failed/cancelled) cannot fire again, so reusing its name is
    // unambiguous and still just updates in place.
    const prior = existing[0] as { status?: string; fireAt?: Date | string };
    const live = prior.status === 'pending';
    if (live && !opts.replaceExisting) {
      const when = prior.fireAt instanceof Date ? prior.fireAt.toISOString() : String(prior.fireAt ?? 'unknown');
      return {
        success: false,
        error:
          `A callback named "${opts.name}" is already scheduled for ${when}. ` +
          `Pick a DISTINCT name if this is a separate reminder — reusing one replaces the other, ` +
          `and the first would never fire. ` +
          `If you really mean to move or rewrite that same reminder, call again with replace_existing: true.`,
      };
    }
    const [row] = await db.update(scheduledCallbacks).set({
      description: opts.description,
      kind: opts.kind,
      conversationId: opts.conversationId,
      payload: opts.payload,
      fireAt: opts.fireAt,
      status: 'pending',
      firedAt: null,
      error: null,
      updatedAt: new Date(),
      source: 'orchestrator',
    }).where(eq(scheduledCallbacks.name, opts.name)).returning();
    return { success: true, data: { id: row.id, name: row.name, fireAt: row.fireAt, updated: true } };
  }
  const [row] = await db.insert(scheduledCallbacks).values({
    name: opts.name,
    description: opts.description,
    kind: opts.kind,
    conversationId: opts.conversationId,
    payload: opts.payload,
    fireAt: opts.fireAt,
    status: 'pending',
    source: 'orchestrator',
  }).returning();
  return { success: true, data: { id: row.id, name: row.name, fireAt: row.fireAt, updated: false } };
}
