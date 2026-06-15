<!-- src/lib/canvas/intelligence/ResearchDesk.svelte -->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import NodePalette, { type Mode as PaletteMode } from '$lib/canvas/NodePalette.svelte';
  import { byType as byNodeType, mapTypeToKind, type NodeKind } from '$lib/canvas/adapter';
  import ArtefactCard from './desk/ArtefactCard.svelte';
  import CardLiveWrapper from './desk/CardLiveWrapper.svelte';
  import CategoryHeader from './desk/CategoryHeader.svelte';
  import ThemeHeader from './desk/ThemeHeader.svelte';
  import EntityRail from './desk/EntityRail.svelte';
  import CommandBar from './desk/CommandBar.svelte';
  import FloatingFilters from './desk/FloatingFilters.svelte';
  import ActivityTicker from './desk/ActivityTicker.svelte';
  import InspectorDrawer from './desk/InspectorDrawer.svelte';
  import ResearchChatNode from './desk/ResearchChatNode.svelte';
  import ReportNode from './desk/ReportNode.svelte';
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
  let inspectorOpen = $state(false);
  let inspectorArtefact = $state<any>(null);
  let inspectorRelated = $state<{ id: string; kind: 'source' | 'fact' | 'entity'; label: string }[]>([]);
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

  // Expanded pile keys. A pile is collapsed (fanned stack) unless its group key
  // is in this set; expanding spreads members into a column (animated via morphIds).
  let expandedPiles = $state.raw<Set<string>>(new Set());

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
  // dragged-but-not-locked cards rejoin their new piles. A plain let tracks the
  // previous dim value; the $effect guard prevents self-fire on init.
  let prevGroupDim: GroupDim | null = null;
  $effect(() => {
    const dim = groupDim;
    if (prevGroupDim !== null && prevGroupDim !== dim) {
      untrack(() => { manualPos = new Map(); });
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
  function togglePile(key: string) {
    const next = new Set(expandedPiles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedPiles = next;
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

  // Related artefacts: any card that references the selected id by known link fields.
  function relatedFor(id: string): { id: string; kind: 'source' | 'fact' | 'entity'; label: string }[] {
    const out: { id: string; kind: 'source' | 'fact' | 'entity'; label: string }[] = [];
    for (const c of store.cards) {
      if (c.id === id) continue;
      const f = c.fields as any;
      const linked =
        f.refutesFactId === id ||
        f.sourceId === id ||
        f.fromEntityId === id ||
        f.toEntityId === id;
      if (linked) {
        const kind: 'source' | 'fact' | 'entity' = c.kind === 'entity' ? 'entity' : c.kind === 'source' ? 'source' : 'fact';
        out.push({
          id: c.id,
          kind,
          label: String(f.content ?? f.name ?? f.title ?? c.id),
        });
      }
    }
    return out.slice(0, 12);
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

  // Filtered card list (honoured by the desk render; counters use store.cards directly).
  const visibleCards = $derived(store.cards.filter((c) => typeFilters[cardFilterKey(c)]));

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

  // Set of visible card IDs for edge filtering.
  const visibleIds = $derived(new Set(visibleCards.map((c) => c.id)));

  // Entity rail
  const railEntities = $derived.by(() =>
    visibleCards.filter((c) => c.kind === 'entity'),
  );

  function posOf(c: DeskCard): { x: number; y: number } {
    // 1. In-flight drag override (pointer is still down).
    const ov = dragOverrides[c.id];
    if (ov) return ov;
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

  // ——— orthPath ———
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
      if (!a || !b) continue;
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
    if (!visibleIds.has(anchorId)) return null;
    const card = visibleCards.find((c) => c.id === anchorId);
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
  ];

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

  // ——— lifted from the workflow canvas (screen↔world + overlap avoidance) ———
  const DESK_NODE_W = 200;
  const DESK_NODE_H = 120;

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    if (!viewportEl) return { x: 0, y: 0 };
    const vp = viewportEl.getBoundingClientRect();
    return {
      x: (clientX - vp.left - panX) / zoom,
      y: (clientY - vp.top - panY) / zoom,
    };
  }

  function viewportCenterInWorld(): { x: number; y: number } {
    if (!viewportEl) return { x: 320, y: 120 };
    const vp = viewportEl.getBoundingClientRect();
    const cx = (vp.width / 2 - panX) / zoom;
    const cy = (vp.height / 2 - panY) / zoom;
    const x = Math.round((cx - DESK_NODE_W / 2) / 20) * 20;
    const y = Math.round((cy - DESK_NODE_H / 2) / 20) * 20;
    return { x, y };
  }

  // Nudge a new node off any existing node so they don't stack exactly.
  function resolveOverlap(p: { x: number; y: number }): { x: number; y: number } {
    let { x, y } = p;
    const limit = 20;
    for (let i = 0; i < limit; i++) {
      const clashes = deskNodes.some((n) => Math.hypot(n.x - x, n.y - y) < 40);
      if (!clashes) return { x, y };
      x += 24;
      y += 24;
    }
    return { x, y };
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
    const pad = 48;
    const xs = cards.map((c) => posFor(c));
    const minX = Math.min(...xs.map((p) => p.x)) - pad;
    const minY = Math.min(...xs.map((p) => p.y)) - pad;
    const maxX = Math.max(...cards.map((c) => posFor(c).x + cardW(c))) + pad;
    const maxY = Math.max(...cards.map((c) => posFor(c).y + cardH(c))) + pad;
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
  // Delete/Backspace removes the currently-selected desk node.
  // Guard: only fires when the active element is NOT an input/textarea so we
  // don't eat keystrokes inside the research-chat node's text input.
  function onKeyDown(e: KeyboardEvent) {
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
    e.preventDefault();
    const vp = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cx = e.clientX - vp.left;
    const cy = e.clientY - vp.top;
    const factor = Math.exp(-e.deltaY * 0.0015);
    zoomAt(cx, cy, factor);
  }

  // ——— node drag + grid-snap ———
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
          {#each edgePaths as e (e.id)}
            <path class="edge-hit" d={e.d} stroke="transparent" stroke-width="14" fill="none" pointer-events="none" />
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

        <!-- pile headers: one per group, anchored over its stack; click to expand/collapse -->
        {#each pileHeaders as ph (ph.key)}
          <div
            class="desk-pile-host"
            class:expanded={expandedPiles.has(ph.key)}
            style:transform="translate({ph.pos.x}px, {ph.pos.y - 72}px)"
          >
            <button
              type="button"
              class="pile-toggle"
              aria-expanded={expandedPiles.has(ph.key)}
              title={expandedPiles.has(ph.key) ? 'Collapse pile' : 'Expand pile'}
              onclick={() => togglePile(ph.key)}
            >
              {#if groupDim === 'cluster'}
                <CategoryHeader
                  id={ph.key}
                  title={ph.label}
                  summary={categorySummary[ph.key] ?? ''}
                  count={ph.count}
                />
              {:else}
                <ThemeHeader label={ph.label} count={ph.count} />
              {/if}
              <span class="pile-chevron" aria-hidden="true">{expandedPiles.has(ph.key) ? '▾' : '▸'}</span>
            </button>
          </div>
        {/each}

        <!-- cards (filtered by typeFilters; counters still use store.cards directly) -->
        {#each visibleCards as c (c.id)}
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
              data-kind={kindOf(c)}
              style:transform="translate({p.x}px, {p.y}px) rotate({tilt}deg)"
              style:z-index={pile?.z ?? 1}
              onpointerdown={(e) => onCardPointerDown(e, c)}
              onpointermove={onCardPointerMove}
              onpointerup={(e) => onCardPointerUp(e, c)}
              onpointercancel={(e) => onCardPointerUp(e, c)}
              oncontextmenu={(e) => { if (readonly || deskMode === 'quick') return; openCardContextMenu(e, c); }}
            >
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
            {:else}
              <span class="desk-node-bar" style:background={'#7a6cd4'}></span>
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
      />

      <!-- minimap -->
      <div class="desk-minimap">
        <div class="desk-minimap-head"><span>MINIMAP</span><span>{zoomPct}%</span></div>
        <div class="desk-minimap-body">
          {#if minimap}
            {#each visibleCards as c (c.id + '-m')}
              {@const p = positionById.get(c.id) ?? posOf(c)}
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
    related={inspectorRelated}
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
  .desk-edges .edge-hit { cursor: default; pointer-events: none; }
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
  .desk-card-host[data-kind='source']::before { background: var(--text-muted); }
  .desk-card-host[data-kind='fact']::before { background: var(--accent); }
  .desk-card-host[data-kind='entity']::before { background: var(--text-primary); }
  .desk-card-host[data-kind='counterfactual']::before { background: #c44; }
  /* Selection outline, matching .wf-node.is-selected. */
  .desk-card-host.is-selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    z-index: 3;
  }

  /* Locked card: subtle top-right lock indicator so user knows it's pinned. */
  .desk-card-host.is-locked::after {
    content: '⚑';
    position: absolute;
    top: -10px;
    right: 2px;
    font-size: 9px;
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

  /* Pile headers — world-space label + count badge over each group's stack;
     clickable to expand/collapse. */
  .desk-pile-host {
    position: absolute;
    top: 0;
    left: 0;
    will-change: transform;
    z-index: 200; /* headers above fanned cards, below dragged (1000) */
    transition: opacity 360ms ease;
  }
  .pile-toggle {
    display: inline-flex;
    align-items: flex-start;
    gap: 4px;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .pile-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .pile-chevron {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    line-height: 1;
    margin-top: 2px;
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
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    font-family: var(--font-mono);
    font-size: 11px;
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
    font-size: 10px;
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
    font-size: 12px;
    font-weight: 500;
    color: var(--text-primary);
    letter-spacing: 0.02em;
  }
  .desk-node-hint {
    font-family: var(--font-mono);
    font-size: 9px;
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
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.12);
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
    font-size: 11px;
    letter-spacing: 0.06em;
    text-align: left;
    cursor: pointer;
    color: var(--text-primary);
  }
  .desk-node-ctx-item:hover {
    background: var(--card-bg);
  }
  .desk-node-ctx-delete {
    color: #c44;
  }
  .desk-node-ctx-delete:hover {
    background: rgba(204, 68, 68, 0.08);
  }
</style>
