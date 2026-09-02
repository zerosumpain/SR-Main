import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, jkaiAttachments, jkaiToolTraces } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { allocateCanvasName } from '$lib/canvas/adapter.server';
import { createJob, getJob, cancelJob, cancelAllRunning, cancelForScope, cleanOldJobs, deleteJob, listJobs, publishJobEvent, respondToWaiter, getRunningJobIdForConversation, markJobQueued, clearJobQueued, whenJobSettles } from '$lib/workflows/chat/job-store';
import type { OrchestratorJob, JobEvent } from '$lib/workflows/chat/job-store';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { extractEphemeralSidecar, type StoredToolStep } from '$lib/workflows/chat/ephemeral-sidecar';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { isThinkingLevel, type ThinkingLevel } from '$lib/models/thinking';
import { coerceModelContext } from '$lib/constants/default-models';
import { getChatInputCapabilities, canAcceptKind } from '$lib/server/models/capabilities';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
import {
  subscribeToolSteps,
  registerToolConfirmer,
  registerSecretRequester,
  type ToolStepEvent,
} from '$lib/jkai/tool-step-bus';
import { requireConfirmation } from '$lib/workflows/chat/confirmation-gate';
import { requireSecret, requireSecretUpdate } from '$lib/workflows/chat/secret-gate';
import { specForRequest } from '$lib/workflows/site-tools/tools/request-credential';
import { priceFor, computeCost } from '$lib/llm/pricing';
import type { TurnStamp } from '$lib/jkai/turn-stamp';
import { recordDurableLLMCall } from '$lib/llm/usage-log';
import { maybeExtractThreadConcepts } from '$lib/jkai/intel/chat-extract';
import { isRegisteredTool } from '$lib/workflows/site-tools/registry';
import { JKAI_EXTENDED_TOOL } from '$lib/mcp/meta-tool';
import { createTraceRecorder, compactStepsForMessage, type CompactToolStep } from '$lib/jkai/tool-trace';

const MAX_MESSAGE_LEN = 20_000;

export const POST: RequestHandler = async (event) => handleWithLoop(event);

// ---------------------------------------------------------------------------
// Legacy branch (flag OFF) — unchanged behaviour, body lifted into a helper.
// ---------------------------------------------------------------------------

async function handleWithLoop({ request }: Parameters<RequestHandler>[0]): Promise<Response> {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId: rawConversationId, attachmentIds, useIntelContext, chatNodeId, intelEntityIds, silent } = body as {
    message: string;
    workflowId?: string;
    mode?: string;
    /** Do not persist a user bubble for this turn — it is machinery, not
     *  conversation. This was once unread, so a silent `/model` push showed up
     *  in the thread as if the user had typed it. Nothing sends one now; this
     *  is the second lock on that door. */
    silent?: boolean;
    currentNodes?: any;
    currentEdges?: any;
    conversationId?: string;
    attachmentIds?: string[];
    useIntelContext?: boolean;
    chatNodeId?: string;
    /** Entity ids named with @entity in the composer. */
    intelEntityIds?: string[];
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
      const defaultCtx = await resolveDefaultModel();
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
  // use the builder model set in /admin/ai/models. General /jkai chats use the chat model.
  const isWorkflowContext = !!workflowId || mode === 'generate' || mode === 'modify';
  // Labels the job in the logs (workflow-context vs general chat). It no
  // longer selects a model — one default drives every task.
  const contextKind: 'chat' | 'builder' = isWorkflowContext ? 'builder' : 'chat';

  let attachmentRows: Array<typeof jkaiAttachments.$inferSelect> = [];
  if (attachmentIds && attachmentIds.length > 0) {
    if (attachmentIds.length > 10) {
      return json({ error: 'too many attachments (max 10 per turn)' }, { status: 400 });
    }
    attachmentRows = await db.select().from(jkaiAttachments).where(inArray(jkaiAttachments.id, attachmentIds));
    if (attachmentRows.length !== attachmentIds.length) {
      return json({ error: 'one or more attachmentIds not found' }, { status: 404 });
    }

    let ctx: ModelContext = await resolveDefaultModel();
    if (conversationId) {
      const [conv] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
      if (conv) ctx = coerceModelContext({ provider: conv.modelProvider, modelId: conv.modelId });
    }
    // Ask what this LANE can accept, not what the model can read. The composer
    // is served `getChatInputCapabilities` (see /api/jkai/conversations/[id]),
    // so gating here on the raw model truth meant the UI offered an upload it
    // then rejected with a 400 — on `codex/*`, which is TEXT_ONLY and the
    // pinned default, that is every image and every PDF. #427 built the
    // pre-analysis lane precisely so those work, and it lives downstream of
    // this guard in `generalChat`.
    //
    // Video still fails here, correctly — it has no extraction path.
    const caps = getChatInputCapabilities(ctx);
    for (const a of attachmentRows) {
      if (!canAcceptKind(caps, a.kind)) {
        return json(
          { error: `${a.kind} attachments are not supported on this chat engine` },
          { status: 400 },
        );
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

  // @entity grounding. The composer sends the ids it resolved, and the subgraph
  // is attached HERE rather than left to the model's recall — naming an entity
  // should mean the turn actually starts from what the graph holds about it.
  // Prepended to the outbound message only; the persisted user bubble stays
  // exactly what was typed.
  let outbound = message;
  if (Array.isArray(intelEntityIds) && intelEntityIds.length) {
    try {
      const { buildEntityGrounding } = await import('$lib/jkai/intel/context');
      const grounding = await buildEntityGrounding(intelEntityIds.slice(0, 5));
      if (grounding) outbound = `${grounding}\n\n---\n\n${message}`;
    } catch (err) {
      // Grounding is an enhancement; a failure must not cost the user their turn.
      console.warn('[intel] entity grounding failed:', err instanceof Error ? err.message : err);
    }
  }

  // Queue behind a turn that is still answering, rather than running alongside it.
  //
  // This did not always queue — so a second message sent while the
  // first was still working started a CONCURRENT turn against the same
  // conversation. Both then streamed into the same thread and both appended to
  // history, which is how an answer arrives interleaved with the one before it.
  //
  // There is no gateway to ask here, so the loop always queues: it is its own
  // executor, and two of its turns on one conversation are never wanted.
  const queuedBehindJobId = conversationId ? getRunningJobIdForConversation(conversationId) : null;

  const { jobId, job } = createJob(outbound, { workflowId, conversationId, chatNodeId, engine: 'loop' });
  const { abortController } = job;

  if (queuedBehindJobId) {
    markJobQueued(jobId, queuedBehindJobId);
    // Tell the user why nothing is happening yet — silence here reads as a hang.
    publishJobEvent(jobId, { type: 'status', text: 'Queued — finishing the previous message first' });
  }

  // Durable copy of this turn's tool chain, for /jkai/trace/<id>. This was
  // once unrecorded here, which silently turned the trace viewer off for every
  // turn this path served. `job.toolSteps`
  // still feeds the live tool cards and survives a reload in message metadata,
  // but it carries no server-side timestamps — durations and ordering only
  // exist here. Same recorder, fed the same JobEvents.
  const traceRecorder = createTraceRecorder();

  // Run the orchestrator in the background
  (async () => {
    if (queuedBehindJobId) {
      // Awaited here rather than before the response so the client still gets its
      // jobId straight away and can render a queued turn.
      console.log(`[orchestrator] Job ${jobId} queued behind ${queuedBehindJobId}`);
      await whenJobSettles(queuedBehindJobId);
      clearJobQueued(jobId);
      // The user may have cancelled while we waited; do not start a dead turn.
      if (abortController.signal.aborted) return;
    }
    console.log(`[orchestrator] Job ${jobId} started — kind=${contextKind} workflowId=${workflowId ?? 'none'} conversationId=${conversationId ?? 'none'} message: "${message.slice(0, 100)}"`);

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
          if (!silent) {
            const [m] = await db.insert(orchestratorChats).values({ conversationId, workflowId: workflowId ?? null, role: 'user', content: message, metadata: userMetadata }).returning({ id: orchestratorChats.id });
            insertedUserMsg = m;
          }
        } else if (workflowId) {
          if (!silent) {
            const [m] = await db.insert(orchestratorChats).values({ workflowId, role: 'user', content: message, metadata: userMetadata }).returning({ id: orchestratorChats.id });
            insertedUserMsg = m;
          }
        }

        if (insertedUserMsg && attachmentRows.length > 0) {
          await db.update(jkaiAttachments)
            .set({ messageId: insertedUserMsg.id })
            .where(inArray(jkaiAttachments.id, attachmentRows.map((a) => a.id)));
        }

        // Resolve the model pinned at conversation creation (or admin default).
        // Workflow-context chats (workflowId present) use the builder model; general /jkai chats use the chat model.
        let modelContext: ModelContext = await resolveDefaultModel();
        // Non-null ONLY when the owner chose the model in the picker. That is
        // what makes the rest of the session follow it — tools, sub-agents,
        // recall, compaction, OCR on an attachment, and any build this turn
        // starts. A thread simply stamped with the site default at creation
        // leaves this null, and every one of those keeps resolving its own model
        // exactly as before.
        let sessionModel: ModelContext | null = null;
        let priceSnapshot: PriceSnapshot | null = null;
        // The thread's own thinking level. Null for a thread that predates the
        // control, or one left on "auto" — both mean "send no reasoning field".
        let thinkingLevel: ThinkingLevel | null = null;
        // Resolved model is internal info (provider:modelId) — kept out of the
        // user-visible stream. Re-enable as a debug status if you need it back.
        if (conversationId) {
          const [conv] = await db
            .select()
            .from(conversations)
            .where(eq(conversations.id, conversationId))
            .limit(1);
          if (conv) {
            modelContext = coerceModelContext({
              provider: conv.modelProvider,
              modelId: conv.modelId,
            });
            if (conv.modelPinnedByUser) sessionModel = modelContext;
            priceSnapshot = conv.priceSnapshot as PriceSnapshot | null;
            thinkingLevel = isThinkingLevel(conv.thinkingLevel) ? conv.thinkingLevel : null;
          }
        }
        // Logged AFTER the thread's pin is applied, not before: this line used
        // to print the site default on every turn regardless of what the thread
        // was actually pinned to, which is the opposite of useful when the
        // question is "which model answered".
        console.log(
          `[orchestrator] Job ${jobId} — using ${modelContext.provider}:${modelContext.modelId}` +
            ` thinking=${thinkingLevel ?? 'auto'} session=${sessionModel ? 'pinned' : 'default'}` +
            ` (kind=${contextKind})`,
        );

        // Wall-clock for the whole turn, all rounds and tools included — the
        // number the reader actually waited. Stamped here rather than at job
        // creation so a spell queued behind another turn is not billed to this
        // one's latency.
        const turnStartedAt = Date.now();
        const { response: responseText, usage: turnUsage } = await generalChat({ text: message, attachments: attachmentRows }, conversationHistory, {
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
            // Observe before publishing so a throw in the recorder cannot cost
            // the user the event — it is wrapped for the same reason: a trace
            // is a diagnostic and must never take the reply down with it.
            try {
              traceRecorder.observe(event);
            } catch (err) {
              console.warn('[general-chat] trace recorder failed:', err instanceof Error ? err.message : err);
            }
            publishJobEvent(jobId, event);
          },
          modelContext,
          sessionModel,
          thinkingLevel,
          priceSnapshot,
          useIntelContext: useIntelContext !== false,
        });

        if (abortController.signal.aborted) throw new Error('Job cancelled');

        // Save the assistant response. Persist tool steps in metadata so the
        // tool-call drawer survives page reloads. User message was already
        // saved above.
        // ToolProgressStep.result is typed `unknown`; tool handlers return the
        // structured { success, data, error } envelope. Normalise into a
        // StoredToolStep (narrowing result) before lifting the ephemeral sidecar.
        const cleanedToolSteps = job.toolSteps.map((s) => {
          const r = s.result;
          const result =
            r && typeof r === 'object'
              ? (r as { success?: boolean; data?: Record<string, unknown>; error?: string })
              : undefined;
          const stored: StoredToolStep = {
            tool: s.tool,
            toolCallId: s.toolCallId,
            args: s.args,
            status: s.status,
            result,
          };
          return extractEphemeralSidecar(stored);
        });
        // Durable tool-chain copy for /jkai/trace/<id>. Best-effort
        // throughout: a trace is a diagnostic and must never cost the user
        // their reply. Keyed by jobId, so a re-run is idempotent and two
        // writers cannot collide. `costUsd` comes from the turn
        // stamp now; it stays null when the turn produced no usage at all,
        // because an absent number beats a wrong one.
        // Price the turn against the model that answered it.
        //
        // The loop never wrote `metadata.usage`, so four surfaces went blank at
        // the cutover: the per-reply MODEL/TOK/LATENCY/£ line, the thread token
        // count, the thread cost, and the context strip. Prod on 08-24: 12
        // assistant turns, 0 carrying usage, against 7/7 and 3/3 on the two
        // days before.
        //
        // Priced from `priceFor(provider, model)` rather than the conversation's
        // stored `price_snapshot`, which is null on every recent row because it
        // is only written by the model-switch PATCH — unreachable while the
        // picker is hidden (PR 8). Waiting for that would have left these rows
        // at zero even after the picker came back. The provider's own reported
        // figure still wins where it exists: a per-token table cannot see a
        // per-request fee.
        //
        // `priceFor` returns null for anything that is not OpenRouter, so a
        // Codex turn prices at 0 — which is the truth. It spends quota, not
        // cash. The UI declines to render a £ for it rather than claiming free.
        const turnStamp: TurnStamp | null = (() => {
          if (turnUsage.rounds === 0) return null;
          if (turnUsage.inputTokens === 0 && turnUsage.outputTokens === 0) return null;
          const provider = turnUsage.provider ?? modelContext.provider;
          const model = turnUsage.model ?? modelContext.modelId;
          const pricing = priceFor(provider, model);
          const costUsd =
            turnUsage.reportedCostUsd ??
            (pricing ? computeCost(pricing, turnUsage.inputTokens, turnUsage.outputTokens) : 0);
          return {
            model,
            provider,
            inputTokens: turnUsage.inputTokens,
            outputTokens: turnUsage.outputTokens,
            cacheReadTokens: turnUsage.cacheReadTokens || null,
            costUsd,
            latencyMs: Date.now() - turnStartedAt,
            rounds: turnUsage.rounds,
          };
        })();

        let traceId: string | null = null;
        if (traceRecorder.hasSteps() && (conversationId || workflowId)) {
          try {
            const trace = traceRecorder.snapshot();
            await db
              .insert(jkaiToolTraces)
              .values({
                id: jobId,
                conversationId: conversationId ?? null,
                workflowId: workflowId ?? null,
                prompt: (message ?? '').slice(0, 500),
                model: modelContext.modelId,
                provider: turnStamp?.provider ?? modelContext.provider,
                costUsd: turnStamp?.costUsd ?? null,
                stepCount: trace.stepCount,
                errorCount: trace.errorCount,
                durationMs: trace.durationMs,
                steps: trace,
              })
              .onConflictDoNothing();
            traceId = jobId;
          } catch (err) {
            console.error('[general-chat] failed to persist tool trace:', err instanceof Error ? err.message : err);
          }
        }

        const assistantMetaParts: Record<string, unknown> = {};
        if (cleanedToolSteps.length > 0) assistantMetaParts.toolSteps = cleanedToolSteps;
        if (traceId) assistantMetaParts.traceId = traceId;
        if (chatNodeId) assistantMetaParts.chatNodeId = chatNodeId;
        if (turnStamp) assistantMetaParts.usage = turnStamp;
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
          // No conversation or workflow pinned on entry. Check if a workflow-
          // creation tool succeeded mid-turn (typical on /jkai/workflows/new
          // and after design-confirm → workflow_build_from_spec). Back-fill
          // both the user message AND the assistant reply against that new
          // workflow id so the conversation survives the redirect.
          let backfillWorkflowId: string | null = null;
          for (const step of job.toolSteps) {
            const isBuilder = step.tool === 'workflow_build_from_spec' || step.tool === 'workflow_create';
            if (!isBuilder || step.status !== 'done') continue;
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

        // Link the trace to the message it explains. The trace row is written
        // before this insert (so the link never 404s), which is necessarily
        // before the row it points at exists. `/jkai/trace/<id>` and the analyse
        // endpoint both fall back to a lookup by `messageId`, so leaving it null
        // makes that fallback dead on every loop-served turn.
        if (assistantMsgId && traceId) {
          try {
            await db.update(jkaiToolTraces)
              .set({ messageId: assistantMsgId })
              .where(eq(jkaiToolTraces.id, traceId));
          } catch (err) {
            // A diagnostic link is never worth losing the user's reply over.
            console.warn('[general-chat] failed to link trace to message:', err instanceof Error ? err.message : err);
          }
        }

        // Accrue the turn onto the thread. Best-effort and in its own
        // try/catch, for the same reason as the trace write above: a rollup
        // failure must never cost the user their reply.
        //
        // `recordConversationUsage` is deliberately not used — it prices from
        // the stored `price_snapshot`, which is null on every recent row, so it
        // would add a real token count and a zero cost. The stamp has already
        // priced the turn properly.
        if (conversationId && turnStamp) {
          const dIn = turnStamp.inputTokens;
          const dOut = turnStamp.outputTokens;
          const dCost = turnStamp.costUsd;
          if (dIn > 0 || dOut > 0 || dCost > 0) {
            try {
              await db
                .update(conversations)
                .set({
                  promptTokens: sql`${conversations.promptTokens} + ${dIn}`,
                  completionTokens: sql`${conversations.completionTokens} + ${dOut}`,
                  costUsd: sql`${conversations.costUsd} + ${dCost.toFixed(6)}`,
                })
                .where(eq(conversations.id, conversationId));
            } catch (usageErr) {
              console.error(
                '[general-chat] failed to accrue usage onto conversation:',
                usageErr instanceof Error ? usageErr.message : usageErr,
              );
            }
          }
        }

        // Grow the thread's knowledge graph. Cadenced and fire-and-forget — the
        // reply is already written by this point, and an extraction failure must
        // never cost the user their turn.
        //
        // This call used to live ONLY in `handleWithHermes`. When Hermes was
        // removed (#489) the branch went and took the call with it, leaving the
        // import behind and nothing calling it — so chat entity extraction was
        // silently dead from 2026-08-24, the last day Hermes answered a chat,
        // until this. Production kept taking turns and stopped producing
        // `intel_notes` with source='chat' entirely; the knowledge graph beside
        // every thread since has been empty, which reads as a broken rail and is
        // not one. There is a test asserting this call exists, because "imported
        // but never called" is not something the type checker or the gate sees.
        if (conversationId) {
          void maybeExtractThreadConcepts(conversationId, null).catch(() => {});
        }

        job.result = {
          success: true,
          workflow: null,
          message: responseText,
          attachments: assistantAttachments,
          // The `analyse` link on a finished turn reads `result.traceId` LIVE and
          // `metadata.traceId` on reload. This branch set only the second, so the
          // button was missing while you watched the turn finish and then
          // appeared if you reloaded — which is exactly how it was reported.
          ...(traceId ? { traceId } : {}),
          // The client renders the ledger line from the live `done` payload and
          // from `metadata.usage` on reload. Both, or the line appears only
          // after a refresh.
          ...(turnStamp ? { usage: turnStamp } : {}),
        };
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
    | { type: 'clarify_ack'; clarifyId: string; answers: Record<string, string> }
    | { type: 'secret_ack'; requestId: string; handle?: string; stored: boolean };

  // A `secret_ack` sits one hop from a plaintext credential, and this handler
  // echoes the ack onto the SSE stream. REJECT any unexpected key rather than
  // stripping it: stripping would let a future edit quietly widen the shape
  // into a value channel, whereas a 400 shows up immediately.
  if ((body as { type?: string }).type === 'secret_ack') {
    const allowed = new Set(['type', 'requestId', 'handle', 'stored']);
    const extra = Object.keys(body as Record<string, unknown>).filter((k) => !allowed.has(k));
    if (extra.length) {
      return json(
        { error: `secret_ack accepts only ${[...allowed].join(', ')} — got unexpected ${extra.join(', ')}` },
        { status: 400 },
      );
    }
  }

  let key: string;
  switch (typed.type) {
    case 'plan_ack':     key = `plan:${typed.planId}`; break;
    case 'confirm_ack':  key = `confirm:${typed.confirmId}`; break;
    case 'clarify_ack':  key = `clarify:${typed.clarifyId}`; break;
    case 'secret_ack':   key = `secret:${typed.requestId}`; break;
    default:             return json({ error: 'unknown ack type' }, { status: 400 });
  }

  const payload: unknown =
    typed.type === 'plan_ack'     ? { decision: typed.decision, adjustment: typed.adjustment } :
    typed.type === 'confirm_ack'  ? { decision: typed.decision } :
    typed.type === 'secret_ack'   ? { stored: typed.stored === true, handle: typed.handle } :
    /* clarify_ack */               { answers: typed.answers };

  const ok = respondToWaiter(jobId, key, payload);
  if (!ok) {
    return json({ error: 'no waiter registered for that key' }, { status: 404 });
  }

  // Echo the ack into the SSE stream so all subscribers see the user decision.
  publishJobEvent(jobId, typed as JobEvent);
  return json({ ok: true });
};
