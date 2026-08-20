<script lang="ts">
  import ChatMessage from '$lib/components/jkai/ChatMessage.svelte';
  import HeartbeatMarker, { type HeartbeatEntry } from '$lib/components/jkai/HeartbeatMarker.svelte';
  import { renderMarkdown } from '$lib/canvas/ChatMarkdown.svelte';
  import Artifact from '$lib/components/jkai/artifacts/Artifact.svelte';
  import type { Artifact as ArtifactT } from '$lib/workflows/site-tools/artifact-types';
  import { isArtifact } from '$lib/workflows/site-tools/artifact-types';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import PromoteToolBanner from '$lib/components/jkai/PromoteToolBanner.svelte';
  import PlanCard from '$lib/components/jkai/PlanCard.svelte';
  import ConfirmBanner from '$lib/components/jkai/ConfirmBanner.svelte';
  import SecretRequestModal from '$lib/components/jkai/SecretRequestModal.svelte';
  import type { SecretRequestEvent, SecretUpdateEvent } from '$lib/secrets/credential-requests';
  import ClarifyCard from '$lib/components/jkai/ClarifyCard.svelte';
  import SlashCommandButtonBar from '$lib/components/jkai/SlashCommandButtonBar.svelte';
  import { approvalAffordance } from '$lib/jkai/slash-commands';
  import type { DelegateChild } from '$lib/workflows/chat/job-store';
  import WorkerTray from '$lib/components/jkai/WorkerTray.svelte';
  import DelegateChildren from '$lib/components/jkai/DelegateChildren.svelte';
  import type { PlanPayload, ClarifyQuestion } from '$lib/workflows/chat/job-store';
  import { parsePromoteMarkers, stripPromoteMarkers } from '$lib/jkai/promote-marker';
  import { categorizeTool, resolveDisplayTool } from '$lib/workflows/chat/tool-summary';
  import MessageAttachments from './MessageAttachments.svelte';
  import FileViewerModal from '$lib/components/drive/FileViewerModal.svelte';
  import ResearchSourceModal from './ResearchSourceModal.svelte';
  import EntityHoverCard from '$lib/components/intel/EntityHoverCard.svelte';
  import { fetchMentionIndex, type MentionTarget } from '$lib/jkai/intel/entity-card-store';
  import ComposerAttachmentTray from './ComposerAttachmentTray.svelte';
  import BuildPill from './BuildPill.svelte';
  import JsonBlock from '$lib/components/jkai/JsonBlock.svelte';
  import VoiceRecorder from './VoiceRecorder.svelte';
  import OpenRouterModelPicker from '$lib/components/jkai/OpenRouterModelPicker.svelte';
  import { hermesModelCommand } from '$lib/jkai/hermes-model-command';
  import { coerceModelContext } from '$lib/constants/default-models';
  import type { ModelContext } from '$lib/server/models/types';
  import { streamChatJob, type ChatStreamHandle } from '$lib/jkai/chat-stream';
  import { subscribeFollowups } from '$lib/jkai/followup-stream';
  import { readTurnStamp, type TurnStamp } from '$lib/jkai/turn-stamp';
  import { shortModelLabel } from '$lib/jkai/model-label';
  import { setThreadLedger, clearThreadLedger, setLiveRuns, bumpGraphRevision } from '$lib/jkai/hub-bus.svelte';
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import { startTtftMark } from '$lib/jkai/ttft-metrics';
  import { beginTurn, noteOutput, noteToolStart, noteToolEnd, settleTurn } from '$lib/jkai/throughput-bus.svelte';
  import { enqueueMessage } from '$lib/jkai/pwa/outbox';
  import {
    hydrateQueuedSends,
    queuedFor,
    pushQueued,
    takeQueued,
    dropQueued,
  } from '$lib/jkai/queued-sends.svelte';
  import { dockTrigger, openLauncher } from '$lib/jkai/launcher-bus.svelte';
  import { onMount, tick, untrack } from 'svelte';

  let {
    conversationId,
    initialMessages = [],
    /**
     * Text to seed the composer with on first mount. Used by "Ask jkai about
     * this" links, which previously carried a query param nothing read — the
     * user landed on an empty box and had to retype the question.
     */
    initialDraft = '',
    /**
     * Send `initialDraft` as soon as there is a conversation to send it into,
     * instead of leaving it in the box. This is what makes "Ask jkai about it"
     * on a research run actually ask: the reply streams here rather than the
     * user arriving at a primed composer and pressing enter themselves.
     */
    autoSend = false,
    conversation = null,
    modelContextLength = null,
    defaultChatModelId,
    altOpenRouterModel = null,
    messageCount = 0,
    onmodelchange,
    modelCapabilities = null,
    useIntelContext = true,
    activeBuild = null,
    approvalUi,
    hermesEnabled = false,
    onToggleThreadRail,
    onToggleGraphRail,
    graphRailOpen = true,
    active = true,
    onbusychange,
  }: {
    conversationId: string | null;
    initialDraft?: string;
    autoSend?: boolean;
    initialMessages?: Array<{
      id: string;
      role: string;
      content: string;
      metadata?: any;
      source?: string;
      createdAt?: string;
    }>;
    conversation?: {
      modelProvider?: string;
      modelId?: string;
      title?: string | null;
      costUsd?: string | number | null;
      priceSnapshot?: { promptPrice: number; completionPrice: number } | null;
    } | null;
    /** Context window of the pinned model, for the header's `N CTX %` chunk.
     *  Null when the OpenRouter catalogue has no row for it. */
    modelContextLength?: number | null;
    defaultChatModelId: string;
    altOpenRouterModel?: ModelContext | null;
    messageCount?: number;
    onmodelchange?: (ctx: ModelContext) => void;
    modelCapabilities?: { image: boolean; audio: boolean; video: boolean; pdf: boolean; documentText: boolean } | null;
    useIntelContext?: boolean;
    activeBuild?: { id: string; status: string } | null;
    approvalUi?: import('$lib/server/models/settings').ApprovalUiSettings;
    hermesEnabled?: boolean;
    /** Raise the thread rail's slide-over (below 1100px it is off-canvas). */
    onToggleThreadRail?: () => void;
    /** Show/hide the knowledge-graph rail (below 1280px it is collapsed). */
    onToggleGraphRail?: () => void;
    graphRailOpen?: boolean;
    /**
     * False when this pane is a background tab — mounted and streaming, but not
     * the one on screen. It suppresses the things that only make sense for the
     * pane the user is looking at: taking focus, and consuming the one-shot
     * `?ask=` prefill that would otherwise land in whichever pane mounted first.
     * The chat stream, the follow-up feed and the transcript all keep running,
     * because a background tab finishing its answer is the entire point.
     */
    active?: boolean;
    /**
     * Fires when this thread starts or stops working, so the tab strip can show
     * a dot without polling. `ok` is false when the turn ended in an error.
     */
    onbusychange?: (busy: boolean, ok: boolean) => void;
  } = $props();

  function buildIdFromMessage(m: Message): string | null {
    if (!m.toolSteps) return null;
    for (const step of m.toolSteps) {
      if (step.tool !== 'build_create' || step.status !== 'done') continue;
      const r = step.result as { data?: { id?: string }; success?: boolean } | undefined;
      if (r?.success && typeof r.data?.id === 'string') return r.data.id;
    }
    return null;
  }

  interface ToolStep {
    id?: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    summary?: string;
    // When the step started, so a running card can carry its own clock.
    // Live-only: restored history is all finished, so it is absent there.
    startedAt?: number;
    // Sub-agent rows for a `delegate_task` step (sub-agent visualizer).
    children?: DelegateChild[];
    expanded?: boolean;
    ephemeral?: {
      handlerCode: string;
      parameters: unknown;
      proposedName?: string;
      proposedDescription?: string;
    };
  }

  interface SubAgentStep {
    toolCallId: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    summary?: string;
    expanded?: boolean;
  }
  interface SubAgentState {
    agentId: string;
    task: string;
    status: 'running' | 'done' | 'error';
    summary?: string;
    liveTokens: string;
    toolSteps: SubAgentStep[];
    startedAt: number;
  }

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean; usage?: TurnStamp };
    thinking?: OrchestratorThinking;
    isProgress?: boolean;
    progressSteps?: string[];
    toolSteps?: ToolStep[];
    /** @files (file_search) references for clickable "sources" chips. Populated
     *  live from the `done` event and on reload from persisted metadata. */
    fileRefs?: FileSearchRef[];
    /** @research (research_search) references for clickable "research" chips.
     *  Same lifecycle as fileRefs. */
    researchRefs?: ResearchSearchRef[];
    /** Canvases created/updated this turn — deep-link chips. Same lifecycle. */
    workflowRefs?: WorkflowChipRef[];
    /** Id of this turn's recorded tool-call chain in `jkai_tool_traces`, when it
     *  made any calls. Arrives on the `done` event for a live turn and from
     *  `metadata.traceId` on reload; opens /jkai/trace/<id> in a new tab. */
    traceId?: string;
    source?: string;
    /** ISO-8601 wall-clock time the bubble was created (DB createdAt for
     *  reloaded history, `new Date().toISOString()` stamped at the moment
     *  the message lands in the in-memory list for live turns). Used by
     *  ChatMessage.svelte to render the hover-reveal per-bubble timestamp. */
    createdAt?: string;
    attachments?: Array<{
      id: string;
      kind: 'image' | 'audio' | 'video' | 'pdf' | 'document' | 'text';
      mimeType: string;
      originalName: string | null;
      sizeBytes: number;
      source: 'web' | 'whatsapp' | 'generated';
    }>;
    /** True when this user bubble represents a message that was queued via
     *  the offline outbox (`$lib/jkai/pwa/outbox`) instead of POSTed live —
     *  drives the "queued" badge on the bubble. The PWA sync manager flushes
     *  the outbox in the background and the next conversation reload will
     *  replace the bubble with the persisted server row (no queued flag). */
    queued?: boolean;
  }

  function artifactsForMessage(m: Message): ArtifactT[] {
    if (!m.toolSteps) return [];
    const out: ArtifactT[] = [];
    for (const step of m.toolSteps) {
      const r = step.result as { data?: { artifact?: unknown } } | undefined;
      if (r?.data?.artifact && isArtifact(r.data.artifact)) {
        out.push(r.data.artifact);
      }
    }
    return out;
  }

  function promoteMarkersForMessage(m: Message) {
    if (m.role !== 'assistant') return [];
    return parsePromoteMarkers(m.content);
  }

  let messages = $state<Message[]>([]);
  // Seeded once at construction, not in an effect: an effect that writes what
  // it reads would fight the user as soon as they edited the box.
  let input = $state(initialDraft ?? '');
  let loading = $state(false);
  // The graph rail draws the thread on screen, so only that pane's turns are a
  // reason for it to look again. A background pane bumping the revision would
  // send the rail refetching a graph that had not changed.
  function bumpGraphIfOnScreen() {
    if (active) bumpGraphRevision();
  }

  // The throughput meter is a single shared instrument, so only one turn at a
  // time may drive it. Ownership is settled when the turn STARTS and then held
  // to the end: gating each call on `active` instead would let a turn that began
  // on screen and finished in the background call `begin` and never `settle`,
  // leaving the meter stuck on "live" — the very failure the backstop settle in
  // `silentSend` exists to prevent. A background turn's tokens go unmeasured,
  // which is the honest answer for a meter about what you are watching.
  let ownsMeters = false;
  function meterBegin(opts: { replay?: boolean } = {}) {
    ownsMeters = active;
    if (ownsMeters) beginTurn(opts);
  }
  function meterOutput(text: string | undefined) {
    if (ownsMeters) noteOutput(text);
  }
  function meterToolStart(args: unknown) {
    if (ownsMeters) noteToolStart(args);
  }
  function meterToolEnd() {
    if (ownsMeters) noteToolEnd();
  }
  function meterSettle(actualOutputTokens?: number | null) {
    if (ownsMeters) settleTurn(actualOutputTokens);
  }

  // Whether the turn now finishing produced an answer rather than an error.
  // A plain `let`, deliberately: only the reporting effect below reads it, and
  // making it reactive would subscribe that effect to its own write.
  let turnOk = true;
  let lastReportedBusy = false;

  // Tell the tab strip when this thread starts and stops working, so a
  // background tab can show a live dot without the page polling for it.
  $effect(() => {
    const busy = loading;
    if (busy === lastReportedBusy) return;
    lastReportedBusy = busy;
    if (busy) turnOk = true;
    onbusychange?.(busy, turnOk);
  });
  let currentJobId = $state<string | null>(null);
  // MUST stay in lockstep with HEARTBEAT_INTERVAL_MS in
  // src/lib/workflows/chat/job-store.ts — the server fires beats on a fixed
  // 5s cadence and the countdown maths assumes the same interval.
  const HEARTBEAT_INTERVAL_MS = 5_000;
  // Stall thresholds, measured in ms past the expected next-beat moment.
  // - <STALL_JITTER_MS: fresh / counting down normally
  // - <STALL_SLOW_MS:   "checking…"          (subtle)
  // - <STALL_STUCK_MS:  "Connection slow"     (amber)
  // - >=STALL_STUCK_MS: "No response"         (red, cancel affordance)
  const STALL_JITTER_MS = 3_000;
  const STALL_SLOW_MS = 10_000;
  const STALL_STUCK_MS = 30_000;
  let heartbeat = $state<{ summary: string; phase: string; elapsedSec: number; lastBeatAt: number } | null>(null);
  // Driven by a 250ms ticker while a heartbeat exists. Used purely to make
  // the countdown / stalled state re-render every quarter-second without
  // touching the heartbeat object itself.
  let hbNow = $state(Date.now());
  let hbTicker: ReturnType<typeof setInterval> | null = null;
  function startHeartbeatTicker() {
    if (hbTicker) return;
    hbTicker = setInterval(() => { hbNow = Date.now(); }, 250);
  }
  function stopHeartbeatTicker() {
    if (hbTicker) { clearInterval(hbTicker); hbTicker = null; }
  }
  // True when any tool step on the in-flight bubble is still running — the
  // tool step card already shows what's happening, so the heartbeat line
  // would be a duplicate signal.
  const anyToolRunning = $derived.by(() => {
    for (const m of messages) {
      if (!m.isProgress) continue;
      if (m.toolSteps?.some((s) => s.status === 'running')) return true;
    }
    return false;
  });
  $effect(() => {
    // Single source of truth for ticker lifecycle: heartbeat present → tick,
    // heartbeat cleared → stop. Every `heartbeat = null` site (plan/confirm/
    // clarify/done/error/subagent_start) flows through here without needing
    // its own teardown call. A running tool step keeps it alive too — its
    // card carries its own clock, and `tool_start` clears the heartbeat.
    if (heartbeat || anyToolRunning) startHeartbeatTicker();
    else stopHeartbeatTicker();
    return () => stopHeartbeatTicker();
  });
  // The reasoning panel is "actively streaming" if a thinking delta arrived
  // in the last 2s. While it is, suppress the heartbeat line — the panel
  // itself signals progress.
  const REASONING_LINGER_MS = 2_000;
  // Distinguish "server hasn't sent heartbeat" from "server is fine but the
  // model has stopped emitting tokens/thoughts/tool events". If the heartbeat
  // is fresh but no model event has arrived in this many ms, render the
  // heartbeat line as "provider_slow" instead of letting it sit silent.
  const PROVIDER_SLOW_MS = 15_000;

  // Recompute countdown / stall state from heartbeat + hbNow + recent model
  // activity. Derived values are read into the template at every tick.
  const hbDerived = $derived.by(() => {
    if (!heartbeat) return null;
    const nextDueAt = heartbeat.lastBeatAt + HEARTBEAT_INTERVAL_MS;
    const remainingMs = nextDueAt - hbNow;
    const overdueMs = -remainingMs; // positive means we've blown the next-beat deadline
    let state: 'fresh' | 'jitter' | 'server_slow' | 'provider_slow' | 'stuck';
    if (overdueMs >= STALL_STUCK_MS) {
      state = 'stuck';
    } else if (overdueMs >= STALL_JITTER_MS) {
      state = 'server_slow';
    } else if (overdueMs >= 0) {
      state = 'jitter';
    } else {
      // Heartbeats are arriving on time. Check whether the model itself is
      // making progress — if not, surface that distinctly.
      const phase = heartbeat.phase;
      const phaseExpectsProgress = phase === 'thinking' || phase === 'waiting_llm' || phase === 'tool_running';
      const stallMs = lastModelEventAt > 0 ? hbNow - lastModelEventAt : (hbNow - heartbeat.lastBeatAt + heartbeat.elapsedSec * 1000);
      state = phaseExpectsProgress && stallMs > PROVIDER_SLOW_MS ? 'provider_slow' : 'fresh';
    }
    // Suppress the heartbeat line when reasoning is actively streaming —
    // the Reasoning panel itself is showing live deltas, so the heartbeat
    // is redundant noise.
    const reasoningActive = lastReasoningAt > 0 && hbNow - lastReasoningAt < REASONING_LINGER_MS;
    // The calm line only distinguishes "stuck" (actionable: Cancel) from
    // everything else — the intermediate jitter/slow states all read as calm,
    // so their durations are no longer surfaced.
    return { state, reasoningActive };
  });

  // A long silent tool call is the other half of the SSE de-sync: the
  // heartbeat line is suppressed while a tool runs (it would duplicate the
  // step card), and the card itself carried no clock — so a 16-minute
  // `workflow_run` showed a pulsing dot and nothing else, and the only thing
  // that ever broke the silence was Hermes' "iteration x/y" filler. The card
  // now carries its own elapsed time off the same 250ms `hbNow` ticker, and
  // offers a Cancel once the wait stops looking normal.
  const TOOL_STEP_SLOW_MS = 120_000;
  function formatStepElapsed(ms: number): string {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  }

  // Single decision for "render the heartbeat line" — used by both render
  // sites (with-tools and typing-only) so the suppression rules stay in
  // sync without two duplicated conditional ladders in the template.
  const showHeartbeatLine = $derived(
    !!(heartbeat && hbDerived) && !anyToolRunning && !hbDerived!.reasoningActive,
  );
  let connectionWarning = $state<string | null>(null);
  let pendingPlan = $state<{ planId: string; plan: PlanPayload } | null>(null);
  let pendingConfirm = $state<{ confirmId: string; prompt: string; destructive?: boolean; details?: Record<string, unknown> } | null>(null);
  // Credential request from `request_credential`. Every field is server-authored
  // from $lib/secrets/credential-requests; the value never comes back through
  // here — the modal posts it straight to the owner-gated secrets endpoint.
  let pendingSecret = $state<SecretRequestEvent | SecretUpdateEvent | null>(null);

  /**
   * Report the OUTCOME of a credential request back to the blocked tool.
   * Carries only { requestId, handle, stored } — the server REJECTS any other
   * key, so this cannot quietly become a value channel.
   */
  async function ackSecretRequest(result: { stored: boolean; handle?: string }) {
    const req = pendingSecret;
    pendingSecret = null;
    if (!req || !currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'secret_ack',
          requestId: req.requestId,
          handle: result.handle,
          stored: result.stored,
        }),
      });
    } catch {
      // The tool's own 180s timeout is the backstop if this never lands.
    }
  }

  let pendingClarify = $state<{ clarifyId: string; questions: ClarifyQuestion[] } | null>(null);
  // Dangerous-command approval gate (Hermes `send_exec_approval` → kind="approval").
  // No waiter/id: the card's buttons reply /approve|/deny, resolved gateway-side by
  // the chat's session_key. Cleared on button click, turn end, or cancel.
  let pendingApproval = $state<{ command: string; description: string; sessionKey: string } | null>(null);
  let subAgents = $state<Record<string, SubAgentState>>({});
  // Per-bubble reasoning state from Hermes `thinking` frames. Keyed by
  // the assistant bubble's `message.id` (the in-flight `progressId`) so
  // the panel stays attached to its bubble after finalisation. Svelte 5
  // doesn't track in-place Map mutations, so we construct a fresh Map on
  // every write (reassign-to-new-Map pattern).
  let thinkingByBubble = $state<Map<string, { text: string; expanded: boolean }>>(new Map());
  // Pending TTFT marks keyed by progressId. Populated at send time, fired on
  // first 'token' or 'thinking' event, and deleted on stream completion.
  let pendingTtft = new Map<string, { onFirstToken: () => void }>();

  // Timestamps used to decide whether to render the heartbeat line. The
  // server's heartbeat fires every 5s with a phase label, but it adds noise
  // when something more informative is already on screen (an active tool
  // step, or a reasoning panel that's still streaming deltas). Suppress the
  // heartbeat in those cases — one signal per moment.
  //
  // ``lastReasoningAt`` tracks the wall-clock time of the last 'thinking'
  // event; the heartbeat-line conditional treats reasoning as 'active' for
  // 2s after the last delta. ``lastModelEventAt`` is any token / thinking /
  // tool event — used to distinguish 'model is slow' from 'server is slow'
  // when heartbeats are still arriving but no model progress has been made.
  let lastReasoningAt = $state(0);
  let lastModelEventAt = $state(0);

  function toggleThinking(bubbleId: string) {
    const prev = thinkingByBubble.get(bubbleId);
    if (!prev) return;
    const next = new Map(thinkingByBubble);
    next.set(bubbleId, { ...prev, expanded: !prev.expanded });
    thinkingByBubble = next;
  }

  /** Last non-empty line of reasoning text, sliced for the collapsed preview.
   * Strips markdown emphasis markers from common patterns so the inline preview
   * reads cleanly when reasoning has bold/italic. */
  function reasoningPreview(text: string): string {
    const lastLine = (text || '').split('\n').filter((l) => l.trim()).at(-1) ?? '';
    return lastLine.replace(/[*_`#]+/g, '').trim().slice(0, 80);
  }

  let chatContainer: HTMLDivElement;
  let textareaEl = $state<HTMLTextAreaElement | undefined>();

  // ── Follow-the-tail scrolling ───────────────────────────────────────────────
  // The view only chases new content while the reader is parked at the bottom.
  // Scroll up mid-turn to re-read something and the stream stops yanking you
  // back; scroll (or click "latest") to within `SCROLL_SLACK` of the end and the
  // follow re-arms itself. Read by the template, so it has to be `$state`.
  let stickToBottom = $state(true);
  const SCROLL_SLACK = 80;
  // rAF coalescer for the observer below — an internal handle, never `$state`.
  let stickPending = false;

  function onListScroll() {
    if (!chatContainer) return;
    stickToBottom =
      chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < SCROLL_SLACK;
  }

  /**
   * Sticky-bottom for everything that grows the list *without* going through
   * `scrollToBottom` — streamed markdown re-rendering, a tool drawer opening,
   * the thinking timeline expanding, images and iframes settling late. Without
   * this the reply starts rendering just under the fold. Mirrors the same
   * pattern in BuilderChatNode.
   */
  function stickyBottom(node: HTMLDivElement): { destroy(): void } {
    const follow = () => {
      if (!stickToBottom || stickPending) return;
      stickPending = true;
      requestAnimationFrame(() => {
        stickPending = false;
        if (stickToBottom) node.scrollTop = node.scrollHeight;
      });
    };
    const mo = new MutationObserver(follow);
    mo.observe(node, { childList: true, subtree: true, characterData: true });
    // Catches height changes the mutation observer can't see: the composer
    // growing as you type, the mobile keyboard, a window resize.
    const ro = new ResizeObserver(follow);
    ro.observe(node);
    return {
      destroy() {
        mo.disconnect();
        ro.disconnect();
      },
    };
  }

  let chatStream: ChatStreamHandle | null = null;

  // Index of the most recent assistant message — drives whether the in-chat
  // slash-command button bar runs the auto-select timer (only the latest
  // unanswered approval prompt should). Iterates from the tail so we skip
  // the typing-indicator placeholders that the streaming path appends.
  const lastAssistantMessageIndex = $derived.by(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && !messages[i].isProgress) return i;
    }
    return -1;
  });

  /**
   * Fire a slash command (e.g. `/approve`) to Hermes WITHOUT recording it as
   * a visible user bubble. Backend honours `silent: true` to skip the
   * orchestratorChats user-row insert (chat/+server.ts).
   *
   * Called by SlashCommandButtonBar via the per-message `onSilentSend` prop.
   * Reuses the same chat endpoint and SSE stream pipeline so Hermes' follow-
   * up response (e.g. "✅ Command approved …") flows in as a normal
   * assistant token stream — no special handling required on the recv side.
   */
  async function silentSend(command: string): Promise<void> {
    if (!conversationId) return;
    if (loading) return;

    loading = true;
    heartbeat = null;

    const progressId = crypto.randomUUID();
    pendingTtft.set(progressId, startTtftMark(progressId));
    meterBegin();
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: '',
      isProgress: true,
      progressSteps: [],
      toolSteps: [],
      createdAt: new Date().toISOString(),
    }];
    scrollToBottom('auto', true);

    try {
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: command,
          conversationId,
          silent: true,
          useIntelContext,
        }),
      });
      const postData = await postRes.json().catch(() => null);
      if (!postRes.ok) throw new Error(postData?.error || `Server error (${postRes.status})`);
      const jobId = postData?.jobId;
      if (!jobId) throw new Error('No job ID returned');
      currentJobId = jobId;

      let accumulatedContent = '';
      const onSilentEvent = (data: any) => {
        if (data.type === 'connected') return;
        // TTFT mark: fire on first sign of life (text token or thinking delta)
        if ((data.type === 'token' || data.type === 'thinking') && pendingTtft.has(progressId)) {
          const m = pendingTtft.get(progressId)!;
          m.onFirstToken();
          pendingTtft.delete(progressId);
        }
        // Same tok/s accounting as makeProgressHandler. Tool frames aren't
        // rendered on the silent path, but the meter still needs the pause —
        // otherwise a silent turn's tool time would count as turn time.
        if (data.type === 'token' || data.type === 'thinking') meterOutput(data.delta);
        else if (data.type === 'tool_start') meterToolStart(data.args);
        else if (data.type === 'tool_result') meterToolEnd();

        if (data.type === 'token') {
          accumulatedContent += data.delta;
          messages = messages.map((m) =>
            m.id === progressId ? { ...m, content: accumulatedContent, isProgress: false } : m,
          );
          scrollToBottom();
          return;
        }
        if (data.type === 'replace_bubble') {
          accumulatedContent = data.content;
          messages = messages.map((m) =>
            m.id === progressId ? { ...m, content: accumulatedContent, isProgress: false } : m,
          );
          scrollToBottom();
          return;
        }
        if (data.type === 'thinking') {
          // Reasoning-delta surfaced even on silent-send paths so
          // approval-flow turns ("/approve") that reason can show
          // their work too.
          const prev = thinkingByBubble.get(progressId) ?? { text: '', expanded: false };
          const next = new Map(thinkingByBubble);
          next.set(progressId, { ...prev, text: prev.text + data.delta });
          thinkingByBubble = next;
          return;
        }
        if (data.type === 'approval') {
          // A chained dangerous command can surface during a silent turn (e.g.
          // clicking Approve continues the agent into another gated command).
          // Re-raise the card so the user can resolve it.
          pendingApproval = {
            command: data.command,
            description: data.description,
            sessionKey: data.sessionKey,
          };
          return;
        }
        if (data.type === 'done') {
          pendingTtft.delete(progressId);
          const result = data.result ?? {};
          meterSettle((result.usage as { outputTokens?: number | null } | undefined)?.outputTokens ?? null);
          const finalMessage = (result.message as string) ?? accumulatedContent;
          messages = messages.map((m) =>
            m.id === progressId
              ? { ...m, isProgress: false, content: finalMessage || m.content }
              : m,
          );
          scrollToBottom();
          bumpGraphIfOnScreen();
          return;
        }
        if (data.type === 'error') {
          pendingTtft.delete(progressId);
          meterSettle();
          messages = messages.map((m) =>
            m.id === progressId
              ? { ...m, isProgress: false, content: `Error: ${data.message ?? 'Unknown'}` }
              : m,
          );
          return;
        }
      };

      chatStream = streamChatJob(jobId, {
        onEvent: onSilentEvent,
        onWarning: (w) => { connectionWarning = w; },
      });
      try {
        await chatStream.done;
      } finally {
        chatStream = null;
        loading = false;
        currentJobId = null;
        // Backstop: a stream that ends without done/error must not leave the
        // meter stuck on "live". No-op once the handler has settled.
        meterSettle();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[silentSend]', errMsg);
      loading = false;
      messages = messages.map((m) =>
        m.id === progressId ? { ...m, isProgress: false, content: `Error: ${errMsg}` } : m,
      );
    }
  }

  // Intel entity names, fetched once per page and shared by every message so a
  // reply can turn the names it uses into hoverable references. A failure here
  // resolves to an empty list — chat must work with no intel graph at all.
  let entityMentions = $state<MentionTarget[]>([]);

  /** Intel extraction is in flight for this thread (SSE `intel` signal). Drives
   *  the quiet footer line — ER takes tens of seconds and silently produces the
   *  entity links and the graph rail, so without this it reads as nothing
   *  happening followed by the page mysteriously changing. */
  let intelRunning = $state(false);

  onMount(() => {
    // `/jkai?ask=…` prefills the composer. This is how the Intel dashboard
    // commissions a question: it hands over a prompt already loaded with what
    // the graph knows, and the user presses send (or edits first).
    // Only the pane on screen may consume it: `ask` is one-shot (it clears the
    // param), so with several panes mounted the first to run would swallow a
    // question meant for the visible thread.
    const ask = active ? new URLSearchParams(window.location.search).get('ask') : null;
    if (ask && !input) {
      input = ask;
      // Clear the param so a refresh doesn't re-prefill over the user's edits.
      const url = new URL(window.location.href);
      url.searchParams.delete('ask');
      history.replaceState(history.state, '', url);
    }

    // Bring back any follow-up left pending at the last reload. Idempotent, so
    // every mounted pane can call it.
    hydrateQueuedSends();
    if (active) textareaEl?.focus();
    void fetchMentionIndex().then((list) => {
      entityMentions = list;
    });
    // Dock the command-palette trigger in the composer row. This retires the
    // layout's floating bottom-left button, which sat on top of the sidebar's
    // run-stats footer.
    return dockTrigger();
  });

  $effect(() => {
    // Refocus the composer when this pane comes to the front or the assistant
    // finishes responding, so the cursor lives in the input. A background tab
    // must not do this — its textarea is in a hidden subtree, and a pane that
    // finished its answer off-screen would otherwise yank the caret out of the
    // thread the user is actually typing in.
    const onScreen = active;
    conversationId;
    // A new thread means a new history list — never resume mid-cycle in it.
    resetHistoryCycle();
    if (onScreen && !loading) {
      tick().then(() => textareaEl?.focus());
    }
  });

  $effect(() => {
    // Coming to the front. The transcript's own scroll maths ran while this pane
    // sat in a `display: none` subtree, where scrollHeight is 0, so it has to be
    // redone now or a long thread opens at its first message.
    // Forced: hiding and re-showing the pane can fire a scroll event at
    // scrollTop 0, which reads as "the user scrolled up" and would otherwise
    // leave the follow disarmed at the top of the thread.
    if (!active) return;
    void tick().then(() => {
      scrollToBottom('instant', true);
      setTimeout(() => scrollToBottom('instant', true), 50);
    });
  });

  // When the selected conversation changes, look up whether the
  // orchestrator already has a job running for it on the server. If yes,
  // re-attach the chat stream so the user sees the in-flight activity
  // (tools, thinking, plan/clarify/confirm) instead of static history.
  let lastResumedConvId: string | null = null;
  $effect(() => {
    const convId = conversationId;
    if (!convId) {
      lastResumedConvId = null;
      return;
    }
    if (loading || currentJobId || chatStream) return;
    if (lastResumedConvId === convId) return;
    lastResumedConvId = convId;
    void (async () => {
      try {
        const res = await fetch(`/api/workflows/orchestrator/chat/active?conversationId=${encodeURIComponent(convId)}`);
        if (!res.ok) return;
        const data = await res.json() as { jobId: string | null };
        if (data.jobId && conversationId === convId) {
          await resumeRunningJob(data.jobId);
        }
      } catch (err) {
        console.warn('[ChatArea] active-job lookup failed:', err);
      }
    })();
  });

  // Attachment composer state
  interface PendingAttachment {
    id: string;
    kind: string;
    mimeType: string;
    originalName: string | null;
    sizeBytes: number;
    uploading?: boolean;
    error?: string;
    incompatible?: boolean;
  }
  // Follow-ups typed while a reply is still streaming.
  //
  // The composer used to be `disabled={loading}`, so a second message simply
  // could not be sent — which made the gateway's queue/interrupt setting almost
  // unreachable from the UI. Holding them rather than posting them straight away
  // serialises at our own door: the gateway never sees an overlap from the
  // composer, so this is correct whichever mode it is in, and each message still
  // gets its own turn and its own answer.
  //
  // Kept in $lib/jkai/queued-sends, keyed by conversation, so they survive a
  // reload — which is exactly when you would most want them back — and so one
  // pane per open tab can each have their own without four copies of the storage
  // logic.
  const queuedSends = $derived(queuedFor(conversationId));
  let pendingAttachments = $state<PendingAttachment[]>([]);
  let dragOver = $state(false);
  let fileInputEl: HTMLInputElement | undefined = $state();

  // Toast for rejected file drops/pastes
  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string) {
    toast = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast = null; }, 4000);
  }

  function kindAllowedByCaps(kind: string): boolean {
    const caps = modelCapabilities;
    if (!caps) return true;
    switch (kind) {
      case 'image': return caps.image;
      case 'audio': return caps.audio;
      case 'video': return caps.video;
      case 'pdf':   return caps.pdf;
      case 'document':
      case 'text':  return caps.documentText;
      default: return false;
    }
  }

  $effect(() => {
    // Re-check compatibility when model capabilities change
    if (modelCapabilities && pendingAttachments.length > 0) {
      pendingAttachments = pendingAttachments.map(a => ({
        ...a,
        incompatible: !kindAllowedByCaps(a.kind),
      }));
    }
  });

  function acceptAttrForCaps(): string {
    const caps = modelCapabilities;
    if (!caps) return '*/*';
    const parts: string[] = [];
    if (caps.image) parts.push('image/*');
    if (caps.audio) parts.push('audio/*');
    if (caps.video) parts.push('video/*');
    if (caps.pdf) parts.push('application/pdf');
    if (caps.documentText) parts.push('text/*', 'application/json');
    return parts.join(',') || '*/*';
  }

  async function uploadFile(file: File): Promise<void> {
    const mimePrefix = file.type.split('/')[0];
    const probableKind = mimePrefix === 'image' ? 'image'
      : mimePrefix === 'audio' ? 'audio'
      : mimePrefix === 'video' ? 'video'
      : file.type === 'application/pdf' ? 'pdf'
      : 'text';
    if (!kindAllowedByCaps(probableKind)) {
      showToast(`This model can't process ${probableKind} files. Switch to a different model.`);
      return;
    }
    const tempId = `tmp-${Math.random().toString(36).slice(2)}`;
    pendingAttachments = [...pendingAttachments, {
      id: tempId, kind: 'unknown', mimeType: file.type, originalName: file.name,
      sizeBytes: file.size, uploading: true,
    }];
    const fd = new FormData();
    fd.append('file', file);
    if (conversationId) fd.append('conversationId', conversationId);
    try {
      const res = await fetch('/api/jkai/attachments', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pendingAttachments = pendingAttachments.map(a =>
          a.id === tempId ? { ...a, uploading: false, error: err.error ?? `upload ${res.status}` } : a
        );
        return;
      }
      const row = await res.json();
      pendingAttachments = pendingAttachments.map(a =>
        a.id === tempId ? { ...row, uploading: false } : a
      );
    } catch (e: any) {
      pendingAttachments = pendingAttachments.map(a =>
        a.id === tempId ? { ...a, uploading: false, error: e?.message ?? 'upload failed' } : a
      );
    }
  }

  async function removeAttachment(id: string): Promise<void> {
    if (!id.startsWith('tmp-')) {
      await fetch(`/api/jkai/attachments/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    pendingAttachments = pendingAttachments.filter(a => a.id !== id);
  }

  function onFilePick(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    if (!input.files) return;
    for (const f of Array.from(input.files)) void uploadFile(f);
    input.value = '';
  }

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragOver = false;
    if (!e.dataTransfer?.files) return;
    for (const f of Array.from(e.dataTransfer.files)) void uploadFile(f);
  }

  function onPaste(e: ClipboardEvent): void {
    if (!e.clipboardData) return;
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) void uploadFile(f);
      }
    }
  }

  async function handleVoiceBlob(blob: Blob): Promise<void> {
    const f = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
    await uploadFile(f);
  }

  // Tool calls live inline in the thread (a collapsed disclosure under each
  // assistant message via `msg.toolSteps`), so there's no conversation-level
  // aggregate or side drawer any more — one home for tool activity.

  // Hide synthetic heartbeat *trigger* messages ("just a check-in" pokes the
  // system sends to wake the orchestrator). The orchestrator's actual reply /
  // note still renders; only the plumbing poke is suppressed.
  function isHeartbeatCheckIn(m: { metadata?: unknown }): boolean {
    const hb = (m.metadata as { heartbeat?: { kind?: string } } | undefined)?.heartbeat;
    return hb?.kind === 'user-trigger';
  }

  /** The heartbeat engine's own output — progress notes and short LLM replies.
   *  Distinct from the trigger poke above, which is pure plumbing. */
  function heartbeatInfo(m: { metadata?: unknown }): { kind: 'note' | 'reply'; activity: string } | null {
    const hb = (m.metadata as { heartbeat?: { kind?: string; activity?: string } } | undefined)?.heartbeat;
    if (hb?.kind !== 'note' && hb?.kind !== 'reply') return null;
    return { kind: hb.kind, activity: hb.activity || 'heartbeat' };
  }

  /** Progress from a task watch, as opposed to a "still there?" nudge.
   *
   *  The 2026-07-27 collapse was aimed at chat-continuation, whose notes repeat
   *  near-verbatim and contributed nothing to the dialogue. A task watch is the
   *  opposite: it only speaks when the thing it watches has actually changed,
   *  and it is the only signal a long background run produces. Collapsing that
   *  into a hover chip is what made an hour of autonomous work read as silence. */
  function isTaskProgress(m: { metadata?: unknown }): boolean {
    const info = heartbeatInfo(m);
    return !!info && info.activity !== 'chat-continuation';
  }

  // Heartbeat output is collapsed to ONE marker for the whole session, pinned in
  // the thread header — not to a marker per contiguous run sitting in the flow of
  // the conversation (John, 2026-07-27).
  //
  // The engine fires on its own cadence and its notes repeat almost verbatim
  // ("paused 2 min ago — waiting on your reply"), so even one marker per run
  // punctuated the thread with machinery it contributed nothing to. One marker,
  // showing the LATEST beat inline with the rest on hover, says the same thing
  // and stops interrupting the dialogue. Ordered newest-first so "latest" is
  // both the inline preview and the top of the card.
  const heartbeatEntries = $derived.by(() => {
    const entries: HeartbeatEntry[] = [];
    for (const m of messages) {
      if (isHeartbeatCheckIn(m)) continue;
      const info = heartbeatInfo(m);
      if (!info) continue;
      entries.push({
        id: m.id,
        kind: info.kind,
        activity: info.activity,
        content: m.content,
        createdAt: m.createdAt,
      });
    }
    return entries.reverse();
  });

  // Sync messages when initialMessages or conversationId changes
  $effect(() => {
    messages = initialMessages.map((m) => {
      const meta = m.metadata as { toolSteps?: ToolStep[]; source?: string; fileRefs?: FileSearchRef[]; researchRefs?: ResearchSearchRef[]; workflowRefs?: WorkflowChipRef[]; traceId?: string } | undefined;
      const raw = m as Record<string, unknown>;
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        metadata: m.metadata,
        // Prefer metadata.source (e.g. 'status_update') over the wrapper source
        source: meta?.source ?? m.source,
        // Hydrate tool steps from stored metadata so the drawer persists across reloads
        toolSteps: meta?.toolSteps,
        // Hydrate @files references so the "sources" chips persist across reloads
        fileRefs: meta?.fileRefs ?? undefined,
        // Hydrate @research references so the "research" chips persist across reloads
        researchRefs: meta?.researchRefs ?? undefined,
        // Hydrate workflow chips (created/updated canvases) across reloads
        workflowRefs: meta?.workflowRefs ?? undefined,
        // The turn's recorded tool-call chain. This is the ONLY tool information
        // that survives a reload on the Hermes engine — `metadata.toolSteps` is
        // never written on that branch, so the inline step cards above are gone
        // by now and the trace page is where the chain lives.
        traceId: meta?.traceId ?? undefined,
        attachments: (raw.attachments as Message['attachments']) ?? undefined,
        // Per-bubble timestamp so ChatMessage.svelte can render a wall-clock
        // mark + an inter-bubble gap. Falls back to undefined for legacy
        // rows without createdAt.
        createdAt: m.createdAt,
      };
    });
    // Jump instantly to the latest message on initial load / conversation switch.
    // Child content (markdown, tool drawers, attachments) renders across multiple
    // frames, so retry after layout settles to catch the real scrollHeight.
    scrollToBottom('instant', true);
    setTimeout(() => scrollToBottom('instant', true), 50);
    setTimeout(() => scrollToBottom('instant', true), 200);
  });

  // Real-time follow-up messages. The connection itself is shared: every open
  // tab needs this feed for its own thread, and one EventSource each would
  // exhaust the browser's six-per-origin HTTP/1.1 budget on the dev server
  // before the job streams got a look in. See $lib/jkai/followup-stream.
  $effect(() => {
    // Per-conversation state: the `intel` signal only ever arrives for the
    // thread whose stream is open, so switching threads while extraction is
    // running must clear it. Left set, the incoming thread's newest reply would
    // wear an ER-processing border for work being done on a different one.
    // (Safe to write here — this effect's only tracked read is conversationId.)
    intelRunning = false;

    if (!conversationId) return;

    return subscribeFollowups(conversationId, (data) => {
      try {
        // Intel extraction changed state. Not a message — it updates UI that is
        // already on screen. On `done` the mention index is refetched so replies
        // the user is ALREADY reading gain their entity links (the index was
        // previously fetched once per page load, so they never did until a
        // reload), and the graph rail is told to redraw immediately rather than
        // waiting out its own backoff.
        if (data.type === 'intel') {
          intelRunning = data.phase === 'running';
          if (data.phase === 'done') {
            void fetchMentionIndex({ refresh: true }).then((list) => {
              entityMentions = list;
            });
            bumpGraphIfOnScreen();
          }
          return;
        }

        const newMsg: Message = {
          id: crypto.randomUUID(),
          role: (data.role as Message['role']) || 'assistant',
          content: typeof data.content === 'string' ? data.content : '',
          source: (data.source as string) || 'followup',
          // Carry the row's metadata so the message keeps its identity across a
          // reload. Without it a heartbeat note arrived as an ordinary assistant
          // bubble and then turned into a status line on refresh, once the
          // metadata-bearing row came back from the DB.
          metadata: data.metadata ?? undefined,
        };

        // Status updates are mid-conversation — insert just before the active
        // progress bubble so the user sees them in the right chronological
        // position (before the final answer). Everything else appends.
        if (data.source === 'status_update') {
          const progressIdx = messages.findIndex((m) => m.isProgress);
          if (progressIdx >= 0) {
            messages = [
              ...messages.slice(0, progressIdx),
              newMsg,
              ...messages.slice(progressIdx),
            ];
          } else {
            messages = [...messages, newMsg];
          }
        } else {
          messages = [...messages, newMsg];
        }
        scrollToBottom();
      } catch {
        // ignore malformed frames
      }
    });
  });

  async function cancelJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
    chatStream?.close();
    chatStream = null;
  }

  function friendlyToolName(name: string): string {
    const labels: Record<string, string> = {
      activate_toolset: 'Loading toolset',
      ha_query_state: 'Querying device',
      ha_call_service: 'Controlling device',
      ha_fire_event: 'Firing event',
      ha_get_history: 'Getting history',
      ha_render_template: 'Running template',
      reverse_geocode: 'Geocoding',
      jkai_help: 'Checking capabilities',
      list_custom_tools: 'Listing tools',
      create_tool: 'Creating tool',
      status_update: 'Status update',
    };
    return labels[name] || name.replace(/_/g, ' ');
  }

  // ── Streaming toolchain bar ───────────────────────────────────────────────
  // A live turn rendered one step-card per call, so a chain of eight tools
  // pushed the answer — and everything above it — off the screen while you
  // watched. The chain is behind one collapsed bar now: status glyph, count,
  // and the step that is running right this second. Expanding gives back the
  // same step-cards list, unchanged. Keyed by the in-flight bubble's id so a
  // background tab keeps its own open/closed state.
  let toolchainOpen = $state<Record<string, boolean>>({});
  function toggleToolchain(bubbleId: string) {
    toolchainOpen = { ...toolchainOpen, [bubbleId]: !toolchainOpen[bubbleId] };
  }

  type IndexedStep = { step: ToolStep; index: number };

  /** Split a bubble's steps into the tool chain and the `status_update` notes,
   *  keeping each step's ORIGINAL index — `toggleStepExpanded` addresses steps
   *  by position in `msg.toolSteps`, so a filtered list would expand the wrong
   *  card. The notes are prose the model wrote for the user and stay inline;
   *  only the chain goes behind the bar. */
  function splitToolSteps(steps: ToolStep[] | undefined): { chain: IndexedStep[]; notes: IndexedStep[] } {
    const chain: IndexedStep[] = [];
    const notes: IndexedStep[] = [];
    (steps ?? []).forEach((step, index) => {
      (step.tool === 'status_update' ? notes : chain).push({ step, index });
    });
    return { chain, notes };
  }

  /** The step the collapsed bar speaks for: whichever is still running, else
   *  the last one to have finished. */
  function currentChainStep(chain: IndexedStep[]): ToolStep | null {
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i].step.status === 'running') return chain[i].step;
    }
    return chain.length > 0 ? chain[chain.length - 1].step : null;
  }

  function toggleStepExpanded(stepIndex: number) {
    messages = messages.map((m) => {
      if (!m.isProgress || !m.toolSteps) return m;
      const steps = m.toolSteps.map((s, i) =>
        i === stepIndex ? { ...s, expanded: !s.expanded } : s,
      );
      return { ...m, toolSteps: steps };
    });
  }

  function toggleSubAgentStep(agentId: string, toolCallId: string) {
    const a = subAgents[agentId];
    if (!a) return;
    const step = a.toolSteps.find((s) => s.toolCallId === toolCallId);
    if (step) step.expanded = !step.expanded;
  }

  // Builds the SSE event handler that routes orchestrator events into the
  // chat bubble identified by `progressId`. Shared by send() (new requests)
  // and resumeRunningJob() (re-attaching to a server-side job after the
  // user returns to the page). `accRef.value` accumulates streamed tokens
  // so the terminal `done` event can fall back to them if the persisted
  // response is missing.
  function makeProgressHandler(progressId: string, accRef: { value: string }): (data: any) => void {
    return (data: any) => {
      if (data.type === 'connected') return;

      if ((data.type === 'token' || data.type === 'thinking') && pendingTtft.has(progressId)) {
        const m = pendingTtft.get(progressId)!;
        m.onFirstToken();
        pendingTtft.delete(progressId);
      }

      if (data.type === 'thinking') lastReasoningAt = Date.now();
      if (
        data.type === 'token' ||
        data.type === 'thinking' ||
        data.type === 'tool_start' ||
        data.type === 'tool_result' ||
        data.type === 'replace_bubble'
      ) {
        lastModelEventAt = Date.now();
      }

      // Feed the bottom-left tok/s meter. Reply text and reasoning both count
      // as generated output; a tool call bills its argument JSON and then
      // pauses the clock for however long the tool runs, resuming on its
      // result (so the provider's prefill wait afterwards still counts).
      if (data.type === 'token' || data.type === 'thinking') meterOutput(data.delta);
      else if (data.type === 'tool_start') meterToolStart(data.args);
      else if (data.type === 'tool_result') meterToolEnd();

      if (data.type === 'token') {
        heartbeat = null;
        accRef.value += data.delta;
        messages = messages.map((m) =>
          m.id === progressId ? { ...m, content: accRef.value } : m,
        );
        scrollToBottom();
        return;
      }

      if (data.type === 'replace_bubble') {
        heartbeat = null;
        accRef.value = data.content;
        messages = messages.map((m) =>
          m.id === progressId ? { ...m, content: accRef.value } : m,
        );
        scrollToBottom();
        return;
      }

      if (data.type === 'thinking') {
        heartbeat = null;
        const prev = thinkingByBubble.get(progressId) ?? { text: '', expanded: false };
        const next = new Map(thinkingByBubble);
        next.set(progressId, { ...prev, text: prev.text + data.delta });
        thinkingByBubble = next;
        return;
      }

      if (data.type === 'tool_start') {
        heartbeat = null;
        const newStep: ToolStep = {
          id: data.toolCallId,
          tool: data.tool,
          args: data.args || {},
          status: 'running',
          summary: data.summary,
          startedAt: Date.now(),
        };
        messages = messages.map((m) => {
          if (m.id !== progressId) return m;
          return { ...m, toolSteps: [...(m.toolSteps ?? []), newStep] };
        });
        scrollToBottom();
        return;
      }

      if (data.type === 'tool_result') {
        heartbeat = null;
        messages = messages.map((m) => {
          if (m.id !== progressId || !m.toolSteps) return m;
          const idx = (() => {
            // Prefer an exact id match — the bus + Hermes frames carry a stable
            // toolCallId, so concurrent calls of the SAME tool (e.g. many
            // parallel web_search / fetch_url) never write into each other's
            // card. Fall back to the most-recent running same-named step only
            // when no id is present (older/native frames).
            if (data.toolCallId) {
              for (let i = m.toolSteps.length - 1; i >= 0; i--) {
                if (m.toolSteps[i].id === data.toolCallId && m.toolSteps[i].status === 'running') return i;
              }
            }
            for (let i = m.toolSteps.length - 1; i >= 0; i--) {
              if (m.toolSteps[i].tool === data.tool && m.toolSteps[i].status === 'running') return i;
            }
            return -1;
          })();
          if (idx < 0) return m;
          const next = m.toolSteps.slice();
          next[idx] = { ...next[idx], result: data.result, status: data.status, summary: data.summary, children: data.children };
          return { ...m, toolSteps: next };
        });
        scrollToBottom();
        return;
      }

      if (data.type === 'status') {
        heartbeat = null;
        const newMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.text,
          source: 'status_update',
          createdAt: new Date().toISOString(),
        };
        const progressIdx = messages.findIndex((m) => m.isProgress);
        if (progressIdx >= 0) {
          messages = [
            ...messages.slice(0, progressIdx),
            newMsg,
            ...messages.slice(progressIdx),
          ];
        } else {
          messages = [...messages, newMsg];
        }
        scrollToBottom();
        return;
      }

      if (data.type === 'heartbeat') {
        heartbeat = {
          summary: data.summary,
          phase: data.phase ?? 'thinking',
          elapsedSec: Math.round((data.elapsedMs ?? 0) / 1000),
          lastBeatAt: Date.now(),
        };
        hbNow = Date.now();
        startHeartbeatTicker();
        return;
      }

      if (data.type === 'plan') {
        pendingPlan = { planId: data.planId, plan: data.plan };
        heartbeat = null;
        return;
      }

      if (data.type === 'plan_ack') {
        pendingPlan = null;
        return;
      }

      if (data.type === 'confirm') {
        pendingConfirm = {
          confirmId: data.confirmId,
          prompt: data.prompt,
          destructive: data.destructive,
          details: data.details,
        };
        heartbeat = null;
        return;
      }

      if (data.type === 'confirm_ack') {
        pendingConfirm = null;
        return;
      }

      // Credential request. Rendered as a modal, NOT as an inline card: a
      // credential form must not live inside a scrolling progress bubble where
      // it can be half-visible or scrolled away mid-entry.
      if (data.type === 'secret_request') {
        pendingSecret = data;
        heartbeat = null;
        return;
      }

      if (data.type === 'secret_ack') {
        pendingSecret = null;
        return;
      }

      if (data.type === 'clarify') {
        pendingClarify = { clarifyId: data.clarifyId, questions: data.questions };
        heartbeat = null;
        return;
      }

      if (data.type === 'clarify_ack') {
        pendingClarify = null;
        return;
      }

      if (data.type === 'approval') {
        pendingApproval = {
          command: data.command,
          description: data.description,
          sessionKey: data.sessionKey,
        };
        heartbeat = null;
        return;
      }

      if (data.type === 'subagent_start') {
        subAgents[data.agentId] = {
          agentId: data.agentId,
          task: data.task,
          status: 'running',
          liveTokens: '',
          toolSteps: [],
          startedAt: Date.now(),
        };
        heartbeat = null;
        return;
      }

      if (data.type === 'subagent_event') {
        const a = subAgents[data.agentId];
        if (!a) return;
        const ev = data.event;
        if (ev.type === 'token') {
          a.liveTokens += ev.delta;
        } else if (ev.type === 'tool_start') {
          // Hermes only relays child tool *starts* (completions are swallowed),
          // and children run their tools sequentially — so the arrival of the
          // next tool means the previous one finished. Close it out so the row
          // shows ✓ rather than an eternal spinner.
          for (let i = a.toolSteps.length - 1; i >= 0; i--) {
            if (a.toolSteps[i].status === 'running') { a.toolSteps[i].status = 'done'; break; }
          }
          a.toolSteps.push({
            toolCallId: ev.toolCallId ?? crypto.randomUUID(),
            tool: ev.tool,
            args: ev.args ?? {},
            status: 'running',
            summary: ev.summary,
          });
        } else if (ev.type === 'tool_result') {
          const callId = ev.toolCallId;
          let idx = -1;
          if (callId) idx = a.toolSteps.findIndex((s) => s.toolCallId === callId);
          if (idx < 0) {
            for (let i = a.toolSteps.length - 1; i >= 0; i--) {
              if (a.toolSteps[i].tool === ev.tool && a.toolSteps[i].status === 'running') { idx = i; break; }
            }
          }
          if (idx >= 0) {
            a.toolSteps[idx] = { ...a.toolSteps[idx], status: ev.status, result: ev.result, summary: ev.summary };
          }
        }
        return;
      }

      if (data.type === 'subagent_done') {
        const a = subAgents[data.agentId];
        if (a) {
          a.status = data.summary === 'failed' ? 'error' : 'done';
          a.summary = data.summary;
          a.liveTokens = '';
          // Close any still-running tool step (the last one has no completion frame).
          for (const s of a.toolSteps) if (s.status === 'running') s.status = 'done';
        }
        return;
      }

      if (data.type === 'done') {
        heartbeat = null;
        pendingTtft.delete(progressId);
        pendingPlan = null;
        pendingConfirm = null;
        pendingClarify = null;
        pendingApproval = null;
        const result = (data.result || {}) as {
          message?: string;
          error?: string;
          workflow?: unknown;
          thinking?: OrchestratorThinking;
          attachments?: Message['attachments'];
          fileRefs?: FileSearchRef[];
          researchRefs?: ResearchSearchRef[];
          workflowRefs?: WorkflowChipRef[];
          usage?: { outputTokens?: number | null; stamp?: TurnStamp };
          traceId?: string;
        };
        // Settle the tok/s meter against the provider's own output-token count
        // (reasoning + tool-call tokens included) when the server reported one;
        // otherwise it keeps the streamed chars/4 estimate.
        meterSettle(result.usage?.outputTokens ?? null);
        const prior = messages.find((m) => m.id === progressId);
        const finalContent = result.message || result.error || accRef.value || 'No response.';
        const finalMsg: Message = {
          id: progressId,
          role: 'assistant',
          content: finalContent,
          // The priced per-turn stamp travels on `done` so the cost line appears
          // under the reply immediately, not only after a reload.
          metadata: { workflowGenerated: !!result.workflow, usage: result.usage?.stamp },
          thinking: result.thinking || undefined,
          isProgress: false,
          source: 'web',
          toolSteps: prior?.toolSteps,
          fileRefs: result.fileRefs ?? undefined,
          researchRefs: result.researchRefs ?? undefined,
          workflowRefs: result.workflowRefs ?? undefined,
          attachments: result.attachments ?? undefined,
          // Written server-side BEFORE `done` was published, so linking to it
          // straight away can't race the insert.
          traceId: result.traceId ?? undefined,
          createdAt: prior?.createdAt ?? new Date().toISOString(),
        };
        messages = messages.map((m) => (m.id === progressId ? finalMsg : m));
        scrollToBottom();
        // The turn is on record now, so the thread's graph can have gained
        // structure (model, files, canvases) and — on an extraction turn —
        // concepts once the queue drains. Tell the rail to look again.
        bumpGraphIfOnScreen();
        return;
      }

      if (data.type === 'error') {
        turnOk = false;
        heartbeat = null;
        pendingTtft.delete(progressId);
        pendingPlan = null;
        pendingConfirm = null;
        pendingClarify = null;
        pendingApproval = null;
        meterSettle();
        messages = messages.map((m) =>
          m.id === progressId
            ? { ...m, isProgress: false, content: `Error: ${data.message ?? 'Unknown error'}` }
            : m,
        );
        scrollToBottom();
        return;
      }
    };
  }

  // Re-attach to a server-side job that's already running for the active
  // conversation (e.g. the user backgrounded the tab, the job kept running,
  // and now they're back). Replays the buffered events first, then streams
  // live ones, painting them into a fresh progress bubble.
  async function resumeRunningJob(jobId: string): Promise<void> {
    if (loading || currentJobId) return;
    loading = true;
    currentJobId = jobId;
    heartbeat = null;
    pendingPlan = null;
    pendingConfirm = null;
    pendingClarify = null;
    pendingApproval = null;
    subAgents = {};

    const progressId = crypto.randomUUID();
    pendingTtft.set(progressId, startTtftMark(progressId));
    // Re-attaching: the bus replays its buffered events in one burst, so this
    // turn's throughput isn't measurable — account for it but publish nothing.
    meterBegin({ replay: true });
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: '',
      isProgress: true,
      progressSteps: [],
      toolSteps: [],
      createdAt: new Date().toISOString(),
    }];
    scrollToBottom();

    const accRef = { value: '' };
    const handler = makeProgressHandler(progressId, accRef);
    chatStream = streamChatJob(jobId, {
      onEvent: handler,
      onWarning: (w) => { connectionWarning = w; },
    });
    try {
      await chatStream.done;
    } finally {
      chatStream = null;
      loading = false;
      currentJobId = null;
      heartbeat = null;
      pendingPlan = null;
      pendingConfirm = null;
      pendingClarify = null;
      pendingApproval = null;
      meterSettle();
      scrollToBottom();
    }
  }

  // Starter prompts shown on the empty-state hero. Clicking one drops it into
  // the composer and sends immediately — a one-tap way to discover what jkai
  // can do instead of staring at a blank thread.
  const EXAMPLE_PROMPTS = [
    { icon: 'home', label: 'Check the house', text: 'Give me a quick status of my home — is everything secure, and is anything off or needing attention?' },
    { icon: 'health', label: "Today's health", text: 'Summarise my health data for today — sleep, recovery and strain.' },
    { icon: 'bolt', label: "What's running?", text: 'What workflows and scheduled tasks do I have running right now?' },
    { icon: 'spark', label: 'What can you do?', text: 'What can you help me with? Give me a short tour of your capabilities.' },
  ] as const;
  function usePrompt(text: string) {
    input = text;
    void send();
  }

  // ── Command palette (item 1) + model switcher (item 2) ──────────────────
  // Both surfaces only function when Hermes handles the chat (`hermesEnabled`):
  // the gateway interprets slash commands (/usage, /model …) before the agent
  // runs, whereas the legacy in-process loop would forward them to the LLM as
  // prose.

  // Gateway slash commands that are safe to fire through the jkai bridge
  // (verified at the platform-dispatch level in hermes gateway/run.py). `send`
  // fires the command silently; `insert` drops it into the composer so the user
  // can add an argument before sending.
  const PALETTE_COMMANDS: { command: string; hint: string; mode: 'send' | 'insert' }[] = [
    { command: '/usage', hint: 'Token usage & cost for this session', mode: 'send' },
    { command: '/status', hint: 'Session status', mode: 'send' },
    { command: '/compress', hint: 'Summarise & compress the context', mode: 'send' },
    { command: '/goal', hint: 'Set a goal for the agent to pursue', mode: 'insert' },
  ];
  let paletteIndex = $state(0);
  let paletteDismissed = $state(false);
  const paletteMatches = $derived.by(() => {
    if (!hermesEnabled || !conversationId) return [];
    const v = input;
    // Only while typing the command token itself — a space means we've moved on
    // to arguments, so the palette gets out of the way.
    if (!v.startsWith('/') || /\s/.test(v)) return [];
    const q = v.slice(1).toLowerCase();
    return PALETTE_COMMANDS.filter((c) => c.command.slice(1).toLowerCase().startsWith(q));
  });
  const paletteOpen = $derived(paletteMatches.length > 0 && !paletteDismissed);

  function onComposerInput() {
    // Typing re-opens a dismissed palette and resets the highlight so a stale
    // index can never point past the freshly-filtered list.
    paletteDismissed = false;
    paletteIndex = 0;
    mentionDismissed = false;
    mentionIndex = 0;
    // Editing a recalled message makes it the live draft: stop treating Up/Down
    // as history navigation until the next recall.
    historyOffset = 0;
  }

  // Grow the composer with its content instead of scrolling a one-row box.
  // Reset to `auto` first so the box can shrink again on delete, then take the
  // content height; the stylesheet's max-height caps it and hands over to
  // scrolling, so no pixel budget is duplicated here. Tracks `input` rather
  // than hooking `oninput`, so programmatic writes — history recall, slash
  // inserts, send() clearing it — resize too.
  $effect(() => {
    input;
    const el = textareaEl;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  });

  // ── Composer history — Up/Down recall previous sends, shell-style ──────────
  // Sourced from the thread's own user messages, so it survives a reload and
  // follows you between threads. Newest last.
  const composerHistory = $derived(
    messages.filter((m) => m.role === 'user' && m.content.trim()).map((m) => m.content)
  );
  // Neither of these is read from the template or a $derived — plain `let`, so
  // no effect can ever subscribe to them.
  let historyOffset = 0; // 0 = live draft, 1 = last message, 2 = the one before…
  let historyDraft = '';

  function resetHistoryCycle() {
    historyOffset = 0;
    historyDraft = '';
  }

  function recallHistory(text: string) {
    input = text;
    // Caret to the end, so the recalled text is ready to edit or re-send and a
    // further Down keeps cycling rather than moving the caret.
    tick().then(() => {
      if (!textareaEl) return;
      const end = textareaEl.value.length;
      textareaEl.focus();
      textareaEl.setSelectionRange(end, end);
    });
  }

  function selectPaletteCommand(cmd: { command: string; mode: 'send' | 'insert' }) {
    paletteDismissed = true;
    if (cmd.mode === 'send') {
      input = '';
      resetHistoryCycle();
      void silentSend(cmd.command);
    } else {
      input = cmd.command + ' ';
      tick().then(() => textareaEl?.focus());
    }
  }

  // "@" mention typeahead — @files searches /drive file content, @research
  // searches the materials (facts) of your deep-dive research sessions. Each
  // routes the turn to its domain skill and answers with citations. Triggers on
  // an @-token being typed at the end of the input, mirroring the slash palette.
  const MENTION_OPTIONS: { token: string; hint: string }[] = [
    { token: '@files', hint: 'Search your /drive files by content — text, images, audio' },
    { token: '@research', hint: 'Search your deep-dive research materials by meaning' },
    { token: '@knowledge', hint: 'Recall across everything — files, research, memory, and datastore' },
    { token: '@entity', hint: 'Ground this turn in what the intel graph knows about a named entity' },
  ];
  const MENTION_RE = /(^|\s)@(\w*)$/;
  let mentionIndex = $state(0);
  let mentionDismissed = $state(false);
  const mentionMatches = $derived.by(() => {
    const m = input.match(MENTION_RE);
    if (!m) return [];
    const q = m[2].toLowerCase();
    return MENTION_OPTIONS.filter((o) => o.token.slice(1).toLowerCase().startsWith(q));
  });
  const mentionOpen = $derived(mentionMatches.length > 0 && !mentionDismissed);

  function selectMention(opt: { token: string }) {
    mentionDismissed = true;
    input = input.replace(MENTION_RE, (_full, pre) => `${pre}${opt.token} `);
    tick().then(() => textareaEl?.focus());
  }

  // ── Composer chips ────────────────────────────────────────────────────────
  // The `/ prompt` and `⌥ workflow` chips are affordances for the typeahead
  // that already exists: they seed the trigger character and focus the input,
  // so the same palette opens whether you click or type.
  // The full prompt hint needs two lines at the phone's 16px input font (16px
  // is required — anything smaller makes iOS zoom the viewport on focus), and a
  // 48px field clips the second. Phones get the short form.
  let isPhone = $state(false);
  onMount(() => {
    const mq = window.matchMedia('(max-width: 799px)');
    const sync = () => { isPhone = mq.matches; };
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });
  const composerPlaceholder = $derived(
    isPhone ? 'Ask…' : 'Ask, or type / for prompts, ⌥ to fire a workflow…',
  );

  function insertSlash() {
    paletteDismissed = false;
    input = '/';
    tick().then(() => textareaEl?.focus());
  }
  function insertWorkflowMention() {
    mentionDismissed = false;
    input = input.length === 0 || input.endsWith(' ') ? `${input}@` : `${input} @`;
    tick().then(() => textareaEl?.focus());
  }

  /** Live cost estimate for the next turn: the context we would re-send priced
   *  at the model's prompt rate, plus a nominal reply at its completion rate.
   *  Uses the conversation's own price snapshot (USD per token), so it moves
   *  when the model chip changes. Null when we have no snapshot to price with. */
  const ASSUMED_REPLY_TOKENS = 600;
  const estPerTurnUsd = $derived.by(() => {
    const snap = conversation?.priceSnapshot;
    if (!snap) return null;
    const promptPrice = Number(snap.promptPrice);
    const completionPrice = Number(snap.completionPrice);
    if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice)) return null;
    const ctx = contextTokens ?? 0;
    return ctx * promptPrice + ASSUMED_REPLY_TOKENS * completionPrice;
  });


  // ── @entity — name completion from the intel graph ──────────────────────────
  // Once "@entity " is typed, the following words complete against real entity
  // names. Picking one pins it so the turn is sent with a 2-hop subgraph as
  // grounding, rather than hoping the model recalls the right thing.
  const ENTITY_RE = /@entity\s+([^@]*)$/i;
  let entityIndex = $state(0);
  let entityDismissed = $state(false);
  let pinnedEntityIds = $state<string[]>([]);

  const entityMatches = $derived.by(() => {
    const m = input.match(ENTITY_RE);
    if (!m || !entityMentions.length) return [];
    const q = m[1].trim().toLowerCase();
    if (!q) return entityMentions.slice(0, 8);
    return entityMentions
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 8);
  });
  const entityPickerOpen = $derived(entityMatches.length > 0 && !entityDismissed);

  // Re-open the picker when the user carries on typing after dismissing it, the
  // same way the token picker behaves. Reads `input` only; the write is a plain
  // boolean that nothing in this effect reads back.
  $effect(() => {
    input;
    untrack(() => {
      entityDismissed = false;
      entityIndex = 0;
    });
  });

  function selectEntity(e: MentionTarget) {
    entityDismissed = true;
    // Replace the partial name with the canonical one, so the grounding the
    // server attaches and the text the user sees agree.
    input = input.replace(ENTITY_RE, () => `@entity ${e.name} `);
    if (!pinnedEntityIds.includes(e.id)) pinnedEntityIds = [...pinnedEntityIds, e.id];
    tick().then(() => textareaEl?.focus());
  }

  // ── @files references ───────────────────────────────────────────────────────
  // file_search hits render as clickable "sources" chips → open the file viewer at
  // the cited passage. Refs are attached to the assistant message server-side
  // (msg.fileRefs), populated live from the `done` event and on reload from
  // persisted metadata (tool steps aren't persisted on the Hermes branch, so
  // scraping them client-side was unreliable).
  type FileSearchRef = {
    fileId: string; source: string; modality: string; score: number;
    chunkOrd?: number; charStart?: number; charEnd?: number; passage: string;
  };
  // @research (research_search) refs — a fact/passage cited from a deep-dive
  // session, with its web source. Rendered as "research" chips that open the
  // source's page material in a rich reader modal (see ResearchSourceModal /
  // ResearchReferenceChips). `sourceId` keys the source reconstruction endpoint.
  type ResearchSearchRef = {
    factId: string; sourceId: string | null; sessionId: string; sessionTopic: string;
    sourceTitle: string | null; sourceUrl: string | null; domain: string | null;
    score: number; passage: string;
  };
  // Workflow chips — a canvas this turn created/updated (workflow_create /
  // workflow_build_from_spec / monitor_create). Rendered as a deep-link chip.
  type WorkflowChipRef = { workflowId: string; slug: string; name: string; url: string };

  let refModal = $state<{
    file: { id: string; name: string; mimeType: string };
    highlight: { passage: string; charStart?: number; charEnd?: number; modality?: string };
  } | null>(null);
  function openFileRef(ref: FileSearchRef) {
    refModal = {
      // mimeType is left empty — the viewer derives the kind from the filename
      // extension (source carries it, e.g. "…/portrait.jpg", "…Strategy.docx").
      file: { id: ref.fileId, name: ref.source, mimeType: '' },
      highlight: { passage: ref.passage, charStart: ref.charStart, charEnd: ref.charEnd, modality: ref.modality },
    };
  }

  // @research chips → open the source's reconstructed page material in the rich
  // reader modal (ResearchSourceModal), rather than leaving the app for the URL.
  let researchModal = $state<ResearchSearchRef | null>(null);
  function openResearchRef(ref: ResearchSearchRef) {
    researchModal = ref;
  }

  // Skill picker — pins a jkai domain skill for the conversation (general chat),
  // sent as `pinnedSkill` on each turn. 'Auto' (null) leaves jkai-general to
  // route. Switchable any time; sticky until changed. Server + adapter both
  // allowlist the value, so an off-list name can't load an arbitrary skill.
  let pinnedSkill = $state<string | null>(null);
  let skillMenuOpen = $state(false);
  const SKILL_OPTIONS: { value: string | null; label: string }[] = [
    { value: null, label: 'Auto' },
    { value: 'jkai-blog', label: 'Blog' },
    { value: 'jkai-gmail', label: 'Email' },
    { value: 'jkai-health', label: 'Health' },
    { value: 'jkai-research', label: 'Research' },
    { value: 'jkai-scheduled', label: 'Scheduled' },
    { value: 'jkai-scraper', label: 'Scraper' },
    { value: 'jkai-home-assistant', label: 'Home' },
    { value: 'jkai-files', label: 'Files' },
    { value: 'jkai-utility', label: 'Utility' },
    { value: 'jkai-node-builder', label: 'Node Builder' },
  ];
  const pinnedSkillLabel = $derived(SKILL_OPTIONS.find((o) => o.value === pinnedSkill)?.label ?? 'Auto');

  // Model switcher — switchable only on a fresh conversation (no messages yet).
  // The conversation's model locks after the first message (the PATCH returns
  // 409, and a mid-chat switch churns the prefix cache), so after that we just
  // show a static label.
  let modelPickerOpen = $state(false);
  // The site default can be changed from inside the picker, so it is local state
  // seeded from the prop rather than read straight through — otherwise the pill's
  // "default" tag would lie until the next page load.
  let siteDefaultModelId = $state(defaultChatModelId);
  // True once the user picks a model for THIS conversation by hand. Query-adaptive
  // routing then leaves it alone: a deliberate choice must not be silently
  // overwritten on send.
  let modelPickedByUser = $state(false);
  const currentModel = $derived({
    provider: (conversation?.modelProvider as ModelContext['provider']) ?? 'openrouter',
    modelId: conversation?.modelId ?? siteDefaultModelId,
  });
  // ── Thread ledger ─────────────────────────────────────────────────────────
  // The thread header's `MODEL / N TURNS / N TOK / £COST` line, and the same
  // numbers published to the hub header's token strip. Tokens and cost are
  // summed from the per-turn stamps in the loaded history, so they agree with
  // the per-reply cost lines rather than drifting from a separate total.
  const turnStamps = $derived(
    messages
      .map((m) => m.metadata?.usage ?? readTurnStamp(m.metadata))
      .filter((s): s is TurnStamp => s !== null),
  );
  const threadTurns = $derived(messages.filter((m) => m.role === 'assistant' && !m.isProgress).length);
  const threadTokens = $derived(
    turnStamps.reduce((sum, s) => sum + s.inputTokens + s.outputTokens, 0),
  );
  const threadCostUsd = $derived(
    turnStamps.length > 0
      ? turnStamps.reduce((sum, s) => sum + s.costUsd, 0)
      : Number(conversation?.costUsd ?? 0),
  );
  // Context occupancy = the prompt size of the most recent turn. That IS what
  // the model is currently carrying; summing every turn would double-count the
  // history each turn re-sends.
  const contextTokens = $derived(
    turnStamps.length > 0 ? turnStamps[turnStamps.length - 1].inputTokens : null,
  );
  const threadTitle = $derived(conversation?.title?.trim() || 'new thread');

  $effect(() => {
    // The hub header carries ONE thread's numbers, so only the pane on screen
    // may publish them. Without this gate a background tab's turn would rewrite
    // the cost and context figures above the thread the user is actually reading.
    if (!active) return;
    // Tracked reads only — the ledger numbers. The write is untracked so the
    // shared store's proxy can't re-trigger this effect.
    const next = {
      contextTokens,
      contextFraction:
        contextTokens !== null && modelContextLength && modelContextLength > 0
          ? contextTokens / modelContextLength
          : null,
      threadCostUsd,
      turns: threadTurns,
      modelId: currentModel.modelId,
    };
    untrack(() => setThreadLedger(next));
  });

  // Closing a background tab must not blank the header — those numbers belong to
  // whichever thread is on screen, which is not this one.
  onMount(() => () => { if (active) clearThreadLedger(); });
  // Always show the model that will actually answer (the conversation's pin,
  // falling back to the site default) — "Click to select" hid the effective
  // model and made the pill look broken.
  const modelIsDefault = $derived(currentModel.modelId === siteDefaultModelId);
  const modelTriggerLabel = $derived(shortModelLabel(currentModel.modelId));

  // ── Query-adaptive routing ────────────────────────────────────────────────
  // On the first message of a fresh conversation the server classifies the query
  // and returns the model chosen for that profile; we apply it via switchModel
  // (the same battle-tested path the manual picker uses). After the first reply
  // a 👍/👎 records whether it got the query right first time — the nightly
  // selection biases toward models that do. Best-effort throughout.
  let routedInfo = $state<{ profileLabel: string; modelId: string; reason: string } | null>(null);
  let routingVote = $state<'up' | 'down' | null>(null);
  const assistantReplyCount = $derived(messages.filter((m) => m.role === 'assistant' && !m.isProgress).length);
  const showRoutingFeedback = $derived(
    hermesEnabled && !!routedInfo && routingVote === null && !loading && assistantReplyCount === 1,
  );

  async function applyRouting(text: string, isFirstMessage: boolean): Promise<void> {
    // Only route the FIRST message of a conversation (model locks after it) and
    // only on the Hermes engine (the switchModel /model path needs it).
    // `isFirstMessage` is snapshotted by the caller BEFORE it appends the
    // optimistic user bubble — reading `messages.length` here now would see that
    // bubble and silently disable routing for every conversation.
    if (!hermesEnabled || !conversationId || !isFirstMessage) return;
    // A hand-picked model wins over the router — overriding it would make the
    // picker feel broken.
    if (modelPickedByUser) return;
    const staged = pendingAttachments.filter((a) => !a.uploading && !a.error && !a.incompatible);
    try {
      const res = await fetch('/api/jkai/routing/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
          hasAttachments: staged.length > 0,
        }),
      });
      if (!res.ok) return;
      const r = await res.json();
      if (r?.enabled && r.modelId) {
        // Cost-optimal picks are often text-only. Never route a conversation that
        // already has attachments staged onto a model that cannot read them —
        // the files would be silently dropped or rejected downstream.
        if (staged.length > 0 && r.caps && staged.some((a) => !kindAllowedByRoutedCaps(a.kind, r.caps))) {
          return;
        }
        routedInfo = { profileLabel: r.profileLabel, modelId: r.modelId, reason: r.reason };
        if (r.modelId !== currentModel.modelId) {
          await switchModel('openrouter', r.modelId, { force: true });
        }
      }
    } catch {
      /* routing is best-effort — never block the send */
    }
  }

  type Caps = { image: boolean; audio: boolean; video: boolean; pdf: boolean; documentText: boolean };
  function kindAllowedByRoutedCaps(kind: string, caps: Caps): boolean {
    switch (kind) {
      case 'image': return caps.image;
      case 'audio': return caps.audio;
      case 'video': return caps.video;
      case 'pdf': return caps.pdf;
      case 'document':
      case 'text': return caps.documentText;
      default: return false;
    }
  }

  async function voteRouting(vote: 'up' | 'down') {
    if (!conversationId) return;
    routingVote = vote;
    try {
      await fetch('/api/jkai/routing/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, vote }),
      });
    } catch {
      /* the vote is best-effort */
    }
  }

  async function switchModel(provider: ModelContext['provider'], modelId: string, opts?: { force?: boolean }) {
    modelPickerOpen = false;
    // `force` is the send() path. send() now claims `loading` up front so the
    // composer disables the instant you hit submit, which would otherwise make
    // the guard below a no-op and silently kill query-adaptive routing. When
    // forced, send() owns `loading` for the whole turn — this must not clear it.
    const force = opts?.force === true;
    if (!conversationId || (loading && !force)) return;
    if (currentModel.provider === provider && currentModel.modelId === modelId) return;

    // 1) Persist for cost accuracy + lock the conversation's model. The PATCH
    //    409s if a message already exists — the source of truth for "can we
    //    still switch".
    try {
      const res = await fetch(`/api/jkai/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelProvider: provider, modelId }),
      });
      if (!res.ok) {
        showToast(res.status === 409 ? 'Model locks after the first message.' : 'Could not switch model.');
        return;
      }
    } catch {
      showToast('Could not switch model.');
      return;
    }
    onmodelchange?.({ provider, modelId });

    // 2) Tell Hermes for this chat session via the gateway /model command.
    //
    //    On the send path (`force`) we wait only for the POST — one ~90ms local
    //    round trip that creates the job — not for the silent turn, which used
    //    to hold the user's first message for up to 15s and was most of what
    //    made a first reply feel 30s slow. The guarantee moves rather than
    //    disappears: the pin job now exists before `send()` creates the user's
    //    job, so the job store queues the user turn behind it per conversation
    //    (`whenJobSettles`); and the server pump's `ensureModelPinned`
    //    re-asserts the conversation's stored model regardless.
    //
    //    The manual picker waits for the whole turn: nothing is racing it there,
    //    and the disabled composer is the only feedback the user gets.
    if (force) {
      await tellHermesModel(provider, modelId);
      return;
    }
    loading = true;
    try {
      await tellHermesModel(provider, modelId, { awaitTurn: true });
    } finally {
      loading = false;
    }
  }

  /** The `conversation:model` pair a `/model` push has already been fired for.
   *  Written by `tellHermesModel` itself so BOTH push sites share one guard.
   *  A plain `let`, never `$state`: the open-time effect below both reads and
   *  writes it, and as reactive state that is the documented route to
   *  `effect_update_depth_exceeded`. */
  let modelPushedForKey: string | null = null;

  /** Push a model choice to Hermes for this chat session via the gateway
   *  `/model` command. Sent silently (no user bubble) and its confirmation reply
   *  is drained without rendering.
   *
   *  Hermes keys the switch to the chat session and holds it in memory, so it
   *  has to be pushed once per conversation — see the open-time effect below.
   *
   *  Resolves once the JOB EXISTS, not once the turn finishes. That distinction
   *  is the whole of WS1: the job is created (and registered against this
   *  conversation) by the POST, which costs one ~90ms local round trip, while
   *  waiting for the turn cost up to 15s. Callers that need ordering await the
   *  POST; nobody awaits the turn except the manual picker (`awaitTurn`), where
   *  the user is not mid-send and the disabled composer is the feedback.
   *
   *  Awaiting the POST is not optional on the send path. Fired truly
   *  and-forget, the pin's POST and the user turn's POST race each other to
   *  `createJob`, and when the user's wins, the two run CONCURRENTLY on one
   *  chat: the user's job then drops the pin turn's frames as foreign, the pin
   *  job never sees a terminator, and — because the gateway queues — the next
   *  message on that conversation sits behind it until the 255s idle watchdog
   *  kills it. Measured 2026-08-20: a follow-up sent straight after a routed
   *  first message took 4m14s to be answered. Awaiting the POST makes the pin
   *  job discoverable before the user turn is created, so the user turn queues
   *  behind it properly and the pin settles in seconds. */
  async function tellHermesModel(
    provider: ModelContext['provider'],
    modelId: string,
    opts?: { awaitTurn?: boolean },
  ): Promise<void> {
    // Claim the pair SYNCHRONOUSLY, before the first await. Both push sites — the
    // open-time effect and `switchModel` — read this, so a switch that changes
    // `currentModel` (and therefore re-runs the effect) cannot make the effect
    // push the very model `switchModel` is already pushing. Measured 2026-08-20
    // before this line existed: a first message sent TWO identical
    // `/model deepseek-v4-pro` turns, and the user's turn then had to drop the
    // second one's frames.
    modelPushedForKey = `${conversationId ?? ''}:${modelId}`;
    try {
      const res = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: hermesModelCommand(provider, modelId), conversationId, silent: true }),
      });
      const data = await res.json().catch(() => null);
      const jobId = data?.jobId;
      if (!jobId) return;
      // Drain the silent turn's confirmation so it isn't left to the job's own
      // cleanup. Backgrounded unless the caller explicitly wants the turn.
      const drained = Promise.race([
        streamChatJob(jobId, { onEvent: () => {}, onWarning: () => {} }).done.catch(() => {}),
        new Promise((r) => setTimeout(r, 15000)),
      ]);
      if (opts?.awaitTurn) await drained;
    } catch {
      // The choice is already persisted site-side; if the /model turn failed
      // Hermes keeps its own default and pricing may be off until the next turn.
    }
  }

  /** Make sure Hermes is running the model this conversation says it is —
   *  pushed when the conversation OPENS, not when the user sends.
   *
   *  A conversation only ever told Hermes its model when the user *changed* the
   *  picker. One that took the chat default silently never told it anything, so
   *  Hermes fell back to `model.default` in its own config.yaml — the UI, the
   *  price snapshot and the cost accounting all said one model while a different
   *  one answered (seen 2026-08-09: a conversation stamped codex/gpt-5.6-terra
   *  was served by deepseek-v4-flash on OpenRouter). That guarantee is still
   *  here; it has just moved off the send path, where it was costing the user a
   *  silent turn of up to 15s before their first message was even POSTed.
   *
   *  Three things hold the guarantee up now:
   *    1. this push, fired the moment a FRESH conversation has an id — normally
   *       while the user is still typing;
   *    2. job-store queuing, which orders the silent turn ahead of the user's
   *       turn on the same conversation even when they overlap; and
   *    3. the server pump's `ensureModelPinned`, which re-reads the model off
   *       the conversation row and re-asserts it before the user turn goes out.
   *
   *  Fresh conversations only. Pushing on every thread open would spend a silent
   *  turn per thread the user merely glanced at, and an established thread's
   *  model is locked anyway. */
  $effect(() => {
    // Tracked reads: only the signals that say "a fresh conversation is open,
    // and this is the model it should be running".
    const id = conversationId;
    const provider = currentModel.provider;
    const modelId = currentModel.modelId;
    const fresh = messageCount === 0;
    const on = hermesEnabled;
    // Everything else — the guard and the write — is untracked, so this cannot
    // subscribe to its own bookkeeping.
    untrack(() => {
      if (!on || !id || !fresh) return;
      // The id decides the provider, never the stored field: `currentModel`
      // falls back to 'openrouter' whenever the conversation row hasn't loaded,
      // which would hand Hermes a codex/ id under the wrong provider. Coerce
      // BEFORE building the key — `coerceModelContext` rewrites legacy ids and
      // adds the `codex/` prefix, so a key built from the raw id would never
      // match the one `tellHermesModel` records and this would fire every time.
      const ctx = coerceModelContext({ provider, modelId });
      if (modelPushedForKey === `${id}:${ctx.modelId}`) return;
      // `tellHermesModel` claims the key itself, synchronously, so this and
      // `switchModel` cannot both push the same pair.
      void tellHermesModel(ctx.provider, ctx.modelId);
    });
  });

  /**
   * Fire the handed-over question once, as soon as it can actually be sent.
   *
   * A plain `let`, never `$state`: nothing renders it, and the effect below
   * both reads it and writes it — as reactive state that is the documented
   * route to `effect_update_depth_exceeded`.
   */
  let autoSendDone = false;

  $effect(() => {
    if (!autoSend || autoSendDone) return;
    // `?new=1` creates the conversation in the parent's mount hook, so there is
    // usually no id on the first run — wait for one rather than dropping the
    // question on the floor.
    if (!conversationId || !input.trim() || loading) return;
    autoSendDone = true;
    // `send()` writes `input` and `loading`, which this effect reads.
    untrack(() => void send());
  });

  async function send(queuedText?: string) {
    const text = (queuedText ?? input).trim();
    if (!text || !conversationId) return;
    if (loading) {
      // Mid-reply. Hold it and send when this turn closes.
      if (pendingAttachments.length > 0) {
        showToast('Finish the current reply before sending files.');
        return;
      }
      pushQueued(conversationId, text);
      input = '';
      resetHistoryCycle();
      return;
    }

    // Snapshot before `messages` is mutated below — routing applies to the first
    // message of a conversation only, and the optimistic bubble we now append
    // BEFORE routing would otherwise make every conversation look started.
    const isFirstMessage = messages.length === 0;

    if (queuedText === undefined) input = '';
    resetHistoryCycle();
    loading = true;
    // Acknowledge the submit on the spot. The server's first heartbeat is 5s
    // away and the typing dots went in 2026-05-28, so until now pressing enter
    // emptied the composer and then changed nothing on screen for five seconds —
    // which reads as a dropped send. This is the existing heartbeat mechanism
    // with a client-only phase, not a second indicator: the first real frame
    // (heartbeat, token, thinking, tool_start) overwrites or clears it.
    heartbeat = { summary: '', phase: 'received', elapsedSec: 0, lastBeatAt: Date.now() };
    pendingPlan = null;
    pendingConfirm = null;
    pendingClarify = null;
    pendingApproval = null;
    subAgents = {};

    const attachmentIds = pendingAttachments
      .filter(a => !a.uploading && !a.error && !a.incompatible)
      .map(a => a.id);
    const userAttachments = pendingAttachments
      .filter(a => !a.uploading && !a.error && !a.incompatible)
      .map(a => ({ id: a.id, kind: a.kind as any, mimeType: a.mimeType, originalName: a.originalName, sizeBytes: a.sizeBytes, source: 'web' as const }));
    pendingAttachments = [];

    const userMsgId = crypto.randomUUID();
    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content: text,
      source: 'web',
      attachments: userAttachments.length > 0 ? userAttachments : undefined,
      createdAt: new Date().toISOString(),
    };
    messages = [...messages, userMsg];
    // Sending is an explicit "take me to the bottom" — re-arms the follow even
    // if the user had scrolled up to read something before typing.
    scrollToBottom('auto', true);

    // Offline short-circuit: if the browser reports it's offline, skip the
    // POST entirely, enqueue via the PWA outbox, and mark the user bubble
    // queued so the badge renders. The sync manager will flush the outbox
    // once connectivity returns; no progress bubble / SSE stream because
    // there's no server-side job to stream from yet.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      try {
        await enqueueMessage(conversationId, text, attachmentIds.length > 0 ? attachmentIds : undefined);
      } catch (err) {
        console.warn('[ChatArea] offline enqueue failed:', err);
      }
      messages = messages.map((m) => (m.id === userMsgId ? { ...m, queued: true } : m));
      loading = false;
      // Nothing is coming — there is no job to stream from. Drop the synthetic
      // ack so it can't outlive the turn it was acknowledging.
      heartbeat = null;
      scrollToBottom();
      return;
    }

    const progressId = crypto.randomUUID();
    // The TTFT clock starts at submit, ahead of routing. It used to start after
    // routing had already resolved, so the number it logged was never the wait
    // the user actually sat through on a first message.
    pendingTtft.set(progressId, startTtftMark(progressId));
    // Start with a subtle typing indicator — no progress box yet
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: '',
      isProgress: true,
      progressSteps: [],
      toolSteps: [],
      createdAt: new Date().toISOString(),
    }];
    scrollToBottom();

    // Query-adaptive model pick. One ~70ms round trip, and it no longer drags a
    // silent `/model` turn behind it: when routing switches the model the push
    // is fire-and-forget (see `switchModel`), ordered ahead of this message by
    // the job store and backstopped by the server pump. The unconditional pin
    // that used to sit here has moved to conversation-open — see the effect
    // beside `tellHermesModel`. First message of a conversation only.
    await applyRouting(text, isFirstMessage);

    // Throughput clock starts once the model work actually begins — routing is
    // not generation, and billing it here would drag the tok/s meter down.
    meterBegin();

    // An "@files" mention routes this turn to the Files skill so the orchestrator
    // reaches for the file_search tool (semantic search over /drive content); an
    // "@research" mention routes to the Research skill for research_search
    // (semantic search over deep-dive research materials). An explicit pinned
    // skill wins; if both mentions appear, @files takes precedence (a turn pins
    // one skill).
    const mentionsFiles = /(^|\s)@files\b/i.test(text);
    const mentionsResearch = /(^|\s)@research\b/i.test(text);
    // Entities named with @entity are sent as ids so the server can attach the
    // subgraph; clear them once the turn is away.
    const entityIds = pinnedEntityIds.slice();
    pinnedEntityIds = [];
    const effectivePinnedSkill =
      pinnedSkill ?? (mentionsFiles ? 'jkai-files' : mentionsResearch ? 'jkai-research' : undefined);

    try {
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
          useIntelContext,
          pinnedSkill: effectivePinnedSkill,
          intelEntityIds: entityIds.length ? entityIds : undefined,
        }),
      });

      const postData = await postRes.json().catch(() => null);

      if (!postRes.ok) {
        throw new Error(postData?.error || `Server error (${postRes.status})`);
      }

      const jobId = postData?.jobId;
      if (!jobId) throw new Error('No job ID returned');
      currentJobId = jobId;

      const accRef = { value: '' };
      const processSseEvent = makeProgressHandler(progressId, accRef);

      chatStream = streamChatJob(jobId, {
        onEvent: processSseEvent,
        onWarning: (w) => { connectionWarning = w; },
      });
      try {
        await chatStream.done;
      } finally {
        chatStream = null;
      }
    } catch (err) {
      // Network-level failure (fetch threw, e.g. lost connectivity between
      // the onLine check above and the POST, or a transient DNS/TLS error)
      // OR a non-2xx server response. Fall back to the outbox so the user's
      // message isn't lost. Drop the in-flight progress bubble and mark the
      // user bubble queued so it gets the badge.
      const errMsg = err instanceof Error ? err.message : String(err);
      turnOk = false;
      const isNetworkError = err instanceof TypeError; // `fetch` throws TypeError on network failure
      if (isNetworkError) {
        try {
          await enqueueMessage(conversationId, text, attachmentIds.length > 0 ? attachmentIds : undefined);
          messages = messages
            .filter((m) => m.id !== progressId)
            .map((m) => (m.id === userMsgId ? { ...m, queued: true } : m));
          pendingTtft.delete(progressId);
        } catch (enqErr) {
          console.warn('[ChatArea] fallback enqueue failed:', enqErr);
          messages = messages.map((m) =>
            m.id === progressId ? { ...m, isProgress: false, content: `Error: ${errMsg}` } : m,
          );
        }
      } else {
        messages = messages.map((m) =>
          m.id === progressId ? { ...m, isProgress: false, content: `Error: ${errMsg}` } : m,
        );
      }
    }

    loading = false;
    currentJobId = null;
    heartbeat = null;
    pendingPlan = null;
    pendingConfirm = null;
    pendingClarify = null;
    pendingApproval = null;
    // Backstop: a stream that ends without done/error (cancel, hang-up, network
    // fallback) must not leave the meter stuck on "live". No-op once settled.
    meterSettle();
    scrollToBottom();
    void drainQueuedSends();
  }

  /** Send the next follow-up typed while the last reply was streaming. */
  async function drainQueuedSends() {
    if (loading || !conversationId) return;
    const next = takeQueued(conversationId);
    if (next === null) return;
    await send(next);
  }

  function dropQueuedSend(index: number) {
    if (!conversationId) return;
    dropQueued(conversationId, index);
  }

  // A queue restored from the last visit goes out as soon as this pane is idle —
  // the same rule it followed before the reload. Tracked read is `loading` alone;
  // the drain is untracked because `send` writes `loading` and reads the queue,
  // and an effect that tracked either would re-enter itself.
  $effect(() => {
    const busy = loading;
    untrack(() => {
      if (!busy) void drainQueuedSends();
    });
  });

  function phaseHumanLabel(phase: string): string {
    switch (phase) {
      // Client-only phase, set the instant the user hits send so the thread
      // says something before the first server frame arrives. No server phase
      // is ever 'received'.
      case 'received': return 'Received — working…';
      // Keep in sync with $lib/workflows/chat/job-store.ts phaseLabel() —
      // the server-side label is also "Connecting…" for the default
      // 'starting' phase so we match here for any client-only renders.
      case 'starting': return 'Connecting…';
      case 'thinking': return 'Thinking';
      case 'tool_running': return 'Running tool';
      case 'waiting_llm': return 'Drafting reply';
      case 'finalising': return 'Finalising';
      case 'subagent': return 'Sub-agent';
      default: return 'Working';
    }
  }

  /**
   * Every SSE frame calls this — token deltas, tool cards, status lines. It
   * only moves the view while `stickToBottom` holds, so scrolling up through
   * the history during a turn is no longer fought by the stream.
   *
   * `force` re-arms the follow and is for things the *user* just did: sending a
   * message, firing a slash command, opening a thread.
   *
   * Behaviour defaults to instant, not smooth: a smooth scroll fires scroll
   * events at every intermediate position, and those read as "the user scrolled
   * up" and would unstick the follow mid-animation.
   */
  function scrollToBottom(behavior: ScrollBehavior = 'auto', force = false) {
    if (force) stickToBottom = true;
    else if (!stickToBottom) return;
    requestAnimationFrame(() => {
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (paletteOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        paletteIndex = (paletteIndex + 1) % paletteMatches.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        paletteIndex = (paletteIndex - 1 + paletteMatches.length) % paletteMatches.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const cmd = paletteMatches[paletteIndex];
        if (cmd) selectPaletteCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        paletteDismissed = true;
        return;
      }
    }
    // The entity picker takes keys first — it only opens after "@entity ", so it
    // can never be live at the same time as the token picker.
    if (entityPickerOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        entityIndex = (entityIndex + 1) % entityMatches.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        entityIndex = (entityIndex - 1 + entityMatches.length) % entityMatches.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectEntity(entityMatches[entityIndex] ?? entityMatches[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        entityDismissed = true;
        return;
      }
    }
    if (mentionOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionIndex = (mentionIndex + 1) % mentionMatches.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionIndex = (mentionIndex - 1 + mentionMatches.length) % mentionMatches.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const opt = mentionMatches[mentionIndex];
        if (opt) selectMention(opt);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        mentionDismissed = true;
        return;
      }
    }
    // History recall. Reached only once every typeahead above has declined the
    // arrows. Up starts cycling from the caret at the very start of the box
    // (always true when it's empty) so ordinary multi-line editing keeps its
    // arrows; Down only answers at the very end, and only mid-cycle.
    if (e.key === 'ArrowUp' && (historyOffset > 0 || atComposerStart())) {
      const hist = composerHistory;
      if (hist.length === 0) return;
      e.preventDefault();
      if (historyOffset === 0) historyDraft = input;
      if (historyOffset >= hist.length) return; // already at the oldest — hold
      historyOffset += 1;
      recallHistory(hist[hist.length - historyOffset]);
      return;
    }
    if (e.key === 'ArrowDown' && historyOffset > 0 && atComposerEnd()) {
      e.preventDefault();
      historyOffset -= 1;
      const hist = composerHistory;
      // Stepping past the newest restores whatever was being typed before.
      recallHistory(historyOffset === 0 ? historyDraft : hist[hist.length - historyOffset]);
      return;
    }
    if (e.key === 'Escape' && historyOffset > 0) {
      e.preventDefault();
      recallHistory(historyDraft);
      resetHistoryCycle();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function atComposerStart(): boolean {
    return textareaEl != null && textareaEl.selectionStart === 0 && textareaEl.selectionEnd === 0;
  }

  function atComposerEnd(): boolean {
    if (!textareaEl) return false;
    const end = textareaEl.value.length;
    return textareaEl.selectionStart === end && textareaEl.selectionEnd === end;
  }
</script>

{#snippet heartbeatLine()}
  {#if showHeartbeatLine && heartbeat && hbDerived}
    <div
      class="heartbeat-line"
      role="status"
      aria-live="polite"
      data-phase={heartbeat.phase}
      data-stall={hbDerived.state === 'stuck' ? 'stuck' : 'calm'}
    >
      <span class="hb-dot"></span>
      <span class="hb-phase">{phaseHumanLabel(heartbeat.phase)}</span>
      {#if heartbeat.summary && heartbeat.summary !== phaseHumanLabel(heartbeat.phase) + '…'}
        <span class="hb-summary">{heartbeat.summary}</span>
      {/if}
      <!-- Calm by default: the pulsing dot + phase label are enough signal that
           work is happening. The transient/infra states (jitter "checking",
           "provider slow", "server slow", a live second-counter) were anxiety-
           inducing plumbing the user can't act on, so they're gone. The one
           genuinely actionable escalation — a real stall — still surfaces, with
           a Cancel. -->
      {#if hbDerived.state === 'stuck'}
        <span class="hb-countdown stuck">· taking longer than usual</span>
        <button type="button" class="hb-cancel" onclick={cancelJob}>Cancel</button>
      {/if}
    </div>
  {/if}
{/snippet}

<div class="chat-col">
  <!-- Thread header: title, then the thread's own ledger line. -->
  <div class="thread-hdr">
    <div class="th-left">
      <div class="th-title">
        {#if onToggleThreadRail}
          <button type="button" class="th-rail-btn" onclick={onToggleThreadRail} aria-label="Threads">≡</button>
        {/if}
        <span class="th-mark" aria-hidden="true">&gt;</span>{conversationId ? threadTitle : 'no thread'}
      </div>
      {#if conversationId}
        <div class="th-meta">
          <span>{shortModelLabel(currentModel.modelId)}</span>
          <span class="th-sep" aria-hidden="true">/</span>
          <span>{threadTurns} {threadTurns === 1 ? 'turn' : 'turns'}</span>
          {#if threadTokens > 0}
            <span class="th-sep" aria-hidden="true">/</span>
            <span>{threadTokens >= 1000 ? `${(threadTokens / 1000).toFixed(1)}K` : threadTokens} tok</span>
          {/if}
          <span class="th-sep" aria-hidden="true">/</span>
          <span class="th-cost">{formatGbp(threadCostUsd)}</span>
        </div>
      {/if}
    </div>
    <div class="th-actions">
      {#if conversationId}
        {#if heartbeatEntries.length > 0}
          <!-- One marker for the session, latest beat showing. -->
          <HeartbeatMarker entries={heartbeatEntries} variant="header" />
        {/if}
        {#if onToggleGraphRail}
          <button
            type="button"
            class="th-chip th-graph-btn"
            class:on={graphRailOpen}
            onclick={onToggleGraphRail}
            title="Knowledge graph for this thread"
          >
            ◆ graph
          </button>
        {/if}
        <a class="th-chip" href="/jkai/canvas" title="Open the workflow canvas">→ canvas</a>
      {/if}
    </div>
  </div>


  <!-- Messages -->
  <div bind:this={chatContainer} class="msg-list" onscroll={onListScroll} use:stickyBottom>
    {#if !conversationId}
      <div class="flex items-center justify-center h-full">
        <p class="text-sm" style="color: var(--text-ghost);">
          Start a new conversation or select one from the sidebar.
        </p>
      </div>
    {:else if messages.length === 0}
      <div class="flex items-center justify-center h-full px-4">
        <div class="hero">
          <h1 class="hero-title">What can I help with?</h1>
          <p class="hero-sub">
            Control your smart home, check health data, manage blog posts, start builds, or create workflows — just ask.
          </p>
          <div class="hero-chips">
            {#each EXAMPLE_PROMPTS as p (p.label)}
              <button type="button" class="hero-chip" onclick={() => usePrompt(p.text)}>
                <span class="hero-chip-icon" aria-hidden="true">
                  {#if p.icon === 'home'}
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 9 10 3l7 6" /><path d="M5 8.5V16h10V8.5" /><path d="M8.5 16v-4h3v4" /></svg>
                  {:else if p.icon === 'health'}
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 16.5S3 12 3 7.5A3.5 3.5 0 0 1 10 6a3.5 3.5 0 0 1 7 1.5C17 12 10 16.5 10 16.5z" /><path d="M3.5 10h3l1.5-3 2 5 1.5-2h5" /></svg>
                  {:else if p.icon === 'bolt'}
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2 4 11h5l-1 7 7-9h-5z" /></svg>
                  {:else}
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2.5 11.5 8 17 9.5 11.5 11 10 16.5 8.5 11 3 9.5 8.5 8z" /></svg>
                  {/if}
                </span>
                {p.label}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <div class="msg-stack">
        {#each messages as msg, msgIndex (msg.id)}
          {#if isHeartbeatCheckIn(msg)}
            <!-- Synthetic heartbeat check-in poke — not shown in the thread. -->
          {:else if isTaskProgress(msg)}
            <!-- Task-watch progress: a slim status line in the flow. Repeated
                 nudges still collapse into the header marker below; this is the
                 one heartbeat output that has something new to say. -->
            <div class="flex justify-start mb-3">
              <div class="hb-progress-msg">{msg.content}</div>
            </div>
          {:else if heartbeatInfo(msg)}
            <!-- Nudges draw nothing in the thread — the session's single marker
                 in the thread header carries all of them (John, 2026-07-27). -->
          {:else if msg.isProgress}
            <!-- Live delegate_task workers — self-hides when there are none, and
                 renders above both the tool-progress box and the typing state. -->
            <WorkerTray agents={Object.values(subAgents)} onToggleStep={toggleSubAgentStep} />
            {#if msg.toolSteps && msg.toolSteps.length > 0}
              <!-- Tool progress box — only shown when tools are actually being used -->
              {@const split = splitToolSteps(msg.toolSteps)}
              <div class="progress-bubble mb-3">
                {#if pendingPlan}
                  <PlanCard
                    planId={pendingPlan.planId}
                    plan={pendingPlan.plan}
                    jobId={currentJobId ?? ''}
                    onresolve={() => { pendingPlan = null; }}
                  />
                {/if}
                {#if pendingConfirm}
                  <ConfirmBanner
                    confirmId={pendingConfirm.confirmId}
                    prompt={pendingConfirm.prompt}
                    destructive={pendingConfirm.destructive}
                    details={pendingConfirm.details}
                    jobId={currentJobId ?? ''}
                    onresolve={() => { pendingConfirm = null; }}
                  />
                {/if}
                {#if pendingSecret}
                  <SecretRequestModal
                    request={pendingSecret}
                    onDone={(r) => ackSecretRequest(r)}
                  />
                {/if}
                {#if pendingClarify}
                  <ClarifyCard
                    clarifyId={pendingClarify.clarifyId}
                    questions={pendingClarify.questions}
                    jobId={currentJobId ?? ''}
                    onresolve={() => { pendingClarify = null; }}
                  />
                {/if}
                {#if pendingApproval}
                  <div class="approval-card">
                    <div class="approval-head">
                      <span aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3 18 16.5H2z" /><path d="M10 8v3.5" /><circle cx="10" cy="14" r="0.4" fill="currentColor" stroke="none" /></svg>
                      </span>
                      <span>Dangerous command requires approval</span>
                    </div>
                    <pre class="approval-cmd">{pendingApproval.command}</pre>
                    {#if pendingApproval.description}
                      <div class="approval-reason">{pendingApproval.description}</div>
                    {/if}
                    <SlashCommandButtonBar
                      affordance={approvalAffordance}
                      autoSelect={approvalUi}
                      isLatest={true}
                      onSilentSend={(cmd) => { pendingApproval = null; void silentSend(cmd); }}
                    />
                  </div>
                {/if}
                <!-- No heartbeat phase line here: "Thinking" / "Drafting reply"
                     said nothing the toolchain bar below does not already say,
                     and it was the second of four stacked status rows. It still
                     renders in the no-tools branch, where it is all there is. -->
                {#if connectionWarning}
                  <div class="conn-warning" role="status" aria-live="polite">
                    <span class="hb-dot warn"></span>
                    <span>{connectionWarning}</span>
                  </div>
                {/if}
                {#if split.notes.length > 0}
                  <!-- Status updates render inline as plain prose. Deliberately
                       OUTSIDE the toolchain bar: this is the model talking to the
                       user mid-task, not a tool call, and collapsing it would
                       hide the one thing on the bubble written to be read. -->
                  <ul class="step-cards">
                    {#each split.notes as note (note.index)}
                      <li class="step-status-update-wrap">
                        <div class="status-update-inline">
                          <div class="sr-label-tight status-update-label">Status update</div>
                          {(note.step.result as { message?: string })?.message ?? ''}
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if split.chain.length > 0}
                  {@const open = toolchainOpen[msg.id] === true}
                  {@const running = split.chain.filter((e) => e.step.status === 'running').length}
                  {@const failed = split.chain.filter((e) => e.step.status === 'error').length}
                  {@const current = currentChainStep(split.chain)}
                  {@const slowMs = current?.status === 'running' && current.startedAt ? hbNow - current.startedAt : 0}
                  <!-- One bar for the whole chain, collapsed by default. The
                       per-call cards are still here, one click away — they were
                       just never worth pushing the answer off screen for. -->
                  <div class="toolchain" data-state={failed > 0 ? 'error' : running > 0 ? 'running' : 'done'}>
                    <div class="tc-bar">
                      <button
                        type="button"
                        class="tc-toggle"
                        onclick={() => toggleToolchain(msg.id)}
                        aria-expanded={open ? 'true' : 'false'}
                      >
                        <span class="tc-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                        <span class="tc-status" data-status={failed > 0 ? 'error' : running > 0 ? 'running' : 'done'}>
                          {#if running > 0}
                            <span class="sc-dot"></span>
                          {:else if failed > 0}
                            ✗
                          {:else}
                            ✓
                          {/if}
                        </span>
                        <span class="tc-title">toolchain</span>
                        <span class="tc-count">{split.chain.length}</span>
                        {#if !open && current}
                          {@const cTool = resolveDisplayTool(current.tool, current.args).tool}
                          {@const cCat = categorizeTool(cTool)}
                          <span class="step-cat" data-cat={cCat}>{cCat}</span>
                          <span class="tc-latest">
                            {current.summary || friendlyToolName(cTool)}{current.status === 'running' && !current.summary ? ' …' : ''}
                          </span>
                        {/if}
                      </button>
                      {#if slowMs >= TOOL_STEP_SLOW_MS}
                        <!-- A slow call earns its clock: a 16-minute tool used to
                             show a pulsing dot and nothing else. -->
                        <span class="step-clock" data-slow="true">{formatStepElapsed(slowMs)}</span>
                      {/if}
                      <!-- Cancel lives on the bar now. It used to sit in the
                           "Working" header above, and that header is gone — so
                           without this the only way out of a running turn would
                           be to wait two minutes for the slow-step escape hatch. -->
                      <button type="button" class="step-cancel tc-cancel" onclick={cancelJob}>Cancel</button>
                    </div>
                    {#if open}
                      <ul class="step-cards">
                        {#each split.chain as entry (entry.index)}
                          {@const step = entry.step}
                          {@const dTool = resolveDisplayTool(step.tool, step.args).tool}
                          {@const stepCat = categorizeTool(dTool)}
                          <li class="step-card" data-status={step.status}>
                            <header class="step-card-hdr">
                              <span class="step-status" data-status={step.status} aria-label={step.status}>
                                {#if step.status === 'running'}
                                  <span class="sc-dot"></span>
                                {:else if step.status === 'error'}
                                  ✗
                                {:else}
                                  ✓
                                {/if}
                              </span>
                              <span class="step-cat" data-cat={stepCat}>{stepCat}</span>
                              <span class="step-summary">{step.summary || friendlyToolName(dTool)}{step.status === 'running' && !step.summary ? ' …' : ''}</span>
                              {#if step.status === 'running' && step.startedAt}
                                {@const stepMs = hbNow - step.startedAt}
                                <span class="step-clock" data-slow={stepMs >= TOOL_STEP_SLOW_MS}>
                                  {formatStepElapsed(stepMs)}
                                </span>
                                {#if stepMs >= TOOL_STEP_SLOW_MS}
                                  <button type="button" class="step-cancel" onclick={cancelJob}>Cancel</button>
                                {/if}
                              {/if}
                              {#if step.result !== undefined || Object.keys(step.args).length > 0}
                                <button
                                  type="button"
                                  class="step-toggle"
                                  onclick={() => toggleStepExpanded(entry.index)}
                                  aria-expanded={step.expanded ? 'true' : 'false'}
                                >
                                  {step.expanded ? 'hide' : 'details'}
                                </button>
                              {/if}
                            </header>
                            {#if step.children?.length}
                              <DelegateChildren children={step.children} />
                            {/if}
                            {#if step.expanded}
                              <div class="step-card-body">
                                {#if Object.keys(step.args).length > 0}
                                  <details open>
                                    <summary class="step-body-label">args</summary>
                                    <JsonBlock data={step.args} />
                                  </details>
                                {/if}
                                {#if step.result !== undefined}
                                  <details open>
                                    <summary class="step-body-label">result</summary>
                                    <JsonBlock data={step.result} />
                                  </details>
                                {/if}
                              </div>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                  </div>
                {/if}
              </div>
            {:else}
              <!-- Subtle typing indicator — no tools yet -->
              {#if pendingPlan}
                <PlanCard
                  planId={pendingPlan.planId}
                  plan={pendingPlan.plan}
                  jobId={currentJobId ?? ''}
                  onresolve={() => { pendingPlan = null; }}
                />
              {/if}
              {#if pendingConfirm}
                <ConfirmBanner
                  confirmId={pendingConfirm.confirmId}
                  prompt={pendingConfirm.prompt}
                  destructive={pendingConfirm.destructive}
                  details={pendingConfirm.details}
                  jobId={currentJobId ?? ''}
                  onresolve={() => { pendingConfirm = null; }}
                />
              {/if}
              {#if pendingClarify}
                <ClarifyCard
                  clarifyId={pendingClarify.clarifyId}
                  questions={pendingClarify.questions}
                  jobId={currentJobId ?? ''}
                  onresolve={() => { pendingClarify = null; }}
                />
              {/if}
              <div class="hb-wrap">{@render heartbeatLine()}</div>
              <!-- No Reasoning panel while in flight: the finalised bubble below
                   re-renders it from the same `thinkingByBubble` entry, so waiting
                   costs nothing and the in-flight state stays one line. -->
              <!-- Typing-dots block removed (2026-05-28): the heartbeat line
                   above and the toolchain bar cover every in-flight state
                   between them. The dots carried no information beyond "the
                   bubble is in-flight" — which the bubble's presence already
                   says — so they were noise stacked on the informative rows. -->
            {/if}
          {:else if msg.source === 'status_update'}
            <!-- Mid-task working note — stylistically distinct from a real reply.
                 Label dropped: the content is descriptive enough on its own. -->
            <div class="flex justify-start mb-3">
              <div class="status-update-msg">
                {msg.content}
              </div>
            </div>
          {:else}
            {#if msg.role === 'assistant'}
              {@const toolSteps = (msg.toolSteps ?? []).filter((s) => s.tool !== 'status_update')}
              {@const failedTools = toolSteps.filter((s) => s.status === 'error').length}
              {#each artifactsForMessage(msg) as artifact, i (i)}
                <Artifact {artifact} />
              {/each}
              {#each promoteMarkersForMessage(msg) as marker (marker.toolCallId)}
                <PromoteToolBanner messageId={msg.id} {marker} />
              {/each}
              {#if toolSteps.length === 0 && msg.traceId}
                <!-- Reloaded history. `metadata.toolSteps` is never written on
                     the Hermes branch, so there are no step cards to show — but
                     the chain itself was recorded, and the trace page has it. -->
                <a
                  class="trace-standalone"
                  href={`/jkai/trace/${msg.traceId}`}
                  target="_blank"
                  rel="noopener"
                >
                  <span class="ta-status">⛓</span>
                  <span class="ta-count">tool call chain</span>
                  <span class="trace-arrow" aria-hidden="true">↗</span>
                </a>
              {/if}
              {#if toolSteps.length > 0}
                <!-- Tool activity, inline and permanent: a collapsed disclosure
                     of what the assistant did to produce this reply. Replaces
                     the old conversation-level side drawer. -->
                <details class="tool-activity">
                  <summary class="tool-activity-summary">
                    <span class="ta-status" data-error={failedTools > 0 ? 'true' : 'false'}>
                      {failedTools > 0 ? '✗' : '✓'}
                    </span>
                    <span class="ta-count">{toolSteps.length} {toolSteps.length === 1 ? 'tool' : 'tools'}</span>
                    <span class="ta-names">{toolSteps.map((s) => friendlyToolName(resolveDisplayTool(s.tool, s.args).tool)).join(' · ')}</span>
                    {#if msg.traceId}
                      <!-- stopPropagation: an <a> inside <summary> would
                           otherwise toggle the disclosure on its way out. -->
                      <a
                        class="trace-link"
                        href={`/jkai/trace/${msg.traceId}`}
                        target="_blank"
                        rel="noopener"
                        title="Open the full call chain in a new tab"
                        onclick={(e) => e.stopPropagation()}
                      >analyse ↗</a>
                    {/if}
                    <span class="ta-chev" aria-hidden="true">▸</span>
                  </summary>
                  <ul class="step-cards ta-steps">
                    {#each toolSteps as step}
                      {@const dTool = resolveDisplayTool(step.tool, step.args).tool}
                      {@const stepCat = categorizeTool(dTool)}
                      <li class="step-card" data-status={step.status}>
                        <header class="step-card-hdr">
                          <span class="step-status" data-status={step.status} aria-label={step.status}>
                            {step.status === 'error' ? '✗' : '✓'}
                          </span>
                          <span class="step-cat" data-cat={stepCat}>{stepCat}</span>
                          <span class="step-summary">{step.summary || friendlyToolName(dTool)}</span>
                        </header>
                        {#if Object.keys(step.args).length > 0 || step.result !== undefined}
                          <div class="step-card-body">
                            {#if Object.keys(step.args).length > 0}
                              <details>
                                <summary class="step-body-label">args</summary>
                                <JsonBlock data={step.args} />
                              </details>
                            {/if}
                            {#if step.result !== undefined}
                              <details>
                                <summary class="step-body-label">result</summary>
                                <JsonBlock data={step.result} />
                              </details>
                            {/if}
                          </div>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </details>
              {/if}
              {#if thinkingByBubble.has(msg.id)}
                {@const t = thinkingByBubble.get(msg.id)!}
                <div class="reasoning-panel mb-2">
                  <button
                    type="button"
                    class="reasoning-toggle"
                    onclick={() => toggleThinking(msg.id)}
                    aria-expanded={t.expanded ? 'true' : 'false'}
                  >
                    <span class="reasoning-label">Reasoning</span>
                    {#if !t.expanded}
                      <span class="reasoning-preview">{reasoningPreview(t.text)}</span>
                    {/if}
                    <span class="reasoning-chev">{t.expanded ? '▾' : '▸'}</span>
                  </button>
                  {#if t.expanded}
                    <div class="reasoning-body">{@html renderMarkdown(t.text)}</div>
                  {/if}
                </div>
              {/if}
            {/if}
            <div class="relative msg-slot" class:user-turn={msg.role === 'user'}>
              {#if msg.source === 'followup' || msg.source === 'whatsapp'}
                <div class="src-tag-row" class:justify-end={msg.role === 'user'}>
                  {#if msg.source === 'whatsapp'}
                    <span class="src-tag src-tag-wa" title="Received via WhatsApp">
                      WhatsApp
                    </span>
                  {:else}
                    <span class="src-tag src-tag-fu" title="Proactive follow-up from jkai — sent without a prompt from you">
                      <span class="src-tag-glyph" aria-hidden="true">↩</span>
                      Follow-up
                    </span>
                  {/if}
                </div>
              {/if}
              <ChatMessage
                role={msg.role}
                content={msg.role === 'assistant' ? stripPromoteMarkers(msg.content) : msg.content}
                metadata={msg.metadata}
                thinking={msg.thinking}
                {conversationId}
                {approvalUi}
                onSilentSend={msg.role === 'assistant' ? silentSend : undefined}
                isLatest={msgIndex === lastAssistantMessageIndex}
                createdAt={msg.createdAt}
                queued={msg.queued === true}
                fileRefs={msg.role === 'assistant' ? (msg.fileRefs ?? []) : []}
                researchRefs={msg.role === 'assistant' ? (msg.researchRefs ?? []) : []}
                onOpenFileRef={openFileRef}
                onOpenResearchRef={openResearchRef}
                {entityMentions}
                erProcessing={intelRunning && msgIndex === lastAssistantMessageIndex}
              />
              {#if msg.role === 'assistant' && msg.workflowRefs && msg.workflowRefs.length > 0}
                <div class="wf-chips">
                  <span class="wf-chips-label">workflow</span>
                  {#each msg.workflowRefs as wref (wref.workflowId)}
                    <a class="wf-chip" href={wref.url} title="Open canvas /{wref.slug}">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <rect x="1.5" y="5.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
                        <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.5"/>
                        <path d="M6.5 8 H8 M8 8 V4.5 H9.5 M8 8 V11.5 H9.5" stroke="currentColor" stroke-width="1.2"/>
                      </svg>
                      <span class="wf-chip-name">{wref.name}</span>
                    </a>
                  {/each}
                </div>
              {/if}
              {#if msg.attachments && msg.attachments.length > 0}
                <MessageAttachments attachments={msg.attachments} />
              {/if}
              {#if buildIdFromMessage(msg)}
                <BuildPill buildId={buildIdFromMessage(msg)!} variant="inline" />
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Query-routing feedback: did the auto-picked model get it right first try? -->
  {#if showRoutingFeedback}
    <div class="route-fb">
      <span class="route-fb-txt">
        Routed to <span class="route-fb-model" title={routedInfo?.modelId}>{shortModelLabel(routedInfo?.modelId ?? '')}</span>
        <span class="route-fb-why">· {routedInfo?.profileLabel}</span>
      </span>
      <span class="route-fb-ask">Right first time?</span>
      <button type="button" class="route-fb-btn" aria-label="Yes, correct first time" onclick={() => voteRouting('up')}>👍</button>
      <button type="button" class="route-fb-btn" aria-label="No, needed correcting" onclick={() => voteRouting('down')}>👎</button>
    </div>
  {:else if routingVote}
    <div class="route-fb route-fb--done"><span class="route-fb-txt">Thanks — noted for model selection.</span></div>
  {/if}

  <!-- Input -->
  {#if conversationId}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="composer"
      ondragenter={(e) => { e.preventDefault(); dragOver = true; }}
      ondragover={(e) => e.preventDefault()}
      ondragleave={() => { dragOver = false; }}
      ondrop={onDrop}
    >
      {#if dragOver}
        <div class="absolute inset-0 z-10 border-2 border-dashed rounded flex items-center justify-center pointer-events-none" style="border-color: var(--accent); background: rgba(0,0,0,0.3); color: white;">
          Drop files to attach
        </div>
      {/if}
      <!-- Only while the reader has scrolled off the tail: says the view is no
           longer following, and clicking re-arms it. -->
      {#if !stickToBottom}
        <button
          type="button"
          class="jump-latest"
          onclick={() => scrollToBottom('auto', true)}
          title="Jump to the latest message and resume following"
        >
          ↓ Latest
        </button>
      {/if}
      <div class="composer-inner">
        <!-- Follow-ups typed while the reply was still streaming. Shown rather
             than dropped into the transcript as optimistic bubbles: they have not
             been sent, and each one is still cancellable. -->
        {#if queuedSends.length > 0}
          <div class="queued-strip" aria-label="Queued follow-ups">
            {#each queuedSends as q, i (i)}
              <div class="queued-row">
                <span class="queued-mark" aria-hidden="true">⏳</span>
                <span class="queued-text">{q}</span>
                <button
                  type="button"
                  class="queued-drop"
                  aria-label={`Remove queued message: ${q.slice(0, 40)}`}
                  title="Don't send this"
                  onclick={() => dropQueuedSend(i)}
                >×</button>
              </div>
            {/each}
          </div>
        {/if}
        {#if paletteOpen}
          <div class="cmd-palette" role="listbox" aria-label="Slash commands">
            {#each paletteMatches as cmd, i (cmd.command)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <button
                type="button"
                role="option"
                aria-selected={i === paletteIndex}
                class="cmd-row"
                class:active={i === paletteIndex}
                onmousedown={(e) => { e.preventDefault(); selectPaletteCommand(cmd); }}
                onmouseenter={() => (paletteIndex = i)}
              >
                <span class="cmd-name">{cmd.command}</span>
                <span class="cmd-hint">{cmd.hint}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if entityPickerOpen}
          <div class="cmd-palette" role="listbox" aria-label="Entities">
            {#each entityMatches as e, i (e.id)}
              <button
                type="button"
                role="option"
                aria-selected={i === entityIndex}
                class="cmd-row"
                class:active={i === entityIndex}
                onmousedown={(ev) => { ev.preventDefault(); selectEntity(e); }}
                onmouseenter={() => (entityIndex = i)}
              >
                <span class="cmd-name">{e.name}</span>
                <span class="cmd-hint">{e.typeName}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if mentionOpen}
          <div class="cmd-palette" role="listbox" aria-label="Mentions">
            {#each mentionMatches as opt, i (opt.token)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <button
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                class="cmd-row"
                class:active={i === mentionIndex}
                onmousedown={(e) => { e.preventDefault(); selectMention(opt); }}
                onmouseenter={() => (mentionIndex = i)}
              >
                <span class="cmd-name">{opt.token}</span>
                <span class="cmd-hint">{opt.hint}</span>
              </button>
            {/each}
          </div>
        {/if}
        {#if activeBuild?.id}
          <div class="mb-2">
            <BuildPill buildId={activeBuild.id} variant="sticky" />
          </div>
        {/if}
        <ComposerAttachmentTray items={pendingAttachments} onRemove={removeAttachment} />

        <!-- Chip row: model, prompt, workflow, attach, voice — then a live
             per-turn cost estimate pushed to the right. -->
        <div class="chip-row">
          {#if hermesEnabled && conversationId}
            <div class="model-switcher skill-switcher">
              <button
                type="button"
                class="model-btn"
                onclick={() => (skillMenuOpen = !skillMenuOpen)}
                disabled={loading}
                title="Pin a domain skill for this chat (or Auto-route)"
              >
                <span class="skill-glyph" aria-hidden="true">◈</span>
                <span class="model-name">{pinnedSkillLabel}</span>
                <svg class="model-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {#if skillMenuOpen}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="model-backdrop" onclick={() => (skillMenuOpen = false)}></div>
                <div class="model-menu" role="listbox" aria-label="Pin a skill">
                  {#each SKILL_OPTIONS as opt (opt.label)}
                    <button
                      type="button"
                      role="option"
                      aria-selected={opt.value === pinnedSkill}
                      class="model-opt"
                      class:active={opt.value === pinnedSkill}
                      onclick={() => { pinnedSkill = opt.value; skillMenuOpen = false; }}
                    >
                      <span class="model-opt-name">{opt.label}</span>
                      {#if opt.value === null}<span class="model-opt-provider">auto-route</span>{/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
            <div class="model-switcher">
              {#if messages.length === 0}
                <button
                  type="button"
                  class="model-btn"
                  onclick={() => (modelPickerOpen = true)}
                  disabled={loading}
                  title="Model for this conversation — locks after the first message"
                >
                  <span class="model-dot"></span>
                  <span class="model-name">{modelTriggerLabel}</span>
                  {#if modelIsDefault}<span class="model-tag">default</span>{/if}
                  <svg class="model-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6" /></svg>
                </button>
                {#if modelPickerOpen}
                  <OpenRouterModelPicker
                    current={currentModel}
                    defaultModelId={siteDefaultModelId}
                    altModel={altOpenRouterModel}
                    onselect={(ctx) => { modelPickedByUser = true; switchModel(ctx.provider, ctx.modelId); }}
                    onsitedefaultchange={(modelId) => (siteDefaultModelId = modelId)}
                    onclose={() => (modelPickerOpen = false)}
                  />
                {/if}
              {:else}
                <span class="model-label" title="Model — locked after the first message">
                  <span class="model-dot"></span>
                  <span class="model-name">{shortModelLabel(currentModel.modelId)}</span>
                </span>
              {/if}
            </div>
          {/if}
          <button type="button" class="composer-chip" onclick={insertSlash} title="Insert a saved prompt">
            <span class="chip-glyph" aria-hidden="true">/</span><span class="chip-word">prompt</span>
          </button>
          <button type="button" class="composer-chip" onclick={insertWorkflowMention} title="Fire a workflow">
            <span class="chip-glyph" aria-hidden="true">⌥</span><span class="chip-word">workflow</span>
          </button>
          <button
            type="button"
            class="composer-chip"
            onclick={() => fileInputEl?.click()}
            title="Attach an image or document"
          >
            <span class="chip-glyph" aria-hidden="true">+</span><span class="chip-word">file</span>
          </button>
          <VoiceRecorder onRecorded={handleVoiceBlob} disabled={modelCapabilities != null && !modelCapabilities.audio} />
          {#if estPerTurnUsd !== null}
            <span class="chip-est" title="Estimated cost of the next turn at this model and context size">
              est. {formatGbp(estPerTurnUsd)} / turn
            </span>
          {/if}
        </div>

        <div class="composer-input-row">
          <input bind:this={fileInputEl} type="file" class="hidden" multiple accept={acceptAttrForCaps()} onchange={onFilePick} />
          <textarea
            bind:this={textareaEl}
            bind:value={input}
            onkeydown={handleKeydown}
            oninput={onComposerInput}
            onpaste={onPaste}
            placeholder={loading ? 'Type a follow-up — it goes next…' : composerPlaceholder}
            class="composer-textarea"
            rows="1"
          ></textarea>
          <button
            type="button"
            onclick={openLauncher}
            class="composer-launch"
            title="JKAI launcher (⌘K)"
            aria-label="Open JKAI launcher"
          >
            ⌘K
          </button>
          <button
            type="button"
            onclick={() => send()}
            disabled={!input.trim() || pendingAttachments.some(a => a.uploading || a.incompatible)}
            class="composer-send"
            aria-label="Send"
          >
            ▸
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if toast}
    <div class="fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded text-sm z-50" style="background: var(--error); color: white;">
      {toast}
    </div>
  {/if}

  {#if refModal}
    <FileViewerModal file={refModal.file} highlight={refModal.highlight} onClose={() => (refModal = null)} />
  {/if}

  {#if researchModal}
    <ResearchSourceModal ref={researchModal} onClose={() => (researchModal = null)} />
  {/if}

  <!-- One hover card for the whole thread; it renders only when a mention is
       hovered or clicked, and positions itself against that mention. -->
  <EntityHoverCard />
</div>

<style>
  /* ── Conversation column ─────────────────────────────────────────────── */
  .chat-col {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    height: 100%;
  }

  /* Thread header — title, ledger line, actions. */
  .thread-hdr {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 11px 20px;
    border-bottom: 1px solid var(--line-hair);
  }
  .th-left {
    min-width: 0;
  }
  .th-title {
    display: flex;
    align-items: baseline;
    gap: 0.45ch;
    font-family: var(--font-brand);
    font-size: var(--fs-body);
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .th-mark {
    color: var(--accent);
    opacity: 0.7;
  }
  .th-meta {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
  }
  .th-sep {
    opacity: 0.4;
  }
  .th-cost {
    color: var(--accent);
  }
  .th-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .th-chip {
    display: inline-flex;
    align-items: center;
    padding: 5px 9px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .th-chip:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .th-graph-btn {
    background: transparent;
    cursor: pointer;
  }
  .th-graph-btn.on {
    color: var(--accent);
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  /* The graph toggle only means anything once the rail is collapsible. */
  @media (min-width: 1280px) {
    .th-graph-btn {
      display: none;
    }
  }
  /* Thread-rail raise button appears only when the rail is off-canvas. */
  .th-rail-btn {
    display: none;
    background: none;
    border: none;
    padding: 0 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-muted);
    cursor: pointer;
  }
  .th-rail-btn:hover {
    color: var(--accent);
  }
  @media (max-width: 1099px) {
    .th-rail-btn {
      display: inline;
    }
  }

  /* Message list — the only scrolling region in the column. */
  .msg-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 18px 20px;
  }
  /* Full-width grid rather than a centred 900px block: a 900px reading column
     with a gutter either side. Everything lands in the centre column — which is
     the old geometry, unchanged — but a user turn is additionally allowed to
     span the right gutter, so on a wide window it sits against the pane edge
     instead of starting near the middle of the screen. Below 900px the gutters
     collapse to zero and this behaves exactly as it did. */
  .msg-stack {
    display: grid;
    grid-template-columns: 1fr min(900px, 100%) 1fr;
    /* Message rows carry their own hairline divider now, so consecutive turns
       sit flush and read as one continuous ledger. The cards between them
       (plans, trays, reasoning panels) bring their own margins. */
    row-gap: 0;
  }
  /* :global because most children are component roots (ChatMessage's wrapper,
     WorkerTray, Artifact…) and so never carry this component's scope class. */
  .msg-stack > :global(*) {
    grid-column: 2;
    min-width: 0;
  }
  /* A turn is full-bleed: its divider and the assistant wash reach both pane
     edges, and ChatMessage's own centring padding keeps the words on the 900px
     reading column. This replaces the old right-gutter span for user turns —
     the two registers are told apart by the wash and the gutter label now, not
     by which side of the pane they hug. */
  .msg-stack > .msg-slot {
    grid-column: 1 / -1;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  /* The assistant register is the wash — that, and the accent role label in the
     gutter, is what replaces the bubble. It covers the whole slot so a reply's
     attachments and chips sit inside the same band as its words. */
  .msg-stack > .msg-slot:not(.user-turn) {
    background: rgba(196, 87, 10, 0.035);
  }
  /* Only the message row itself is full-bleed. Everything else in the slot —
     origin tags above it, workflow chips / attachments / build pills below —
     lines up with the same reading column the words sit on. */
  .msg-slot > :global(:not(.msg-row)) {
    padding-inline: max(20px, calc((100% - 900px) / 2));
  }

  /* Extraction-in-flight footer. Deliberately the quietest thing in the stack:
     it is background work the user did not ask for and cannot hurry. */
  /* The "linking entities…" footer pill this used to draw now lives on the
     reply itself — see ChatMessage's `erProcessing` border. */

  /* ── Composer ─────────────────────────────────────────────────────────── */
  /* The composer is part of the shell, not the transcript: it takes the shell
     step so the conversation column reads as ending above it. */
  .composer {
    position: relative;
    flex: none;
    border-top: 1px solid var(--line);
    background: var(--surface-shell);
    padding: 10px 20px 14px;
    padding-bottom: max(14px, env(safe-area-inset-bottom));
  }
  .composer-inner {
    position: relative;
    max-width: 900px;
    margin: 0 auto;
  }

  /* Detached-from-the-tail affordance. Floats over the bottom of the message
     list rather than inside it, so it can't trip the sticky-bottom observer. */
  .jump-latest {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 20px;
    z-index: 5;
    display: inline-flex;
    align-items: center;
    padding: 5px 9px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: var(--card-bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .jump-latest:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }

  .chip-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 7px;
    flex-wrap: wrap;
  }
  .composer-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 9px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .composer-chip:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .chip-glyph {
    color: var(--accent);
  }
  .chip-est {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    white-space: nowrap;
  }

  .composer-input-row {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .queued-strip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 6px;
  }
  .queued-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 4px 8px;
    background: var(--surface-sunken);
    border-left: 2px solid var(--accent-ink-tint-35);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .queued-mark {
    flex: none;
  }
  .queued-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .queued-drop {
    flex: none;
    background: transparent;
    border: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    color: var(--text-muted);
    padding: 0 2px;
  }
  .queued-drop:hover {
    color: var(--status-fail);
  }

  /* One hairline field on the page ground — the 2px card border read as a
     second frame inside the composer's own top rule. */
  .composer-textarea {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 11px 13px;
    border: 1px solid rgba(26, 16, 8, 0.18);
    border-radius: 0;
    background: var(--bg);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    line-height: 1.5;
    color: var(--text-primary);
    resize: none;
    /* Height is driven by the autosize effect; this is where it stops growing
       and starts scrolling — silently. The box keeps scrolling past its
       max-height, it just doesn't put a scrollbar in the middle of the
       composer to say so. */
    overflow-y: auto;
    scrollbar-width: none;
  }
  .composer-textarea::-webkit-scrollbar {
    display: none;
  }
  .composer-textarea::placeholder {
    color: var(--text-ghost);
  }
  .composer-textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  /* Wrap div for the second heartbeat-line render site — kept as a hook
   * for potential future spacing/positioning tweaks; the line itself
   * styles its own margins. */
  .hb-wrap { margin-bottom: 0.75rem; }

  /* ── Command palette — slash-command typeahead floating above the composer ── */
  .cmd-palette {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 0.5rem;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
    z-index: 20;
  }
  .cmd-row {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    padding: 0.45rem 0.7rem;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .cmd-row.active { background: var(--accent-tint-08); }
  .cmd-name { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); flex-shrink: 0; }
  .cmd-hint { font-size: var(--fs-label); color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Workflow chips — deep-link to a canvas created/updated this turn.
     Same visual family as the file/research "sources" chips. */
  .wf-chips {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 6px;
    margin-bottom: 10px;
  }
  .wf-chips-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .wf-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--accent-ink, var(--accent));
    color: var(--accent-ink, var(--accent));
    border-radius: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-decoration: none;
    max-width: 260px;
  }
  .wf-chip:hover {
    background: color-mix(in srgb, var(--accent-ink, var(--accent)) 10%, transparent);
  }
  .wf-chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Model switcher (chat header) ── */
  .model-switcher { position: relative; flex-shrink: 0; }
  .model-btn,
  .model-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    padding: 0.2rem 0.5rem;
    border-radius: var(--radius-round);
    border: 1px solid transparent;
    background: transparent;
  }
  .model-btn { cursor: pointer; border-color: var(--line-strong); }
  .model-btn:hover:not(:disabled) { color: var(--text-primary); }
  .model-btn:disabled { opacity: 0.5; cursor: default; }
  .model-dot { width: 6px; height: 6px; border-radius: var(--radius-pill); background: var(--accent); flex-shrink: 0; }
  .model-name { max-width: 16ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .model-tag {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .model-caret { opacity: 0.6; flex-shrink: 0; }
  /* Phones: bigger tap target, let the name breathe a bit less. */
  @media (max-width: 640px) {
    .model-btn, .model-label { padding: 0.35rem 0.6rem; }
    .model-name { max-width: 12ch; }
    .model-tag { display: none; }
  }

  /* ── Query-routing feedback bar ── */
  .route-fb {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    max-width: 48rem; margin: 0 auto; padding: 6px 12px;
    font-size: var(--fs-label); color: var(--text-ghost);
  }
  .route-fb-txt { color: var(--text-secondary); }
  .route-fb-model { font-family: var(--font-mono); color: var(--accent); }
  .route-fb-why { color: var(--text-ghost); }
  .route-fb-ask { margin-left: auto; }
  .route-fb-btn {
    border: 1px solid var(--line-strong); background: var(--surface-overlay);
    border-radius: var(--radius-pill); padding: 2px 9px; font-size: var(--fs-nav); line-height: 1.1; cursor: pointer;
  }
  .route-fb-btn:hover { border-color: var(--accent); }
  .route-fb--done { color: var(--success); }
  .model-backdrop { position: fixed; inset: 0; z-index: 25; }
  .model-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 0.35rem;
    min-width: 12rem;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
    z-index: 26;
  }
  .model-opt {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    width: 100%;
    text-align: left;
    padding: 0.45rem 0.7rem;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .model-opt:hover { background: var(--surface-sunken); }
  .model-opt.active { background: var(--accent-tint-08); }
  .model-opt-name { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-primary); }
  .model-opt-provider { font-size: var(--fs-label-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .skill-glyph { font-size: var(--fs-label); color: var(--accent); flex-shrink: 0; line-height: 1; }

  /* ── Dangerous-command approval card (structured `pendingApproval`) ── */
  .approval-card {
    margin-top: 8px;
    padding: 10px 12px;
    border: 1px solid var(--error);
    border-radius: var(--radius-round);
    background: var(--card-bg);
  }
  .approval-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--error);
    margin-bottom: 6px;
  }
  .approval-cmd {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: 4px;
    padding: 6px 8px;
    margin: 0 0 6px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 8rem;
    overflow: auto;
  }
  .approval-reason { font-size: var(--fs-label); color: var(--text-secondary); margin-bottom: 4px; }

  /* Empty-state hero — a centred greeting + tappable starter prompts shown on
   * a fresh conversation. The composer stays docked at the bottom; clicking a
   * chip sends its prompt and the hero gives way to the thread. */
  .hero {
    text-align: center;
    max-width: 34rem;
    animation: hero-in 0.3s ease both;
  }
  @keyframes hero-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .hero-title {
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 5vw, 2rem);
    line-height: 1.1;
    color: var(--text-primary);
    margin: 0 0 0.6rem;
  }
  .hero-sub {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--text-ghost);
    margin: 0 auto 1.5rem;
    max-width: 28rem;
  }
  .hero-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .hero-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 8px 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
    white-space: nowrap;
  }
  .hero-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .hero-chip-icon { font-size: var(--fs-nav); }

  /* Message-origin tags — replaces the cryptic "FU"/"WA" gutter pills with
   * clearly labelled, in-flow chips aligned to the message's side. */
  .src-tag-row {
    display: flex;
    padding-top: 10px;
    margin-bottom: 0;
  }
  /* Origin tags used to mirror the message's side; every turn is a left-aligned
     ledger row now, so the tag stays with the gutter. */
  .src-tag-row.justify-end { justify-content: flex-start; }
  .src-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    line-height: 1.4;
  }
  .src-tag-fu {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .src-tag-wa {
    color: var(--wa-green);
    background: color-mix(in srgb, var(--wa-green) 15%, transparent);
  }
  .src-tag-glyph { font-size: var(--fs-label-xs); line-height: 1; }

  /* Reasoning panel — Hermes thinking deltas (Phase 4 TTFT) */
  .reasoning-panel {
    margin: 4px 0;
    padding: 0;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    background: color-mix(in srgb, var(--accent) 3%, transparent);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    overflow: hidden;
  }
  .reasoning-toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    font: inherit;
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
  }
  .reasoning-toggle:hover {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .reasoning-label {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    color: var(--accent);
    font-size: var(--fs-label-xs);
  }
  .reasoning-preview {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.75;
  }
  .reasoning-chev {
    opacity: 0.55;
    font-size: var(--fs-label-xs);
  }
  /* Reasoning body — renders the model's chain-of-thought as markdown.
   * Uses `:global()` to style the marked-produced HTML, mirroring the
   * approach in ChatMarkdown.svelte but tuned dimmer/denser for secondary
   * "thinking" content rather than the primary assistant reply. */
  .reasoning-body {
    margin: 0;
    padding: 10px 12px;
    color: var(--text-muted);
    border-top: 1px solid var(--line-strong);
    max-height: 320px;
    overflow-y: auto;
    font-family: var(--font-sans, inherit);
    font-size: var(--fs-label);
    line-height: 1.5;
    word-break: break-word;
  }
  .reasoning-body :global(p) {
    margin: 0 0 0.55em;
  }
  .reasoning-body :global(p:last-child) {
    margin-bottom: 0;
  }
  .reasoning-body :global(strong) {
    font-weight: 600;
    color: var(--text-primary);
  }
  .reasoning-body :global(em) {
    font-style: italic;
  }
  .reasoning-body :global(h1),
  .reasoning-body :global(h2),
  .reasoning-body :global(h3),
  .reasoning-body :global(h4) {
    margin: 0.7em 0 0.3em;
    font-size: var(--fs-label);
    font-weight: 600;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .reasoning-body :global(h1:first-child),
  .reasoning-body :global(h2:first-child),
  .reasoning-body :global(h3:first-child),
  .reasoning-body :global(h4:first-child) {
    margin-top: 0;
  }
  .reasoning-body :global(ul),
  .reasoning-body :global(ol) {
    margin: 0.2em 0 0.55em;
    padding-left: 1.3em;
  }
  .reasoning-body :global(ul) { list-style: disc outside; }
  .reasoning-body :global(ol) { list-style: decimal outside; }
  .reasoning-body :global(ul:last-child),
  .reasoning-body :global(ol:last-child) {
    margin-bottom: 0;
  }
  .reasoning-body :global(li) {
    margin: 0.15em 0;
  }
  .reasoning-body :global(li > p) {
    margin: 0;
  }
  .reasoning-body :global(code) {
    font-family: var(--font-mono);
    font-size: max(0.9em, var(--fs-label-xs));
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    padding: 0 4px;
    border-radius: 2px;
    color: var(--text-primary);
  }
  .reasoning-body :global(pre) {
    margin: 0.5em 0;
    padding: 7px 9px;
    background: color-mix(in srgb, var(--accent) 5%, var(--bg-section));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow-x: auto;
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-primary);
  }
  .reasoning-body :global(pre code) {
    background: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .reasoning-body :global(blockquote) {
    border-left: 2px solid color-mix(in srgb, var(--accent) 40%, transparent);
    padding-left: 9px;
    margin: 0.4em 0;
    color: color-mix(in srgb, var(--text-muted) 80%, transparent);
  }
  .reasoning-body :global(hr) {
    border: none;
    border-top: 1px dashed var(--line-strong);
    margin: 0.7em 0;
  }
  .reasoning-body :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .heartbeat-line {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    background: color-mix(in srgb, var(--accent) 4%, transparent);
    border-bottom: 1px solid var(--line-strong);
  }
  .heartbeat-line .hb-dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: hb-pulse 1.4s ease-in-out infinite;
  }
  .heartbeat-line .hb-phase {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 600;
    color: var(--accent);
    font-size: var(--fs-label-xs);
  }
  .heartbeat-line .hb-summary { flex: 1; }
  .heartbeat-line[data-phase='tool_running'] .hb-dot { background: var(--status-success); }
  .heartbeat-line[data-phase='waiting_llm'] .hb-dot { background: var(--accent); }
  .heartbeat-line[data-phase='subagent'] .hb-dot { background: color-mix(in srgb, var(--accent) 60%, white); }
  .heartbeat-line .hb-countdown.stuck {
    opacity: 1;
    color: var(--status-error);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .heartbeat-line[data-stall='stuck'] {
    background: color-mix(in srgb, var(--status-error) 10%, transparent);
  }
  .heartbeat-line[data-stall='stuck'] .hb-dot {
    background: var(--status-error);
    animation: hb-pulse 0.6s ease-in-out infinite;
  }
  .heartbeat-line .hb-cancel {
    margin-left: 4px;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--status-error);
    color: white;
    border: none;
    border-radius: 2px;
    cursor: pointer;
  }
  .heartbeat-line .hb-cancel:hover {
    background: color-mix(in srgb, var(--status-error) 80%, black);
  }
  .conn-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--status-error);
    background: color-mix(in srgb, var(--status-error) 6%, transparent);
    border-bottom: 1px solid var(--line-strong);
  }
  .conn-warning .hb-dot.warn {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--status-error);
    animation: hb-pulse 1.0s ease-in-out infinite;
  }
  @keyframes hb-pulse {
    0%, 100% { opacity: 0.25; transform: scale(0.85); }
    50%      { opacity: 1;    transform: scale(1.1);  }
  }

  .step-cards {
    list-style: none;
    margin: 0;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Collapsed toolchain bar — the streaming view's single line for the whole
     chain. Same shell language as the worker tray: mono label, sunken band,
     hairline border, a pulsing accent while something is running. */
  .toolchain {
    margin: 8px 10px 2px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--surface-sunken);
  }
  .toolchain[data-state='running'] {
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line-strong));
  }
  .toolchain[data-state='error'] {
    border-color: color-mix(in srgb, var(--status-error) 55%, transparent);
  }
  .tc-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding-right: 8px;
  }
  .tc-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    padding: 6px 4px 6px 8px;
    background: transparent;
    border: 0;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
    text-align: left;
  }
  .tc-toggle:hover { color: var(--text-primary); }
  .tc-chev { color: var(--text-ghost); width: 10px; flex-shrink: 0; }
  .tc-status {
    width: 14px;
    flex-shrink: 0;
    text-align: center;
    color: var(--text-ghost);
  }
  .tc-status[data-status='running'] { color: var(--accent); }
  .tc-status[data-status='error']   { color: var(--status-error); }
  .tc-status[data-status='done']    { color: var(--status-success); }
  .tc-title {
    flex-shrink: 0;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: var(--fs-label-xs);
  }
  .tc-count {
    flex-shrink: 0;
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    padding: 1px 5px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .tc-latest {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
  }
  /* The expanded list keeps the step-card styling verbatim; it just sits inside
     the bar's shell now instead of directly on the progress bubble. */
  .toolchain .step-cards {
    padding: 6px 8px 8px;
    border-top: 1px solid var(--line-strong);
  }
  .step-card {
    padding: 6px 10px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    transition: border-color 100ms ease;
  }
  .step-card[data-status="error"] {
    border-color: color-mix(in srgb, var(--status-error) 55%, transparent);
    background: color-mix(in srgb, var(--status-error) 8%, transparent);
  }
  .step-card[data-status="running"] {
    border-color: var(--accent);
  }
  .step-card-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .step-status {
    width: 14px;
    text-align: center;
    color: var(--text-ghost);
  }
  .step-status[data-status="running"] { color: var(--accent); }
  .step-status[data-status="error"]   { color: var(--status-error); }
  .step-status[data-status="done"]    { color: var(--status-success); }
  .sc-dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: hb-pulse 1.4s ease-in-out infinite;
  }
  .step-tool {
    color: var(--text-primary);
    flex-shrink: 0;
  }
  /* One-word category chip leading each step line. Colour is identity-stable
     (category → token, never rank → hue) and drawn only from design tokens. */
  .step-cat {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    padding: 1px 5px;
    border-radius: var(--radius-sharp);
    border: 1px solid color-mix(in srgb, currentColor 45%, transparent);
    background: color-mix(in srgb, currentColor 9%, transparent);
    color: var(--text-muted);
    line-height: 1.5;
  }
  .step-cat[data-cat="WEB"],
  .step-cat[data-cat="MAIL"],
  .step-cat[data-cat="AGENT"] { color: var(--accent-ink); }
  .step-cat[data-cat="RUN"] { color: var(--accent); }
  .step-cat[data-cat="HOME"] { color: var(--status-success); }
  .step-cat[data-cat="SCHED"] { color: var(--warn); }
  .step-summary {
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-clock {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
    color: var(--text-ghost);
  }
  .step-clock[data-slow='true'] {
    color: var(--warn);
    font-weight: 600;
  }
  /* Cancel is the last thing on the toolchain bar, hard right, so the tool
     summary keeps the width it needs. */
  .tc-cancel {
    margin-left: auto;
  }
  .step-cancel {
    flex-shrink: 0;
    padding: 1px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .step-cancel:hover {
    color: var(--status-error);
    border-color: var(--status-error);
  }
  .step-toggle {
    background: transparent;
    border: 0;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    padding: 2px 4px;
  }
  .step-toggle:hover { color: var(--text-primary); }
  .step-card-body {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Sub-agent rows under a delegate_task step now live in DelegateChildren.svelte. */
  .step-body-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
    cursor: pointer;
    padding: 2px 0;
  }
  .step-status-update-wrap {
    list-style: none;
  }

  /* Inline tool-activity disclosure — the single, in-thread home for tool
   * calls (the side drawer was removed). Collapsed by default; reuses the
   * .step-card styling below for its expanded body. */
  .tool-activity {
    margin: 0 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .tool-activity-summary {
    display: flex;
    align-items: center;
    gap: 8px;
    list-style: none;
    cursor: pointer;
    padding: 3px 2px;
    border-radius: 4px;
    color: var(--text-ghost);
  }
  .tool-activity-summary::-webkit-details-marker { display: none; }
  .tool-activity-summary:hover { color: var(--text-secondary); }
  .ta-status {
    font-weight: 700;
    color: var(--status-success);
  }
  .ta-status[data-error="true"] { color: var(--status-error); }
  .ta-count {
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .ta-names {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0.7;
  }
  .ta-chev {
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .tool-activity[open] .ta-chev { transform: rotate(90deg); }
  .tool-activity[open] .ta-names { display: none; }
  .ta-steps { margin-top: 4px; }

  /* Deep-link to the full call chain (/jkai/trace/<id>). The inline disclosure
   * answers "what did it do"; the trace page answers "how did this turn run",
   * which needs a table and more width than the chat column has. */
  .trace-link {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    text-decoration: none;
    padding: 1px 5px;
    border: 1px solid color-mix(in srgb, var(--card-border) 70%, transparent);
    border-radius: var(--radius-sharp);
  }
  .trace-link:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .trace-standalone {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 6px;
    padding: 3px 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    text-decoration: none;
  }
  .trace-standalone:hover { color: var(--accent); }
  .trace-arrow { flex-shrink: 0; }

  /* Progress bubble — outer box for tool step cards */
  .progress-bubble {
    background: var(--card-bg);
    border: 1px solid var(--accent);
    overflow: hidden;
  }

  /* Inline status-update block inside the step list */
  .status-update-inline {
    padding: 6px 10px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text-primary);
    border-left: 2px solid var(--accent);
    font-size: var(--fs-label);
    line-height: 1.45;
  }
  .status-update-label {
    color: var(--accent);
    margin-bottom: 3px;
    letter-spacing: 0.14em;
  }

  /* Mid-task working note (separate message, not inside the progress box) */
  .status-update-msg {
    max-width: 85%;
    padding-left: 10px;
    padding-top: 2px;
    padding-bottom: 2px;
    color: var(--text-secondary);
    border-left: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
    font-size: var(--fs-label);
    font-style: italic;
    line-height: 1.5;
  }
  .status-update-msg .status-update-label {
    font-style: normal;
    margin-bottom: 1px;
  }

  /* Between-turn progress from a task watch. Same slim treatment as a mid-task
     status note, in the quieter ink — it is machinery reporting in, not the
     assistant speaking. */
  .hb-progress-msg {
    max-width: 85%;
    padding: 2px 0 2px 10px;
    color: var(--text-tertiary, var(--text-secondary));
    border-left: 2px solid color-mix(in srgb, var(--text-secondary) 35%, transparent);
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-label);
    line-height: 1.5;
  }

  /* Composer send + palette trigger. Send is the one solid-accent control on
     the surface, so it reads as the primary action without a shadow or a
     radius doing the work. */
  .composer-textarea {
    max-height: 160px;
  }
  .composer-send {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex: none;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    cursor: pointer;
    transition: background 0.2s ease-out;
  }
  .composer-send:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .composer-send:disabled {
    background: var(--line-strong);
    color: var(--text-ghost);
    cursor: not-allowed;
  }
  .composer-launch {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 44px;
    padding: 0 9px;
    flex: none;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    cursor: pointer;
    transition: color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .composer-launch:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }

  /* ── Phone (2a) ───────────────────────────────────────────────────────── */
  @media (max-width: 799px) {
    .thread-hdr {
      padding: 10px 16px;
    }
    .msg-list {
      padding: 12px 16px;
    }
    .th-chip {
      display: none;
    }
    /* Chips reduce to glyphs and the row scrolls rather than wrapping. */
    .chip-row {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .chip-row::-webkit-scrollbar {
      display: none;
    }
    .composer-chip {
      height: 32px;
      flex: none;
    }
    .chip-word {
      display: none;
    }
    .composer-launch {
      display: none;
    }
    .composer-textarea {
      min-height: 48px;
      /* No font-size bump needed here any more — the base rule is 16px, which
         is what keeps iOS from zooming the viewport on focus. */
    }
    .composer-send {
      width: 48px;
      height: 48px;
    }
  }

</style>
