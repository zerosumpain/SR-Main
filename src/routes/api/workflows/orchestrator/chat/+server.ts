import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated, getChatHistory } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, whatsappConversations } from '$lib/db/schema';
import { eq, asc } from 'drizzle-orm';

// In-memory job store
interface OrchestratorJob {
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: string[];
  result?: Record<string, unknown>;
  error?: string;
  abortController: AbortController;
  startedAt: number;
  message: string;
}

const jobs = new Map<string, OrchestratorJob>();

function cancelAllRunning(reason: string) {
  for (const [id, job] of jobs) {
    if (job.status === 'running') {
      console.log(`[orchestrator] Cancelling job ${id}: ${reason}`);
      job.abortController.abort();
      job.status = 'cancelled';
      job.error = reason;
      job.result = { success: false, error: reason };
    }
  }
}

function cleanOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    // Remove completed/cancelled jobs older than 5 min
    if (job.status !== 'running' && now - job.startedAt > 300000) {
      jobs.delete(id);
    }
    // Force-cancel running jobs older than 10 min (zombie protection)
    if (job.status === 'running' && now - job.startedAt > 600000) {
      job.abortController.abort();
      job.status = 'error';
      job.error = 'Job timed out (10 min limit)';
      job.result = { success: false, error: job.error };
      jobs.delete(id);
    }
  }
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId } = body;

  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }

  // Cancel any stale running jobs before starting a new one
  cancelAllRunning('Superseded by new request');
  cleanOldJobs();

  const jobId = crypto.randomUUID();
  const abortController = new AbortController();
  const job: OrchestratorJob = {
    status: 'running',
    progress: [],
    abortController,
    startedAt: Date.now(),
    message: message.slice(0, 100),
  };
  jobs.set(jobId, job);

  // Run the orchestrator in the background
  (async () => {
    console.log(`[orchestrator] Job ${jobId} started — message: "${message.slice(0, 100)}"`);

    function onProgress(text: string) {
      if (abortController.signal.aborted) return;
      console.log(`[orchestrator] Job ${jobId} progress: ${text.trim()}`);
      job.progress.push(text);
    }

    try {
      if (abortController.signal.aborted) throw new Error('Job cancelled');

      if (mode === 'modify' && currentNodes && currentEdges && workflowId) {
        // Explicit workflow modification
        const result = await modifyWorkflow(
          message,
          workflowId,
          currentNodes as WorkflowNodeDef[],
          currentEdges as WorkflowEdgeDef[],
          onProgress,
        );

        if (abortController.signal.aborted) throw new Error('Job cancelled');

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
      } else if (mode === 'generate') {
        // Explicit workflow generation
        const { workflow, followUp, thinking } = await generateWorkflow(message, workflowId, onProgress);

        if (abortController.signal.aborted) throw new Error('Job cancelled');

        if (followUp) {
          let resolvedWorkflowId = workflowId;
          if (!resolvedWorkflowId) {
            const [created] = await db.insert(workflows).values({
              name: 'New Workflow (in progress)',
              description: null,
            }).returning();
            resolvedWorkflowId = created.id;
          }

          await db.insert(orchestratorChats).values({ workflowId: resolvedWorkflowId, role: 'user', content: message });
          await db.insert(orchestratorChats).values({ workflowId: resolvedWorkflowId, role: 'assistant', content: followUp });

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
            job.result = { success: true, workflow, workflowId, thinking, message: workflow.explanation || 'Workflow updated.' };
          } else {
            const [created] = await db.insert(workflows).values({
              name: workflow.name || 'Generated Workflow',
              description: workflow.description || null,
            }).returning();

            try {
              await db.insert(workflowNodes).values(
                workflow.nodes.map((n) => ({ id: n.id, workflowId: created.id, type: n.type, position: n.position, config: n.config, label: n.label })),
              );
              if (workflow.edges.length > 0) {
                await db.insert(workflowEdges).values(
                  workflow.edges.map((e) => ({ id: e.id, workflowId: created.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null })),
                );
              }
            } catch (dbErr: unknown) {
              await db.delete(workflows).where(eq(workflows.id, created.id));
              const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
              job.result = { success: false, workflow: null, message: `Failed to save workflow nodes: ${dbMsg}` };
              job.status = 'done';
              return;
            }

            await db.insert(orchestratorChats).values({ workflowId: created.id, role: 'user', content: message });
            await db.insert(orchestratorChats).values({ workflowId: created.id, role: 'assistant', content: workflow.explanation || 'Workflow created.', metadata: { workflowGenerated: true } });

            job.result = { success: true, workflow, workflowId: created.id, redirectTo: `/workflows/${created.id}`, thinking, message: workflow.explanation || 'Workflow created.' };
          }
        } else {
          job.result = { success: true, workflow: null, message: 'Could not generate a valid workflow. Try being more specific.' };
        }
      } else {
        // Default: general-purpose chat
        let conversationHistory: Array<{ role: string; content: string }> = [];

        if (conversationId) {
          // Load web messages for this conversation
          const convMessages = await db
            .select({ role: orchestratorChats.role, content: orchestratorChats.content, createdAt: orchestratorChats.createdAt })
            .from(orchestratorChats)
            .where(eq(orchestratorChats.conversationId, conversationId))
            .orderBy(asc(orchestratorChats.createdAt));

          // Check if this conversation has a WhatsApp phone number
          const [conv] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);

          if (conv?.whatsappPhoneNumber) {
            // Merge WhatsApp + web messages chronologically, take last 30
            const waMessages = await db
              .select({ role: whatsappConversations.role, content: whatsappConversations.content, createdAt: whatsappConversations.createdAt })
              .from(whatsappConversations)
              .where(eq(whatsappConversations.phoneNumber, conv.whatsappPhoneNumber))
              .orderBy(asc(whatsappConversations.createdAt));

            const merged = [
              ...waMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
              ...convMessages.map(m => ({ role: m.role, content: m.content, ts: m.createdAt.getTime() })),
            ].sort((a, b) => a.ts - b.ts);

            conversationHistory = merged.slice(-30).map(m => ({ role: m.role, content: m.content }));
          } else {
            conversationHistory = convMessages.slice(-30).map(m => ({ role: m.role, content: m.content }));
          }
        } else if (workflowId) {
          const history = await getChatHistory(workflowId);
          conversationHistory = history.map(h => ({ role: h.role, content: h.content }));
        }

        const { response: responseText } = await generalChat(message, conversationHistory, {
          workflowId,
          onProgress,
        });

        if (abortController.signal.aborted) throw new Error('Job cancelled');

        // Save chat history
        if (conversationId) {
          await db.insert(orchestratorChats).values({ conversationId, role: 'user', content: message });
          await db.insert(orchestratorChats).values({ conversationId, role: 'assistant', content: responseText });
          // Update conversation title if first message, always update updatedAt
          const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
          if (conv && !conv.title) {
            await db.update(conversations)
              .set({ title: message.slice(0, 50), updatedAt: new Date() })
              .where(eq(conversations.id, conversationId));
          } else if (conv) {
            await db.update(conversations)
              .set({ updatedAt: new Date() })
              .where(eq(conversations.id, conversationId));
          }
        } else if (workflowId) {
          await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: message });
          await db.insert(orchestratorChats).values({ workflowId, role: 'assistant', content: responseText });
        }

        job.result = { success: true, workflow: null, message: responseText };
      }

      job.status = 'done';
    } catch (err: unknown) {
      if (job.status === 'cancelled') return; // Already handled
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[orchestrator] Job failed:', errorMessage);
      if (err instanceof Error && err.stack) console.error(err.stack);
      job.status = 'error';
      job.error = errorMessage;
      job.result = { success: false, error: errorMessage };
    }
  })();

  return json({ jobId });
};

// GET: poll job status OR list active jobs
export const GET: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');

  // If no jobId, return list of all active/recent jobs
  if (!jobId) {
    const jobList = Array.from(jobs.entries()).map(([id, job]) => ({
      id,
      status: job.status,
      message: job.message,
      startedAt: job.startedAt,
      progressCount: job.progress.length,
      elapsed: Date.now() - job.startedAt,
    }));
    return json({ jobs: jobList });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return json({ error: 'Job not found' }, { status: 404 });
  }

  const response: Record<string, unknown> = {
    status: job.status,
    progress: job.progress,
  };

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    response.result = job.result;
    response.error = job.error;
    setTimeout(() => jobs.delete(jobId), 30000);
  }

  return json(response);
};

// DELETE: cancel a running job
export const DELETE: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    // Cancel all running jobs
    cancelAllRunning('Cancelled by user');
    return json({ cancelled: true });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status === 'running') {
    job.abortController.abort();
    job.status = 'cancelled';
    job.error = 'Cancelled by user';
    job.result = { success: false, error: 'Cancelled by user' };
    console.log(`[orchestrator] Job ${jobId} cancelled by user`);
  }

  return json({ cancelled: true, status: job.status });
};
