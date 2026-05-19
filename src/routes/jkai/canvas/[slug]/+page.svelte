<script lang="ts">
  import type { CanvasNode, NodeStatus } from './+page.server';
  import { invalidateAll, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { env as publicEnv } from '$env/dynamic/public';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import InspectorBody from '$lib/canvas/InspectorBody.svelte';
  import type { Execution as InspectorExecution } from '$lib/canvas/InspectorHistory.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TimeFilter from '$lib/canvas/stats/TimeFilter.svelte';
  import SummaryNode from '$lib/canvas/stats/SummaryNode.svelte';
  import TrendsNode from '$lib/canvas/stats/TrendsNode.svelte';
  import PerNodeNode from '$lib/canvas/stats/PerNodeNode.svelte';
  import RunTimelineNode from '$lib/canvas/stats/RunTimelineNode.svelte';
  import { useCanvasStream } from '$lib/canvas/stats/useCanvasStream.svelte';
  import IntelligenceNode from '$lib/canvas/intelligence/IntelligenceNode.svelte';
  import ResearchResultNode from '$lib/canvas/intelligence/ResearchResultNode.svelte';
  import WebpageNode, { type WebpageConfig } from '$lib/canvas/nodes/WebpageNode.svelte';
  import BuilderChatNode from '$lib/canvas/nodes/BuilderChatNode.svelte';
  import BuilderPiNode from '$lib/canvas/nodes/BuilderPiNode.svelte';
  import BuildViewNode from '$lib/canvas/nodes/BuildViewNode.svelte';
  import NodePalette, { type Mode as PaletteMode } from '$lib/canvas/NodePalette.svelte';
  import InteractiveStepModal from '$lib/canvas/InteractiveStepModal.svelte';
  import { byType as byNodeType, allTypes as allNodeTypes, mapTypeToKind, type NodeTypeOption } from '$lib/canvas/adapter';
  import { compatibility, type HandleSpec } from '$lib/canvas/handles';
  import { getPanel } from '$lib/canvas/nodes/panels/registry';
  import { getDefinition } from '$lib/workflows/registry-client';
  import { summarizeNode } from '$lib/workflows/node-summary';
  import { computeUpstreamFields } from '$lib/canvas/upstream-fields';

  // Node types that always render a config panel (specialised panels), in addition
  // to anything whose NodeDefinition.basicConfig is populated.
  const SPECIALISED_PANEL_TYPES = new Set([
    'stealth-scrape', 'stealth-scrape-llm', 'site-mapper', 'interactive-step',
    'gmail-trigger', 'gmail-fetch', 'gmail-send', 'gmail-reply', 'gmail-label', 'gmail-search',
    'code-execute',
    'http-request',
    'whatsapp',
    'llm-call',
    'llm-agent',
    'conditional',
    'transform',
    'data-store',
    'delay',
    'tavily-search',
    'web-scrape',
    'email',
    'text-parser',
    'accumulator',
    'merge',
    'file-store',
    'intel-write',
    'intel-query',
    'home-assistant',
    'think',
    'error-handler',
    'validator',
    'llm-router',
    'file-write',
    'file-extract',
    'file-text-extract',
    'blog-list',
    'blog-get',
    'blog-create',
    'blog-update',
    'deep-research',
    'deep-dive',
    'whoop',
    'strava',
    'health-query',
    'quick-answer',
    'research-result',
    'file-build',
    'file-read',
    'file-list',
    'file-delete',
    'loop',
    'sub-workflow',
    'openrouter',
    'jkai',
    'builder-chat',
    'builder-pi',
    'build-view',
  ]);

  // The 'llm' inline editor in this file has been superseded by the new
  // LlmCallPanel / LlmAgentPanel. Keep it out of INLINE_CONFIG_KINDS so the
  // canvas falls through to getPanel() for these node types.

  // Kinds that have a hand-crafted inline config UI further down in this file
  // (search for `{:else if menuNode.kind === '<kind>'}` blocks). For these,
  // BasicConfigForm would duplicate the editor — defer to the inline UI.
  const INLINE_CONFIG_KINDS = new Set([
    'trigger', 'chat', 'llm', 'parse', 'input', 'output', 'intel', 'intelligence',
  ]);

  function menuShowsConfigPanel(type: string, kind?: string): boolean {
    if (SPECIALISED_PANEL_TYPES.has(type)) return true;
    if (kind && INLINE_CONFIG_KINDS.has(kind)) return false;
    const def = getDefinition(type);
    return !!(def?.basicConfig && def.basicConfig.length > 0);
  }
  let { data } = $props();

  // Synchronous duplicate-key audit of the initial page payload. Runs BEFORE
  // any keyed {#each} renders, so it lands in console even if a subsequent
  // render crashes on each_key_duplicate.
  if (typeof console !== 'undefined') {
    const audit = (name: string, arr: unknown[] | undefined | null, keyFn: (x: any) => unknown) => {
      if (!arr) return;
      const seen = new Map<unknown, unknown>();
      for (const item of arr) {
        const k = keyFn(item);
        if (k === undefined || k === null) {
          console.warn('[canvas-dupe] null/undef key in', name, item);
        } else if (seen.has(k)) {
          console.error('[CANVAS-DUPE]', name, 'duplicate key', k, 'prev:', seen.get(k), 'curr:', item);
        } else {
          seen.set(k, item);
        }
      }
    };
    audit('data.canvas.nodes', data.canvas?.nodes, (n: any) => n.id);
    audit('data.canvas.edges', data.canvas?.edges, (e: any) => e.id);
    audit('data.peerCanvases', data.peerCanvases, (c: any) => c.workflowId);
    if (data.canvas?.messagesByChat) {
      for (const [cid, arr] of Object.entries(data.canvas.messagesByChat)) {
        audit(`data.canvas.messagesByChat[${cid}]`, arr as any[], (m: any) => m.id);
      }
    }
  }

  const canvas = $derived(data.canvas);
  const NEW_PALETTE = publicEnv.PUBLIC_CANVAS_NEW_PALETTE !== 'false';

  // Live mutation feed: when an external builder (workflow_build_from_spec
  // or per-tool workflow_add_node / workflow_add_edge / etc) mutates this
  // workflow, an SSE event fires on /api/workflows/<id>/live. We patch the
  // local canvas state in-place per event so each node/edge appears the
  // instant its tool call completes — invalidateAll() is too heavy here
  // (it re-runs the canvas load + listCanvases + model catalogue) and a
  // debounced refetch made the user wait until the whole build was done
  // before anything rendered.
  //
  // For event kinds we can't patch (build_started, build_complete,
  // workflow_created) we still invalidateAll on a trailing edge.
  $effect(() => {
    if (!canvas?.id) return;
    const es = new EventSource(`/api/workflows/${canvas.id}/live`);
    let pendingInvalidate: ReturnType<typeof setTimeout> | null = null;
    const scheduleInvalidate = () => {
      if (pendingInvalidate) clearTimeout(pendingInvalidate);
      pendingInvalidate = setTimeout(() => {
        pendingInvalidate = null;
        void invalidateAll();
      }, 200);
    };
    es.onmessage = (evt) => {
      let e: {
        kind?: string;
        nodeId?: string;
        edgeId?: string;
        node?: { id: string; type: string; label: string; config: unknown; position: unknown };
        edge?: {
          id: string;
          sourceNodeId: string;
          targetNodeId: string;
          sourceHandle: string | null;
          targetHandle: string | null;
        };
      } = {};
      try { e = JSON.parse(evt.data); } catch { return; }
      if ((e.kind === 'node_added' || e.kind === 'node_updated') && e.node) {
        const pos = (e.node.position as { x?: number; y?: number }) || {};
        const incoming: CanvasNode = {
          id: e.node.id,
          kind: mapTypeToKind(e.node.type),
          name: e.node.label,
          x: typeof pos.x === 'number' ? pos.x : 0,
          y: typeof pos.y === 'number' ? pos.y : 0,
          type: e.node.type,
          config: (e.node.config as Record<string, unknown>) || {},
        };
        const list = data.canvas.nodes;
        const idx = list.findIndex((n) => n.id === incoming.id);
        if (idx >= 0) {
          // Preserve runtime fields (status / inputData / outputData) the
          // server-side load attaches but external mutations don't carry.
          const prev = list[idx];
          data.canvas.nodes = [
            ...list.slice(0, idx),
            { ...prev, ...incoming },
            ...list.slice(idx + 1),
          ];
        } else {
          data.canvas.nodes = [...list, incoming];
        }
        return;
      }
      if (e.kind === 'node_removed' && e.nodeId) {
        data.canvas.nodes = data.canvas.nodes.filter((n) => n.id !== e.nodeId);
        data.canvas.edges = data.canvas.edges.filter(
          (edge) => edge.from !== e.nodeId && edge.to !== e.nodeId,
        );
        return;
      }
      if (e.kind === 'edge_added' && e.edge) {
        const edgeView = { id: e.edge.id, from: e.edge.sourceNodeId, to: e.edge.targetNodeId };
        const existingIdx = data.canvas.edges.findIndex((x) => x.id === edgeView.id);
        if (existingIdx >= 0) {
          data.canvas.edges = [
            ...data.canvas.edges.slice(0, existingIdx),
            { ...data.canvas.edges[existingIdx], ...edgeView },
            ...data.canvas.edges.slice(existingIdx + 1),
          ];
        } else {
          data.canvas.edges = [...data.canvas.edges, edgeView];
        }
        return;
      }
      if (e.kind === 'edge_removed' && e.edgeId) {
        data.canvas.edges = data.canvas.edges.filter((edge) => edge.id !== e.edgeId);
        return;
      }
      // build_started / build_complete / workflow_created / anything new
      // we don't recognise — fall back to the heavyweight refetch.
      scheduleInvalidate();
    };
    es.onerror = () => {
      // EventSource auto-reconnects after a brief backoff; no action needed.
    };
    return () => {
      if (pendingInvalidate) clearTimeout(pendingInvalidate);
      es.close();
    };
  });

  const NODE_W = 148;
  const NODE_H = 52;
  const COL = [320, 540, 760, 980];
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const CHAT_NODE_W = 300;
  const CHAT_NODE_H = 360;

  // Live run state — overlays the server-provided canvas snapshot.
  // $state.raw (not $state): we always replace these with whole new objects
  // in flushLive (`liveStatus = {...liveStatus, ...patch}`), never mutate
  // individual keys. Deep-proxying via $state creates a per-property source
  // for every node and fires per-key reactivity on every spread — which on
  // a 12-node canvas at 20 flushes/sec was grinding the main thread.
  // $state.raw tracks the container reference only.
  let liveStatus = $state.raw<Record<string, NodeStatus>>({});
  let liveData = $state.raw<
    Record<string, {
      inputData?: unknown;
      outputData?: unknown;
      error?: string | null;
      rowCount?: number;
      durationMs?: number;
    }>
  >({});
  // Inspector node history — keyed by inspector node id.
  let inspectorHistories = $state.raw<Record<string, InspectorExecution[]>>({});
  let inspectorSelected = $state.raw<Record<string, string | null>>({});

  async function loadInspectorHistory(inspectorNodeId: string, upstreamNodeId: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/canvas/${encodeURIComponent(canvas.slug)}/nodes/${encodeURIComponent(upstreamNodeId)}/recent-executions?limit=20`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as { executions: InspectorExecution[] };
      inspectorHistories = { ...inspectorHistories, [inspectorNodeId]: body.executions };
      if (!inspectorSelected[inspectorNodeId]) {
        inspectorSelected = { ...inspectorSelected, [inspectorNodeId]: body.executions[0]?.id ?? null };
      }
    } catch {
      /* network blip — try again next event */
    }
  }

  function upstreamNodeIdFor(inspectorId: string): string | null {
    for (const e of canvas.edges) {
      if (e.to === inspectorId) return e.from;
    }
    return null;
  }

  // Per-node start times (Date.now() when node_started fired) feed the
  // running-pill ticker. nowTick advances every 250ms while at least one
  // node is running so the "Running 1.2s" label increments live.
  let nodeStartedAt = $state.raw<Record<string, number>>({});
  let nowTick = $state(Date.now());
  let activeRunId = $state<string | null>(null);
  let runMeta = $state<{ state: 'idle' | 'running' | 'completed' | 'failed'; error?: string }>({
    state: 'idle',
  });
  let runStartedAt = $state<number | null>(null);
  type RunSummary = {
    state: 'completed' | 'completed_with_errors' | 'failed';
    error?: string;
    durationMs: number;
    nodeCounts: {
      completed: number;
      failed: number;
      running: number;
      skipped: number;
      ranTotal: number;
    };
    nodeList: Array<{ id: string; name: string; type: string; status: NodeStatus; error: string | null; outputPreview: string | null }>;
    failedNodes: Array<{ id: string; name: string; error: string | null }>;
    toolCount: number;
    tools: Array<{ tool: string; status: string }>;
    reply: string | null;
    runId: string | null;
    plain: { overall: string; perNode: Record<string, string> } | null;
    plainState: 'idle' | 'loading' | 'ready' | 'failed';
  };
  let runSummary = $state<RunSummary | null>(null);
  // Inert canvas decorations that should never count toward run totals.
  const INERT_NODE_KINDS = new Set(['postit', 'annotation']);
  // Per-chat-node composer draft, scroll refs, size overrides, active-run target
  let chatDrafts = $state<Record<string, string>>({});
  let chatBodyEls: Record<string, HTMLDivElement | undefined> = {};
  // Live-streaming assistant reply per chat node (cleared when stream settles)
  let streamingReplies = $state<Record<string, string>>({});
  // Per-chat-node: currently receiving an LLM stream from the orchestrator?
  // Distinct from `runMeta.state` — chat is decoupled from workflow runs.
  let streamingFor = $state<Record<string, boolean>>({});
  // Per-chat-node: orchestrator job id of the in-flight chat (so the
  // user-facing stop button can DELETE the right job).
  let chatJobs = $state<Record<string, string | null>>({});
  // Active chat EventSource per chat node (so we can close it on cancel /
  // navigation without leaking).
  const chatEventSources = new Map<string, EventSource>();
  let liveToolSteps = $state<Record<string, Array<{ tool: string; toolCallId: string; status: string }>>>(
    {},
  );
  // Per-chat-node: is the live "thinking / tool trace" panel expanded?
  // Default to expanded when a run starts so the user immediately sees
  // activity; the user can click the pill to collapse.
  let chatTraceExpanded = $state<Record<string, boolean>>({});
  function toggleChatTrace(chatNodeId: string) {
    chatTraceExpanded = {
      ...chatTraceExpanded,
      [chatNodeId]: !(chatTraceExpanded[chatNodeId] ?? true),
    };
  }
  let chatSizes = $state<Record<string, { w: number; h: number }>>({});
  let chatResize = $state<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startW: number;
    startH: number;
    pointerId: number;
  } | null>(null);
  let pendingRun = $state<{ runId: string; chatNodeId: string | null } | null>(null);

  // Intelligence node state maps
  let researchStatus = $state<Record<string, 'pending' | 'running' | 'complete' | 'failed'>>({});
  let researchReport = $state<Record<string, string>>({});
  let researchSources = $state<Record<string, Array<{ url: string; title: string; domain: string }>>>({});
  let pendingExplorations = $state<
    Record<string, { engine: 'deep' | 'quick'; sessionId: string; status: string; streamUrl: string }>
  >(data.pendingExplorations ?? {});

  // ——— Awaiting-human interaction state ———
  type InteractionRow = {
    id: number;
    runId: string;
    nodeId: string;
    mode: 'vnc' | 'confirm' | 'both';
    prompt: string;
    configSnapshot: { url?: string; fields?: Array<{ name: string; type: string; label: string; defaultValue?: string }> };
    vncSessionId: string | null;
    wsPort: number | null;
    vncUrl: string | null;
    resolvedAt: string | null;
    cancelled: boolean;
  };

  let interactions = $state<InteractionRow[]>([]);
  let activeInteraction = $state<InteractionRow | null>(null);

  /** Pending (unresolved, not cancelled) interaction rows keyed by nodeId. */
  const pendingInteractions = $derived<Record<string, InteractionRow>>(
    Object.fromEntries(
      interactions
        .filter((r) => !r.resolvedAt && !r.cancelled)
        .map((r) => [r.nodeId, r]),
    ),
  );

  // Auto-open the VNC modal the first time a new pending interaction appears.
  // We track which interaction ids we've already surfaced so closing the
  // modal doesn't immediately re-open it. Primary UX path — the awaiting
  // badge above the node is a backup for when the user has dismissed the
  // modal and wants to re-open it.
  let autoOpenedInteractionIds = new Set<number>();
  $effect(() => {
    for (const row of Object.values(pendingInteractions)) {
      if (autoOpenedInteractionIds.has(row.id)) continue;
      autoOpenedInteractionIds.add(row.id);
      // Only auto-open if nothing else is already open — never hijack the
      // user mid-interaction with another modal.
      if (!activeInteraction) activeInteraction = row;
    }
  });

  // 250ms ticker that advances `nowTick` while at least one node is
  // running, so the "Running 1.2s" pill counts up live. The interval id is
  // a local `const` (NOT $state) — per the codebase's Svelte 5 rule, never
  // $state an internal handle that gets read inside a function called from
  // a $effect, otherwise effect_update_depth_exceeded fires.
  $effect(() => {
    const anyRunning = Object.values(liveStatus).some((s) => s === 'running');
    if (!anyRunning) return;
    const id = setInterval(() => { nowTick = Date.now(); }, 250);
    return () => clearInterval(id);
  });

  // Fetch the full enriched interactions list for a run. Called once when
  // we subscribe to a run's SSE stream (to hydrate state for runs that
  // entered awaiting_human before page load) and then on receipt of
  // interaction_pending / interaction_resolved events from the engine. No
  // background polling — the event stream drives all updates.
  async function fetchInteractions(runId: string) {
    try {
      const res = await fetch(`/api/workflows/runs/${runId}/interactions`);
      if (res.ok) interactions = await res.json();
    } catch {
      /* non-fatal */
    }
  }

  const MIN_CHAT_W = 220;
  const MIN_CHAT_H = 240;
  const MAX_CHAT_W = 720;
  const MAX_CHAT_H = 900;
  const INSPECTOR_NODE_W = 320;
  const INSPECTOR_NODE_H = 300;

  /** Size lookup for chat, inspector, and stats nodes (chatSizes is shared). */
  function resizableSize(n: CanvasNode): { w: number; h: number } {
    const override = chatSizes[n.id];
    if (override) return override;
    const cfgSize = (n.config?.size as { w?: number; h?: number } | undefined) ?? null;
    const defaults: Record<string, { w: number; h: number }> = {
      chat: { w: CHAT_NODE_W, h: CHAT_NODE_H },
      inspector: { w: INSPECTOR_NODE_W, h: INSPECTOR_NODE_H },
      stats: { w: 420, h: 360 },
      intelligence: { w: 340, h: 420 },
      webpage: { w: 720, h: 480 },
      builder: { w: 480, h: 440 },
      postit: { w: 220, h: 180 },
      annotation: { w: 360, h: 220 },
    };
    const { w: defaultW, h: defaultH } = defaults[n.kind] ?? { w: NODE_W, h: NODE_H };
    return {
      w: typeof cfgSize?.w === 'number' ? cfgSize.w : defaultW,
      h: typeof cfgSize?.h === 'number' ? cfgSize.h : defaultH,
    };
  }
  // Back-compat alias so chat code still compiles
  const chatNodeSize = resizableSize;

  function onChatResizeDown(e: PointerEvent, n: CanvasNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { w, h } = chatNodeSize(n);
    chatResize = {
      nodeId: n.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startW: w,
      startH: h,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onChatResizeMove(e: PointerEvent) {
    if (!chatResize || chatResize.pointerId !== e.pointerId) return;
    const dx = (e.clientX - chatResize.startClientX) / zoom;
    const dy = (e.clientY - chatResize.startClientY) / zoom;
    // Kind-specific resize bounds. Inert items (post-its, annotations)
    // can shrink well below the chat minimum so they can be tiny
    // decoration or a tight margin-highlight box.
    const node = byId[chatResize.nodeId];
    const kind = node?.kind;
    let minW = MIN_CHAT_W, minH = MIN_CHAT_H, maxW = MAX_CHAT_W, maxH = MAX_CHAT_H;
    if (kind === 'postit') { minW = 80; minH = 60; maxW = 900; maxH = 900; }
    else if (kind === 'annotation') { minW = 40; minH = 40; maxW = 2000; maxH = 2000; }
    const nw = Math.max(minW, Math.min(maxW, Math.round((chatResize.startW + dx) / 10) * 10));
    const nh = Math.max(minH, Math.min(maxH, Math.round((chatResize.startH + dy) / 10) * 10));
    chatSizes = { ...chatSizes, [chatResize.nodeId]: { w: nw, h: nh } };
  }
  async function onChatResizeUp(e: PointerEvent) {
    if (!chatResize || chatResize.pointerId !== e.pointerId) return;
    const nodeId = chatResize.nodeId;
    const final = chatSizes[nodeId];
    chatResize = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
    if (!final) return;
    // Persist to node.config.size so it sticks across reloads
    try {
      const node = byId[nodeId];
      if (!node) return;
      const nextConfig = { ...node.config, size: final };
      await fetch(`/api/workflows/${canvas.workflowId}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      });
      await invalidateAll();
    } catch {
      /* non-fatal, override stays */
    } finally {
      // Clear override so server state takes over
      const next = { ...chatSizes };
      delete next[nodeId];
      chatSizes = next;
    }
  }

  function messagesFor(chatNodeId: string) {
    const raw = data.canvas.messagesByChat[chatNodeId] ?? [];
    const seen = new Set<string>();
    const out: typeof raw = [];
    for (const m of raw) {
      if (seen.has(m.id)) {
        console.error('[CANVAS-DUPE-DROP] message id dropped', m.id, 'in chat', chatNodeId);
        continue;
      }
      seen.add(m.id);
      out.push(m);
    }
    return out;
  }

  function statusDotColour(s: string | null | undefined): 'red' | 'amber' | 'green' | 'blue' | null {
    if (!s || s === 'idle' || s === 'pending') return null;
    if (s === 'failed') return 'red';
    if (s === 'running') return 'blue';
    if (s === 'completed_with_errors' || s === 'partial' || s === 'warning' || s === 'awaiting_human') return 'amber';
    return 'green';
  }

  /**
   * Centre point of an edge — placed at the midpoint of the bounding box
   * defined by the two nodes' top-left corners + half-size, which is
   * stable enough for the row-count label even though the actual
   * orthogonal path bends. The label sits over the rendered path and
   * gets a small white pill behind it for legibility.
   */
  function edgeMidpoint(e: { from: string; to: string }): { x: number; y: number } {
    const a = byId[e.from];
    const b = byId[e.to];
    if (!a || !b) return { x: 0, y: 0 };
    const aw = nodeW(a);
    const ah = nodeH(a);
    const bw = nodeW(b);
    const bh = nodeH(b);
    return {
      x: (a.x + aw / 2 + b.x + bw / 2) / 2,
      y: (a.y + ah / 2 + b.y + bh / 2) / 2,
    };
  }

  function statusPillText(nodeId: string, status: string | null | undefined): string | null {
    const live = liveData[nodeId];
    if (status === 'running') {
      const startedAt = nodeStartedAt[nodeId];
      if (!startedAt) return 'Running…';
      const secs = ((nowTick - startedAt) / 1000).toFixed(1);
      return `Running ${secs}s`;
    }
    if (status === 'ok') {
      if (typeof live?.rowCount === 'number') return `Done · ${live.rowCount} rows`;
      return 'Done';
    }
    if (status === 'failed') {
      const err = live?.error || 'failed';
      return `Failed: ${String(err).split('\n')[0].slice(0, 40)}`;
    }
    if (status === 'awaiting_human') return 'Awaiting input';
    return null;
  }

  function scrollChatToBottom(chatNodeId: string) {
    const el = chatBodyEls[chatNodeId];
    if (!el) return;
    // Instant, not smooth. Called every 50ms during streaming; compounded
    // smooth-scroll animations were forcing layout on every frame and
    // contributing to main-thread pressure during a run.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  // Token stream coalescing — keep markdown re-parsing off the per-token path.
  //
  // Before: every SSE token did `streamingReplies = { ...streamingReplies, [id]: prev + delta }`
  // and called scrollChatToBottom. With a ~30 tok/s stream, ChatMarkdown re-ran
  // marked.parse on the ENTIRE accumulated reply each token (O(n²) across a
  // long reply) and the canvas went unresponsive.
  //
  // Now: token deltas accumulate in a plain Map and are flushed every ~50ms
  // into the reactive $state, so markdown is re-parsed at most ~20x/sec.
  // setTimeout (not rAF) because rAF can be throttled during input/scroll
  // jank — we'd end up with tokens queued but never rendered.
  const pendingStreamDeltas = new Map<string, string>();
  let streamFlushHandle: ReturnType<typeof setTimeout> | null = null;
  const STREAM_FLUSH_MS = 50;
  function flushStreamDeltas() {
    streamFlushHandle = null;
    if (pendingStreamDeltas.size === 0) return;
    const updates: Record<string, string> = { ...streamingReplies };
    let needsScroll: string | null = null;
    for (const [id, delta] of pendingStreamDeltas) {
      updates[id] = (updates[id] ?? '') + delta;
      if (streamingFor[id]) needsScroll = id;
    }
    pendingStreamDeltas.clear();
    streamingReplies = updates;
    if (needsScroll) scrollChatToBottom(needsScroll);
  }
  function queueStreamDelta(chatNodeId: string, delta: string) {
    pendingStreamDeltas.set(
      chatNodeId,
      (pendingStreamDeltas.get(chatNodeId) ?? '') + delta,
    );
    if (streamFlushHandle === null) {
      streamFlushHandle = setTimeout(flushStreamDeltas, STREAM_FLUSH_MS);
    }
  }

  // Merged view of each node: base canvas row + any live overlay
  type ViewNode = CanvasNode;
  // Optimistic position override during drag — cleared after PATCH+invalidate
  let nodePositions = $state<Record<string, { x: number; y: number }>>({});

  const viewNodes = $derived<ViewNode[]>(
    (() => {
      const seen = new Set<string>();
      const out: ViewNode[] = [];
      for (const n of canvas.nodes) {
        if (seen.has(n.id)) {
          console.error('[CANVAS-DUPE-DROP] node id dropped', n.id);
          continue;
        }
        seen.add(n.id);
        out.push({
          ...n,
          status: liveStatus[n.id] ?? n.status,
          inputData: liveData[n.id]?.inputData ?? n.inputData,
          outputData: liveData[n.id]?.outputData ?? n.outputData,
          error: liveData[n.id]?.error ?? n.error,
          x: nodePositions[n.id]?.x ?? n.x,
          y: nodePositions[n.id]?.y ?? n.y,
        });
      }
      return out;
    })(),
  );

  const byId: Record<string, ViewNode> = $derived(
    Object.fromEntries(viewNodes.map((n) => [n.id, n])),
  );

  /**
   * Resolve the build target for a builder-pi or build-view node.
   *
   * Resolution order:
   *   1. node.config.buildId (explicit override, set in panel)
   *   2. upstream builder-chat / builder-pi node that already owns a buildId
   *      (walked breadth-first up to a small depth — covers the common
   *      Chat → Pi → View chain plus a one-hop relay).
   *
   * Returns null when no build is attached.
   */
  function resolveBuilderBuildId(nodeId: string): string | null {
    const me = byId[nodeId];
    if (!me) return null;
    const ownBuildId = (me.config as Record<string, unknown> | undefined)?.buildId;
    if (typeof ownBuildId === 'string' && ownBuildId.trim()) return ownBuildId.trim();

    const visited = new Set<string>([nodeId]);
    const frontier: string[] = [nodeId];
    let depth = 0;
    while (frontier.length && depth < 4) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of canvas.edges) {
          if (e.to !== cur || visited.has(e.from)) continue;
          visited.add(e.from);
          const upstream = byId[e.from];
          if (!upstream) continue;
          if (upstream.type === 'builder-chat' || upstream.type === 'builder-pi') {
            const id = (upstream.config as Record<string, unknown> | undefined)?.buildId;
            if (typeof id === 'string' && id.trim()) return id.trim();
          }
          next.push(e.from);
        }
      }
      frontier.length = 0;
      frontier.push(...next);
      depth += 1;
    }
    return null;
  }

  /**
   * Walk downstream from a builder-chat node and collect any non-empty
   * `emitSchema` strings configured on connected build-view nodes. The
   * BuilderChat composer auto-injects these as a "Data emission contract"
   * section in the build prompt so the agent emits postMessage data the
   * canvas can capture.
   *
   * Walks via BFS up to a small depth so the common chain
   * Chat → Pi → View resolves; explicit Chat → View also works.
   */
  function collectDownstreamEmitSchemas(chatNodeId: string): string[] {
    const out: string[] = [];
    const visited = new Set<string>([chatNodeId]);
    const frontier: string[] = [chatNodeId];
    let depth = 0;
    while (frontier.length && depth < 4) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of canvas.edges) {
          if (e.from !== cur || visited.has(e.to)) continue;
          visited.add(e.to);
          const downstream = byId[e.to];
          if (!downstream) continue;
          if (downstream.type === 'build-view') {
            const schema = (downstream.config as Record<string, unknown> | undefined)?.emitSchema;
            if (typeof schema === 'string' && schema.trim()) out.push(schema.trim());
          }
          next.push(e.to);
        }
      }
      frontier.length = 0;
      frontier.push(...next);
      depth += 1;
    }
    return out;
  }

  /**
   * Upstream input data for a build-view node — last outputData of any
   * upstream node connected via the data input handle. Used when the node
   * is configured to forward upstream data into the iframe.
   */
  function resolveUpstreamInputData(nodeId: string): unknown {
    for (const e of canvas.edges) {
      if (e.to !== nodeId) continue;
      const upstream = byId[e.from];
      if (!upstream) continue;
      // Skip the build-session/build-preview handle pairs — only data ports.
      if (upstream.type === 'builder-chat' || upstream.type === 'builder-pi') continue;
      if (upstream.outputData !== undefined && upstream.outputData !== null) return upstream.outputData;
    }
    return undefined;
  }

  const chatNodeIds = $derived(viewNodes.filter((n) => n.kind === 'chat').map((n) => n.id));
  const firstChatId = $derived(chatNodeIds[0] ?? null);

  const period = $derived(($page.url.searchParams.get('period') ?? '30d') as string);
  async function changePeriod(next: string) {
    const url = new URL($page.url);
    url.searchParams.set('period', next);
    await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
  const hasStatsNode = $derived(viewNodes.some((n) => n.kind === 'stats'));

  // Canvas-wide observability stream (SSE). One connection per tab; the
  // stats nodes and Inspector taps below derive their own refresh signals
  // from `liveStream.lastEvent`. The legacy `refreshKey` remains as a
  // fallback bump that some old code paths still increment (e.g., on
  // workflow runs initiated from this same tab); it is now harmless extra
  // signal rather than the sole trigger.
  const liveStream = useCanvasStream(() => canvas.slug);

  // Bump signal for run-level observability views (Summary, Trends). Fires
  // when a run starts, finishes, or fails — anything that changes the
  // counters, sparkline, or trend bars.
  const runBumpKey = $derived.by(() => {
    const evt = liveStream.lastEvent;
    if (!evt) return 0;
    if (evt.type === 'run.started' || evt.type === 'run.completed' || evt.type === 'run.failed') {
      return evt.seq;
    }
    if (evt.type === 'audit.edit') return evt.seq;
    return 0;
  });

  // Bump signal for per-node observability (Per-Node table). Fires on any
  // node-level event (started/completed/failed) plus run-level events that
  // change the aggregate window.
  const perNodeBumpKey = $derived.by(() => {
    const evt = liveStream.lastEvent;
    if (!evt) return 0;
    if (
      evt.type === 'node.started' ||
      evt.type === 'node.completed' ||
      evt.type === 'node.failed' ||
      evt.type === 'run.completed' ||
      evt.type === 'run.failed'
    ) {
      return evt.seq;
    }
    return 0;
  });

  const timelineBumpKey = $derived.by(() => {
    const evt = liveStream.lastEvent;
    if (!evt) return 0;
    if (
      evt.type === 'node.started' ||
      evt.type === 'node.completed' ||
      evt.type === 'node.failed' ||
      evt.type === 'run.started' ||
      evt.type === 'run.completed' ||
      evt.type === 'run.failed'
    ) return evt.seq;
    return 0;
  });

  let refreshKey = $state(0);
  let flashNodeId = $state<string | null>(null);

  // Cross-tab live refresh for per-node data. The in-tab live tail already
  // patches viewNodes via the per-run event handler when the user triggers
  // the run from this tab. In a SECOND tab, that pipe isn't running — but
  // useCanvasStream still receives node.completed / node.failed events
  // from the observability bus. When one arrives for a node we have on
  // this canvas, fetch its latest execution and patch liveData / liveStatus
  // so Inspector taps and node status pills update without a refresh.
  $effect(() => {
    const evt = liveStream.lastEvent;
    if (!evt) return;
    if (evt.type !== 'node.completed' && evt.type !== 'node.failed') return;
    const nodeId = evt.data?.nodeId;
    if (typeof nodeId !== 'string') return;
    // Only refetch nodes that exist on this canvas — events arrive for
    // every node in the workflow, including any added since this tab loaded.
    if (!byId[nodeId]) return;
    refreshNodeExecution(nodeId);
    for (const n of viewNodes) {
      if (n.kind !== 'inspector') continue;
      if (upstreamNodeIdFor(n.id) === nodeId) {
        loadInspectorHistory(n.id, nodeId);
      }
    }
  });

  // Initial load of history for each inspector node present on the canvas.
  $effect(() => {
    for (const n of viewNodes) {
      if (n.kind !== 'inspector') continue;
      const up = upstreamNodeIdFor(n.id);
      if (!up) continue;
      if (inspectorHistories[n.id]) continue;
      loadInspectorHistory(n.id, up);
    }
  });

  async function refreshNodeExecution(nodeId: string): Promise<void> {
    try {
      const res = await fetch(
        `/api/canvas/${encodeURIComponent(canvas.slug)}/nodes/${encodeURIComponent(nodeId)}/latest-execution`,
      );
      if (!res.ok) return;
      const body = (await res.json()) as {
        execution: {
          status: string;
          inputData: unknown;
          outputData: unknown;
          error: string | null;
        } | null;
      };
      if (!body.execution) return;
      const ex = body.execution;
      // Replace the container references — see liveStatus/liveData comments
      // above for why we use whole-object writes against $state.raw.
      const nextStatus: NodeStatus | undefined =
        ex.status === 'completed' ? 'ok'
          : ex.status === 'failed' ? 'failed'
          : ex.status === 'running' ? 'running'
          : undefined;
      if (nextStatus) liveStatus = { ...liveStatus, [nodeId]: nextStatus };
      liveData = {
        ...liveData,
        [nodeId]: {
          ...(liveData[nodeId] ?? {}),
          inputData: ex.inputData,
          outputData: ex.outputData,
          error: ex.error,
        },
      };
    } catch {
      // Network blip — the next event will retry. Don't surface to the user.
    }
  }

  // Guard against orphan edges whose endpoints no longer exist
  const visibleEdges = $derived(
    (() => {
      const seen = new Set<string>();
      const out: typeof canvas.edges = [];
      for (const e of canvas.edges) {
        if (!byId[e.from] || !byId[e.to]) continue;
        if (seen.has(e.id)) {
          console.error('[CANVAS-DUPE-DROP] edge id dropped', e.id);
          continue;
        }
        seen.add(e.id);
        out.push(e);
      }
      return out;
    })(),
  );

  const activeEdgeIds = $derived(
    new Set(
      runMeta.state === 'running'
        ? visibleEdges.filter((e) => byId[e.to]?.status === 'running').map((e) => e.id)
        : [],
    ),
  );

  function nodeW(n: CanvasNode | { kind: string }) {
    if (n.kind === 'chat' || n.kind === 'inspector' || n.kind === 'stats' || n.kind === 'intelligence' || n.kind === 'webpage' || n.kind === 'builder') return resizableSize(n as CanvasNode).w;
    if (n.kind === 'trigger') return 188;
    return NODE_W;
  }
  function nodeH(n: CanvasNode | { kind: string }) {
    if (n.kind === 'chat' || n.kind === 'inspector' || n.kind === 'stats' || n.kind === 'intelligence' || n.kind === 'webpage' || n.kind === 'builder') return resizableSize(n as CanvasNode).h;
    return NODE_H;
  }

  /**
   * Orthogonal edge routing that docks to the closest side of each node.
   *
   * Axis choice:
   *  1. If the two nodes overlap horizontally (source.left < target.right
   *     && target.left < source.right) but NOT vertically, there is
   *     clear space above/below — route vertically.
   *  2. Symmetrically: vertical overlap only → route horizontally.
   *  3. Otherwise pick the dominant centre-to-centre axis.
   *
   * That avoids the old bug where a horizontal-dominant pair whose
   * source right edge was past the target left edge would loop the
   * connector back through the source body.
   */
  function orthPath(from: CanvasNode, to: CanvasNode): string {
    const fw = nodeW(from);
    const fh = nodeH(from);
    const tw = nodeW(to);
    const th = nodeH(to);
    const sCx = from.x + fw / 2;
    const sCy = from.y + fh / 2;
    const tCx = to.x + tw / 2;
    const tCy = to.y + th / 2;
    const dx = tCx - sCx;
    const dy = tCy - sCy;

    const overlapX = from.x < to.x + tw && to.x < from.x + fw;
    const overlapY = from.y < to.y + th && to.y < from.y + fh;

    let horizontal: boolean;
    if (overlapX && !overlapY) {
      horizontal = false;
    } else if (overlapY && !overlapX) {
      horizontal = true;
    } else {
      horizontal = Math.abs(dx) >= Math.abs(dy);
    }

    if (horizontal) {
      const [x1, x2] = dx >= 0 ? [from.x + fw, to.x] : [from.x, to.x + tw];
      const y1 = sCy;
      const y2 = tCy;
      const midX = (x1 + x2) / 2;
      return `M${x1} ${y1} L${midX} ${y1} L${midX} ${y2} L${x2} ${y2}`;
    }

    const [y1, y2] = dy >= 0 ? [from.y + fh, to.y] : [from.y, to.y + th];
    const x1 = sCx;
    const x2 = tCx;
    const midY = (y1 + y2) / 2;
    return `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
  }

  const KIND_COLOR: Record<string, string> = {
    trigger: '#3a8a56',
    input: 'var(--text-muted)',
    llm: 'var(--accent)',
    parse: '#c44',
    output: 'var(--text-primary)',
    intel: 'var(--accent)',
    agent: 'var(--text-primary)',
    chat: 'var(--accent)',
    inspector: '#567',
    stats: '#7a6cd4',
    intelligence: '#5dbea3',
    builder: '#d28a3a',
  };

  const peerCanvases = $derived(
    (() => {
      const seen = new Set<string>();
      const out: typeof data.peerCanvases = [];
      for (const c of data.peerCanvases) {
        if (seen.has(c.workflowId)) {
          console.warn('[canvas-dupe] peerCanvases duplicate workflowId dropped', c.workflowId);
          continue;
        }
        seen.add(c.workflowId);
        out.push(c);
      }
      return out;
    })(),
  );

  // Preset cron expressions exposed in the trigger menu
  const CRON_PRESETS = [
    { label: 'Every 5 minutes', value: '*/5 * * * *' },
    { label: 'Every 15 minutes', value: '*/15 * * * *' },
    { label: 'Every 30 minutes', value: '*/30 * * * *' },
    { label: 'Every hour', value: '0 * * * *' },
    { label: 'Every 6 hours', value: '0 */6 * * *' },
    { label: 'Every day at 08:00', value: '0 8 * * *' },
    { label: 'Weekdays at 08:00', value: '0 8 * * 1-5' },
    { label: 'Sundays at 09:00', value: '0 9 * * 0' },
  ];

  function triggerSummary(cfg: Record<string, unknown>): string {
    const kind = (cfg.kind as string) || 'manual';
    if (kind === 'cron') {
      const c = (cfg.cron as string) || '';
      const preset = CRON_PRESETS.find((p) => p.value === c);
      return preset ? preset.label.toLowerCase() : (c || 'cron');
    }
    if (kind === 'webhook') return 'webhook';
    if (kind === 'event') {
      const et = (cfg.eventType as string) || 'event';
      return `on ${et}`;
    }
    return 'manual';
  }

  const runningCount = $derived(viewNodes.filter((n) => n.status === 'running').length);
  const isRunning = $derived(runMeta.state === 'running');

  // Minimap geometry — fits all node bounds + the current visible viewport
  // into the 146×60 minimap-body, then projects nodes and the viewport frame
  // into that space so the frame tracks pan/zoom in real time.
  const MINIMAP_BODY_W = 146;
  const MINIMAP_BODY_H = 60;
  const MINIMAP_PAD = 4;
  const minimap = $derived.by(() => {
    if (viewNodes.length === 0 || viewportW === 0 || viewportH === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of viewNodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      const r = n.x + nodeW(n);
      const b = n.y + nodeH(n);
      if (r > maxX) maxX = r;
      if (b > maxY) maxY = b;
    }
    const viewLeft = -panX / zoom;
    const viewTop = -panY / zoom;
    const viewRight = (viewportW - panX) / zoom;
    const viewBottom = (viewportH - panY) / zoom;
    if (viewLeft < minX) minX = viewLeft;
    if (viewTop < minY) minY = viewTop;
    if (viewRight > maxX) maxX = viewRight;
    if (viewBottom > maxY) maxY = viewBottom;
    const worldW = Math.max(1, maxX - minX);
    const worldH = Math.max(1, maxY - minY);
    const innerW = MINIMAP_BODY_W - MINIMAP_PAD * 2;
    const innerH = MINIMAP_BODY_H - MINIMAP_PAD * 2;
    const scale = Math.min(innerW / worldW, innerH / worldH);
    const offsetX = MINIMAP_PAD + (innerW - worldW * scale) / 2;
    const offsetY = MINIMAP_PAD + (innerH - worldH * scale) / 2;
    return {
      scale,
      offsetX,
      offsetY,
      minX,
      minY,
      frame: {
        x: offsetX + (viewLeft - minX) * scale,
        y: offsetY + (viewTop - minY) * scale,
        w: Math.max(2, (viewRight - viewLeft) * scale),
        h: Math.max(2, (viewBottom - viewTop) * scale),
      },
    };
  });

  // ——— Chat lifecycle (decoupled from workflow runs) ———
  // Chat-node wiring drives which endpoint catches the user's message:
  //
  //  - **Unwired** (no edges either side): the node is acting as the canvas
  //    orchestrator panel. Send to `/api/workflows/orchestrator/chat` →
  //    Hermes `jkai-canvas` (design-first edit flow).
  //  - **Wired as trigger** (outgoing edges only): typing starts a workflow
  //    run via `/api/workflows/[id]/chat`. The chat node's executor calls
  //    Hermes, response flows downstream; we subscribe to the run SSE so
  //    `chat_stream` log events still render in the panel.
  //  - **Wired as receiver / middle** (any incoming edge): typing is
  //    disabled — the node only speaks when upstream data arrives via Run.
  function chatNodeWiring(chatNodeId: string): 'unwired' | 'trigger' | 'receiver' {
    let hasIn = false;
    let hasOut = false;
    for (const e of canvas.edges) {
      if (e.to === chatNodeId) hasIn = true;
      if (e.from === chatNodeId) hasOut = true;
      if (hasIn && hasOut) break;
    }
    if (hasIn) return 'receiver';
    if (hasOut) return 'trigger';
    return 'unwired';
  }

  async function sendMessageFrom(chatNodeId: string | null, text: string) {
    if (!text.trim() || !chatNodeId) return;
    if (streamingFor[chatNodeId]) return;
    const wiring = chatNodeWiring(chatNodeId);
    if (wiring === 'receiver') {
      // Middle / terminal chat nodes only respond to workflow data, never
      // free-text input. Bail with a hint instead of swallowing the message.
      actionError =
        'This chat node receives input from upstream nodes — it only speaks when you Run the workflow.';
      return;
    }
    streamingFor = { ...streamingFor, [chatNodeId]: true };
    streamingReplies = { ...streamingReplies, [chatNodeId]: '' };

    if (wiring === 'trigger') {
      try {
        const res = await fetch(`/api/workflows/${canvas.workflowId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, chatNodeId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const { runId } = (await res.json()) as { runId: string };
        pendingRun = { runId, chatNodeId };
        activeRunId = runId;
        runMeta = { state: 'running' };
        runStartedAt = Date.now();
        runSummary = null;
        subscribeToRun(runId);
        void invalidateAll().then(() => scrollChatToBottom(chatNodeId));
      } catch (err) {
        streamingFor = { ...streamingFor, [chatNodeId]: false };
        const next = { ...streamingReplies };
        delete next[chatNodeId];
        streamingReplies = next;
        actionError = err instanceof Error ? err.message : String(err);
      }
      return;
    }

    // wiring === 'unwired' → orchestrator (Hermes jkai-canvas design-first).
    try {
      const res = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          workflowId: canvas.workflowId,
          chatNodeId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const { jobId } = (await res.json()) as { jobId: string };
      chatJobs = { ...chatJobs, [chatNodeId]: jobId };
      subscribeToChat(jobId, chatNodeId);
      void invalidateAll().then(() => scrollChatToBottom(chatNodeId));
    } catch (err) {
      streamingFor = { ...streamingFor, [chatNodeId]: false };
      const next = { ...streamingReplies };
      delete next[chatNodeId];
      streamingReplies = next;
      actionError = err instanceof Error ? err.message : String(err);
    }
  }

  function subscribeToChat(jobId: string, chatNodeId: string) {
    const existing = chatEventSources.get(chatNodeId);
    if (existing) {
      try { existing.close(); } catch { /* no-op */ }
      chatEventSources.delete(chatNodeId);
    }
    const es = new EventSource(`/api/workflows/orchestrator/chat/stream?jobId=${jobId}`);
    chatEventSources.set(chatNodeId, es);
    es.onmessage = (evt) => {
      let data: { type?: string; delta?: string } = {};
      try { data = JSON.parse(evt.data); } catch { return; }
      if (data.type === 'token' && typeof data.delta === 'string') {
        queueStreamDelta(chatNodeId, data.delta);
      } else if (data.type === 'done' || data.type === 'error') {
        es.close();
        if (chatEventSources.get(chatNodeId) === es) chatEventSources.delete(chatNodeId);
        finalizeChatStream(chatNodeId);
      }
    };
    es.onerror = () => {
      es.close();
      if (chatEventSources.get(chatNodeId) === es) chatEventSources.delete(chatNodeId);
      finalizeChatStream(chatNodeId);
    };
  }

  function finalizeChatStream(chatNodeId: string) {
    if (streamFlushHandle !== null) {
      clearTimeout(streamFlushHandle);
      streamFlushHandle = null;
    }
    flushStreamDeltas();
    streamingFor = { ...streamingFor, [chatNodeId]: false };
    chatJobs = { ...chatJobs, [chatNodeId]: null };
    // Reload to pick up the persisted assistant message; only then drop
    // the local stream buffer so the UI doesn't flicker empty in between.
    void invalidateAll().then(() => {
      const next = { ...streamingReplies };
      delete next[chatNodeId];
      streamingReplies = next;
      scrollChatToBottom(chatNodeId);
    });
  }

  async function cancelChat(chatNodeId: string) {
    const jobId = chatJobs[chatNodeId];
    if (!jobId) {
      finalizeChatStream(chatNodeId);
      return;
    }
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`, { method: 'DELETE' });
    } catch {
      /* SSE will still terminate via error; no-op */
    }
    // The SSE 'error' event will trigger finalizeChatStream; if it doesn't
    // arrive (e.g. network drop) the EventSource onerror handler does.
  }

  function formatChatTranscript(chatNodeId: string): string {
    const msgs = messagesFor(chatNodeId);
    if (msgs.length === 0) return '';
    return msgs
      .map((m) => {
        const who =
          m.role === 'user' ? 'YOU' : m.role === 'assistant' ? 'JKAI' : m.role.toUpperCase();
        const t = new Date(m.createdAt).toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        return `${who} · ${t}\n${m.content}`;
      })
      .join('\n\n');
  }

  let chatCopiedFor = $state<string | null>(null);
  async function copyChatTranscript(chatNodeId: string) {
    const text = formatChatTranscript(chatNodeId);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      chatCopiedFor = chatNodeId;
      setTimeout(() => {
        if (chatCopiedFor === chatNodeId) chatCopiedFor = null;
      }, 1500);
    } catch (err) {
      actionError = err instanceof Error ? err.message : 'clipboard not available';
    }
  }

  async function clearChatTranscript(chatNodeId: string) {
    const msgs = messagesFor(chatNodeId);
    if (msgs.length === 0) return;
    if (!confirm(`Clear all ${msgs.length} message${msgs.length === 1 ? '' : 's'} in this chat?`))
      return;
    try {
      const res = await fetch(`/api/workflows/${canvas.workflowId}/chat/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatNodeId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    }
  }

  async function sendFromChat(chatNodeId: string) {
    const text = (chatDrafts[chatNodeId] ?? '').trim();
    if (!text) return;
    chatDrafts = { ...chatDrafts, [chatNodeId]: '' };
    await sendMessageFrom(chatNodeId, text);
  }

  async function cancelRun() {
    if (runMeta.state !== 'running') return;
    const rid = activeRunId;
    if (rid) {
      try {
        await fetch(`/api/workflows/${canvas.workflowId}/runs/${rid}/cancel`, { method: 'POST' });
      } catch (err) {
        console.error('[canvas] cancel run failed', err);
      }
    }
    runMeta = { state: 'idle' };
    pendingRun = null;
  }

  async function runCanvas() {
    // Toolbar Run — a pure workflow execution. No chat message is
    // inserted; the chat panels are untouched. If a chat node is
    // wired into the graph it still runs (getting empty input), but
    // the common case is: user detached chat to decouple, and Run
    // fires the real pipe from the trigger outward.
    if (runMeta.state === 'running') return;
    // Seed every node to 'idle' so the pill no longer falls back to
    // n.status (which is the persisted result of the LAST run, e.g. 'ok').
    // Without this seed, every node visibly shows "Done" until the engine
    // emits node_started for it.
    const idleSeed: Record<string, NodeStatus> = {};
    for (const n of canvas?.nodes ?? []) idleSeed[n.id] = 'idle';
    liveStatus = idleSeed;
    liveData = {};
    nodeStartedAt = {};
    runMeta = { state: 'running' };
    runStartedAt = Date.now();
    runSummary = null;
    pendingRun = null;
    try {
      const res = await fetch(`/api/workflows/${canvas.workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {} }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const { runId } = await res.json();
      activeRunId = runId;
      subscribeToRun(runId);
    } catch (err) {
      runMeta = { state: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Track the current SSE so we close it before opening a new one. Without
  // this, a user who sends several messages accumulates open EventSources
  // until the browser's per-origin connection cap (6 in Chrome) is hit —
  // at which point subsequent subscribes silently stall and the run appears
  // to freeze the UI.
  let activeEventSource: EventSource | null = null;
  function subscribeToRun(runId: string) {
    if (activeEventSource) {
      try { activeEventSource.close(); } catch { /* no-op */ }
      activeEventSource = null;
    }
    const es = new EventSource(`/api/workflows/${canvas.workflowId}/runs/${runId}/stream`);
    activeEventSource = es;
    // One-shot hydrate in case the run is already awaiting_human (or has
    // open interactions) before we subscribed — pending events for those
    // fired before this EventSource opened.
    fetchInteractions(runId);
    es.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data) as {
          type: string;
          nodeId?: string;
          data?: Record<string, unknown>;
          error?: string;
        };
        handleEvent(data);
      } catch {
        /* ignore parse errors */
      }
    };
    es.onerror = () => {
      es.close();
      if (activeEventSource === es) activeEventSource = null;
    };
  }

  // Per-run event batching. SSE can deliver many node transitions per tick
  // (e.g. fast downstream nodes after a slow upstream one completes, or
  // self-healing emitting a burst). Each write to liveStatus/liveData used
  // to trigger a full recompute of viewNodes/byId/visibleEdges/activeEdgeIds,
  // which for busy workflows pinned the main thread. We now accumulate into
  // plain objects and flush once per 50ms — only viewNodes etc. recompute
  // in the flush tick.
  const pendingLiveStatus = new Map<string, 'running' | 'ok' | 'failed'>();
  const pendingLiveData = new Map<string, Record<string, unknown>>();
  const pendingNodeStartedAt = new Map<string, number>();
  let liveFlushHandle: ReturnType<typeof setTimeout> | null = null;
  // 250ms is plenty for visual status — fast enough to feel live, slow
  // enough that viewNodes isn't re-derived 20x/sec.
  const LIVE_FLUSH_MS = 250;
  function flushLive() {
    liveFlushHandle = null;
    if (
      pendingLiveStatus.size === 0 &&
      pendingLiveData.size === 0 &&
      pendingNodeStartedAt.size === 0
    ) return;
    if (pendingLiveStatus.size > 0) {
      const next = { ...liveStatus };
      for (const [id, status] of pendingLiveStatus) next[id] = status;
      pendingLiveStatus.clear();
      liveStatus = next;
    }
    if (pendingLiveData.size > 0) {
      const next = { ...liveData };
      for (const [id, patch] of pendingLiveData) {
        next[id] = { ...next[id], ...patch };
      }
      pendingLiveData.clear();
      liveData = next;
    }
    if (pendingNodeStartedAt.size > 0) {
      const next = { ...nodeStartedAt };
      for (const [id, ts] of pendingNodeStartedAt) next[id] = ts;
      pendingNodeStartedAt.clear();
      nodeStartedAt = next;
    }
  }
  function scheduleLiveFlush() {
    if (liveFlushHandle === null) {
      liveFlushHandle = setTimeout(flushLive, LIVE_FLUSH_MS);
    }
  }

  function handleEvent(evt: {
    type: string;
    nodeId?: string;
    data?: Record<string, unknown>;
    error?: string;
  }) {
    if (evt.type === 'node_started' && evt.nodeId) {
      pendingLiveStatus.set(evt.nodeId, 'running');
      pendingNodeStartedAt.set(evt.nodeId, Date.now());
      if (evt.data && 'inputData' in evt.data) {
        pendingLiveData.set(evt.nodeId, {
          ...(pendingLiveData.get(evt.nodeId) ?? {}),
          inputData: evt.data.inputData,
        });
      }
      scheduleLiveFlush();
    } else if (evt.type === 'node_completed' && evt.nodeId) {
      pendingLiveStatus.set(evt.nodeId, 'ok');
      const data = (evt.data ?? {}) as Record<string, unknown>;
      const rowCount = typeof data._rowCount === 'number' ? (data._rowCount as number) : undefined;
      const durationMs = typeof data._durationMs === 'number' ? (data._durationMs as number) : undefined;
      // Strip the metadata keys from the visible output so they don't pollute
      // the rendered Output panel; we surface them via the status pill instead.
      const { _rowCount: _r, _durationMs: _d, inputData, outputData, output, ...rest } = data;
      void _r; void _d;
      const visibleOutput =
        outputData !== undefined
          ? outputData
          : output !== undefined
            ? output
            : Object.keys(rest).length > 0
              ? rest
              : undefined;
      pendingLiveData.set(evt.nodeId, {
        ...(pendingLiveData.get(evt.nodeId) ?? {}),
        inputData: (inputData ?? liveData[evt.nodeId]?.inputData) as unknown,
        outputData: visibleOutput as unknown,
        rowCount,
        durationMs,
      });
      scheduleLiveFlush();
    } else if (evt.type === 'node_failed' && evt.nodeId) {
      pendingLiveStatus.set(evt.nodeId, 'failed');
      pendingLiveData.set(evt.nodeId, {
        ...(pendingLiveData.get(evt.nodeId) ?? {}),
        error: evt.error ?? (evt.data?.error as string) ?? null,
      });
      scheduleLiveFlush();
    } else if (evt.type === 'interaction_pending' || evt.type === 'interaction_resolved') {
      // Engine emits these when createInteraction inserts a row or the
      // resolve endpoint marks one done. Refresh the full enriched list
      // (the GET endpoint joins live VNC session info — wsPort/vncUrl —
      // that isn't trivially serialisable into the SSE payload).
      const rid = activeRunId ?? canvas.latestRunId;
      if (rid) fetchInteractions(rid);
    } else if (evt.type === 'log' && evt.data) {
      const kind = evt.data.kind as string | undefined;
      const chatNodeId = (evt.data.chatNodeId as string | undefined) ?? null;
      if (kind === 'chat_stream' && chatNodeId) {
        const event = (evt.data.event as { type?: string; delta?: string }) ?? {};
        if (event.type === 'token' && typeof event.delta === 'string') {
          queueStreamDelta(chatNodeId, event.delta);
        }
      } else if (kind === 'chat_tool' && chatNodeId) {
        const step = evt.data.step as { tool?: string; toolCallId?: string; status?: string } | undefined;
        if (step && step.tool && step.toolCallId) {
          const existing = liveToolSteps[chatNodeId] ?? [];
          const idx = existing.findIndex((s) => s.toolCallId === step.toolCallId);
          const next = existing.slice();
          if (idx >= 0) {
            next[idx] = { tool: step.tool, toolCallId: step.toolCallId, status: step.status ?? 'done' };
          } else {
            next.push({ tool: step.tool, toolCallId: step.toolCallId, status: step.status ?? 'running' });
          }
          liveToolSteps = { ...liveToolSteps, [chatNodeId]: next };
        }
      }
    } else if (evt.type === 'run_completed' || evt.type === 'run_completed_with_errors') {
      if (liveFlushHandle !== null) { clearTimeout(liveFlushHandle); liveFlushHandle = null; }
      flushLive();
      runMeta = { state: 'completed' };
      captureRunSummary(evt.type === 'run_completed_with_errors' ? 'completed_with_errors' : 'completed');
      refreshKey += 1;
      finalizeChatReply();
    } else if (evt.type === 'run_failed') {
      if (liveFlushHandle !== null) { clearTimeout(liveFlushHandle); liveFlushHandle = null; }
      flushLive();
      runMeta = { state: 'failed', error: evt.error };
      captureRunSummary('failed', evt.error);
      refreshKey += 1;
      finalizeChatReply();
    }
  }

  function captureRunSummary(state: RunSummary['state'], error?: string) {
    const durationMs = runStartedAt ? Date.now() - runStartedAt : 0;
    const counts = { completed: 0, failed: 0, running: 0, skipped: 0, ranTotal: 0 };
    const failedNodes: RunSummary['failedNodes'] = [];
    const nodeList: RunSummary['nodeList'] = [];
    for (const n of viewNodes) {
      // Inert canvas decorations (post-its, annotations) never run and must
      // not pollute the totals reported in the modal.
      if (INERT_NODE_KINDS.has(n.kind)) continue;
      const status: NodeStatus = n.status ?? 'idle';
      if (status === 'ok') {
        counts.completed += 1;
        counts.ranTotal += 1;
      } else if (status === 'failed') {
        counts.failed += 1;
        counts.ranTotal += 1;
        failedNodes.push({ id: n.id, name: n.name, error: n.error ?? null });
      } else if (status === 'running') {
        counts.running += 1;
        counts.ranTotal += 1;
      } else {
        // idle / undefined / anything else → never executed in this run
        counts.skipped += 1;
      }
      let outputPreview: string | null = null;
      if (n.outputData !== null && n.outputData !== undefined) {
        try {
          const s = typeof n.outputData === 'string' ? n.outputData : JSON.stringify(n.outputData);
          outputPreview = s.length > 220 ? s.slice(0, 220) + '…' : s;
        } catch { outputPreview = '[unserialisable]'; }
      }
      nodeList.push({
        id: n.id,
        name: n.name,
        type: n.type,
        status,
        error: n.error ?? null,
        outputPreview,
      });
    }
    const tools: Array<{ tool: string; status: string }> = [];
    for (const arr of Object.values(liveToolSteps)) {
      for (const s of arr) tools.push({ tool: s.tool, status: s.status });
    }
    let reply: string | null = null;
    if (pendingRun?.chatNodeId) {
      const streamed = streamingReplies[pendingRun.chatNodeId];
      if (streamed && streamed.trim()) reply = streamed;
    }
    runSummary = {
      state,
      error,
      durationMs,
      nodeCounts: counts,
      nodeList,
      failedNodes,
      toolCount: tools.length,
      tools,
      reply,
      runId: activeRunId,
      plain: null,
      plainState: 'idle',
    };
    void requestPlainSummary();
  }

  async function requestPlainSummary() {
    const snap = runSummary;
    if (!snap) return;
    if (snap.nodeList.length === 0) {
      runSummary = { ...snap, plainState: 'ready', plain: { overall: '', perNode: {} } };
      return;
    }
    runSummary = { ...snap, plainState: 'loading' };
    try {
      const res = await fetch(`/api/canvas/${canvas.slug}/run-summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          state: snap.state,
          durationMs: snap.durationMs,
          runError: snap.error ?? null,
          nodes: snap.nodeList,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { overall?: string; perNode?: Record<string, string> };
      // Re-resolve from current state so a user dismissing the modal cancels the update.
      const cur = runSummary;
      if (!cur || cur.runId !== snap.runId) return;
      runSummary = {
        ...cur,
        plainState: 'ready',
        plain: {
          overall: data.overall ?? '',
          perNode: data.perNode ?? {},
        },
      };
    } catch (err) {
      console.error('[canvas] run-summary failed', err);
      const cur = runSummary;
      if (!cur || cur.runId !== snap.runId) return;
      runSummary = { ...cur, plainState: 'failed' };
    }
  }

  function closeRunSummary() {
    runSummary = null;
    // Belt and braces: if state propagation is frozen (e.g. prior reactivity
    // error), still yank the modal out of the DOM so the user isn't trapped.
    requestAnimationFrame(() => {
      if (typeof document === 'undefined') return;
      const el = document.getElementById('run-summary-root');
      if (el && runSummary === null) el.remove();
    });
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${m}m ${rem}s`;
  }

  async function finalizeChatReply() {
    // Flush any un-flushed token deltas so we don't lose the tail of the
    // reply between the last timer tick and the run terminal event.
    if (streamFlushHandle !== null) {
      clearTimeout(streamFlushHandle);
      streamFlushHandle = null;
    }
    flushStreamDeltas();
    const pending = pendingRun;
    pendingRun = null;
    if (pending) {
      // Fire-and-forget the /respond POST AND the page-data refresh. Awaiting
      // them used to chain onto run_completed, running the full server load
      // (loadCanvas + listCanvases + node_executions fetch) synchronously on
      // the main thread — which with the resulting re-hydration cascade was
      // what locked the canvas for ~1s per run. Let the user interact
      // immediately; the freshly-persisted assistant message and node
      // outputs land whenever the RPC returns.
      void fetch(`/api/workflows/${canvas.workflowId}/chat/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: pending.runId, chatNodeId: pending.chatNodeId }),
      }).catch(() => { /* non-fatal */ }).finally(() => {
        void invalidateAll().then(() => {
          if (pending?.chatNodeId) scrollChatToBottom(pending.chatNodeId);
        });
      });
    } else {
      // Pure Run (no chat-originated pendingRun): still need fresh
      // node_executions from the server so the canvas shows the final
      // outputs/errors — but fire-and-forget.
      void invalidateAll();
    }
    // Clear streaming state — the persisted message now owns the text.
    if (pending?.chatNodeId) {
      const next = { ...streamingReplies };
      delete next[pending.chatNodeId];
      streamingReplies = next;
      const nextTools = { ...liveToolSteps };
      delete nextTools[pending.chatNodeId];
      liveToolSteps = nextTools;
      // Free the composer up for the next message. Without this, a chat
      // that triggered a run stays in "running…" forever from the panel's
      // perspective.
      streamingFor = { ...streamingFor, [pending.chatNodeId]: false };
    }
  }

  // Phase B — pan/zoom/selection state
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  let selectedId = $state<string | null>(null);
  const zoomPct = $derived(Math.round(zoom * 100));


  let viewportEl: HTMLDivElement | undefined;
  let viewportW = $state(0);
  let viewportH = $state(0);
  let panStart = $state<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    pointerId: number;
  } | null>(null);

  function clampZoom(z: number) {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
  }

  function zoomAt(cx: number, cy: number, factor: number) {
    const newZoom = clampZoom(zoom * factor);
    if (newZoom === zoom) return;
    const worldX = (cx - panX) / zoom;
    const worldY = (cy - panY) / zoom;
    zoom = newZoom;
    panX = cx - worldX * newZoom;
    panY = cy - worldY * newZoom;
  }

  function zoomCentered(factor: number) {
    const vp = viewportEl?.getBoundingClientRect();
    if (!vp) return;
    zoomAt(vp.width / 2, vp.height / 2, factor);
  }

  function fit() {
    if (!viewportEl || canvas.nodes.length === 0) return;
    const vp = viewportEl.getBoundingClientRect();
    const pad = 48;
    const minX = Math.min(...canvas.nodes.map((n) => n.x)) - pad;
    const minY = Math.min(...canvas.nodes.map((n) => n.y)) - pad;
    const maxX = Math.max(...canvas.nodes.map((n) => n.x + nodeW(n))) + pad;
    const maxY = Math.max(...canvas.nodes.map((n) => n.y + nodeH(n))) + pad;
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availW = Math.max(200, vp.width - 24);
    const availH = Math.max(200, vp.height - 24);
    const fitZ = clampZoom(Math.min(availW / contentW, availH / contentH, 1));
    zoom = fitZ;
    panX = 12 + (availW - contentW * fitZ) / 2 - minX * fitZ;
    panY = 12 + (availH - contentH * fitZ) / 2 - minY * fitZ;
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }

  async function scrollToNode(nodeId: string) {
    const n = byId[nodeId];
    if (!n) return;
    const cx = n.x + nodeW(n) / 2;
    const cy = n.y + nodeH(n) / 2;
    panX = (typeof window !== 'undefined' ? window.innerWidth / 2 : 0) - cx * zoom;
    panY = (typeof window !== 'undefined' ? window.innerHeight / 2 : 0) - cy * zoom;
    flashNodeId = nodeId;
    setTimeout(() => {
      if (flashNodeId === nodeId) flashNodeId = null;
    }, 800);
  }

  function isInteractiveTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest(
      '.wf-node, .chat-node, .minimap, .legend, .hifi-toolbar, .nm-inline, .edge-inspector, button, a, input, textarea, select',
    );
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    selectedId = null;
    selectedEdgeId = null;
    // Intentionally do NOT clear menuForNodeId here — the inline config menu
    // only closes via its top-right Close button (or explicit Save / Delete).
    edgeInspectorFor = null;
    panStart = { x: e.clientX, y: e.clientY, panX, panY, pointerId: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!panStart || panStart.pointerId !== e.pointerId) return;
    panX = panStart.panX + (e.clientX - panStart.x);
    panY = panStart.panY + (e.clientY - panStart.y);
  }

  function onPointerUp(e: PointerEvent) {
    if (!panStart || panStart.pointerId !== e.pointerId) return;
    panStart = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }
  }

  function onWheel(e: WheelEvent) {
    // If the wheel happens inside a scrollable child (chat body, inline
    // menu, edge inspector), let the browser scroll it natively.
    const target = e.target as HTMLElement | null;
    if (
      target &&
      target.closest(
        '.chat-node-body, .chat-input, .nm-inline-body, .edge-inspector-body, .stats-node, .tab-pane, .rr-body, .intelligence-node, .research-result-node, .builder-node-body',
      )
    ) {
      return;
    }
    e.preventDefault();
    const vp = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - vp.left;
    const cy = e.clientY - vp.top;
    // Smooth exponential zoom: gentler than the old fixed 10%-per-tick,
    // and scales with trackpad pixel deltas instead of over-shooting.
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(cx, cy, factor);
  }

  function selectNode(e: Event, id: string) {
    e.stopPropagation();
    selectedId = id;
  }

  // ——— Node drag ———
  const DRAG_THRESHOLD = 3; // px
  const GRID = 20;
  let nodeDrag = $state<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  function onNodePointerDown(e: PointerEvent, n: ViewNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    nodeDrag = {
      nodeId: n.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: n.x,
      startY: n.y,
      moved: false,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onNodePointerMove(e: PointerEvent) {
    if (!nodeDrag || nodeDrag.pointerId !== e.pointerId) return;
    const dxClient = e.clientX - nodeDrag.startClientX;
    const dyClient = e.clientY - nodeDrag.startClientY;
    if (
      !nodeDrag.moved &&
      Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD
    )
      return;
    nodeDrag.moved = true;
    // Convert client delta to world delta by dividing by zoom
    const dx = dxClient / zoom;
    const dy = dyClient / zoom;
    const nx = Math.round((nodeDrag.startX + dx) / GRID) * GRID;
    const ny = Math.round((nodeDrag.startY + dy) / GRID) * GRID;
    nodePositions = { ...nodePositions, [nodeDrag.nodeId]: { x: nx, y: ny } };
  }

  async function onNodePointerUp(e: PointerEvent, n: ViewNode) {
    if (!nodeDrag || nodeDrag.pointerId !== e.pointerId) return;
    const wasMoved = nodeDrag.moved;
    const nodeId = nodeDrag.nodeId;
    const finalPos = nodePositions[nodeId];
    nodeDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* no-op */
    }

    if (wasMoved && finalPos) {
      // Persist position
      try {
        await fetch(`/api/workflows/${canvas.workflowId}/nodes/${nodeId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: finalPos }),
        });
        await invalidateAll();
      } catch {
        /* keep override so the UI doesn't snap back on network blip */
      }
      // Drop override
      const next = { ...nodePositions };
      delete next[nodeId];
      nodePositions = next;
    } else {
      // Click (no drag) → select only
      selectedId = n.id;
    }
  }

  // ——— Inline menu — editable config state ———
  let configDraft = $state<Record<string, unknown>>({});
  let labelDraft = $state('');
  let configDirty = $state(false);
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let labelInputEl = $state<HTMLInputElement | undefined>(undefined);
  let renameRequested = $state(false);

  // Session lists for the research-result picker (lazy-loaded when menu opens).
  let deepSessions = $state<Array<{ id: string; topic: string; status: string; createdAt: string }>>([]);
  let quickSessions = $state<Array<{ id: string; topic: string; status: string; createdAt: string }>>([]);
  let sessionsLoaded = $state<{ deep: boolean; quick: boolean }>({ deep: false, quick: false });
  async function loadSessionsFor(engine: 'deep' | 'quick') {
    if (engine === 'deep' && !sessionsLoaded.deep) {
      try {
        const res = await fetch('/api/deepdive');
        if (res.ok) deepSessions = await res.json();
      } catch (err) { console.error('[canvas] deep sessions list failed', err); }
      sessionsLoaded.deep = true;
    }
    if (engine === 'quick' && !sessionsLoaded.quick) {
      try {
        const res = await fetch('/api/quickanswer');
        if (res.ok) quickSessions = await res.json();
      } catch (err) { console.error('[canvas] quick sessions list failed', err); }
      sessionsLoaded.quick = true;
    }
  }

  $effect(() => {
    if (renameRequested && menuNode && labelInputEl) {
      labelInputEl.focus();
      labelInputEl.select();
      renameRequested = false;
    }
  });

  $effect(() => {
    if (menuNode?.type === 'research-result') {
      const engine = (menuNode.config?.engine as 'deep' | 'quick') ?? 'deep';
      loadSessionsFor(engine);
    }
  });

  function beginRename(nodeId: string) {
    selectedId = nodeId;
    menuForNodeId = nodeId;
    renameRequested = true;
  }

  // Re-hydrate draft state when the SELECTED node changes — not when its
  // status overlay mutates. Without this gate, every SSE tick during a run
  // recomputed byId → menuNode (new identity), this effect re-ran, and
  // `configDraft = { ...menuNode.config }` installed a fresh object reference
  // that cascaded through every Panel's prop→state sync effect. That chain
  // is what surfaced as effect_update_depth_exceeded on Run.
  let lastMenuForNodeId: string | null = null;
  $effect(() => {
    if (!menuNode) {
      lastMenuForNodeId = null;
      return;
    }
    if (menuForNodeId === lastMenuForNodeId) return;
    lastMenuForNodeId = menuForNodeId;
    configDraft = { ...menuNode.config };
    labelDraft = menuNode.name;
    configDirty = false;
    saveError = null;
  });

  function setConfigField(key: string, value: unknown) {
    configDraft = { ...configDraft, [key]: value };
    configDirty = true;
  }

  function setLabel(v: string) {
    labelDraft = v;
    configDirty = true;
  }

  const modelCatalogue = $derived(data.modelCatalogue);
  const nodeTypes = $derived(data.nodeTypes);


  function viewportCenterInWorld(): { x: number; y: number } {
    if (!viewportEl) return { x: 320, y: 120 };
    const vp = viewportEl.getBoundingClientRect();
    const cx = (vp.width / 2 - panX) / zoom;
    const cy = (vp.height / 2 - panY) / zoom;
    // Snap to grid, and offset by half a node so center, not corner, is centered
    const x = Math.round((cx - NODE_W / 2) / 20) * 20;
    const y = Math.round((cy - NODE_H / 2) / 20) * 20;
    return { x, y };
  }

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    if (!viewportEl) return { x: 0, y: 0 };
    const vp = viewportEl.getBoundingClientRect();
    return {
      x: (clientX - vp.left - panX) / zoom,
      y: (clientY - vp.top - panY) / zoom,
    };
  }

  function resolveOverlap(p: { x: number; y: number }): { x: number; y: number } {
    let { x, y } = p;
    const limit = 20;
    for (let i = 0; i < limit; i++) {
      const clashes = (canvas?.nodes ?? []).some(
        (n) => Math.hypot(n.x - x, n.y - y) < 40,
      );
      if (!clashes) return { x, y };
      x += 24;
      y += 24;
    }
    return { x, y };
  }

  function inputsFor(type: string): HandleSpec[] {
    return (byNodeType(type)?.handles.inputs ?? []) as HandleSpec[];
  }
  function outputsFor(type: string): HandleSpec[] {
    return (byNodeType(type)?.handles.outputs ?? []) as HandleSpec[];
  }
  function allKinds(specs: HandleSpec[]): string[] {
    const s = new Set<string>();
    for (const h of specs) for (const k of h.kinds) s.add(k);
    return Array.from(s);
  }

  // ——— Node palette (cmd-K / right-click / long-press / drag-from-handle) ———
  let paletteOpen = $state(false);
  let paletteAnchor = $state<{ x: number; y: number } | 'center'>('center');
  let paletteMode = $state<PaletteMode>({ kind: 'workflow-ranked' });
  let paletteFromNodeId = $state<string | null>(null);
  let palettePositionOverride = $state<{ x: number; y: number } | null>(null);

  function openPalette(opts: {
    anchor: { x: number; y: number } | 'center';
    mode: PaletteMode;
    fromNodeId?: string | null;
    worldPosition?: { x: number; y: number } | null;
  }) {
    paletteAnchor = opts.anchor;
    paletteMode = opts.mode;
    paletteFromNodeId = opts.fromNodeId ?? null;
    palettePositionOverride = opts.worldPosition ?? null;
    paletteOpen = true;
  }
  function closePalette() {
    paletteOpen = false;
    paletteFromNodeId = null;
    palettePositionOverride = null;
  }

  async function onPalettePick(type: string) {
    const meta = byNodeType(type);
    if (!meta) {
      closePalette();
      return;
    }
    const worldPos = palettePositionOverride ?? viewportCenterInWorld();
    const placement = resolveOverlap(worldPos);
    const newNode = await addNode({
      type: meta.type,
      label: meta.label,
      defaultConfig: { ...(meta.defaultConfig as Record<string, unknown>) },
      position: placement,
    });
    if (paletteFromNodeId && newNode) {
      const source = byId[paletteFromNodeId];
      if (source) {
        const sourceMeta = byNodeType(source.type);
        const srcHandle = sourceMeta?.handles.outputs[0]?.id ?? null;
        const tgtHandle = meta.handles.inputs[0]?.id ?? null;
        try {
          await fetch(`/api/workflows/${canvas.workflowId}/edges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceNodeId: paletteFromNodeId,
              targetNodeId: newNode.id,
              sourceHandle: srcHandle,
              targetHandle: tgtHandle,
            }),
          });
          await invalidateAll();
          if (meta.type === 'webpage') {
            await syncWebpageFromUpstream(newNode.id);
          }
        } catch (err) {
          actionError = err instanceof Error ? err.message : String(err);
        }
      }
    }
    closePalette();
  }

  // Long-press (touch) trigger state
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressStart: { x: number; y: number } | null = null;

  function onViewportTouchStart(e: TouchEvent) {
    if (!NEW_PALETTE) return;
    if (paletteOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('.chat-node, .wf-node')) return;
    const t = e.touches[0];
    if (!t) return;
    longPressStart = { x: t.clientX, y: t.clientY };
    longPressTimer = setTimeout(() => {
      const world = screenToWorld(t.clientX, t.clientY);
      openPalette({
        anchor: { x: t.clientX, y: t.clientY },
        mode: { kind: 'workflow-ranked' },
        worldPosition: world,
      });
    }, 450);
  }

  $effect(() => {
    return () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressStart = null;
    };
  });
  function onViewportTouchMove(e: TouchEvent) {
    if (!longPressStart) return;
    const t = e.touches[0];
    if (!t) return;
    if (Math.hypot(t.clientX - longPressStart.x, t.clientY - longPressStart.y) > 10) {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
      longPressStart = null;
    }
  }
  function onViewportTouchEnd() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  }

  let addError = $state<string | null>(null);

  async function addNode(opt: {
    type: string;
    label: string;
    defaultConfig: Record<string, unknown>;
    position?: { x: number; y: number };
  }): Promise<{ id: string } | null> {
    addError = null;
    actionError = null;
    const position = opt.position ?? viewportCenterInWorld();
    try {
      const res = await fetch(`/api/workflows/${canvas.workflowId}/nodes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: opt.type,
          label: opt.label,
          position,
          config: opt.defaultConfig,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error('[canvas] add-node failed', res.status, body);
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const newId = body.node?.id as string | undefined;
      await invalidateAll();
      if (newId) {
        selectedId = newId;
        return { id: newId };
      }
      return null;
    } catch (err) {
      addError = err instanceof Error ? err.message : String(err);
      actionError = addError;
      return null;
    }
  }
  const knownModelValues = $derived(
    new Set([
      '',
      ...modelCatalogue.glm.map((m) => m.value),
      ...modelCatalogue.openrouter.map((m) => m.value),
    ]),
  );

  let pipePickerOpen = $state(false);
  let actionError = $state<string | null>(null);

  async function postAction(
    url: string,
    init?: RequestInit,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  async function reloadCanvas() {
    await invalidateAll();
  }

  async function actReRun() {
    // Single-node Re-Run. The inspector's Re-Run button runs ONLY the
    // open node, not the whole canvas (use the toolbar Run for that).
    // Scoped runs are much cheaper + safer for iterative work on one
    // node — e.g. tweaking a site-mapper or stealth-scrape config.
    const target = menuNode;
    if (!target) return;
    if (runMeta.state === 'running') return;
    closeMenu();
    const idleSeed: Record<string, NodeStatus> = {};
    for (const n of canvas?.nodes ?? []) idleSeed[n.id] = 'idle';
    liveStatus = idleSeed;
    liveData = {};
    nodeStartedAt = {};
    runMeta = { state: 'running' };
    runStartedAt = Date.now();
    runSummary = null;
    pendingRun = null;
    try {
      const res = await fetch(
        `/api/workflows/${canvas.workflowId}/nodes/${target.id}/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: {} }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      const { runId } = await res.json();
      activeRunId = runId;
      subscribeToRun(runId);
    } catch (err) {
      runMeta = { state: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async function deleteNode(id: string, skipConfirm = false) {
    const node = byId[id];
    if (!node) return;
    if (!skipConfirm && !confirm(`Delete node "${node.name}"? This also removes its edges.`)) return;
    actionError = null;
    const result = await postAction(
      `/api/workflows/${canvas.workflowId}/nodes/${id}`,
      { method: 'DELETE' },
    );
    if (result) {
      if (menuForNodeId === id) closeMenu();
      if (selectedId === id) selectedId = null;
      await reloadCanvas();
    }
  }

  async function actDelete() {
    if (!menuNode) return;
    await deleteNode(menuNode.id);
  }

  async function actDetach() {
    if (!menuNode) return;
    actionError = null;
    const result = await postAction(
      `/api/workflows/${canvas.workflowId}/nodes/${menuNode.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'detach' }),
      },
    );
    if (result) await reloadCanvas();
  }

  async function actBranch() {
    if (!menuNode) return;
    actionError = null;
    const result = await postAction(
      `/api/workflows/${canvas.workflowId}/nodes/${menuNode.id}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'branch' }),
      },
    );
    if (result) await reloadCanvas();
  }

  // ——— Intelligence node helpers ———

  /** Persist a node's config patch without needing the inline menu open. */
  async function saveNodeConfig(nodeId: string, patch: Record<string, unknown>) {
    const node = byId[nodeId];
    if (!node) return;
    const nextConfig = { ...node.config, ...patch };
    try {
      await fetch(`/api/workflows/${canvas.workflowId}/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: nextConfig }),
      });
      await invalidateAll();
    } catch (err) {
      console.error('[canvas] saveNodeConfig failed', err);
    }
  }

  // ——— Webpage node runtime outputs ———

  const webpageOutputs = $state<Record<string, Record<string, string>>>({});

  function webpageNodeOutput(
    nodeId: string,
    handleId: 'currentUrl' | 'selectedText' | 'extractedText',
    value: string,
  ) {
    const existing = webpageOutputs[nodeId] ?? {};
    if (existing[handleId] === value) return;
    webpageOutputs[nodeId] = { ...existing, [handleId]: value };
    propagateWebpageOutput(nodeId, handleId, value);
  }

  function propagateWebpageOutput(
    _nodeId: string,
    _handleId: 'currentUrl' | 'selectedText' | 'extractedText',
    _value: string,
  ) {
    // Outputs are consumed by downstream nodes via run data; UI-side propagation
    // is not needed in v1. Hook reserved for later.
  }

  function extractFirstUrl(s: string): string | null {
    const m = s.match(/\bhttps?:\/\/\S+/i);
    return m ? m[0] : null;
  }

  // Seeded when a webpage node is created with an upstream connection: check
  // the last known output of the upstream node and set urlDraft / config.url.
  async function syncWebpageFromUpstream(webpageNodeId: string) {
    const incoming = (canvas?.edges ?? []).filter((e) => e.to === webpageNodeId);
    if (incoming.length === 0) return;
    // Consider the most-recent incoming edge the one that drives the url.
    const edge = incoming[incoming.length - 1];
    const source = (canvas?.nodes ?? []).find((n) => n.id === edge.from);
    if (!source) return;
    const sourceMeta = byNodeType(source.type);
    const outputKinds = new Set(
      (sourceMeta?.handles.outputs ?? []).flatMap((h) => h.kinds),
    );
    const outputData = source.outputData as Record<string, unknown> | undefined;
    let candidate: string | undefined;
    if (outputKinds.has('url')) {
      candidate =
        (outputData?.currentUrl as string | undefined) ??
        (outputData?.url as string | undefined) ??
        undefined;
    }
    if (!candidate && outputKinds.has('research-result')) {
      const sources =
        (outputData?.researchSources as Array<{ url: string }> | undefined) ?? [];
      candidate = sources[0]?.url;
    }
    if (!candidate && outputKinds.has('text')) {
      const text = (outputData?.text as string | undefined) ?? '';
      const found = extractFirstUrl(text);
      candidate = found ?? undefined;
    }
    if (!candidate) return;
    const target = canvas?.nodes.find((n) => n.id === webpageNodeId);
    const currentUrl = (target?.config as { url?: string } | undefined)?.url ?? '';
    if (currentUrl === candidate) return;
    await saveNodeConfig(webpageNodeId, { url: candidate, mode: null });
  }

  async function startExplore(parentId: string, engine: 'deep' | 'quick') {
    const res = await fetch(`/api/canvas/${data.canvas.slug}/nodes/${parentId}/explore`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engine }),
    });
    if (!res.ok) {
      console.error('[canvas] explore failed', await res.text());
      return;
    }
    const { node, edge, streamUrl } = await res.json();
    // Optimistically insert the new node + edge into local canvas state.
    data.canvas.nodes = [
      ...data.canvas.nodes,
      {
        id: node.id,
        kind: 'intelligence',
        name: node.label,
        x: node.position.x,
        y: node.position.y,
        type: node.type,
        config: node.config,
      } as import('$lib/canvas/adapter').CanvasNode,
    ];
    data.canvas.edges = [
      ...data.canvas.edges,
      { id: edge.id, from: edge.sourceNodeId, to: edge.targetNodeId },
    ];
    pendingExplorations[node.id] = { engine, sessionId: node.config.sessionId as string, status: 'running', streamUrl };
    researchStatus[node.id] = 'running';
  }

  async function cancelExplore(nodeId: string) {
    await fetch(`/api/canvas/${data.canvas.slug}/nodes/${nodeId}/cancel-exploration`, {
      method: 'POST',
    });
    researchStatus[nodeId] = 'failed';
    const next = { ...pendingExplorations };
    delete next[nodeId];
    pendingExplorations = next;
  }

  async function finaliseResearch(
    nodeId: string,
    result: { report: string; sources: Array<{ url: string; title: string; domain: string }>; durationMs?: number },
  ) {
    researchStatus[nodeId] = 'complete';
    researchReport[nodeId] = result.report;
    researchSources[nodeId] = result.sources;
    delete pendingExplorations[nodeId];
    try {
      await fetch(`/api/canvas/${canvas.slug}/nodes/${nodeId}/complete-exploration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ report: result.report, sources: result.sources, durationMs: result.durationMs }),
      });
    } catch (err) {
      console.error('[canvas] complete-exploration failed', err);
    }
  }

  async function openAsWebpageNode(url: string, fromNodeId: string) {
    const source = (canvas?.nodes ?? []).find((n) => n.id === fromNodeId);
    if (!source) return;
    const meta = byNodeType('webpage');
    if (!meta) return;
    const pos = resolveOverlap({ x: source.x + 340, y: source.y });
    const newNode = await addNode({
      type: 'webpage',
      label: meta.label,
      defaultConfig: { ...(meta.defaultConfig as Record<string, unknown>), url },
      position: pos,
    });
    if (!newNode) return;
    const sourceMeta = byNodeType(source.type);
    const srcHandle = sourceMeta?.handles.outputs[0]?.id ?? null;
    const tgtHandle = meta.handles.inputs[0]?.id ?? null;
    try {
      await fetch(`/api/workflows/${canvas.workflowId}/edges`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sourceNodeId: fromNodeId,
          targetNodeId: newNode.id,
          sourceHandle: srcHandle,
          targetHandle: tgtHandle,
        }),
      });
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    }
  }

  // ——— Drag-to-connect edges ———
  let edgeDrag = $state<{
    sourceId: string;
    pointerId: number;
    cursorX: number;
    cursorY: number;
    hoverTargetId: string | null;
  } | null>(null);

  const edgeDragCompatible = $derived.by(() => {
    if (!edgeDrag || !edgeDrag.hoverTargetId) return null;
    const src = byId[edgeDrag.sourceId];
    const tgt = byId[edgeDrag.hoverTargetId];
    if (!src || !tgt) return null;
    return compatibility(outputsFor(src.type), inputsFor(tgt.type)) === 1;
  });

  function onHandlePointerDown(e: PointerEvent, source: CanvasNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    edgeDrag = {
      sourceId: source.id,
      pointerId: e.pointerId,
      cursorX: source.x + nodeW(source) + 8,
      cursorY: source.y + nodeH(source) / 2,
      hoverTargetId: null,
    };
  }

  $effect(() => {
    if (!edgeDrag) return;
    function onMove(e: PointerEvent) {
      if (!edgeDrag || e.pointerId !== edgeDrag.pointerId) return;
      if (!viewportEl) return;
      const vp = viewportEl.getBoundingClientRect();
      const worldX = (e.clientX - vp.left - panX) / zoom;
      const worldY = (e.clientY - vp.top - panY) / zoom;
      let hover: string | null = null;
      for (const n of viewNodes) {
        if (n.id === edgeDrag.sourceId) continue;
        if (n.kind === 'stats') continue;
        const w = nodeW(n);
        const h = nodeH(n);
        if (worldX >= n.x && worldX <= n.x + w && worldY >= n.y && worldY <= n.y + h) {
          hover = n.id;
          break;
        }
      }
      edgeDrag = { ...edgeDrag, cursorX: worldX, cursorY: worldY, hoverTargetId: hover };
    }
    async function onUp(e: PointerEvent) {
      if (!edgeDrag || e.pointerId !== edgeDrag.pointerId) return;
      const { sourceId, hoverTargetId } = edgeDrag;
      edgeDrag = null;
      if (hoverTargetId) {
        const source = byId[sourceId];
        const target = byId[hoverTargetId];
        if (source && target) {
          if (compatibility(outputsFor(source.type), inputsFor(target.type)) === 0) {
            actionError = 'Incompatible handle types';
            setTimeout(() => {
              if (actionError === 'Incompatible handle types') actionError = null;
            }, 1500);
          } else {
            const srcHandle = outputsFor(source.type)[0]?.id ?? null;
            const tgtHandle = inputsFor(target.type)[0]?.id ?? null;
            actionError = null;
            try {
              const res = await fetch(`/api/workflows/${canvas.workflowId}/edges`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  sourceNodeId: sourceId,
                  targetNodeId: hoverTargetId,
                  sourceHandle: srcHandle,
                  targetHandle: tgtHandle,
                }),
              });
              if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
              }
              await invalidateAll();
              if (target.type === 'webpage') {
                await syncWebpageFromUpstream(hoverTargetId);
              }
            } catch (err) {
              actionError = err instanceof Error ? err.message : String(err);
            }
          }
        }
      } else {
        // Dropped into empty space — open palette in strict-downstream mode
        if (!NEW_PALETTE) return;
        const source = byId[sourceId];
        if (source) {
          const meta = byNodeType(source.type);
          const outputs = (meta?.handles.outputs ?? []) as HandleSpec[];
          const world = screenToWorld(e.clientX, e.clientY);
          openPalette({
            anchor: { x: e.clientX, y: e.clientY },
            mode: { kind: 'strict-downstream', sourceType: source.type, sourceOutputs: outputs },
            fromNodeId: sourceId,
            worldPosition: world,
          });
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') edgeDrag = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  });

  async function pipeTo(targetId: string) {
    if (!menuNode) return;
    actionError = null;
    pipePickerOpen = false;
    const result = await postAction(`/api/workflows/${canvas.workflowId}/edges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceNodeId: menuNode.id, targetNodeId: targetId }),
    });
    if (result) await reloadCanvas();
  }

  async function saveTrigger() {
    if (!menuNode || menuNode.kind !== 'trigger' || saving) return;
    saving = true;
    saveError = null;
    try {
      const payload: Record<string, unknown> = {
        kind: (configDraft.kind as string) || 'manual',
        enabled: configDraft.enabled !== false,
      };
      if (payload.kind === 'cron') payload.cron = (configDraft.cron as string) || '';
      if (payload.kind === 'event') {
        payload.eventType = (configDraft.eventType as string) || '';
        if (configDraft.sourceWorkflowId)
          payload.sourceWorkflowId = configDraft.sourceWorkflowId;
      }
      const res = await fetch(`/api/workflows/${canvas.workflowId}/trigger`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // Also update the node label to reflect the trigger type
      await fetch(`/api/workflows/${canvas.workflowId}/nodes/${menuNode.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelDraft || 'Trigger' }),
      });
      configDirty = false;
      await invalidateAll();
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  async function saveNode() {
    if (!menuNode || saving) return;
    saving = true;
    saveError = null;
    try {
      const res = await fetch(
        `/api/workflows/${canvas.workflowId}/nodes/${menuNode.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: configDraft, label: labelDraft }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      configDirty = false;
      await invalidateAll();
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  // Phase C — double-click menu (inline shape)
  let menuForNodeId = $state<string | null>(null);
  let edgeInspectorFor = $state<string | null>(null);
  const inspectorEdge = $derived(
    edgeInspectorFor ? canvas.edges.find((e) => e.id === edgeInspectorFor) ?? null : null,
  );
  const inspectorFrom = $derived(inspectorEdge ? byId[inspectorEdge.from] ?? null : null);
  const inspectorTo = $derived(inspectorEdge ? byId[inspectorEdge.to] ?? null : null);
  const inspectorPos = $derived<{ x: number; y: number } | null>(
    inspectorFrom && inspectorTo
      ? (() => {
          const fw = nodeW(inspectorFrom);
          const fh = nodeH(inspectorFrom);
          const tw = nodeW(inspectorTo);
          const th = nodeH(inspectorTo);
          const mx = (inspectorFrom.x + fw / 2 + inspectorTo.x + tw / 2) / 2;
          const my = (inspectorFrom.y + fh / 2 + inspectorTo.y + th / 2) / 2;
          return { x: mx - 160, y: my - 10 };
        })()
      : null,
  );

  function openEdgeInspector(e: MouseEvent, edgeId: string) {
    e.stopPropagation();
    menuForNodeId = null;
    edgeInspectorFor = edgeId;
    selectedEdgeId = edgeId;
  }
  function closeEdgeInspector() {
    edgeInspectorFor = null;
  }

  // Single-click edge select (separate from the full inspector on dblclick).
  // Re-uses edgeInspectorFor highlighting but without opening the inspector
  // panel — Delete/Backspace then removes the selected edge.
  let selectedEdgeId = $state<string | null>(null);
  function selectEdge(e: MouseEvent, edgeId: string) {
    e.stopPropagation();
    selectedEdgeId = edgeId;
    edgeInspectorFor = edgeId; // highlight via existing .selected styling
    selectedId = null; // edges and nodes are mutually exclusive
    menuForNodeId = null;
  }
  async function deleteEdge(edgeId: string) {
    actionError = null;
    try {
      const res = await fetch(
        `/api/workflows/${canvas.workflowId}/edges?id=${encodeURIComponent(edgeId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      if (selectedEdgeId === edgeId) selectedEdgeId = null;
      if (edgeInspectorFor === edgeId) edgeInspectorFor = null;
      await invalidateAll();
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
    }
  }

  const menuNode = $derived(menuForNodeId ? byId[menuForNodeId] : null);
  const menuUpstream = $derived(
    menuNode
      ? canvas.edges.filter((e) => e.to === menuNode.id).map((e) => byId[e.from]).filter(Boolean)
      : [],
  );
  const menuDownstream = $derived(
    menuNode
      ? canvas.edges.filter((e) => e.from === menuNode.id).map((e) => byId[e.to]).filter(Boolean)
      : [],
  );

  function openMenu(e: Event, id: string) {
    e.stopPropagation();
    menuForNodeId = id;
    selectedId = id;
  }

  function closeMenu() {
    menuForNodeId = null;
  }

  function isTypingTarget(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  $effect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        // Menu only closes via its Close button — don't dismiss it on Escape.
        selectedId = null;
        selectedEdgeId = null;
        pipePickerOpen = false;
        edgeInspectorFor = null;
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        // Let the chat textarea's own handler send the draft
        if (isTypingTarget(ev.target)) return;
        ev.preventDefault();
        runCanvas();
      } else if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selectedEdgeId &&
        !menuForNodeId &&
        !isTypingTarget(ev.target)
      ) {
        ev.preventDefault();
        deleteEdge(selectedEdgeId);
      } else if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selectedId &&
        !menuForNodeId &&
        !isTypingTarget(ev.target)
      ) {
        ev.preventDefault();
        deleteNode(selectedId);
      } else if (
        ev.key === 'F2' &&
        selectedId &&
        !isTypingTarget(ev.target)
      ) {
        ev.preventDefault();
        beginRename(selectedId);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Global keyboard triggers for the node palette (cmd/ctrl-K, slash)
  $effect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      if (!NEW_PALETTE) return;
      if (paletteOpen) return; // palette handles its own keys while open
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
      const metaKey = isMac ? e.metaKey : e.ctrlKey;
      if (metaKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        openPalette({ anchor: 'center', mode: { kind: 'workflow-ranked' } });
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        openPalette({ anchor: 'center', mode: { kind: 'workflow-ranked' } });
      } else if (!typing && (e.key === 'f' || e.key === 'F') && !metaKey) {
        // Fit canvas — recovery shortcut when the toolbar is hidden behind
        // an extreme zoom level.
        e.preventDefault();
        fit();
      } else if (!typing && e.key === '0' && !metaKey) {
        // Reset pan + zoom to 1× / origin.
        e.preventDefault();
        reset();
      } else if (!typing && (e.key === '+' || e.key === '=') && !metaKey) {
        e.preventDefault();
        zoomCentered(1.2);
      } else if (!typing && (e.key === '-' || e.key === '_') && !metaKey) {
        e.preventDefault();
        zoomCentered(1 / 1.2);
      }
    }
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  });

  // Resume SSE if the server says there's an in-flight run at load
  $effect(() => {
    if (canvas.runStatus === 'running' && canvas.latestRunId && !activeRunId) {
      activeRunId = canvas.latestRunId;
      runMeta = { state: 'running' };
      if (runStartedAt === null) runStartedAt = Date.now();
      runSummary = null;
      subscribeToRun(canvas.latestRunId);
    }
  });

  // Runtime duplicate-key detector — logs which keyed {#each} source contains
  // collisions so we can root-cause the recurring each_key_duplicate error.
  $effect(() => {
    const check = (name: string, arr: unknown[] | undefined | null, keyFn: (x: any) => unknown) => {
      if (!arr) return;
      const seen = new Map<unknown, unknown>();
      for (const item of arr) {
        const k = keyFn(item);
        if (seen.has(k)) {
          console.warn(
            '[CANVAS-DUPE]',
            name,
            'has duplicate key',
            k,
            'prev:',
            seen.get(k),
            'curr:',
            item,
          );
        } else {
          seen.set(k, item);
        }
      }
    };
    check('viewNodes', viewNodes, (n) => n.id);
    check('visibleEdges', visibleEdges, (e) => e.id);
    check('canvas.nodes-raw', canvas.nodes, (n) => n.id);
    check('canvas.nodes-minimap', canvas.nodes, (n) => n.id + '-m');
    check('canvas.edges-raw', canvas.edges, (e) => e.id);
    check('peerCanvases', peerCanvases, (c) => c.workflowId);
    for (const cid of chatNodeIds) {
      check(`messagesFor(${cid})`, data.canvas.messagesByChat[cid], (m) => m.id);
      check(`liveToolSteps[${cid}]`, liveToolSteps[cid], (s) => s.toolCallId);
    }
  });

  // Hydrate pending explorations — mark running so ResearchResultNode opens
  // its SSE stream. Explicit key-existence check instead of `??=`: the latter
  // always performs an assignment, and Svelte 5 proxies can treat that as a
  // mutation even when the value matches — which re-triggers this effect
  // (it reads researchStatus[nodeId]) and caps out at effect_update_depth.
  $effect(() => {
    for (const nodeId of Object.keys(pendingExplorations)) {
      const node = canvas.nodes.find((n) => n.id === nodeId);
      if (node?.config?.completedReport) continue; // already done, just persisted
      if (!(nodeId in researchStatus)) {
        researchStatus[nodeId] = 'running';
      }
    }
  });
</script>

<svelte:head>
  <title>Canvas · {canvas.slug} — JKAI</title>
</svelte:head>

<div class="page-shell">
  <PageHeader title={canvas.title} titleHref="/jkai/canvas">
    {#snippet meta()}
      <span class="canvas-head-meta">
        <span class="canvas-head-slug">/{canvas.slug}</span>
        <span class="canvas-head-sep">·</span>
        <span>{viewNodes.length} {viewNodes.length === 1 ? 'node' : 'nodes'}</span>
        <span class="canvas-head-sep">·</span>
        <span>{visibleEdges.length} {visibleEdges.length === 1 ? 'edge' : 'edges'}</span>
        {#if runningCount > 0}
          <span class="canvas-head-sep">·</span>
          <span class="canvas-head-running">{runningCount} running</span>
        {/if}
      </span>
    {/snippet}
  </PageHeader>

  <div class="canvas-root">
    <!-- Top toolbar -->
  <div class="hifi-toolbar">
    <span class="sr-label">Canvas · hi-fi</span>
    <span class="sr-sep">/</span>
    <span class="mono11 primary canvas-title" title={canvas.title}>{canvas.title}</span>
    <span class="sr-sep">/</span>
    <span class="mono11 muted canvas-stats">
      {viewNodes.length} nodes · {visibleEdges.length} edges · {runningCount} running
    </span>
    <div class="toolbar-right">
      {#if hasStatsNode}
        <TimeFilter value={period} onchange={changePeriod} />
      {/if}
      {#if runMeta.state === 'running'}
        <button
          class="composer-pill run-btn running"
          onclick={runCanvas}
          disabled
          title="Running…"
        >⟳ running…</button>
        <button
          class="composer-pill stop-btn"
          onclick={cancelRun}
          title="Cancel the current run"
        >■ stop</button>
      {:else}
        <button
          class="composer-pill run-btn"
          onclick={runCanvas}
          disabled={!canvas.workflowId}
          title="Fire the trigger. Does NOT touch chat."
        >▶ Run</button>
      {/if}
      {#if runMeta.state === 'failed'}
        <span class="run-err" title={runMeta.error}>⚠ run failed</span>
      {/if}
      <span class="sep-v"></span>
      <div class="hifi-zoomctl">
        <button onclick={() => zoomCentered(1 / 1.2)} title="Zoom out">−</button><span class="zv"
          >{zoomPct}%</span
        ><button onclick={() => zoomCentered(1.2)} title="Zoom in">+</button>
      </div>
      {#if !NEW_PALETTE}
        <button
          class="composer-pill"
          title="Add node (palette disabled via env)"
          onclick={() => openPalette({ anchor: 'center', mode: { kind: 'workflow-ranked' } })}
        >+ node</button>
      {/if}
      <button class="composer-pill" onclick={fit} title="Fit canvas">Fit</button>
      <button class="composer-pill" onclick={reset} title="Reset pan/zoom">Reset</button>
      <span class="sep-v"></span>
      <button
        class="composer-pill annotation-pill"
        title="Add a post-it note"
        aria-label="Add post-it note"
        onclick={async () => {
          const meta = byNodeType('postit');
          if (!meta) return;
          const placement = resolveOverlap(viewportCenterInWorld());
          await addNode({
            type: meta.type,
            label: 'Note',
            defaultConfig: { ...(meta.defaultConfig as Record<string, unknown>) },
            position: placement,
          });
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="1" fill="currentColor" opacity="0.85"/>
          <path d="M10 2 L14 6 L14 2 Z" fill="var(--bg)" opacity="0.5"/>
        </svg>
        <span>Note</span>
      </button>
      <button
        class="composer-pill annotation-pill"
        title="Add an annotation box"
        aria-label="Add annotation box"
        onclick={async () => {
          const meta = byNodeType('annotation');
          if (!meta) return;
          const placement = resolveOverlap(viewportCenterInWorld());
          await addNode({
            type: meta.type,
            label: 'Group',
            defaultConfig: { ...(meta.defaultConfig as Record<string, unknown>) },
            position: placement,
          });
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 1.5" fill="none"/>
        </svg>
        <span>Box</span>
      </button>
    </div>
  </div>

  <!-- Viewport -->
  <div
    class="viewport"
    class:panning={panStart !== null}
    bind:this={viewportEl}
    bind:clientWidth={viewportW}
    bind:clientHeight={viewportH}
    role="application"
    aria-label="Canvas graph"
    style:--grid-offset-x="{panX}px"
    style:--grid-offset-y="{panY}px"
    style:--grid-cell="{32 * zoom}px"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
    oncontextmenu={(e) => {
      if (!NEW_PALETTE) return;
      const target = e.target as HTMLElement;
      if (target.closest('.chat-node, .wf-node')) return;
      e.preventDefault();
      const world = screenToWorld(e.clientX, e.clientY);
      openPalette({
        anchor: { x: e.clientX, y: e.clientY },
        mode: { kind: 'workflow-ranked' },
        worldPosition: world,
      });
    }}
    ontouchstart={onViewportTouchStart}
    ontouchmove={onViewportTouchMove}
    ontouchend={onViewportTouchEnd}
    ontouchcancel={onViewportTouchEnd}
  >

    <!-- Graph area (pan/zoom stage) -->
    <div
      class="graph"
      style:transform="translate({panX}px, {panY}px) scale({zoom})"
      style:transform-origin="0 0"
    >
      <svg class="edges" aria-hidden="true" overflow="visible">
        <!-- workflow edges -->
        {#if edgeDrag}
          {@const src = byId[edgeDrag.sourceId]}
          {#if src}
            <path
              d={`M ${src.x + nodeW(src)} ${src.y + nodeH(src) / 2} L ${edgeDrag.cursorX} ${edgeDrag.cursorY}`}
              stroke="var(--accent)"
              stroke-width="1.75"
              stroke-dasharray="4 3"
              fill="none"
              vector-effect="non-scaling-stroke"
              pointer-events="none"
            />
          {/if}
        {/if}
        {#each visibleEdges as e (e.id)}
          {@const isActive = activeEdgeIds.has(e.id)}
          {@const d = orthPath(byId[e.from], byId[e.to])}
          <!-- Wide transparent hit target. Click the stroke to select the
               edge (Delete/Backspace removes it); double-click opens the
               full inspector. We capture on pointerdown (not onclick)
               because the viewport's own pointerdown handler calls
               setPointerCapture and would otherwise own the whole gesture
               — meaning onclick on the SVG path never fires. -->
          <path
            class="edge-hit"
            class:is-selected={selectedEdgeId === e.id}
            {d}
            stroke="transparent"
            stroke-width="14"
            fill="none"
            pointer-events="stroke"
            style="cursor: pointer;"
            onpointerdown={(ev) => {
              // Only left mouse button; don't intercept right-click / middle-click.
              if (ev.button !== 0) return;
              ev.stopPropagation();
              selectEdge(ev as unknown as MouseEvent, e.id);
            }}
            ondblclick={(ev) => {
              ev.stopPropagation();
              openEdgeInspector(ev, e.id);
            }}
          />
          <path
            class="edge-stroke"
            class:selected={edgeInspectorFor === e.id}
            {d}
            stroke={edgeInspectorFor === e.id
              ? 'var(--accent)'
              : isActive
                ? 'var(--accent)'
                : 'var(--text-ghost)'}
            stroke-width={edgeInspectorFor === e.id ? 1.75 : isActive ? 1.75 : 1.25}
            stroke-dasharray={isActive ? '3 3' : ''}
            fill="none"
            vector-effect="non-scaling-stroke"
            pointer-events="none"
          />
          {#if typeof liveData[e.from]?.rowCount === 'number'}
            {@const _mid = edgeMidpoint(e)}
            <g class="edge-rowcount" transform="translate({_mid.x}, {_mid.y})">
              <rect x="-26" y="-9" width="52" height="14" rx="3" />
              <text x="0" y="2" text-anchor="middle">{liveData[e.from]?.rowCount} rows</text>
            </g>
          {/if}
        {/each}
      </svg>

      <!-- Nodes -->
      {#each viewNodes as n (n.id)}
        {#if n.kind === 'chat'}
          {@const msgs = messagesFor(n.id)}
          {@const size = chatNodeSize(n)}
          {@const wiring = chatNodeWiring(n.id)}
          <div
            class="chat-node"
            class:is-selected={selectedId === n.id}
            class:active={streamingFor[n.id]}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{size.w}px"
            style:height="{size.h}px"
            role="group"
            aria-label="Chat node"
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
            <div
              class="chat-node-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit"
            >
              <span class="chat-node-bar"></span>
              <span class="chat-node-title">CHAT</span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
              <span class="chat-node-count">{msgs.length} msg</span>
              {#if streamingFor[n.id]}
                <span class="chat-node-working" aria-label="Working">
                  <span class="chat-node-working-dot"></span>
                  <span class="chat-node-working-text">working</span>
                </span>
              {/if}
              <button
                class="chat-node-act"
                title="Copy transcript"
                disabled={msgs.length === 0}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation();
                  copyChatTranscript(n.id);
                }}
              >
                {chatCopiedFor === n.id ? '✓' : 'copy'}
              </button>
              <button
                class="chat-node-act chat-node-act-danger"
                title="Clear this chat"
                disabled={msgs.length === 0}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation();
                  clearChatTranscript(n.id);
                }}
              >
                clear
              </button>
            </div>

            <div
              class="chat-node-body"
              bind:this={chatBodyEls[n.id]}
              onpointerdown={(e) => e.stopPropagation()}
            >
              {#if msgs.length === 0 && !streamingFor[n.id]}
                <div class="chat-empty">
                  <div class="sr-label-tight">EMPTY · send to kick off the canvas</div>
                </div>
              {/if}
              {#each msgs as msg (msg.id)}
                <div class="chat-msg" class:is-user={msg.role === 'user'}>
                  <div class="msg-meta">
                    <b>
                      {msg.role === 'user'
                        ? 'YOU'
                        : msg.role === 'assistant'
                          ? 'JKAI'
                          : msg.role.toUpperCase()}
                    </b>
                    <span class="sr-sep">/</span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div class="chat-msg-body">
                    <ChatMarkdown content={msg.content} role={msg.role} />
                  </div>
                </div>
              {/each}
              {#if streamingFor[n.id]}
                <div class="chat-msg chat-msg-pending">
                  <div class="msg-meta">
                    <b>JKAI</b><span class="sr-sep">/</span>
                    <span>streaming…</span>
                  </div>
                  {#if liveToolSteps[n.id] && liveToolSteps[n.id].length > 0}
                    <div class="chat-tool-trace">
                      {#each liveToolSteps[n.id] as step (step.toolCallId)}
                        <div class="chat-tool-step" class:running={step.status === 'running'}>
                          <span class="chat-tool-dot"></span>{step.tool}
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if streamingReplies[n.id]}
                    <!-- In-flight: render plain text, no markdown. ChatMarkdown
                         re-parses the entire accumulated reply on every state
                         update (O(n²) over the full length), which with a fast
                         stream pins the main thread and was blocking canvas
                         pan/scroll mid-run. Final assistant reply (persisted
                         after the run completes) is rendered through
                         ChatMarkdown by the msgs loop above. -->
                    <div class="chat-msg-body chat-msg-streaming chat-plain-stream">
                      {streamingReplies[n.id]}<span class="chat-cursor">▊</span>
                    </div>
                  {:else if !(liveToolSteps[n.id] && liveToolSteps[n.id].length > 0)}
                    <div class="chat-msg-body ghost">⟳ thinking…</div>
                  {/if}
                </div>
              {/if}
            </div>

            <!-- Resize handle (bottom-right corner) -->
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
            <div
              class="chat-node-composer"
              onpointerdown={(e) => e.stopPropagation()}
            >
              {#if wiring === 'receiver'}
                <div class="chat-locked-hint">
                  Receives input from upstream — reply appears here when you Run the workflow.
                </div>
              {:else}
                <textarea
                  class="chat-input"
                  value={chatDrafts[n.id] ?? ''}
                  oninput={(e) =>
                    (chatDrafts = {
                      ...chatDrafts,
                      [n.id]: (e.target as HTMLTextAreaElement).value,
                    })}
                  placeholder={wiring === 'trigger'
                    ? 'Message — fires the workflow with your text as input'
                    : 'Message this chat — ⏎ send · ⇧⏎ newline'}
                  rows="2"
                  onkeydown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                      e.preventDefault();
                      sendFromChat(n.id);
                    }
                  }}
                ></textarea>
                <div class="chat-composer-foot">
                  <span class="mono10 muted">
                    {#if streamingFor[n.id]}
                      {wiring === 'trigger' ? 'running…' : 'thinking…'}
                    {:else if wiring === 'trigger'}
                      ⏎ run workflow · ⇧⏎ newline
                    {:else}
                      ⏎ send · ⇧⏎ newline
                    {/if}
                  </span>
                  {#if streamingFor[n.id]}
                    <button
                      class="composer-pill stop-btn"
                      onclick={() => cancelChat(n.id)}
                      title="Stop the reply (keeps what was streamed so far)"
                    >■ stop</button>
                  {:else}
                    <button
                      class="composer-pill run-btn"
                      onclick={() => sendFromChat(n.id)}
                      disabled={!(chatDrafts[n.id] ?? '').trim()}
                    >
                      {wiring === 'trigger' ? 'RUN' : 'SEND'}
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          </div>
        {:else if n.kind === 'inspector'}
          {@const isize = resizableSize(n)}
          <div
            class="chat-node inspector-node"
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            class:active={isRunning && n.status === 'running'}
            class:failed={isRunning && n.status === 'failed'}
            class:ok={isRunning && n.status === 'ok'}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{isize.w}px"
            style:height="{isize.h}px"
            role="group"
            aria-label="Inspector node"
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <div
              class="chat-node-hdr inspector-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit label"
            >
              <span class="inspector-bar"></span>
              <span class="chat-node-title">INSPECT</span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
              {#if n.status}
                <span class="chat-node-count">{n.status}</span>
              {/if}
            </div>

            <div class="inspector-body" onpointerdown={(e) => e.stopPropagation()}>
              {#each [inspectorHistories[n.id] ?? []] as hist (n.id)}
                {@const selectedId = inspectorSelected[n.id] ?? null}
                {@const selectedExec = hist.find((e) => e.id === selectedId)}
                <InspectorBody
                  data={selectedExec ? selectedExec.outputData : n.inputData}
                  history={hist}
                  selectedHistoryId={selectedId}
                  onhistoryselect={(id) => { inspectorSelected = { ...inspectorSelected, [n.id]: id }; }}
                />
              {/each}
            </div>

            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>

            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
          </div>
        {:else if n.kind === 'intelligence' && n.type === 'intelligence'}
          {@const isize = resizableSize(n)}
          <div
            class="chat-node intelligence-node"
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{isize.w}px"
            style:height="{isize.h}px"
            role="group"
            aria-label="Intelligence node"
            onpointerdown={(e) => e.stopPropagation()}
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <div
              class="chat-node-hdr intelligence-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit label"
            >
              <span class="intelligence-bar"></span>
              <span class="chat-node-title">INTEL</span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
            </div>
            <div class="intelligence-node-body" onpointerdown={(e) => e.stopPropagation()}>
              <IntelligenceNode
                slug={data.canvas.slug}
                nodeId={n.id}
                config={n.config as { query?: string; facets?: Record<string, unknown>; size?: { w: number; h: number } }}
                onsave={(patch) => saveNodeConfig(n.id, patch)}
                onexplore={(engine) => startExplore(n.id, engine)}
              />
            </div>
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
          </div>
        {:else if n.kind === 'intelligence' && n.type === 'research-result'}
          {@const rsize = resizableSize(n)}
          <div
            class="chat-node research-result-node"
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{rsize.w}px"
            style:height="{rsize.h}px"
            role="group"
            aria-label="Research result node"
            onpointerdown={(e) => e.stopPropagation()}
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <div
              class="chat-node-hdr research-result-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit label"
            >
              <span class="research-result-bar"></span>
              <span class="chat-node-title">RESEARCH</span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
            </div>
            <ResearchResultNode
              engine={(n.config.engine as 'deep' | 'quick') ?? 'deep'}
              topic={(n.config.topic as string) ?? ''}
              status={researchStatus[n.id] ?? ((n.config as Record<string, unknown>)?.completedReport ? 'complete' : ((n.outputData as Record<string, unknown>)?.researchStatus as 'pending' | 'running' | 'complete' | 'failed') ?? 'complete')}
              report={researchReport[n.id] ?? (n.config.completedReport as string) ?? ((n.outputData as Record<string, unknown>)?.researchReport as string) ?? ''}
              sources={researchSources[n.id] ?? (n.config.completedSources as Array<{ url: string; title: string; domain: string }>) ?? ((n.outputData as Record<string, unknown>)?.researchSources as Array<{ url: string; title: string; domain: string }>) ?? []}
              durationMs={(n.config.completedDurationMs as number | null) ?? (n.outputData as Record<string, unknown>)?.researchDurationMs as number | undefined}
              streamUrl={pendingExplorations[n.id]?.streamUrl ?? null}
              sessionId={(n.config.sessionId as string) ?? (pendingExplorations[n.id]?.sessionId ?? null)}
              nodeId={n.id}
              oncancel={() => cancelExplore(n.id)}
              ondone={(result) => finaliseResearch(n.id, result)}
              onopenaswebpage={(e) => openAsWebpageNode(e.url, e.fromNodeId)}
            />
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
          </div>
        {:else if n.kind === 'webpage'}
          {@const wsize = resizableSize(n)}
          <div
            class="chat-node webpage-node-wrapper"
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{wsize.w}px"
            style:height="{wsize.h}px"
            role="group"
            aria-label="Webpage node"
            onpointerdown={(e) => e.stopPropagation()}
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <div
              class="chat-node-hdr webpage-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit label"
            >
              <span class="webpage-bar"></span>
              <span class="chat-node-title">WEB</span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
            </div>
            <div class="webpage-node-body" onpointerdown={(e) => e.stopPropagation()}>
              <WebpageNode
                nodeId={n.id}
                config={(n.config as WebpageConfig) ?? { url: '', mode: null, size: { w: 720, h: 480 } }}
                onConfigChange={(patch) => saveNodeConfig(n.id, patch as Record<string, unknown>)}
                onOutput={(handleId, value) => webpageNodeOutput(n.id, handleId, value)}
              />
            </div>
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
          </div>
        {:else if n.kind === 'builder'}
          {@const bsize = resizableSize(n)}
          {@const builderBuildId = resolveBuilderBuildId(n.id)}
          <div
            class="chat-node builder-node-wrapper"
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            class:active={isRunning && n.status === 'running'}
            class:failed={isRunning && n.status === 'failed'}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{bsize.w}px"
            style:height="{bsize.h}px"
            role="group"
            aria-label={n.type === 'builder-chat' ? 'Builder Chat node' : n.type === 'builder-pi' ? 'Builder Pi node' : 'Build View node'}
            onpointerdown={(e) => e.stopPropagation()}
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <div
              class="chat-node-hdr builder-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit settings"
            >
              <span class="builder-bar"></span>
              <span class="chat-node-title">
                {#if n.type === 'builder-chat'}BUILDER{:else if n.type === 'builder-pi'}PI{:else}VIEW{/if}
              </span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
            </div>
            <div class="builder-node-body" onpointerdown={(e) => e.stopPropagation()}>
              {#if n.type === 'builder-chat'}
                <BuilderChatNode
                  nodeId={n.id}
                  config={(n.config as Record<string, unknown>) ?? {}}
                  emitSchemas={collectDownstreamEmitSchemas(n.id)}
                  onConfigChange={(patch) => saveNodeConfig(n.id, patch as Record<string, unknown>)}
                />
              {:else if n.type === 'builder-pi'}
                <BuilderPiNode
                  nodeId={n.id}
                  config={(n.config as Record<string, unknown>) ?? {}}
                  resolvedBuildId={builderBuildId}
                  onConfigChange={(patch) => saveNodeConfig(n.id, patch as Record<string, unknown>)}
                />
              {:else if n.type === 'build-view'}
                <BuildViewNode
                  nodeId={n.id}
                  config={(n.config as Record<string, unknown>) ?? {}}
                  resolvedBuildId={builderBuildId}
                  inputData={resolveUpstreamInputData(n.id)}
                  onConfigChange={(patch) => saveNodeConfig(n.id, patch as Record<string, unknown>)}
                />
              {/if}
            </div>
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
          </div>
        {:else if n.kind === 'postit'}
          {@const psize = resizableSize(n)}
          {@const pcfg = (n.config as Record<string, unknown>) ?? {}}
          {@const ptitle = (pcfg.title as string) ?? ''}
          {@const ptext = (pcfg.text as string) ?? ''}
          {@const pcolor = ((pcfg.color as string) ?? 'yellow') as 'yellow' | 'pink' | 'blue' | 'green'}
          {@const pTextPx = Math.max(12, Math.min(44, Math.round(Math.min(psize.w, psize.h) * 0.11)))}
          {@const pTitlePx = Math.max(13, Math.min(24, Math.round(pTextPx * 0.85)))}
          <div
            class="postit-node"
            class:is-selected={selectedId === n.id}
            class:flash={flashNodeId === n.id}
            data-color={pcolor}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{psize.w}px"
            style:height="{psize.h}px"
            style:--postit-text-size="{pTextPx}px"
            style:--postit-title-size="{pTitlePx}px"
            role="group"
            aria-label="Post-it note"
          >
            <div
              class="postit-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit label"
            >
              <span class="postit-pin"></span>
              <div class="postit-colors" onpointerdown={(e) => e.stopPropagation()}>
                {#each ['yellow', 'pink', 'blue', 'green'] as c}
                  <button
                    type="button"
                    class="postit-color-swatch"
                    data-color={c}
                    class:on={pcolor === c}
                    aria-label={`Set colour ${c}`}
                    onclick={() => saveNodeConfig(n.id, { ...(n.config as Record<string, unknown>), color: c })}
                  ></button>
                {/each}
              </div>
            </div>
            <input
              class="postit-title-input"
              type="text"
              value={ptitle}
              placeholder="Title…"
              onpointerdown={(e) => e.stopPropagation()}
              oninput={(e) => { (n.config as Record<string, unknown>).title = (e.currentTarget as HTMLInputElement).value; }}
              onblur={(e) => saveNodeConfig(n.id, { ...(n.config as Record<string, unknown>), title: (e.currentTarget as HTMLInputElement).value })}
            />
            <textarea
              class="postit-body"
              value={ptext}
              placeholder="Write a comment…"
              onpointerdown={(e) => e.stopPropagation()}
              oninput={(e) => {
                const v = (e.currentTarget as HTMLTextAreaElement).value;
                (n.config as Record<string, unknown>).text = v;
              }}
              onblur={(e) => saveNodeConfig(n.id, { ...(n.config as Record<string, unknown>), text: (e.currentTarget as HTMLTextAreaElement).value })}
            ></textarea>
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
          </div>
        {:else if n.kind === 'annotation'}
          {@const asize = resizableSize(n)}
          {@const atitle = ((n.config as Record<string, unknown>)?.title as string) ?? ''}
          <!-- Dashed rectangle with an optional title label sat on the
               top edge. Click the body to select, drag to move,
               Backspace/Delete removes. -->
          <div
            class="annotation-node"
            class:is-selected={selectedId === n.id}
            class:flash={flashNodeId === n.id}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{asize.w}px"
            style:height="{asize.h}px"
            role="button"
            tabindex="0"
            aria-label="Annotation box — click to select, Delete to remove"
            title="Drag to move · click then Delete to remove"
            onpointerdown={(e) => onNodePointerDown(e, n)}
            onpointermove={onNodePointerMove}
            onpointerup={(e) => onNodePointerUp(e, n)}
            onpointercancel={(e) => onNodePointerUp(e, n)}
          >
            <input
              class="annotation-title-input"
              class:has-value={!!atitle}
              type="text"
              value={atitle}
              placeholder="Title"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => e.stopPropagation()}
              oninput={(e) => { (n.config as Record<string, unknown>).title = (e.currentTarget as HTMLInputElement).value; }}
              onblur={(e) => saveNodeConfig(n.id, { ...(n.config as Record<string, unknown>), title: (e.currentTarget as HTMLInputElement).value })}
            />
            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
          </div>
        {:else if n.kind === 'stats'}
          {@const ssize = resizableSize(n)}
          <div
            class="chat-node stats-node"
            class:is-selected={selectedId === n.id}
            class:flash={flashNodeId === n.id}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{ssize.w}px"
            style:height="{ssize.h}px"
            role="group"
            aria-label="Stats node"
          >
            <div
              class="chat-node-hdr stats-hdr"
              onpointerdown={(e) => onNodePointerDown(e, n)}
              onpointermove={onNodePointerMove}
              onpointerup={(e) => onNodePointerUp(e, n)}
              onpointercancel={(e) => onNodePointerUp(e, n)}
              ondblclick={(e) => openMenu(e, n.id)}
              role="button"
              tabindex="0"
              title="Drag to move · double-click to edit label"
            >
              <span class="stats-bar"></span>
              <span class="chat-node-title">STATS</span>
              <span class="sr-sep">/</span>
              <span class="chat-node-label">{n.name}</span>
            </div>

            <div class="stats-node-body" onpointerdown={(e) => e.stopPropagation()}>
              {#if n.type === 'stats-summary'}
                <SummaryNode slug={canvas.slug} period={period} refreshKey={runBumpKey} />
              {:else if n.type === 'stats-trends'}
                <TrendsNode slug={canvas.slug} period={period} refreshKey={runBumpKey} />
              {:else if n.type === 'stats-per-node'}
                <PerNodeNode
                  slug={canvas.slug}
                  period={period}
                  refreshKey={perNodeBumpKey}
                  onrowclick={(nodeId) => scrollToNode(nodeId)}
                />
              {:else if n.type === 'run-timeline'}
                <RunTimelineNode
                  slug={canvas.slug}
                  refreshKey={timelineBumpKey}
                  onnodeclick={(nodeId) => scrollToNode(nodeId)}
                />
              {/if}
            </div>

            <div
              class="chat-node-resize"
              title="Drag to resize"
              onpointerdown={(e) => onChatResizeDown(e, n)}
              onpointermove={onChatResizeMove}
              onpointerup={onChatResizeUp}
              onpointercancel={onChatResizeUp}
            ></div>
          </div>
        {:else}
          {@const awaitingInteraction = pendingInteractions[n.id] ?? null}
          <div
            class="wf-node"
            class:active={isRunning && n.status === 'running'}
            class:failed={isRunning && n.status === 'failed'}
            class:ok={isRunning && n.status === 'ok'}
            class:awaiting-human={!!awaitingInteraction}
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-incompatible={edgeDrag?.hoverTargetId === n.id && edgeDragCompatible === false}
            class:is-trigger={n.kind === 'trigger'}
            class:flash={flashNodeId === n.id}
            data-kind={n.kind}
            data-status={liveStatus[n.id] ?? n.status ?? 'idle'}
            style:left="{n.x}px"
            style:top="{n.y}px"
            role="button"
            tabindex="0"
            onpointerdown={(e) => onNodePointerDown(e, n)}
            onpointermove={onNodePointerMove}
            onpointerup={(e) => onNodePointerUp(e, n)}
            onpointercancel={(e) => onNodePointerUp(e, n)}
            ondblclick={(e) => {
              // If the node has a pending human interaction (e.g. scraper
              // hit a CAPTCHA), double-click opens the VNC modal instead of
              // the config inspector. The floating "Awaiting you" badge
              // above the node is easy to miss, so this is the primary entry.
              if (awaitingInteraction) {
                e.stopPropagation();
                activeInteraction = awaitingInteraction;
              } else {
                openMenu(e, n.id);
              }
            }}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                if (awaitingInteraction) {
                  e.stopPropagation();
                  activeInteraction = awaitingInteraction;
                } else {
                  openMenu(e, n.id);
                }
              } else if (e.key === ' ') selectNode(e, n.id);
            }}
          >
            {#if (byNodeType(n.type)?.handles.inputs.length ?? 0) > 0}
              <div
                class="node-handle node-handle-input"
                title={`Inputs: ${allKinds(inputsFor(n.type)).join(', ')}`}
              ></div>
            {/if}
            <!-- Last-run status square. Green = completed OK, amber =
                 partial / warnings / running, red = failed. Absent when
                 the node has never run (status === 'idle' or undefined). -->
            {#each [liveStatus[n.id] ?? n.status] as _status (1)}
              {@const _colour = statusDotColour(_status)}
              {@const _pill = statusPillText(n.id, _status)}
              {#if _colour}
                <div
                  class="wf-node-status-dot wf-node-status-{_colour}"
                  title={`Last run: ${_status}`}
                  aria-label={`status ${_status}`}
                ></div>
              {/if}
              {#if _pill}
                <span class="wf-node-status-pill wf-node-status-{_colour}">{_pill}</span>
              {/if}
            {/each}
            {#if n.kind === 'trigger'}
              <span class="trig-icon">▶</span>
              <div class="trig-stack">
                <span class="wf-name">{n.name}</span>
                <span class="trig-summary">{triggerSummary(n.config)}</span>
              </div>
            {:else}
              {@const _def = getDefinition(n.type)}
              {@const _summary = (n as { actionSummary?: string }).actionSummary
                || summarizeNode(n.type, n.config as Record<string, unknown>, _def?.description).line}
              <div class="trig-stack">
                <span class="wf-name">{n.name}</span>
                {#if _summary && _summary !== n.name}
                  <span class="trig-summary wf-summary" title={_summary}>{_summary.length > 90 ? _summary.slice(0, 89) + '…' : _summary}</span>
                {/if}
              </div>
            {/if}
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
            {#if awaitingInteraction}
              <button
                class="awaiting-badge"
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation();
                  activeInteraction = awaitingInteraction;
                }}
                title={awaitingInteraction.prompt}
              >▶ SOLVE</button>
            {/if}
            {#if n.status === 'failed' && (liveData[n.id]?.error || n.error)}
              {@const errText = (liveData[n.id]?.error ?? n.error) as string}
              <div
                class="wf-node-runinfo wf-node-runinfo-error"
                title={errText}
                onpointerdown={(e) => e.stopPropagation()}
                onclick={(e) => {
                  e.stopPropagation();
                  openMenu(e, n.id);
                }}
                role="button"
                tabindex="0"
              >
                <span class="wf-node-runinfo-label">error</span>
                <span class="wf-node-runinfo-msg">{errText.slice(0, 80)}{errText.length > 80 ? '…' : ''}</span>
              </div>
            {:else if n.status === 'ok' && isRunning}
              <div class="wf-node-runinfo wf-node-runinfo-ok">
                <span class="wf-node-runinfo-label">ok</span>
              </div>
            {/if}
          </div>
        {/if}
      {/each}


      <!-- Edge inspector -->
      {#if inspectorEdge && inspectorFrom && inspectorTo && inspectorPos}
        <div
          class="edge-inspector"
          style:left="{inspectorPos.x}px"
          style:top="{inspectorPos.y}px"
          role="dialog"
          aria-label="Edge inspector"
        >
          <div class="edge-inspector-hd">
            <span class="sr-label-tight">EDGE</span>
            <span class="edge-inspector-route">
              <span class="edge-pin" data-kind={inspectorFrom.kind}>{inspectorFrom.name}</span>
              <span class="edge-arrow">→</span>
              <span class="edge-pin" data-kind={inspectorTo.kind}>{inspectorTo.name}</span>
            </span>
            <button
              class="p-icon-btn"
              onclick={closeEdgeInspector}
              aria-label="Close"
              title="Close (Esc)">✕</button
            >
          </div>
          <div class="edge-inspector-body">
            <section class="nm-sec">
              <div class="nm-sec-hd">
                <span class="sr-label-tight">OUTPUT FROM {inspectorFrom.name.toUpperCase()}</span>
                {#if inspectorFrom.durationMs != null}
                  <span class="nm-sec-meta">
                    took {(inspectorFrom.durationMs / 1000).toFixed(2)}s
                  </span>
                {/if}
              </div>
              <div class="nm-field nm-field-read">
                {#if inspectorFrom.outputData !== undefined}
                  <InspectorBody data={inspectorFrom.outputData} />
                {:else if inspectorFrom.error}
                  <pre class="error-text">{inspectorFrom.error}</pre>
                {:else}
                  <pre class="ghost">// no run yet on this edge</pre>
                {/if}
              </div>
            </section>
            <section class="nm-sec">
              <div class="nm-sec-hd">
                <span class="sr-label-tight">INPUT RECEIVED BY {inspectorTo.name.toUpperCase()}</span>
              </div>
              <div class="nm-field nm-field-read">
                {#if inspectorTo.inputData !== undefined}
                  <InspectorBody data={inspectorTo.inputData} />
                {:else}
                  <pre class="ghost">// no run yet</pre>
                {/if}
              </div>
            </section>
          </div>
        </div>
      {/if}

      <!-- Inline context menu -->
      {#if menuNode}
        <div
          class="nm-inline"
          style:left="{menuNode.x - 18}px"
          style:top="{menuNode.y - 18}px"
          role="dialog"
          aria-label="Node inspector"
        >
          <div class="nm-inline-hdr">
            <span class="nm-bar" style:background={KIND_COLOR[menuNode.kind]}></span>
            <input
              class="nm-label-input"
              type="text"
              value={labelDraft}
              bind:this={labelInputEl}
              oninput={(e) => setLabel((e.target as HTMLInputElement).value)}
              onkeydown={(e) => {
                if (e.key === 'Enter' && configDirty && !saving) {
                  e.preventDefault();
                  saveNode();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeMenu();
                }
              }}
              placeholder="Node name"
              title="Press Enter to save, Esc to cancel"
              aria-label="Node name"
            />
            <span class="nm-hdr-kind">{menuNode.kind}</span>
            {#if configDirty}
              <button
                class="nm-save-btn"
                onclick={menuNode.kind === 'trigger' ? saveTrigger : saveNode}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            {/if}
            {#if saveError}
              <span class="nm-save-err" title={saveError}>⚠</span>
            {/if}
            <button
              class="p-icon-btn"
              onclick={closeMenu}
              aria-label="Close inspector"
              title="Close (Esc)">✕</button
            >
          </div>
          <div class="nm-inline-body">
            <!-- Shared header: kind · id · status · name · upstream/downstream chips -->
            <div class="nm-hdr">
              <div class="nm-hdr-row">
                <span class="nm-bar" style:background={KIND_COLOR[menuNode.kind]}></span>
                <span class="nm-hdr-type" title={byNodeType(menuNode.type)?.description ?? ''}>
                  {byNodeType(menuNode.type)?.label ?? menuNode.type}
                </span>
                <span class="nm-hdr-typecode">{menuNode.type}</span>
                <span class="nm-hdr-id">#{menuNode.id.slice(0, 8)}</span>
                {#if menuNode.status === 'running'}
                  <span class="chip chip-accent chip-pill chip-live ms-auto">RUNNING</span>
                {:else if menuNode.status === 'failed'}
                  <span class="chip chip-pill chip-failed ms-auto">FAILED ×1</span>
                {:else if menuNode.status === 'ok'}
                  <span class="chip chip-pill ms-auto">OK</span>
                {/if}
              </div>
              <div class="nm-hdr-name">{menuNode.name}</div>
              <div class="nm-ctx">
                <div class="nm-ctx-row">
                  <span class="nm-ctx-lbl">↑ UPSTREAM</span>
                  {#if menuUpstream.length}
                    {#each menuUpstream as u (u.id)}
                      <span class="nm-pin" data-kind={u.kind}>{u.name}</span>
                    {/each}
                  {:else}
                    <span class="nm-ctx-empty">none</span>
                  {/if}
                </div>
                <div class="nm-ctx-row">
                  <span class="nm-ctx-lbl">↓ DOWNSTREAM</span>
                  {#if menuDownstream.length}
                    {#each menuDownstream as d (d.id)}
                      <span class="nm-pin" data-kind={d.kind}>{d.name}</span>
                    {/each}
                  {:else}
                    <span class="nm-ctx-empty">none</span>
                  {/if}
                </div>
              </div>
            </div>

            <!-- Kind-specific body -->
            <div class="nm-body">
              {#each [summarizeNode(menuNode.type, configDraft as Record<string, unknown>, getDefinition(menuNode.type)?.description)] as _previewSummary (1)}
                {#if _previewSummary.line}
                  <section class="nm-sec nm-action-preview" aria-label="What this node will do">
                    <header class="nm-action-hdr">
                      <span class="sr-label-tight">What this does</span>
                      <span class="nm-action-kind">{_previewSummary.preview.kind}</span>
                    </header>
                    <p class="nm-action-line">{_previewSummary.line}</p>
                    {#if Object.keys(_previewSummary.preview.details).length > 0}
                      <dl class="nm-action-grid">
                        {#each Object.entries(_previewSummary.preview.details) as [k, v] (k)}
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        {/each}
                      </dl>
                    {/if}
                  </section>
                {/if}
              {/each}
              {#if menuNode.kind === 'trigger'}
                {@const kind = ((configDraft.kind as string) || 'manual') as
                  | 'manual'
                  | 'cron'
                  | 'webhook'
                  | 'event'}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">TRIGGER TYPE</span>
                  </div>
                  <div class="trig-pills">
                    {#each ['manual', 'cron', 'webhook', 'event'] as k}
                      <button
                        class="trig-pill"
                        class:active={kind === k}
                        onclick={() => setConfigField('kind', k)}
                      >
                        {k}
                      </button>
                    {/each}
                  </div>
                </section>

                {#if kind === 'manual'}
                  <section class="nm-sec">
                    <div class="chat-explainer">
                      <p>
                        Fires on demand: a chat send, a "Run" click from the canvas toolbar, or
                        any POST to <code>/api/workflows/{canvas.workflowId}/run</code>.
                      </p>
                    </div>
                  </section>
                {:else if kind === 'cron'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">SCHEDULE</span>
                      <span class="nm-sec-meta">picks the cron expression</span>
                    </div>
                    <select
                      class="nm-text-input"
                      value={(configDraft.cron as string) ?? ''}
                      onchange={(e) =>
                        setConfigField('cron', (e.target as HTMLSelectElement).value)}
                    >
                      <option value="">— pick a preset —</option>
                      {#each CRON_PRESETS as p (p.value)}
                        <option value={p.value}>{p.label}</option>
                      {/each}
                    </select>
                  </section>
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">CUSTOM CRON</span>
                      <span class="nm-sec-meta">min hour dom mon dow</span>
                    </div>
                    <input
                      class="nm-text-input"
                      type="text"
                      value={(configDraft.cron as string) ?? ''}
                      oninput={(e) =>
                        setConfigField('cron', (e.target as HTMLInputElement).value)}
                      placeholder="*/15 * * * *"
                    />
                  </section>
                {:else if kind === 'webhook'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">WEBHOOK URL</span>
                      <span class="nm-sec-meta">POST to fire the workflow</span>
                    </div>
                    <div class="nm-field nm-field-read">
                      <pre>POST https://strangeramblings.com/api/workflows/webhook/{canvas.workflowId}</pre>
                    </div>
                  </section>
                  <section class="nm-sec">
                    <div class="chat-explainer">
                      <p>
                        The body becomes <code>initialInput</code> for the run. Any shape is
                        accepted; downstream nodes can template it as <code>{'{{input.field}}'}</code>.
                      </p>
                    </div>
                  </section>
                {:else if kind === 'event'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">EVENT TYPE</span>
                    </div>
                    <select
                      class="nm-text-input"
                      value={(configDraft.eventType as string) ?? ''}
                      onchange={(e) =>
                        setConfigField('eventType', (e.target as HTMLSelectElement).value)}
                    >
                      <option value="">— pick an event —</option>
                      <option value="workflow_completed">workflow_completed</option>
                      <option value="strava_activity_synced">strava_activity_synced</option>
                      <option value="whoop_recovery_updated">whoop_recovery_updated</option>
                    </select>
                  </section>
                  {#if configDraft.eventType === 'workflow_completed'}
                    <section class="nm-sec">
                      <div class="nm-sec-hd">
                        <span class="sr-label-tight">SOURCE CANVAS</span>
                        <span class="nm-sec-meta">leave empty to fire on ANY workflow</span>
                      </div>
                      <select
                        class="nm-text-input"
                        value={(configDraft.sourceWorkflowId as string) ?? ''}
                        onchange={(e) =>
                          setConfigField(
                            'sourceWorkflowId',
                            (e.target as HTMLSelectElement).value,
                          )}
                      >
                        <option value="">any canvas</option>
                        {#each peerCanvases as c (c.workflowId)}
                          <option value={c.workflowId}>{c.title} · /{c.slug}</option>
                        {/each}
                      </select>
                    </section>
                  {/if}
                {/if}

                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">ENABLED</span>
                  </div>
                  <label class="nm-toggle">
                    <input
                      type="checkbox"
                      checked={configDraft.enabled !== false}
                      onchange={(e) =>
                        setConfigField('enabled', (e.target as HTMLInputElement).checked)}
                    />
                    <span>Fire on matching signal</span>
                  </label>
                </section>
              {:else if menuNode.kind === 'chat'}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">MODEL</span>
                    <span class="nm-sec-meta"
                      >conversation-pinned; applies on standalone chat runs</span
                    >
                  </div>
                  <select
                    class="nm-text-input"
                    value={(configDraft.model as string) ?? ''}
                    onchange={(e) =>
                      setConfigField('model', (e.target as HTMLSelectElement).value)}
                  >
                    <option value="">{modelCatalogue.defaultLabel}</option>
                    {#if modelCatalogue.glm.length}
                      <optgroup label="GLM · Z.AI">
                        {#each modelCatalogue.glm as opt (opt.value)}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </optgroup>
                    {/if}
                    {#if modelCatalogue.openrouter.length}
                      <optgroup label="OpenRouter ({modelCatalogue.openrouter.length})">
                        {#each modelCatalogue.openrouter as opt (opt.value)}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </optgroup>
                    {/if}
                    {#if configDraft.model && !knownModelValues.has(configDraft.model as string)}
                      <optgroup label="Custom">
                        <option value={configDraft.model as string}>{configDraft.model}</option>
                      </optgroup>
                    {/if}
                  </select>
                </section>

                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">INTEL KNOWLEDGE GRAPH</span>
                    <span class="nm-sec-meta"
                      >vector-search your notes & entities into the system prompt</span
                    >
                  </div>
                  <label class="nm-toggle">
                    <input
                      type="checkbox"
                      checked={configDraft.useIntelContext !== false}
                      onchange={(e) =>
                        setConfigField('useIntelContext', (e.target as HTMLInputElement).checked)}
                    />
                    <span>Inject intel context per turn</span>
                  </label>
                </section>

                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">BEHAVIOUR</span>
                  </div>
                  <div class="chat-explainer">
                    <p>
                      Standalone (no outgoing edges): runs the full jkai chat loop — dynamic
                      system prompt, memory, intel, and tool calling. A lone chat node is a
                      usable AI workspace.
                    </p>
                    <p>
                      Wired downstream: acts as a trigger. The user message (and the chat
                      node's conversation id) are piped into the graph; the LLM work happens
                      in downstream nodes.
                    </p>
                  </div>
                </section>
              {:else if menuNode.kind === 'llm' && !SPECIALISED_PANEL_TYPES.has(menuNode.type)}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">USER PROMPT</span>
                    <span class="nm-sec-meta">supports {'{{input.field}}'} templates</span>
                  </div>
                  <div class="nm-field">
                    <textarea
                      rows="4"
                      value={(configDraft.userPrompt as string) ?? ''}
                      oninput={(e) =>
                        setConfigField('userPrompt', (e.target as HTMLTextAreaElement).value)}
                      placeholder="What you want the LLM to do…"
                    ></textarea>
                  </div>
                </section>

                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">SYSTEM PROMPT</span>
                    <span class="nm-sec-meta">optional</span>
                  </div>
                  <div class="nm-field">
                    <textarea
                      rows="2"
                      value={(configDraft.systemPrompt as string) ?? ''}
                      oninput={(e) =>
                        setConfigField('systemPrompt', (e.target as HTMLTextAreaElement).value)}
                      placeholder="You are a helpful assistant…"
                    ></textarea>
                  </div>
                </section>

                <section class="nm-sec nm-sec-row">
                  <div class="nm-control">
                    <span class="sr-label-tight">MODEL</span>
                    <select
                      class="nm-text-input"
                      value={(configDraft.model as string) ?? ''}
                      onchange={(e) =>
                        setConfigField('model', (e.target as HTMLSelectElement).value)}
                    >
                      <option value="">{modelCatalogue.defaultLabel}</option>
                      {#if modelCatalogue.glm.length}
                        <optgroup label="GLM · Z.AI">
                          {#each modelCatalogue.glm as opt (opt.value)}
                            <option value={opt.value}>{opt.label}</option>
                          {/each}
                        </optgroup>
                      {/if}
                      {#if modelCatalogue.openrouter.length}
                        <optgroup
                          label="OpenRouter ({modelCatalogue.openrouter.length})"
                        >
                          {#each modelCatalogue.openrouter as opt (opt.value)}
                            <option value={opt.value}>{opt.label}</option>
                          {/each}
                        </optgroup>
                      {/if}
                      {#if configDraft.model && !knownModelValues.has(configDraft.model as string)}
                        <optgroup label="Custom">
                          <option value={configDraft.model as string}
                            >{configDraft.model}</option
                          >
                        </optgroup>
                      {/if}
                    </select>
                  </div>
                  <div class="nm-control">
                    <span class="sr-label-tight">TEMP</span>
                    <input
                      class="nm-text-input"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      value={(configDraft.temperature as number) ?? 0.7}
                      oninput={(e) =>
                        setConfigField(
                          'temperature',
                          parseFloat((e.target as HTMLInputElement).value),
                        )}
                    />
                  </div>
                  <div class="nm-control">
                    <span class="sr-label-tight">MAX TOK</span>
                    <input
                      class="nm-text-input"
                      type="number"
                      step="64"
                      min="1"
                      value={(configDraft.maxTokens as number) ?? 1024}
                      oninput={(e) =>
                        setConfigField(
                          'maxTokens',
                          parseInt((e.target as HTMLInputElement).value, 10),
                        )}
                    />
                  </div>
                </section>

                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">INPUT DATA</span>
                    <span class="nm-sec-meta">from ↑ upstream</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.inputData !== undefined}
                      <InspectorBody data={menuNode.inputData} />
                    {:else}
                      <pre class="ghost">// no run yet — press ▶ Run to pipe data</pre>
                    {/if}
                  </div>
                </section>

                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">OUTPUT DATA</span>
                    <span class="nm-sec-meta">pipes to ↓ downstream</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.status === 'running'}
                      <pre class="ghost">// running…</pre>
                    {:else if menuNode.outputData !== undefined}
                      <InspectorBody data={menuNode.outputData} />
                    {:else if menuNode.error}
                      <pre class="error-text">{menuNode.error}</pre>
                    {:else}
                      <pre class="ghost">// pending</pre>
                    {/if}
                  </div>
                </section>

                {#if menuNode.durationMs != null}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">LAST RUN</span>
                      <span class="nm-sec-meta"
                        >completed in {(menuNode.durationMs / 1000).toFixed(2)}s</span
                      >
                    </div>
                  </section>
                {/if}
              {:else if menuNode.kind === 'parse'}
                <section class="nm-sec nm-sec-row">
                  <div class="nm-control">
                    <span class="sr-label-tight">MODE</span>
                    <select
                      class="nm-text-input"
                      value={(configDraft.mode as string) ?? 'json'}
                      onchange={(e) =>
                        setConfigField('mode', (e.target as HTMLSelectElement).value)}
                    >
                      <option value="json">json</option>
                      <option value="regex">regex</option>
                    </select>
                  </div>
                  <div class="nm-control">
                    <span class="sr-label-tight">INPUT FIELD</span>
                    <input
                      class="nm-text-input"
                      type="text"
                      value={(configDraft.inputField as string) ?? 'response'}
                      oninput={(e) =>
                        setConfigField('inputField', (e.target as HTMLInputElement).value)}
                      placeholder="response"
                    />
                  </div>
                </section>
                {#if (configDraft.mode as string) === 'regex'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd"><span class="sr-label-tight">PATTERN</span></div>
                    <div class="nm-field">
                      <input
                        class="nm-text-input"
                        style:width="100%"
                        type="text"
                        value={(configDraft.pattern as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('pattern', (e.target as HTMLInputElement).value)}
                        placeholder="\\d+"
                      />
                    </div>
                  </section>
                {/if}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">INPUT DATA</span>
                    <span class="nm-sec-meta">from ↑ upstream</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.inputData !== undefined}
                      <InspectorBody data={menuNode.inputData} />
                    {:else}
                      <pre class="ghost">// no run yet</pre>
                    {/if}
                  </div>
                </section>
                <!-- Last run: always shown so the user gets a clear signal
                     whether the node ran, completed, failed, or never executed
                     — even when outputData is undefined (e.g. node that doesn't
                     produce a payload). -->
                <section class="nm-sec nm-sec-lastrun">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">LAST RUN</span>
                    {#if menuNode.status === 'failed'}
                      <span class="chip chip-pill chip-failed">FAILED</span>
                    {:else if menuNode.status === 'running'}
                      <span class="chip chip-pill chip-accent chip-live">RUNNING</span>
                    {:else if menuNode.status === 'ok'}
                      <span class="chip chip-pill chip-ok">OK</span>
                    {:else}
                      <span class="chip chip-pill">NEVER RUN</span>
                    {/if}
                  </div>
                  {#if menuNode.error}
                    <div class="nm-field nm-field-read">
                      <div class="sr-label-tight error" style="margin-bottom:4px;">ERROR</div>
                      <pre class="error-text">{menuNode.error}</pre>
                    </div>
                  {/if}
                  {#if menuNode.outputData !== undefined}
                    <div class="nm-field nm-field-read">
                      <div class="sr-label-tight" style="margin-bottom:4px;">OUTPUT</div>
                      <InspectorBody data={menuNode.outputData} />
                    </div>
                  {:else if !menuNode.error}
                    <div class="nm-field nm-field-read">
                      <pre class="ghost">// no output produced by the last run{menuNode.status === 'ok' ? ' (node completed without returning a payload)' : ''}</pre>
                    </div>
                  {/if}
                </section>
              {:else if menuNode.kind === 'input'}
                <section class="nm-sec">
                  <div class="nm-sec-hd"><span class="sr-label-tight">SOURCE</span></div>
                  <div class="nm-field">
                    <button class="nm-select" style:width="100%">Manual trigger (run button)</button>
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">OUTPUT DATA</span>
                    <span class="nm-sec-meta">pipes to ↓ downstream</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.outputData !== undefined}
                      <InspectorBody data={menuNode.outputData} />
                    {:else}
                      <pre class="ghost">// no run yet</pre>
                    {/if}
                  </div>
                </section>
              {:else if menuNode.kind === 'output'}
                {#if menuNode.type === 'transform'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">TRANSFORM EXPRESSION</span>
                      <span class="nm-sec-meta">optional · JS, `input` is the payload</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="3"
                        value={(configDraft.expression as string) ?? ''}
                        oninput={(e) =>
                          setConfigField(
                            'expression',
                            (e.target as HTMLTextAreaElement).value,
                          )}
                        placeholder={'return { reply: input.response }'}
                      ></textarea>
                    </div>
                  </section>
                {/if}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">INPUT DATA</span>
                    <span class="nm-sec-meta">from ↑ upstream</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.inputData !== undefined}
                      <InspectorBody data={menuNode.inputData} />
                    {:else}
                      <pre class="ghost">// pending</pre>
                    {/if}
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd"><span class="sr-label-tight">OUTPUT DATA</span></div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.outputData !== undefined}
                      <InspectorBody data={menuNode.outputData} />
                    {:else}
                      <pre class="ghost">// pending</pre>
                    {/if}
                  </div>
                </section>
              {:else if menuNode.kind === 'intel'}
                {#if menuNode.type === 'intel-query'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">QUERY</span>
                      <span class="nm-sec-meta">supports {'{{input.field}}'} templates</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="2"
                        value={(configDraft.query as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('query', (e.target as HTMLTextAreaElement).value)}
                        placeholder={'{{input.message}}'}
                      ></textarea>
                    </div>
                  </section>
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">LAST RESULT</span>
                      <span class="nm-sec-meta">intelContext appended to downstream input</span>
                    </div>
                    <div class="nm-field nm-field-read">
                      {#if menuNode.outputData !== undefined}
                        <InspectorBody data={menuNode.outputData} />
                      {:else}
                        <pre class="ghost">// no run yet</pre>
                      {/if}
                    </div>
                  </section>
                {:else if menuNode.type === 'quick-answer'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">TOPIC</span>
                      <span class="nm-sec-meta">supports {'{{input.field}}'} / {'{{item.*}}'} templates</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="2"
                        value={(configDraft.topic as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('topic', (e.target as HTMLTextAreaElement).value)}
                        placeholder={'What is the impact of …'}
                      ></textarea>
                    </div>
                  </section>
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">GOALS</span>
                      <span class="nm-sec-meta">optional — one per line</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="3"
                        value={Array.isArray(configDraft.goals) ? (configDraft.goals as string[]).join('\n') : ((configDraft.goals as string) ?? '')}
                        oninput={(e) => {
                          const lines = (e.target as HTMLTextAreaElement).value.split('\n').map((l) => l.trim()).filter(Boolean);
                          setConfigField('goals', lines);
                        }}
                        placeholder="Understand key players, risks, opportunities"
                      ></textarea>
                    </div>
                  </section>
                  <section class="nm-sec nm-sec-row">
                    <div class="nm-control">
                      <span class="sr-label-tight">MAX WAIT (MS)</span>
                      <input
                        class="nm-text-input"
                        type="number"
                        value={(configDraft.maxWaitMs as number) ?? 180000}
                        oninput={(e) =>
                          setConfigField('maxWaitMs', Number((e.target as HTMLInputElement).value) || 180000)}
                      />
                    </div>
                    <div class="nm-control">
                      <span class="sr-label-tight">POLL INTERVAL</span>
                      <input
                        class="nm-text-input"
                        type="number"
                        value={(configDraft.pollIntervalMs as number) ?? 1500}
                        oninput={(e) =>
                          setConfigField('pollIntervalMs', Number((e.target as HTMLInputElement).value) || 1500)}
                      />
                    </div>
                  </section>
                {:else if menuNode.type === 'deep-research'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">TOPIC</span>
                      <span class="nm-sec-meta">supports {'{{input.field}}'} / {'{{item.*}}'} templates</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="2"
                        value={(configDraft.topic as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('topic', (e.target as HTMLTextAreaElement).value)}
                        placeholder={'{{item.title}}'}
                      ></textarea>
                    </div>
                  </section>
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">GOALS</span>
                      <span class="nm-sec-meta">optional — free text</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="3"
                        value={(configDraft.goals as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('goals', (e.target as HTMLTextAreaElement).value)}
                        placeholder="Key advances, practical applications"
                      ></textarea>
                    </div>
                  </section>
                  <section class="nm-sec nm-sec-row">
                    <div class="nm-control">
                      <span class="sr-label-tight">DEPTH</span>
                      <select
                        class="nm-text-input"
                        value={(configDraft.depth as string) ?? 'medium'}
                        onchange={(e) =>
                          setConfigField('depth', (e.target as HTMLSelectElement).value)}
                      >
                        <option value="shallow">shallow</option>
                        <option value="medium">medium</option>
                        <option value="deep">deep</option>
                      </select>
                    </div>
                    <div class="nm-control">
                      <span class="sr-label-tight">MAX WAIT (MS)</span>
                      <input
                        class="nm-text-input"
                        type="number"
                        value={(configDraft.maxWaitMs as number) ?? 900000}
                        oninput={(e) =>
                          setConfigField('maxWaitMs', Number((e.target as HTMLInputElement).value) || 900000)}
                      />
                    </div>
                  </section>
                {:else if menuNode.type === 'intel-write'}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">CONTENT</span>
                      <span class="nm-sec-meta">text to add to intel</span>
                    </div>
                    <div class="nm-field">
                      <textarea
                        rows="3"
                        value={(configDraft.content as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('content', (e.target as HTMLTextAreaElement).value)}
                        placeholder={'{{input.summary}}'}
                      ></textarea>
                    </div>
                  </section>
                  <section class="nm-sec nm-sec-row">
                    <div class="nm-control">
                      <span class="sr-label-tight">TITLE</span>
                      <input
                        class="nm-text-input"
                        type="text"
                        value={(configDraft.title as string) ?? ''}
                        oninput={(e) =>
                          setConfigField('title', (e.target as HTMLInputElement).value)}
                        placeholder="optional"
                      />
                    </div>
                    <div class="nm-control">
                      <span class="sr-label-tight">FORMAT</span>
                      <select
                        class="nm-text-input"
                        value={(configDraft.format as string) ?? 'summary'}
                        onchange={(e) =>
                          setConfigField('format', (e.target as HTMLSelectElement).value)}
                      >
                        <option value="summary">summary</option>
                        <option value="text">text</option>
                        <option value="email">email</option>
                        <option value="meeting_transcript">meeting_transcript</option>
                      </select>
                    </div>
                  </section>
                {/if}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">INPUT DATA</span>
                    <span class="nm-sec-meta">from ↑ upstream</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.inputData !== undefined}
                      <InspectorBody data={menuNode.inputData} />
                    {:else}
                      <pre class="ghost">// no run yet</pre>
                    {/if}
                  </div>
                </section>
              {:else if menuNode.kind === 'intelligence' && menuNode.type === 'research-result'}
                {@const rrEngine = ((configDraft.engine as string) ?? 'deep') as 'deep' | 'quick'}
                {@const rrSessions = rrEngine === 'deep' ? deepSessions : quickSessions}
                <section class="nm-sec nm-sec-row">
                  <div class="nm-control">
                    <span class="sr-label-tight">ENGINE</span>
                    <select
                      class="nm-text-input"
                      value={(configDraft.engine as string) ?? 'deep'}
                      onchange={(e) => {
                        const engine = (e.target as HTMLSelectElement).value as 'deep' | 'quick';
                        setConfigField('engine', engine);
                        loadSessionsFor(engine);
                      }}
                    >
                      <option value="deep">Deep research</option>
                      <option value="quick">Quick research</option>
                    </select>
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">PICK EXISTING SESSION</span>
                    <span class="nm-sec-meta">most recent first</span>
                  </div>
                  <select
                    class="nm-text-input"
                    value={(configDraft.sessionId as string) ?? ''}
                    onchange={(e) => {
                      const id = (e.target as HTMLSelectElement).value;
                      setConfigField('sessionId', id);
                      const found = rrSessions.find((s) => s.id === id);
                      if (found) setConfigField('topic', found.topic);
                    }}
                  >
                    <option value="">— select a session —</option>
                    {#each rrSessions as s (s.id)}
                      <option value={s.id}>{s.topic} · {s.status}</option>
                    {/each}
                  </select>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">SESSION ID</span>
                    <span class="nm-sec-meta">or template from upstream · {'{{input.researchSessionId}}'}</span>
                  </div>
                  <div class="nm-field">
                    <textarea
                      rows="1"
                      value={(configDraft.sessionId as string) ?? ''}
                      oninput={(e) =>
                        setConfigField('sessionId', (e.target as HTMLTextAreaElement).value)}
                      placeholder={'{{input.researchSessionId}}'}
                    ></textarea>
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">TOPIC</span>
                    <span class="nm-sec-meta">shown in header</span>
                  </div>
                  <div class="nm-field">
                    <input
                      class="nm-text-input"
                      type="text"
                      value={(configDraft.topic as string) ?? ''}
                      oninput={(e) =>
                        setConfigField('topic', (e.target as HTMLInputElement).value)}
                    />
                  </div>
                </section>
              {:else if menuNode.kind === 'intelligence' && menuNode.type === 'intelligence'}
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">QUERY</span>
                    <span class="nm-sec-meta">edit inline on the node for live preview</span>
                  </div>
                  <div class="nm-field">
                    <textarea
                      rows="2"
                      value={(configDraft.query as string) ?? ''}
                      oninput={(e) =>
                        setConfigField('query', (e.target as HTMLTextAreaElement).value)}
                      placeholder="new projects"
                    ></textarea>
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">CURRENT FOCUS</span>
                    <span class="nm-sec-meta">from last run</span>
                  </div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.outputData !== undefined}
                      <InspectorBody data={(menuNode.outputData as Record<string, unknown> | undefined)?.intelFocus ?? menuNode.outputData} />
                    {:else}
                      <pre class="ghost">// no run yet</pre>
                    {/if}
                  </div>
                </section>
              {/if}

              <!-- Schema-driven config panel: specialised → BasicConfigForm (basicConfig) → JSON fallback.
                   Skipped for kinds that already have a hand-crafted inline editor above. -->
              {#if menuShowsConfigPanel(menuNode.type, menuNode.kind)}
                {@const menuDefinition = getDefinition(menuNode.type)}
                {@const Panel = getPanel(menuNode.type, menuDefinition)}
                {@const _upstreamFields = computeUpstreamFields(
                  menuNode.id,
                  (canvas.nodes ?? []) as Array<{ id: string; outputData?: unknown }>,
                  (canvas.edges ?? []).map((e) => ({ sourceNodeId: e.from, targetNodeId: e.to })),
                )}
                <div class="menu-config-section">
                  <Panel
                    config={configDraft}
                    onChange={(cfg) => { configDraft = cfg; configDirty = true; }}
                    definition={menuDefinition}
                    nodeId={menuNode.id}
                    workflowId={canvas.workflowId}
                    upstreamFields={_upstreamFields}
                  />
                </div>
              {/if}

              <!-- Universal "Advanced — raw JSON" disclosure available on every
                   node, regardless of which editor renders above. The structured
                   editors are the primary surface; this is the power-user
                   escape hatch. -->
              <details class="nm-raw-json">
                <summary><span class="sr-label-tight">Advanced — raw JSON config</span></summary>
                <textarea
                  class="nm-raw-textarea"
                  rows="10"
                  spellcheck="false"
                  value={JSON.stringify(configDraft, null, 2)}
                  oninput={(e) => {
                    const txt = (e.currentTarget as HTMLTextAreaElement).value;
                    try {
                      const next = JSON.parse(txt);
                      if (next && typeof next === 'object') {
                        configDraft = next as Record<string, unknown>;
                        configDirty = true;
                      }
                    } catch {
                      /* invalid JSON — keep typing, don't apply */
                    }
                  }}
                ></textarea>
              </details>
            </div>

            <!-- Actions footer -->
            <div class="nm-foot">
              {#if actionError}
                <div class="nm-action-err">⚠ {actionError}</div>
              {/if}
              <div class="nm-actions">
                <button
                  class="nm-act"
                  onclick={actReRun}
                  disabled={runMeta.state === 'running'}
                  title="Run ONLY this node (use the toolbar Run for the whole canvas)"
                >
                  <span class="nm-act-ic">↻</span>Run this node
                </button>
                <button class="nm-act" onclick={actBranch} title="Clone this node">
                  <span class="nm-act-ic">⎇</span>Branch
                </button>
                <button
                  class="nm-act"
                  onclick={() => (pipePickerOpen = !pipePickerOpen)}
                  title="Add an edge to another node"
                >
                  <span class="nm-act-ic">↘</span>Pipe to…
                </button>
                <button
                  class="nm-act"
                  disabled
                  title="Chat integration coming in phase E"
                >
                  <span class="nm-act-ic">◉</span>Pin to chat
                </button>
                <button
                  class="nm-act"
                  onclick={actDetach}
                  title="Remove all edges to/from this node"
                >
                  <span class="nm-act-ic">⊘</span>Detach
                </button>
                <button
                  class="nm-act is-danger"
                  onclick={actDelete}
                  title="Delete this node and its edges"
                >
                  <span class="nm-act-ic">×</span>Delete
                </button>
              </div>

              {#if pipePickerOpen}
                <div class="pipe-picker">
                  <div class="pipe-picker-hd">
                    <span class="sr-label-tight">PIPE TO…</span>
                    <button
                      class="p-icon-btn"
                      onclick={() => (pipePickerOpen = false)}
                      aria-label="Cancel">✕</button
                    >
                  </div>
                  <div class="pipe-picker-list">
                    {#each viewNodes.filter((n) => n.id !== menuNode.id) as target (target.id)}
                      <button class="nm-pin pipe-target" onclick={() => pipeTo(target.id)}>
                        <span class="nm-pin-kind-bar" data-kind={target.kind}></span>
                        <span>{target.name}</span>
                      </button>
                    {/each}
                    {#if viewNodes.length <= 1}
                      <span class="nm-ctx-empty">no other nodes</span>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Legend -->
    <div class="legend">
      {#each [['input', 'var(--text-muted)'], ['llm', 'var(--accent)'], ['parse', '#c44'], ['output', 'var(--text-primary)'], ['intel', 'var(--accent)']] as [k, c]}
        <span class="legend-item">
          <span class="legend-swatch" style:background={c}></span>{k}
        </span>
      {/each}
    </div>

    <!-- Minimap -->
    <div class="minimap">
      <div class="minimap-head">
        <span>MINIMAP</span><span>{zoomPct}%</span>
      </div>
      <div class="minimap-body">
        {#if minimap}
          {#each viewNodes as n (n.id + '-m')}
            <div
              class="minimap-node"
              class:minimap-node-chat={n.kind === 'chat'}
              style:left="{minimap.offsetX + (n.x - minimap.minX) * minimap.scale}px"
              style:top="{minimap.offsetY + (n.y - minimap.minY) * minimap.scale}px"
              style:width="{Math.max(2, nodeW(n) * minimap.scale)}px"
              style:height="{Math.max(2, nodeH(n) * minimap.scale)}px"
              style:background={n.kind === 'chat' ? 'var(--text-primary)' : KIND_COLOR[n.kind]}
            ></div>
          {/each}
          <div
            class="minimap-frame"
            style:left="{minimap.frame.x}px"
            style:top="{minimap.frame.y}px"
            style:width="{minimap.frame.w}px"
            style:height="{minimap.frame.h}px"
          ></div>
        {/if}
      </div>
    </div>
  </div>
  </div>
</div>

<NodePalette
  open={paletteOpen}
  anchor={paletteAnchor}
  mode={paletteMode}
  canvasNodes={canvas?.nodes ?? []}
  onPick={onPalettePick}
  onClose={closePalette}
/>

{#if activeInteraction}
  <InteractiveStepModal
    interaction={activeInteraction}
    onComplete={() => {
      activeInteraction = null;
      interactions = [];
      invalidateAll();
    }}
    onClose={() => { activeInteraction = null; }}
  />
{/if}

{#if runSummary}
  <div
    id="run-summary-root"
    class="run-summary-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="run-summary-title"
    onclick={closeRunSummary}
    onkeydown={(e) => { if (e.key === 'Escape') closeRunSummary(); }}
  >
    <div class="run-summary-card" onclick={(e) => e.stopPropagation()} role="document">
      <div class="run-summary-head">
        <span class="run-summary-icon run-summary-icon-{runSummary.state}" aria-hidden="true">
          {#if runSummary.state === 'completed'}✓
          {:else if runSummary.state === 'completed_with_errors'}⚠
          {:else}✕
          {/if}
        </span>
        <div class="run-summary-title" id="run-summary-title">
          {#if runSummary.state === 'completed'}Run completed
          {:else if runSummary.state === 'completed_with_errors'}Run completed with errors
          {:else}Run failed
          {/if}
        </div>
        <button
          class="run-summary-close"
          onclick={closeRunSummary}
          data-close-run-summary
          aria-label="Close"
        >✕</button>
      </div>

      <div class="run-summary-stats">
        <div class="run-summary-stat">
          <span class="run-summary-stat-label">Duration</span>
          <span class="run-summary-stat-value">{formatDuration(runSummary.durationMs)}</span>
        </div>
        <div class="run-summary-stat">
          <span class="run-summary-stat-label">Nodes</span>
          <span class="run-summary-stat-value">
            {runSummary.nodeCounts.completed}/{runSummary.nodeCounts.ranTotal} completed
            {#if runSummary.nodeCounts.failed > 0}
              <span class="run-summary-failed"> · {runSummary.nodeCounts.failed} failed</span>
            {/if}
            {#if runSummary.nodeCounts.skipped > 0}
              <span class="run-summary-skipped"> · {runSummary.nodeCounts.skipped} skipped</span>
            {/if}
          </span>
        </div>
        <div class="run-summary-stat">
          <span class="run-summary-stat-label">Tools used</span>
          <span class="run-summary-stat-value">{runSummary.toolCount}</span>
        </div>
      </div>

      {#if runSummary.error}
        <div class="run-summary-section">
          <div class="run-summary-section-title">Error</div>
          <pre class="run-summary-error">{runSummary.error}</pre>
        </div>
      {/if}

      <div class="run-summary-section">
        <div class="run-summary-section-title">In plain English</div>
        {#if runSummary.plainState === 'loading'}
          <div class="run-summary-plain-loading">Summarising…</div>
        {:else if runSummary.plainState === 'failed'}
          <div class="run-summary-plain-failed">Couldn't generate a plain-English summary.</div>
        {:else if runSummary.plain?.overall}
          <div class="run-summary-plain-overall">{runSummary.plain.overall}</div>
        {/if}
      </div>

      <div class="run-summary-section">
        <div class="run-summary-section-title">Nodes</div>
        <ul class="run-summary-nodes">
          {#each runSummary.nodeList as n (n.id)}
            <li class="run-summary-node run-summary-node-{n.status}">
              <span class="run-summary-node-status" title={n.status}>
                {#if n.status === 'ok'}✓
                {:else if n.status === 'failed'}✕
                {:else if n.status === 'running'}◐
                {:else}·
                {/if}
              </span>
              <span class="run-summary-node-label">
                <span class="run-summary-node-name">{n.name}</span>
                <span class="run-summary-node-type">{n.type}</span>
              </span>
              {#if runSummary.plain?.perNode?.[n.id]}
                <div class="run-summary-node-plain">{runSummary.plain.perNode[n.id]}</div>
              {:else if runSummary.plainState === 'loading'}
                <div class="run-summary-node-plain ghost">Summarising…</div>
              {:else if n.error}
                <div class="run-summary-node-err-row">{n.error}</div>
              {:else if n.outputPreview}
                <div class="run-summary-node-out">{n.outputPreview}</div>
              {/if}
            </li>
          {/each}
        </ul>
      </div>

      {#if runSummary.tools.length > 0}
        <div class="run-summary-section">
          <div class="run-summary-section-title">Tool calls</div>
          <div class="run-summary-tools">
            {#each runSummary.tools as t, i (i)}
              <span class="run-summary-tool run-summary-tool-{t.status}">{t.tool}</span>
            {/each}
          </div>
        </div>
      {/if}

      {#if runSummary.reply}
        <div class="run-summary-section">
          <div class="run-summary-section-title">Assistant reply</div>
          <div class="run-summary-reply">{runSummary.reply}</div>
        </div>
      {/if}

      <div class="run-summary-actions">
        <button class="composer-pill" onclick={closeRunSummary} data-close-run-summary>Dismiss</button>
      </div>
    </div>
  </div>
{/if}

<svelte:window onkeydown={(e) => { if (runSummary && e.key === 'Escape') closeRunSummary(); }} />

<style>
  .page-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg);
    color: var(--text-primary);
  }
  .canvas-root {
    flex: 1;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg);
    color: var(--text-primary);
  }
  .canvas-head-meta {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .canvas-head-slug {
    color: var(--text-ghost);
  }
  .canvas-head-sep {
    color: var(--text-ghost);
    opacity: 0.5;
  }
  .canvas-head-running {
    color: var(--accent);
  }

  /* Toolbar */
  .hifi-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--divider);
    background: var(--bg-section);
    flex-shrink: 0;
  }
  .sr-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-muted);
  }
  .sr-sep {
    color: var(--text-ghost);
    opacity: 0.5;
    padding: 0 2px;
  }
  .mono11 {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .canvas-title {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
    vertical-align: bottom;
    flex-shrink: 1;
    min-width: 0;
  }
  .canvas-stats {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .mono10 {
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .primary {
    color: var(--text-primary);
  }
  .muted {
    color: var(--text-muted);
  }
  .toolbar-right {
    margin-left: auto;
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
  }
  .stop-btn {
    color: #c44;
    border-color: #c44;
  }
  .stop-btn:hover {
    color: #e66;
    border-color: #e66;
  }
  .sep-v {
    width: 1px;
    background: var(--divider);
    margin: 0 6px;
    height: 20px;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .composer-pill {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 4px 10px;
    color: var(--text-muted);
    background: var(--bg);
    border: 1px solid var(--card-border);
    cursor: default;
  }
  .composer-pill:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .run-input {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
    width: 240px;
    outline: none;
  }
  .run-input:focus {
    border-color: var(--accent);
  }
  .run-btn {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-tint-08);
    cursor: pointer;
    font-weight: 500;
  }
  .run-btn:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
  .run-err {
    font-family: var(--font-mono);
    font-size: 10px;
    color: #c44;
    padding: 0 6px;
  }
  .hifi-zoomctl {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 10px;
  }
  .hifi-zoomctl button {
    background: var(--bg);
    border: none;
    padding: 4px 8px;
    cursor: default;
    color: var(--text-primary);
    font-family: inherit;
    font-size: inherit;
  }
  :global(.hifi-zoomctl button + button) {
    border-left: 1px solid var(--card-border);
  }
  .hifi-zoomctl .zv {
    padding: 0 10px;
    color: var(--text-muted);
  }

  /* Viewport */
  .viewport {
    flex: 1;
    position: relative;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background-color: var(--bg);
    background-image:
      linear-gradient(var(--divider) 1px, transparent 1px),
      linear-gradient(90deg, var(--divider) 1px, transparent 1px);
    background-size:
      var(--grid-cell, 32px) var(--grid-cell, 32px),
      var(--grid-cell, 32px) var(--grid-cell, 32px);
    background-position:
      var(--grid-offset-x, 0) var(--grid-offset-y, 0),
      var(--grid-offset-x, 0) var(--grid-offset-y, 0);
  }
  .viewport.panning {
    cursor: grabbing;
  }

  /* Chat card */
  /* ——— Chat node (in-graph) ——— */
  .chat-node {
    position: absolute;
    background: var(--bg);
    border: 1.5px solid var(--text-primary);
    display: flex;
    flex-direction: column;
    user-select: none;
    overflow: hidden;
  }
  .chat-node-resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    background: linear-gradient(
      135deg,
      transparent 0,
      transparent 42%,
      var(--text-ghost) 42%,
      var(--text-ghost) 50%,
      transparent 50%,
      transparent 68%,
      var(--text-ghost) 68%,
      var(--text-ghost) 76%,
      transparent 76%
    );
    opacity: 0.7;
    z-index: 3;
  }
  .chat-node-resize:hover {
    opacity: 1;
  }
  .chat-node.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chat-node.active {
    border-color: var(--accent);
  }
  .chat-node-hdr {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--text-primary);
    color: var(--bg);
    cursor: grab;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .chat-node-hdr:active {
    cursor: grabbing;
  }
  .chat-node-bar {
    display: inline-block;
    width: 3px;
    height: 12px;
    background: var(--accent);
  }
  .chat-node-title {
    color: var(--bg);
  }
  .chat-node-label {
    color: rgba(237, 228, 212, 0.7);
    text-transform: none;
    letter-spacing: 0.05em;
  }
  .chat-node-count {
    margin-left: auto;
    color: rgba(237, 228, 212, 0.55);
    font-size: 9px;
  }
  .chat-node-working {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 6px;
    padding: 2px 7px 2px 8px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: lowercase;
    color: rgba(170, 255, 210, 0.95);
    background: rgba(64, 200, 140, 0.08);
    border: 1px solid rgba(170, 255, 210, 0.45);
    border-radius: 999px;
    cursor: pointer;
    max-width: 180px;
    overflow: hidden;
  }
  .chat-node-working:hover {
    background: rgba(64, 200, 140, 0.18);
    border-color: rgba(170, 255, 210, 0.75);
  }
  .chat-node-working-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(120, 255, 180);
    box-shadow: 0 0 6px rgba(120, 255, 180, 0.8);
    animation: chat-working-pulse 1.1s ease-in-out infinite;
    flex: 0 0 auto;
  }
  .chat-node-working-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chat-node-working-count {
    padding: 0 4px;
    border-radius: 4px;
    background: rgba(170, 255, 210, 0.18);
    color: rgba(230, 255, 240, 0.95);
    font-size: 8px;
  }
  .chat-node-working-chev {
    opacity: 0.7;
    font-size: 10px;
  }
  @keyframes chat-working-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.35; transform: scale(0.85); }
  }
  .chat-node-act {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 2px 6px;
    margin-left: 4px;
    color: rgba(237, 228, 212, 0.75);
    background: transparent;
    border: 1px solid rgba(237, 228, 212, 0.2);
    cursor: pointer;
  }
  .chat-node-act:hover:not(:disabled) {
    color: var(--bg);
    border-color: rgba(237, 228, 212, 0.5);
  }
  .chat-node-act:disabled {
    opacity: 0.35;
    cursor: default;
  }
  .chat-node-act-danger:hover:not(:disabled) {
    color: #ffb0b0;
    border-color: rgba(255, 176, 176, 0.55);
  }
  .chat-node-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--text-primary);
    cursor: auto;
  }
  .chat-node-composer {
    border-top: 1px solid var(--divider);
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  /* ——— Inspector node ——— */
  .inspector-node {
    border-color: #567;
  }
  .inspector-node.is-selected {
    outline-color: #567;
  }
  .inspector-hdr {
    background: #2a3642;
    color: #dde4eb;
  }
  .inspector-bar {
    display: inline-block;
    width: 3px;
    height: 12px;
    background: #89a3c0;
  }
  .inspector-node .chat-node-title {
    color: #dde4eb;
  }
  .inspector-node .chat-node-label {
    color: rgba(221, 228, 235, 0.7);
    text-transform: none;
    letter-spacing: 0.05em;
  }
  .inspector-node .chat-node-count {
    color: rgba(221, 228, 235, 0.55);
    text-transform: uppercase;
  }
  .inspector-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 10px 12px;
    background: var(--bg);
    color: var(--text-primary);
    cursor: auto;
  }
  .p-pane-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid var(--divider);
  }
  .p-pane-title {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--bg);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .p-pane-title .dot {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
    display: inline-block;
  }
  .p-pane-kicker {
    font-family: var(--font-mono);
    font-size: 10px;
    color: rgba(237, 228, 212, 0.6);
  }
  .chat-body {
    padding: 12px;
    font-size: 12px;
    line-height: 1.55;
    color: var(--text-primary);
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .chat-empty {
    padding: 24px 8px;
    text-align: center;
    color: var(--text-ghost);
  }
  .chat-msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .chat-msg.is-user {
    align-items: flex-start;
    text-align: left;
  }
  .chat-msg.is-user .msg-meta {
    justify-content: flex-start;
  }
  .chat-msg-body {
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 100%;
  }
  .chat-msg.is-user .chat-msg-body {
    background: var(--bg-section);
    border-left: 2px solid var(--accent);
    padding: 4px 10px;
    display: block;
    width: 100%;
  }
  .chat-msg-body.ghost {
    color: var(--text-ghost);
  }
  .chat-msg-pending .chat-msg-body {
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .chat-plain-stream {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.55;
  }
  .chat-cursor {
    display: inline-block;
    color: var(--accent);
    animation: chat-cursor-blink 1s steps(1) infinite;
    margin-left: 1px;
    font-weight: 400;
  }
  @keyframes chat-cursor-blink {
    50% {
      opacity: 0;
    }
  }
  .chat-tool-trace {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 6px;
    padding: 6px 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
  }
  .chat-tool-step {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .chat-tool-step.running {
    color: var(--text-primary);
  }
  .chat-tool-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--text-ghost);
    flex-shrink: 0;
  }
  .chat-tool-step.running .chat-tool-dot {
    background: var(--accent);
    animation: chat-tool-pulse 1s ease-in-out infinite;
  }
  @keyframes chat-tool-pulse {
    50% {
      opacity: 0.3;
    }
  }
  .chat-composer {
    border-top: 1px solid var(--divider);
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .chat-input {
    width: 100%;
    border: none;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-primary);
    resize: none;
    min-height: 48px;
    padding: 10px 12px;
    outline: none;
  }
  .chat-composer-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-top: 1px solid var(--divider);
  }
  .chat-composer-foot .run-btn {
    padding: 4px 14px;
    font-size: 10px;
  }
  .chat-locked-hint {
    padding: 12px 14px;
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.45;
    color: var(--text-ghost);
    background: rgba(26, 16, 8, 0.03);
    border-top: 1px dashed var(--divider);
  }
  .msg-meta {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
    display: flex;
    gap: 6px;
    align-items: baseline;
    margin-bottom: 6px;
  }
  .msg-meta b {
    color: var(--text-primary);
    font-weight: 500;
  }
  .cite {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    background: var(--accent-tint-08);
    padding: 0 4px;
    margin-left: 2px;
    text-decoration: none;
  }
  .embed {
    margin: 8px 0 0;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .embed-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--divider);
  }
  .embed-body {
    padding: 8px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 2px 8px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
  }
  .chip-accent {
    color: var(--accent);
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  .chip-pill {
    border-radius: 100px;
  }
  .chip-live::before {
    content: '●';
    margin-right: 4px;
    color: var(--accent);
  }

  /* Graph */
  .graph {
    position: absolute;
    inset: 0;
  }
  .edges {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .edges .edge-hit {
    cursor: pointer;
  }
  /* Node */
  .wf-node {
    position: absolute;
    width: 148px;
    height: 52px;
    display: flex;
    align-items: center;
    padding: 0 12px 0 16px;
    background: var(--bg);
    border: 1.5px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
    transition: border-color 0.15s;
    white-space: nowrap;
    overflow: hidden;
  }
  .wf-node::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--text-ghost);
  }
  .wf-node[data-kind='input']::before {
    background: var(--text-muted);
  }
  .wf-node[data-kind='llm']::before {
    background: var(--accent);
  }
  .wf-node[data-kind='parse']::before {
    background: #c44;
  }
  .wf-node[data-kind='output']::before {
    background: var(--text-primary);
  }
  .wf-node[data-kind='intel']::before {
    background: var(--accent);
  }
  .wf-node[data-kind='agent']::before {
    background: var(--text-primary);
  }
  .wf-node[data-kind='trigger']::before {
    background: #3a8a56;
  }

  /* ——— Trigger node variant ——— */
  .wf-node.is-trigger {
    width: 188px;
    padding: 0 12px 0 20px;
    border-radius: 0 32px 32px 0;
    border-color: #3a8a56;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .trig-icon {
    color: #3a8a56;
    font-size: 10px;
    flex-shrink: 0;
  }
  .trig-stack {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  .trig-summary {
    font-size: 9px;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Trigger menu — type-picker pills */
  .trig-pills {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .trig-pill {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 5px 12px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    cursor: pointer;
  }
  .trig-pill:hover {
    border-color: var(--text-muted);
    color: var(--text-primary);
  }
  .trig-pill.active {
    background: #3a8a56;
    border-color: #3a8a56;
    color: var(--bg);
  }
  .wf-node .wf-name {
    font-size: 12px;
    color: var(--text-primary);
    font-weight: 500;
    text-overflow: ellipsis;
    overflow: hidden;
  }
  .wf-node.active {
    border-color: var(--accent);
  }
  .wf-node.failed {
    border-color: #c44;
  }
  .wf-node.ok {
    border-color: #3a8a56;
  }
  /* Status wins over kind on the left bar */
  .wf-node.active::before {
    background: var(--accent);
  }
  .wf-node.ok::before {
    background: #3a8a56;
  }
  .wf-node.failed::before {
    background: #c44;
  }
  .wf-node.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wf-node.drop-target,
  .chat-node.drop-target {
    outline: 2px dashed var(--accent);
    outline-offset: 4px;
  }
  .node-handle {
    position: absolute;
    right: -7px;
    top: 50%;
    width: 12px;
    height: 12px;
    transform: translateY(-50%);
    background: var(--bg);
    border: 1.5px solid var(--text-ghost);
    border-radius: 50%;
    cursor: crosshair;
    z-index: 4;
    transition:
      border-color 0.12s,
      background 0.12s,
      transform 0.12s;
  }
  .node-handle:hover {
    border-color: var(--accent);
    background: var(--accent);
    transform: translateY(-50%) scale(1.15);
  }
  .node-handle-input {
    left: -7px;
    right: auto;
    cursor: default;
  }
  .node-handle-input:hover {
    background: var(--accent-dim, #3a5074);
  }
  .wf-node.is-incompatible,
  .chat-node.is-incompatible {
    outline: 2px dashed var(--danger, #c26060);
    outline-offset: 2px;
    animation: incompat-flash 0.4s ease-out;
  }
  @keyframes incompat-flash {
    0% { outline-color: rgba(194, 96, 96, 1); }
    100% { outline-color: rgba(194, 96, 96, 0.35); }
  }
  .wf-node:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wf-node {
    cursor: grab;
    user-select: none;
  }
  .wf-node:active {
    cursor: grabbing;
  }

  /* Status pip */
  .pip {
    position: absolute;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .pip.failed {
    color: #c44;
  }
  .pip.running {
    color: var(--accent);
  }

  /* Legend */
  .legend {
    position: absolute;
    left: 24px;
    bottom: 24px;
    display: flex;
    gap: 12px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 6px 10px;
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .legend-swatch {
    display: inline-block;
    width: 2px;
    height: 10px;
  }

  /* Minimap */
  .minimap {
    position: absolute;
    left: 16px;
    bottom: 60px;
    width: 160px;
    height: 96px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .minimap-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .minimap-body {
    position: relative;
    height: 62px;
    background: var(--bg-section);
    border: 1px solid var(--divider);
  }
  .minimap-node {
    position: absolute;
  }
  .minimap-frame {
    position: absolute;
    border: 1.5px solid var(--accent);
    background: var(--accent-tint-08, transparent);
    pointer-events: none;
    transition: left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear;
  }

  /* ——— Edge inspector ——— */
  .edge-inspector {
    position: absolute;
    width: 320px;
    background: var(--bg);
    border: 1.5px solid var(--accent);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.08);
    z-index: 38;
    display: flex;
    flex-direction: column;
  }
  .edge-inspector-hd {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--divider);
    background: var(--accent-tint-08);
  }
  .edge-inspector-route {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }
  .edge-pin {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    font-size: 10px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .edge-pin::before {
    content: '';
    display: inline-block;
    width: 2px;
    height: 10px;
    background: var(--text-ghost);
    margin-right: 5px;
    flex-shrink: 0;
  }
  .edge-pin[data-kind='llm']::before,
  .edge-pin[data-kind='intel']::before {
    background: var(--accent);
  }
  .edge-pin[data-kind='parse']::before {
    background: #c44;
  }
  .edge-pin[data-kind='output']::before,
  .edge-pin[data-kind='agent']::before {
    background: var(--text-primary);
  }
  .edge-pin[data-kind='input']::before {
    background: var(--text-muted);
  }
  .edge-arrow {
    color: var(--accent);
    font-size: 12px;
  }
  .edge-inspector-body {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 320px;
    overflow-y: auto;
  }

  /* ——— Inline node menu (phase C) ——— */
  /* .nm-inline, .nm-inline-hdr, .nm-inline-hdr .wf-name, .nm-inline-body
   * moved to $lib/styles/nm-tokens.css */
  .mono12 {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .nm-bar {
    display: inline-block;
    width: 3px;
    height: 14px;
    flex-shrink: 0;
  }

  .nm-hdr {
    padding: 12px 14px;
    border-bottom: 1px solid var(--divider);
    background: var(--bg);
    position: relative;
    flex-shrink: 0;
  }
  .nm-hdr-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .nm-hdr-kind {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
  }
  .nm-hdr-type {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
    font-weight: 600;
  }
  .nm-hdr-typecode {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-ghost);
    background: var(--bg-section);
    padding: 1px 5px;
    border-radius: 3px;
    margin-left: 4px;
  }
  .nm-hdr-id {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    margin-left: 4px;
  }
  .nm-hdr-name {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--text-primary);
    font-weight: 500;
  }
  .ms-auto {
    margin-left: auto;
  }
  .chip-failed {
    background: #c44;
    color: var(--bg);
    border-color: #c44;
  }
  .chip-ok {
    background: rgba(58, 138, 86, 0.15);
    color: #3a8a56;
    border-color: rgba(58, 138, 86, 0.45);
  }
  /* .nm-sec-lastrun .nm-sec-hd moved to $lib/styles/nm-tokens.css */

  .nm-ctx {
    display: grid;
    gap: 4px;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed var(--divider);
  }
  .nm-ctx-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .nm-ctx-lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
    width: 90px;
    flex-shrink: 0;
  }
  .nm-ctx-empty {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
  }
  .nm-pin {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 10px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 2px 7px;
    color: var(--text-primary);
    cursor: default;
  }
  .nm-pin::before {
    content: '';
    display: inline-block;
    width: 2px;
    height: 10px;
    background: var(--text-ghost);
    margin-right: 6px;
  }
  .nm-pin[data-kind='llm']::before {
    background: var(--accent);
  }
  .nm-pin[data-kind='parse']::before {
    background: #c44;
  }
  .nm-pin[data-kind='output']::before {
    background: var(--text-primary);
  }
  .nm-pin[data-kind='input']::before {
    background: var(--text-muted);
  }
  .nm-pin[data-kind='intel']::before {
    background: var(--accent);
  }
  .nm-pin[data-kind='agent']::before {
    background: var(--text-primary);
  }

  .nm-body {
    padding: 10px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .menu-config-section {
    border-top: 1px solid var(--divider);
    padding-top: 10px;
    overflow-y: auto;
  }
  .nm-action-preview {
    border: 1px solid var(--card-border);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .nm-action-hdr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .nm-action-kind {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    padding: 2px 6px;
    border-radius: 2px;
  }
  .nm-action-line {
    margin: 0;
    font-size: 13px;
    color: var(--text-primary);
    line-height: 1.4;
  }
  .nm-action-grid {
    display: grid;
    grid-template-columns: minmax(0, max-content) 1fr;
    gap: 4px 12px;
    margin: 4px 0 0 0;
    font-size: 11px;
  }
  .nm-action-grid dt {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    align-self: center;
  }
  .nm-action-grid dd {
    margin: 0;
    color: var(--text-primary);
    word-break: break-all;
  }
  .nm-raw-json {
    margin-top: 8px;
    border-top: 1px dashed var(--card-border);
    padding-top: 10px;
  }
  .nm-raw-json summary {
    cursor: pointer;
    list-style: none;
  }
  .nm-raw-json summary:hover { color: var(--text-primary); }
  .nm-raw-json[open] summary { color: var(--text-primary); }
  .nm-raw-textarea {
    width: 100%;
    margin-top: 8px;
    padding: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    box-sizing: border-box;
    outline: none;
    resize: vertical;
  }
  .nm-raw-textarea:focus { border-color: var(--text-muted); }
  /* .nm-sec, .nm-sec-error, .nm-sec-hd, .sr-label-tight, .sr-label-tight.error,
   * .nm-sec-meta moved to $lib/styles/nm-tokens.css */
  .nm-link {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--accent);
    margin-left: auto;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    text-decoration: none;
  }
  .nm-field {
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid rgba(26, 16, 8, 0.12);
    padding: 8px 10px;
  }
  .nm-field pre {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .nm-field pre.ghost {
    color: var(--text-ghost);
  }
  .nm-field pre.error-text {
    color: #c44;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 320px;
    overflow-y: auto;
    font-size: 11px;
    line-height: 1.45;
  }
  /* Run-info strip at the bottom of a wf-node */
  .wf-node-runinfo {
    position: absolute;
    left: 0;
    right: 0;
    bottom: -18px;
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    pointer-events: auto;
    cursor: pointer;
  }
  .wf-node-runinfo-error {
    color: #ffb4b4;
  }
  .wf-node-runinfo-error .wf-node-runinfo-label {
    background: #c44;
    color: #fff;
    padding: 1px 6px;
    border-radius: 3px;
    flex: 0 0 auto;
  }
  .wf-node-runinfo-error .wf-node-runinfo-msg {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9px;
    text-transform: none;
    letter-spacing: 0;
    opacity: 0.85;
  }
  .wf-node-runinfo-error:hover .wf-node-runinfo-msg {
    opacity: 1;
  }
  .wf-node-runinfo-ok .wf-node-runinfo-label {
    color: #3a8a56;
    background: rgba(58, 138, 86, 0.12);
    padding: 1px 6px;
    border-radius: 3px;
  }
  /* Last-run status square in the top-right corner of every wf-node */
  .wf-node-status-dot {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    pointer-events: none;
    z-index: 2;
  }
  .wf-node-status-green {
    background: #3a8a56;
    box-shadow: 0 0 4px rgba(58, 138, 86, 0.55);
  }
  .wf-node-status-amber {
    background: #d97706;
    box-shadow: 0 0 4px rgba(217, 119, 6, 0.55);
  }
  .wf-node-status-red {
    background: #c44;
    box-shadow: 0 0 4px rgba(204, 68, 68, 0.55);
  }
  .wf-node-status-blue {
    background: #1a73e8;
    box-shadow: 0 0 4px rgba(26, 115, 232, 0.55);
  }
  /* Live-state status pill — sits below the corner dot, shows
     "Running 1.2s" / "Done · 47 rows" / "Failed: …" while the canvas is
     receiving SSE node events. Shares the colour class with the dot but
     overrides background/text/shape so it reads as a label. */
  .wf-node-status-pill {
    position: absolute;
    top: 4px;
    right: 18px;
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 10px;
    font-family: var(--font-mono, monospace);
    line-height: 1.4;
    white-space: nowrap;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    pointer-events: none;
    z-index: 2;
  }
  .wf-node-status-pill.wf-node-status-blue   { background: #1a73e8; box-shadow: none; color: #fff; }
  .wf-node-status-pill.wf-node-status-green  { background: #1e8e3e; box-shadow: none; color: #fff; }
  .wf-node-status-pill.wf-node-status-red    { background: #c5221f; box-shadow: none; color: #fff; }
  .wf-node-status-pill.wf-node-status-amber  { background: #b06000; box-shadow: none; color: #fff; }
  /* Coloured outline by data-status on the wrapper — gives every node a
     distinct frame while a run is live so you can scan the canvas at a
     glance. Keyframe pulse on running so it reads as alive. */
  .wf-node[data-status='running'] {
    box-shadow: 0 0 0 2px #1a73e8;
    animation: wf-pulse 1.4s ease-in-out infinite;
  }
  .wf-node[data-status='ok']             { box-shadow: 0 0 0 2px #1e8e3e; }
  .wf-node[data-status='failed']         { box-shadow: 0 0 0 2px #c5221f; }
  .wf-node[data-status='awaiting_human'] { box-shadow: 0 0 0 2px #b06000; }
  @keyframes wf-pulse {
    0%, 100% { box-shadow: 0 0 0 2px #1a73e8; }
    50%      { box-shadow: 0 0 0 4px rgba(26, 115, 232, 0.45); }
  }
  /* Row-count tag at the midpoint of every edge whose source has emitted
     a rowCount this run. White pill so it stays legible over both stroke
     and the canvas background. */
  .edge-rowcount rect {
    fill: rgba(255, 255, 255, 0.92);
    stroke: rgba(0, 0, 0, 0.15);
    stroke-width: 1;
  }
  .edge-rowcount text {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    fill: #222;
    pointer-events: none;
  }
  .nm-field-read {
    background: var(--bg-section);
  }
  .nm-select {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 5px 9px;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    text-align: left;
  }
  .nm-select:hover {
    border-color: var(--accent);
  }
  .nm-slider {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nm-slider-track {
    flex: 1;
    height: 3px;
    background: var(--divider);
    position: relative;
  }
  .nm-slider-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--accent);
  }
  .nm-slider-track::after {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    width: 10px;
    height: 10px;
    background: var(--accent);
    transform: translate(-5px, -5px);
  }
  .nm-slider-val {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    width: 24px;
  }
  .nm-trace {
    background: var(--bg-section);
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    line-height: 1.8;
    color: var(--text-muted);
  }
  .nm-trace div {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .nm-trace div span:first-child {
    color: var(--accent);
  }
  .nm-trace-t {
    margin-left: auto;
    color: var(--text-ghost);
  }
  .nm-scope {
    display: grid;
    gap: 6px;
  }
  .nm-scope > div {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nm-scope-lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
    width: 54px;
    flex-shrink: 0;
  }
  .nm-chips {
    display: flex;
    gap: 6px;
  }
  .composer-pill.active {
    color: var(--accent);
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-08);
  }
  .composer-pill.ghost {
    color: var(--text-ghost);
  }

  .nm-foot {
    border-top: 1px solid var(--divider);
    padding: 8px 10px;
    background: var(--bg-section);
    flex-shrink: 0;
  }
  .nm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .nm-act {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    background: transparent;
    border: 1px solid transparent;
    padding: 5px 9px;
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
  }
  .nm-act:hover {
    background: var(--bg);
    border-color: var(--card-border);
  }
  .nm-act.is-danger:hover {
    color: #c44;
    border-color: rgba(196, 68, 68, 0.4);
  }
  .nm-act:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .nm-act:disabled:hover {
    background: transparent;
    border-color: transparent;
  }
  .nm-action-err {
    font-family: var(--font-mono);
    font-size: 10px;
    color: #c44;
    padding: 4px 6px;
    margin-bottom: 6px;
    background: rgba(196, 68, 68, 0.06);
    border: 1px solid rgba(196, 68, 68, 0.3);
  }
  .pipe-picker {
    margin-top: 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    padding: 8px;
  }
  .pipe-picker-hd {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }
  .pipe-picker-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .pipe-target {
    cursor: pointer;
    transition: border-color 0.12s;
  }
  .pipe-target:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .nm-pin-kind-bar {
    display: inline-block;
    width: 2px;
    height: 10px;
    background: var(--text-ghost);
    margin-right: 6px;
  }
  .nm-pin-kind-bar[data-kind='llm'],
  .nm-pin-kind-bar[data-kind='intel'] {
    background: var(--accent);
  }
  .nm-pin-kind-bar[data-kind='parse'] {
    background: #c44;
  }
  .nm-pin-kind-bar[data-kind='output'],
  .nm-pin-kind-bar[data-kind='agent'] {
    background: var(--text-primary);
  }
  .nm-pin-kind-bar[data-kind='input'] {
    background: var(--text-muted);
  }
  .nm-act-ic {
    font-family: var(--font-mono);
    color: var(--accent);
    width: 14px;
    text-align: center;
    font-size: 12px;
  }

  .nm-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .nm-toggle input {
    margin: 0;
    cursor: pointer;
  }
  .chat-explainer {
    font-size: 11px;
    line-height: 1.55;
    color: var(--text-muted);
  }
  .chat-explainer p {
    margin: 0 0 6px;
  }
  .chat-explainer p:last-child {
    margin-bottom: 0;
  }

  /* .nm-label-input (+:hover, :focus), .nm-save-btn (+:hover, :disabled),
   * .nm-text-input (+:focus) moved to $lib/styles/nm-tokens.css */
  .nm-save-err {
    color: #c44;
    font-size: 14px;
  }
  .nm-field textarea {
    width: 100%;
    border: none;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.5;
    color: var(--text-primary);
    resize: vertical;
    min-height: 40px;
    outline: none;
  }
  .nm-control {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }
  .nm-sec.nm-sec-row {
    flex-direction: row;
    gap: 8px;
  }

  .p-icon-btn {
    margin-left: auto;
    background: var(--bg);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 7px;
    cursor: pointer;
    line-height: 1;
  }
  .p-icon-btn:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  /* ——— Post-it note (inert) ——— */
  .postit-node {
    position: absolute;
    display: flex;
    flex-direction: column;
    border-radius: 3px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35), 0 1px 2px rgba(0, 0, 0, 0.2);
    transform: rotate(-0.4deg);
    transition: transform 80ms ease, box-shadow 80ms ease;
    overflow: hidden;
    z-index: 2;
  }
  .postit-node:hover { transform: rotate(0deg) translateY(-1px); }
  .postit-node.is-selected { outline: 2px solid rgba(255, 255, 255, 0.55); outline-offset: 2px; }
  .postit-node.flash { animation: wf-flash 300ms ease; }
  .postit-node[data-color="yellow"] { background: linear-gradient(180deg, #f9e87a 0%, #f4de5a 100%); color: #3a2c00; }
  .postit-node[data-color="pink"] { background: linear-gradient(180deg, #f7b6c9 0%, #f398b1 100%); color: #3a0012; }
  .postit-node[data-color="blue"] { background: linear-gradient(180deg, #a9d1f5 0%, #8fbeee 100%); color: #082543; }
  .postit-node[data-color="green"] { background: linear-gradient(180deg, #bfe5a6 0%, #a3d684 100%); color: #0f2e04; }
  .postit-hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    cursor: grab;
    user-select: none;
    background: rgba(0, 0, 0, 0.08);
  }
  .postit-hdr:active { cursor: grabbing; }
  .postit-pin {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.45);
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.35);
  }
  .postit-title { font-weight: 600; }
  .postit-name { opacity: 0.65; text-transform: none; font-size: 11px; letter-spacing: 0; }
  .postit-colors { margin-left: auto; display: flex; gap: 4px; }
  .postit-color-swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.25);
    cursor: pointer;
    padding: 0;
  }
  .postit-color-swatch[data-color="yellow"] { background: #f4de5a; }
  .postit-color-swatch[data-color="pink"] { background: #f398b1; }
  .postit-color-swatch[data-color="blue"] { background: #8fbeee; }
  .postit-color-swatch[data-color="green"] { background: #a3d684; }
  .postit-color-swatch.on { outline: 2px solid rgba(0, 0, 0, 0.55); outline-offset: 1px; }
  .postit-title-input {
    flex: 0 0 auto;
    width: 100%;
    margin: 0;
    padding: 4px 12px 2px;
    background: transparent;
    border: none;
    outline: none;
    color: inherit;
    font-family: 'Caveat', 'Marker Felt', 'Comic Sans MS', cursive;
    font-size: var(--postit-title-size, 18px);
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .postit-title-input::placeholder { color: rgba(0, 0, 0, 0.35); font-weight: 500; }
  .postit-body {
    flex: 1;
    min-height: 0;
    padding: 4px 14px 18px;
    background: transparent;
    border: none;
    outline: none;
    color: inherit;
    font-family: 'Caveat', 'Marker Felt', 'Comic Sans MS', cursive;
    font-size: var(--postit-text-size, 16px);
    line-height: 1.25;
    resize: none;
    overflow: auto;
    word-break: break-word;
  }
  .postit-body::placeholder { color: rgba(0, 0, 0, 0.4); }

  /* ——— Annotation box (inert) ———
     Dashed rectangle with an optional title label riding the top edge.
     Whole surface is the drag / select target. */
  .annotation-node {
    position: absolute;
    border: 2px dashed rgba(26, 16, 8, 0.38);
    border-radius: 6px;
    background: transparent;
    cursor: grab;
    z-index: 0;
  }
  .annotation-node:hover { border-color: rgba(26, 16, 8, 0.6); }
  .annotation-node:active { cursor: grabbing; }
  .annotation-node.is-selected {
    border-color: var(--accent);
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }
  .annotation-node.flash { animation: wf-flash 300ms ease; }
  .annotation-node .chat-node-resize {
    /* Empty body — grip needs to be clearly visible on hover/selection. */
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .annotation-node:hover .chat-node-resize,
  .annotation-node.is-selected .chat-node-resize { opacity: 0.9; }
  .annotation-title-input {
    position: absolute;
    top: -11px;
    left: 14px;
    max-width: calc(100% - 44px);
    padding: 1px 8px;
    background: var(--bg);
    border: none;
    outline: none;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .annotation-title-input.has-value,
  .annotation-node:hover .annotation-title-input,
  .annotation-node.is-selected .annotation-title-input,
  .annotation-title-input:focus { opacity: 1; }
  .annotation-title-input::placeholder {
    color: var(--text-ghost);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
  }

  /* ——— Stats node ——— */
  .stats-node {
    border-color: #7a6cd4;
  }
  .stats-node.is-selected {
    outline-color: #7a6cd4;
  }
  .stats-hdr {
    background: #2e2856;
    color: #e0dbf8;
  }
  .stats-bar {
    display: inline-block;
    width: 3px;
    height: 12px;
    background: #7a6cd4;
  }
  .stats-node .chat-node-title {
    color: #e0dbf8;
  }
  .stats-node .chat-node-label {
    color: rgba(224, 219, 248, 0.7);
    text-transform: none;
    letter-spacing: 0.05em;
  }
  .stats-node-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0;
    background: var(--bg);
    color: var(--text-primary);
    cursor: auto;
  }

  /* ——— Research-result node ——— */
  .research-result-node {
    border-color: #5dbea3;
  }
  .research-result-node.is-selected {
    outline-color: #5dbea3;
  }
  .research-result-hdr {
    background: #1a2e2a;
    color: #5dbea3;
  }
  .research-result-bar {
    width: 3px;
    align-self: stretch;
    background: #5dbea3;
  }

  /* ——— Webpage node ——— */
  .webpage-bar {
    display: inline-block;
    width: 4px;
    height: 1em;
    background: var(--accent, #7aa2f7);
    margin-right: 6px;
    border-radius: 1px;
  }
  .webpage-node-wrapper .chat-node-hdr {
    gap: 4px;
  }
  .webpage-node-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  /* ——— Builder nodes (chat / pi / view) ——— */
  .builder-bar {
    display: inline-block;
    width: 4px;
    height: 1em;
    background: #d28a3a;
    margin-right: 6px;
    border-radius: 1px;
  }
  .builder-node-wrapper .chat-node-hdr { gap: 4px; }
  .builder-node-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .builder-node-wrapper.active {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
  }
  .builder-node-wrapper.failed {
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--status-error, #c0392b) 35%, transparent);
  }

  /* Flash animation for scrollToNode */
  .wf-node.flash,
  .chat-node.flash {
    outline: 2px solid var(--accent, #7a6cd4);
    outline-offset: 3px;
    animation: node-flash 0.8s ease-out;
  }
  @keyframes node-flash {
    0% { outline-color: var(--accent, #7a6cd4); outline-offset: 0; }
    50% { outline-color: var(--accent, #7a6cd4); outline-offset: 6px; }
    100% { outline-color: transparent; outline-offset: 3px; }
  }

  /* ——— Awaiting-human state ——— */
  .wf-node.awaiting-human {
    border-color: #d97706;
    animation: awaiting-pulse 1.8s ease-in-out infinite;
  }
  .wf-node.awaiting-human::before {
    background: #d97706;
  }
  @keyframes awaiting-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.5); }
    50% { box-shadow: 0 0 0 5px rgba(217, 119, 6, 0); }
  }

  .awaiting-badge {
    /* Centred on the node (not hovering above, where it was clipping
       behind adjacent nodes). Sits on top of the node body via z-index. */
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #d97706;
    color: #000;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    padding: 5px 14px;
    border-radius: 20px;
    white-space: nowrap;
    cursor: pointer;
    border: 2px solid #fff;
    box-shadow: 0 2px 12px rgba(217, 119, 6, 0.75);
    z-index: 20;
    animation: badge-pulse 1.2s ease-in-out infinite;
  }
  .awaiting-badge:hover {
    background: #f59e0b;
    transform: translate(-50%, -50%) scale(1.06);
  }
  @keyframes badge-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.75; }
  }

  .run-summary-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(26, 16, 8, 0.32);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9000;
    padding: 24px;
  }
  .run-summary-card {
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--divider);
    border-radius: 6px;
    box-shadow: 0 24px 64px rgba(26, 16, 8, 0.18);
    width: min(560px, 100%);
    max-height: calc(100vh - 48px);
    overflow: auto;
    padding: 18px 20px 16px;
  }
  .run-summary-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .run-summary-icon {
    font-size: 18px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .run-summary-icon-completed { background: var(--accent-tint-08); color: var(--accent); }
  .run-summary-icon-completed_with_errors { background: var(--accent-tint-20); color: var(--accent); }
  .run-summary-icon-failed { background: rgba(196, 68, 68, 0.12); color: #c44; }
  .run-summary-title {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .run-summary-close {
    background: transparent;
    border: none;
    color: var(--text-ghost);
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .run-summary-close:hover { background: var(--bg-section); color: var(--text-primary); }
  .run-summary-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 14px;
  }
  .run-summary-stat {
    background: var(--bg-section);
    border-radius: 4px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .run-summary-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
  .run-summary-stat-value { font-size: 13px; font-weight: 500; color: var(--text-primary); }
  .run-summary-failed { color: #c44; }
  .run-summary-skipped { color: var(--text-muted); }
  .run-summary-plain-overall {
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-primary);
    background: var(--bg-section);
    border-radius: 4px;
    padding: 8px 10px;
  }
  .run-summary-plain-loading,
  .run-summary-plain-failed {
    font-size: 12px;
    color: var(--text-muted);
    font-style: italic;
  }
  .run-summary-node-plain {
    grid-column: 2 / -1;
    font-size: 12px;
    line-height: 1.4;
    color: var(--text-primary);
    margin-top: 4px;
  }
  .run-summary-node-plain.ghost { color: var(--text-muted); font-style: italic; }
  .run-summary-section { margin-top: 12px; }
  .run-summary-section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
  .run-summary-error {
    margin: 0;
    background: rgba(196, 68, 68, 0.08);
    border: 1px solid rgba(196, 68, 68, 0.35);
    color: #8a2a2a;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 8px 10px;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .run-summary-list {
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 12px;
    color: var(--text-primary);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .run-summary-nodes {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 240px;
    overflow: auto;
  }
  .run-summary-node {
    display: grid;
    grid-template-columns: 16px 1fr;
    gap: 6px 8px;
    align-items: start;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--bg-section);
    color: var(--text-primary);
    font-size: 12px;
  }
  .run-summary-node-completed .run-summary-node-status,
  .run-summary-node-ok .run-summary-node-status { color: var(--accent); }
  .run-summary-node-failed { background: rgba(196, 68, 68, 0.1); }
  .run-summary-node-failed .run-summary-node-status { color: #c44; }
  .run-summary-node-running .run-summary-node-status { color: var(--accent); }
  .run-summary-node-status {
    font-size: 13px;
    line-height: 1;
    text-align: center;
    margin-top: 1px;
  }
  .run-summary-node-label { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .run-summary-node-name { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .run-summary-node-type { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); }
  .run-summary-node-err-row {
    grid-column: 2;
    font-family: var(--font-mono);
    font-size: 11px;
    color: #8a2a2a;
    margin-top: 3px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .run-summary-node-out {
    grid-column: 2;
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    margin-top: 3px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .run-summary-node-err { color: var(--text-muted); }
  .run-summary-tools { display: flex; flex-wrap: wrap; gap: 4px; }
  .run-summary-tool {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-section);
    color: var(--text-primary);
  }
  .run-summary-tool-error { color: #8a2a2a; background: rgba(196, 68, 68, 0.12); }
  .run-summary-tool-running { color: var(--accent); background: var(--accent-tint-08); }
  .run-summary-reply {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-primary);
    background: var(--bg-section);
    padding: 10px 12px;
    border-radius: 4px;
    max-height: 240px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .run-summary-actions {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }
</style>
