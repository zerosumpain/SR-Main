import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

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

    const { workflow, followUp } = await generateWorkflow(message, workflowId);

    if (followUp) {
      // If this is a new workflow, create a placeholder so follow-up chat has a home
      let resolvedWorkflowId = workflowId;
      if (!resolvedWorkflowId) {
        const [created] = await db.insert(workflows).values({
          name: 'New Workflow (in progress)',
          description: null,
        }).returning();
        resolvedWorkflowId = created.id;
      }

      // Save conversation
      await db.insert(orchestratorChats).values({
        workflowId: resolvedWorkflowId,
        role: 'user',
        content: message,
      });
      await db.insert(orchestratorChats).values({
        workflowId: resolvedWorkflowId,
        role: 'assistant',
        content: followUp,
      });

      return json({
        success: true,
        workflow: null,
        workflowId: resolvedWorkflowId,
        redirectTo: !workflowId ? `/workflows/${resolvedWorkflowId}` : undefined,
        message: followUp,
      });
    }

    if (workflow && workflow.nodes.length > 0) {
      if (workflowId) {
        // Existing workflow — update in place
        await saveWorkflowFromGenerated(workflowId, workflow);
        return json({
          success: true,
          workflow,
          workflowId,
          message: workflow.explanation || 'Workflow updated.',
        });
      } else {
        // New workflow — create in DB and return the new ID
        const [created] = await db.insert(workflows).values({
          name: workflow.name || 'Generated Workflow',
          description: workflow.description || null,
        }).returning();

        try {
          await db.insert(workflowNodes).values(
            workflow.nodes.map((n) => ({
              id: n.id,
              workflowId: created.id,
              type: n.type,
              position: n.position,
              config: n.config,
              label: n.label,
            })),
          );

          if (workflow.edges.length > 0) {
            await db.insert(workflowEdges).values(
              workflow.edges.map((e) => ({
                id: e.id,
                workflowId: created.id,
                sourceNodeId: e.sourceNodeId,
                targetNodeId: e.targetNodeId,
                sourceHandle: e.sourceHandle || null,
                targetHandle: e.targetHandle || null,
              })),
            );
          }
        } catch (dbErr: unknown) {
          // Node/edge insert failed — clean up the empty workflow
          await db.delete(workflows).where(eq(workflows.id, created.id));
          const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
          return json({
            success: false,
            workflow: null,
            message: `Failed to save workflow nodes: ${dbMsg}. Please try again.`,
          });
        }

        // Save the conversation against the new workflow so it persists
        await db.insert(orchestratorChats).values({
          workflowId: created.id,
          role: 'user',
          content: message,
        });
        await db.insert(orchestratorChats).values({
          workflowId: created.id,
          role: 'assistant',
          content: workflow.explanation || 'Workflow created.',
          metadata: { workflowGenerated: true },
        });

        return json({
          success: true,
          workflow,
          workflowId: created.id,
          redirectTo: `/workflows/${created.id}`,
          message: workflow.explanation || 'Workflow created.',
        });
      }
    }

    return json({
      success: true,
      workflow: null,
      message: 'Could not generate a valid workflow from that request. Try being more specific about what you want to automate.',
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: errorMessage }, { status: 500 });
  }
};
