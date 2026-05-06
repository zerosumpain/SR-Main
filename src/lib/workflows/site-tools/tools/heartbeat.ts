// LLM-callable tools for managing perpetual heartbeat actions.
//
// The heartbeat engine ticks every 30s. On each tick it scans
// `heartbeat_actions` for any active row whose next_run_at has passed and
// runs it. Targeted actions execute as a focused LLM turn against the
// owning conversation; the LLM either takes one concrete step or replies
// "DONE: …" to mark the goal met and remove itself from the queue.
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
import { heartbeatActions } from '$lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';

register({
  name: 'register_heartbeat_action',
  description:
    'Schedule a perpetual heartbeat action for this conversation. The engine will run the prompt every cadence_seconds (≥30) until the action marks itself DONE: in its reply. Use whenever you promise the user a follow-up or kick off any background task whose completion is asynchronous.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'The current conversation ID. Required so the heartbeat reply lands in the same chat.' },
      name: { type: 'string', description: 'Stable, unique identifier for this action — e.g. "watch-build-90e8fc5c". Reusing a name updates the existing action.' },
      goal: { type: 'string', description: 'Concrete description of what "done" looks like. The LLM uses this on each tick to decide whether to mark itself DONE.' },
      prompt: { type: 'string', description: 'Instruction the engine sends to the LLM on each tick — e.g. "Check the status of build 90e8fc5c. If terminal, summarise the result and reply DONE: <summary>. Otherwise report current state in ≤30 words."' },
      cadence_seconds: { type: 'number', description: 'How often to fire (≥30). Use 30 for tight watches, 300 for things that change every few minutes, 1800 for hourly review-style actions.' },
      description: { type: 'string', description: 'One-line label that appears in the admin Pulse UI. Optional — defaults to the prompt.' },
    },
    required: ['conversation_id', 'name', 'goal', 'prompt', 'cadence_seconds'],
  },
  category: 'System',
  toolset: 'system',
  handler: async (args) => {
    const name = String(args.name);
    const cadence = Math.max(30, Math.min(86400, Math.round(Number(args.cadence_seconds))));
    const conversationId = String(args.conversation_id);
    const goal = String(args.goal);
    const prompt = String(args.prompt);
    const description = (args.description as string | undefined) ?? prompt.slice(0, 120);

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
          updatedAt: now,
        })
        .where(eq(heartbeatActions.name, name))
        .returning();
      return {
        success: true,
        data: {
          actionId: updated.id,
          name,
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
      })
      .returning();
    return {
      success: true,
      data: {
        actionId: created.id,
        name,
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
    'Mark a heartbeat action complete and remove it from the queue. Use when you\'ve delivered the outcome (or the task it watches is genuinely done). Equivalent to replying "DONE: …" inside the action\'s own LLM turn, but available for the orchestrator to call from a normal user turn.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name passed to register_heartbeat_action.' },
      reason: { type: 'string', description: 'Short note about why the action is being completed (stored on the action row).' },
    },
    required: ['name'],
  },
  category: 'System',
  toolset: 'system',
  handler: async (args) => {
    const name = String(args.name);
    const reason = (args.reason as string | undefined) ?? null;
    const now = new Date();
    const [row] = await db
      .update(heartbeatActions)
      .set({
        status: 'done',
        completedAt: now,
        updatedAt: now,
        config: reason ? { completionReason: reason } : undefined,
      })
      .where(eq(heartbeatActions.name, name))
      .returning();
    if (!row) {
      return { success: false, error: `No heartbeat action named "${name}"` };
    }
    return { success: true, data: { actionId: row.id, name, status: row.status } };
  },
});

register({
  name: 'list_heartbeat_actions',
  description: 'List heartbeat actions for the current conversation (or globally if no conversation_id). Useful when deciding whether to register a new action or whether a watch is already in place.',
  parameters: {
    type: 'object',
    properties: {
      conversation_id: { type: 'string', description: 'Limit to actions owned by this conversation. Omit to list all.' },
      include_completed: { type: 'boolean', description: 'Whether to include status=done rows. Default false.' },
    },
  },
  category: 'System',
  toolset: 'system',
  handler: async (args) => {
    const includeCompleted = (args.include_completed as boolean) ?? false;
    const conversationId = args.conversation_id as string | undefined;
    const conds = [];
    if (conversationId) conds.push(eq(heartbeatActions.conversationId, conversationId));
    if (!includeCompleted) {
      // status != 'done'  — Drizzle doesn't have a `ne` import here, use isNotNull on a helper field instead
      // Simpler: filter in JS after fetching the row set we care about
    }
    const rows = conds.length > 0
      ? await db.select().from(heartbeatActions).where(and(...conds))
      : await db.select().from(heartbeatActions);
    const filtered = rows.filter((r) => includeCompleted || r.status !== 'done');
    return {
      success: true,
      data: {
        count: filtered.length,
        actions: filtered.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          status: r.status,
          goal: r.goal,
          cadenceSeconds: r.cadenceSeconds,
          conversationId: r.conversationId,
          totalRuns: r.totalRuns,
          totalCostUsd: Number(r.totalCostUsd),
          lastRunAt: r.lastRunAt,
          nextRunAt: r.nextRunAt,
        })),
      },
    };
  },
});

void isNotNull; // imported for clarity but unused above; keep import stable
