import { db } from '$lib/db';
import { workflowNodes, workflowRuns, nodeExecutions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { engine } from '$lib/workflows';
import type { WorkflowDefinition } from './types';

/**
 * Fire a workflow run and persist its results when it resolves.
 *
 * Shared by /api/workflows/[id]/run and /api/workflows/[id]/chat so
 * both paths write node_executions + workflow_runs consistently.
 *
 * Returns immediately; the post-run DB writes happen in a detached
 * promise chain. Errors are logged.
 */
export function runWorkflowAndPersist(
  definition: WorkflowDefinition,
  runId: string,
  initialInput: Record<string, unknown>,
  opts: {
    workflowId: string;
    breakpoints?: Set<string>;
    selfHealing?: boolean;
    label?: string;
  },
): void {
  const { workflowId, breakpoints, selfHealing = true, label = 'run' } = opts;

  engine
    .execute(definition, runId, initialInput, breakpoints, workflowId, { selfHealing })
    .then(async (result) => {
      const healingHistory = result.healingHistory || [];

      try {
        await db
          .update(workflowRuns)
          .set({
            status: result.status,
            completedAt: new Date(),
            error: result.error || null,
            healingHistory: healingHistory.length > 0 ? healingHistory : undefined,
          })
          .where(eq(workflowRuns.id, runId));

        if (result.status === 'completed' || result.status === 'completed_with_errors') {
          try {
            const { emit } = await import('$lib/workflows/event-bus');
            emit('workflow_completed', { workflowId, runId, status: result.status });
          } catch {
            /* event bus is not critical */
          }
        }

        for (const [nodeId, output] of result.nodeOutputs) {
          const inputData = result.nodeInputs.get(nodeId);
          await db
            .update(nodeExecutions)
            .set({
              status: 'completed',
              inputData: inputData ?? null,
              outputData: output,
              completedAt: new Date(),
            })
            .where(eq(nodeExecutions.nodeId, nodeId));
        }

        for (const [nodeId, error] of result.nodeErrors) {
          await db
            .update(nodeExecutions)
            .set({
              status: 'failed',
              error,
              completedAt: new Date(),
            })
            .where(eq(nodeExecutions.nodeId, nodeId));
        }

        for (const entry of healingHistory) {
          await db
            .update(workflowNodes)
            .set({ config: entry.newConfig })
            .where(eq(workflowNodes.id, entry.nodeId));
        }
      } catch (err) {
        console.error(`[${label}] failed to persist run results (runId=${runId})`, err);
      }
    })
    .catch(async (err) => {
      console.error(`[${label}] workflow execution threw (runId=${runId})`, err);
      try {
        await db
          .update(workflowRuns)
          .set({
            status: 'failed',
            completedAt: new Date(),
            error: err instanceof Error ? err.message : String(err),
          })
          .where(eq(workflowRuns.id, runId));
      } catch {
        /* swallow */
      }
    });
}
