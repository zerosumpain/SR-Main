import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, workflowRuns, workflowAuditLog } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { onAllObs } from '$lib/workflows/observability-bus';

/**
 * Server-Sent Events endpoint for a canvas's observability feed.
 *
 * Wire shape:
 *   1. On connect → one `event: snapshot` carrying { activeRuns, recentRuns, lastEditAt }.
 *   2. Live deltas → events named exactly after the observability-bus types
 *      ('run.started', 'run.completed', 'run.failed', 'node.started',
 *       'node.completed', 'node.failed', 'audit.edit'), payload is the
 *      typed JSON body from the bus, filtered to this canvas's workflowId.
 *   3. Heartbeat → `:ping\n\n` every 15 s so reverse proxies don't close
 *      the connection during quiet periods.
 *
 * Auth posture matches the existing /api/canvas/[slug]/stats/* endpoints
 * (none — the slug itself is the secret). When that changes, add the
 * same guard here in one move.
 */

function canvasWorkflowName(slug: string): string {
  return `canvas:${slug}`;
}

export const GET: RequestHandler = async ({ params, request }) => {
  const [wf] = await db
    .select()
    .from(workflows)
    .where(eq(workflows.name, canvasWorkflowName(params.slug)));
  if (!wf) {
    return new Response(JSON.stringify({ error: 'Canvas not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const workflowId = wf.id;

  // Snapshot queries — read these BEFORE establishing the subscription so
  // the snapshot reflects state at connect time, then live events take it
  // from there.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const activeRunRows = await db
    .select({ id: workflowRuns.id, startedAt: workflowRuns.startedAt, trigger: workflowRuns.trigger })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), eq(workflowRuns.status, 'running')))
    .orderBy(desc(workflowRuns.startedAt));

  const recentRunRows = await db
    .select({
      id: workflowRuns.id,
      status: workflowRuns.status,
      startedAt: workflowRuns.startedAt,
      completedAt: workflowRuns.completedAt,
    })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workflowId, workflowId), gte(workflowRuns.startedAt, dayAgo)))
    .orderBy(desc(workflowRuns.startedAt))
    .limit(5);

  const [lastEditRow] = await db
    .select({ at: workflowAuditLog.at })
    .from(workflowAuditLog)
    .where(eq(workflowAuditLog.workflowId, workflowId))
    .orderBy(desc(workflowAuditLog.at))
    .limit(1);

  const snapshot = {
    activeRuns: activeRunRows.map((r) => ({
      runId: r.id,
      startedAt: r.startedAt?.toISOString() ?? null,
      trigger: r.trigger,
    })),
    recentRuns: recentRunRows.map((r) => ({
      runId: r.id,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
    lastEditAt: lastEditRow?.at?.toISOString() ?? null,
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const write = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      const sendEvent = (type: string, data: unknown): boolean =>
        write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

      // 1) Snapshot
      sendEvent('snapshot', snapshot);

      // 2) Subscribe to the observability bus, filtered by workflowId.
      const unsubscribe = onAllObs((type, event) => {
        const payload = event as { workflowId?: string };
        if (payload.workflowId !== workflowId) return;
        if (!sendEvent(type, event)) {
          cleanup();
        }
      });

      // 3) Heartbeat. Reverse proxies (Caddy, Cloudflare, nginx) idle out
      // long-lived connections; a 15 s comment frame keeps the socket warm.
      const heartbeat = setInterval(() => {
        if (!write(`:ping\n\n`)) {
          cleanup();
        }
      }, 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Tear down when the client disconnects.
      request.signal.addEventListener('abort', cleanup, { once: true });

      // Stash cleanup so cancel() can reach it without re-deriving state.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (controller as any)._cleanup = cleanup;
    },
    cancel(controller) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanup = (controller as any)?._cleanup as (() => void) | undefined;
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable response buffering on platforms that respect it (e.g. nginx).
      'X-Accel-Buffering': 'no',
    },
  });
};
