<script lang="ts">
  import type { CanvasNode } from './+page.server';

  let { data } = $props();
  const canvas = $derived(data.canvas);

  const NODE_W = 148;
  const NODE_H = 52;
  const COL = [320, 540, 760, 980];
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const CHAT_CARD_RIGHT_EDGE = 316; // left (16) + width (300)

  const byId: Record<string, CanvasNode> = $derived(
    Object.fromEntries(canvas.nodes.map((n) => [n.id, n])),
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

  const runningCount = $derived(canvas.nodes.filter((n) => n.status === 'running').length);

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
      '.wf-node, .chat-card, .minimap, .legend, .hifi-toolbar, button, a, input, textarea',
    );
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (isInteractiveTarget(e.target)) return;
    selectedId = null;
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
      {canvas.nodes.length} nodes · {canvas.edges.length} edges · {runningCount} running
    </span>
    <div class="toolbar-right">
      <button class="composer-pill" disabled>+ node</button>
      <button class="composer-pill" disabled>+ intel</button>
      <button class="composer-pill" disabled>+ workflow</button>
      <span class="sep-v"></span>
      <div class="hifi-zoomctl">
        <button onclick={() => zoomCentered(1 / 1.2)} title="Zoom out">−</button><span class="zv"
          >{zoomPct}%</span
        ><button onclick={() => zoomCentered(1.2)} title="Zoom in">+</button>
      </div>
      <button class="composer-pill" onclick={fit} title="Fit canvas">Fit</button>
      <button class="composer-pill" onclick={reset} title="Reset pan/zoom">Reset</button>
      <span class="sep-v"></span>
      <span class="kicker">click to select · drag bg to pan · wheel to zoom</span>
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
          <path
            d={orthPath(byId[e.from], byId[e.to])}
            stroke={e.active ? 'var(--accent)' : 'var(--text-ghost)'}
            stroke-width={e.active ? 1.75 : 1.25}
            stroke-dasharray={e.active ? '3 3' : ''}
            fill="none"
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

      <!-- Column labels -->
      {#each ['INPUT', 'PROCESS', 'RETRY', 'OUTPUT'] as lbl, i}
        <div class="col-label" style:left="{COL[i]}px">{lbl}</div>
      {/each}

      <!-- Nodes -->
      {#each canvas.nodes as n (n.id)}
        <div
          class="wf-node"
          class:active={n.status === 'running'}
          class:failed={n.status === 'failed'}
          class:is-selected={selectedId === n.id}
          data-kind={n.kind}
          style:left="{n.x}px"
          style:top="{n.y}px"
          role="button"
          tabindex="0"
          onclick={(e) => selectNode(e, n.id)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') selectNode(e, n.id);
          }}
        >
          <span class="wf-name">{n.name}</span>
        </div>
      {/each}

      <!-- Status pips -->
      {#each canvas.nodes.filter((n) => n.status) as n (n.id + '-s')}
        <div
          class="pip"
          class:failed={n.status === 'failed'}
          class:running={n.status === 'running'}
          style:left="{n.x + 16}px"
          style:top="{n.y + 56}px"
        >
          {#if n.status === 'failed'}✕ failed ×1
          {:else if n.status === 'running'}⟳ running · 1.1s
          {:else}✓ ok · 0.4s{/if}
        </div>
      {/each}
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
    opacity: 0.85;
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
  .col-label {
    position: absolute;
    top: 72px;
    width: 148px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    color: var(--text-ghost);
    text-transform: uppercase;
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
  .wf-node.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wf-node:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .wf-node {
    cursor: pointer;
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
</style>
