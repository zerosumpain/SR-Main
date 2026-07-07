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

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { scheduledCallbacks } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

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
      conversation_id: { type: 'string', description: 'The conversation that should receive the reply.' },
      name: { type: 'string', description: 'Stable, unique identifier for this callback (e.g. "leave-reminder-1730"). Reusing a name updates the existing callback.' },
      text: { type: 'string', description: 'The exact text to post. ≤4000 chars.' },
      fire_at_iso: { type: 'string', description: 'ISO-8601 wall-clock time to fire (e.g. "2026-05-06T17:30:00Z"). Use this OR in_seconds.' },
      in_seconds: { type: 'number', description: 'Fire this many seconds from now. Use this OR fire_at_iso.' },
      notify_whatsapp: { type: 'boolean', description: 'Also push via WhatsApp when the conversation has a phone number.' },
    },
    required: ['conversation_id', 'name', 'text'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args) => {
    const fireAt = parseFireAt(args);
    if (!fireAt) return { success: false, error: 'must provide fire_at_iso or in_seconds' };
    const text = String(args.text).slice(0, 4000);
    const name = String(args.name);
    const conversationId = String(args.conversation_id);
    const notifyWhatsApp = !!args.notify_whatsapp;

    return upsertCallback({
      name,
      description: `Scheduled reply (${text.slice(0, 60)}…)`,
      kind: 'reply',
      conversationId,
      payload: { text, notifyWhatsApp },
      fireAt,
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
      conversation_id: { type: 'string', description: 'Conversation to notify when the tool fires (optional).' },
      name: { type: 'string', description: 'Stable, unique identifier for this callback.' },
      tool_name: { type: 'string', description: 'Name of a registered site-tool (e.g. "ha_call_service", "blog_create_post").' },
      args: { type: 'object', description: 'Args object passed to the tool exactly as if it were called now.' },
      fire_at_iso: { type: 'string', description: 'ISO-8601 wall-clock time. Use this OR in_seconds.' },
      in_seconds: { type: 'number', description: 'Fire this many seconds from now.' },
    },
    required: ['name', 'tool_name', 'args'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args) => {
    const fireAt = parseFireAt(args);
    if (!fireAt) return { success: false, error: 'must provide fire_at_iso or in_seconds' };
    const toolName = String(args.tool_name);
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
    const conversationId = (args.conversation_id as string) ?? null;
    const name = String(args.name);

    return upsertCallback({
      name,
      description: `Scheduled call ${toolName}`,
      kind: 'tool',
      conversationId,
      payload: { toolName, args: toolArgs },
      fireAt,
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
      conversation_id: { type: 'string', description: 'Conversation to re-engage.' },
      name: { type: 'string', description: 'Stable, unique identifier.' },
      message: { type: 'string', description: 'The synthetic user message that triggers the LLM turn.' },
      fire_at_iso: { type: 'string', description: 'ISO-8601 wall-clock time. Use this OR in_seconds.' },
      in_seconds: { type: 'number', description: 'Fire this many seconds from now.' },
    },
    required: ['conversation_id', 'name', 'message'],
  },
  category: 'System',
  toolset: 'schedule',
  handler: async (args) => {
    const fireAt = parseFireAt(args);
    if (!fireAt) return { success: false, error: 'must provide fire_at_iso or in_seconds' };
    const message = String(args.message);
    const name = String(args.name);
    const conversationId = String(args.conversation_id);

    return upsertCallback({
      name,
      description: `Scheduled orchestrator turn (${message.slice(0, 60)}…)`,
      kind: 'orchestrator-turn',
      conversationId,
      payload: { message },
      fireAt,
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
    const name = String(args.name);
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
}) {
  const existing = await db.select().from(scheduledCallbacks).where(eq(scheduledCallbacks.name, opts.name)).limit(1);
  if (existing.length > 0) {
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
