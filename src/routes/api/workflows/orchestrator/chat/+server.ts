import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { generateWorkflow, modifyWorkflow, saveWorkflowFromGenerated } from '$lib/workflows/orchestrator';
import { generalChat } from '$lib/workflows/chat/general-chat';
import type { WorkflowNodeDef, WorkflowEdgeDef } from '$lib/workflows/types';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, orchestratorChats, conversations, jkaiAttachments } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { allocateCanvasName } from '$lib/canvas/adapter.server';
import { createJob, getJob, cancelJob, cancelAllRunning, cancelForScope, cleanOldJobs, deleteJob, listJobs, publishJobEvent, respondToWaiter } from '$lib/workflows/chat/job-store';
import type { OrchestratorJob, JobEvent } from '$lib/workflows/chat/job-store';
import { loadConversationHistory } from '$lib/workflows/chat/conversation-history';
import { extractEphemeralSidecar, type StoredToolStep } from '$lib/workflows/chat/ephemeral-sidecar';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { coerceModelContext } from '$lib/constants/default-models';
import { getModelCapabilities, canAcceptKind } from '$lib/server/models/capabilities';
import type { ModelContext, PriceSnapshot } from '$lib/server/models/types';
import { HermesClient, type SseFrame } from '$lib/jkai/hermes-client';
import { adaptFrameToCanvasSse, adaptToolFrameToJobEvents, adaptSubagentFrameToJobEvents } from '$lib/jkai/sse-adapter';
import { subscribeToolSteps, registerToolConfirmer, type ToolStepEvent } from '$lib/jkai/tool-step-bus';
import { requireConfirmation } from '$lib/workflows/chat/confirmation-gate';
import { priceFor, computeCost } from '$lib/jkai/llm-pricing';
import { recordDurableLLMCall } from '$lib/jkai/llm-usage-log';
import { maybeExtractThreadConcepts } from '$lib/jkai/intel/chat-extract';
import { isRegisteredTool } from '$lib/workflows/site-tools/registry';
import { JKAI_EXTENDED_TOOL } from '$lib/mcp/meta-tool';

const MAX_MESSAGE_LEN = 20_000;

// Tools the SvelteKit MCP server dispatches itself (the site-tools registry
// plus the `jkai_extended` meta-dispatcher). Every one of these also publishes
// to the in-process tool-step bus when Hermes calls it, so we suppress the
// duplicate Hermes `tool` SSE frame for them (see the frame handler in
// handleWithHermes). Hermes built-ins / skills / other MCP servers aren't in
// here, so their frames still render.
const isBusServedTool = (toolName: string): boolean => {
  // Hermes namespaces MCP tools as `mcp_<server>_<tool>` (e.g.
  // `mcp_jkai_jkai_extended`). Strip that before the registry check so the
  // prefixed name is recognised as bus-served and its duplicate Hermes `tool`
  // frame is dropped — otherwise every jkai call renders twice (a raw-blob
  // Hermes card alongside the richer bus card).
  const bare = toolName.replace(/^mcp_[^_]+_/, '');
  return bare === JKAI_EXTENDED_TOOL.name || isRegisteredTool(bare) || toolName === JKAI_EXTENDED_TOOL.name || isRegisteredTool(toolName);
};

// jkai domain skills a user may pin from the composer (general chat only). When
// pinned, the turn is sent as kind='skill' with the name in kindId so the Hermes
// adapter loads it directly, skipping jkai-general's LLM routing turn. Validated
// here AND allowlisted again adapter-side. MUST match _PICKABLE_SKILLS in
// ~/.hermes-jkai/extensions/jkai_platform/adapter.py.
const PICKABLE_SKILLS = new Set([
  'jkai-blog', 'jkai-gmail', 'jkai-health', 'jkai-research', 'jkai-scheduled',
  'jkai-scraper', 'jkai-home-assistant', 'jkai-files', 'jkai-utility', 'jkai-node-builder',
]);

// Feature flag (Hermes Phase 1). When `JKAI_HERMES_CANVAS_CHAT=1`, canvas
// orchestrator chat is proxied through the Hermes gateway via HermesClient +
// JkaiPlatformAdapter; otherwise we keep running the legacy generalChat /
// ReAct loop here in-process. The flag is OFF by default — Task 14 is the
// soak that flips it.
const HERMES_ENABLED = env.JKAI_HERMES_CANVAS_CHAT === '1';
const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HERMES_SECRET = env.HERMES_BRIDGE_SECRET ?? '';

// Per-host origin metadata. Hermes runs on homeserv only; when the VPS
// forwards chats it must tell Hermes "I'm VPS — when you make tool calls,
// route them back to https://strangeramblings.com/api/mcp/local". The
// homeserv-local SvelteKit defaults to its own loopback MCP endpoint.
const HERMES_ORIGIN = (env.JKAI_HERMES_ORIGIN as 'vps' | 'homeserv') ?? 'homeserv';
const HERMES_MCP_URL = env.JKAI_HERMES_MCP_URL ?? 'http://127.0.0.1:5173/api/mcp/local';

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
/** Shape of a media attachment carried on an SSE media frame
 * (`image`/`audio`/`video`/`pdf`/`document`). Mirrors the
 * `Message['attachments']` element shape ChatArea.svelte consumes on `done`. */
type AssistantAttachment = {
  id: string;
  kind: 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';
  mimeType: string;
  originalName: string | null;
  sizeBytes: number;
  source: 'web' | 'whatsapp' | 'generated';
};

// adaptFrameToCanvasSse: see $lib/jkai/sse-adapter.ts. Extracted so
// the frame→JobEvent mapping is unit-testable without standing up a
// SvelteKit request context.

function extractAttachmentFromFrame(frame: SseFrame): AssistantAttachment | null {
  // Any frame that carries a media attachment row qualifies — gating on
  // `frame.attachment` rather than `frame.kind === 'image'` is what lets
  // audio / video / pdf / document frames flow through alongside the
  // original image path without enumerating every kind here.
  const att = frame.attachment;
  if (!att || typeof att.id !== 'string') return null;
  return {
    id: att.id,
    kind: att.kind,
    mimeType: att.mimeType,
    originalName: att.originalName ?? null,
    sizeBytes: att.sizeBytes,
    source: att.source,
  };
}

async function handleWithHermes(reqEvent: Parameters<RequestHandler>[0]): Promise<Response> {
  const { request } = reqEvent;
  let body: {
    message?: string;
    workflowId?: string;
    conversationId?: string;
    chatNodeId?: string;
    silent?: boolean;
    pinnedSkill?: string;
    /** Entity ids named with @entity in the composer. */
    intelEntityIds?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { message, workflowId, conversationId, chatNodeId, silent, pinnedSkill, intelEntityIds } = body;
  if (!message || typeof message !== 'string') {
    return json({ error: 'message is required' }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_LEN) {
    return json({ error: `message too long (max ${MAX_MESSAGE_LEN} chars)` }, { status: 400 });
  }
  if (!HERMES_SECRET) {
    return json({ error: 'HERMES_BRIDGE_SECRET not configured' }, { status: 500 });
  }

  // Supersede any in-flight job on the same scope BEFORE we start the new
  // one. Mirrors legacy semantics: a new message on the same canvas cancels
  // the old one (issue #2 from the Phase 1 cross-cutting review).
  if (workflowId || conversationId) {
    cancelForScope({ workflowId, conversationId }, 'Superseded by new request');
  }
  cleanOldJobs();

  // chatId = the workflow we're chatting against (or a synthetic id when no
  // workflow context yet). sessionId names the per-user/per-workflow tab.
  const chatId = workflowId ?? `chat_${conversationId ?? chatNodeId ?? Date.now()}`;
  const userKey = conversationId ?? chatNodeId ?? 'anon';
  const sessionId = `sess_${userKey}_${chatId}`;

  // Pinned-skill override (general chat only): when the user pins a jkai domain
  // in the composer, force kind='skill' so the Hermes adapter loads that skill
  // directly (name in kindId), skipping jkai-general's LLM routing turn. Ignored
  // in canvas context (jkai-canvas owns that) and validated against the
  // allowlist. For 'skill', kindId carries the skill name rather than chatId —
  // safe because the inbound verifier checks the token scope against the request
  // body (they agree by construction) and tool/MCP routing keys on chat_id.
  const pinnedSkillName =
    !workflowId && typeof pinnedSkill === 'string' && PICKABLE_SKILLS.has(pinnedSkill)
      ? pinnedSkill
      : null;
  const kind = workflowId
    ? ('canvas_chat' as const)
    : pinnedSkillName
      ? ('skill' as const)
      : ('manual' as const);
  const kindId = pinnedSkillName ?? chatId;

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

  const { jobId, job } = createJob(outbound, { workflowId, conversationId, chatNodeId });
  const { abortController } = job;

  // Wall-clock for the turn, stamped onto the assistant message so every reply
  // carries its own latency alongside its token count and price.
  const turnStartedAt = Date.now();

  // Persist the user message before kicking off Hermes so canvas reload
  // mid-conversation restores the just-sent bubble. Mirrors legacy
  // handleWithLoop persistence (issue #1 from the cross-cutting review).
  // Schema cols: workflowId, conversationId, role, content, metadata (jsonb).
  //
  // `silent: true` skips this insert. It's set by UI affordances that send
  // a slash command on the user's behalf (e.g. the in-chat Approve / Deny
  // buttons) — the command must reach Hermes but should not clutter the
  // visible history with `/approve` bubbles the user never typed.
  const userMetadata = chatNodeId ? { chatNodeId } : undefined;
  if (!silent && conversationId) {
    await db.insert(orchestratorChats).values({
      conversationId,
      workflowId: workflowId ?? null,
      role: 'user',
      content: message,
      metadata: userMetadata,
    });
  } else if (!silent && workflowId) {
    await db.insert(orchestratorChats).values({
      workflowId,
      role: 'user',
      content: message,
      metadata: userMetadata,
    });
  }

  const client = new HermesClient({
    baseUrl: HERMES_URL,
    bridgeSecret: HERMES_SECRET,
    defaultOrigin: HERMES_ORIGIN,
    defaultMcpUrl: HERMES_MCP_URL,
  });

  // Attachments produced by site-tools (e.g. write_document) during this
  // turn. Hoisted here so the tool-step subscriber (below) and the stream
  // pump (async IIFE) can both access it. The pump folds these into the
  // final `done` event's `result.attachments` so MessageAttachments renders
  // them inline.
  const turnAttachments: AssistantAttachment[] = [];
  // @files (file_search) hits promoted onto this turn so the chat UI can render
  // clickable "sources" chips. Mirrors turnAttachments: collected from the
  // file_search tool result, emitted on `done`, and persisted in the assistant
  // message metadata so they survive a reload. (Tool steps themselves are not
  // persisted on the Hermes branch, so scraping toolSteps client-side is unreliable.)
  type FileRef = {
    fileId: string; source: string; modality: string; score: number;
    chunkOrd?: number; charStart?: number; charEnd?: number; passage: string;
  };
  const turnFileRefs: FileRef[] = [];
  const seenFileRefs = new Set<string>();
  // @research (research_search) hits promoted onto this turn, mirroring
  // turnFileRefs. Each cites a fact from a deep-dive research session, with its
  // session topic + web source, so the chat UI can render clickable "sources"
  // chips linking to the source URL or the /deepdive session.
  type ResearchRef = {
    factId: string; sourceId: string | null; sessionId: string; sessionTopic: string;
    sourceTitle: string | null; sourceUrl: string | null; domain: string | null;
    score: number; passage: string;
  };
  const turnResearchRefs: ResearchRef[] = [];
  const seenResearchRefs = new Set<string>();
  // Workflow chips: when a builder tool creates/updates a canvas this turn,
  // attach a deep-link chip to the reply (mirrors turnFileRefs' lifecycle).
  type WorkflowRef = { workflowId: string; slug: string; name: string; url: string };
  const turnWorkflowRefs: WorkflowRef[] = [];
  const seenWorkflowRefs = new Set<string>();

  // Per-turn LLM usage captured from the Hermes finalize frame's
  // `metadata.usage`. Populated inside the stream pump; consumed after
  // assistant-message persistence to accumulate onto the conversation row.
  let turnUsage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;
    cost_usd?: number;
    model?: string | null;
    provider?: string | null;
  } | null = null;

  // The priced form of the above, stamped onto the assistant message and handed
  // to the client on `done` so the per-turn cost line appears the moment the
  // reply lands rather than only after a reload.
  type TurnStamp = {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number | null;
    costUsd: number;
    latencyMs: number;
  };
  let turnStamp: TurnStamp | null = null;

  /** Price the captured turn against the conversation's own model. Hermes
   *  reports token counts but its cost estimate is unreliable for models its
   *  pricing tables don't cover (it returns 0), so our table wins and Hermes's
   *  number is only the fallback. */
  async function priceTurn(): Promise<TurnStamp | null> {
    if (!turnUsage) return null;
    const inputTokens = Math.max(0, Math.round(turnUsage.input_tokens ?? 0));
    const outputTokens = Math.max(0, Math.round(turnUsage.output_tokens ?? 0));
    if (inputTokens === 0 && outputTokens === 0) return null;

    let provider = 'openrouter';
    let model = 'z-ai/glm-5.2';
    let costUsd = 0;
    try {
      if (conversationId) {
        const [conv] = await db
          .select({ provider: conversations.modelProvider, modelId: conversations.modelId })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .limit(1);
        if (conv) {
          provider = conv.provider;
          model = conv.modelId;
        }
      }
      const pricing = priceFor(provider, model);
      costUsd = pricing
        ? computeCost(pricing, inputTokens, outputTokens)
        : Math.max(0, turnUsage.cost_usd ?? 0);
    } catch (err) {
      console.error('[hermes-chat] failed to price turn:', err instanceof Error ? err.message : err);
      costUsd = Math.max(0, turnUsage.cost_usd ?? 0);
    }

    return {
      model: turnUsage.model ?? model,
      provider: turnUsage.provider ?? provider,
      inputTokens,
      outputTokens,
      cacheReadTokens: turnUsage.cache_read_tokens ?? null,
      costUsd,
      latencyMs: Date.now() - turnStartedAt,
    };
  }

  // Subscribe to tool-step events for this chat. The MCP dispatcher publishes
  // a started/completed/failed event for every tools/call carrying a
  // matching workflow_id argument (= chatId for general /jkai chats, or the
  // canvas workflowId for canvas chats). We forward them as legacy
  // `tool_start` / `tool_result` JobEvents so the canvas UI's panel works
  // identically on the Hermes branch.
  // Additionally, when a site-tool result contains inline attachments (e.g.
  // write_document returns `{ attachments: [row] }`), we promote those into
  // `turnAttachments` so the chat UI renders a download link.
  const toolStepKey = chatId; // Hermes sends kindId (= chatId) as workflow_id

  // Destructive-tool gate. The MCP dispatcher raises a confirmation request for
  // any tool flagged `destructive` in the registry; it knows only `busKey`
  // (= chatId), not `jobId`, so this is where the two are joined. Delegates to
  // the existing `requireConfirmation` → `confirm` JobEvent → ConfirmBanner →
  // `confirm_ack` waiter chain, unchanged. Unregistered in the same cleanup
  // block as the tool-step subscription, or a stale confirmer would answer for
  // a job that has already finished.
  const unregisterConfirmer = registerToolConfirmer(toolStepKey, async (req) => {
    if (abortController.signal.aborted) {
      return { approved: false, reason: 'the turn was cancelled' };
    }
    const approved = await requireConfirmation(jobId, req.prompt, req.args, { destructive: true });
    return { approved, reason: approved ? undefined : 'the user declined it' };
  });
  const unsubscribeToolSteps = subscribeToolSteps(toolStepKey, (e: ToolStepEvent) => {
    if (abortController.signal.aborted) return;
    if (e.phase === 'started') {
      publishJobEvent(jobId, {
        type: 'tool_start',
        tool: e.tool,
        args: e.args ?? {},
        toolCallId: e.stepId,
        summary: e.summary,
      });
      return;
    }
    if (e.phase === 'progress') {
      // Long-running tools (workflow_create + generateWorkflow's internal loop)
      // emit free-text progress chunks via ctx.emit. The MCP dispatcher routes
      // them onto the bus as `progress` events; surface them as `status` so the
      // chat UI's existing status-bubble path renders them inline.
      if (e.summary) {
        publishJobEvent(jobId, { type: 'status', text: e.summary });
      }
      return;
    }
    // completed | failed → tool_result
    publishJobEvent(jobId, {
      type: 'tool_result',
      tool: e.tool,
      result: e.phase === 'failed' ? { error: e.error ?? 'unknown error' } : (e.result ?? e.resultPreview ?? null),
      status: e.phase === 'failed' ? 'error' : 'done',
      toolCallId: e.stepId,
      summary: e.summary,
    });
    // Promote inline attachments from site-tool results into turnAttachments
    // so the chat UI renders download links. write_document (and similar)
    // site-tools save to DB and return { attachments: [row] } in their tool
    // result — but unlike adapter-emitted media frames, those never go
    // through the SSE OutboundFrame path. We bridge that gap here.
    if (e.phase === 'completed' && e.result && typeof e.result === 'object') {
      const result = e.result as Record<string, unknown>;
      const atts = result.attachments;
      if (Array.isArray(atts)) {
        for (const a of atts) {
          if (a && typeof a === 'object' && typeof (a as Record<string, unknown>).id === 'string') {
            const row = a as Record<string, unknown>;
            turnAttachments.push({
              id: String(row.id),
              kind: (String(row.kind ?? 'text') as AssistantAttachment['kind']),
              mimeType: String(row.mimeType ?? 'application/octet-stream'),
              originalName: row.originalName != null ? String(row.originalName) : null,
              sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
              source: (String(row.source ?? 'generated') as AssistantAttachment['source']),
            });
          }
        }
      }

      // Promote @files (file_search) hits into turnFileRefs for clickable "sources".
      // On prod, file_search is invoked via the jkai_extended meta-tool. The
      // COMPLETED bus event does NOT carry `args` (only `started` does), so we
      // can't gate on args.name here — instead detect file_search by tool name +
      // the distinctive result shape (data.hits of {fileId, source, passage}).
      // The per-hit validation below rejects any other jkai_extended result.
      const maybeFileSearch = e.tool === 'file_search' || e.tool === 'jkai_extended';
      if (maybeFileSearch && result.success) {
        const data = (result.data ?? {}) as Record<string, unknown>;
        const hits = data.hits;
        if (Array.isArray(hits)) {
          for (const raw of hits) {
            const h = raw as Record<string, unknown>;
            if (!h || typeof h.fileId !== 'string' || typeof h.source !== 'string') continue;
            const key = h.fileId + ':' + (typeof h.chunkOrd === 'number' ? h.chunkOrd : '');
            if (seenFileRefs.has(key) || turnFileRefs.length >= 12) continue;
            seenFileRefs.add(key);
            turnFileRefs.push({
              fileId: h.fileId,
              source: h.source,
              modality: typeof h.modality === 'string' ? h.modality : 'text',
              score: typeof h.score === 'number' ? h.score : 0,
              chunkOrd: typeof h.chunkOrd === 'number' ? h.chunkOrd : undefined,
              charStart: typeof h.charStart === 'number' ? h.charStart : undefined,
              charEnd: typeof h.charEnd === 'number' ? h.charEnd : undefined,
              passage: typeof h.passage === 'string' ? h.passage.slice(0, 800) : '',
            });
          }
        }
      }

      // Promote @research (research_search) hits into turnResearchRefs. Same
      // shape/rationale as file_search above: on prod the tool is invoked via
      // jkai_extended, whose COMPLETED event carries no args, so detect by the
      // distinctive hit shape (factId + sessionId). The two promotions coexist
      // on a jkai_extended result — each validates its own key so they can't
      // cross-contaminate (file hits have fileId, research hits have factId).
      const maybeResearchSearch = e.tool === 'research_search' || e.tool === 'jkai_extended';
      if (maybeResearchSearch && result.success) {
        const data = (result.data ?? {}) as Record<string, unknown>;
        const hits = data.hits;
        if (Array.isArray(hits)) {
          for (const raw of hits) {
            const h = raw as Record<string, unknown>;
            if (!h || typeof h.factId !== 'string' || typeof h.sessionId !== 'string') continue;
            if (seenResearchRefs.has(h.factId) || turnResearchRefs.length >= 12) continue;
            seenResearchRefs.add(h.factId);
            turnResearchRefs.push({
              factId: h.factId,
              sourceId: typeof h.sourceId === 'string' ? h.sourceId : null,
              sessionId: h.sessionId,
              sessionTopic: typeof h.sessionTopic === 'string' ? h.sessionTopic : '',
              sourceTitle: typeof h.sourceTitle === 'string' ? h.sourceTitle : null,
              sourceUrl: typeof h.sourceUrl === 'string' ? h.sourceUrl : null,
              domain: typeof h.domain === 'string' ? h.domain : null,
              score: typeof h.score === 'number' ? h.score : 0,
              passage: typeof h.passage === 'string' ? h.passage.slice(0, 800) : '',
            });
          }
        }
      }

      // Promote @knowledge (knowledge_search) hits into the SAME file/research
      // ref arrays so they inherit the existing clickable-source chips + inline
      // citations + viewers. A knowledge hit's identity lives under `ref` (not
      // top-level), so the two branches above skip it — we unwrap it here and
      // route file/research-backed hits to their viewer. memory/datastore hits
      // have no viewer, so they stay inline-only (no chip).
      const maybeKnowledge = e.tool === 'knowledge_search' || e.tool === 'jkai_extended';
      if (maybeKnowledge && result.success) {
        const data = (result.data ?? {}) as Record<string, unknown>;
        const hits = data.hits;
        if (Array.isArray(hits)) {
          for (const raw of hits) {
            const h = raw as Record<string, unknown>;
            const ref = (h?.ref ?? {}) as Record<string, unknown>;
            const passage = typeof h?.passage === 'string' ? h.passage.slice(0, 800) : '';
            const score = typeof h?.score === 'number' ? h.score : 0;
            if (h?.source === 'files' && typeof ref.fileId === 'string' && typeof ref.source === 'string') {
              const key = ref.fileId + ':' + (typeof ref.chunkOrd === 'number' ? ref.chunkOrd : '');
              if (seenFileRefs.has(key) || turnFileRefs.length >= 12) continue;
              seenFileRefs.add(key);
              turnFileRefs.push({
                fileId: ref.fileId,
                source: ref.source,
                modality: typeof ref.modality === 'string' ? ref.modality : 'text',
                score,
                chunkOrd: typeof ref.chunkOrd === 'number' ? ref.chunkOrd : undefined,
                charStart: typeof ref.charStart === 'number' ? ref.charStart : undefined,
                charEnd: typeof ref.charEnd === 'number' ? ref.charEnd : undefined,
                passage,
              });
            } else if (h?.source === 'research' && typeof ref.factId === 'string' && typeof ref.sessionId === 'string') {
              if (seenResearchRefs.has(ref.factId) || turnResearchRefs.length >= 12) continue;
              seenResearchRefs.add(ref.factId);
              turnResearchRefs.push({
                factId: ref.factId,
                sourceId: null,
                sessionId: ref.sessionId,
                sessionTopic: typeof h.title === 'string' ? h.title : '',
                sourceTitle: typeof ref.sourceTitle === 'string' ? ref.sourceTitle : null,
                sourceUrl: typeof ref.sourceUrl === 'string' ? ref.sourceUrl : null,
                domain: null,
                score,
                passage,
              });
            }
          }
        }
      }

      // Promote workflow-builder successes into turnWorkflowRefs so the reply
      // carries a deep-link chip to the created/updated canvas. The builder
      // tools' success payloads all include workflowId + slug + url (see
      // tools/workflows.ts `data`); monitor_create returns the marker shape.
      const isBuilderTool =
        e.tool === 'workflow_build_from_spec' || e.tool === 'workflow_create' || e.tool === 'monitor_create';
      if (isBuilderTool && result.success) {
        const data = (result.data ?? {}) as Record<string, unknown>;
        // monitor_create nests the marker under `monitor`; builders are flat.
        const src = (data.workflowId ? data : (data.monitor ?? {})) as Record<string, unknown>;
        const workflowId = typeof src.workflowId === 'string' ? src.workflowId : null;
        const slug = typeof src.slug === 'string' ? src.slug : null;
        if (workflowId && slug && !seenWorkflowRefs.has(workflowId) && turnWorkflowRefs.length < 6) {
          seenWorkflowRefs.add(workflowId);
          turnWorkflowRefs.push({
            workflowId,
            slug,
            name:
              typeof src.name === 'string' && src.name
                ? src.name
                : typeof src.description === 'string' && src.description
                  ? src.description.slice(0, 60)
                  : slug,
            url: `/jkai/canvas/${slug}`,
          });
        }
      }
    }
  });

  // Fire-and-forget: pump Hermes frames into the legacy SSE buffer keyed by
  // jobId. The canvas UI then reads them off `/chat/stream?jobId=...` exactly
  // as it always has.
  (async () => {
    console.log(`[hermes-chat] Job ${jobId} started — workflowId=${workflowId ?? 'none'} chatId=${chatId} message="${message.slice(0, 100)}"`);
    // `kind` / `kindId` were resolved above (they gate the auth scope + the
    // adapter's skill selection): 'canvas_chat' → jkai-canvas, 'skill' → the
    // pinned jkai-* domain (carried in kindId), 'manual' → jkai-general routing.
    try {
      await client.sendMessage({
        chatId,
        text: message,
        kind,
        kindId,
        sessionId,
      });

      // NOTE: turnAttachments is hoisted above (outer scope) so both the
      // tool-step subscriber and this stream pump can contribute to it.

      // Hermes' framework injects a one-time "📬 No home channel is set
      // for Jkai…" onboarding notice at the start of any chat whose
      // platform isn't wired into the cron / cross-platform delivery map.
      // It's a meta-notification, not an agent reply — but it arrives as a
      // plain `send` frame and would otherwise (a) be streamed to the chat
      // UI as a token bubble, (b) get concatenated into `partialResponse`
      // and persisted as the *start* of the assistant row, and (c) drag any
      // turn-emitted attachments onto that row instead of the actual reply.
      // Suppress it.
      const HERMES_HOME_CHANNEL_NOTICE_PREFIX = '📬 No home channel is set for Jkai';

      for await (const frame of client.openStream({
        chatId,
        kind,
        kindId,
        sessionId,
      }, { signal: abortController.signal })) {
        if (abortController.signal.aborted) break;
        if (
          (frame.kind === 'send' || frame.kind === 'replace') &&
          frame.content.startsWith(HERMES_HOME_CHANNEL_NOTICE_PREFIX)
        ) {
          continue;
        }
        // Surface Hermes tool-call frames onto the tool-step panel. Hermes
        // core fires send_tool for EVERY agent tool call (gateway/run.py wires
        // the tool_start/complete callbacks with no MCP gating), so this is a
        // SECOND source of telemetry that OVERLAPS the in-process tool-step bus
        // (subscribed above) for any tool routing back through THIS SvelteKit
        // MCP server. The bus is the richer source (full untruncated result →
        // inline artifacts + attachment promotion, plus mid-call progress), so
        // `adaptToolFrameToJobEvents(frame, isBusServedTool)` drops the
        // duplicate frame for bus-served tools and keeps it only for Hermes
        // built-ins / skills / other MCP servers. It also returns [] for any
        // non-tool or malformed frame, so this is a no-op for text/media frames
        // and can never crash the stream.
        // Live delegate_task child activity → sub-agent visualizer JobEvents.
        // These also naturally reset the job's idle watchdog (defence in depth
        // alongside the activeDelegations tracking in job-store).
        if (frame.kind === 'subagent') {
          for (const ev of adaptSubagentFrameToJobEvents(frame)) publishJobEvent(jobId, ev);
          continue;
        }
        if (frame.kind === 'tool') {
          for (const ev of adaptToolFrameToJobEvents(frame, isBusServedTool)) {
            // Mirror the bus subscriber: promote inline attachments returned
            // by a tool (e.g. write_document → { attachments: [row] }) into
            // turnAttachments so the chat UI renders download links.
            if (ev.type === 'tool_result' && ev.status === 'done' && ev.result && typeof ev.result === 'object') {
              const atts = (ev.result as Record<string, unknown>).attachments;
              if (Array.isArray(atts)) {
                for (const a of atts) {
                  if (a && typeof a === 'object' && typeof (a as Record<string, unknown>).id === 'string') {
                    const row = a as Record<string, unknown>;
                    turnAttachments.push({
                      id: String(row.id),
                      kind: String(row.kind ?? 'text') as AssistantAttachment['kind'],
                      mimeType: String(row.mimeType ?? 'application/octet-stream'),
                      originalName: row.originalName != null ? String(row.originalName) : null,
                      sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : 0,
                      source: String(row.source ?? 'generated') as AssistantAttachment['source'],
                    });
                  }
                }
              }
            }
            publishJobEvent(jobId, ev);
          }
          continue;
        }
        // Try every frame — `extractAttachmentFromFrame` returns null when
        // `frame.attachment` is absent, so text-bubble frames (send / replace /
        // finalize) are no-ops here, while image / audio / video / pdf /
        // document frames contribute their attachment row to `turnAttachments`.
        const att = extractAttachmentFromFrame(frame);
        if (att) turnAttachments.push(att);
        for (const ev of adaptFrameToCanvasSse(frame)) {
          if (ev.type === 'token' && typeof ev.delta === 'string') {
            job.partialResponse += ev.delta;
          } else if (ev.type === 'replace_bubble') {
            // Hermes asked us to swap out the in-flight bubble. The previous
            // `partialResponse` is now obsolete — reset to the new content so
            // the eventual finalize doesn't carry stacked duplicates.
            job.partialResponse = ev.content;
          }
          publishJobEvent(jobId, ev);
        }
        if (frame.kind === 'finalize') {
          // Capture per-turn LLM usage from the adapter's synthetic finalize
          // frame so we can accrue it onto the conversation row below.
          const rawUsage = (frame.metadata as Record<string, unknown> | undefined)?.['usage'];
          if (rawUsage && typeof rawUsage === 'object') {
            const ru = rawUsage as Record<string, unknown>;
            turnUsage = {
              input_tokens: typeof ru['input_tokens'] === 'number' ? ru['input_tokens'] : undefined,
              output_tokens: typeof ru['output_tokens'] === 'number' ? ru['output_tokens'] : undefined,
              cache_read_tokens: typeof ru['cache_read_tokens'] === 'number' ? ru['cache_read_tokens'] : undefined,
              cost_usd: typeof ru['cost_usd'] === 'number' ? ru['cost_usd'] : undefined,
              model: ru['model'] != null ? String(ru['model']) : null,
              provider: ru['provider'] != null ? String(ru['provider']) : null,
            };
          }

          turnStamp = await priceTurn();

          // Use the accumulated partialResponse as the final message
          // because the adapter's finalize content is intentionally empty
          // (delivery already happened via prior `send` frames).
          job.status = 'done';
          const finalMessage = frame.content || job.partialResponse || '';
          job.result = {
            success: true,
            workflow: null,
            message: finalMessage,
            attachments: turnAttachments.length > 0 ? turnAttachments : undefined,
            fileRefs: turnFileRefs.length > 0 ? turnFileRefs : undefined,
            researchRefs: turnResearchRefs.length > 0 ? turnResearchRefs : undefined,
            workflowRefs: turnWorkflowRefs.length > 0 ? turnWorkflowRefs : undefined,
            // Hand the client the provider's own completion-token count (which
            // includes reasoning and tool-call tokens) so the /jkai tok/s meter
            // can settle its streamed chars/4 estimate against a real number —
            // plus the priced stamp the reply renders beneath itself.
            usage: turnStamp
              ? { outputTokens: turnStamp.outputTokens, stamp: turnStamp }
              : turnUsage?.output_tokens != null
                ? { outputTokens: turnUsage.output_tokens }
                : undefined,
          };
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
          attachments: turnAttachments.length > 0 ? turnAttachments : undefined,
          fileRefs: turnFileRefs.length > 0 ? turnFileRefs : undefined,
          researchRefs: turnResearchRefs.length > 0 ? turnResearchRefs : undefined,
          workflowRefs: turnWorkflowRefs.length > 0 ? turnWorkflowRefs : undefined,
        };
        publishJobEvent(jobId, { type: 'done', result: job.result as Record<string, unknown> });
      }

      // Persist the assistant reply so canvas reload restores history.
      // Mirrors legacy handleWithLoop. Tool steps aren't tracked on the
      // Hermes branch (yet), so we only record chatNodeId in metadata when
      // present.
      const finalText =
        (job.result && typeof (job.result as Record<string, unknown>).message === 'string'
          ? ((job.result as Record<string, unknown>).message as string)
          : '') || job.partialResponse || '';
      const shouldPersist =
        (finalText || turnAttachments.length > 0 || turnFileRefs.length > 0 || turnResearchRefs.length > 0 || turnWorkflowRefs.length > 0) && (conversationId || workflowId);
      if (shouldPersist) {
        // A turn that finished without a finalize frame (timeout, hang-up) never
        // reached priceTurn() — price it here so even a truncated reply carries
        // its stamp.
        if (!turnStamp) turnStamp = await priceTurn();

        try {
          const assistantMeta: Record<string, unknown> = {};
          if (chatNodeId) assistantMeta.chatNodeId = chatNodeId;
          // The per-turn ledger the redesign renders beneath every reply. A turn
          // whose cost only exists as a delta on the conversation total can't be
          // shown where it sits.
          if (turnStamp) assistantMeta.usage = turnStamp;
          if (turnAttachments.length > 0) {
            assistantMeta.attachments = turnAttachments.map((a) => a.id);
          }
          if (turnFileRefs.length > 0) {
            assistantMeta.fileRefs = turnFileRefs;
          }
          if (turnResearchRefs.length > 0) {
            assistantMeta.researchRefs = turnResearchRefs;
          }
          if (turnWorkflowRefs.length > 0) {
            assistantMeta.workflowRefs = turnWorkflowRefs;
          }
          const assistantMetadata = Object.keys(assistantMeta).length > 0 ? assistantMeta : undefined;
          const [insertedAssistant] = await db.insert(orchestratorChats).values({
            conversationId: conversationId ?? null,
            workflowId: workflowId ?? null,
            role: 'assistant',
            content: finalText,
            metadata: assistantMetadata,
          }).returning({ id: orchestratorChats.id });
          // Back-fill messageId on the attachments uploaded by the plugin so
          // the conversation-reload endpoint joins them onto this message.
          if (insertedAssistant && turnAttachments.length > 0) {
            await db.update(jkaiAttachments)
              .set({ messageId: insertedAssistant.id, conversationId: conversationId ?? null })
              .where(inArray(jkaiAttachments.id, turnAttachments.map((a) => a.id)));
          }
        } catch (persistErr) {
          console.error('[hermes-chat] failed to persist assistant message:', persistErr instanceof Error ? persistErr.message : persistErr);
        }

        // Accrue per-turn LLM cost onto the conversation row. This is a
        // best-effort atomic increment — a failure here must not surface to
        // the user or break message persistence, hence its own try/catch.
        try {
          if (conversationId && turnStamp) {
            const dIn = turnStamp.inputTokens;
            const dOut = turnStamp.outputTokens;
            const dCost = turnStamp.costUsd;
            if (dIn > 0 || dOut > 0 || dCost > 0) {
              await db
                .update(conversations)
                .set({
                  promptTokens: sql`${conversations.promptTokens} + ${dIn}`,
                  completionTokens: sql`${conversations.completionTokens} + ${dOut}`,
                  costUsd: sql`${conversations.costUsd} + ${dCost.toFixed(6)}`,
                })
                .where(eq(conversations.id, conversationId));
              // Also land this Hermes turn in the durable cost ledger so
              // /admin/ops/costs reflects /jkai chat spend. Hermes runs outside
              // the SvelteKit gateway, so installUsageCapture never sees it.
              recordDurableLLMCall({
                provider: turnStamp.provider,
                model: turnStamp.model,
                tokensInput: dIn,
                tokensOutput: dOut,
                costUsd: dCost,
                source: 'jkai-chat',
                sessionId: conversationId,
              });
            }
          }
        } catch (usageErr) {
          console.error('[hermes-chat] failed to accrue usage onto conversation:', usageErr instanceof Error ? usageErr.message : usageErr);
        }

        // Grow the thread's knowledge graph. Cadenced and fire-and-forget — the
        // reply has already been delivered by this point.
        if (conversationId) {
          void maybeExtractThreadConcepts(conversationId, null).catch(() => {});
        }
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('[hermes-chat] Job failed:', errorMessage);
      job.status = 'error';
      job.error = errorMessage;
      job.result = { success: false, error: errorMessage };
      publishJobEvent(jobId, { type: 'error', message: errorMessage });
    } finally {
      // Drop the bus subscription so the listener Set doesn't leak across
      // jobs — the bus would otherwise keep a reference to this closure for
      // the lifetime of the process. The confirmer must go with it: left
      // attached, it would answer destructive prompts against a finished job
      // whose waiters can never resolve, hanging the call until the 240s
      // budget expires.
      unsubscribeToolSteps();
      unregisterConfirmer();
    }
  })();

  return json({ jobId });
}

// ---------------------------------------------------------------------------
// Legacy branch (flag OFF) — unchanged behaviour, body lifted into a helper.
// ---------------------------------------------------------------------------

async function handleWithLoop({ request }: Parameters<RequestHandler>[0]): Promise<Response> {
  const body = await request.json();
  const { message, workflowId, mode, currentNodes, currentEdges, conversationId: rawConversationId, attachmentIds, useIntelContext, chatNodeId, intelEntityIds } = body as {
    message: string;
    workflowId?: string;
    mode?: string;
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

  const { jobId, job } = createJob(outbound, { workflowId, conversationId, chatNodeId });
  const { abortController } = job;

  // Run the orchestrator in the background
  (async () => {
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
        let modelContext: ModelContext = await resolveDefaultModel();
        let priceSnapshot: PriceSnapshot | null = null;
        console.log(`[orchestrator] Job ${jobId} — using ${modelContext.provider}:${modelContext.modelId} (kind=${contextKind})`);
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

/**
 * Deliver clarify answers to a Hermes turn that is blocked on the gateway's
 * clarify primitive. Rebuilds the chat/session identity from the job scope with
 * the same formula `handleWithHermes` used to create it, then posts the answer
 * as a normal message — which the gateway's clarify text-intercept consumes
 * instead of treating as a new turn.
 */
async function forwardClarifyToHermes(
  jobId: string,
  job: NonNullable<ReturnType<typeof getJob>>,
  answers: Record<string, string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!HERMES_SECRET) return { ok: false, error: 'HERMES_BRIDGE_SECRET not configured' };

  const workflowId = job.scope.workflowId ?? undefined;
  const conversationId = job.scope.conversationId ?? undefined;
  const chatNodeId = job.scope.chatNodeId ?? undefined;
  // handleWithHermes falls back to Date.now() when it has no stable id; that is
  // unreconstructable here, so bail rather than post into the wrong session.
  if (!workflowId && !conversationId && !chatNodeId) {
    return { ok: false, error: 'cannot resolve the Hermes session for this job' };
  }
  const chatId = workflowId ?? `chat_${conversationId ?? chatNodeId}`;
  const userKey = conversationId ?? chatNodeId ?? 'anon';
  const sessionId = `sess_${userKey}_${chatId}`;

  // One answer per card today; join defensively if that ever changes.
  let text = Object.values(answers)
    .map((a) => String(a ?? '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) return { ok: false, error: 'no answer text to forward' };
  // The gateway deliberately ignores replies beginning with `/` so a slash
  // command still reaches the agent rather than answering the clarify. An
  // answer that happens to start with `/` would silently do nothing, so shift
  // it behind a zero-width space.
  if (text.startsWith('/')) text = `​${text}`;

  try {
    const client = new HermesClient({
      baseUrl: HERMES_URL,
      bridgeSecret: HERMES_SECRET,
      defaultOrigin: HERMES_ORIGIN,
      defaultMcpUrl: HERMES_MCP_URL,
    });
    await client.sendMessage({
      chatId,
      kind: workflowId ? 'canvas_chat' : 'manual',
      kindId: chatId,
      sessionId,
      text,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.warn(`[hermes-chat] clarify forward failed for job ${jobId}: ${message}`);
    return { ok: false, error: `failed to deliver the answer to Hermes: ${message}` };
  }
}

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
  if (!ok) {
    // On the Hermes branch a `clarify` blocks inside the Python gateway's
    // clarify primitive, not in a job-store waiter — so there is nothing here
    // to resolve. The gateway instead intercepts the next non-slash text
    // message in the session (gateway/run.py:6938-6962), so forward the answers
    // as an ordinary silent message. Mirrors the approval card, whose buttons
    // send `/approve` back through the normal inbound path.
    if (HERMES_ENABLED && typed.type === 'clarify_ack') {
      const forwarded = await forwardClarifyToHermes(jobId, job, typed.answers);
      if (!forwarded.ok) return json({ error: forwarded.error }, { status: 502 });
      publishJobEvent(jobId, typed as JobEvent);
      return json({ ok: true });
    }
    return json({ error: 'no waiter registered for that key' }, { status: 404 });
  }

  // Echo the ack into the SSE stream so all subscribers see the user decision.
  publishJobEvent(jobId, typed as JobEvent);
  return json({ ok: true });
};
