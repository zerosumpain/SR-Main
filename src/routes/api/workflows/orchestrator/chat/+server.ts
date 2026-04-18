import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { createJob, getJob, cancelJob, cancelAllRunning, cleanOldJobs, deleteJob, listJobs, publishJobEvent } from '$lib/workflows/chat/job-store';
import type { OrchestratorJob } from '$lib/workflows/chat/job-store';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { extractEphemeralSidecar } from '$lib/workflows/chat/ephemeral-sidecar';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getModelCapabilities, canAcceptKind } from '$lib/server/models/capabilities';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';

const MAX_MESSAGE_LEN = 20_000;

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId, attachmentIds } = body as {
    message: string;
    workflowId?: string;
    mode?: string;
    currentNodes?: any;
    currentEdges?: any;
    conversationId?: string;
    attachmentIds?: string[];
  };

  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return json({ error: `message too long (max ${MAX_MESSAGE_LEN} chars)` }, { status: 400 });
  }

  let attachmentRows: Array<typeof jkaiAttachments.$inferSelect> = [];
  if (attachmentIds && attachmentIds.length > 0) {
    if (attachmentIds.length > 10) {
      return json({ error: 'too many attachments (max 10 per turn)' }, { status: 400 });
    }
    attachmentRows = await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.id, attachmentIds));
    if (attachmentRows.length !== attachmentIds.length) {
      return json({ error: 'one or more attachmentIds not found' }, { status: 404 });
    }

    let ctx: ModelContext = await resolveDefaultModel('chat');
    if (conversationId) {
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
      if (conv) ctx = { provider: conv.modelProvider as 'zai' | 'openrouter', modelId: conv.modelId };
    }
    const caps = getModelCapabilities(ctx);
    for (const a of attachmentRows) {
      if (!canAcceptKind(caps, a.kind)) {
        return json({ error: `model ${ctx.modelId} cannot accept ${a.kind}` }, { status: 400 });
      }
    }
  }

  // Cancel any stale running jobs before starting a new one
  cancelAllRunning('Superseded by new request');
  cleanOldJobs();

  const { jobId, job } = createJob(message);
  const { abortController } = job;

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
        const { workflow, followUp, thinking } = await generateWorkflow(message, workflowId ?? null, onProgress);

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
            redirectTo: !workflowId ? `/jkai/workflows/${resolvedWorkflowId}` : undefined,
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

            job.result = { success: true, workflow, workflowId: created.id, redirectTo: `/jkai/workflows/${created.id}`, thinking, message: workflow.explanation || 'Workflow created.' };
          }
        } else {
          job.result = { success: true, workflow: null, message: 'Could not generate a valid workflow. Try being more specific.' };
        }
      } else {
        // Default: general-purpose chat
        const conversationHistory = await loadConversationHistory(conversationId, workflowId);

        // Persist the user message FIRST so any mid-flight status updates
        // inserted by generalChat land after it in chronological order.
        let insertedUserMsg: { id: string } | null = null;
        if (conversationId) {
          const [m] = await db.insert(orchestratorChats).values({ conversationId, role: 'user', content: message }).returning({ id: orchestratorChats.id });
          insertedUserMsg = m;
        } else if (workflowId) {
          const [m] = await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: message }).returning({ id: orchestratorChats.id });
          insertedUserMsg = m;
        }

        if (insertedUserMsg && attachmentRows.length > 0) {
          await db.update(jkaiAttachments)
            .set({ messageId: insertedUserMsg.id })
            .where(inArray(jkaiAttachments.id, attachmentRows.map((a) => a.id)));
        }

        // Resolve the model pinned at conversation creation (or admin default).
        let modelContext: ModelContext = await resolveDefaultModel('chat');
        let priceSnapshot: PriceSnapshot | null = null;
        if (conversationId) {
          const [conv] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);
          if (conv) {
            modelContext = {
              provider: conv.modelProvider as 'zai' | 'openrouter',
              modelId: conv.modelId,
            };
            priceSnapshot = conv.priceSnapshot as PriceSnapshot | null;
          }
        }

        const { response: responseText } = await generalChat({ text: message, attachments: attachmentRows }, conversationHistory, {
          workflowId,
          conversationId,
          onProgress,
          onToolProgress: (step) => {
            if (abortController.signal.aborted) return;
            // Update or append tool step
            const existing = job.toolSteps.findIndex(s => s.tool === step.tool && s.status === 'running');
            if (existing >= 0 && step.status !== 'running') {
              job.toolSteps[existing] = step;
            } else {
              job.toolSteps.push(step);
            }
          },
          onStreamEvent: (event) => {
            if (abortController.signal.aborted) return;
            publishJobEvent(jobId, event);
          },
          modelContext,
          priceSnapshot,
        });

        if (abortController.signal.aborted) throw new Error('Job cancelled');

        // Save the assistant response. Persist tool steps in metadata so the
        // tool-call drawer survives page reloads. User message was already
        // saved above.
        const cleanedToolSteps = job.toolSteps.map((s) => extractEphemeralSidecar(s));
        const assistantMetadata = cleanedToolSteps.length > 0 ? { toolSteps: cleanedToolSteps } : undefined;
        let assistantMsgId: string | null = null;
        if (conversationId) {
          const [ins] = await db.insert(orchestratorChats).values({
            conversationId, role: 'assistant', content: responseText, metadata: assistantMetadata,
          }).returning({ id: orchestratorChats.id });
          assistantMsgId = ins.id;

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
          const [ins] = await db.insert(orchestratorChats).values({
            workflowId, role: 'assistant', content: responseText, metadata: assistantMetadata,
          }).returning({ id: orchestratorChats.id });
          assistantMsgId = ins.id;
        }

        const assistantAttachments = assistantMsgId
          ? await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.messageId, assistantMsgId))
          : [];

        job.result = { success: true, workflow: null, message: responseText, attachments: assistantAttachments };
      }

      job.status = 'done';
      // Notify SSE subscribers that the job is finished. job.result is the
      // authoritative final payload (includes the persisted assistant message
      // text under `message`).
      publishJobEvent(jobId, { type: 'done', result: (job.result ?? {}) as Record<string, unknown> });
    } catch (err: unknown) {
      if (job.status === 'cancelled') {
        publishJobEvent(jobId, { type: 'error', message: job.error ?? 'Cancelled' });
        return;
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[orchestrator] Job failed:', errorMessage);
      if (err instanceof Error && err.stack) console.error(err.stack);
      job.status = 'error';
      job.error = errorMessage;
      job.result = { success: false, error: errorMessage };
      publishJobEvent(jobId, { type: 'error', message: errorMessage });
    }
  })();

  return json({ jobId });
};

// GET: poll job status OR list active jobs
export const GET: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    return json({ jobs: listJobs() });
  }

  const job = getJob(jobId);
  if (!job) {
    return json({ error: 'Job not found' }, { status: 404 });
  }

  const response: Record<string, unknown> = {
    status: job.status,
    progress: job.progress,
    toolSteps: job.toolSteps,
  };

  if (job.status === 'done' || job.status === 'error' || job.status === 'cancelled') {
    response.result = job.result;
    response.error = job.error;
    deleteJob(jobId);
  }

  return json(response);
};

// DELETE: cancel a running job
export const DELETE: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    cancelAllRunning('Cancelled by user');
    return json({ cancelled: true });
  }

  if (cancelJob(jobId)) {
    return json({ cancelled: true });
  }

  const job = getJob(jobId);
  return json({ error: job ? 'Job not running' : 'Job not found' }, { status: job ? 400 : 404 });
};
