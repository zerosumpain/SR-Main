import { db } from '$lib/db';
import { heartbeatActions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getTaskStateProvider } from './state-providers';
import { normaliseConversationId } from '$lib/jkai/conversation-id';
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

  // Strip the legacy `chat_` prefix here rather than at each call site. Wiring
  // this hook up without it would spawn a 30s watcher per build that errors
  // forever — the exact failure this whole change exists to end.
  const conversationId = normaliseConversationId(opts.conversationId);

  const cadenceSeconds = opts.produces.cadenceSeconds ?? 30;
  const name = `watch-${opts.produces.kind}-${taskId.slice(0, 8)}`;
  const goal =
    opts.produces.goal ??
    `Keep the user informed about this ${opts.produces.kind}. Retires itself when the task reaches a terminal state.`;
  const prompt =
    opts.produces.prompt ??
    `${opts.produces.kind} ${taskId.slice(0, 8)}`;

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
        conversationId,
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
    conversationId,
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
