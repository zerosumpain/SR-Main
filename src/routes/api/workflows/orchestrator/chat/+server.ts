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

  // Stream the response as SSE to avoid Cloudflare timeout
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream closed by client
        }
      }

      function sendProgress(text: string) {
        send({ type: 'progress', message: text });
      }

      try {
        if (mode === 'modify' && currentNodes && currentEdges && workflowId) {
          const result = await modifyWorkflow(
            message,
            workflowId,
            currentNodes as WorkflowNodeDef[],
            currentEdges as WorkflowEdgeDef[],
            sendProgress,
          );

          if (result.followUp) {
            send({ type: 'done', success: true, workflow: null, message: result.followUp });
          } else if (result.workflow && result.workflow.nodes.length > 0) {
            await saveWorkflowFromGenerated(workflowId, result.workflow);
            send({
              type: 'done',
              success: true,
              workflow: result.workflow,
              message: result.workflow?.explanation || 'Workflow updated.',
              thinking: result.thinking,
            });
          } else {
            send({ type: 'done', success: true, workflow: null, message: 'No changes made.' });
          }
        } else {
          const { workflow, followUp, thinking } = await generateWorkflow(message, workflowId, sendProgress);

          if (followUp) {
            let resolvedWorkflowId = workflowId;
            if (!resolvedWorkflowId) {
              const [created] = await db.insert(workflows).values({
                name: 'New Workflow (in progress)',
                description: null,
              }).returning();
              resolvedWorkflowId = created.id;
            }

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

            send({
              type: 'done',
              success: true,
              workflow: null,
              workflowId: resolvedWorkflowId,
              redirectTo: !workflowId ? `/workflows/${resolvedWorkflowId}` : undefined,
              message: followUp,
            });
          } else if (workflow && workflow.nodes.length > 0) {
            if (workflowId) {
              await saveWorkflowFromGenerated(workflowId, workflow);
              send({
                type: 'done',
                success: true,
                workflow,
                workflowId,
                thinking,
                message: workflow.explanation || 'Workflow updated.',
              });
            } else {
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
                await db.delete(workflows).where(eq(workflows.id, created.id));
                const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
                send({
                  type: 'done',
                  success: false,
                  workflow: null,
                  message: `Failed to save workflow nodes: ${dbMsg}. Please try again.`,
                });
                controller.close();
                return;
              }

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

              send({
                type: 'done',
                success: true,
                workflow,
                workflowId: created.id,
                redirectTo: `/workflows/${created.id}`,
                thinking,
                message: workflow.explanation || 'Workflow created.',
              });
            }
          } else {
            send({
              type: 'done',
              success: true,
              workflow: null,
              message: 'Could not generate a valid workflow from that request. Try being more specific about what you want to automate.',
            });
          }
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        send({ type: 'done', success: false, error: errorMessage });
      }

      try {
        controller.close();
      } catch {
        // Already closed
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
