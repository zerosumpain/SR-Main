import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { allocateCanvasName } from '$lib/canvas/adapter.server';
import { createJob, getJob, cancelJob, cancelAllRunning, cancelForScope, cleanOldJobs, deleteJob, listJobs, publishJobEvent, respondToWaiter } from '$lib/workflows/chat/job-store';
import type { OrchestratorJob, JobEvent } from '$lib/workflows/chat/job-store';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { extractEphemeralSidecar } from '$lib/workflows/chat/ephemeral-sidecar';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getModelCapabilities, canAcceptKind } from '$lib/server/models/capabilities';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
import { HermesClient, type SseFrame } from '$lib/jkai/hermes-client';

const MAX_MESSAGE_LEN = 20_000;

// Feature flag (Hermes Phase 1). When `JKAI_HERMES_CANVAS_CHAT=1`, canvas
// orchestrator chat is proxied through the Hermes gateway via HermesClient +
// JkaiPlatformAdapter; otherwise we keep running the legacy generalChat /
// ReAct loop here in-process. The flag is OFF by default — Task 14 is the
// soak that flips it.
const HERMES_ENABLED = env.JKAI_HERMES_CANVAS_CHAT === '1';
const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HERMES_SECRET = env.HERMES_BRIDGE_SECRET ?? '';

export const POST: RequestHandler = async (event) => {
  if (HERMES_ENABLED) {
    return handleWithHermes(event);
  }
  return handleWithLoop(event);
};

// ---------------------------------------------------------------------------
// Hermes branch (flag ON)
// ---------------------------------------------------------------------------

/**
 * Map the Hermes platform-adapter outbound frame shape (send / replace /
 * finalize) to the legacy SSE event shape the canvas UI already consumes
 * (`{ type: 'token', delta }` + a terminating `{ type: 'done' }`).
 *
 * The canvas UI subscribes via `/api/workflows/orchestrator/chat/stream`
 * which speaks the legacy `JobEvent` shape — so this proxy mints a fresh
 * `jobId`, fires `publishJobEvent(jobId, {type:'token', delta:...})` for
 * every send/replace frame, and ends with `{type:'done'}` on `finalize`.
 *
 * Frame semantics:
 *   - send:     a brand-new bubble. Treat content as a delta.
 *   - replace:  an edit to an existing bubble. We replay the new content as
 *               a delta — the consumer concatenates deltas, so a replace
 *               appends the latest copy. (Task 14 may swap this to a proper
 *               diff once acceptance testing demands it.)
 *   - finalize: terminal frame. Emit a 'done' with the final content under
 *               `result.message`.
 */
function adaptFrameToCanvasSse(frame: SseFrame): JobEvent[] {
  switch (frame.kind) {
    case 'send':
    case 'replace':
      return [{ type: 'token', delta: frame.content }];
    case 'finalize':
      // The jkai adapter emits a synthetic `finalize` with empty content
      // once `handle_message` finishes — the actual reply text has already
      // been delivered via prior `send` frames. The pump below uses
      // `job.partialResponse` (accumulated from those `send` frames) for
      // the final `message` field, so we don't return a `done` event here.
      // Returning empty so the pump's own finalize handling fires.
      return [];
    default:
      return [];
  }
}

async function handleWithHermes(reqEvent: Parameters<RequestHandler>[0]): Promise<Response> {
  const { request } = reqEvent;
  let body: { message?: string; workflowId?: string; conversationId?: string; chatNodeId?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { message, workflowId, conversationId, chatNodeId } = body;
  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return json({ error: `message too long (max ${MAX_MESSAGE_LEN} chars)` }, { status: 400 });
  }
  if (!HERMES_SECRET) {
    return json({ error: 'HERMES_BRIDGE_SECRET not configured' }, { status: 500 });
  }

  // chatId = the workflow we're chatting against (or a synthetic id when no
  // workflow context yet). sessionId names the per-user/per-workflow tab.
  const chatId = workflowId ?? `chat_${conversationId ?? chatNodeId ?? Date.now()}`;
  const userKey = conversationId ?? chatNodeId ?? 'anon';
  const sessionId = `sess_${userKey}_${chatId}`;
  const kindId = chatId;

  const { jobId, job } = createJob(message, { workflowId, conversationId, chatNodeId });
  const { abortController } = job;

  const client = new HermesClient({
    baseUrl: HERMES_URL,
    bridgeSecret: HERMES_SECRET,
  });

  // Fire-and-forget: pump Hermes frames into the legacy SSE buffer keyed by
  // jobId. The canvas UI then reads them off `/chat/stream?jobId=...` exactly
  // as it always has.
  (async () => {
    console.log(`[hermes-chat] Job ${jobId} started — workflowId=${workflowId ?? 'none'} chatId=${chatId} message="${message.slice(0, 100)}"`);
    try {
      await client.sendMessage({
        chatId,
        text: message,
        kind: 'canvas_chat',
        kindId,
        sessionId,
      });

      for await (const frame of client.openStream({
        chatId,
        kind: 'canvas_chat',
        kindId,
        sessionId,
      })) {
        if (abortController.signal.aborted) break;
        for (const ev of adaptFrameToCanvasSse(frame)) {
          if (ev.type === 'token' && typeof ev.delta === 'string') {
            job.partialResponse += ev.delta;
          }
          publishJobEvent(jobId, ev);
        }
        if (frame.kind === 'finalize') {
          // Use the accumulated partialResponse as the final message
          // because the adapter's finalize content is intentionally empty
          // (delivery already happened via prior `send` frames).
          job.status = 'done';
          const finalMessage = frame.content || job.partialResponse || '';
          job.result = { success: true, workflow: null, message: finalMessage };
          publishJobEvent(jobId, { type: 'done', result: job.result as Record<string, unknown> });
          break;
        }
      }

      if (job.status !== 'done') {
        // Stream ended without a finalize (timeout, server hang-up, etc.).
        // Surface what we got so the UI can render it.
        job.status = 'done';
        job.result = {
          success: true,
          workflow: null,
          message: job.partialResponse || '',
        };
        publishJobEvent(jobId, { type: 'done', result: job.result as Record<string, unknown> });
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[hermes-chat] Job failed:', errorMessage);
      job.status = 'error';
      job.error = errorMessage;
      job.result = { success: false, error: errorMessage };
      publishJobEvent(jobId, { type: 'error', message: errorMessage });
    }
  })();

  return json({ jobId });
}

// ---------------------------------------------------------------------------
// Legacy branch (flag OFF) — unchanged behaviour, body lifted into a helper.
// ---------------------------------------------------------------------------

async function handleWithLoop({ request }: Parameters<RequestHandler>[0]): Promise<Response> {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId: rawConversationId, attachmentIds, useIntelContext, chatNodeId } = body as {
    message: string;
    workflowId?: string;
    mode?: string;
    currentNodes?: any;
    currentEdges?: any;
    conversationId?: string;
    attachmentIds?: string[];
    useIntelContext?: boolean;
    chatNodeId?: string;
  };

  // Canvas chat: when a chat node is the source, ensure it has a pinned
  // conversation so prior messages on this canvas reload correctly. Each
  // chat node owns its own thread (mirrors the legacy /api/workflows/[id]/chat
  // behaviour we are replacing).
  let conversationId: string | undefined = rawConversationId;
  if (chatNodeId && workflowId && !conversationId) {
    const [chatNode] = await db.select().from(workflowNodes)
      .where(and(eq(workflowNodes.id, chatNodeId), eq(workflowNodes.workflowId, workflowId)))
      .limit(1);
    const cfg = (chatNode?.config as Record<string, unknown> | null) ?? {};
    const pinned = typeof cfg.conversationId === 'string' ? cfg.conversationId : null;
    if (pinned) {
      const [exists] = await db.select().from(conversations)
        .where(eq(conversations.id, pinned)).limit(1);
      if (exists) conversationId = pinned;
    }
    if (!conversationId) {
      const defaultCtx = await resolveDefaultModel('chat');
      const [conv] = await db.insert(conversations).values({
        title: message.slice(0, 50),
        source: 'web',
        modelProvider: defaultCtx.provider,
        modelId: defaultCtx.modelId,
      }).returning();
      conversationId = conv.id;
      if (chatNode) {
        await db.update(workflowNodes)
          .set({ config: { ...cfg, conversationId } })
          .where(and(eq(workflowNodes.id, chatNodeId), eq(workflowNodes.workflowId, workflowId)));
      }
    }
  }

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

  const { jobId, job } = createJob(message, { workflowId, conversationId, chatNodeId });
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
        const userMetadata = chatNodeId ? { chatNodeId } : undefined;
        let insertedUserMsg: { id: string } | null = null;
        if (conversationId) {
          const [m] = await db.insert(orchestratorChats).values({ conversationId, workflowId: workflowId ?? null, role: 'user', content: message, metadata: userMetadata }).returning({ id: orchestratorChats.id });
          insertedUserMsg = m;
        } else if (workflowId) {
          const [m] = await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: message, metadata: userMetadata }).returning({ id: orchestratorChats.id });
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
        // Resolved model is internal info (provider:modelId) — kept out of the
        // user-visible stream. Re-enable as a debug status if you need it back.
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
          jobId,
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
            // Aggregate streamed tokens so a user-initiated cancel can
            // persist what was streamed so far (otherwise the partial reply
            // visible in the UI vanishes the moment the stream is cut).
            if (event.type === 'token' && typeof event.delta === 'string') {
              job.partialResponse += event.delta;
            }
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
        const assistantMetaParts: Record<string, unknown> = {};
        if (cleanedToolSteps.length > 0) assistantMetaParts.toolSteps = cleanedToolSteps;
        if (chatNodeId) assistantMetaParts.chatNodeId = chatNodeId;
        const assistantMetadata = Object.keys(assistantMetaParts).length > 0 ? assistantMetaParts : undefined;
        let assistantMsgId: string | null = null;
        if (conversationId) {
          const [ins] = await db.insert(orchestratorChats).values({
            conversationId, workflowId: workflowId ?? null, role: 'assistant', content: responseText, metadata: assistantMetadata,
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
        // User-initiated cancel: persist whatever was streamed so far so
        // the partial reply doesn't disappear from the chat. Supersession
        // (cancelForScope) gets a different reason and is skipped — the
        // replacing job will produce its own assistant message.
        const isUserCancel = job.error === 'Cancelled by user';
        const partial = job.partialResponse?.trim();
        if (isUserCancel && partial && (conversationId || workflowId)) {
          try {
            const cancelMeta: Record<string, unknown> = { cancelled: true };
            if (chatNodeId) cancelMeta.chatNodeId = chatNodeId;
            await db.insert(orchestratorChats).values({
              conversationId: conversationId ?? null,
              workflowId: workflowId ?? null,
              role: 'assistant',
              content: job.partialResponse,
              metadata: cancelMeta,
            });
          } catch (persistErr) {
            console.error('[orchestrator] failed to persist cancelled partial:', persistErr instanceof Error ? persistErr.message : persistErr);
          }
        }
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
}

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

// PATCH: resolve a pending user-input waiter (plan_ack / confirm_ack / clarify_ack).
// The orchestrator coroutine registers waiters via createWaiter(jobId, key) and
// suspends until the user sends their decision through this endpoint.
export const PATCH: RequestHandler = async ({ request, url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) return json({ error: 'jobId required' }, { status: 400 });
  const job = getJob(jobId);
  if (!job) return json({ error: 'job not found' }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !('type' in body)) {
    return json({ error: 'body must include a type' }, { status: 400 });
  }

  const typed = body as
    | { type: 'plan_ack'; planId: string; decision: 'approved' | 'rejected' | 'adjusted'; adjustment?: string }
    | { type: 'confirm_ack'; confirmId: string; decision: 'approved' | 'rejected' }
    | { type: 'clarify_ack'; clarifyId: string; answers: Record<string, string> };

  let key: string;
  switch (typed.type) {
    case 'plan_ack':     key = `plan:${typed.planId}`; break;
    case 'confirm_ack':  key = `confirm:${typed.confirmId}`; break;
    case 'clarify_ack':  key = `clarify:${typed.clarifyId}`; break;
    default:             return json({ error: 'unknown ack type' }, { status: 400 });
  }

  const payload: unknown =
    typed.type === 'plan_ack'     ? { decision: typed.decision, adjustment: typed.adjustment } :
    typed.type === 'confirm_ack'  ? { decision: typed.decision } :
    /* clarify_ack */               { answers: typed.answers };

  const ok = respondToWaiter(jobId, key, payload);
  if (!ok) return json({ error: 'no waiter registered for that key' }, { status: 404 });

  // Echo the ack into the SSE stream so all subscribers see the user decision.
  publishJobEvent(jobId, typed as JobEvent);
  return json({ ok: true });
};
