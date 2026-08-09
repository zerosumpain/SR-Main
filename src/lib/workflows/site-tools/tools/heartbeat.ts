// LLM-callable tools for managing perpetual heartbeat actions.
//
// The heartbeat engine ticks every 30s. On each tick it scans
// `heartbeat_actions` for any active row whose next_run_at has passed and
// runs it. Targeted actions report the live state of the task they watch,
// and retire themselves once that task reaches a terminal state.
//
// Use these tools when:
//   • You promise the user a follow-up ("I'll check on this in a minute")
//     — register the action so the engine actually delivers, instead of
//     hoping the conversation gets re-engaged.
//   • You start any background task whose completion isn't synchronous —
//     a build, a long-running workflow, an external job. The engine will
//     keep checking and message the user when there's something to say.
//   • You want a recurring nudge (e.g. "remind the user about X every 5
//     minutes until they confirm").

import { register } from '../registry-internal';
import { db } from '$lib/db';
import { heartbeatActions, heartbeatPulses, conversations } from '$lib/db/schema';
import { eq, or, desc, inArray } from 'drizzle-orm';
import { normaliseConversationId } from '$lib/jkai/conversation-id';
import { requiredString, optionalString } from '../tool-args';

/** How many recent pulses to attach to each row in `list_heartbeat_actions`. */
const RECENT_PULSES_PER_ACTION = 5;

register({
  name: 'register_heartbeat_action',
  description:
    'Schedule a perpetual heartbeat action for this conversation. The engine will run it every cadence_seconds (≥30) until the task it watches reaches a terminal state. Use whenever you promise the user a follow-up or kick off any background task whose completion is asynchronous.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'The current conversation ID. Required so the heartbeat reply lands in the same chat.' },
      name: { type: 'string', description: 'Stable, unique identifier for this action — e.g. "watch-build-90e8fc5c". Reusing a name updates the existing action.' },
      goal: { type: 'string', description: 'Concrete description of what "done" looks like. Used to decide whether the watch can retire.' },
      prompt: { type: 'string', description: 'What this watch is about, in one line — e.g. "Check the status of build 90e8fc5c and report progress." Shown to the user alongside the status line.' },
      cadence_seconds: { type: 'number', description: 'How often to fire (≥30). Use 30 for tight watches, 300 for things that change every few minutes, 1800 for hourly review-style actions.' },
      description: { type: 'string', description: 'One-line label that appears in the admin Pulse UI. Optional — defaults to the prompt.' },
      task_kind: { type: 'string', description: "Optional. Bind the watch to a live task so it can read real state: 'build', 'research', or 'workflow_run'. Most callers should omit this — spawning a build already attaches its own watcher automatically." },
      task_id: { type: 'string', description: 'Optional. The id of the task named by task_kind.' },
    },
    required: ['conversation_id', 'name', 'goal', 'prompt', 'cadence_seconds'],
  },
  category: 'System',
  toolset: 'heartbeat',
  handler: async (args) => {
    const nameArg = requiredString(args, 'name');
    if (!nameArg.ok) return { success: false, error: nameArg.error };
    const convArg = requiredString(args, 'conversation_id');
    if (!convArg.ok) return { success: false, error: convArg.error };
    const goalArg = requiredString(args, 'goal');
    if (!goalArg.ok) return { success: false, error: goalArg.error };
    const promptArg = requiredString(args, 'prompt');
    if (!promptArg.ok) return { success: false, error: promptArg.error };

    const name = nameArg.value;
    const goal = goalArg.value;
    const prompt = promptArg.value;
    const cadence = Math.max(30, Math.min(86400, Math.round(Number(args.cadence_seconds))));
    if (!Number.isFinite(cadence)) return { success: false, error: 'cadence_seconds must be a number ≥ 30' };

    // Hermes hands us `chat_<uuid>`; the conversation tables key on the bare
    // uuid. Storing the prefixed form is what made every targeted action fail
    // its lookup on every tick, silently, forever.
    const conversationId = normaliseConversationId(convArg.value);

    // Validate up front. A watch registered against a conversation that does
    // not resolve can never deliver anything, so tell the caller now rather
    // than creating a row that errors every 30 seconds for nine days.
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);
    if (!conv) {
      return {
        success: false,
        error:
          `No conversation ${conversationId} — the watch was not registered. ` +
          'Pass the id of the conversation this chat belongs to.',
      };
    }

    const description = optionalString(args, 'description') ?? prompt.slice(0, 120);
    const taskKind = optionalString(args, 'task_kind');
    const taskId = optionalString(args, 'task_id');
    const config = taskKind && taskId ? { taskKind, taskId } : {};

    const now = new Date();
    const nextRunAt = new Date(now.getTime() + cadence * 1000);

    const existing = await db.select().from(heartbeatActions).where(eq(heartbeatActions.name, name)).limit(1);
    if (existing.length > 0) {
      const [updated] = await db
        .update(heartbeatActions)
        .set({
          description,
          kind: 'targeted',
          goal,
          prompt,
          cadenceSeconds: cadence,
          status: 'active',
          conversationId,
          source: 'orchestrator',
          nextRunAt,
          completedAt: null,
          consecutiveFailures: 0,
          lastError: null,
          ...(taskKind && taskId ? { config } : {}),
          updatedAt: now,
        })
        .where(eq(heartbeatActions.name, name))
        .returning();
      return {
        success: true,
        data: {
          name,
          actionId: updated.id,
          updated: true,
          firstRunAt: nextRunAt.toISOString(),
          cadenceSeconds: cadence,
          message: `Heartbeat action "${name}" updated. First run in ${cadence}s.`,
        },
      };
    }

    const [created] = await db
      .insert(heartbeatActions)
      .values({
        name,
        description,
        kind: 'targeted',
        goal,
        prompt,
        cadenceSeconds: cadence,
        status: 'active',
        conversationId,
        source: 'orchestrator',
        nextRunAt,
        config,
      })
      .returning();
    return {
      success: true,
      data: {
        name,
        actionId: created.id,
        updated: false,
        firstRunAt: nextRunAt.toISOString(),
        cadenceSeconds: cadence,
        message: `Heartbeat action "${name}" registered. First run in ${cadence}s.`,
      },
    };
  },
});

register({
  name: 'complete_heartbeat_action',
  description:
    'Mark a heartbeat action complete and remove it from the queue. Use when you\'ve delivered the outcome (or the task it watches is genuinely done). Accepts either the action\'s name or its id.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name passed to register_heartbeat_action. Either this or id is required.' },
      id: { type: 'string', description: 'The action id, as returned by list_heartbeat_actions. Either this or name is required.' },
      reason: { type: 'string', description: 'Short note about why the action is being completed (stored on the action row).' },
    },
  },
  category: 'System',
  toolset: 'heartbeat',
  handler: async (args) => {
    // `list_heartbeat_actions` returns both fields, so the model reaches for
    // whichever it saw first. Accept either rather than coercing a missing
    // key into the string "undefined" and reporting "no such action".
    const name = optionalString(args, 'name');
    const id = optionalString(args, 'id');
    if (!name && !id) return { success: false, error: 'name or id is required' };

    const reason = optionalString(args, 'reason') ?? null;
    const now = new Date();
    const match = name && id
      ? or(eq(heartbeatActions.name, name), eq(heartbeatActions.id, id))!
      : name
        ? eq(heartbeatActions.name, name)
        : eq(heartbeatActions.id, id!);

    const [row] = await db
      .update(heartbeatActions)
      .set({
        status: 'done',
        completedAt: now,
        updatedAt: now,
        config: reason ? { completionReason: reason } : undefined,
      })
      .where(match)
      .returning();

    if (!row) {
      // Say what does exist — a bare "no such action" sent the model looking
      // for a delivery bug when the call itself was simply mis-keyed.
      const open = await db
        .select({ name: heartbeatActions.name })
        .from(heartbeatActions)
        .where(eq(heartbeatActions.status, 'active'));
      const names = open.map((r) => r.name);
      return {
        success: false,
        error:
          `No heartbeat action matching ${name ? `name "${name}"` : `id "${id}"`}. ` +
          (names.length > 0 ? `Active actions: ${names.join(', ')}.` : 'There are no active actions.'),
      };
    }
    return { success: true, data: { name: row.name, actionId: row.id, status: row.status } };
  },
});

register({
  name: 'list_heartbeat_actions',
  description:
    'List heartbeat actions for the current conversation (or globally if no conversation_id), each with its most recent pulses. Check recentPulses before concluding a watch is healthy — a high totalRuns with every pulse erroring means the watch is broken, not busy.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'Limit to actions owned by this conversation. Omit to list all.' },
      include_completed: { type: 'boolean', description: 'Whether to include status=done rows. Default false.' },
    },
  },
  category: 'System',
  toolset: 'heartbeat',
  handler: async (args) => {
    const includeCompleted = (args.include_completed as boolean) ?? false;
    const rawConversationId = optionalString(args, 'conversation_id');
    const conversationId = rawConversationId ? normaliseConversationId(rawConversationId) : undefined;

    const rows = conversationId
      ? await db.select().from(heartbeatActions).where(eq(heartbeatActions.conversationId, conversationId))
      : await db.select().from(heartbeatActions);
    const filtered = rows.filter((r) => includeCompleted || r.status !== 'done');

    // Outcome history is the difference between "this watch has run 719 times"
    // and "this watch has failed 719 times". Without it a dead action reads as
    // a healthy one and the model invents an explanation for the silence.
    const pulsesByAction = new Map<string, Array<{ ts: Date; outcome: string; summary: string }>>();
    if (filtered.length > 0) {
      const recent = await db
        .select({
          actionId: heartbeatPulses.actionId,
          ts: heartbeatPulses.ts,
          outcome: heartbeatPulses.outcome,
          summary: heartbeatPulses.summary,
        })
        .from(heartbeatPulses)
        .where(inArray(heartbeatPulses.actionId, filtered.map((r) => r.id)))
        .orderBy(desc(heartbeatPulses.ts))
        .limit(filtered.length * RECENT_PULSES_PER_ACTION * 4);
      for (const p of recent) {
        const list = pulsesByAction.get(p.actionId) ?? [];
        if (list.length < RECENT_PULSES_PER_ACTION) {
          list.push({ ts: p.ts, outcome: p.outcome, summary: p.summary });
          pulsesByAction.set(p.actionId, list);
        }
      }
    }

    return {
      success: true,
      data: {
        count: filtered.length,
        actions: filtered.map((r) => {
          const recentPulses = pulsesByAction.get(r.id) ?? [];
          return {
            name: r.name,
            id: r.id,
            kind: r.kind,
            status: r.status,
            goal: r.goal,
            cadenceSeconds: r.cadenceSeconds,
            conversationId: r.conversationId,
            totalRuns: r.totalRuns,
            consecutiveFailures: r.consecutiveFailures,
            lastError: r.lastError,
            totalCostUsd: Number(r.totalCostUsd),
            lastRunAt: r.lastRunAt,
            nextRunAt: r.nextRunAt,
            recentPulses,
            healthy: recentPulses.length > 0 ? recentPulses.some((p) => p.outcome !== 'error') : null,
          };
        }),
      },
    };
  },
});
