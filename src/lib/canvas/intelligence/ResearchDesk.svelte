<!-- src/lib/canvas/intelligence/ResearchDesk.svelte -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import NodePalette, { type Mode as PaletteMode } from '$lib/canvas/NodePalette.svelte';
  import { byType as byNodeType, mapTypeToKind, type NodeKind } from '$lib/canvas/adapter';
  import ArtefactCard from './desk/ArtefactCard.svelte';
  import CardLiveWrapper from './desk/CardLiveWrapper.svelte';
  import GroupHeaderCard from './desk/GroupHeaderCard.svelte';
  import { spreadLayout } from './desk/spread';
  import EntityRail from './desk/EntityRail.svelte';
  import CommandBar from './desk/CommandBar.svelte';
  import FloatingFilters from './desk/FloatingFilters.svelte';
  import ActivityTicker from './desk/ActivityTicker.svelte';
  import InspectorDrawer from './desk/InspectorDrawer.svelte';
  import ResearchChatNode from './desk/ResearchChatNode.svelte';
  import ReportNode from './desk/ReportNode.svelte';
  import WebpageNode, { type WebpageConfig } from '$lib/canvas/nodes/WebpageNode.svelte';
  import { createDeskStore, type DeskCard, type QuickInitial } from './desk/store.svelte';
  import {
    pileLayout,
    ORG,
    SYNTHESIS_ZONE_ORIGIN,
    SYNTHESIS_ZONE_GAP,
    BAND,
    hashId,
    type Pos,
  } from './desk/layout';
  import { effectivePosition, type DeskMode } from './desk/positioning';
  import { groupBy as computeGroups, type GroupDim } from './desk/grouping';
  import { createSimilarityCache } from './desk/similarityCache';
  import { persistArtefactPosition } from './desk/persist-position';
  import { isRunning, type DeskStatus } from './desk/deskControls';
  import { samePos } from './desk/samePos';
  // Shared canvas-shell geometry (E1) — one implementation with the workflow
  // canvas. These wrappers keep their local names/signatures; only the bodies
  // delegate. Desk state ($state pan/zoom) stays owned here.
  import {
    type Box,
    clampZoom as shellClampZoom,
    zoomAtPoint as shellZoomAtPoint,
    pinchZoom as shellPinchZoom,
    screenToWorld as shellScreenToWorld,
    viewportCenterInWorld as shellViewportCenterInWorld,
    fitToBounds as shellFitToBounds,
    resolveOverlap as shellResolveOverlap,
    orthPath as shellOrthPath,
  } from '$lib/canvas/shell/geometry';
  import { computeMinimap } from '$lib/canvas/shell/minimap';
  import {
    visibleWorldRect,
    quantiseRect,
    intersects,
    cullToRect,
    isLowDetail,
  } from '$lib/canvas/shell/cull';

  let {
    sessionId,
    mode: deskMode = 'deep',
    readonly = false,
    embedded = false,
    initialTopic = '',
    initialStatus = 'draft',
    quickInitial = undefined,
  } = $props<{
    sessionId: string;
    mode?: 'deep' | 'quick';
    readonly?: boolean;
    embedded?: boolean;
    initialTopic?: string;
    initialStatus?: string;
    quickInitial?: QuickInitial;
  }>();

  // Topic shown in the command bar (kept as a derived const so the prop read
  // is hoisted; no $effect churn).
  const topic = $derived(initialTopic);

  // ——— store ———
  const store = createDeskStore(sessionId, { mode: deskMode, quickInitial });
  onMount(() => {
    store.start();
    return () => store.dispose();
  });

  // ——— cockpit local state ———
  // Grouped relationships shown in the inspector (relationships / appears-in-facts
  // / source / entities / challenges, depending on the selected card's kind).
  type RelKind = 'source' | 'fact' | 'entity';
  interface RelItem { id: string; kind: RelKind; label: string; note?: string }
  interface RelGroup { heading: string; items: RelItem[] }

  let inspectorOpen = $state(false);
  let inspectorArtefact = $state<any>(null);
  let inspectorRelated = $state<RelGroup[]>([]);
  let inspectorSummarize = $state(false);

  // Artefact-type filter toggles (controlled).
  let typeFilters = $state({ source: true, fact: true, entity: true, counterfactual: true });

  // Derive current session status from the stream (seeded from page load).
  // The store captures 'status' SSE events; we fall back to initialStatus on startup.
  let sessionStatus = $derived.by<DeskStatus>(() => {
    const s = store.sessionStatus !== 'draft' ? store.sessionStatus : initialStatus;
    // Map store connection status to DeskStatus when no session status yet received.
    const valid: DeskStatus[] = ['draft', 'phase1', 'phase2', 'phase3', 'post_processing', 'complete', 'failed'];
    return valid.includes(s as DeskStatus) ? (s as DeskStatus) : 'draft';
  });

  // Synthesising = a synthesis run is actively streaming.
  let synthesising = $derived(store.synthStatus === 'running');

  // Artefact counts for CommandBar.
  const counts = $derived.by(() => {
    let sources = 0, facts = 0, entities = 0, counterfactuals = 0;
    for (const c of store.cards) {
      if (c.kind === 'source') sources++;
      else if (c.kind === 'entity') entities++;
      else {
        facts++;
        if ((c.fields.isCounterfactual as boolean)) counterfactuals++;
      }
    }
    return { sources, facts, entities, links: store.edges.length, counterfactuals };
  });

  // GATHER ⇄ SYNTHESIZE
  let mode = $state<DeskMode>('gather');
  let synthesizing = $state(false); // POST in flight (debounce double-clicks)
  let everSynthesized = $state(false);

  // ——— Group-by (pile) state ———
  // The active grouping dimension. Defaults to 'similarity' so before synthesize
  // the desk shows real embedding-similarity piles (not the empty 'cluster' dimension).
  let groupDim = $state<GroupDim>('similarity');

  // Piles are always rendered as collapsed fans now; in-place column expansion was
  // superseded by the click-a-heading → spread-to-explore focus interaction. Kept
  // as an (always-empty) arg to pileLayout so its signature is unchanged.
  const expandedPiles: Set<string> = new Set();

  // ——— Group focus (click a heading → spread its cards to explore) ———
  // The group key currently spread into open space, or null. `focusAnchor` is the
  // world-space viewport centre captured at click time so the spread stays put
  // while the user pans/zooms.
  let focusedGroup = $state<string | null>(null);
  let focusAnchor = $state.raw<Pos | null>(null);

  // ——— Search (floating-filter box) ———
  // Live substring filter over card title/description/content; only active once
  // the query reaches 3 characters (shorter queries match nothing-out).
  let searchQuery = $state('');
  const SEARCH_MIN = 3;

  // ——— Auto-arrange ———
  // ON (default): the desk continuously re-flows into piles as cards stream in
  // and whenever the grouping changes — positions are derived live.
  // OFF: positions freeze where they are (`frozenPos`); the user arranges on
  // demand with "Arrange now" and can drag cards freely (drags stick).
  let autoArrange = $state(true);
  // Frozen positions used only while autoArrange is OFF (cardId → world pos).
  let frozenPos = $state.raw<Map<string, Pos>>(new Map());

  // Resolved similarity clusters: factId -> clusterId. Fetched lazily, once per
  // fact-count, only while groupDim === 'similarity'.
  const similarityCache = createSimilarityCache(sessionId);
  let similarityMap = $state.raw<Map<string, string>>(new Map());

  // Lazily load similarity clusters when that dimension is active. Keyed on the
  // current fact count (store.synthFactCount when set, else the live fact tally)
  // so a changed fact set triggers a single refetch. The cache dedupes/coalesces.
  const factCountForSim = $derived.by(() => {
    const sc = store.synthFactCount;
    if (sc && sc > 0) return sc;
    let n = 0;
    for (const c of store.cards) if (c.kind === 'fact') n++;
    return n;
  });
  $effect(() => {
    const dim = groupDim;
    const count = factCountForSim;
    if (dim !== 'similarity') return;
    let cancelled = false;
    similarityCache.get(count).then((m) => {
      if (cancelled) return;
      untrack(() => { similarityMap = m; });
    });
    return () => { cancelled = true; };
  });

  // Clear transient manual positions whenever the grouping dimension changes so
  // dragged-but-not-locked cards rejoin their new piles. Also drop any group
  // focus: the focused key belongs to the OLD dimension and won't resolve under
  // the new one. A plain let tracks the previous dim value; the $effect guard
  // prevents self-fire on init. Writes are untracked (no self-loop).
  let prevGroupDim: GroupDim | null = null;
  $effect(() => {
    const dim = groupDim;
    if (prevGroupDim !== null && prevGroupDim !== dim) {
      untrack(() => {
        manualPos = new Map();
        focusedGroup = null;
        focusAnchor = null;
      });
    }
    prevGroupDim = dim;
  });

  function goGather() {
    mode = 'gather';
  }

  async function goSynthesize() {
    mode = 'synthesize';
    // Readonly desks (share view) and quick desks never trigger a synthesis run;
    // they only re-cluster the already-streamed state locally.
    if (readonly || deskMode === 'quick') return;
    if (synthesizing || store.synthStatus === 'running') return;
    // Clear transient drag positions — cards rejoin their new piles after a synthesize.
    manualPos = new Map();
    synthesizing = true;
    try {
      const res = await fetch(`/api/deepdive/${sessionId}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: { pinnedOnly: false } }),
      });
      if (res.ok) {
        // Keep similarity as the post-synthesize default.
        if (!everSynthesized) groupDim = 'similarity';
        everSynthesized = true;
      } else {
        console.error('[desk] synthesize POST failed', res.status);
      }
    } catch (err) {
      console.error('[desk] synthesize POST error', err);
    } finally {
      synthesizing = false;
    }
  }

  function handleMode(next: 'gather' | 'synthesize') {
    if (next === 'synthesize') goSynthesize();
    else goGather();
  }

  // ——— control handlers ———

  // ⏭ → engine "skip" (advance phase). Engine has no true pause.
  async function handleSkip() {
    if (readonly || deskMode === 'quick') return;
    await fetch(`/api/deepdive/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'skip' }),
    }).catch((err) => console.error('[desk] skip error', err));
  }

  async function handleStop() {
    if (readonly || deskMode === 'quick') return;
    await fetch(`/api/deepdive/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    }).catch((err) => console.error('[desk] stop error', err));
  }

  // ⤓ deepen → open inspector on the highest-centrality entity if present.
  function handleDeepen() {
    const ent = store.cards.find((c: any) => c.kind === 'entity');
    if (ent) openInspector(ent.id);
  }

  async function handleShare() {
    if (readonly || deskMode === 'quick') return;
    const res = await fetch(`/api/deepdive/${sessionId}/share`, { method: 'POST' });
    if (!res.ok) return;
    const { token } = await res.json() as { token: string };
    const url = `${location.origin}/deepdive/share/${token}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard may be blocked; URL is still created server-side */
    }
  }

  function handleExport(kind: 'docx' | 'narrative-docx' | 'narrative-md' | 'md') {
    const path =
      kind === 'docx'
        ? `/api/deepdive/${sessionId}/export/docx`
        : kind === 'md'
          ? `/api/deepdive/${sessionId}/export/md`
          : kind === 'narrative-docx'
            ? `/api/deepdive/${sessionId}/export/narrative-docx`
            : `/api/deepdive/${sessionId}/export/narrative-md`;
    const a = document.createElement('a');
    a.href = path;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function handleFilter(key: 'source' | 'fact' | 'entity' | 'counterfactual', value: boolean) {
    typeFilters = { ...typeFilters, [key]: value };
  }

  // Toggle a pile open/closed. $state.raw Set replaced wholesale so the change
  // re-derives pilePositions → flows through posOf → positionById → morphIds,
  // animating the spread/restack with no extra transition wiring.
  // Raw world-space centre of the current viewport (no node offset).
  function viewportCenterWorld(): Pos {
    if (!viewportEl) return { x: 600, y: 600 };
    const vp = viewportEl.getBoundingClientRect();
    return { x: (vp.width / 2 - panX) / zoom, y: (vp.height / 2 - panY) / zoom };
  }

  // Clicking a group heading spreads that group's cards into open space around
  // the viewport centre (captured now so it's stable while panning). Clicking the
  // same heading again — or Esc / the heading's ✕ — collapses back to the piles.
  function focusGroup(key: string) {
    if (focusedGroup === key) { clearFocus(); return; }
    focusAnchor = viewportCenterWorld();
    focusedGroup = key;
  }
  function clearFocus() {
    focusedGroup = null;
    focusAnchor = null;
  }

  // Toggle continuous auto-arrange. Turning it OFF snapshots the current rendered
  // positions so nothing jumps; turning it back ON releases the freeze and the
  // desk re-flows into its piles (animated via morphIds).
  function setAutoArrange(on: boolean) {
    if (on) {
      autoArrange = true;
      frozenPos = new Map();
    } else {
      // Snapshot BEFORE flipping the flag (posOf still returns live pile positions).
      frozenPos = new Map(positionById);
      autoArrange = false;
    }
  }

  // One-shot tidy: snap every visible card to its current pile slot and keep that
  // as the frozen layout. Clears transient drags so the arrange is clean. When
  // auto-arrange is ON this is redundant (the desk already tracks piles live), so
  // the control is disabled in that state.
  function arrangeNow() {
    const snap = new Map<string, Pos>();
    for (const c of visibleCards) {
      const p = pilePositions.get(c.id) ?? posOf(c);
      snap.set(c.id, p);
    }
    manualPos = new Map();
    dragOverrides = {};
    frozenPos = snap;
  }

  // ——— strewn-desk card tilt ———
  // A small, STABLE per-card rotation (seeded by id) so cards look hand-strewn
  // rather than grid-aligned. Stable across flushes ⇒ the morph transition only
  // animates the translate, never the rotation. Locked cards render upright — a
  // clear "filed/pinned" affordance (and lock drops the .morphing class, so the
  // straighten is an intentional, one-off snap on the user's action).
  const TILT_MAX_DEG = 3.2;
  const TILT_STEPS = 14;
  function cardTilt(id: string): number {
    const h = hashId(id + '\x07') % (2 * TILT_STEPS + 1);
    return ((h - TILT_STEPS) / TILT_STEPS) * TILT_MAX_DEG;
  }

  // Inspector open/close.
  function openInspector(id: string, opts?: { summarize?: boolean }) {
    const card: any = store.cards.find((c) => c.id === id);
    if (!card) return;
    // Build the artefact payload with kind + id + all fields inline.
    inspectorArtefact = { kind: card.kind, id: card.id, ...card.fields };
    inspectorRelated = relatedFor(id);
    inspectorSummarize = !!(opts?.summarize && card.kind === 'source');
    inspectorOpen = true;
  }

  // Related artefacts, organised into labelled groups so the inspector can show
  // an entity's relationships, the facts it appears in, a fact's source/entities,
  // a source's facts, etc. Uses relationships (edges) + entity↔fact mentions +
  // fact→source links.
  function relatedFor(id: string): RelGroup[] {
    const card = store.cards.find((c) => c.id === id);
    if (!card) return [];
    const byId = new Map(store.cards.map((c) => [c.id, c]));
    const f = (c: DeskCard) => c.fields as any;
    const nameOf = (c: DeskCard) => String(f(c).name ?? f(c).title ?? f(c).content ?? c.id);
    const relKind = (c: DeskCard): RelKind =>
      c.kind === 'entity' ? 'entity' : c.kind === 'source' ? 'source' : 'fact';
    const groups: RelGroup[] = [];

    if (card.kind === 'entity') {
      // Relationships to other entities. AGGREGATE parallel edges (the same
      // pair can have several relationship types/sentiments) into ONE row per
      // other entity, so ids stay unique (no duplicate inspector keys) and the
      // notes read together. Self-loops (from===to===id) are skipped.
      const relByOther = new Map<string, { dir: string; notes: Set<string> }>();
      for (const e of store.edges) {
        let otherId: string | null = null;
        let dir = '';
        if (e.fromEntityId === id) { otherId = e.toEntityId; dir = '→'; }
        else if (e.toEntityId === id) { otherId = e.fromEntityId; dir = '←'; }
        if (!otherId || otherId === id) continue;
        let agg = relByOther.get(otherId);
        if (!agg) { agg = { dir, notes: new Set() }; relByOther.set(otherId, agg); }
        const note = [e.relationshipType, e.sentiment].filter(Boolean).join(' ');
        if (note) agg.notes.add(note);
      }
      const rels: RelItem[] = [];
      for (const [otherId, agg] of relByOther) {
        const other = byId.get(otherId);
        rels.push({
          id: otherId,
          kind: 'entity',
          label: `${agg.dir} ${other ? nameOf(other) : otherId}`,
          note: agg.notes.size ? [...agg.notes].join(' · ') : undefined,
        });
      }
      if (rels.length) groups.push({ heading: 'Relationships', items: rels });

      // Facts that mention / are about this entity.
      const factItems: RelItem[] = [];
      const seen = new Set<string>();
      for (const m of store.entityMentions) {
        if (m.entityId !== id || seen.has(m.factId)) continue;
        seen.add(m.factId);
        const fc = byId.get(m.factId);
        if (fc) factItems.push({ id: fc.id, kind: relKind(fc), label: nameOf(fc) });
      }
      if (factItems.length) groups.push({ heading: 'Appears in facts', items: factItems });
    } else if (card.kind === 'fact') {
      // The source this fact came from.
      const sid = f(card).sourceId;
      if (typeof sid === 'string') {
        const sc = byId.get(sid);
        if (sc) groups.push({ heading: 'Source', items: [{ id: sc.id, kind: 'source', label: nameOf(sc) }] });
      }
      // Entities mentioned in this fact.
      const entItems: RelItem[] = [];
      const seenE = new Set<string>();
      for (const m of store.entityMentions) {
        if (m.factId !== id || seenE.has(m.entityId)) continue;
        seenE.add(m.entityId);
        const ec = byId.get(m.entityId);
        if (ec) entItems.push({ id: ec.id, kind: 'entity', label: nameOf(ec) });
      }
      if (entItems.length) groups.push({ heading: 'Entities', items: entItems });
      // Counterfactual links (challenges).
      const challenges: RelItem[] = [];
      for (const c of store.cards) {
        if (f(c).refutesFactId === id) challenges.push({ id: c.id, kind: 'fact', label: nameOf(c), note: 'challenges this' });
      }
      const myRefute = f(card).refutesFactId;
      if (typeof myRefute === 'string') {
        const rc = byId.get(myRefute);
        if (rc) challenges.push({ id: rc.id, kind: 'fact', label: nameOf(rc), note: 'this challenges' });
      }
      if (challenges.length) groups.push({ heading: 'Challenges', items: challenges });
    } else if (card.kind === 'source') {
      // Facts extracted from this source.
      const factItems: RelItem[] = [];
      for (const c of store.cards) {
        if (c.kind === 'fact' && f(c).sourceId === id) factItems.push({ id: c.id, kind: relKind(c), label: nameOf(c) });
      }
      if (factItems.length) groups.push({ heading: 'Facts from this source', items: factItems });
    }

    for (const g of groups) g.items = g.items.slice(0, 20);
    return groups;
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

  // Map a card to a workflow-canvas `data-kind` token so the 3px left bar on
  // the card host matches the .wf-node[data-kind] color canon. Pure; no state.
  function kindOf(c: DeskCard): 'source' | 'fact' | 'entity' | 'counterfactual' {
    if (c.kind === 'entity') return 'entity';
    if (c.kind === 'source') return 'source';
    return (c.fields.isCounterfactual as boolean) ? 'counterfactual' : 'fact';
  }

  // Live drag overrides (id → {x,y}); applied on top of persisted/auto layout.
  let dragOverrides = $state.raw<Record<string, { x: number; y: number }>>({});

  // Transient post-drag positions (client-only, NOT persisted). Set on drag-end
  // for unlocked cards; cleared on regroup (groupDim change or synthesize start).
  let manualPos = $state.raw<Map<string, { x: number; y: number }>>(new Map());

  // Card right-click context menu state.
  let cardContextMenu = $state<{
    cardId: string;
    cardKind: 'source' | 'fact' | 'entity';
    pinned: boolean;
    currentPos: { x: number; y: number };
    screenX: number;
    screenY: number;
  } | null>(null);

  // Categories: live reducer categories merged with any persisted deskCategory
  const categories = $derived.by<{ id: string; title: string }[]>(() => {
    const map = new Map<string, { id: string; title: string }>();
    for (const c of store.synthCategories) map.set(c.id, { id: c.id, title: c.title });
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

  // Fact → cluster membership
  const factCat = $derived.by(() => {
    const m = new Map<string, string>();
    for (const cl of store.clusters) for (const fid of cl.fact_ids ?? []) m.set(fid, cl.id);
    return m;
  });

  // ——— grouping → pile positions ———
  // memberOf: cardId -> groupKey; groups: ordered {key,label,count}.
  // Pure: a single O(N) pass per flush, funnelled into positionById below.
  const grouping = $derived.by(() => {
    const cards = visibleCards.map((c) => ({
      id: c.id,
      kind: c.kind,
      deskCategory: c.deskCategory ?? factCat.get(c.id) ?? null,
      fields: c.fields,
    }));
    const edges = store.edges.map((e) => ({
      id: e.id,
      fromEntityId: e.fromEntityId,
      toEntityId: e.toEntityId,
      sentiment: e.sentiment ?? null,
    }));
    const mentions = store.entityMentions.map((m) => ({
      entityId: m.entityId,
      factId: m.factId,
    }));
    return computeGroups(groupDim, cards, edges, mentions, similarityMap);
  });

  // Pile anchor + fanned-stack / expanded-column positions for EVERY visible
  // card. Replaces organisedLayout + themeLayout — one packer, one map.
  const pilePositions = $derived.by<Map<string, Pos>>(() => {
    const cards = visibleCards.map((c) => ({ id: c.id, kind: c.kind }));
    return pileLayout(grouping.groups, grouping.memberOf, cards, expandedPiles);
  });

  // Per-group anchor (top-left of the first member's pile) for header hosts.
  // Derived from pilePositions so labels sit exactly over their stack.
  const pileHeaders = $derived.by(() => {
    const out: { key: string; label: string; count: number; pos: Pos }[] = [];
    const seen = new Set<string>();
    // Walk groups in their packed order; the anchor is the min-x,min-y of members.
    const anchors = new Map<string, Pos>();
    for (const c of visibleCards) {
      const key = grouping.memberOf.get(c.id);
      if (!key) continue;
      const p = pilePositions.get(c.id);
      if (!p) continue;
      const a = anchors.get(key);
      if (!a || p.y < a.y || (p.y === a.y && p.x < a.x)) anchors.set(key, p);
    }
    for (const g of grouping.groups) {
      const a = anchors.get(g.key);
      if (!a || seen.has(g.key)) continue;
      seen.add(g.key);
      // For the cluster dim the group key is the cluster UUID; show its title.
      const label = groupDim === 'cluster' ? (clusterTitleOf.get(g.key) ?? g.label) : g.label;
      out.push({ key: g.key, label, count: g.count, pos: a });
    }
    return out;
  });

  // ——— group focus / spread ———
  // Member ids of the focused group (in visibleCards order), the spread layout
  // (member positions + heading position), and a quick lookup set.
  const focusMemberIds = $derived.by<string[]>(() => {
    if (!focusedGroup) return [];
    return visibleCards
      .filter((c) => grouping.memberOf.get(c.id) === focusedGroup)
      .map((c) => c.id);
  });
  const focusSpread = $derived.by(() => {
    if (!focusedGroup || !focusAnchor || focusMemberIds.length === 0) return null;
    return spreadLayout(focusMemberIds, focusAnchor);
  });
  const focusedIds = $derived(new Set(focusMemberIds));
  // Focus is only "active" (and therefore dimming the rest of the desk) when the
  // spread actually resolves. If a focused group is emptied — by search, a
  // group-dimension change, or a type filter — focusSpread becomes null and the
  // desk must NOT stay dimmed/non-interactive (it would otherwise be a dead
  // canvas recoverable only by Esc). focusedGroup is left set so the spread
  // reappears if the filter is relaxed.
  const focusActive = $derived(focusSpread !== null);

  // Index of each card within its group (packed order = visibleCards order),
  // used for fan z-index. Every member in a collapsed pile is rendered so
  // a slice of each card is always visible.
  const cardPileInfo = $derived.by(() => {
    const idxInGroup = new Map<string, number>();
    const running = new Map<string, number>();
    for (const c of visibleCards) {
      const key = grouping.memberOf.get(c.id);
      if (!key) { idxInGroup.set(c.id, 0); continue; }
      const i = running.get(key) ?? 0;
      idxInGroup.set(c.id, i);
      running.set(key, i + 1);
    }
    const m = new Map<string, { idx: number; render: boolean; z: number }>();
    for (const c of visibleCards) {
      const key = grouping.memberOf.get(c.id);
      const idx = idxInGroup.get(c.id) ?? 0;
      // Manual/locked/transient cards sit above their pile.
      // A card is "escaped" if: in-flight drag override, explicitly locked (pinned===true),
      // or has a transient manual position set post-drag.
      const manual =
        !!dragOverrides[c.id] ||
        (c.pinned === true && c.canvasX != null && c.canvasY != null) ||
        manualPos.has(c.id);
      // All fan members render — every card peeks out in the collapsed fan.
      const render = true;
      // Top of the fan (idx 0) sits highest; deeper cards recede.
      const z = manual ? 1000 : 100 - idx;
      m.set(c.id, { idx, render, z });
    }
    return m;
  });

  // Per-category summary
  const categorySummary = $derived.by<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of store.synthCategories) out[c.id] = c.summary ?? '';
    for (const cl of store.clusters) if (!out[cl.id]) out[cl.id] = cl.summary ?? '';
    return out;
  });

  // cluster id → human title (so cluster-dim pile headers show the synthesis
  // title, not the raw cluster UUID that doubles as the group key).
  const clusterTitleOf = $derived.by<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const c of store.synthCategories) if (c.title) m.set(c.id, c.title);
    for (const cl of store.clusters) if (cl.title && !m.has(cl.id)) m.set(cl.id, cl.title);
    return m;
  });

  // ——— type-filter helpers ———
  // Map a card to the filter key it belongs to.
  function cardFilterKey(c: DeskCard): 'source' | 'fact' | 'entity' | 'counterfactual' {
    if (c.kind === 'entity') return 'entity';
    if (c.kind === 'source') return 'source';
    // fact or counterfactual
    return (c.fields.isCounterfactual as boolean) ? 'counterfactual' : 'fact';
  }

  // Lowercased, concatenated searchable text for a card (title / name / content /
  // snippet / description / domain). Used by the floating-filter search.
  function cardSearchText(c: DeskCard): string {
    const f = c.fields as any;
    return [f.content, f.name, f.title, f.snippet, f.description, f.domain, f.type, f.url]
      .filter((v) => typeof v === 'string')
      .join(' ')
      .toLowerCase();
  }

  // Active search needle (only once ≥ SEARCH_MIN chars; trimmed + lowercased).
  const searchNeedle = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    return q.length >= SEARCH_MIN ? q : '';
  });

  // Filtered card list: type filters AND (when active) the search needle.
  // Honoured by the desk render; counters use store.cards directly.
  const visibleCards = $derived(
    store.cards.filter(
      (c) => typeFilters[cardFilterKey(c)] && (!searchNeedle || cardSearchText(c).includes(searchNeedle)),
    ),
  );

  // Report node: regenerate + downloads are gated exactly like handleExport/handleShare.
  const canRegenerate = $derived(!readonly && deskMode !== 'quick');

  // ——— Feature 1 liveness view state (entrance stagger + fresh-pulse) ———
  // Pure VIEW state derived from arrival metadata (the store's non-reactive side
  // map). Recomputes when `visibleCards` changes (i.e. on a flush) — event-rate,
  // NOT frame-rate, and entirely independent of `positionById` so it never
  // invalidates the layout memo. Breathing is a single boolean, evaluated by the
  // wrapper from `deskRunning`; entrance/fresh are per-card here.
  const FRESH_WINDOW_MS = 1000;
  const STAGGER_STEP_MS = 24; // per-index delay
  const STAGGER_CAP_MS = 120; // total spread ceiling
  // True while the engine is actively producing → cards breathe; gated off when
  // idle/complete so a finished desk is perfectly still.
  const deskRunning = $derived(isRunning(sessionStatus) || synthesising);
  const cardLive = $derived.by(() => {
    const now = Date.now();
    const m = new Map<string, { enterDelayMs: number; fresh: boolean }>();
    for (const c of visibleCards) {
      const a = store.arrivalOf(c.id);
      if (!a) {
        m.set(c.id, { enterDelayMs: 0, fresh: false });
        continue;
      }
      m.set(c.id, {
        // Stagger a flush's new cards across ~120ms by their batch index.
        enterDelayMs: Math.min(a.indexInBatch * STAGGER_STEP_MS, STAGGER_CAP_MS),
        // Fresh for ~1s after first arrival (seed-batch cards are never fresh:
        // their firstSeenAt is hydrate time, which is already > the window by the
        // time the user looks, and they don't pulse on reload).
        fresh: a.batch > 0 && now - a.firstSeenAt < FRESH_WINDOW_MS,
      });
    }
    return m;
  });

  // Visible cards by id. Replaces both the id Set that gated `anchorRect` and
  // the linear `visibleCards.find` that followed it — one structure answers
  // "is it visible?" and "which card is it?" in one lookup.
  const visibleCardById = $derived(new Map(visibleCards.map((c) => [c.id, c])));


  // Entity rail
  const railEntities = $derived.by(() =>
    visibleCards.filter((c) => c.kind === 'entity'),
  );

  function posOf(c: DeskCard): { x: number; y: number } {
    // 1. In-flight drag override (pointer is still down).
    const ov = dragOverrides[c.id];
    if (ov) return ov;
    // 1b. Group focus — a member of the focused group spreads into open space.
    //     Wins over locking/piles so the whole group is co-visible to explore;
    //     positions revert when focus clears.
    if (focusSpread) {
      const fp = focusSpread.positions.get(c.id);
      if (fp) return fp;
    }
    // 2. Locked (pinned===true) — use the persisted canvasX/Y. Stale canvasX/Y
    //    from old unlocked drags are intentionally ignored here (they get cleared
    //    on unlock via PATCH pinned:false; until then an unlocked card with stale
    //    canvasX/Y is NOT treated as locked — only pinned===true gates this).
    if (c.pinned === true && c.canvasX != null && c.canvasY != null) {
      return { x: c.canvasX as number, y: c.canvasY as number };
    }
    // 3. Auto-arrange OFF — hold the frozen position. New cards (absent from the
    //    snapshot) fall through to their pile slot so they still appear placed.
    if (!autoArrange) {
      const frozen = frozenPos.get(c.id);
      if (frozen) return frozen;
    }
    // 4. Transient manual drag (client-only; cleared on regroup).
    const manual = manualPos.get(c.id);
    if (manual) return manual;
    // 5. Pile position from the active grouping (collapsed fan or expanded column).
    const pile = pilePositions.get(c.id);
    if (pile) return pile;
    // 6. Fallback (a card not covered by the packer): deterministic GATHER scatter.
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
      new Map(),
      { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    );
  }

  // Compute each visible card's position EXACTLY ONCE per dependency change.
  // posOf() is otherwise called ~4×N (entityById, minimap, card #each, minimap
  // #each, edge endpoints); funnelling every read through this single map keeps
  // the layout work O(N) per flush instead of O(N) per reader.
  const positionById = $derived(
    new Map<string, { x: number; y: number }>(visibleCards.map((c) => [c.id, posOf(c)])),
  );

  // Position reader for callers that may run mid-event or against a card that
  // isn't in the visible set (anchorRect / drag handlers). Falls back to a fresh
  // posOf() so it never returns a stale/missing value.
  function posFor(c: DeskCard): { x: number; y: number } {
    return positionById.get(c.id) ?? posOf(c);
  }

  // Entity-id → resolved centre, for edge docking.
  // Only include visible entities so edges to hidden cards don't render.
  const entityById = $derived.by(() => {
    const m = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const c of visibleCards) {
      if (c.kind !== 'entity') continue;
      const p = positionById.get(c.id) ?? posOf(c);
      m.set(c.id, { x: p.x, y: p.y, w: cardW(c), h: cardH(c) });
    }
    return m;
  });

  // ——— orthPath (shared shell; box-accessor form) ———
  function orthPath(from: Box, to: Box): string {
    return shellOrthPath(from, to);
  }

  const edgePaths = $derived.by(() => {
    const out: { id: string; d: string }[] = [];
    for (const e of store.edges) {
      const a = entityById.get(e.fromEntityId);
      const b = entityById.get(e.toEntityId);
      if (!a || !b) continue;
      // An edge with both ends off screen draws nothing a viewer can see, and
      // the biggest run in production holds 1,107 of them. Endpoints come from
      // `entityById`, which still covers EVERY visible entity — so an edge from
      // an on-screen card to an off-screen one still runs off the edge of the
      // viewport correctly, as it should.
      if (culling && !intersects(a, cullRect) && !intersects(b, cullRect)) continue;
      out.push({ id: e.id, d: orthPath(a, b) });
    }
    return out;
  });

  // ——— synthesized connector edges ———
  function anchorRect(anchorId: string): Box | null {
    if (anchorId.startsWith('cat:')) {
      const catId = anchorId.slice(4);
      const h = pileHeaders.find((ph) => ph.key === catId);
      if (!h) return null;
      return { x: h.pos.x, y: h.pos.y - 64, w: 220, h: 64 };
    }
    // Only produce a rect for cards that are currently visible.
    //
    // Looked up in a map rather than scanned. This runs once per spark and once
    // per synthesis edge, and the scan it replaces was O(visibleCards) EACH —
    // quadratic on a desk holding thousands of cards, at exactly the moment the
    // engine is streaming new ones in.
    const card = visibleCardById.get(anchorId);
    if (!card) return null;
    const p = posFor(card);
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

  // ——— provenance sparks (Feature 2) ———
  // Transient source→fact lines. Endpoints resolve through anchorRect (same
  // idiom as edges/synthEdges) so they ride the same positionById memo; a spark
  // whose source or fact card isn't currently visible is simply skipped. The
  // store caps + expires the sparks list, so this stays bounded.
  const sparkPaths = $derived.by(() => {
    const out: { id: string; d: string }[] = [];
    for (const s of store.sparks) {
      const a = anchorRect(s.fromId);
      const b = anchorRect(s.toId);
      if (!a || !b) continue;
      out.push({ id: s.id, d: orthPath(a, b) });
    }
    return out;
  });

  // The single source card actively producing facts right now (Feature 2).
  const analysingSourceId = $derived(store.analysingSourceId);

  // ——— client-only desk nodes (research-chat / research-report) ———
  // The Research Desk is session-scoped, NOT workflow-id-backed, so these nodes
  // are ephemeral $state — created on right-click, never persisted to the
  // workflow_nodes table (no /api/workflows/<id>/nodes POST). Positions live in
  // world-space alongside the artefact cards.
  type DeskNode = {
    id: string;
    type: string; // adapter node type, e.g. 'research-chat'
    kind: NodeKind;
    x: number;
    y: number;
    w: number;
    h: number;
    config: Record<string, unknown>;
  };

  // Default sizes per node kind (world-px).
  const DESK_NODE_DEFAULTS: Record<string, { w: number; h: number }> = {
    'research-chat': { w: 320, h: 360 },
    'research-report': { w: 360, h: 320 },
    'webpage': { w: 480, h: 360 },
  };
  const RESIZE_MIN_W = 260;
  const RESIZE_MIN_H = 180;
  const RESIZE_MAX_W = 720;
  const RESIZE_MAX_H = 640;

  let deskNodes = $state.raw<DeskNode[]>([]);
  let selectedNodeId = $state<string | null>(null);

  // ——— resize handle state ———
  // Plain let — never read from a $effect, only from pointer handlers.
  let nodeResize: {
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startW: number;
    startH: number;
    pointerId: number;
  } | null = null;

  // ——— generic desk-node drag (research-chat, research-report, etc.) ———
  // Separate from artefact card drag (nodeDrag) so the two can't collide.
  let deskNodeDrag = $state<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    pointerId: number;
  } | null>(null);

  function onDeskNodePointerDown(e: PointerEvent, n: DeskNode) {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectedNodeId = n.id;
    deskNodeDrag = {
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

  function onDeskNodePointerMove(e: PointerEvent) {
    if (!deskNodeDrag || deskNodeDrag.pointerId !== e.pointerId) return;
    const dxClient = e.clientX - deskNodeDrag.startClientX;
    const dyClient = e.clientY - deskNodeDrag.startClientY;
    if (!deskNodeDrag.moved && Math.hypot(dxClient, dyClient) < 3) return;
    deskNodeDrag.moved = true;
    const dx = dxClient / zoom;
    const dy = dyClient / zoom;
    const nx = Math.round((deskNodeDrag.startX + dx) / 20) * 20;
    const ny = Math.round((deskNodeDrag.startY + dy) / 20) * 20;
    const id = deskNodeDrag.nodeId;
    deskNodes = deskNodes.map((nd) => nd.id === id ? { ...nd, x: nx, y: ny } : nd);
  }

  function onDeskNodePointerUp(e: PointerEvent) {
    if (!deskNodeDrag || deskNodeDrag.pointerId !== e.pointerId) return;
    deskNodeDrag = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* no-op */ }
  }

  // ——— resize handle pointer handlers ———
  function onResizePointerDown(e: PointerEvent, n: DeskNode) {
    // Stop the event from triggering node-drag on the parent host.
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    nodeResize = {
      nodeId: n.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startW: n.w,
      startH: n.h,
      pointerId: e.pointerId,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onResizePointerMove(e: PointerEvent) {
    if (!nodeResize || nodeResize.pointerId !== e.pointerId) return;
    const dxClient = e.clientX - nodeResize.startClientX;
    const dyClient = e.clientY - nodeResize.startClientY;
    const dx = dxClient / zoom;
    const dy = dyClient / zoom;
    const newW = Math.round(
      Math.max(RESIZE_MIN_W, Math.min(RESIZE_MAX_W, nodeResize.startW + dx)) / 20,
    ) * 20;
    const newH = Math.round(
      Math.max(RESIZE_MIN_H, Math.min(RESIZE_MAX_H, nodeResize.startH + dy)) / 20,
    ) * 20;
    const id = nodeResize.nodeId;
    deskNodes = deskNodes.map((nd) => nd.id === id ? { ...nd, w: newW, h: newH } : nd);
  }

  function onResizePointerUp(e: PointerEvent) {
    if (!nodeResize || nodeResize.pointerId !== e.pointerId) return;
    nodeResize = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* no-op */ }
  }

  // ——— desk node context menu (right-click → Delete) ———
  let nodeContextMenu = $state<{ nodeId: string; screenX: number; screenY: number } | null>(null);

  function openNodeContextMenu(e: MouseEvent, n: DeskNode) {
    e.preventDefault();
    e.stopPropagation();
    selectedNodeId = n.id;
    nodeContextMenu = { nodeId: n.id, screenX: e.clientX, screenY: e.clientY };
  }

  function closeNodeContextMenu() {
    nodeContextMenu = null;
  }

  function deleteNode(id: string) {
    deskNodes = deskNodes.filter((n) => n.id !== id);
    if (selectedNodeId === id) selectedNodeId = null;
    closeNodeContextMenu();
  }

  // ——— card context menu (right-click → Lock/Unlock) ———
  function openCardContextMenu(e: MouseEvent, c: DeskCard) {
    e.preventDefault();
    e.stopPropagation();
    const currentPos = positionById.get(c.id) ?? posOf(c);
    const kind: 'source' | 'fact' | 'entity' = c.kind === 'entity' ? 'entity' : c.kind === 'source' ? 'source' : 'fact';
    cardContextMenu = {
      cardId: c.id,
      cardKind: kind,
      pinned: c.pinned === true,
      currentPos,
      screenX: e.clientX,
      screenY: e.clientY,
    };
  }

  function closeCardContextMenu() {
    cardContextMenu = null;
  }

  async function lockCard(cardId: string) {
    const entry = cardContextMenu;
    closeCardContextMenu();
    if (!entry) return;
    const pos = entry.currentPos;
    const { ok } = await persistArtefactPosition(sessionId, cardId, {
      artefactType: entry.cardKind,
      position: pos,
      pinned: true,
    });
    if (ok) {
      store.applyLocalPosition(cardId, pos.x, pos.y, true);
      // If there was a transient position, remove it now that it's persisted+locked.
      if (manualPos.has(cardId)) {
        const next = new Map(manualPos);
        next.delete(cardId);
        manualPos = next;
      }
    }
  }

  async function unlockCard(cardId: string) {
    const entry = cardContextMenu;
    closeCardContextMenu();
    if (!entry) return;
    // PATCH pinned:false — the card rejoins grouping since posOf keys on pinned===true.
    // We send the current position so the server round-trip is valid (position required).
    const pos = entry.currentPos;
    const { ok } = await persistArtefactPosition(sessionId, cardId, {
      artefactType: entry.cardKind,
      position: pos,
      pinned: false,
    });
    if (ok) {
      // Reflect unlock locally: pinned=false, keep canvasX/Y on the row but posOf
      // will ignore them (not pinned===true).
      store.applyLocalPosition(cardId, pos.x, pos.y, false);
    }
  }

  // Which node types the desk palette offers — scoped to the research set, not
  // the full workflow palette. 'intelligence' and 'research-result' are excluded
  // as they render as do-nothing placeholders on the desk.
  const DESK_PALETTE_TYPES = [
    'research-chat',
    'research-report',
    'webpage',
  ];

  // Wholesale-replace a desk node's config (deskNodes is $state.raw — never
  // mutate in place). Used by the webpage node's onConfigChange so URL/mode
  // edits persist into the ephemeral desk-node list.
  function updateDeskNodeConfig(id: string, patch: Record<string, unknown>) {
    deskNodes = deskNodes.map((nd) =>
      nd.id === id ? { ...nd, config: { ...nd.config, ...patch } } : nd,
    );
  }

  // ——— pan/zoom ———
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
    return shellClampZoom(z, MIN_ZOOM, MAX_ZOOM);
  }
  function zoomAt(cx: number, cy: number, factor: number) {
    const next = shellZoomAtPoint({ panX, panY, zoom }, { x: cx, y: cy }, factor, {
      min: MIN_ZOOM,
      max: MAX_ZOOM,
    });
    zoom = next.zoom;
    panX = next.panX;
    panY = next.panY;
  }
  function zoomCentered(factor: number) {
    const vp = viewportEl?.getBoundingClientRect();
    if (!vp) return;
    zoomAt(vp.width / 2, vp.height / 2, factor);
  }

  // ——— lifted from the workflow canvas (screen↔world + overlap avoidance) ———
  const DESK_NODE_W = 200;
  const DESK_NODE_H = 120;

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    if (!viewportEl) return { x: 0, y: 0 };
    const vp = viewportEl.getBoundingClientRect();
    return shellScreenToWorld({ panX, panY, zoom }, { x: clientX, y: clientY }, { x: vp.left, y: vp.top });
  }

  function viewportCenterInWorld(): { x: number; y: number } {
    if (!viewportEl) return { x: 320, y: 120 };
    const vp = viewportEl.getBoundingClientRect();
    return shellViewportCenterInWorld(
      { panX, panY, zoom },
      { width: vp.width, height: vp.height },
      { w: DESK_NODE_W, h: DESK_NODE_H },
    );
  }

  // Nudge a new node off any existing node so they don't stack exactly.
  function resolveOverlap(p: { x: number; y: number }): { x: number; y: number } {
    return shellResolveOverlap(p, deskNodes);
  }

  // ——— node palette (right-click → add node) ———
  // Lifted from src/routes/jkai/canvas/[slug]/+page.svelte, but the server
  // addNode (POST /api/workflows/<id>/nodes) and edge POST are REMOVED: desk
  // nodes are client-only ephemeral $state (decision §2.1).
  let paletteOpen = $state(false);
  let paletteAnchor = $state<{ x: number; y: number } | 'center'>('center');
  let paletteMode = $state<PaletteMode>({ kind: 'workflow-ranked' });
  let palettePositionOverride = $state<{ x: number; y: number } | null>(null);

  function openPalette(opts: {
    anchor: { x: number; y: number } | 'center';
    mode: PaletteMode;
    worldPosition?: { x: number; y: number } | null;
  }) {
    if (readonly || deskMode === 'quick') return;
    paletteAnchor = opts.anchor;
    paletteMode = opts.mode;
    palettePositionOverride = opts.worldPosition ?? null;
    paletteOpen = true;
  }
  function closePalette() {
    paletteOpen = false;
    palettePositionOverride = null;
  }

  function onPalettePick(type: string) {
    const meta = byNodeType(type);
    if (!meta) {
      closePalette();
      return;
    }
    const worldPos = palettePositionOverride ?? viewportCenterInWorld();
    const placement = resolveOverlap(worldPos);
    const id = `desknode-${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const defaults = DESK_NODE_DEFAULTS[meta.type] ?? { w: 320, h: 260 };
    const node: DeskNode = {
      id,
      type: meta.type,
      kind: mapTypeToKind(meta.type),
      x: placement.x,
      y: placement.y,
      w: defaults.w,
      h: defaults.h,
      config: { ...(meta.defaultConfig as Record<string, unknown>) },
    };
    deskNodes = [...deskNodes, node];
    selectedNodeId = id;
    closePalette();
  }

  // The candidate list NodePalette consumes — scoped to the research set above.
  const palettePickTypes = $derived(DESK_PALETTE_TYPES.map((t) => ({ type: t })));
  function fit() {
    const cards = visibleCards;
    if (!viewportEl || cards.length === 0) return;
    const vp = viewportEl.getBoundingClientRect();
    // Raw content bounds (no padding — the shell applies pad/inset/pan-inset).
    const xs = cards.map((c) => posFor(c));
    const next = shellFitToBounds(
      {
        minX: Math.min(...xs.map((p) => p.x)),
        minY: Math.min(...xs.map((p) => p.y)),
        maxX: Math.max(...cards.map((c) => posFor(c).x + cardW(c))),
        maxY: Math.max(...cards.map((c) => posFor(c).y + cardH(c))),
      },
      { width: vp.width, height: vp.height },
      { min: MIN_ZOOM, max: MAX_ZOOM },
    );
    zoom = next.zoom;
    panX = next.panX;
    panY = next.panY;
  }
  function reset() {
    panX = 0;
    panY = 0;
    zoom = 1;
  }
  // Delete/Backspace removes the currently-selected desk node.
  // Guard: only fires when the active element is NOT an input/textarea so we
  // don't eat keystrokes inside the research-chat node's text input.
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && focusedGroup) {
      e.preventDefault();
      clearFocus();
      return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
    if (!selectedNodeId) return;
    // Only delete desk nodes, not artefact cards.
    if (!deskNodes.some((n) => n.id === selectedNodeId)) return;
    e.preventDefault();
    deleteNode(selectedNodeId);
  }

  function isInteractiveTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    return !!el.closest('.ac, .desk-minimap, button, a, input, textarea, select');
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
    // Drift fix (M5a): mirror the workflow canvas's scrollable-child guard so a
    // wheel inside a scrollable desk-node interior (research-chat message list /
    // composer, report body/brief) scrolls natively instead of zooming the desk.
    const target = e.target as HTMLElement | null;
    if (target && target.closest('.rc-scroll, .rc-input, .report-node, .rn-brief-input')) {
      return;
    }
    e.preventDefault();
    const vp = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - vp.left;
    const cy = e.clientY - vp.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(cx, cy, factor);
  }

  // ——— mobile two-finger pinch-zoom (M5a drift fix; ported from the workflow
  // canvas). Single-finger pan stays on the existing pointer handlers above;
  // only the two-finger pinch gesture is added here. `pinch` is a plain `let`
  // (an internal gesture handle read only from these handlers) — never $state,
  // per the svelte5-pitfalls no-handle-in-$state rule. ———
  let pinch: { dist0: number; worldX: number; worldY: number; zoom0: number } | null = null;
  function pinchDistance(t1: Touch, t2: Touch): number {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }
  function onViewportTouchStart(e: TouchEvent) {
    if (e.touches.length < 2) return;
    const [t1, t2] = [e.touches[0], e.touches[1]];
    const midX = (t1.clientX + t2.clientX) / 2;
    const midY = (t1.clientY + t2.clientY) / 2;
    const world = screenToWorld(midX, midY);
    pinch = { dist0: pinchDistance(t1, t2), worldX: world.x, worldY: world.y, zoom0: zoom };
    // Cancel any pointer-pan the first finger started so pan + pinch don't fight.
    panStart = null;
  }
  function onViewportTouchMove(e: TouchEvent) {
    if (!pinch || e.touches.length < 2) return;
    e.preventDefault(); // stop the browser from also pinch-zooming the page
    const [t1, t2] = [e.touches[0], e.touches[1]];
    const dist1 = pinchDistance(t1, t2);
    const mid = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
    const next = shellPinchZoom(pinch, mid, dist1);
    zoom = next.zoom;
    panX = next.panX;
    panY = next.panY;
  }
  function onViewportTouchEnd(e: TouchEvent) {
    if (e.touches.length < 2) pinch = null;
  }

  // ——— node drag + grid-snap ———
  const DRAG_THRESHOLD = 3;
  const GRID = 20;
  let selectedId = $state<string | null>(null);
  // ——— viewport culling (see $lib/canvas/shell/cull) ———
  //
  // The desk used to render every filtered card as live DOM, plus a second node
  // each in the minimap. Production's biggest investigation is 3,453 cards —
  // about seventy thousand elements to show the forty you can actually see.
  //
  // Below the threshold nothing is culled: the bookkeeping costs more than it
  // saves, and small runs keep the exact behaviour they have always had.
  const CULL_THRESHOLD = 240;
  /** World-space padding, so a card is already mounted before it scrolls in. */
  const CULL_MARGIN = 700;
  /** Grid the rect snaps to, so a pan inside a cell recomputes nothing. */
  const CULL_STEP = 400;

  const culling = $derived(visibleCards.length > CULL_THRESHOLD && viewportW > 0 && viewportH > 0);

  /**
   * The culling rectangle, held stable BY REFERENCE across pans that do not
   * cross a cell boundary.
   *
   * A `$derived` propagates when its value changes, and an object literal is a
   * new value every time — so returning a fresh rect each frame would re-run
   * the cull on every pointer move even when the rect is numerically identical.
   * `last` is a plain `let`, not `$state`: it is a memo cell, and making it
   * reactive would be the write-inside-a-derived that Svelte 5 rightly refuses.
   */
  let lastCullRect: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  const cullRect = $derived.by(() => {
    const raw = quantiseRect(
      visibleWorldRect({ panX, panY, zoom }, { width: viewportW, height: viewportH }, CULL_MARGIN),
      CULL_STEP,
    );
    const p = lastCullRect;
    if (p && p.minX === raw.minX && p.minY === raw.minY && p.maxX === raw.maxX && p.maxY === raw.maxY) {
      return p;
    }
    lastCullRect = raw;
    return raw;
  });

  /**
   * The cards actually mounted. Everything else on the desk still reads
   * `visibleCards` — counters, the entity rail, edge endpoints, the minimap —
   * because those need to know about cards they do not draw.
   *
   * The pinned set is what stops culling breaking an interaction: a card being
   * dragged owns the pointer capture, and a selected or focused card is the one
   * the user is looking at. Unmounting any of those mid-gesture destroys the
   * node under their finger.
   */
  const renderedCards = $derived.by(() => {
    if (!culling) return visibleCards;
    return cullToRect(
      visibleCards,
      cullRect,
      (c) => {
        const p = positionById.get(c.id) ?? posOf(c);
        return { x: p.x, y: p.y, w: cardW(c), h: cardH(c) };
      },
      (c) => c.id === selectedId || !!dragOverrides[c.id] || focusedIds.has(c.id),
    );
  });

  /**
   * Zoomed far enough out that a card's text is a grey smear.
   *
   * Below this the cards render as plain blocks in their kind colour — the
   * shape of the desk is all anyone can read at that scale, and it is exactly
   * the moment the most cards are on screen. Only applied on a desk big enough
   * to need it, so a ten-card run never changes appearance.
   */
  const lowDetail = $derived(culling && isLowDetail(zoom));

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
    const p = posFor(c);
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
    if (wasMoved && finalPos && readonly) {
      // Readonly desk: keep the local drag override but never persist.
      return;
    }
    if (wasMoved && finalPos) {
      // Remove the in-flight drag override regardless of path below.
      const next = { ...dragOverrides };
      delete next[cardId];
      dragOverrides = next;

      if (c.pinned === true) {
        // LOCKED card: drag moves it and it stays locked — persist the new position.
        const { ok } = await persistArtefactPosition(sessionId, cardId, {
          artefactType: c.kind,
          position: finalPos,
          pinned: true,
        });
        if (ok) {
          store.applyLocalPosition(cardId, finalPos.x, finalPos.y, true);
        } else {
          // Persist failed — keep as transient fallback so card doesn't snap back.
          const next2 = new Map(manualPos);
          next2.set(cardId, finalPos);
          manualPos = next2;
        }
      } else if (!autoArrange) {
        // Auto-arrange OFF: the desk is a free workspace — the drag STICKS into
        // the frozen layout (no regroup will move it).
        const next2 = new Map(frozenPos);
        next2.set(cardId, finalPos);
        frozenPos = next2;
      } else {
        // UNLOCKED card, auto-arrange ON: transient only — stays here until the
        // next regroup, then rejoins its pile.
        const next2 = new Map(manualPos);
        next2.set(cardId, finalPos);
        manualPos = next2;
      }
    } else {
      // Tap (not drag) → open inspector.
      selectedId = c.id;
      openInspector(c.id);
    }
  }

  // ——— minimap ———
  const MINIMAP_BODY_W = 146;
  const MINIMAP_BODY_H = 60;
  const MINIMAP_PAD = 4;
  const minimap = $derived.by(() => {
    const cards = visibleCards;
    if (cards.length === 0 || viewportW === 0 || viewportH === 0) return null;
    // Item-bounds accumulation stays here (uses this surface's positions +
    // cardW/cardH); the shared viewport-frame folding + projection is in the shell.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of cards) {
      const p = positionById.get(c.id) ?? posOf(c);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      const r = p.x + cardW(c);
      const b = p.y + cardH(c);
      if (r > maxX) maxX = r;
      if (b > maxY) maxY = b;
    }
    return computeMinimap(
      { minX, minY, maxX, maxY },
      { panX, panY, zoom },
      { width: viewportW, height: viewportH },
      { bodyW: MINIMAP_BODY_W, bodyH: MINIMAP_BODY_H, pad: MINIMAP_PAD },
    );
  });

  // ——— minimap: draw, don't build ———
  let minimapCanvas = $state<HTMLCanvasElement | undefined>(undefined);

  /**
   * Repaint the minimap whenever the projection or the card set changes.
   *
   * An `$effect` rather than markup because there is exactly one node and its
   * contents are pixels, not elements. Reads `minimap` and `positionById`, and
   * writes only to the canvas — no reactive state is assigned here, so it
   * cannot feed itself (see the $state-in-effect trap in svelte5-pitfalls).
   */
  $effect(() => {
    const canvas = minimapCanvas;
    const m = minimap;
    if (!canvas) return;

    // Backing store at device resolution; CSS keeps the box at 146×60. Without
    // this the sub-pixel card marks alias into an unreadable smudge on a
    // retina display.
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
    const w = MINIMAP_BODY_W;
    const h = MINIMAP_BODY_H;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!m) return;

    // Colours resolved once per paint from the live theme, so the minimap
    // follows a theme switch the way the CSS-driven version did.
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--accent').trim() || '#c4570a';
    const primary = styles.getPropertyValue('--text-primary').trim() || '#222';

    for (const c of visibleCards) {
      const p = positionById.get(c.id) ?? posOf(c);
      const isEntity = c.kind === 'entity';
      ctx.globalAlpha = isEntity ? 0.8 : 0.55;
      ctx.fillStyle = isEntity ? primary : accent;
      ctx.fillRect(
        m.offsetX + (p.x - m.minX) * m.scale,
        m.offsetY + (p.y - m.minY) * m.scale,
        Math.max(2, cardW(c) * m.scale),
        Math.max(2, cardH(c) * m.scale),
      );
    }
    ctx.globalAlpha = 1;
  });

  // ——— morph gating ———
  // The 720ms `transition: transform` is only worth paying for cards that
  // actually MOVED since the last flush (e.g. on the GATHER⇄SYNTHESIZE flip).
  // Arming it on every non-pinned card re-pays the transition cost on every
  // streamed-in card during GATHER, even for cards that didn't budge.
  //
  // This is a $derived (NOT a $effect) so `morphIds` is published in the SAME
  // render flush as the transform change — a CSS `transition: transform` only
  // animates when the transform changes while the transition rule is already
  // present, so the `.morphing` class must land together with the new position,
  // not one flush later (which would snap instead of animate).
  //
  // `prevPos` is a PLAIN (non-reactive) Map: the derived reads last flush's
  // positions from it and writes this flush's back. Because it isn't $state,
  // mutating it does NOT invalidate the derived, so there is no self-loop.
  //
  // `prevPositionsRef` guards against a non-idempotent re-run: a stateful
  // derived must advance its snapshot exactly once per genuine input change.
  // `positionById` is a fresh Map identity on every real recompute, so if we
  // see the SAME reference again we return the cached result without touching
  // `prevPos` (otherwise the second pass would compare positions to themselves
  // and spuriously clear every card's morph flag).
  const prevPos = new Map<string, { x: number; y: number }>();
  let prevPositionsRef: Map<string, { x: number; y: number }> | null = null;
  let lastMorphIds = new Set<string>();

  const morphIds = $derived.by<Set<string>>(() => {
    // Tracked dep: positions (which itself depends on `mode` via posOf, so the
    // mode flip flows through). Movement is re-evaluated on any position change.
    const positions = positionById;
    if (positions === prevPositionsRef) return lastMorphIds;
    prevPositionsRef = positions;

    const moved = new Set<string>();
    for (const [id, p] of positions) {
      const before = prevPos.get(id);
      // A brand-new card (no `before`) is treated as "not moved" by samePos,
      // so streamed-in cards don't each arm a transition during GATHER.
      if (!samePos(before, p)) moved.add(id);
      prevPos.set(id, p);
    }
    // Drop positions for cards that are no longer visible so the map can't grow
    // unbounded across a long session.
    for (const id of prevPos.keys()) {
      if (!positions.has(id)) prevPos.delete(id);
    }
    lastMorphIds = moved;
    return moved;
  });
</script>

<div class="desk-shell" class:embedded onkeydown={onKeyDown}>
  <CommandBar
    topic={topic || sessionId.slice(0, 8)}
    {sessionId}
    status={sessionStatus}
    {mode}
    {synthesising}
    {counts}
    compact={embedded}
    controlsHidden={readonly || deskMode === 'quick'}
    onmode={handleMode}
    onskip={handleSkip}
    onstop={handleStop}
    ondeepen={handleDeepen}
    onshare={handleShare}
    onexport={handleExport}
  />

    <!-- desk world -->
    <div
      class="desk-world-wrap"
      class:panning={panStart !== null}
      bind:this={viewportEl}
      bind:clientWidth={viewportW}
      bind:clientHeight={viewportH}
      role="application"
      aria-label="Research desk"
      style:--grid-offset-x="{panX}px"
      style:--grid-offset-y="{panY}px"
      style:--grid-cell="{32 * zoom}px"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      ontouchstart={onViewportTouchStart}
      ontouchmove={onViewportTouchMove}
      ontouchend={onViewportTouchEnd}
      ontouchcancel={onViewportTouchEnd}
      onwheel={onWheel}
      oncontextmenu={(e) => {
        if (readonly || deskMode === 'quick') return;
        const target = e.target as HTMLElement;
        // Don't hijack right-clicks landing on a card or an existing desk node.
        if (target.closest('.desk-card-host, .desk-node-host')) return;
        e.preventDefault();
        const world = screenToWorld(e.clientX, e.clientY);
        openPalette({
          anchor: { x: e.clientX, y: e.clientY },
          mode: { kind: 'workflow-ranked' },
          worldPosition: world,
        });
      }}
    >
      <!-- world layer -->
      <div class="desk-world" style:transform="translate({panX}px, {panY}px) scale({zoom})" style:transform-origin="0 0">
        <!-- edges (relationships between entity cards) -->
        <svg class="desk-edges" aria-hidden="true" overflow="visible">
          <!-- One path per edge. There was a second, transparent 14px-wide
               `.edge-hit` path under each stroke — a hit target for a click
               handler that does not exist, with `pointer-events: none` set on
               both the attribute and the rule. It caught nothing, drew nothing,
               and doubled the node count of the densest layer on the desk. -->
          {#each edgePaths as e (e.id)}
            <path class="edge-stroke" d={e.d} fill="none" stroke="var(--text-ghost)" stroke-width="1.25" vector-effect="non-scaling-stroke" pointer-events="none" />
          {/each}

          <!-- provenance sparks: source→fact, draw-in then fade (~1.2s) -->
          {#each sparkPaths as s (s.id)}
            <path
              d={s.d}
              fill="none"
              stroke="var(--accent)"
              stroke-width="2"
              pathLength="1"
              vector-effect="non-scaling-stroke"
              class="prov-spark"
            />
          {/each}
          {#if mode === 'synthesize'}
            {#each synthEdgePaths as e (e.id)}
              <path
                d={e.d}
                fill="none"
                stroke="var(--accent)"
                stroke-width="1.5"
                stroke-dasharray="3 3"
                vector-effect="non-scaling-stroke"
                class="syn-edge"
              />
            {/each}
          {/if}
        </svg>

        <!-- category headers + entity rail (SYNTHESIZE only) -->
        {#if mode === 'synthesize'}
          <!-- synthesis zone boundary: hairline bracket + label, sits in world-space -->
          {#if categories.length > 0}
            {@const zoneX = SYNTHESIS_ZONE_ORIGIN.x - 24}
            {@const zoneY = SYNTHESIS_ZONE_ORIGIN.y - 36}
            <div
              class="synthesis-zone-boundary"
              style:transform="translate({zoneX}px, {zoneY}px)"
              aria-hidden="true"
            >
              <span class="synthesis-zone-label">&#9635; SYNTHESIS &middot; organised intelligence</span>
            </div>
            <div
              class="synthesis-zone-rule"
              style:transform="translate({BAND.originX}px, {SYNTHESIS_ZONE_ORIGIN.y - SYNTHESIS_ZONE_GAP / 2}px)"
              aria-hidden="true"
            ></div>
          {/if}

          {#if railEntities.length}
            {@const railY = pilePositions.get(railEntities[0].id)?.y ?? 0}
            <div class="desk-rail-host" style:transform="translate({ORG.originX}px, {railY}px)">
              <EntityRail count={railEntities.length} />
            </div>
          {/if}
        {/if}

        <!-- pile headers: one unified card per group; click to spread the group
             into open space (focus) and click again / Esc to collapse back. -->
        {#each pileHeaders as ph (ph.key)}
          {@const isFocused = focusedGroup === ph.key}
          {@const hpos = isFocused && focusSpread ? focusSpread.heading : { x: ph.pos.x, y: ph.pos.y - 72 }}
          <div
            class="desk-pile-host"
            class:dimmed-heading={focusActive && !isFocused}
            style:transform="translate({hpos.x}px, {hpos.y}px)"
            style:z-index={isFocused ? 3200 : 200}
          >
            <GroupHeaderCard
              title={ph.label}
              count={ph.count}
              summary={groupDim === 'cluster' ? (categorySummary[ph.key] ?? '') : ''}
              focused={isFocused}
              onclick={() => focusGroup(ph.key)}
            />
          </div>
        {/each}

        <!-- cards. `renderedCards` is `visibleCards` culled to the viewport once
             the desk is big enough to need it — counters, the entity rail and
             edge endpoints all still read the full `visibleCards`. -->
        {#each renderedCards as c (c.id)}
          {@const p = positionById.get(c.id) ?? posOf(c)}
          {@const live = cardLive.get(c.id)}
          {@const pile = cardPileInfo.get(c.id)}
          {@const tilt = c.pinned === true ? 0 : cardTilt(c.id)}
          {#if pile?.render ?? true}
            <div
              class="desk-card-host"
              class:morphing={c.pinned !== true && !manualPos.has(c.id) && !dragOverrides[c.id] && morphIds.has(c.id)}
              class:is-selected={selectedId === c.id}
              class:is-locked={c.pinned === true}
              class:dimmed={focusActive && !focusedIds.has(c.id)}
              data-kind={kindOf(c)}
              style:transform="translate({p.x}px, {p.y}px) rotate({focusedIds.has(c.id) ? 0 : tilt}deg)"
              style:z-index={focusedIds.has(c.id) ? 3000 + (pile?.idx ?? 0) : (pile?.z ?? 1)}
              onpointerdown={(e) => onCardPointerDown(e, c)}
              onpointermove={onCardPointerMove}
              onpointerup={(e) => onCardPointerUp(e, c)}
              onpointercancel={(e) => onCardPointerUp(e, c)}
              oncontextmenu={(e) => { if (readonly || deskMode === 'quick') return; openCardContextMenu(e, c); }}
            >
              {#if lowDetail}
                <!-- Zoomed out past readability: a block of the card's size and
                     kind colour. The liveness wrapper and the card subtree are
                     the expensive part and neither is legible at this scale. -->
                <div class="desk-card-lod" style:width="{cardW(c)}px" style:height="{cardH(c)}px"></div>
              {:else}
                <CardLiveWrapper
                  enterDelayMs={live?.enterDelayMs ?? 0}
                  fresh={live?.fresh ?? false}
                  breathing={deskRunning}
                >
                  <ArtefactCard
                    card={c}
                    selected={selectedId === c.id}
                    analysing={c.kind === 'source' && analysingSourceId === c.id}
                    onselect={(id) => { selectedId = id; openInspector(id); }}
                    onsummarize={(id) => { selectedId = id; openInspector(id, { summarize: true }); }}
                  />
                </CardLiveWrapper>
              {/if}
            </div>
          {/if}
        {/each}

        <!-- client-only desk nodes (research-chat / research-report).
             M7: research-chat renders via ResearchChatNode; others keep the
             placeholder label. Generic drag is wired here so all nodes can be
             repositioned; positions update in deskNodes $state.
             Each node's w/h is stored in deskNodes and rendered via inline style;
             a resize handle (bottom-right corner) adjusts w/h via pointer capture,
             stopPropagation prevents triggering node-drag. -->
        {#each deskNodes as n (n.id)}
          <div
            class="desk-node-host"
            class:is-selected={selectedNodeId === n.id}
            style:transform="translate({n.x}px, {n.y}px)"
            style:width="{n.w}px"
            style:height="{n.h}px"
            data-kind={n.kind}
            role="button"
            tabindex="0"
            onpointerdown={(e) => onDeskNodePointerDown(e, n)}
            onpointermove={onDeskNodePointerMove}
            onpointerup={onDeskNodePointerUp}
            onpointercancel={onDeskNodePointerUp}
            oncontextmenu={(e) => openNodeContextMenu(e, n)}
          >
            {#if n.kind === 'research-chat'}
              <ResearchChatNode
                sessionId={n.config?.sessionId != null ? String(n.config.sessionId) : sessionId}
                nodeId={n.id}
                {readonly}
              />
            {:else if n.kind === 'research-report'}
              <ReportNode
                {sessionId}
                cards={store.cards}
                {sessionStatus}
                {canRegenerate}
                onexport={(kind) => handleExport(kind)}
              />
            {:else if n.kind === 'webpage'}
              <!-- E4 parity: the real workflow-canvas WebpageNode (self-contained
                   props — no workflow state), wrapped with a grab-header so the
                   node stays draggable while the iframe/URL bar stay interactive. -->
              <div class="desk-webpage-wrap">
                <div class="desk-webpage-hdr">
                  <span class="desk-webpage-tag">WEB</span>
                  <span class="desk-webpage-name">{byNodeType(n.type)?.label ?? 'Webpage'}</span>
                </div>
                <div class="desk-webpage-body" onpointerdown={(e) => e.stopPropagation()}>
                  <WebpageNode
                    nodeId={n.id}
                    config={(n.config as WebpageConfig) ?? { url: '', mode: null, size: { w: 480, h: 360 } }}
                    onConfigChange={(patch) => updateDeskNodeConfig(n.id, patch as Record<string, unknown>)}
                  />
                </div>
              </div>
            {:else}
              <span class="desk-node-bar" style:background={'var(--accent-ink)'}></span>
              <div class="desk-node-body">
                <span class="desk-node-label">{byNodeType(n.type)?.label ?? n.type}</span>
                <span class="desk-node-hint">{n.type}</span>
              </div>
            {/if}
            <!-- Resize handle: bottom-right corner. stopPropagation prevents node-drag. -->
            <div
              class="desk-node-resize"
              role="separator"
              aria-label="Resize node"
              onpointerdown={(e) => onResizePointerDown(e, n)}
              onpointermove={onResizePointerMove}
              onpointerup={onResizePointerUp}
              onpointercancel={onResizePointerUp}
            ></div>
          </div>
        {/each}
      </div>

      <!-- view-locked floating filter box (sibling of the transformed world) -->
      <FloatingFilters
        filters={typeFilters}
        {counts}
        onfilter={handleFilter}
        groupBy={groupDim}
        ongroupby={(d) => { groupDim = d; }}
        {autoArrange}
        onautoarrange={setAutoArrange}
        onarrangenow={arrangeNow}
        search={searchQuery}
        onsearch={(q) => { searchQuery = q; }}
      />

      <!-- minimap -->
      <div class="desk-minimap">
        <div class="desk-minimap-head"><span>MINIMAP</span><span>{zoomPct}%</span></div>
        <div class="desk-minimap-body">
          <!-- Drawn, not built. This used to be one absolutely-positioned div
               per card — a second full copy of the desk in the DOM, 3,453
               elements on the biggest run, to fill a box 146px wide where every
               card is under two pixels. One canvas costs the same at any size. -->
          <canvas class="desk-minimap-canvas" bind:this={minimapCanvas}></canvas>
          {#if minimap}
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

      <!-- zoom controls (workflow .hifi-zoomctl chrome) -->
      <div class="desk-zoom hifi-zoomctl" role="group" aria-label="Zoom controls">
        <button type="button" onclick={() => zoomCentered(1 / 1.2)} aria-label="Zoom out">−</button>
        <span class="zv">{zoomPct}%</span>
        <button type="button" onclick={() => zoomCentered(1.2)} aria-label="Zoom in">+</button>
        <button type="button" onclick={fit} aria-label="Fit">⤢</button>
        <button type="button" onclick={reset} aria-label="Reset">⌂</button>
      </div>
    </div>

  <ActivityTicker
    logs={store.logs}
    live={isRunning(sessionStatus) || synthesising}
    feed={store.feed}
    connectionState={store.connectionState}
    rateBuckets={store.rateBuckets}
  />

  <InspectorDrawer
    bind:open={inspectorOpen}
    {sessionId}
    artefact={inspectorArtefact}
    relatedGroups={inspectorRelated}
    summarize={inspectorSummarize}
    onclose={() => (inspectorOpen = false)}
    onselect={(id) => openInspector(id)}
  />

  <!-- Desk node context menu — rendered fixed so it escapes the world transform. -->
  {#if nodeContextMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="desk-node-ctx-backdrop"
      onclick={closeNodeContextMenu}
    ></div>
    <div
      class="desk-node-ctx"
      style:left="{nodeContextMenu.screenX}px"
      style:top="{nodeContextMenu.screenY}px"
      role="menu"
    >
      <button
        type="button"
        class="desk-node-ctx-item desk-node-ctx-delete"
        role="menuitem"
        onclick={() => deleteNode(nodeContextMenu!.nodeId)}
      >Delete</button>
    </div>
  {/if}

  <!-- Card context menu — Lock/Unlock position. Rendered fixed to escape world transform. -->
  {#if cardContextMenu}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="desk-node-ctx-backdrop"
      onclick={closeCardContextMenu}
    ></div>
    <div
      class="desk-node-ctx"
      style:left="{cardContextMenu.screenX}px"
      style:top="{cardContextMenu.screenY}px"
      role="menu"
    >
      {#if cardContextMenu.pinned}
        <button
          type="button"
          class="desk-node-ctx-item"
          role="menuitem"
          onclick={() => unlockCard(cardContextMenu!.cardId)}
        >Unlock position</button>
      {:else}
        <button
          type="button"
          class="desk-node-ctx-item"
          role="menuitem"
          onclick={() => lockCard(cardContextMenu!.cardId)}
        >Lock position</button>
      {/if}
    </div>
  {/if}
</div>

<NodePalette
  open={paletteOpen}
  anchor={paletteAnchor}
  mode={paletteMode}
  canvasNodes={palettePickTypes}
  restrictTypes={DESK_PALETTE_TYPES}
  onPick={onPalettePick}
  onClose={closePalette}
/>

<style>
  .desk-shell {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--text-primary);
    overflow: hidden;
  }

  /* Embedded (canvas-node) variant: fill the parent box instead of the viewport. */
  .desk-shell.embedded {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .desk-world-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
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
  .desk-world-wrap.panning { cursor: grabbing; }
  .desk-world { position: absolute; top: 0; left: 0; }
  .desk-edges { position: absolute; top: 0; left: 0; width: 1px; height: 1px; pointer-events: none; }
  .desk-card-host {
    position: absolute;
    top: 0;
    left: 0;
    touch-action: none;
    will-change: transform;
  }
  /* 3px left bar keyed off data-kind, matching .wf-node[data-kind]::before. */
  .desk-card-host::before {
    content: '';
    position: absolute;
    left: -4px;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--text-ghost);
    pointer-events: none;
    z-index: 1;
  }
  /* Low-detail stand-in, drawn below LOD_ZOOM. Same footprint and the same kind
     colour as the real card, so the shape of the desk is unchanged — it is the
     text and the liveness wrapper that go, and neither is legible at that
     scale. Inherits the host's ::before kind bar exactly as a real card does. */
  .desk-card-lod {
    background: var(--surface-elevated);
    border: 1px solid var(--line-hair);
    opacity: 0.85;
  }

  .desk-card-host[data-kind='source']::before { background: var(--text-muted); }
  .desk-card-host[data-kind='fact']::before { background: var(--accent); }
  .desk-card-host[data-kind='entity']::before { background: var(--text-primary); }
  .desk-card-host[data-kind='counterfactual']::before { background: var(--error); }
  /* Selection outline, matching .wf-node.is-selected. */
  .desk-card-host.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    z-index: 3;
  }

  /* Locked card: subtle top-right pin indicator so user knows it's pinned. */
  .desk-card-host.is-locked::after {
    content: '◉';
    position: absolute;
    top: -10px;
    right: 2px;
    font-size: var(--fs-label-xs);
    color: var(--accent);
    pointer-events: none;
    font-family: var(--font-mono);
    letter-spacing: 0;
    line-height: 1;
    opacity: 0.8;
  }

  .desk-card-host.morphing {
    /* Smooth, slightly slower morph between layouts (ease-in-out). */
    transition: transform 720ms cubic-bezier(0.4, 0.0, 0.2, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .desk-card-host.morphing { transition: none; }
  }

  .desk-rail-host {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
    transition: opacity 360ms ease;
  }

  /* Pile headers — one unified GroupHeaderCard per group; click to spread/focus.
     Transitions transform so a header glides to/from the spread position. */
  .desk-pile-host {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
    z-index: 200; /* headers above fanned cards, below dragged (1000) */
    transition: transform 720ms cubic-bezier(0.4, 0.0, 0.2, 1), opacity 360ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .desk-pile-host { transition: opacity 360ms ease; }
  }

  /* Group-focus dimming: everything not in the focused group recedes so the
     spread-out group stands out and is the only thing you can interact with. */
  .desk-card-host.dimmed,
  .desk-pile-host.dimmed-heading {
    opacity: 0.16;
    pointer-events: none;
    transition: opacity 280ms ease;
  }

  .syn-edge { animation: syn-fade-in 600ms ease both; }
  @keyframes syn-fade-in {
    from { stroke-opacity: 0; }
    to { stroke-opacity: 0.45; }
  }
  @media (prefers-reduced-motion: reduce) {
    .syn-edge { animation: none; }
  }

  /* Provenance spark (Feature 2): draw the line in (dashoffset 1→0, pathLength
     normalised to 1), hold briefly, then fade. The store removes the node after
     ~1.2s, so the animation runs once and the element disappears. */
  .prov-spark {
    stroke-dasharray: 1;
    animation: prov-spark 1200ms ease-out both;
  }
  @keyframes prov-spark {
    0% { stroke-dashoffset: 1; stroke-opacity: 0.9; }
    40% { stroke-dashoffset: 0; stroke-opacity: 0.9; }
    70% { stroke-dashoffset: 0; stroke-opacity: 0.6; }
    100% { stroke-dashoffset: 0; stroke-opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    /* No draw-in motion; just a brief static-then-fade so it's still legible. */
    .prov-spark { stroke-dasharray: none; animation: prov-spark-fade 1200ms linear both; }
  }
  @keyframes prov-spark-fade {
    0%, 60% { stroke-opacity: 0.7; }
    100% { stroke-opacity: 0; }
  }

  .desk-minimap {
    position: absolute;
    bottom: 12px;
    right: 12px;
    width: 146px;
    background: var(--surface-elevated);
    border: 1px solid rgba(26, 16, 8, 0.18);
    user-select: none;
  }
  .desk-minimap-head {
    display: flex;
    justify-content: space-between;
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    color: var(--text-muted);
    border-bottom: 1px solid rgba(26, 16, 8, 0.12);
  }
  .desk-minimap-body { position: relative; width: 146px; height: 60px; }
  .desk-minimap-canvas { position: absolute; inset: 0; width: 146px; height: 60px; }
  .desk-minimap-frame { position: absolute; border: 1px solid var(--accent); background: rgba(196, 87, 10, 0.08); }

  /* Zoom controls — workflow .hifi-zoomctl chrome, anchored bottom-left. */
  .desk-zoom {
    position: absolute;
    bottom: 12px;
    left: 12px;
  }
  .hifi-zoomctl {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--card-border);
    background: var(--surface-elevated);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .hifi-zoomctl button {
    background: transparent;
    border: none;
    padding: 5px 9px;
    cursor: pointer;
    color: var(--text-primary);
    font-family: inherit;
    font-size: inherit;
  }
  .hifi-zoomctl button + button {
    border-left: 1px solid var(--card-border);
  }
  .hifi-zoomctl button:hover {
    color: var(--accent);
  }
  .hifi-zoomctl .zv {
    padding: 0 8px;
    color: var(--text-muted);
    border-left: 1px solid var(--card-border);
  }

  /* ——— synthesis zone markers (world-space, pan/zoom with cards) ——— */
  .synthesis-zone-boundary {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
    pointer-events: none;
    user-select: none;
  }
  .synthesis-zone-label {
    display: block;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted, rgba(26, 16, 8, 0.45));
    white-space: nowrap;
    padding: 2px 6px;
    border-left: 2px solid var(--accent, #c4570a);
    border-top: 1px solid rgba(26, 16, 8, 0.18);
    background: transparent;
  }

  /* Hairline divider spanning the scatter width, midway through the gap */
  .synthesis-zone-rule {
    position: absolute;
    top: 0;
    left: 0;
    width: 2160px; /* 3 × BAND.width */
    height: 0;
    border-top: 1px dashed rgba(26, 16, 8, 0.18);
    will-change: transform;
    pointer-events: none;
    user-select: none;
  }

  .desk-node-host {
    position: absolute;
    top: 0;
    left: 0;
    min-width: 180px;
    display: flex;
    align-items: stretch;
    background: var(--surface-elevated);
    border: 1.5px solid var(--card-border);
    border-radius: 2px;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    /* w/h driven by inline style:width / style:height from deskNodes */
  }
  /* Let the header area remain a grab target for chat/report nodes. */
  .desk-node-host :global(.rc-header) {
    cursor: grab;
  }
  .desk-node-host :global(.rn-head) {
    cursor: grab;
  }

  /* Webpage desk node (E4 parity). The grab-header bubbles pointerdown to the
     host for drag; the body stops propagation so the iframe/URL bar stay live. */
  .desk-webpage-wrap {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .desk-webpage-hdr {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider);
    background: var(--surface-elevated);
    cursor: grab;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .desk-webpage-tag { color: var(--accent-ink, var(--accent)); }
  .desk-webpage-name {
    color: var(--text-primary);
    text-transform: none;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desk-webpage-body {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .desk-webpage-body :global(.webpage-node) {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  /* Resize handle — 10×10 px, bottom-right corner, sits above all children. */
  .desk-node-resize {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 14px;
    height: 14px;
    cursor: se-resize;
    z-index: 10;
    /* Subtle diagonal grip indicator */
    background: linear-gradient(
      135deg,
      transparent 40%,
      var(--card-border) 40%,
      var(--card-border) 55%,
      transparent 55%,
      transparent 65%,
      var(--card-border) 65%,
      var(--card-border) 80%,
      transparent 80%
    );
    opacity: 0.6;
    pointer-events: all;
  }
  .desk-node-resize:hover {
    opacity: 1;
  }
  .desk-node-host.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 0;
  }
  .desk-node-bar {
    width: 3px;
    flex: 0 0 3px;
  }
  .desk-node-body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
  }
  .desk-node-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }
  .desk-node-hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }

  /* ——— desk node right-click context menu ——— */
  .desk-node-ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: transparent;
    cursor: default;
  }
  .desk-node-ctx {
    position: fixed;
    z-index: 9001;
    background: var(--surface-elevated);
    border: 1.5px solid var(--card-border);
    min-width: 120px;
    padding: 2px 0;
  }
  .desk-node-ctx-item {
    display: block;
    width: 100%;
    padding: 7px 14px;
    background: transparent;
    border: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
  }
  .desk-node-ctx-item:hover {
    background: var(--card-bg);
  }
  .desk-node-ctx-delete {
    color: var(--error);
  }
  .desk-node-ctx-delete:hover {
    background: var(--error-bg);
  }
</style>
