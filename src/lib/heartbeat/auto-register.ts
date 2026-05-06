import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Register a perpetual heartbeat action that watches a known async task
 * (build or research). Mechanically wired from general-chat.ts so the
 * orchestrator doesn't have to remember to call register_heartbeat_action
 * — the system does it on every successful build_create / research_start.
 *
 * The action's prompt is generic; the engine's targeted runner will
 * pre-inject latest task state into the prompt context on each tick (see
 * src/lib/heartbeat/handlers/targeted.ts).
 */
export async function autoRegisterTaskWatcher(opts: {
  conversationId: string;
  taskKind: 'build' | 'research';
  taskId: string;
}): Promise<void> {
  const name = `watch-${opts.taskKind}-${opts.taskId.slice(0, 8)}`;
  const cadenceSeconds = 30;
  const now = new Date();
  const nextRunAt = new Date(now.getTime() + cadenceSeconds * 1000);

  const goal =
    opts.taskKind === 'build'
      ? 'Keep the user informed about this build every 30s with a one-line status (current iteration, recent action). When the build reaches a terminal state (completed/failed/cancelled), summarise the outcome (preview URL if published) and reply DONE: <one-sentence summary>.'
      : 'Keep the user informed about this research session every 30s with a one-line progress note. When the session is complete, summarise the findings and reply DONE: <one-sentence summary>.';

  const prompt =
    opts.taskKind === 'build'
      ? `Heartbeat watch for build ${opts.taskId}. The current state is injected above by the engine. Post one short status line (≤25 words) that tells the user something useful — current iteration, what just changed, any failure context. If the latest state shows status=completed/failed/cancelled, reply with "DONE: <summary>" and the action will be removed.`
      : `Heartbeat watch for research ${opts.taskId}. The current state is injected above by the engine. Post one short progress line (≤25 words). If the session is complete, reply with "DONE: <summary>".`;

  const config = { taskKind: opts.taskKind, taskId: opts.taskId };

  const existing = await db.select().from(heartbeatActions).where(eq(heartbeatActions.name, name)).limit(1);
  if (existing.length > 0) {
    await db
      .update(heartbeatActions)
      .set({
        kind: 'targeted',
        goal,
        prompt,
        cadenceSeconds,
        status: 'active',
        conversationId: opts.conversationId,
        source: 'system',
        config,
        nextRunAt,
        completedAt: null,
        updatedAt: now,
      })
      .where(eq(heartbeatActions.name, name));
    console.log(`[heartbeat-auto] re-armed ${name} (cadence ${cadenceSeconds}s)`);
    return;
  }

  await db.insert(heartbeatActions).values({
    name,
    description: `Auto-watch ${opts.taskKind} ${opts.taskId.slice(0, 8)}`,
    kind: 'targeted',
    goal,
    prompt,
    cadenceSeconds,
    status: 'active',
    conversationId: opts.conversationId,
    source: 'system',
    config,
    nextRunAt,
  });
  console.log(`[heartbeat-auto] registered ${name} (cadence ${cadenceSeconds}s)`);
}
