import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges } = body;

  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }

  try {
    if (mode === 'modify' && currentNodes && currentEdges) {
      const workflow = await modifyWorkflow(
        message,
        workflowId,
        currentNodes as WorkflowNodeDef[],
        currentEdges as WorkflowEdgeDef[],
      );

      if (workflow && workflowId) {
        await saveWorkflowFromGenerated(workflowId, workflow);
      }

      return json({
        success: true,
        workflow,
        message: workflow?.explanation || 'Could not parse the modification.',
      });
    }

    const { workflow } = await generateWorkflow(message, workflowId);

    if (workflow && workflowId) {
      await saveWorkflowFromGenerated(workflowId, workflow);
    }

    return json({
      success: true,
      workflow,
      message: workflow?.explanation || 'Could not generate a workflow from that request.',
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: errorMessage }, { status: 500 });
  }
};
