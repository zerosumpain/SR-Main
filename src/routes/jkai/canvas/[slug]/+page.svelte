<script lang="ts">
  import type { CanvasNode, NodeStatus } from './+page.server';
  import { invalidateAll, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import ChatMarkdown from '$lib/canvas/ChatMarkdown.svelte';
  import InspectorBody from '$lib/canvas/InspectorBody.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TimeFilter from '$lib/canvas/stats/TimeFilter.svelte';
  import SummaryNode from '$lib/canvas/stats/SummaryNode.svelte';
  import TrendsNode from '$lib/canvas/stats/TrendsNode.svelte';
  import PerNodeNode from '$lib/canvas/stats/PerNodeNode.svelte';
  import IntelligenceNode from '$lib/canvas/intelligence/IntelligenceNode.svelte';
  import ResearchResultNode from '$lib/canvas/intelligence/ResearchResultNode.svelte';

  let { data } = $props();
  const canvas = $derived(data.canvas);

  const NODE_W = 148;
  const NODE_H = 52;
  const COL = [320, 540, 760, 980];
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const CHAT_NODE_W = 300;
  const CHAT_NODE_H = 360;

  // Live run state — overlays the server-provided canvas snapshot
  let liveStatus = $state<Record<string, NodeStatus>>({});
  let liveData = $state<
    Record<string, { inputData?: unknown; outputData?: unknown; error?: string | null }>
  >({});
  let activeRunId = $state<string | null>(null);
  let runMeta = $state<{ state: 'idle' | 'running' | 'completed' | 'failed'; error?: string }>({
    state: 'idle',
  });
  // Per-chat-node composer draft, scroll refs, size overrides, active-run target
  let chatDrafts = $state<Record<string, string>>({});
  let chatBodyEls: Record<string, HTMLDivElement | undefined> = {};
  // Live-streaming assistant reply per chat node (cleared when run settles)
  let streamingReplies = $state<Record<string, string>>({});
  let liveToolSteps = $state<Record<string, Array<{ tool: string; status: string }>>>(
    {},
  );
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
    const nw = Math.max(MIN_CHAT_W, Math.min(MAX_CHAT_W, Math.round((chatResize.startW + dx) / 20) * 20));
    const nh = Math.max(MIN_CHAT_H, Math.min(MAX_CHAT_H, Math.round((chatResize.startH + dy) / 20) * 20));
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
    return data.canvas.messagesByChat[chatNodeId] ?? [];
  }

  function scrollChatToBottom(chatNodeId: string) {
    const el = chatBodyEls[chatNodeId];
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }

  // Merged view of each node: base canvas row + any live overlay
  type ViewNode = CanvasNode;
  // Optimistic position override during drag — cleared after PATCH+invalidate
  let nodePositions = $state<Record<string, { x: number; y: number }>>({});

  const viewNodes = $derived<ViewNode[]>(
    canvas.nodes.map((n) => ({
      ...n,
      status: liveStatus[n.id] ?? n.status,
      inputData: liveData[n.id]?.inputData ?? n.inputData,
      outputData: liveData[n.id]?.outputData ?? n.outputData,
      error: liveData[n.id]?.error ?? n.error,
      x: nodePositions[n.id]?.x ?? n.x,
      y: nodePositions[n.id]?.y ?? n.y,
    })),
  );

  const byId: Record<string, ViewNode> = $derived(
    Object.fromEntries(viewNodes.map((n) => [n.id, n])),
  );

  const chatNodeIds = $derived(viewNodes.filter((n) => n.kind === 'chat').map((n) => n.id));
  const firstChatId = $derived(chatNodeIds[0] ?? null);

  const period = $derived(($page.url.searchParams.get('period') ?? '30d') as string);
  async function changePeriod(next: string) {
    const url = new URL($page.url);
    url.searchParams.set('period', next);
    await goto(url, { replaceState: true, keepFocus: true, noScroll: true });
  }
  const hasStatsNode = $derived(viewNodes.some((n) => n.kind === 'stats'));
  let refreshKey = $state(0);
  let flashNodeId = $state<string | null>(null);

  // Guard against orphan edges whose endpoints no longer exist
  const visibleEdges = $derived(canvas.edges.filter((e) => byId[e.from] && byId[e.to]));

  const activeEdgeIds = $derived(
    new Set(
      runMeta.state === 'running'
        ? visibleEdges.filter((e) => byId[e.to]?.status === 'running').map((e) => e.id)
        : [],
    ),
  );

  function nodeW(n: CanvasNode | { kind: string }) {
    if (n.kind === 'chat' || n.kind === 'inspector' || n.kind === 'stats' || n.kind === 'intelligence') return resizableSize(n as CanvasNode).w;
    if (n.kind === 'trigger') return 188;
    return NODE_W;
  }
  function nodeH(n: CanvasNode | { kind: string }) {
    if (n.kind === 'chat' || n.kind === 'inspector' || n.kind === 'stats' || n.kind === 'intelligence') return resizableSize(n as CanvasNode).h;
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
  };

  const peerCanvases = $derived(data.peerCanvases);

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

  // ——— Chat + run lifecycle ———
  async function sendMessageFrom(chatNodeId: string | null, text: string) {
    if (runMeta.state === 'running' || !text.trim()) return;
    liveStatus = {};
    liveData = {};
    runMeta = { state: 'running' };
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
      const { runId, chatNodeId: resolvedId } = await res.json();
      activeRunId = runId;
      pendingRun = { runId, chatNodeId: resolvedId ?? chatNodeId };
      subscribeToRun(runId);
      await invalidateAll();
      if (resolvedId) scrollChatToBottom(resolvedId);
    } catch (err) {
      runMeta = { state: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
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

  async function runCanvas() {
    // Toolbar Run — a pure workflow execution. No chat message is
    // inserted; the chat panels are untouched. If a chat node is
    // wired into the graph it still runs (getting empty input), but
    // the common case is: user detached chat to decouple, and Run
    // fires the real pipe from the trigger outward.
    if (runMeta.state === 'running') return;
    liveStatus = {};
    liveData = {};
    runMeta = { state: 'running' };
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

  function subscribeToRun(runId: string) {
    const es = new EventSource(`/api/workflows/${canvas.workflowId}/runs/${runId}/stream`);
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
    };
  }

  function handleEvent(evt: {
    type: string;
    nodeId?: string;
    data?: Record<string, unknown>;
    error?: string;
  }) {
    if (evt.type === 'node_started' && evt.nodeId) {
      liveStatus = { ...liveStatus, [evt.nodeId]: 'running' };
      if (evt.data && 'inputData' in evt.data) {
        liveData = {
          ...liveData,
          [evt.nodeId]: { ...liveData[evt.nodeId], inputData: evt.data.inputData },
        };
      }
    } else if (evt.type === 'node_completed' && evt.nodeId) {
      liveStatus = { ...liveStatus, [evt.nodeId]: 'ok' };
      if (evt.data) {
        liveData = {
          ...liveData,
          [evt.nodeId]: {
            ...liveData[evt.nodeId],
            inputData: (evt.data.inputData ?? liveData[evt.nodeId]?.inputData) as unknown,
            outputData: (evt.data.outputData ?? evt.data.output ?? undefined) as unknown,
          },
        };
      }
    } else if (evt.type === 'node_failed' && evt.nodeId) {
      liveStatus = { ...liveStatus, [evt.nodeId]: 'failed' };
      liveData = {
        ...liveData,
        [evt.nodeId]: {
          ...liveData[evt.nodeId],
          error: evt.error ?? (evt.data?.error as string) ?? null,
        },
      };
    } else if (evt.type === 'log' && evt.data) {
      const kind = evt.data.kind as string | undefined;
      const chatNodeId = (evt.data.chatNodeId as string | undefined) ?? null;
      if (kind === 'chat_stream' && chatNodeId) {
        const event = (evt.data.event as { type?: string; delta?: string }) ?? {};
        if (event.type === 'token' && typeof event.delta === 'string') {
          streamingReplies = {
            ...streamingReplies,
            [chatNodeId]: (streamingReplies[chatNodeId] ?? '') + event.delta,
          };
          if (pendingRun?.chatNodeId === chatNodeId) scrollChatToBottom(chatNodeId);
        }
      } else if (kind === 'chat_tool' && chatNodeId) {
        const step = evt.data.step as { tool?: string; status?: string } | undefined;
        if (step && step.tool) {
          const existing = liveToolSteps[chatNodeId] ?? [];
          const idx = existing.findIndex(
            (s) => s.tool === step.tool && s.status === 'running',
          );
          const next = existing.slice();
          if (idx >= 0 && step.status !== 'running') {
            next[idx] = { tool: step.tool, status: step.status ?? 'done' };
          } else {
            next.push({ tool: step.tool, status: step.status ?? 'running' });
          }
          liveToolSteps = { ...liveToolSteps, [chatNodeId]: next };
        }
      }
    } else if (evt.type === 'run_completed' || evt.type === 'run_completed_with_errors') {
      runMeta = { state: 'completed' };
      refreshKey += 1;
      finalizeChatReply();
    } else if (evt.type === 'run_failed') {
      runMeta = { state: 'failed', error: evt.error };
      refreshKey += 1;
      finalizeChatReply();
    }
  }

  async function finalizeChatReply() {
    const pending = pendingRun;
    pendingRun = null;
    if (pending) {
      try {
        await fetch(`/api/workflows/${canvas.workflowId}/chat/respond`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: pending.runId, chatNodeId: pending.chatNodeId }),
        });
      } catch {
        /* non-fatal */
      }
    }
    await invalidateAll();
    // Clear streaming state — the persisted message now owns the text.
    if (pending?.chatNodeId) {
      const next = { ...streamingReplies };
      delete next[pending.chatNodeId];
      streamingReplies = next;
      const nextTools = { ...liveToolSteps };
      delete nextTools[pending.chatNodeId];
      liveToolSteps = nextTools;
      scrollChatToBottom(pending.chatNodeId);
    }
  }

  // Phase B — pan/zoom/selection state
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  let selectedId = $state<string | null>(null);
  const zoomPct = $derived(Math.round(zoom * 100));

  let viewportEl: HTMLDivElement | undefined;
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
      '.wf-node, .chat-node, .minimap, .legend, .hifi-toolbar, .nm-inline, .edge-inspector, .add-node-menu, button, a, input, textarea, select',
    );
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    selectedId = null;
    menuForNodeId = null;
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
        '.chat-node-body, .chat-input, .nm-inline-body, .edge-inspector-body, .add-node-menu, .stats-node',
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
      // Click (no drag) → select
      selectedId = n.id;
    }
  }

  function pretty(v: unknown): string {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
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

  $effect(() => {
    if (menuNode) {
      configDraft = { ...menuNode.config };
      labelDraft = menuNode.name;
      configDirty = false;
      saveError = null;
    }
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
  let addNodeOpen = $state(false);
  let addNodeFilter = $state('');
  let addNodeCategory = $state<string | null>(null);
  let addNodeWrapEl: HTMLDivElement | undefined = $state(undefined);

  const nodeGroupsOrdered = $derived(() => {
    // Preserve the declared order from CANVAS_NODE_TYPES
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const t of nodeTypes) {
      if (!seen.has(t.group)) {
        seen.add(t.group);
        ordered.push(t.group);
      }
    }
    return ordered;
  });

  const nodeTypesByGroup = $derived(() => {
    const m = new Map<string, typeof nodeTypes>();
    for (const t of nodeTypes) {
      const arr = m.get(t.group) ?? [];
      arr.push(t);
      m.set(t.group, arr);
    }
    return m;
  });

  const nodeSearchResults = $derived(() => {
    const q = addNodeFilter.trim().toLowerCase();
    if (!q) return [];
    return nodeTypes.filter((t) =>
      `${t.label} ${t.type} ${t.description}`.toLowerCase().includes(q),
    );
  });

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

  let addError = $state<string | null>(null);

  async function addNode(opt: {
    type: string;
    label: string;
    defaultConfig: Record<string, unknown>;
  }) {
    addNodeOpen = false;
    addNodeFilter = '';
    addNodeCategory = null;
    addError = null;
    actionError = null;
    const position = viewportCenterInWorld();
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
      if (newId) selectedId = newId;
    } catch (err) {
      addError = err instanceof Error ? err.message : String(err);
      actionError = addError;
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
    closeMenu();
    await runCanvas();
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

  // ——— Drag-to-connect edges ———
  let edgeDrag = $state<{
    sourceId: string;
    pointerId: number;
    cursorX: number;
    cursorY: number;
    hoverTargetId: string | null;
  } | null>(null);

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
        actionError = null;
        try {
          const res = await fetch(`/api/workflows/${canvas.workflowId}/edges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourceNodeId: sourceId, targetNodeId: hoverTargetId }),
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
  }
  function closeEdgeInspector() {
    edgeInspectorFor = null;
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
        menuForNodeId = null;
        selectedId = null;
        addNodeOpen = false;
        pipePickerOpen = false;
        edgeInspectorFor = null;
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        // Let the chat textarea's own handler send the draft
        if (isTypingTarget(ev.target)) return;
        ev.preventDefault();
        runCanvas();
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

  // Close the add-node menu on outside click. composedPath() is captured
  // at event dispatch time, so it stays valid even if Svelte detaches the
  // clicked element during its reactive re-render (which is exactly what
  // happens when the click changes addNodeCategory).
  $effect(() => {
    if (!addNodeOpen) return;
    function onDocClick(ev: MouseEvent) {
      if (!addNodeWrapEl) return;
      const path = ev.composedPath();
      if (path.includes(addNodeWrapEl)) return;
      addNodeOpen = false;
    }
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  });

  // Reset drill-down state whenever the menu closes
  $effect(() => {
    if (!addNodeOpen) {
      addNodeCategory = null;
      addNodeFilter = '';
    }
  });

  // Resume SSE if the server says there's an in-flight run at load
  $effect(() => {
    if (canvas.runStatus === 'running' && canvas.latestRunId && !activeRunId) {
      activeRunId = canvas.latestRunId;
      runMeta = { state: 'running' };
      subscribeToRun(canvas.latestRunId);
    }
  });

  // Hydrate pending explorations — mark running so ResearchResultNode opens its SSE stream.
  $effect(() => {
    for (const nodeId of Object.keys(pendingExplorations)) {
      const node = canvas.nodes.find((n) => n.id === nodeId);
      if (node?.config?.completedReport) continue; // already done, just persisted
      researchStatus[nodeId] ??= 'running';
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
    <span class="mono11 primary">{canvas.title}</span>
    <span class="sr-sep">/</span>
    <span class="mono11 muted">
      {viewNodes.length} nodes · {visibleEdges.length} edges · {runningCount} running
    </span>
    <div class="toolbar-right">
      {#if hasStatsNode}
        <TimeFilter value={period} onchange={changePeriod} />
      {/if}
      <button
        class="composer-pill run-btn"
        onclick={runCanvas}
        disabled={runMeta.state === 'running' || !canvas.workflowId}
        title={runMeta.state === 'running'
          ? 'Running…'
          : 'Fire the trigger. Does NOT touch chat.'}
      >
        {runMeta.state === 'running' ? '⟳ running…' : '▶ Run'}
      </button>
      {#if runMeta.state === 'failed'}
        <span class="run-err" title={runMeta.error}>⚠ run failed</span>
      {/if}
      <span class="sep-v"></span>
      <div class="add-node-wrap" bind:this={addNodeWrapEl}>
        <button
          class="composer-pill"
          onclick={() => (addNodeOpen = !addNodeOpen)}
          title="Add a new node"
        >
          + node
        </button>
        {#if addError}
          <span class="run-err" title={addError}>⚠ add failed</span>
        {/if}
        {#if addNodeOpen}
          {@const hasTrigger = viewNodes.some((n) => n.kind === 'trigger')}
          {@const searchActive = addNodeFilter.trim().length > 0}
          {@const searchHits = nodeSearchResults()}
          {@const byGroup = nodeTypesByGroup()}
          {@const groupsOrdered = nodeGroupsOrdered()}
          {@const currentItems =
            addNodeCategory && byGroup.has(addNodeCategory)
              ? byGroup.get(addNodeCategory) ?? []
              : []}
          <div class="add-node-menu" role="menu" aria-label="Add node">
            <input
              class="add-node-search"
              type="text"
              bind:value={addNodeFilter}
              placeholder="Search all node types…"
              onkeydown={(e) => {
                if (e.key === 'Escape') {
                  if (addNodeFilter) {
                    addNodeFilter = '';
                  } else if (addNodeCategory) {
                    addNodeCategory = null;
                  } else {
                    addNodeOpen = false;
                  }
                }
              }}
            />

            <div class="add-node-scroll">
              {#if searchActive}
                <!-- Search mode: flat results, ignore drill-down -->
                {#if searchHits.length === 0}
                  <div class="add-node-empty">No types match "{addNodeFilter}"</div>
                {:else}
                  <div class="add-node-group">{searchHits.length} result{searchHits.length === 1 ? '' : 's'}</div>
                  {#each searchHits as t (t.type)}
                    {@const blocked = t.type === 'trigger' && hasTrigger}
                    <button
                      class="add-node-item"
                      class:blocked
                      role="menuitem"
                      disabled={blocked}
                      onclick={() => !blocked && addNode(t)}
                      title={blocked ? 'This canvas already has a trigger' : t.description}
                    >
                      <span class="add-node-kind-bar" data-kind={t.kind}></span>
                      <span class="add-node-stack">
                        <span class="add-node-label">{t.label}</span>
                        <span class="add-node-group-hint">{t.group}</span>
                      </span>
                      <span class="add-node-type">{blocked ? 'one only' : t.type}</span>
                    </button>
                  {/each}
                {/if}
              {:else if addNodeCategory}
                <!-- Level 2: items within a category -->
                <button
                  class="add-node-back"
                  onclick={() => (addNodeCategory = null)}
                  title="Back to categories"
                >
                  ← All categories
                </button>
                <div class="add-node-group">{addNodeCategory}</div>
                {#each currentItems as t (t.type)}
                  {@const blocked = t.type === 'trigger' && hasTrigger}
                  <button
                    class="add-node-item"
                    class:blocked
                    role="menuitem"
                    disabled={blocked}
                    onclick={() => !blocked && addNode(t)}
                    title={blocked ? 'This canvas already has a trigger' : t.description}
                  >
                    <span class="add-node-kind-bar" data-kind={t.kind}></span>
                    <span class="add-node-stack">
                      <span class="add-node-label">{t.label}</span>
                      <span class="add-node-desc">{t.description}</span>
                    </span>
                    <span class="add-node-type">{blocked ? 'one only' : t.type}</span>
                  </button>
                {/each}
              {:else}
                <!-- Level 1: category cards -->
                <div class="add-node-group">Pick a category</div>
                {#each groupsOrdered as g (g)}
                  {@const items = byGroup.get(g) ?? []}
                  <button
                    class="add-node-category"
                    role="menuitem"
                    onclick={() => (addNodeCategory = g)}
                  >
                    <span class="add-node-category-label">{g}</span>
                    <span class="add-node-category-count">{items.length}</span>
                    <span class="add-node-category-chev">›</span>
                  </button>
                {/each}
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <span class="sep-v"></span>
      <div class="hifi-zoomctl">
        <button onclick={() => zoomCentered(1 / 1.2)} title="Zoom out">−</button><span class="zv"
          >{zoomPct}%</span
        ><button onclick={() => zoomCentered(1.2)} title="Zoom in">+</button>
      </div>
      <button class="composer-pill" onclick={fit} title="Fit canvas">Fit</button>
      <button class="composer-pill" onclick={reset} title="Reset pan/zoom">Reset</button>
      <span class="sep-v"></span>
      <span class="kicker">click to select · F2 rename · ⌫ delete · drag bg to pan</span>
    </div>
  </div>

  <!-- Viewport -->
  <div
    class="viewport"
    class:panning={panStart !== null}
    bind:this={viewportEl}
    role="application"
    aria-label="Canvas graph"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
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
          <!-- Wide transparent hit target for dbl-click -->
          <path
            class="edge-hit"
            {d}
            stroke="transparent"
            stroke-width="14"
            fill="none"
            pointer-events="stroke"
            ondblclick={(ev) => openEdgeInspector(ev, e.id)}
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
        {/each}
      </svg>

      <!-- Nodes -->
      {#each viewNodes as n (n.id)}
        {#if n.kind === 'chat'}
          {@const msgs = messagesFor(n.id)}
          {@const size = chatNodeSize(n)}
          <div
            class="chat-node"
            class:is-selected={selectedId === n.id}
            class:active={isRunning && pendingRun?.chatNodeId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{size.w}px"
            style:height="{size.h}px"
            role="group"
            aria-label="Chat node"
          >
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
              {#if msgs.length === 0 && !(isRunning && pendingRun?.chatNodeId === n.id)}
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
              {#if isRunning && pendingRun?.chatNodeId === n.id}
                <div class="chat-msg chat-msg-pending">
                  <div class="msg-meta">
                    <b>JKAI</b><span class="sr-sep">/</span>
                    <span>streaming…</span>
                  </div>
                  {#if liveToolSteps[n.id] && liveToolSteps[n.id].length > 0}
                    <div class="chat-tool-trace">
                      {#each liveToolSteps[n.id] as step (step.tool + step.status)}
                        <div class="chat-tool-step" class:running={step.status === 'running'}>
                          <span class="chat-tool-dot"></span>{step.tool}
                        </div>
                      {/each}
                    </div>
                  {/if}
                  {#if streamingReplies[n.id]}
                    <div class="chat-msg-body chat-msg-streaming">
                      <ChatMarkdown content={streamingReplies[n.id]} role="assistant" />
                      <span class="chat-cursor">▊</span>
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
              <textarea
                class="chat-input"
                value={chatDrafts[n.id] ?? ''}
                oninput={(e) =>
                  (chatDrafts = {
                    ...chatDrafts,
                    [n.id]: (e.target as HTMLTextAreaElement).value,
                  })}
                placeholder="Message this chat — ⏎ send · ⇧⏎ newline"
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
                  {#if isRunning && pendingRun?.chatNodeId === n.id}running…{:else}⏎ send · ⇧⏎ newline{/if}
                </span>
                <button
                  class="composer-pill run-btn"
                  onclick={() => sendFromChat(n.id)}
                  disabled={runMeta.state === 'running' || !(chatDrafts[n.id] ?? '').trim()}
                >
                  SEND
                </button>
              </div>
            </div>
          </div>
        {:else if n.kind === 'inspector'}
          {@const isize = resizableSize(n)}
          <div
            class="chat-node inspector-node"
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
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
              <InspectorBody data={n.inputData} />
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
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{isize.w}px"
            style:height="{isize.h}px"
            role="group"
            aria-label="Intelligence node"
            onpointerdown={(e) => e.stopPropagation()}
          >
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
            style:left="{n.x}px"
            style:top="{n.y}px"
            style:width="{rsize.w}px"
            style:height="{rsize.h}px"
            role="group"
            aria-label="Research result node"
            onpointerdown={(e) => e.stopPropagation()}
          >
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
              oncancel={() => cancelExplore(n.id)}
              ondone={(result) => finaliseResearch(n.id, result)}
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
                <SummaryNode slug={canvas.slug} period={period} refreshKey={refreshKey} />
              {:else if n.type === 'stats-trends'}
                <TrendsNode slug={canvas.slug} period={period} refreshKey={refreshKey} />
              {:else if n.type === 'stats-per-node'}
                <PerNodeNode
                  slug={canvas.slug}
                  period={period}
                  refreshKey={refreshKey}
                  onrowclick={(nodeId) => scrollToNode(nodeId)}
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
          <div
            class="wf-node"
            class:active={isRunning && n.status === 'running'}
            class:failed={isRunning && n.status === 'failed'}
            class:ok={isRunning && n.status === 'ok'}
            class:is-selected={selectedId === n.id}
            class:drop-target={edgeDrag?.hoverTargetId === n.id}
            class:is-trigger={n.kind === 'trigger'}
            class:flash={flashNodeId === n.id}
            data-kind={n.kind}
            style:left="{n.x}px"
            style:top="{n.y}px"
            role="button"
            tabindex="0"
            onpointerdown={(e) => onNodePointerDown(e, n)}
            onpointermove={onNodePointerMove}
            onpointerup={(e) => onNodePointerUp(e, n)}
            onpointercancel={(e) => onNodePointerUp(e, n)}
            ondblclick={(e) => openMenu(e, n.id)}
            onkeydown={(e) => {
              if (e.key === 'Enter') openMenu(e, n.id);
              else if (e.key === ' ') selectNode(e, n.id);
            }}
          >
            {#if n.kind === 'trigger'}
              <span class="trig-icon">▶</span>
              <div class="trig-stack">
                <span class="wf-name">{n.name}</span>
                <span class="trig-summary">{triggerSummary(n.config)}</span>
              </div>
            {:else if n.type === 'quick-answer' && n.config.topic}
              <div class="trig-stack">
                <span class="wf-name">{n.name}</span>
                <span class="trig-summary">{String(n.config.topic).slice(0, 60)}{String(n.config.topic).length > 60 ? '…' : ''}</span>
              </div>
            {:else if n.type === 'deep-research' && n.config.topic}
              <div class="trig-stack">
                <span class="wf-name">{n.name}</span>
                <span class="trig-summary">{String(n.config.topic).slice(0, 60)}{String(n.config.topic).length > 60 ? '…' : ''}</span>
              </div>
            {:else}
              <span class="wf-name">{n.name}</span>
            {/if}
            <div
              class="node-handle"
              title="Drag to connect to another node"
              onpointerdown={(e) => onHandlePointerDown(e, n)}
            ></div>
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
                  <pre>{pretty(inspectorFrom.outputData)}</pre>
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
                  <pre>{pretty(inspectorTo.inputData)}</pre>
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
                <span class="nm-hdr-kind">{menuNode.kind.toUpperCase()} NODE</span>
                <span class="nm-hdr-id">#{menuNode.id}</span>
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
              {:else if menuNode.kind === 'llm'}
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
                      <pre>{pretty(menuNode.inputData)}</pre>
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
                      <pre>{pretty(menuNode.outputData)}</pre>
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
                      <pre>{pretty(menuNode.inputData)}</pre>
                    {:else}
                      <pre class="ghost">// no run yet</pre>
                    {/if}
                  </div>
                </section>
                {#if menuNode.error}
                  <section class="nm-sec nm-sec-error">
                    <div class="nm-sec-hd"><span class="sr-label-tight error">ERROR</span></div>
                    <div class="nm-field nm-field-read">
                      <pre class="error-text">{menuNode.error}</pre>
                    </div>
                  </section>
                {:else if menuNode.outputData !== undefined}
                  <section class="nm-sec">
                    <div class="nm-sec-hd">
                      <span class="sr-label-tight">OUTPUT DATA</span>
                    </div>
                    <div class="nm-field nm-field-read"><pre>{pretty(menuNode.outputData)}</pre></div>
                  </section>
                {/if}
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
                      <pre>{pretty(menuNode.outputData)}</pre>
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
                      <pre>{pretty(menuNode.inputData)}</pre>
                    {:else}
                      <pre class="ghost">// pending</pre>
                    {/if}
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd"><span class="sr-label-tight">OUTPUT DATA</span></div>
                  <div class="nm-field nm-field-read">
                    {#if menuNode.outputData !== undefined}
                      <pre>{pretty(menuNode.outputData)}</pre>
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
                        <pre>{pretty(menuNode.outputData)}</pre>
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
                      <pre>{pretty(menuNode.inputData)}</pre>
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
                      <pre>{pretty((menuNode.outputData as any)?.intelFocus ?? menuNode.outputData)}</pre>
                    {:else}
                      <pre class="ghost">// no run yet</pre>
                    {/if}
                  </div>
                </section>
              {/if}
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
                  title="Run the full workflow"
                >
                  <span class="nm-act-ic">↻</span>Re-run
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
        <span>MINIMAP</span><span>100%</span>
      </div>
      <div class="minimap-body">
        <div class="minimap-chat"></div>
        {#each canvas.nodes as n (n.id + '-m')}
          <div
            class="minimap-node"
            style:left="{40 + (n.x - COL[0]) * 0.13}px"
            style:top="{8 + (n.y - 120) * 0.18}px"
            style:background={KIND_COLOR[n.kind]}
          ></div>
        {/each}
        <div class="minimap-frame"></div>
      </div>
    </div>
  </div>
  </div>
</div>

<style>
  :root {
    --accent-tint-08: rgba(196, 87, 10, 0.08);
    --accent-tint-20: rgba(196, 87, 10, 0.2);
    --accent-tint-35: rgba(196, 87, 10, 0.35);
  }

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
  .add-node-wrap {
    position: relative;
  }
  .add-node-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 340px;
    background: var(--bg);
    border: 1.5px solid var(--accent);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.08);
    z-index: 50;
    display: flex;
    flex-direction: column;
    padding: 4px;
  }
  .add-node-search {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 6px 8px;
    margin: 2px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
    outline: none;
  }
  .add-node-search:focus {
    border-color: var(--accent);
  }
  .add-node-scroll {
    /* No scrollbar; the menu grows to fit its contents. */
  }
  .add-node-group {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
    padding: 8px 6px 4px;
    background: var(--bg);
    border-bottom: 1px solid var(--divider);
  }
  .add-node-empty {
    padding: 24px 10px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
  }

  /* Category cards (level 1) */
  .add-node-category {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px;
    margin: 2px 2px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
    color: var(--text-primary);
    transition: border-color 0.12s, background 0.12s;
  }
  .add-node-category:hover {
    background: var(--accent-tint-08);
    border-color: var(--accent);
  }
  .add-node-category-label {
    flex: 1;
    font-size: 12px;
    font-weight: 500;
  }
  .add-node-category-count {
    font-size: 9px;
    color: var(--text-ghost);
    letter-spacing: 0.1em;
    padding: 2px 8px;
    border: 1px solid var(--card-border);
    border-radius: 10px;
  }
  .add-node-category-chev {
    color: var(--text-ghost);
    font-size: 14px;
  }

  /* Back button (level 2 header) */
  .add-node-back {
    display: block;
    width: calc(100% - 4px);
    margin: 2px;
    padding: 6px 8px;
    background: var(--bg);
    border: 1px solid var(--card-border);
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    text-align: left;
  }
  .add-node-back:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  /* Stacked label (used in search and category views) */
  .add-node-stack {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .add-node-desc {
    font-size: 9px;
    color: var(--text-ghost);
    line-height: 1.4;
    text-transform: none;
    letter-spacing: 0;
    white-space: normal;
    word-break: break-word;
  }
  .add-node-group-hint {
    font-size: 9px;
    color: var(--text-ghost);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .add-node-item {
    align-items: flex-start;
    padding: 6px 8px;
  }
  .add-node-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    font-family: var(--font-mono);
    text-align: left;
    color: var(--text-primary);
  }
  .add-node-item:hover:not(.blocked) {
    background: var(--accent-tint-08);
    border-color: var(--card-border);
  }
  .add-node-item.blocked {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .add-node-kind-bar {
    display: inline-block;
    width: 3px;
    height: 14px;
    background: var(--text-ghost);
    flex-shrink: 0;
  }
  .add-node-kind-bar[data-kind='llm'],
  .add-node-kind-bar[data-kind='intel'] {
    background: var(--accent);
  }
  .add-node-kind-bar[data-kind='parse'] {
    background: #c44;
  }
  .add-node-kind-bar[data-kind='output'],
  .add-node-kind-bar[data-kind='agent'] {
    background: var(--text-primary);
  }
  .add-node-kind-bar[data-kind='input'] {
    background: var(--text-muted);
  }
  .add-node-label {
    font-size: 11px;
    font-weight: 500;
  }
  .add-node-type {
    font-size: 9px;
    color: var(--text-ghost);
    margin-left: auto;
    letter-spacing: 0.1em;
    text-transform: uppercase;
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
    background:
      linear-gradient(var(--divider) 1px, transparent 1px) 0 0 / 32px 32px,
      linear-gradient(90deg, var(--divider) 1px, transparent 1px) 0 0 / 32px 32px,
      var(--bg);
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
    align-items: flex-end;
    text-align: right;
  }
  .chat-msg.is-user .msg-meta {
    justify-content: flex-end;
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
    border: 1px solid var(--card-border);
    padding: 6px 10px;
    display: inline-block;
  }
  .chat-msg-body.ghost {
    color: var(--text-ghost);
  }
  .chat-msg-pending .chat-msg-body {
    font-family: var(--font-mono);
    font-size: 11px;
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
  .minimap-chat {
    position: absolute;
    left: 6px;
    top: 4px;
    width: 28px;
    height: 24px;
    background: var(--text-primary);
  }
  .minimap-node {
    position: absolute;
    width: 14px;
    height: 6px;
  }
  .minimap-frame {
    position: absolute;
    inset: 0;
    border: 1.5px solid var(--accent);
    pointer-events: none;
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
  .nm-inline {
    position: absolute;
    width: 420px;
    background: var(--bg);
    border: 1.5px solid var(--accent);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.08);
    z-index: 40;
    display: flex;
    flex-direction: column;
  }
  .nm-inline-hdr {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--divider);
    background: var(--accent-tint-08);
  }
  .nm-inline-hdr .wf-name {
    position: static;
    background: none;
    border: none;
    padding: 0;
    width: auto;
    height: auto;
    overflow: visible;
    font-weight: 500;
  }
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
  .nm-inline-body {
    display: flex;
    flex-direction: column;
    max-height: 60vh;
    overflow: auto;
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
  .nm-sec {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .nm-sec-error {
    background: rgba(196, 68, 68, 0.06);
    border: 1px solid rgba(196, 68, 68, 0.3);
    padding: 6px 8px;
  }
  .nm-sec-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .sr-label-tight {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .sr-label-tight.error {
    color: #c44;
  }
  .nm-sec-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
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

  .nm-label-input {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid transparent;
    padding: 3px 6px;
    outline: none;
    min-width: 0;
  }
  .nm-label-input:hover,
  .nm-label-input:focus {
    border-color: var(--card-border);
    background: var(--bg);
  }
  .nm-save-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 3px 10px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
  }
  .nm-save-btn:hover:not(:disabled) {
    background: var(--accent-hover, #a84808);
  }
  .nm-save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .nm-save-err {
    color: #c44;
    font-size: 14px;
  }
  .nm-text-input {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 5px 8px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
    outline: none;
    min-width: 0;
    width: 100%;
  }
  .nm-text-input:focus {
    border-color: var(--accent);
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
</style>
