/**
 * engine-interactions.ts
 *
 * Helper for creating workflow_interactions rows from within the engine.
 * Called by the `interactive-step` node executor (step 4) to register a
 * pending human interaction before returning the pause sentinel.
 */

import { db } from '$lib/db';
import { workflowInteractions } from '$lib/db/schema';

export interface CreateInteractionOpts {
  runId: string;
  nodeId: string;
  mode: 'vnc' | 'confirm' | 'both';
  prompt: string;
  configSnapshot: Record<string, unknown>;
  vncSessionId?: string;
  /** Minutes until the interaction expires (default: 60). */
  timeoutMinutes?: number;
}

/**
 * Insert a workflow_interactions row and return its numeric id.
 * The caller (interactive-step executor) should then return a NodeResult
 * with `pause: { reason: 'awaiting_human', interactionId }` to halt the run.
 */
export async function createInteraction(opts: CreateInteractionOpts): Promise<number> {
  const {
    runId,
    nodeId,
    mode,
    prompt,
    configSnapshot,
    vncSessionId,
    timeoutMinutes = 60,
  } = opts;

  const expiresAt = new Date(Date.now() + timeoutMinutes * 60 * 1000);

  const [row] = await db
    .insert(workflowInteractions)
    .values({
      runId,
      nodeId,
      mode,
      prompt,
      configSnapshot,
      vncSessionId: vncSessionId ?? null,
      expiresAt,
    })
    .returning({ id: workflowInteractions.id });

  return row.id;
}
