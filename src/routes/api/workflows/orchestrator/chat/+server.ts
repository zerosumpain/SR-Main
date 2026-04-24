import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { allocateCanvasName } from '$lib/canvas/adapter.server';
import { createJob, getJob, cancelJob, cancelAllRunning, cancelForScope, cleanOldJobs, deleteJob, listJobs, publishJobEvent } from '$lib/workflows/chat/job-store';
import type { OrchestratorJob } from '$lib/workflows/chat/job-store';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { extractEphemeralSidecar } from '$lib/workflows/chat/ephemeral-sidecar';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getModelCapabilities, canAcceptKind } from '$lib/server/models/capabilities';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';

const MAX_MESSAGE_LEN = 20_000;

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId, attachmentIds, useIntelContext } = body as {
    message: string;
    workflowId?: string;
    mode?: string;
    currentNodes?: any;
    currentEdges?: any;
    conversationId?: string;
    attachmentIds?: string[];
    useIntelContext?: boolean;
  };

  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return json({ error: `message too long (max ${MAX_MESSAGE_LEN} chars)` }, { status: 400 });
  }

  // Workflow-context chats (workflowId present, or explicit generate/modify mode)
  // use the builder model set in /admin/models. General /jkai chats use the chat model.
  const isWorkflowContext = !!workflowId || mode === 'generate' || mode === 'modify';
  const defaultKind: 'chat' | 'builder' = isWorkflowContext ? 'builder' : 'chat';

  let attachmentRows: Array<typeof jkaiAttachments.$inferSelect> = [];
  if (attachmentIds && attachmentIds.length > 0) {
    if (attachmentIds.length > 10) {
      return json({ error: 'too many attachments (max 10 per turn)' }, { status: 400 });
    }
    attachmentRows = await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.id, attachmentIds));
    if (attachmentRows.length !== attachmentIds.length) {
      return json({ error: 'one or more attachmentIds not found' }, { status: 404 });
    }

    let ctx: ModelContext = await resolveDefaultModel(defaultKind);
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

  // Cancel any stale running jobs in THIS conversation/workflow before
  // starting a new one. Previously this cancelled all in-flight jobs
  // globally, which killed work in other canvases on concurrent requests.
  if (workflowId || conversationId) {
    cancelForScope({ workflowId, conversationId }, 'Superseded by new request');
  }
  cleanOldJobs();

  const { jobId, job } = createJob(message, { workflowId, conversationId });
  const { abortController } = job;

  // Run the orchestrator in the background
  (async () => {
    console.log(`[orchestrator] Job ${jobId} started — kind=${defaultKind} workflowId=${workflowId ?? 'none'} conversationId=${conversationId ?? 'none'} message: "${message.slice(0, 100)}"`);

    function onProgress(text: string) {
      if (abortController.signal.aborted) return;
      console.log(`[orchestrator] Job ${jobId} progress: ${text.trim()}`);
      job.progress.push(text);
      job.currentStep = text.trim().slice(0, 140);
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
            const { name: canvasName } = await allocateCanvasName('new workflow');
            const [created] = await db.insert(workflows).values({
              name: canvasName,
              description: 'New Workflow (in progress)',
            }).returning();
            resolvedWorkflowId = created.id;
          }

          await db.insert(orchestratorChats).values({ workflowId: resolvedWorkflowId, role: 'user', content: message });
          await db.insert(orchestratorChats).values({ workflowId: resolvedWorkflowId, role: 'assistant', content: followUp });

          job.result = {
            success: true,
            workflow: null,
            workflowId: resolvedWorkflowId,
            redirectTo: !workflowId ? `/jkai/canvas/${resolvedWorkflowId}` : undefined,
            message: followUp,
          };
        } else if (workflow && workflow.nodes.length > 0) {
          if (workflowId) {
            await saveWorkflowFromGenerated(workflowId, workflow);
            job.result = { success: true, workflow, workflowId, thinking, message: workflow.explanation || 'Workflow updated.' };
          } else {
            // Build the whole canvas atomically: a partial failure rolls back,
            // so we never leave an orphaned workflow row that needs a naked
            // delete (which would cascade-wipe any chat history attached to it).
            const { name: canvasName, slug: canvasSlug } = await allocateCanvasName(
              workflow.name || 'generated workflow',
            );
            let createdId: string;
            try {
              createdId = await db.transaction(async (tx) => {
                const [createdRow] = await tx.insert(workflows).values({
                  name: canvasName,
                  description: workflow.description || workflow.name || null,
                }).returning();

                await tx.insert(workflowNodes).values(
                  workflow.nodes.map((n) => ({ id: n.id, workflowId: createdRow.id, type: n.type, position: n.position, config: n.config, label: n.label })),
                );
                if (workflow.edges.length > 0) {
                  await tx.insert(workflowEdges).values(
                    workflow.edges.map((e) => ({ id: e.id, workflowId: createdRow.id, sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourceHandle: e.sourceHandle || null, targetHandle: e.targetHandle || null })),
                  );
                }

                await tx.insert(orchestratorChats).values({ workflowId: createdRow.id, role: 'user', content: message });
                await tx.insert(orchestratorChats).values({ workflowId: createdRow.id, role: 'assistant', content: workflow.explanation || 'Workflow created.', metadata: { workflowGenerated: true } });

                return createdRow.id;
              });
            } catch (dbErr: unknown) {
              const dbMsg = dbErr instanceof Error ? dbErr.message : 'Unknown DB error';
              job.result = { success: false, workflow: null, message: `Failed to save workflow nodes: ${dbMsg}` };
              job.status = 'done';
              publishJobEvent(jobId, { type: 'done', result: job.result as Record<string, unknown> });
              return;
            }

            job.result = { success: true, workflow, workflowId: createdId, redirectTo: `/jkai/canvas/${canvasSlug}`, thinking, message: workflow.explanation || 'Workflow created.' };
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
        // Workflow-context chats (workflowId present) use the builder model; general /jkai chats use the chat model.
        let modelContext: ModelContext = await resolveDefaultModel(defaultKind);
        let priceSnapshot: PriceSnapshot | null = null;
        console.log(`[orchestrator] Job ${jobId} — using ${modelContext.provider}:${modelContext.modelId} (kind=${defaultKind})`);
        // Emit the resolved model to the stream so the client can display it.
        publishJobEvent(jobId, {
          type: 'status',
          text: `Using ${modelContext.provider}:${modelContext.modelId} (${defaultKind})`,
        });
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
            const existing = job.toolSteps.findIndex((s) => s.toolCallId === step.toolCallId);
            if (existing >= 0) {
              job.toolSteps[existing] = step;
            } else {
              job.toolSteps.push(step);
            }
            if (step.status === 'running') {
              job.currentStep = `Running ${step.tool}…`;
            }
          },
          onStreamEvent: (event) => {
            if (abortController.signal.aborted) return;
            publishJobEvent(jobId, event);
          },
          modelContext,
          priceSnapshot,
          useIntelContext: useIntelContext !== false,
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
        } else {
          // No conversation or workflow pinned on entry. Check if a workflow_create
          // tool succeeded mid-turn (typical on /jkai/workflows/new). If so, back-fill
          // both the user message AND the assistant reply against that new workflow id
          // so the conversation survives the redirect.
          let backfillWorkflowId: string | null = null;
          for (const step of job.toolSteps) {
            if (step.tool !== 'workflow_create' || step.status !== 'done') continue;
            const r = step.result as { success?: boolean; data?: { workflowId?: string } } | undefined;
            if (r?.success && r.data?.workflowId) {
              backfillWorkflowId = r.data.workflowId;
              break;
            }
          }
          if (backfillWorkflowId) {
            await db.insert(orchestratorChats).values({
              workflowId: backfillWorkflowId, role: 'user', content: message,
            });
            const [ins] = await db.insert(orchestratorChats).values({
              workflowId: backfillWorkflowId, role: 'assistant', content: responseText, metadata: assistantMetadata,
            }).returning({ id: orchestratorChats.id });
            assistantMsgId = ins.id;
          }
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
