<!-- src/lib/canvas/intelligence/ResearchDesk.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import ArtefactCard from './desk/ArtefactCard.svelte';
  import ModeToggle from './desk/ModeToggle.svelte';
  import CategoryHeader from './desk/CategoryHeader.svelte';
  import EntityRail from './desk/EntityRail.svelte';
  import { createDeskStore, type DeskCard } from './desk/store.svelte';
  import {
    organisedLayout,
    organisedCorePxBounds,
    COL_W,
    type LayoutArtefact,
    type LayoutCategory,
  } from './desk/layout';
  import { effectivePosition, type DeskMode } from './desk/positioning';
  import { persistArtefactPosition } from './desk/persist-position';

  let { sessionId, topic = '' } = $props<{ sessionId: string; topic?: string }>();

  // ——— store ———
  const store = createDeskStore(sessionId);
  onMount(() => {
    store.start();
    return () => store.dispose();
  });

  // GATHER ⇄ SYNTHESIZE
  let mode = $state<DeskMode>('gather');
  let synthesizing = $state(false); // POST in flight (debounce double-clicks)
  let everSynthesized = $state(false); // have we folded this pile at least once?

  function goGather() {
    mode = 'gather';
  }

  async function goSynthesize() {
    mode = 'synthesize';
    // Re-synthesize folds NEW loose cards into the existing structure.
    // Skip the POST if a run is already streaming.
    if (synthesizing || store.synthStatus === 'running') return;
    synthesizing = true;
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // pinnedOnly:false → consider the whole loose pile; the server resolves the fact set.
        body: JSON.stringify({ scope: { pinnedOnly: false } }),
      });
      if (res.ok) {
        everSynthesized = true;
        // synthesis.started arrives on the stream and resets the reducer.
      } else {
        console.error('[desk] synthesize POST failed', res.status);
      }
    } catch (err) {
      console.error('[desk] synthesize POST error', err);
    } finally {
      synthesizing = false;
    }
  }

  // ——— card geometry (uniform; entity chips a touch smaller) ———
  const CARD_W = 240;
  const CARD_H = 132;
  function cardW(c: DeskCard) {
    return c.kind === 'entity' ? 200 : CARD_W;
  }
  function cardH(c: DeskCard) {
    return c.kind === 'entity' ? 72 : CARD_H;
  }

  // Live drag overrides (id → {x,y}); applied on top of persisted/auto layout.
  let dragOverrides = $state.raw<Record<string, { x: number; y: number }>>({});

  // Categories: live reducer categories merged with any persisted deskCategory
  // (so a reload shows prior structure even before a new run streams).
  const categories = $derived.by<LayoutCategory[]>(() => {
    const map = new Map<string, LayoutCategory>();
    for (const c of store.synthCategories) map.set(c.id, { id: c.id, title: c.title });
    // Cluster membership (fact_ids) is the fallback category source pre-reload.
    for (const cl of store.clusters) {
      if (!map.has(cl.id)) map.set(cl.id, { id: cl.id, title: cl.title });
    }
    for (const card of store.cards) {
      if (card.deskCategory && !map.has(card.deskCategory)) {
        map.set(card.deskCategory, { id: card.deskCategory, title: card.deskCategory });
      }
    }
    return [...map.values()];
  });

  // Fact → cluster membership, so cards file even before patchCard lands.
  const factCat = $derived.by(() => {
    const m = new Map<string, string>();
    for (const cl of store.clusters) for (const fid of cl.fact_ids ?? []) m.set(fid, cl.id);
    return m;
  });

  // Organised positions — always computed (sticky needs them in BOTH modes).
  const organised = $derived.by(() => {
    const arts: LayoutArtefact[] = store.cards.map((c) => ({
      id: c.id,
      kind: c.kind,
      categoryId: c.deskCategory ?? factCat.get(c.id),
    }));
    return organisedLayout(arts, categories);
  });
  const coreBounds = $derived(organisedCorePxBounds(organised));

  // Per-category member counts (for the header badge).
  const categoryCounts = $derived.by<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const c of store.cards) {
      const cat = c.deskCategory ?? factCat.get(c.id);
      if (cat) out[cat] = (out[cat] ?? 0) + 1;
    }
    return out;
  });

  // Per-category summary, keyed by cluster id (for the header tooltip/clamp).
  const categorySummary = $derived.by<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of store.synthCategories) out[c.id] = c.summary ?? '';
    for (const cl of store.clusters) if (!out[cl.id]) out[cl.id] = cl.summary ?? '';
    return out;
  });

  // Entity rail order MUST match organisedLayout's array order (which preserves
  // the cards' array order); for the rail component we mirror that order.
  const railEntities = $derived.by(() =>
    store.cards
      .filter((c) => c.kind === 'entity')
      .map((c) => ({
        id: c.id,
        name: String(c.fields.name ?? '—'),
        type: String(c.fields.type ?? 'entity'),
      })),
  );

  /**
   * Resolve a card's on-desk position.
   *   live drag override > effectivePosition (manual > sticky-filed > scatter)
   * A card counts as "filed" when its deskState is synthesized/filed OR it has a
   * known cluster membership (so it morphs to its slot the instant a cluster
   * event lands, even before the patchCard round-trip).
   */
  function posOf(c: DeskCard): { x: number; y: number } {
    const ov = dragOverrides[c.id];
    if (ov) return ov;
    const filedByCluster = factCat.has(c.id);
    return effectivePosition(
      {
        id: c.id,
        kind: c.kind,
        phase: c.phase,
        canvasX: c.canvasX ?? null,
        canvasY: c.canvasY ?? null,
        pinned: c.pinned ?? false,
        deskState: filedByCluster && c.deskState === 'unfiled' ? 'filed' : (c.deskState ?? 'unfiled'),
        deskCategory: c.deskCategory ?? factCat.get(c.id) ?? null,
      },
      mode,
      organised,
      coreBounds,
    );
  }

  // Entity-id → resolved centre, for edge docking.
  const entityById = $derived.by(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const c of store.cards) {
      if (c.kind !== 'entity') continue;
      const p = posOf(c);
      m.set(c.id, { x: p.x, y: p.y, w: cardW(c), h: cardH(c) });
    }
    return m;
  });

  // ——— orthPath (lifted from canvas/[slug]/+page.svelte:1016-1053) ———
  type Box = { x: number; y: number; w: number; h: number };
  function orthPath(from: Box, to: Box): string {
    const sCx = from.x + from.w / 2;
    const sCy = from.y + from.h / 2;
    const tCx = to.x + to.w / 2;
    const tCy = to.y + to.h / 2;
    const dx = tCx - sCx;
    const dy = tCy - sCy;
    const overlapX = from.x < to.x + to.w && to.x < from.x + from.w;
    const overlapY = from.y < to.y + to.h && to.y < from.y + from.h;
    let horizontal: boolean;
    if (overlapX && !overlapY) horizontal = false;
    else if (overlapY && !overlapX) horizontal = true;
    else horizontal = Math.abs(dx) >= Math.abs(dy);
    if (horizontal) {
      const [x1, x2] = dx >= 0 ? [from.x + from.w, to.x] : [from.x, to.x + to.w];
      const y1 = sCy;
      const y2 = tCy;
      const midX = (x1 + x2) / 2;
      return `M${x1} ${y1} L${midX} ${y1} L${midX} ${y2} L${x2} ${y2}`;
    }
    const [y1, y2] = dy >= 0 ? [from.y + from.h, to.y] : [from.y, to.y + to.h];
    const x1 = sCx;
    const x2 = tCx;
    const midY = (y1 + y2) / 2;
    return `M${x1} ${y1} L${x1} ${midY} L${x2} ${midY} L${x2} ${y2}`;
  }

  const edgePaths = $derived.by(() => {
    const out: { id: string; d: string }[] = [];
    for (const e of store.edges) {
      const a = entityById.get(e.fromEntityId);
      const b = entityById.get(e.toEntityId);
      if (!a || !b) continue; // only draw when both entity cards exist
      out.push({ id: e.id, d: orthPath(a, b) });
    }
    return out;
  });

  // ——— synthesized connector edges (category header → member fact) ———
  // Resolve an anchor id to a world Box. 'cat:<id>' → the column header band;
  // any other id → the member card via posOf.
  function anchorRect(anchorId: string): Box | null {
    if (anchorId.startsWith('cat:')) {
      const catId = anchorId.slice(4);
      const idx = categories.findIndex((c) => c.id === catId);
      if (idx < 0) return null;
      return { x: idx * COL_W, y: 0, w: 220, h: 64 };
    }
    const card = store.cards.find((c) => c.id === anchorId);
    if (!card) return null;
    const p = posOf(card);
    return { x: p.x, y: p.y, w: cardW(card), h: cardH(card) };
  }

  const synthEdgePaths = $derived.by(() => {
    if (mode !== 'synthesize') return [];
    const out: { id: string; d: string }[] = [];
    for (const e of store.synthEdges) {
      const a = anchorRect(e.fromId);
      const b = anchorRect(e.toId);
      if (!a || !b) continue;
      out.push({ id: e.id, d: orthPath(a, b) });
    }
    return out;
  });

  // ——— pan/zoom (lifted from canvas/[slug]/+page.svelte:1868-1984) ———
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  let panX = $state(0);
  let panY = $state(0);
  let zoom = $state(1);
  const zoomPct = $derived(Math.round(zoom * 100));
  let viewportEl: HTMLDivElement | undefined;
  let viewportW = $state(0);
  let viewportH = $state(0);
  let panStart = $state<{ x: number; y: number; panX: number; panY: number; pointerId: number } | null>(null);

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
    const cards = store.cards;
    if (!viewportEl || cards.length === 0) return;
    const vp = viewportEl.getBoundingClientRect();
    const pad = 48;
    const xs = cards.map((c) => posOf(c));
    const minX = Math.min(...xs.map((p) => p.x)) - pad;
    const minY = Math.min(...xs.map((p) => p.y)) - pad;
    const maxX = Math.max(...cards.map((c) => posOf(c).x + cardW(c))) + pad;
    const maxY = Math.max(...cards.map((c) => posOf(c).y + cardH(c))) + pad;
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
  function isInteractiveTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest('.ac, .desk-minimap, .desk-cmd, button, a, input, textarea, select');
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
    } catch { /* no-op */ }
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const vp = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - vp.left;
    const cy = e.clientY - vp.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(cx, cy, factor);
  }

  // ——— node drag + grid-snap (lifted from :1991-2069, PATCH target swapped) ———
  const DRAG_THRESHOLD = 3;
  const GRID = 20;
  let selectedId = $state<string | null>(null);
  let nodeDrag = $state<{
    cardId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  function onCardPointerDown(e: PointerEvent, c: DeskCard) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = posOf(c);
    nodeDrag = {
      cardId: c.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: p.x,
      startY: p.y,
      moved: false,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onCardPointerMove(e: PointerEvent) {
    if (!nodeDrag || nodeDrag.pointerId !== e.pointerId) return;
    const dxClient = e.clientX - nodeDrag.startClientX;
    const dyClient = e.clientY - nodeDrag.startClientY;
    if (!nodeDrag.moved && Math.hypot(dxClient, dyClient) < DRAG_THRESHOLD) return;
    nodeDrag.moved = true;
    const dx = dxClient / zoom;
    const dy = dyClient / zoom;
    const nx = Math.round((nodeDrag.startX + dx) / GRID) * GRID;
    const ny = Math.round((nodeDrag.startY + dy) / GRID) * GRID;
    dragOverrides = { ...dragOverrides, [nodeDrag.cardId]: { x: nx, y: ny } };
  }
  async function onCardPointerUp(e: PointerEvent, c: DeskCard) {
    if (!nodeDrag || nodeDrag.pointerId !== e.pointerId) return;
    const wasMoved = nodeDrag.moved;
    const cardId = nodeDrag.cardId;
    const finalPos = dragOverrides[cardId];
    nodeDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* no-op */ }
    if (wasMoved && finalPos) {
      // Persist via the M4 client helper (mirrors the canvas drag-persist).
      const { ok } = await persistArtefactPosition(sessionId, cardId, {
        artefactType: c.kind, // 'source' | 'fact' | 'entity'
        position: finalPos,
        pinned: true,
      });
      if (ok) {
        // Fold the persisted position into the store, then drop the transient override.
        store.applyLocalPosition(cardId, finalPos.x, finalPos.y, true);
        const next = { ...dragOverrides };
        delete next[cardId];
        dragOverrides = next;
      }
      // On failure: keep the override so the card doesn't snap back on a blip.
    } else {
      selectedId = c.id;
    }
  }

  // ——— minimap (lifted from :1119-1164) ———
  const MINIMAP_BODY_W = 146;
  const MINIMAP_BODY_H = 60;
  const MINIMAP_PAD = 4;
  const minimap = $derived.by(() => {
    const cards = store.cards;
    if (cards.length === 0 || viewportW === 0 || viewportH === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cards) {
      const p = posOf(c);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      const r = p.x + cardW(c);
      const b = p.y + cardH(c);
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
      scale, offsetX, offsetY, minX, minY,
      frame: {
        x: offsetX + (viewLeft - minX) * scale,
        y: offsetY + (viewTop - minY) * scale,
        w: Math.max(2, (viewRight - viewLeft) * scale),
        h: Math.max(2, (viewBottom - viewTop) * scale),
      },
    };
  });

  const counts = $derived.by(() => {
    let sources = 0, facts = 0, entities = 0;
    for (const c of store.cards) {
      if (c.kind === 'source') sources++;
      else if (c.kind === 'entity') entities++;
      else facts++;
    }
    return { sources, facts, entities, links: store.edges.length };
  });
</script>

<div class="desk-root">
  <!-- command bar (minimal — full CommandBar is a later milestone) -->
  <header class="desk-cmd">
    <span class="desk-mono">sr.</span>
    <span class="desk-topic">{topic || sessionId.slice(0, 8)}</span>
    <div class="desk-toggle-slot">
      <ModeToggle
        {mode}
        synthStatus={store.synthStatus}
        onGather={goGather}
        onSynthesize={goSynthesize}
      />
    </div>
    <span class="desk-counts">
      {counts.sources} src · {counts.facts} fact · {counts.entities} ent · {counts.links} link
    </span>
    <span class="desk-status" data-status={store.status}>● {store.status}</span>
  </header>

  <!-- viewport -->
  <div
    class="desk-viewport"
    class:panning={panStart !== null}
    bind:this={viewportEl}
    bind:clientWidth={viewportW}
    bind:clientHeight={viewportH}
    role="application"
    aria-label="Research desk"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
  >
    <!-- world layer -->
    <div class="desk-world" style:transform="translate({panX}px, {panY}px) scale({zoom})" style:transform-origin="0 0">
      <!-- edges (relationships between entity cards) -->
      <svg class="desk-edges" aria-hidden="true" overflow="visible">
        {#each edgePaths as e (e.id)}
          <path d={e.d} fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.45" vector-effect="non-scaling-stroke" />
        {/each}
        <!-- synthesized connector edges (header → fact), fade in on synthesize -->
        {#if mode === 'synthesize'}
          {#each synthEdgePaths as e (e.id)}
            <path
              d={e.d}
              fill="none"
              stroke="var(--accent)"
              stroke-width="1.25"
              stroke-opacity="0.45"
              vector-effect="non-scaling-stroke"
              class="syn-edge"
            />
          {/each}
        {/if}
      </svg>

      <!-- category headers + entity rail (SYNTHESIZE only) -->
      {#if mode === 'synthesize'}
        {#each categories as cat, i (cat.id)}
          <div class="desk-header-host" style:transform="translate({i * COL_W}px, 0px)">
            <CategoryHeader
              id={cat.id}
              title={cat.title}
              summary={categorySummary[cat.id] ?? ''}
              count={categoryCounts[cat.id] ?? 0}
            />
          </div>
        {/each}

        {#if railEntities.length}
          {@const railY = organised.get(railEntities[0].id)?.y ?? 0}
          <div class="desk-rail-host" style:transform="translate(0px, {railY}px)">
            <EntityRail entities={railEntities} {selectedId} onSelect={(id) => (selectedId = id)} />
          </div>
        {/if}
      {/if}

      <!-- cards -->
      {#each store.cards as c (c.id)}
        {@const p = posOf(c)}
        <div
          class="desk-card-host"
          class:morphing={!c.pinned && c.canvasX == null && !dragOverrides[c.id]}
          style:transform="translate({p.x}px, {p.y}px)"
          onpointerdown={(e) => onCardPointerDown(e, c)}
          onpointermove={onCardPointerMove}
          onpointerup={(e) => onCardPointerUp(e, c)}
          onpointercancel={(e) => onCardPointerUp(e, c)}
        >
          <ArtefactCard card={c} selected={selectedId === c.id} onselect={(id) => (selectedId = id)} />
        </div>
      {/each}
    </div>

    <!-- minimap -->
    <div class="desk-minimap">
      <div class="desk-minimap-head"><span>MINIMAP</span><span>{zoomPct}%</span></div>
      <div class="desk-minimap-body">
        {#if minimap}
          {#each store.cards as c (c.id + '-m')}
            {@const p = posOf(c)}
            <div
              class="desk-minimap-node"
              class:ent={c.kind === 'entity'}
              style:left="{minimap.offsetX + (p.x - minimap.minX) * minimap.scale}px"
              style:top="{minimap.offsetY + (p.y - minimap.minY) * minimap.scale}px"
              style:width="{Math.max(2, cardW(c) * minimap.scale)}px"
              style:height="{Math.max(2, cardH(c) * minimap.scale)}px"
            ></div>
          {/each}
          <div
            class="desk-minimap-frame"
            style:left="{minimap.frame.x}px"
            style:top="{minimap.frame.y}px"
            style:width="{minimap.frame.w}px"
            style:height="{minimap.frame.h}px"
          ></div>
        {/if}
      </div>
    </div>

    <!-- zoom controls -->
    <div class="desk-zoom">
      <button type="button" onclick={() => zoomCentered(1.2)} aria-label="Zoom in">+</button>
      <button type="button" onclick={() => zoomCentered(1 / 1.2)} aria-label="Zoom out">−</button>
      <button type="button" onclick={fit} aria-label="Fit">⤢</button>
      <button type="button" onclick={reset} aria-label="Reset">⌂</button>
    </div>
  </div>
</div>

<style>
  .desk-root {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text-primary);
  }
  .desk-cmd {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    border-bottom: 1px solid rgba(26, 16, 8, 0.18);
    background: var(--surface-elevated);
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .desk-mono { font-family: var(--font-brand); font-weight: 500; color: var(--accent); }
  .desk-topic { font-family: var(--font-body); font-weight: 600; font-size: 13px; }
  .desk-toggle-slot { margin-left: auto; display: flex; align-items: center; }
  .desk-counts { color: var(--text-muted); }
  .desk-status { color: var(--success); letter-spacing: 0.08em; }
  .desk-status[data-status='error'] { color: #b3261e; }

  .desk-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
    background:
      radial-gradient(circle, rgba(26, 16, 8, 0.06) 1px, transparent 1px) 0 0 / 32px 32px;
  }
  .desk-viewport.panning { cursor: grabbing; }
  .desk-world { position: absolute; top: 0; left: 0; }
  .desk-edges { position: absolute; top: 0; left: 0; width: 1px; height: 1px; pointer-events: none; }
  .desk-card-host { position: absolute; top: 0; left: 0; touch-action: none; will-change: transform; }

  /* Morph: auto-placed cards (not pinned/dragged) ease between scatter and
     organised slots. Pinned/dragged cards (canvasX set) skip the transition so
     they never lag. */
  .desk-card-host.morphing {
    transition: transform 520ms cubic-bezier(0.22, 0.61, 0.36, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .desk-card-host.morphing { transition: none; }
  }

  .desk-header-host,
  .desk-rail-host {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
    transition: opacity 360ms ease;
  }

  .syn-edge { animation: syn-fade-in 600ms ease both; }
  @keyframes syn-fade-in {
    from { stroke-opacity: 0; }
    to { stroke-opacity: 0.45; }
  }
  @media (prefers-reduced-motion: reduce) {
    .syn-edge { animation: none; }
  }

  .desk-minimap {
    position: absolute;
    bottom: 12px;
    right: 12px;
    width: 146px;
    background: var(--surface-elevated);
    border: 1px solid rgba(26, 16, 8, 0.18);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    user-select: none;
  }
  .desk-minimap-head {
    display: flex;
    justify-content: space-between;
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: 8px;
    letter-spacing: 0.12em;
    color: var(--text-muted);
    border-bottom: 1px solid rgba(26, 16, 8, 0.12);
  }
  .desk-minimap-body { position: relative; width: 146px; height: 60px; }
  .desk-minimap-node { position: absolute; background: var(--accent); opacity: 0.55; }
  .desk-minimap-node.ent { background: var(--text-primary); opacity: 0.8; }
  .desk-minimap-frame { position: absolute; border: 1px solid var(--accent); background: rgba(196, 87, 10, 0.08); }

  .desk-zoom {
    position: absolute;
    bottom: 12px;
    left: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .desk-zoom button {
    width: 28px;
    height: 28px;
    font-family: var(--font-mono);
    font-size: 14px;
    background: var(--surface-elevated);
    color: var(--text-primary);
    border: 1px solid rgba(26, 16, 8, 0.18);
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    cursor: pointer;
  }
  .desk-zoom button:hover { border-color: var(--accent); color: var(--accent); }
</style>
