import type { RequestHandler } from './$types';
import { onWorkflowEvent } from '$lib/workflows/events';
import type { WorkflowEvent } from '$lib/workflows';
import { db } from '$lib/db';
import { workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

const TERMINAL: Record<string, WorkflowEvent['type']> = {
  completed: 'run_completed',
  completed_with_errors: 'run_completed_with_errors',
  failed: 'run_failed',
  cancelled: 'run_failed',
};

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.runId;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Stream closed
        }
      }

      send({ type: 'connected', runId, timestamp: new Date().toISOString() });

      const unsubscribe = onWorkflowEvent(runId, (event: WorkflowEvent) => {
        send(event as unknown as Record<string, unknown>);
        if (
          event.type === 'run_completed' ||
          event.type === 'run_completed_with_errors' ||
          event.type === 'run_failed'
        ) {
          try {
            controller.close();
          } catch {
            // Already closed
          }
        }
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch {
          clearInterval(keepalive);
          unsubscribe();
        }
      }, 15000);

      (controller as any)._cleanup = () => {
        clearInterval(keepalive);
        unsubscribe();
      };

      // A run can settle before this stream subscribes — a test run with pinned
      // steps takes milliseconds — and nothing is replayed, so the canvas sat on
      // "running…" for ever. Replay what the run recorded, then how it ended.
      void db.select({ status: workflowRuns.status, error: workflowRuns.error }).from(workflowRuns)
        .where(eq(workflowRuns.id, runId)).limit(1)
        .then(async ([run]) => {
          const type = run ? TERMINAL[run.status] : undefined;
          if (!type) return;
          const timestamp = new Date().toISOString();
          for (const e of await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, runId))) {
            if (e.status === 'completed') send({ type: 'node_completed', runId, nodeId: e.nodeId, timestamp, data: { inputData: e.inputData, outputData: e.outputData } });
            else if (e.status === 'failed') send({ type: 'node_failed', runId, nodeId: e.nodeId, timestamp, error: e.error });
          }
          send({ type, runId, error: run.error ?? undefined, timestamp });
          (controller as any)._cleanup();
          try { controller.close(); } catch { /* already closed */ }
        })
        .catch(() => {});
    },
    cancel(controller) {
      if ((controller as any)?._cleanup) {
        (controller as any)._cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
