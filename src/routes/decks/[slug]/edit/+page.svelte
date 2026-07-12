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
  import { PROSE_STYLES, QUOTE_STYLES } from '$lib/presentation/styles';
  import type { Block, BlockType, SlideNode } from '$lib/presentation/types';
  import BlockForm from './BlockForm.svelte';
  import SiteMediaPicker from './SiteMediaPicker.svelte';
  import { EDITABLE_FIELDS, htmlToMarkdownLite } from './canvas-text';

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
  let shares = $state<{ id: string; label: string | null; revokedAt: string | null; useCount: number; slidesReached: number }[]>([]);
  let exporting = $state(false);
  let exportError = $state('');
  /** Canvas host width — scales the fixed 1280×720 stage to fit the pane. */
  let pvW = $state(0);
  let freshToken = $state<string | null>(null);
  let composeText = $state('');
  let composeMedia = $state('');
  let composeNest = $state(false);
  let composing = $state(false);
  /** AI composer target: revise the selected slide, or compose a new one. */
  let llmMode = $state<'edit' | 'new'>('edit');
  let picker = $state<'closed' | 'block'>('closed');

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

  // --- canvas editing: selection, inline text, drag/resize (always on) ---
  let previewEl: HTMLElement | undefined; // plain let — measured, never rendered from
  let selBlock = $state<number | null>(null);
  /** px rect of the selected block within the preview frame (drives the
   *  hover toolbar + handles when the slide isn't hand-laid yet). */
  let selRect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let addMenu = $state(false);
  // inline-edit + frame-drag internals — plain lets (svelte5-pitfalls §1)
  let frameDrag: { bi: string; mode: 'move' | 'resize'; px: number; py: number; f: BlockFrame } | null = null;
  let editableCleanups: (() => void)[] = [];
  let activeCommits: (() => void)[] = [];
  let raisedEl: HTMLElement | null = null;

  /** The last-selected object always sits on top — overlapping blocks stay
   *  reachable (grab the buried one from the panel, it surfaces). */
  function raiseSelected() {
    raisedEl?.classList.remove('sel-raised');
    raisedEl = null;
    if (selBlock === null || !previewEl) return;
    const el = previewEl.querySelector<HTMLElement>(`.block[data-bi="${selBlock}"]`);
    if (el) {
      el.classList.add('sel-raised');
      raisedEl = el;
    }
  }

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

  function resetArrange() {
    if (!selected) return;
    selected.geometry = null;
    markDirty();
    requestAnimationFrame(measureSelRect);
  }

  function startFrame(bi: string, mode: 'move' | 'resize', e: PointerEvent) {
    if (!selected) return;
    commitActive();
    // First drag hand-lays the slide: measure the archetype's positions once.
    if (!selected.geometry || Object.keys(selected.geometry).length === 0) {
      selected.geometry = measureGeometry();
      markDirty();
    }
    // A block added AFTER the slide was hand-laid has no frame yet — measure
    // it (or seed a sensible one) so it can be moved/resized immediately.
    if (!selected.geometry[bi]) {
      const host = previewEl?.getBoundingClientRect();
      const el = previewEl?.querySelector<HTMLElement>(`.block[data-bi="${bi}"]`);
      if (host && el) {
        const r = el.getBoundingClientRect();
        selected.geometry[bi] = {
          x: Math.round(((r.left - host.left) / host.width) * 1000) / 10,
          y: Math.round(((r.top - host.top) / host.height) * 1000) / 10,
          w: Math.round((r.width / host.width) * 1000) / 10,
        };
      } else {
        selected.geometry[bi] = { x: 30, y: 35, w: 40 };
      }
      markDirty();
    }
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
    requestAnimationFrame(measureSelRect);
  }

  // --- selection + inline editing ---

  function measureSelRect() {
    if (selBlock === null || !previewEl) {
      selRect = null;
      return;
    }
    const host = previewEl.getBoundingClientRect();
    const el = previewEl.querySelector<HTMLElement>(`.block[data-bi="${selBlock}"]`);
    if (!el) {
      selRect = null;
      return;
    }
    const r = el.getBoundingClientRect();
    selRect = { x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height };
  }

  /** Commit any in-progress inline edits back into the block data. */
  function commitActive() {
    for (const commit of activeCommits) commit();
  }

  function detachEditables() {
    commitActive();
    for (const c of editableCleanups) c();
    editableCleanups = [];
    activeCommits = [];
  }

  function attachEditables() {
    detachEditables();
    if (selBlock === null || !selected || !previewEl) return;
    const block = selected.blocks[selBlock] as unknown as Record<string, unknown>;
    if (!block) return;
    const blockEl = previewEl.querySelector<HTMLElement>(`.block[data-bi="${selBlock}"]`);
    if (!blockEl) return;
    for (const def of EDITABLE_FIELDS[String(block.type)] ?? []) {
      const el = blockEl.querySelector<HTMLElement>(def.selector);
      if (!el) continue;
      el.contentEditable = 'true';
      el.spellcheck = false;
      el.classList.add('ce-live');
      const commit = () => {
        let next: string;
        if (def.rich) {
          next = htmlToMarkdownLite(el);
        } else {
          next = (el.textContent ?? '').trim();
          if (def.stripQuotes) next = next.replace(/^[“"]|[”"]$/g, '');
        }
        if (next && next !== block[def.field]) {
          block[def.field] = next;
          markDirty();
        }
      };
      const onBlur = () => commit();
      const onKeydown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          document.execCommand({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]!);
        }
        // Ctrl/Cmd+Enter in a cards prose = start a new card
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && def.rich && (block.style ?? '') === 'cards') {
          e.preventDefault();
          addCard();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          el.blur();
        }
        e.stopPropagation(); // typing must not trigger editor shortcuts
      };
      el.addEventListener('blur', onBlur);
      el.addEventListener('keydown', onKeydown);
      activeCommits.push(commit);
      editableCleanups.push(() => {
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('keydown', onKeydown);
        el.contentEditable = 'false';
        el.classList.remove('ce-live');
      });
    }
  }

  function selectBlock(bi: number | null) {
    if (selBlock !== null && bi !== selBlock) detachEditables();
    selBlock = bi;
    addMenu = false;
    requestAnimationFrame(() => {
      raiseSelected();
      measureSelRect();
      attachEditables();
    });
  }

  function onCanvasPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.sel-toolbar, .sel-handle, .add-fab, .add-menu')) return;
    const blockEl = target?.closest<HTMLElement>('.block[data-bi]');
    if (!blockEl) {
      selectBlock(null);
      return;
    }
    const bi = Number(blockEl.dataset.bi);
    if (bi !== selBlock) selectBlock(bi);
    // Non-text blocks drag from anywhere; text blocks drag via the ⠿ grip.
    const type = String((selected?.blocks[bi] as { type?: string } | undefined)?.type ?? '');
    if (['image', 'chart', 'embed', 'iframe', 'statRow', 'timeline'].includes(type)) {
      startFrame(String(bi), 'move', e);
    }
  }

  /** execCommand keeps the live selection — toolbar buttons must not steal
   *  focus from the contenteditable (pointerdown preventDefault). */
  function fmt(cmd: string, value?: string) {
    document.execCommand(cmd, false, value);
  }

  /** Append a fresh card to a cards-style prose block and re-render. */
  function addCard() {
    if (selBlock === null || !selected) return;
    commitActive();
    const b = selected.blocks[selBlock] as unknown as Record<string, unknown>;
    b.body = `${String(b.body ?? '').trim()}\n\n**New card** — detail goes here.`;
    markDirty();
    requestAnimationFrame(() => {
      measureSelRect();
      attachEditables();
    });
  }

  function setSelStyle(style: string) {
    if (selBlock === null || !selected) return;
    commitActive();
    const b = selected.blocks[selBlock] as unknown as Record<string, unknown>;
    b.style = style;
    delete b.lede;
    markDirty();
    requestAnimationFrame(() => {
      measureSelRect();
      attachEditables();
    });
  }

  /** Keep geometry keys aligned when blocks reorder/delete. */
  function remapGeometry(map: (i: number) => number | null) {
    if (!selected?.geometry) return;
    const next: Record<string, BlockFrame> = {};
    for (const [k, f] of Object.entries(selected.geometry)) {
      const to = map(Number(k));
      if (to !== null) next[String(to)] = f;
    }
    selected.geometry = next;
  }

  function deleteSelBlock() {
    if (selBlock === null || !selected) return;
    detachEditables();
    const bi = selBlock;
    selected.blocks.splice(bi, 1);
    remapGeometry((i) => (i === bi ? null : i > bi ? i - 1 : i));
    selBlock = null;
    selRect = null;
    markDirty();
  }

  function addBlockFromMenu(block: Block) {
    if (!selected) return;
    commitActive();
    selected.blocks.push(structuredClone(block));
    const bi = selected.blocks.length - 1;
    // On a hand-laid slide a new block needs its own frame at once — placed
    // clear of the top-left so it never buries an existing block.
    if (selected.geometry && Object.keys(selected.geometry).length > 0) {
      selected.geometry[String(bi)] = { x: 28 + (bi % 3) * 6, y: 30 + (bi % 4) * 8, w: 44 };
    }
    addMenu = false;
    markDirty();
    requestAnimationFrame(() => selectBlock(bi));
  }


  // The add-block menu, grouped by what the block does: chart expanded per
  // kind, atmosphere seeded per effect category.
  const tpl = (t: BlockType) => ({ key: t, label: t, block: BLOCK_TEMPLATES[t] });
  const TEMPLATE_GROUPS: { label: string; items: { key: string; label: string; block: Block }[] }[] = [
    { label: 'TEXT', items: (['masthead', 'headline', 'prose', 'quote', 'code'] as BlockType[]).map(tpl) },
    {
      label: 'DATA',
      items: [
        ...(['bigNumber', 'statRow', 'timeline'] as BlockType[]).map(tpl),
        ...Object.entries(CHART_TEMPLATES).map(([k, b]) => ({ key: `chart:${k}`, label: `chart · ${k}`, block: b as Block })),
      ],
    },
    { label: 'MEDIA', items: (['image', 'video', 'iframe', 'embed'] as BlockType[]).map(tpl) },
    {
      label: 'ATMOSPHERE',
      items: [
        { key: 'fx:particles', label: 'particle field', block: { type: 'effect', effect: 'drift', role: 'background', intensity: 0.5, tint: 'ink' } as Block },
        { key: 'fx:print', label: 'print & type', block: { type: 'effect', effect: 'halftone', role: 'background', intensity: 0.5, tint: 'ink' } as Block },
        { key: 'fx:live', label: 'live data', block: { type: 'effect', effect: 'heartbeat', role: 'background', intensity: 0.5, tint: 'accent' } as Block },
        { key: 'fx:wipe', label: 'wipe on arrival', block: { type: 'effect', effect: 'slats', role: 'transition', intensity: 0.5, tint: 'ink' } as Block },
      ],
    },
  ];

  function onPicked(block: Block) {
    if (selected) {
      selected.blocks.push(block);
      markDirty();
    }
    picker = 'closed';
  }

  const planes = $derived(buildPlanes(slides));
  const selected = $derived(slides.find((s) => s.id === selectedId) ?? slides[0]);
  const selType = $derived(
    selBlock !== null ? ((selected?.blocks[selBlock] as { type?: string } | undefined)?.type ?? null) : null,
  );
  const selIsText = $derived(selType !== null && selType in EDITABLE_FIELDS);
  const selFrame = $derived(
    selBlock !== null && selected?.geometry ? (selected.geometry[String(selBlock)] ?? null) : null,
  );
  const selProseStyle = $derived.by(() => {
    if (selType !== 'prose' || selBlock === null || !selected) return 'body';
    const b = selected.blocks[selBlock] as { style?: string; lede?: boolean };
    return b.style ?? (b.lede ? 'lede' : 'body');
  });
  const selQuoteStyle = $derived.by(() => {
    if (selType !== 'quote' || selBlock === null || !selected) return 'rail';
    return (selected.blocks[selBlock] as { style?: string }).style ?? 'rail';
  });
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
    commitActive();
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

  const composeMediaUrls = () =>
    composeMedia
      .split(/[,\n]/)
      .map((u) => u.trim())
      .filter(Boolean);

  async function composeNewSlide() {
    const target = insertTarget();
    composing = true;
    const payload = await api(`/api/decks/${data.deck.id}/slides/compose`, 'POST', {
      text: composeText,
      mediaUrls: composeMediaUrls(),
      ...target,
    });
    composing = false;
    if (payload?.slide) {
      adoptNewSlide(payload, target.parentSlideId, target.position);
      composeText = '';
      composeMedia = '';
      const layout = (payload.slide as { layout?: string }).layout;
      flash('ok', payload.source === 'llm' ? `Composed → ${layout}` : 'Composed (fallback layout — LLM unavailable)');
    }
  }

  /** LLM revision of the selected slide — applied locally as a dirty edit so
   *  the normal save (and not-saving) path stays the undo story. */
  async function reviseSelected() {
    if (!selected || composing) return;
    commitActive();
    detachEditables();
    composing = true;
    const payload = await api(`/api/decks/${data.deck.id}/slides/revise`, 'POST', {
      instruction: composeText,
      mediaUrls: composeMediaUrls(),
      slide: {
        title: selected.title,
        layout: selected.layout,
        blocks: $state.snapshot(selected.blocks),
      },
    });
    composing = false;
    if (payload?.slide) {
      const s = payload.slide as { title: string | null; layout: string; blocks: Block[] };
      selected.title = s.title;
      selected.layout = s.layout;
      selected.blocks = s.blocks;
      // The model re-art-directs the slide — hand-laid frames no longer align.
      selected.geometry = null;
      selBlock = null;
      selRect = null;
      composeText = '';
      composeMedia = '';
      markDirty();
      flash('ok', `Revised → ${s.layout} — review, then save`);
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

  function removeBlock(i: number) {
    detachEditables();
    selBlock = null;
    selRect = null;
    selected?.blocks.splice(i, 1);
    remapGeometry((k) => (k === i ? null : k > i ? k - 1 : k));
    markDirty();
  }
  function moveBlock(i: number, dir: -1 | 1) {
    if (!selected) return;
    const j = i + dir;
    if (j < 0 || j >= selected.blocks.length) return;
    [selected.blocks[i], selected.blocks[j]] = [selected.blocks[j], selected.blocks[i]];
    remapGeometry((k) => (k === i ? j : k === j ? i : k));
    markDirty();
  }
  function markDirty() {
    if (selected) dirty = { ...dirty, [selected.id]: true };
  }

  async function loadShares() {
    const payload = await api(`/api/decks/${data.deck.id}/share`, 'GET');
    if (payload) shares = payload.shares as typeof shares;
  }

  /** Server-side PDF export (headless render of /print) — also refreshes the
   *  deck's OG poster from slide 1. Takes ~10–20s; keep the button honest. */
  async function exportPdf() {
    if (exporting) return;
    exporting = true;
    exportError = '';
    try {
      const res = await fetch(`/api/decks/${data.deck.id}/export`);
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${data.deck.slug}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      exportError = err instanceof Error ? err.message : 'export failed';
    } finally {
      exporting = false;
    }
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
        <button class="tr-title" onclick={() => { detachEditables(); selBlock = null; selRect = null; selectedId = id; }}>
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
      <button
        class="add-slide"
        onclick={() => void addSlide(selected?.parentSlideId ?? null, (selected?.position ?? -1) + 1)}
      >
        + blank slide
      </button>
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
        <div class="preview-toolbar">
          <span class="arr-note">click a block to select & type · ⠿ moves it · right handle resizes</span>
          {#if selected.geometry}
            <button class="arr-btn danger" onclick={resetArrange}>reset to layout</button>
            <span class="arr-note">hand-laid</span>
          {/if}
        </div>
        <div
          class="preview-frame"
          role="region"
          aria-label="Slide canvas — click to select, type to edit"
          onpointerdown={onCanvasPointerDown}
          onpointermove={moveFrame}
          onpointerup={endFrame}
        >
          <div class="preview-theme" bind:this={previewEl} bind:clientWidth={pvW}>
            <!-- Fixed 1280×720 design canvas scaled to the pane — the editor
                 shows exactly the player's proportions at any pane width.
                 previewEl (the visual box) stays the measurement host, so all
                 %-based geometry math is scale-agnostic. -->
            <div class="pv-stage" style:transform={`scale(${pvW ? pvW / 1280 : 1})`}>
              <SlideView slide={previewSlide} />
            </div>
          </div>

          {#if selBlock !== null && (selFrame || selRect)}
            {@const left = selFrame ? `${selFrame.x}%` : `${selRect?.x ?? 0}px`}
            {@const top = selFrame ? `${selFrame.y}%` : `${selRect?.y ?? 0}px`}
            {@const width = selFrame ? `${selFrame.w}%` : `${selRect?.w ?? 0}px`}
            {@const tbLeft = selFrame ? `${Math.max(0.6, selFrame.x)}%` : `${Math.max(6, selRect?.x ?? 0)}px`}
            {@const tbTop = selFrame ? `${Math.max(1, selFrame.y)}%` : `${Math.max(6, selRect?.y ?? 0)}px`}
            <div class="sel-frame" style:left={left} style:top={top} style:width={width} style:height={selFrame ? 'auto' : `${selRect?.h ?? 0}px`}>
              <span
                class="sel-handle sel-resize"
                role="button"
                aria-label="Resize block width"
                tabindex="-1"
                onpointerdown={(e) => startFrame(String(selBlock), 'resize', e)}
              ></span>
            </div>
            {@const nearTop = selFrame ? selFrame.y < 7 : (selRect?.y ?? 0) < 44}
            <div class="sel-toolbar" class:below={nearTop} style:left={tbLeft} style:top={tbTop}>
              <span
                class="sel-handle sel-grip"
                role="button"
                aria-label="Move block"
                tabindex="-1"
                title="Drag to move"
                onpointerdown={(e) => startFrame(String(selBlock), 'move', e)}>⠿</span
              >
              {#if selType === 'prose'}
                <select
                  class="sel-style"
                  value={selProseStyle}
                  onpointerdown={(e) => e.stopPropagation()}
                  onchange={(e) => setSelStyle(e.currentTarget.value)}
                >
                  {#each PROSE_STYLES as s (s.id)}<option value={s.id}>{s.id}</option>{/each}
                </select>
                {#each [1, 2, 3, 4] as h (h)}
                  <button onpointerdown={(e) => e.preventDefault()} onclick={() => fmt('formatBlock', `H${h}`)}>H{h}</button>
                {/each}
                <button class="fb" onpointerdown={(e) => e.preventDefault()} onclick={() => fmt('bold')}>B</button>
                <button class="fi" onpointerdown={(e) => e.preventDefault()} onclick={() => fmt('italic')}>I</button>
                <button class="fu" onpointerdown={(e) => e.preventDefault()} onclick={() => fmt('underline')}>U</button>
                <button title="Bullet list" onpointerdown={(e) => e.preventDefault()} onclick={() => fmt('insertUnorderedList')}>•</button>
                {#if selProseStyle === 'cards'}
                  <button title="New card (Ctrl+Enter)" onpointerdown={(e) => e.preventDefault()} onclick={addCard}>+card</button>
                {/if}
              {:else if selType === 'quote'}
                <select
                  class="sel-style"
                  value={selQuoteStyle}
                  onpointerdown={(e) => e.stopPropagation()}
                  onchange={(e) => setSelStyle(e.currentTarget.value)}
                >
                  {#each QUOTE_STYLES as s (s.id)}<option value={s.id}>{s.id}</option>{/each}
                </select>
              {:else if selType === 'chart'}
                <span class="sel-tag">chart — edit via the panel →</span>
              {:else}
                <span class="sel-tag">{selType}</span>
              {/if}
              <button class="sel-del" title="Delete block" onclick={deleteSelBlock}>✕</button>
            </div>
          {/if}

          <button class="add-fab" title="Add a block" onclick={() => (addMenu = !addMenu)}>＋</button>
          {#if addMenu}
            <div class="add-menu">
              {#each TEMPLATE_GROUPS as g (g.label)}
                <span class="add-cat">{g.label}</span>
                {#each g.items as o (o.key)}
                  <button onclick={() => addBlockFromMenu(o.block)}>{o.label}</button>
                {/each}
                {#if g.label === 'MEDIA'}
                  <button class="site-entry" onclick={() => { addMenu = false; picker = 'block'; }}>◈ site media…</button>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
        <div class="desk">
          <div class="desk-col">
            <span class="pane-lab">SLIDE</span>
            <button class="save-btn" disabled={saving || !dirty[selected.id]} onclick={() => saveSlide(selected)}>
              {saving ? 'Saving…' : dirty[selected.id] ? 'Save slide' : 'Saved'}
            </button>
            <div class="shares">
              <span class="pane-lab">SHARE LINKS</span>
              {#if freshToken}
                <p class="fresh">New link (copy now — shown once):<br /><code>/decks/{data.deck.slug}?t={freshToken}</code></p>
              {/if}
              <ul>
                {#each shares.filter((s) => !s.revokedAt) as s (s.id)}
                  <li class="share-row">
                    <span>{s.label ?? 'link'} · {s.useCount} uses · reached {s.slidesReached}/{slides.length}</span>
                    <button class="danger" onclick={() => revoke(s.id)}>revoke</button>
                  </li>
                {/each}
              </ul>
              <button class="add-slide" onclick={mintShare}>+ share link</button>
            </div>
            <div class="export">
              <span class="pane-lab">EXPORT</span>
              <button class="add-slide" disabled={exporting} onclick={exportPdf}>
                {exporting ? 'rendering…' : '⤓ export pdf'}
              </button>
              {#if exportError}<span class="export-err">{exportError}</span>{/if}
            </div>
            <div class="deck-meta">
              <span class="pane-lab">DECK DESCRIPTION</span>
              <textarea
                rows="2"
                bind:value={deckDescription}
                onblur={saveMeta}
                placeholder="one line for the /decks index and share cards"
              ></textarea>
            </div>
          </div>

          <div class="desk-col">
            <div class="ai-head">
              <span class="pane-lab">AI COMPOSER</span>
              <div class="mode-toggle">
                <button class:on={llmMode === 'edit'} onclick={() => (llmMode = 'edit')}>✎ this slide</button>
                <button class:on={llmMode === 'new'} onclick={() => (llmMode = 'new')}>＋ new slide</button>
              </div>
            </div>
            <textarea
              rows="5"
              bind:value={composeText}
              placeholder={llmMode === 'edit'
                ? 'Tell the model what to change — “tighten the headline”, “make the number the hero”, “stage the three points”.'
                : "Paste the content — text, a punchy line, stats like '24,000 — schools'. The deck decides how to show it."}
            ></textarea>
            <input bind:value={composeMedia} placeholder="media / page URLs (comma-separated, optional)" />
            {#if llmMode === 'new'}
              <label class="nest-check">
                <input type="checkbox" bind:checked={composeNest} /> nest under selected slide
              </label>
            {/if}
            <button
              class="compose-btn"
              disabled={composing || (llmMode === 'edit' ? !composeText.trim() : !composeText.trim() && !composeMedia.trim())}
              onclick={llmMode === 'edit' ? reviseSelected : composeNewSlide}
            >
              {composing ? 'composing…' : llmMode === 'edit' ? '✦ apply to this slide' : '✦ compose slide'}
            </button>
          </div>
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
          <details class="blk" class:on-canvas={selBlock === i} open={selected.blocks.length <= 3}>
            <summary onclick={() => selectBlock(i)}>
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

  /* the desk — deck-wide controls (left) + AI composer (right) under the canvas */
  .desk {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 26px;
    align-items: start;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid var(--card-border);
  }
  .desk-col { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .desk textarea,
  .desk input:not([type='checkbox']) {
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
  .ai-head { display: flex; align-items: center; justify-content: space-between; }
  .ai-head .pane-lab { margin: 0; }
  .mode-toggle {
    display: inline-flex;
    border: 1px solid var(--card-border);
    border-radius: 2px;
    overflow: hidden;
  }
  .mode-toggle button {
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    background: none;
    border: none;
    padding: 4px 9px;
    cursor: pointer;
  }
  .mode-toggle button.on { color: var(--bg); background: var(--accent-ink); }
  .nest-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 9.5px;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .compose-btn {
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
  .shares { margin-top: 10px; }
  .deck-meta { margin-top: 10px; }
  .export { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .export .add-slide[disabled] { opacity: 0.6; cursor: progress; }
  .export-err { font-family: var(--font-mono); font-size: 9px; color: var(--error); }
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
    aspect-ratio: 16 / 9; /* the stage's fixed design ratio (1280×720) */
    position: relative;
  }
  .pv-stage {
    position: absolute;
    left: 0;
    top: 0;
    width: 1280px;
    height: 720px;
    transform-origin: top left;
  }
  /* canvas selection — frame, hover toolbar, handles, inline editing */
  .sel-frame {
    position: absolute;
    z-index: 50;
    min-height: 24px;
    border: 1.5px dashed var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }
  .sel-handle { pointer-events: auto; touch-action: none; }
  .sel-resize {
    position: absolute;
    right: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 10px;
    height: 26px;
    background: var(--accent);
    border-radius: 2px;
    cursor: ew-resize;
  }
  .sel-toolbar {
    position: absolute;
    z-index: 60;
    transform: translateY(calc(-100% - 6px));
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--surface-elevated);
    border: 1px solid var(--text-primary);
    border-radius: 3px;
    padding: 3px 4px;
    white-space: nowrap;
  }
  /* blocks at the canvas top would clip an above-toolbar — flip it inside */
  .sel-toolbar.below { transform: translateY(6px); }
  .sel-toolbar button {
    font-family: var(--font-mono);
    font-size: 9.5px;
    min-width: 22px;
    color: var(--text-muted);
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    padding: 3px 4px;
    cursor: pointer;
  }
  .sel-toolbar button:hover { color: var(--accent); border-color: var(--accent); }
  .sel-toolbar .fb { font-weight: 700; }
  .sel-toolbar .fi { font-style: italic; }
  .sel-toolbar .fu { text-decoration: underline; }
  .sel-toolbar .sel-del:hover { color: var(--error); border-color: var(--error); }
  .sel-grip { cursor: grab; font-size: 11px; color: var(--accent-ink); padding: 2px 5px; }
  .sel-grip:active { cursor: grabbing; }
  .sel-style {
    font-family: var(--font-mono);
    font-size: 9.5px;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    padding: 2px 3px;
  }
  .sel-tag { font-family: var(--font-mono); font-size: 9px; color: var(--text-muted); padding: 0 5px; }
  .preview-frame :global(.ce-live) {
    outline: none;
    cursor: text;
    min-width: 24px;
    min-height: 1em;
  }
  /* the last-selected object always surfaces above overlapping neighbours */
  .preview-frame :global(.sel-raised) { z-index: 40; position: relative; }
  .preview-frame :global(.mblock.sel-raised) { position: absolute; }
  .blk.on-canvas { border-color: var(--accent); }
  .preview-frame :global(.ce-live:focus) {
    background: rgba(196, 87, 10, 0.05);
    border-radius: 2px;
  }

  /* the floating add box */
  .add-fab {
    position: absolute;
    z-index: 55;
    right: 14px;
    bottom: 14px;
    width: 40px;
    height: 40px;
    font-size: 19px;
    line-height: 1;
    color: var(--bg);
    background: var(--accent-ink);
    border: none;
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: transform 0.15s ease, background 0.15s ease;
  }
  .add-fab:hover { transform: scale(1.08); background: var(--accent-ink-hover); }
  .add-menu {
    position: absolute;
    z-index: 65;
    right: 14px;
    bottom: 62px;
    display: grid;
    grid-template-columns: repeat(2, minmax(120px, 1fr));
    gap: 2px;
    background: var(--surface-elevated);
    border: 2px solid var(--text-primary);
    border-radius: 4px;
    padding: 6px;
    max-height: 70%;
    overflow-y: auto;
  }
  .add-menu button {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.04em;
    text-align: left;
    color: var(--text-primary);
    background: none;
    border: 1px solid transparent;
    border-radius: 2px;
    padding: 6px 8px;
    cursor: pointer;
  }
  .add-menu button:hover { color: var(--accent); border-color: var(--accent); }
  .add-cat {
    grid-column: 1 / -1;
    font-family: var(--font-mono);
    font-size: 8.5px;
    font-weight: 600;
    letter-spacing: 0.16em;
    color: var(--text-ghost, var(--text-muted));
    border-bottom: 1px solid var(--card-border);
    padding: 7px 8px 3px;
    margin-bottom: 2px;
  }
  .add-cat:first-child { padding-top: 2px; }
  .add-menu .site-entry { grid-column: 1 / -1; color: var(--accent-ink); }
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
  .preview-meta { display: flex; gap: 14px; margin: 0 0 10px; }
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
    .desk { grid-template-columns: 1fr; }
  }
</style>
