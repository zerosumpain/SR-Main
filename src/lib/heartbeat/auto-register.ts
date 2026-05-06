import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getTaskStateProvider } from './state-providers';
import type { ProducesLongRunningTask } from '$lib/workflows/site-tools/registry-internal';

/**
 * Generic auto-registration of a heartbeat watcher for ANY tool whose
 * definition declares `producesLongRunningTask`. The chat layer calls
 * this after a tool succeeds; we extract the task id, look up a state
 * provider for the kind, and either insert or re-arm a perpetual action.
 *
 * Adding support for a new long-running task:
 *   1. mark its tool with producesLongRunningTask: { kind, idPath }
 *   2. add a state provider entry in src/lib/heartbeat/state-providers.ts
 * Nothing else changes — this function is generic.
 */
export async function autoRegisterFromToolResult(opts: {
  conversationId: string;
  toolName: string;
  produces: ProducesLongRunningTask;
  resultData: unknown;
}): Promise<{ registered: boolean; reason: string; actionName?: string }> {
  const provider = getTaskStateProvider(opts.produces.kind);
  if (!provider) {
    return { registered: false, reason: `no state-provider for kind '${opts.produces.kind}'` };
  }

  const taskId = readDotPath(opts.resultData, opts.produces.idPath);
  if (typeof taskId !== 'string' || !taskId) {
    return { registered: false, reason: `idPath '${opts.produces.idPath}' did not resolve to a string` };
  }

  const cadenceSeconds = opts.produces.cadenceSeconds ?? 30;
  const name = `watch-${opts.produces.kind}-${taskId.slice(0, 8)}`;
  const goal =
    opts.produces.goal ??
    `Keep the user informed about this ${opts.produces.kind} every ${cadenceSeconds}s with a one-line status. When the task reaches a terminal state, summarise and reply DONE: <one-sentence summary>.`;
  const prompt =
    opts.produces.prompt ??
    `Heartbeat watch for ${opts.produces.kind} ${taskId}. Live state is injected above by the engine — read it, then post one short status line (≤25 words) describing what's happening right now or has just changed. If the live state shows a terminal status, reply with "DONE: <summary>".`;

  const now = new Date();
  const nextRunAt = new Date(now.getTime() + cadenceSeconds * 1000);
  const config = { taskKind: opts.produces.kind, taskId, fromTool: opts.toolName };

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
    return { registered: true, reason: 're-armed', actionName: name };
  }

  await db.insert(heartbeatActions).values({
    name,
    description: `Auto-watch ${opts.produces.kind} ${taskId.slice(0, 8)}`,
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
  return { registered: true, reason: 'inserted', actionName: name };
}

function readDotPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const segment of path.split('.')) {
    if (cur && typeof cur === 'object' && segment in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cur;
}
