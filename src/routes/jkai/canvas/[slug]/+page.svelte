<script lang="ts">
  import type { CanvasNode, NodeStatus } from './+page.server';
  import { invalidate } from '$app/navigation';

  let { data } = $props();
  const canvas = $derived(data.canvas);

  const NODE_W = 148;
  const NODE_H = 52;
  const COL = [320, 540, 760, 980];
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const CHAT_CARD_RIGHT_EDGE = 316; // left (16) + width (300)

  // Live run state — overlays the server-provided canvas snapshot
  let liveStatus = $state<Record<string, NodeStatus>>({});
  let liveData = $state<
    Record<string, { inputData?: unknown; outputData?: unknown; error?: string | null }>
  >({});
  let activeRunId = $state<string | null>(null);
  let runMeta = $state<{ state: 'idle' | 'running' | 'completed' | 'failed'; error?: string }>({
    state: 'idle',
  });
  let runInput = $state(
    'How should I handle node retries when the LLM returns malformed JSON three times in a row?',
  );

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

  const activeEdgeIds = $derived(
    new Set(canvas.edges.filter((e) => byId[e.to]?.status === 'running').map((e) => e.id)),
  );

  function orthPath(from: CanvasNode, to: CanvasNode): string {
    const sameCol = Math.abs(from.x - to.x) < 4;
    if (sameCol) {
      const bx = from.x + NODE_W / 2;
      const by = from.y + NODE_H;
      const tgtX = to.x + NODE_W / 2;
      const tgtY = to.y;
      return `M${bx} ${by} L${bx} ${tgtY - 6} L${tgtX} ${tgtY - 6} L${tgtX} ${tgtY}`;
    }
    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + NODE_H / 2;
    const midX = x1 + Math.max(16, (x2 - x1) / 2);
    return `M${x1} ${y1} L${midX} ${y1} L${midX} ${y2} L${x2} ${y2}`;
  }

  const KIND_COLOR: Record<string, string> = {
    input: 'var(--text-muted)',
    llm: 'var(--accent)',
    parse: '#c44',
    output: 'var(--text-primary)',
    intel: 'var(--accent)',
    agent: 'var(--text-primary)',
  };

  const runningCount = $derived(viewNodes.filter((n) => n.status === 'running').length);

  // ——— Run trigger + SSE live updates ———
  async function runCanvas() {
    if (runMeta.state === 'running') return;
    liveStatus = {};
    liveData = {};
    runMeta = { state: 'running' };
    try {
      const res = await fetch(`/api/workflows/${canvas.workflowId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: { message: runInput } }),
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
    } else if (evt.type === 'run_completed' || evt.type === 'run_completed_with_errors') {
      runMeta = { state: 'completed' };
      invalidate(`/jkai/canvas/${canvas.slug}`).catch(() => {
        /* harmless */
      });
    } else if (evt.type === 'run_failed') {
      runMeta = { state: 'failed', error: evt.error };
      invalidate(`/jkai/canvas/${canvas.slug}`).catch(() => {
        /* harmless */
      });
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
    const maxX = Math.max(...canvas.nodes.map((n) => n.x + NODE_W)) + pad;
    const maxY = Math.max(...canvas.nodes.map((n) => n.y + NODE_H)) + pad + 24; // pip clearance
    const contentW = maxX - minX;
    const contentH = maxY - minY;
    const availW = Math.max(200, vp.width - CHAT_CARD_RIGHT_EDGE - 24);
    const availH = Math.max(200, vp.height - 24);
    const fitZ = clampZoom(Math.min(availW / contentW, availH / contentH, 1));
    zoom = fitZ;
    panX = CHAT_CARD_RIGHT_EDGE + 12 + (availW - contentW * fitZ) / 2 - minX * fitZ;
    panY = 12 + (availH - contentH * fitZ) / 2 - minY * fitZ;
  }

  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }

  function isInteractiveTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest(
      '.wf-node, .chat-card, .minimap, .legend, .hifi-toolbar, .nm-inline, button, a, input, textarea, select',
    );
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    selectedId = null;
    menuForNodeId = null;
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
    e.preventDefault();
    const vp = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - vp.left;
    const cy = e.clientY - vp.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
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
        await invalidate(`/jkai/canvas/${canvas.slug}`);
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

  async function addNode(opt: { type: string; label: string; defaultConfig: Record<string, unknown> }) {
    addNodeOpen = false;
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await invalidate(`/jkai/canvas/${canvas.slug}`);
    } catch (err) {
      actionError = err instanceof Error ? err.message : String(err);
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
    await invalidate(`/jkai/canvas/${canvas.slug}`);
  }

  async function actReRun() {
    closeMenu();
    await runCanvas();
  }

  async function actDelete() {
    if (!menuNode) return;
    if (!confirm(`Delete node "${menuNode.name}"? This also removes its edges.`)) return;
    actionError = null;
    const result = await postAction(
      `/api/workflows/${canvas.workflowId}/nodes/${menuNode.id}`,
      { method: 'DELETE' },
    );
    if (result) {
      closeMenu();
      await reloadCanvas();
    }
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
      await invalidate(`/jkai/canvas/${canvas.slug}`);
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  // Phase C — double-click menu (inline shape)
  let menuForNodeId = $state<string | null>(null);

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

  $effect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        menuForNodeId = null;
        selectedId = null;
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        runCanvas();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Close the add-node menu on outside click
  $effect(() => {
    if (!addNodeOpen) return;
    function onDocClick(ev: MouseEvent) {
      const t = ev.target as HTMLElement | null;
      if (!t || !t.closest('.add-node-wrap')) addNodeOpen = false;
    }
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  });

  // Resume SSE if the server says there's an in-flight run at load
  $effect(() => {
    if (canvas.runStatus === 'running' && canvas.latestRunId && !activeRunId) {
      activeRunId = canvas.latestRunId;
      runMeta = { state: 'running' };
      subscribeToRun(canvas.latestRunId);
    }
  });
</script>

<svelte:head>
  <title>Canvas · {canvas.slug} — JKAI</title>
</svelte:head>

<div class="canvas-root">
  <!-- Top toolbar -->
  <div class="hifi-toolbar">
    <span class="sr-label">Canvas · hi-fi</span>
    <span class="sr-sep">/</span>
    <span class="mono11 primary">{canvas.title}</span>
    <span class="sr-sep">/</span>
    <span class="mono11 muted">
      {viewNodes.length} nodes · {canvas.edges.length} edges · {runningCount} running
    </span>
    <div class="toolbar-right">
      <input
        class="run-input"
        type="text"
        bind:value={runInput}
        placeholder="Initial message…"
        title="Passed as input.message to the workflow"
      />
      <button
        class="composer-pill run-btn"
        onclick={runCanvas}
        disabled={runMeta.state === 'running' || !canvas.workflowId}
        title={runMeta.state === 'running' ? 'Running…' : 'Run the workflow (Cmd/Ctrl+Enter)'}
      >
        {runMeta.state === 'running' ? '⟳ running…' : '▶ Run'}
      </button>
      {#if runMeta.state === 'failed'}
        <span class="run-err" title={runMeta.error}>⚠ run failed</span>
      {/if}
      <span class="sep-v"></span>
      <div class="add-node-wrap">
        <button
          class="composer-pill"
          onclick={() => (addNodeOpen = !addNodeOpen)}
          title="Add a new node"
        >
          + node
        </button>
        {#if addNodeOpen}
          <div class="add-node-menu" role="menu" aria-label="Add node">
            {#each nodeTypes as t (t.type)}
              <button
                class="add-node-item"
                role="menuitem"
                onclick={() => addNode(t)}
                title={t.description}
              >
                <span class="add-node-kind-bar" data-kind={t.kind}></span>
                <span class="add-node-label">{t.label}</span>
                <span class="add-node-type">{t.type}</span>
              </button>
            {/each}
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
      <span class="kicker">click to select · drag node to move · drag bg to pan</span>
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
    <!-- Chat card (left) -->
    <div class="chat-card">
      <div class="p-pane-head">
        <span class="p-pane-title"><span class="dot"></span>CHAT</span>
        <span class="p-pane-kicker">· hub</span>
      </div>
      <div class="chat-body">
        <div class="msg-meta"><b>JOHN</b><span class="sr-sep">/</span><span>12:42</span></div>
        <p class="chat-p">
          Build a workflow that self-heals JSON parse errors. Use my notes on retry policy.
        </p>
        <div class="msg-meta">
          <b>JKAI</b><span class="sr-sep">/</span><span>claude-haiku-4-5</span
          ><span class="sr-sep">/</span><span>4 sources</span>
        </div>
        <p class="chat-p">
          Built — 6 nodes, piped from your intel scope<a href="#1" class="cite">1</a>. Currently
          retrying the failed parse:
        </p>
        <div class="embed">
          <div class="embed-head">
            <span class="chip chip-accent chip-pill chip-live">LIVE</span>
            <span class="mono10 muted">workflow · json-retry-policy</span>
          </div>
          <div class="embed-body mono10 muted">
            ● claude-haiku-4-5 running · 1.1s elapsed<br />
            ✕ json.parse failed ×1 · branching
          </div>
        </div>
      </div>
    </div>

    <!-- Graph area (pan/zoom stage) -->
    <div
      class="graph"
      style:transform="translate({panX}px, {panY}px) scale({zoom})"
      style:transform-origin="0 0"
    >
      <svg class="edges" aria-hidden="true">
        <!-- chat → first-column nodes -->
        <path
          d={`M 316 140 L ${COL[0]} 140`}
          stroke="var(--accent)"
          stroke-width="1.25"
          stroke-dasharray="3 3"
          fill="none"
          vector-effect="non-scaling-stroke"
        />
        <!-- workflow edges -->
        {#each canvas.edges as e (e.id)}
          {@const isActive = activeEdgeIds.has(e.id)}
          <path
            d={orthPath(byId[e.from], byId[e.to])}
            stroke={isActive ? 'var(--accent)' : 'var(--text-ghost)'}
            stroke-width={isActive ? 1.75 : 1.25}
            stroke-dasharray={isActive ? '3 3' : ''}
            fill="none"
            vector-effect="non-scaling-stroke"
          />
        {/each}
        <!-- output → back to chat -->
        <path
          d={`M ${COL[3] + 148} 266 L ${COL[3] + 190} 266 L ${COL[3] + 190} 460 L 200 460 L 200 340`}
          stroke="var(--text-ghost)"
          stroke-width="1"
          stroke-dasharray="2 3"
          fill="none"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <!-- Nodes -->
      {#each viewNodes as n (n.id)}
        <div
          class="wf-node"
          class:active={n.status === 'running'}
          class:failed={n.status === 'failed'}
          class:ok={n.status === 'ok'}
          class:is-selected={selectedId === n.id}
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
          <span class="wf-name">{n.name}</span>
        </div>
      {/each}


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
              oninput={(e) => setLabel((e.target as HTMLInputElement).value)}
              aria-label="Node label"
            />
            <span class="nm-hdr-kind">{menuNode.kind}</span>
            {#if configDirty}
              <button class="nm-save-btn" onclick={saveNode} disabled={saving}>
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
              {#if menuNode.kind === 'llm'}
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
                <section class="nm-sec">
                  <div class="nm-sec-hd"><span class="sr-label-tight">SCOPE</span></div>
                  <div class="nm-scope">
                    <div>
                      <span class="nm-scope-lbl">TOPIC</span>
                      <button class="composer-pill active">retry policy</button>
                    </div>
                    <div>
                      <span class="nm-scope-lbl">PERSON</span>
                      <button class="composer-pill ghost">any</button>
                    </div>
                    <div>
                      <span class="nm-scope-lbl">WHEN</span>
                      <button class="composer-pill active">last 30d</button>
                    </div>
                  </div>
                </section>
                <section class="nm-sec">
                  <div class="nm-sec-hd">
                    <span class="sr-label-tight">MATCHING</span>
                    <span class="nm-sec-meta">84 notes · 6 entities</span>
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

<style>
  :root {
    --accent-tint-08: rgba(196, 87, 10, 0.08);
    --accent-tint-20: rgba(196, 87, 10, 0.2);
    --accent-tint-35: rgba(196, 87, 10, 0.35);
  }

  .canvas-root {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text-primary);
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
    min-width: 240px;
    background: var(--bg);
    border: 1.5px solid var(--accent);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.08);
    z-index: 50;
    display: flex;
    flex-direction: column;
    padding: 4px;
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
  .add-node-item:hover {
    background: var(--accent-tint-08);
    border-color: var(--card-border);
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
  .chat-card {
    position: absolute;
    left: 16px;
    top: 24px;
    width: 300px;
    background: var(--bg);
    border: 1.5px solid var(--text-primary);
    z-index: 5;
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
  }
  .chat-p {
    margin: 0 0 10px;
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
    pointer-events: none;
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
</style>
