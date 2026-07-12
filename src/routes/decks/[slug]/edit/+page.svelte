<script lang="ts">
  // Deck editor — three panes: slide tree (reorder/nest), true-fidelity
  // preview, block forms. Every save is a PATCH with expectedVersion
  // (canvas optimistic-concurrency pattern): 409 → conflict banner, reload.
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import SlideView from '$lib/components/presentation/SlideView.svelte';
  import { LAYOUT_IDS } from '$lib/presentation/layouts';
  import { buildPlanes } from '$lib/presentation/navigation';
  import { validateBlocks } from '$lib/presentation/registry';
  import { BLOCK_TEMPLATES, CHART_TEMPLATES } from '$lib/presentation/templates';
  import type { Block, SlideNode } from '$lib/presentation/types';
  import BlockForm from './BlockForm.svelte';
  import SiteMediaPicker from './SiteMediaPicker.svelte';

  let { data } = $props();

  interface BlockFrame {
    x: number;
    y: number;
    w: number;
  }

  interface EditSlide {
    id: string;
    parentSlideId: string | null;
    position: number;
    title: string | null;
    layout: string;
    blocks: Block[];
    notes: string | null;
    journeyLabel: string | null;
    geometry: Record<string, BlockFrame> | null;
    version: number;
  }

  let slides = $state<EditSlide[]>(structuredClone(data.slides));
  let selectedId = $state<string>(data.slides[0]?.id ?? '');
  let dirty = $state<Record<string, boolean>>({});
  let saving = $state(false);
  let banner = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);
  let deckTitle = $state(data.deck.title);
  let deckDescription = $state(data.deck.description ?? '');
  let isPublic = $state(data.deck.isPublic);
  let shares = $state<{ id: string; label: string | null; revokedAt: string | null; useCount: number }[]>([]);
  let freshToken = $state<string | null>(null);
  let addType = $state('prose');
  let composeText = $state('');
  let composeMedia = $state('');
  let composeNest = $state(false);
  let composing = $state(false);
  let attached = $state<Block[]>([]);
  let picker = $state<'closed' | 'compose' | 'block'>('closed');

  // --- resizable side panels (at the expense of the centre preview) ---
  let leftW = $state(250);
  let rightW = $state(330);
  // divider drag internals — plain lets (svelte5-pitfalls §1)
  let dividerSide: 'l' | 'r' | null = null;
  let divStartX = 0;
  let divStartW = 0;

  function startDivider(side: 'l' | 'r', e: PointerEvent) {
    dividerSide = side;
    divStartX = e.clientX;
    divStartW = side === 'l' ? leftW : rightW;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveDivider(e: PointerEvent) {
    if (!dividerSide) return;
    const d = e.clientX - divStartX;
    if (dividerSide === 'l') leftW = Math.min(560, Math.max(170, divStartW + d));
    else rightW = Math.min(640, Math.max(240, divStartW - d));
  }
  function endDivider() {
    if (!dividerSide) return;
    dividerSide = null;
    try {
      localStorage.setItem('sr-decks-editor-panels', JSON.stringify({ l: leftW, r: rightW }));
    } catch {
      /* private mode */
    }
  }

  // --- manual arrange mode: drag/resize block frames on the preview ---
  let arranging = $state(false);
  let previewEl: HTMLElement | undefined; // plain let — measured, never rendered from
  // frame drag internals — plain lets
  let frameDrag: { bi: string; mode: 'move' | 'resize'; px: number; py: number; f: BlockFrame } | null = null;

  function measureGeometry(): Record<string, BlockFrame> {
    const geo: Record<string, BlockFrame> = {};
    const host = previewEl?.getBoundingClientRect();
    if (!host || !selected) return geo;
    for (const el of previewEl!.querySelectorAll<HTMLElement>('.block[data-bi]')) {
      const bi = el.dataset.bi ?? '';
      const r = el.getBoundingClientRect();
      geo[bi] = {
        x: Math.round(((r.left - host.left) / host.width) * 1000) / 10,
        y: Math.round(((r.top - host.top) / host.height) * 1000) / 10,
        w: Math.round((r.width / host.width) * 1000) / 10,
      };
    }
    // blocks the layout didn't render as .block (e.g. a poster backdrop image)
    selected.blocks.forEach((_, i) => {
      if (!geo[String(i)]) geo[String(i)] = { x: 6, y: 8 + i * 24, w: 60 };
    });
    return geo;
  }

  function toggleArrange() {
    if (!selected) return;
    if (!arranging && (!selected.geometry || Object.keys(selected.geometry).length === 0)) {
      selected.geometry = measureGeometry();
      markDirty();
    }
    arranging = !arranging;
  }

  function resetArrange() {
    if (!selected) return;
    selected.geometry = null;
    arranging = false;
    markDirty();
  }

  function startFrame(bi: string, mode: 'move' | 'resize', e: PointerEvent) {
    if (!selected?.geometry?.[bi]) return;
    e.preventDefault();
    e.stopPropagation();
    frameDrag = { bi, mode, px: e.clientX, py: e.clientY, f: { ...selected.geometry[bi] } };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveFrame(e: PointerEvent) {
    if (!frameDrag || !selected?.geometry) return;
    const host = previewEl?.getBoundingClientRect();
    if (!host) return;
    const dx = ((e.clientX - frameDrag.px) / host.width) * 100;
    const dy = ((e.clientY - frameDrag.py) / host.height) * 100;
    const f = frameDrag.f;
    const r = (n: number) => Math.round(n * 10) / 10;
    if (frameDrag.mode === 'move') {
      selected.geometry[frameDrag.bi] = {
        ...selected.geometry[frameDrag.bi],
        x: r(Math.min(115, Math.max(-15, f.x + dx))),
        y: r(Math.min(115, Math.max(-15, f.y + dy))),
      };
    } else {
      selected.geometry[frameDrag.bi] = {
        ...selected.geometry[frameDrag.bi],
        w: r(Math.min(100, Math.max(8, f.w + dx))),
      };
    }
    markDirty();
  }
  function endFrame() {
    frameDrag = null;
  }

  // --- drag attached site media onto the slide ---
  function chipDragStart(e: DragEvent, i: number) {
    e.dataTransfer?.setData('application/x-deck-block', JSON.stringify({ from: 'attached', i }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copyMove';
  }
  function previewDrop(e: DragEvent) {
    const raw = e.dataTransfer?.getData('application/x-deck-block');
    if (!raw || !selected) return;
    e.preventDefault();
    try {
      const info = JSON.parse(raw) as { from: string; i: number };
      if (info.from === 'attached' && attached[info.i]) {
        selected.blocks.push($state.snapshot(attached[info.i]) as Block);
        attached = attached.filter((_, j) => j !== info.i);
        markDirty();
      }
    } catch {
      /* not ours */
    }
  }

  // The add-block menu: every block type, with chart expanded per kind.
  const TEMPLATE_OPTIONS: { key: string; label: string; block: Block }[] = [
    ...Object.entries(BLOCK_TEMPLATES)
      .filter(([t]) => t !== 'chart')
      .map(([t, b]) => ({ key: t, label: t, block: b })),
    ...Object.entries(CHART_TEMPLATES).map(([k, b]) => ({ key: `chart:${k}`, label: `chart · ${k}`, block: b })),
  ];

  function blockLabel(b: Block): string {
    if (b.type === 'embed') return `◈ ${b.embed}`;
    if (b.type === 'iframe') return `▤ ${b.src}`;
    if (b.type === 'image') return `▣ ${b.src.split('/').pop()}`;
    return b.type;
  }

  function onPicked(block: Block) {
    if (picker === 'compose') {
      attached = [...attached, block];
    } else if (selected) {
      selected.blocks.push(block);
      markDirty();
    }
    picker = 'closed';
  }

  const planes = $derived(buildPlanes(slides));
  const selected = $derived(slides.find((s) => s.id === selectedId) ?? slides[0]);
  const previewSlide = $derived(
    selected
      ? ({ ...selected, hasChildren: (planes.get(selected.id) ?? []).length > 0 } as SlideNode)
      : null,
  );

  function flash(kind: 'ok' | 'err', text: string) {
    banner = { kind, text };
    setTimeout(() => (banner = null), kind === 'ok' ? 2500 : 6000);
  }

  async function api(path: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 409) {
      flash('err', 'Version conflict — this slide changed elsewhere (jkai?). Reload to pick up the latest.');
      return null;
    }
    if (!res.ok) {
      const issues = Array.isArray(payload.issues) ? `: ${(payload.issues as string[]).join('; ')}` : '';
      flash('err', `${payload.error ?? res.statusText}${issues}`);
      return null;
    }
    return payload;
  }

  async function saveSlide(slide: EditSlide) {
    const check = validateBlocks(slide.blocks);
    if (!check.ok) {
      flash('err', `Blocks invalid — ${check.issues.join('; ')}`);
      return;
    }
    saving = true;
    const payload = await api(`/api/decks/${data.deck.id}/slides/${slide.id}`, 'PATCH', {
      title: slide.title ?? '',
      layout: slide.layout,
      blocks: slide.blocks,
      notes: slide.notes ?? '',
      journeyLabel: slide.journeyLabel ?? '',
      geometry: slide.geometry ?? null,
      expectedVersion: slide.version,
    });
    saving = false;
    if (payload?.slide) {
      slide.version = (payload.slide as { version: number }).version;
      dirty = { ...dirty, [slide.id]: false };
      flash('ok', 'Slide saved');
    }
  }

  async function saveMeta() {
    const payload = await api(`/api/decks/${data.deck.id}`, 'PATCH', {
      title: deckTitle,
      description: deckDescription,
      isPublic,
    });
    if (payload) flash('ok', 'Deck saved');
  }

  async function togglePublic() {
    isPublic = !isPublic;
    await saveMeta();
  }

  function adoptNewSlide(payload: Record<string, unknown>, parentSlideId: string | null, position: number) {
    const s = payload.slide as EditSlide;
    // Reflect the server-side sibling shift locally, then adopt the row.
    for (const sib of slides) {
      if (sib.parentSlideId === parentSlideId && sib.position >= position) sib.position += 1;
    }
    slides.push({ ...s, blocks: s.blocks as Block[] });
    selectedId = s.id;
  }

  /** Where a new slide goes: after the selected sibling, or into it as a child. */
  function insertTarget(): { parentSlideId: string | null; position: number } {
    if (composeNest && selected) {
      return { parentSlideId: selected.id, position: (planes.get(selected.id) ?? []).length };
    }
    return { parentSlideId: selected?.parentSlideId ?? null, position: (selected?.position ?? -1) + 1 };
  }

  async function addSlide(parentSlideId: string | null, position: number) {
    const payload = await api(`/api/decks/${data.deck.id}/slides`, 'POST', {
      parentSlideId,
      position,
      title: 'New slide',
      blocks: [structuredClone(BLOCK_TEMPLATES.prose)],
    });
    if (payload?.slide) adoptNewSlide(payload, parentSlideId, position);
  }

  async function composeNewSlide() {
    const target = insertTarget();
    composing = true;
    const payload = await api(`/api/decks/${data.deck.id}/slides/compose`, 'POST', {
      text: composeText,
      mediaUrls: composeMedia
        .split(/[,\n]/)
        .map((u) => u.trim())
        .filter(Boolean),
      attachedBlocks: $state.snapshot(attached),
      ...target,
    });
    composing = false;
    if (payload?.slide) {
      adoptNewSlide(payload, target.parentSlideId, target.position);
      composeText = '';
      composeMedia = '';
      attached = [];
      const layout = (payload.slide as { layout?: string }).layout;
      flash('ok', payload.source === 'llm' ? `Composed → ${layout}` : 'Composed (fallback layout — LLM unavailable)');
    }
  }

  async function deleteSlide(slide: EditSlide) {
    if (!confirm(`Delete "${slide.title ?? 'Untitled'}"? Its sub-slides move up a level.`)) return;
    const payload = await api(`/api/decks/${data.deck.id}/slides/${slide.id}`, 'DELETE');
    if (payload) {
      await invalidateAll();
      slides = structuredClone(data.slides);
      selectedId = slides[0]?.id ?? '';
      flash('ok', 'Slide deleted');
    }
  }

  /** PATCH position/parent for every slide of a plane so order is canonical. */
  async function renumberPlane(parentSlideId: string | null) {
    const plane = slides
      .filter((s) => s.parentSlideId === parentSlideId)
      .sort((a, b) => a.position - b.position);
    for (let i = 0; i < plane.length; i++) {
      if (plane[i].position !== i) plane[i].position = i;
      const payload = await api(`/api/decks/${data.deck.id}/slides/${plane[i].id}`, 'PATCH', {
        position: plane[i].position,
        parentSlideId,
      });
      if (payload?.slide) plane[i].version = (payload.slide as { version: number }).version;
    }
  }

  async function move(slide: EditSlide, dir: -1 | 1) {
    const plane = slides
      .filter((s) => s.parentSlideId === slide.parentSlideId)
      .sort((a, b) => a.position - b.position);
    const idx = plane.findIndex((s) => s.id === slide.id);
    const swap = plane[idx + dir];
    if (!swap) return;
    [slide.position, swap.position] = [swap.position, slide.position];
    await renumberPlane(slide.parentSlideId);
  }

  async function indent(slide: EditSlide) {
    const plane = slides
      .filter((s) => s.parentSlideId === slide.parentSlideId)
      .sort((a, b) => a.position - b.position);
    const idx = plane.findIndex((s) => s.id === slide.id);
    const newParent = plane[idx - 1];
    if (!newParent) return;
    const oldPlane = slide.parentSlideId;
    slide.parentSlideId = newParent.id;
    slide.position = (planes.get(newParent.id) ?? []).length;
    await renumberPlane(newParent.id);
    await renumberPlane(oldPlane);
  }

  async function outdent(slide: EditSlide) {
    if (slide.parentSlideId === null) return;
    const parent = slides.find((s) => s.id === slide.parentSlideId);
    if (!parent) return;
    const oldPlane = slide.parentSlideId;
    slide.parentSlideId = parent.parentSlideId;
    slide.position = parent.position + 0.5; // slot after the parent; renumber fixes integers
    await renumberPlane(parent.parentSlideId);
    await renumberPlane(oldPlane);
  }

  function addBlock() {
    if (!selected) return;
    const opt = TEMPLATE_OPTIONS.find((o) => o.key === addType);
    if (!opt) return;
    selected.blocks.push(structuredClone(opt.block));
    markDirty();
  }
  function removeBlock(i: number) {
    selected?.blocks.splice(i, 1);
    markDirty();
  }
  function moveBlock(i: number, dir: -1 | 1) {
    if (!selected) return;
    const j = i + dir;
    if (j < 0 || j >= selected.blocks.length) return;
    [selected.blocks[i], selected.blocks[j]] = [selected.blocks[j], selected.blocks[i]];
    markDirty();
  }
  function markDirty() {
    if (selected) dirty = { ...dirty, [selected.id]: true };
  }

  async function loadShares() {
    const payload = await api(`/api/decks/${data.deck.id}/share`, 'GET');
    if (payload) shares = payload.shares as typeof shares;
  }
  async function mintShare() {
    const payload = await api(`/api/decks/${data.deck.id}/share`, 'POST', { label: 'editor link' });
    if (payload) {
      freshToken = payload.token as string;
      await loadShares();
    }
  }
  async function revoke(id: string) {
    const payload = await api(`/api/decks/${data.deck.id}/share`, 'DELETE', { shareId: id });
    if (payload) await loadShares();
  }

  onMount(() => {
    void loadShares();
    try {
      const raw = localStorage.getItem('sr-decks-editor-panels');
      if (raw) {
        const p = JSON.parse(raw) as { l?: number; r?: number };
        if (typeof p.l === 'number') leftW = Math.min(560, Math.max(170, p.l));
        if (typeof p.r === 'number') rightW = Math.min(640, Math.max(240, p.r));
      }
    } catch {
      /* default widths */
    }
  });
</script>

<svelte:head>
  <title>edit · {data.deck.title} — sr. decks</title>
  <meta name="robots" content="noindex" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,500&family=DM+Sans:wght@400;500&family=JetBrains+Mono:wght@400;500;600&display=swap"
  />
</svelte:head>

{#snippet treeItem(id: string, depth: number)}
  {@const slide = slides.find((s) => s.id === id)}
  {#if slide}
    <li>
      <div class="tree-row" class:sel={selectedId === id} style:padding-left="{8 + depth * 16}px">
        <button class="tr-title" onclick={() => (selectedId = id)}>
          {slide.title ?? 'Untitled'}
          {#if dirty[id]}<span class="dot" title="Unsaved">●</span>{/if}
        </button>
        <span class="tr-ops">
          <button title="Move up" onclick={() => move(slide, -1)}>↑</button>
          <button title="Move down" onclick={() => move(slide, 1)}>↓</button>
          <button title="Nest under previous slide" onclick={() => indent(slide)}>⇥</button>
          <button title="Un-nest" onclick={() => outdent(slide)}>⇤</button>
          <button title="Delete" class="danger" onclick={() => deleteSlide(slide)}>✕</button>
        </span>
      </div>
      {#if (planes.get(id) ?? []).length}
        <ul>
          {#each planes.get(id) ?? [] as childId (childId)}
            {@render treeItem(childId, depth + 1)}
          {/each}
        </ul>
      {/if}
    </li>
  {/if}
{/snippet}

<div class="ed">
  <header class="ed-bar">
    <a class="back" href="/decks">← decks</a>
    <input class="ed-title" bind:value={deckTitle} onblur={saveMeta} />
    <button class="chip" class:public={isPublic} onclick={togglePublic}>{isPublic ? 'PUBLIC' : 'PRIVATE'}</button>
    <a class="chip play" href="/decks/{data.deck.slug}" target="_blank" rel="noopener">▶ play</a>
    <span class="spacer"></span>
    {#if banner}<span class="banner {banner.kind}">{banner.text}</span>{/if}
  </header>

  <div class="ed-cols" style:--lw="{leftW}px" style:--rw="{rightW}px">
    <aside class="ed-tree">
      <span class="pane-lab">SLIDES</span>
      <ul class="tree-root">
        {#each planes.get(null) ?? [] as id (id)}
          {@render treeItem(id, 0)}
        {/each}
      </ul>
      <div class="composer">
        <span class="pane-lab">ADD SLIDE</span>
        <textarea
          rows="4"
          bind:value={composeText}
          placeholder="Paste the content — text, a punchy line, stats like '24,000 — schools'. The deck decides how to show it."
        ></textarea>
        <input bind:value={composeMedia} placeholder="media / page URLs (comma-separated, optional)" />
        {#if attached.length}
          <div class="attach-chips">
            {#each attached as b, i (i)}
              <span class="attach-chip" role="button" draggable="true" ondragstart={(e) => chipDragStart(e, i)} title="Drag onto the slide, or compose with it">
                {blockLabel(b)}
                <button
                  title="Add to the selected slide now"
                  onclick={() => { if (selected) { selected.blocks.push($state.snapshot(b) as Block); attached = attached.filter((_, j) => j !== i); markDirty(); } }}
                  >→</button
                >
                <button title="Remove" onclick={() => (attached = attached.filter((_, j) => j !== i))}>✕</button>
              </span>
            {/each}
            <span class="attach-hint">drag a chip onto the slide, → adds it, or ✦ compose designs around them</span>
          </div>
        {/if}
        <button class="add-slide" onclick={() => (picker = 'compose')}>◈ add site media…</button>
        <label class="nest-check">
          <input type="checkbox" bind:checked={composeNest} /> nest under selected slide
        </label>
        <div class="composer-btns">
          <button
            class="compose-btn"
            disabled={composing || (!composeText.trim() && !composeMedia.trim() && attached.length === 0)}
            onclick={composeNewSlide}
          >
            {composing ? 'composing…' : '✦ compose slide'}
          </button>
          <button class="add-slide" onclick={() => { const t = insertTarget(); void addSlide(t.parentSlideId, t.position); }}>
            + blank
          </button>
        </div>
      </div>

      <div class="shares">
        <span class="pane-lab">SHARE LINKS</span>
        {#if freshToken}
          <p class="fresh">New link (copy now — shown once):<br /><code>/decks/{data.deck.slug}?t={freshToken}</code></p>
        {/if}
        <ul>
          {#each shares.filter((s) => !s.revokedAt) as s (s.id)}
            <li class="share-row">
              <span>{s.label ?? 'link'} · {s.useCount} uses</span>
              <button class="danger" onclick={() => revoke(s.id)}>revoke</button>
            </li>
          {/each}
        </ul>
        <button class="add-slide" onclick={mintShare}>+ share link</button>
      </div>
    </aside>

    <div
      class="col-div"
      role="separator"
      aria-orientation="vertical"
      onpointerdown={(e) => startDivider('l', e)}
      onpointermove={moveDivider}
      onpointerup={endDivider}
    ></div>

    <main class="ed-preview">
      {#if previewSlide}
        <div class="preview-toolbar">
          <button class="arr-btn" class:active={arranging} onclick={toggleArrange}>
            {arranging ? '✓ done arranging' : '⊞ arrange'}
          </button>
          {#if selected.geometry}
            <button class="arr-btn danger" onclick={resetArrange}>reset to layout</button>
            <span class="arr-note">hand-laid — drag to move, right edge to resize width</span>
          {/if}
        </div>
        <div
          class="preview-frame"
          class:arranging
          role="region"
          aria-label="Slide preview (drop site media here)"
          ondragover={(e) => e.preventDefault()}
          ondrop={previewDrop}
        >
          <div class="preview-theme" bind:this={previewEl}>
            <SlideView slide={previewSlide} />
          </div>
          {#if arranging && selected.geometry}
            <div class="arr-overlay">
              {#each Object.entries(selected.geometry) as [bi, f] (bi)}
                <div
                  class="arr-frame"
                  role="button"
                  aria-label="Move block"
                  tabindex="-1"
                  style:left="{f.x}%"
                  style:top="{f.y}%"
                  style:width="{f.w}%"
                  onpointerdown={(e) => startFrame(bi, 'move', e)}
                  onpointermove={moveFrame}
                  onpointerup={endFrame}
                >
                  <span class="arr-tag">{selected.blocks[Number(bi)]?.type ?? bi}</span>
                  <span
                    class="arr-resize"
                    role="button"
                    aria-label="Resize block width"
                    tabindex="-1"
                    onpointerdown={(e) => startFrame(bi, 'resize', e)}
                    onpointermove={moveFrame}
                    onpointerup={endFrame}
                  ></span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
        <div class="preview-meta">
          <label>
            <span class="pane-lab">SLIDE TITLE</span>
            <input value={selected.title ?? ''} oninput={(e) => { selected.title = e.currentTarget.value; markDirty(); }} />
          </label>
          <label>
            <span class="pane-lab">LAYOUT</span>
            <select value={selected.layout} onchange={(e) => { selected.layout = e.currentTarget.value; markDirty(); }}>
              {#each LAYOUT_IDS as id (id)}<option value={id}>{id}</option>{/each}
            </select>
          </label>
          {#if (planes.get(selected.id) ?? []).length}
            <label>
              <span class="pane-lab">JOURNEY LABEL</span>
              <input
                value={selected.journeyLabel ?? ''}
                placeholder="the pill: “down for …”"
                oninput={(e) => { selected.journeyLabel = e.currentTarget.value; markDirty(); }}
              />
            </label>
          {/if}
          <label class="notes">
            <span class="pane-lab">NOTES</span>
            <input value={selected.notes ?? ''} oninput={(e) => { selected.notes = e.currentTarget.value; markDirty(); }} />
          </label>
        </div>
      {/if}
    </main>

    <div
      class="col-div"
      role="separator"
      aria-orientation="vertical"
      onpointerdown={(e) => startDivider('r', e)}
      onpointermove={moveDivider}
      onpointerup={endDivider}
    ></div>

    <aside class="ed-blocks">
      <span class="pane-lab">BLOCKS</span>
      {#if selected}
        {#each selected.blocks as block, i (i)}
          <details class="blk" open={selected.blocks.length <= 3}>
            <summary>
              <span class="blk-type">{block.type}</span>
              <span class="blk-ops">
                <button title="Up" onclick={(e) => { e.preventDefault(); moveBlock(i, -1); }}>↑</button>
                <button title="Down" onclick={(e) => { e.preventDefault(); moveBlock(i, 1); }}>↓</button>
                <button title="Remove" class="danger" onclick={(e) => { e.preventDefault(); removeBlock(i); }}>✕</button>
              </span>
            </summary>
            <BlockForm block={block as unknown as Record<string, unknown>} onEdited={markDirty} />
          </details>
        {/each}
        <div class="add-block">
          <select bind:value={addType}>
            {#each TEMPLATE_OPTIONS as o (o.key)}<option value={o.key}>{o.label}</option>{/each}
          </select>
          <button onclick={addBlock}>+ block</button>
          <button onclick={() => (picker = 'block')} title="Insert an interactive, page or image from the site">◈ site</button>
        </div>
        <button class="save-btn" disabled={saving || !dirty[selected.id]} onclick={() => saveSlide(selected)}>
          {saving ? 'Saving…' : dirty[selected.id] ? 'Save slide' : 'Saved'}
        </button>
      {/if}
    </aside>
  </div>
</div>

{#if picker !== 'closed'}
  <SiteMediaPicker catalogue={data.mediaCatalogue} onInsert={onPicked} onClose={() => (picker = 'closed')} />
{/if}

<style>
  .ed { min-height: 100vh; display: flex; flex-direction: column; background: var(--bg); }
  .ed-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 2px solid var(--text-primary);
  }
  .back {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
  }
  .ed-title {
    font-family: var(--font-display);
    font-size: 18px;
    color: var(--text-primary);
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    padding: 4px 8px;
    min-width: 320px;
  }
  .ed-title:hover, .ed-title:focus { border-color: var(--card-border); background: var(--card-bg); }
  .chip {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.14em;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    background: none;
    padding: 4px 10px;
    cursor: pointer;
    text-decoration: none;
  }
  .chip.public { color: var(--success); border-color: var(--success); }
  .chip.play { color: var(--accent); border-color: var(--accent); }
  .spacer { flex: 1; }
  .banner { font-family: var(--font-mono); font-size: 10.5px; padding: 4px 10px; border-radius: 2px; }
  .banner.ok { color: var(--success); border: 1px solid var(--success); }
  .banner.err { color: var(--error); border: 1px solid var(--error); }

  .ed-cols {
    flex: 1;
    display: grid;
    /* side panel widths are user-resizable via the dividers (--lw/--rw) */
    grid-template-columns: var(--lw, 250px) 6px 1fr 6px var(--rw, 330px);
    gap: 0;
    min-height: 0;
  }
  .col-div {
    cursor: col-resize;
    background: transparent;
    border-left: 1px solid var(--card-border);
    touch-action: none;
  }
  .col-div:hover { border-left: 2px solid var(--accent); }
  .pane-lab {
    display: block;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--text-muted);
    margin: 0 0 8px;
  }

  .ed-tree { border-right: 1px solid var(--card-border); padding: 14px 10px; overflow-y: auto; }
  .tree-root, .ed-tree ul { list-style: none; margin: 0; padding: 0; }
  .tree-row { display: flex; align-items: center; gap: 4px; border-radius: 2px; }
  .tree-row.sel { background: var(--accent-tint-04); outline: 1px solid var(--accent); }
  .tr-title {
    flex: 1;
    text-align: left;
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: none;
    border: none;
    padding: 6px 4px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot { color: var(--warn); font-size: 9px; margin-left: 4px; }
  .tr-ops { display: none; gap: 1px; }
  .tree-row:hover .tr-ops, .tree-row.sel .tr-ops { display: inline-flex; }
  .tr-ops button {
    font-size: 10px;
    color: var(--text-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 3px;
  }
  .tr-ops button:hover { color: var(--accent); }
  .tr-ops button.danger:hover { color: var(--error); }
  .add-slide {
    display: block;
    width: 100%;
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    background: none;
    border: 1px dashed var(--card-border);
    border-radius: 2px;
    padding: 6px;
    cursor: pointer;
  }
  .add-slide:hover { color: var(--accent); border-color: var(--accent); }

  .composer { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }
  .composer textarea,
  .composer input[type='text'],
  .composer > input {
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 7px 8px;
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
  }
  .nest-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .composer-btns { display: flex; gap: 6px; }
  .attach-chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .attach-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.05em;
    color: var(--accent-ink);
    border: 1px solid var(--accent-ink);
    border-radius: 2px;
    padding: 3px 6px;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attach-chip { cursor: grab; }
  .attach-chip button { color: var(--text-muted); background: none; border: none; cursor: pointer; font-size: 9px; padding: 0; }
  .attach-chip button:hover { color: var(--error); }
  .attach-chip button:first-of-type:hover { color: var(--accent); }
  .attach-hint { font-family: var(--font-mono); font-size: 8px; color: var(--text-ghost); }
  .composer-btns .add-slide { margin-top: 0; width: auto; padding: 6px 10px; }
  .compose-btn {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--accent-ink);
    border: none;
    border-radius: 2px;
    padding: 8px;
    cursor: pointer;
  }
  .compose-btn:hover { background: var(--accent-ink-hover); }
  .compose-btn:disabled { opacity: 0.45; cursor: default; }
  .shares { margin-top: 22px; }
  .shares ul { list-style: none; margin: 0 0 8px; padding: 0; }
  .share-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    padding: 4px 0;
  }
  .share-row .danger { color: var(--text-muted); background: none; border: none; cursor: pointer; font-family: var(--font-mono); font-size: 9px; }
  .share-row .danger:hover { color: var(--error); }
  .fresh { font-family: var(--font-mono); font-size: 9.5px; color: var(--success); word-break: break-all; }
  .fresh code { font-size: 9px; }

  .ed-preview { padding: 16px; overflow-y: auto; min-width: 0; }
  .preview-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .arr-btn {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: none;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .arr-btn:hover, .arr-btn.active { color: var(--accent); border-color: var(--accent); }
  .arr-btn.danger:hover { color: var(--error); border-color: var(--error); }
  .arr-note { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-ghost); }
  .preview-frame {
    border: 1px solid var(--card-border);
    border-radius: 4px;
    overflow: hidden;
    aspect-ratio: 16 / 10;
    position: relative;
  }
  .preview-frame.arranging { user-select: none; }
  .arr-overlay { position: absolute; inset: 0; z-index: 5; }
  .arr-frame {
    position: absolute;
    min-height: 28px;
    height: auto;
    border: 1.5px dashed var(--accent);
    border-radius: 2px;
    background: rgba(196, 87, 10, 0.06);
    cursor: grab;
    touch-action: none;
  }
  .arr-frame:active { cursor: grabbing; }
  .arr-tag {
    position: absolute;
    top: -16px;
    left: 0;
    font-family: var(--font-mono);
    font-size: 8.5px;
    letter-spacing: 0.08em;
    color: var(--bg);
    background: var(--accent);
    border-radius: 2px;
    padding: 1px 5px;
  }
  .arr-resize {
    position: absolute;
    right: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 26px;
    background: var(--accent);
    border-radius: 2px;
    cursor: ew-resize;
    touch-action: none;
  }
  .preview-theme {
    --paper: var(--bg);
    --paper-deep: var(--surface-elevated);
    --ink: var(--text-primary);
    --ink-soft: var(--text-muted);
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 90% 50% at 50% 0%, rgba(255, 255, 255, 0.4), transparent 60%), var(--paper);
    color: var(--ink);
    font-family: 'DM Sans', system-ui, sans-serif;
    overflow: hidden;
  }
  .preview-meta { display: flex; gap: 14px; margin-top: 12px; }
  .preview-meta label { display: flex; flex-direction: column; gap: 4px; }
  .preview-meta .notes { flex: 1; }
  .preview-meta input,
  .preview-meta select {
    font-family: var(--font-body);
    font-size: 12.5px;
    color: var(--text-primary);
    background: var(--bg);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 6px 8px;
  }

  .ed-blocks { border-left: 1px solid var(--card-border); padding: 14px 12px; overflow-y: auto; }
  .blk { border: 1px solid var(--card-border); border-radius: 2px; margin-bottom: 8px; background: var(--card-bg); }
  .blk summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    cursor: pointer;
    list-style: none;
  }
  .blk-type { font-family: var(--font-mono); font-size: 10.5px; letter-spacing: 0.1em; color: var(--accent-ink); }
  .blk-ops { display: inline-flex; gap: 2px; }
  .blk-ops button { font-size: 10px; color: var(--text-muted); background: none; border: none; cursor: pointer; padding: 2px 4px; }
  .blk-ops button:hover { color: var(--accent); }
  .blk-ops button.danger:hover { color: var(--error); }
  .blk > :global(.bf) { padding: 4px 10px 12px; }
  .add-block { display: flex; gap: 6px; margin: 10px 0; }
  .add-block select {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 6px;
  }
  .add-block button {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    background: none;
    border: 1px dashed var(--card-border);
    border-radius: 2px;
    padding: 6px 12px;
    cursor: pointer;
  }
  .add-block button:hover { color: var(--accent); border-color: var(--accent); }
  .save-btn {
    display: block;
    width: 100%;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--bg);
    background: var(--text-primary);
    border: none;
    border-radius: 2px;
    padding: 10px;
    cursor: pointer;
  }
  .save-btn:disabled { opacity: 0.45; cursor: default; }

  @media (max-width: 1100px) {
    .ed-cols { grid-template-columns: 220px 1fr; }
    .col-div { display: none; }
    .ed-blocks { grid-column: 1 / -1; border-left: none; border-top: 1px solid var(--card-border); }
  }
</style>
