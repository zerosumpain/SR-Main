import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

// In-memory job store for async orchestrator jobs
interface OrchestratorJob {
  status: 'running' | 'done' | 'error';
  progress: string[];
  result?: Record<string, unknown>;
  error?: string;
}

const jobs = new Map<string, OrchestratorJob>();

// Clean up old jobs after 5 minutes
function cleanOldJobs() {
  // Keep at most 50 jobs
  if (jobs.size > 50) {
    const keys = Array.from(jobs.keys());
    for (let i = 0; i < keys.length - 50; i++) {
      jobs.delete(keys[i]);
    }
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges } = body;

  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }

  // Create a job ID and return it immediately
  const jobId = crypto.randomUUID();
  const job: OrchestratorJob = { status: 'running', progress: [] };
  jobs.set(jobId, job);
  cleanOldJobs();

  // Run the orchestrator in the background
  (async () => {
    function onProgress(text: string) {
      job.progress.push(text);
    }

    try {
      if (mode === 'modify' && currentNodes && currentEdges && workflowId) {
        const result = await modifyWorkflow(
          message,
          workflowId,
          currentNodes as WorkflowNodeDef[],
          currentEdges as WorkflowEdgeDef[],
          onProgress,
        );

        if (result.followUp) {
          job.result = { success: true, workflow: null, message: result.followUp };
        } else if (result.workflow && result.workflow.nodes.length > 0) {
          await saveWorkflowFromGenerated(workflowId, result.workflow);
          job.result = {
            success: true,
            workflow: result.workflow,
            message: result.workflow?.explanation || 'Workflow updated.',
            thinking: result.thinking,
          };
        } else {
          job.result = { success: true, workflow: null, message: 'No changes made.' };
        }
      } else {
        const { workflow, followUp, thinking } = await generateWorkflow(message, workflowId, onProgress);

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

          job.result = {
            success: true,
            workflow: null,
            workflowId: resolvedWorkflowId,
            redirectTo: !workflowId ? `/workflows/${resolvedWorkflowId}` : undefined,
            message: followUp,
          };
        } else if (workflow && workflow.nodes.length > 0) {
          if (workflowId) {
            await saveWorkflowFromGenerated(workflowId, workflow);
            job.result = {
              success: true,
              workflow,
              workflowId,
              thinking,
              message: workflow.explanation || 'Workflow updated.',
            };
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
              job.result = {
                success: false,
                workflow: null,
                message: `Failed to save workflow nodes: ${dbMsg}. Please try again.`,
              };
              job.status = 'done';
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

            job.result = {
              success: true,
              workflow,
              workflowId: created.id,
              redirectTo: `/workflows/${created.id}`,
              thinking,
              message: workflow.explanation || 'Workflow created.',
            };
          }
        } else {
          job.result = {
            success: true,
            workflow: null,
            message: 'Could not generate a valid workflow from that request. Try being more specific about what you want to automate.',
          };
        }
      }

      job.status = 'done';
    } catch (err: unknown) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : 'Unknown error';
      job.result = { success: false, error: job.error };
    }
  })();

  // Return immediately with job ID
  return json({ jobId });
};

// GET endpoint to poll/stream job status
export const GET: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    return json({ error: 'jobId is required' }, { status: 400 });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return json({ error: 'Job not found' }, { status: 404 });
  }

  // SSE stream that sends progress then result
  const encoder = new TextEncoder();
  let progressIndex = 0;

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream closed */ }
      }

      // Poll until job is done
      while (job.status === 'running') {
        // Send any new progress messages
        while (progressIndex < job.progress.length) {
          send({ type: 'progress', message: job.progress[progressIndex] });
          progressIndex++;
        }
        // Wait a bit before checking again
        await new Promise(r => setTimeout(r, 500));
        // Send keepalive to prevent timeout
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`));
        } catch { break; }
      }

      // Send any remaining progress
      while (progressIndex < job.progress.length) {
        send({ type: 'progress', message: job.progress[progressIndex] });
        progressIndex++;
      }

      // Send the final result
      send({ type: 'done', ...job.result });

      try { controller.close(); } catch { /* already closed */ }

      // Clean up job after delivery
      setTimeout(() => jobs.delete(jobId), 30000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
