<script lang="ts">
  // The Intel command centre.
  //
  // Every panel answers a question and every answer carries an action:
  //   - the graph answers "what is connected to what"
  //   - insights answer "what should I look at that I didn't ask about"
  //   - the commission bar answers "and what do I do about it"
  //
  // The layout is TWO panes, not three. An entity used to open in a permanent
  // right-hand rail, which cost a third of the width whether or not anything was
  // selected and rendered a different card from the one the same entity opens in
  // chat. It now opens as the chat card, over the graph, at the point that was
  // clicked — one component, one design, and the graph keeps the space.
  //
  // Heavy work is fetched after first paint, and the findings section — the
  // expensive one, a full surprise sweep — is not fetched at all until it is
  // opened.

  import NetworkGraph from '$lib/components/intel/NetworkGraph.svelte';
  import NetworkGraph3D from '$lib/components/intel/NetworkGraph3D.svelte';
  import ClusterPicker from '$lib/components/intel/ClusterPicker.svelte';
  import type { ClusterRoster } from '$lib/components/intel/cluster-types';
  import SourcePicker from '$lib/components/intel/SourcePicker.svelte';
  import RecencySlicer from '$lib/components/intel/RecencySlicer.svelte';
  import RailSection from '$lib/components/intel/RailSection.svelte';
  import GmailSweepPanel from '$lib/components/intel/GmailSweepPanel.svelte';
  import SweepHistoryPanel from '$lib/components/intel/SweepHistoryPanel.svelte';
  import EntityHoverCard from '$lib/components/intel/EntityHoverCard.svelte';
  import InsightCard from '$lib/components/intel/InsightCard.svelte';
  import CommissionBar from '$lib/components/intel/CommissionBar.svelte';
  import { SURFACES } from '$lib/components/intel/workbench';
  import { keyColour, type ColourMode } from '$lib/components/intel/graph-visual';
  import { entityHover } from '$lib/components/intel/entity-hover.svelte';
  import { commission } from '$lib/jkai/intel/entity-card-store';
  import type { InsightData, UnlikelyRelation, PredictedLink } from '$lib/components/intel/types';
import type { NetworkPayload } from '$lib/codegraph/types';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  let { data } = $props();

  let network = $state<NetworkPayload | null>(null);
  let insights = $state<InsightData[]>([]);
  let unlikely = $state<UnlikelyRelation[]>([]);
  let predicted = $state<PredictedLink[]>([]);
  let duplicates = $state<{ total: number; autoMergeable: number } | null>(null);

  // Component handle, not reactive data — never $state (svelte5-pitfalls §1).
  let sweepHistory: { refresh: () => Promise<void> } | null = null;

  let loadingNetwork = $state(true);
  /** Why the last graph request failed, or null. Drives the retry panel. */
  let networkError = $state<string | null>(null);
  /** Bumped by the retry button to re-run the loader with the same filters. */
  let networkAttempt = $state(0);
  let busyId = $state<string | null>(null);
  let toast = $state<string | null>(null);

  // Filters
  let typeId = $state('');
  let communityId = $state('');
  let minDegree = $state(1);
  let focusId = $state<string | null>(null);
  let hops = $state(2);
  let selectedId = $state<string | null>(null);

  // Dynamic filters. `keyword` is what the box shows; `keywordApplied` is what
  // the query uses — debounced, so typing does not fire a network fetch and a
  // Louvain-backed response per keystroke.
  let keyword = $state('');
  let keywordApplied = $state('');
  let contextHops = $state(1);
  let activeCategories = $state<string[]>([]);
  /** Note sources allowed to contribute. Empty = no filter, i.e. all of them. */
  let activeSources = $state<string[]>([]);
  /** Entity ids the view is pinned to. Empty = the whole graph. */
  let pinnedIds = $state<string[]>([]);

  // The recency window. Both null = no window, which is the opening state and
  // the whole graph. `clock` is meaningful only while a window is set, but it
  // is kept across clearing so toggling All → 7d does not silently reset which
  // timestamp the last window was measured on.
  let since = $state<number | null>(null);
  let until = $state<number | null>(null);
  let clock = $state<'added' | 'updated'>('updated');
  let entityPick = $state('');

  // Plain handle, never $state — a timer read and cleared by the same helper is
  // the read-own-write cycle that locks the UI up (svelte5-pitfalls §1).
  let keywordTimer: ReturnType<typeof setTimeout> | null = null;

  function onKeywordInput() {
    if (keywordTimer) clearTimeout(keywordTimer);
    const next = keyword;
    keywordTimer = setTimeout(() => {
      keywordTimer = null;
      keywordApplied = next.trim();
    }, 280);
  }

  function toggleCategory(slug: string) {
    activeCategories = activeCategories.includes(slug)
      ? activeCategories.filter((c) => c !== slug)
      : [...activeCategories, slug];
  }

  // ── Colour and highlight ─────────────────────────────────────────────────
  //
  // Two different questions were being answered with one control, badly.
  //
  // "Where are the people in this graph" was a single-select type dropdown that
  // REMOVED everything else — so the answer arrived with nothing to read it
  // against. "Which of this came from work rather than from Drive" was a
  // category filter buried in the Sources rail behind a files-are-selected gate,
  // and it removed things too.
  //
  // Neither question wants removal. Both want the same picture with part of it
  // brought forward. So: colour says what the hue MEANS, highlight brings a
  // subset forward without moving anything, and filtering stays available as a
  // separate, explicit step.
  let colourBy = $state<ColourMode>('cluster');
  let highlightKeys = $state<string[]>([]);
  /** Multi-select type filter. `typeId` is kept for the single-type deep links. */
  let activeTypes = $state<string[]>([]);

  function toggleHighlight(key: string) {
    highlightKeys = highlightKeys.includes(key)
      ? highlightKeys.filter((k) => k !== key)
      : [...highlightKeys, key];
  }

  /** Turn the current highlight into a real filter — the explicit second step. */
  function filterToHighlight() {
    if (!highlightKeys.length) return;
    if (colourBy === 'type') activeTypes = [...highlightKeys];
    else if (colourBy === 'category') activeCategories = [...highlightKeys];
    highlightKeys = [];
  }

  /** Switching what the colour means makes the old highlight meaningless. */
  function setColourBy(mode: ColourMode) {
    if (mode === colourBy) return;
    colourBy = mode;
    highlightKeys = [];
  }

  const categoryColours = $derived(
    new Map((network?.categories ?? []).map((c) => [c.slug, c.color])),
  );

  /**
   * The legend for the current mode, with how many drawn nodes carry each key.
   *
   * Counted over what is ON SCREEN rather than over the whole graph, because
   * the legend's job is to explain the picture in front of you. A key with no
   * nodes in the current view is dropped — offering a highlight that would
   * blank the graph is worse than not offering it.
   */
  const legend = $derived.by(() => {
    if (colourBy === 'cluster' || !network) return [];
    const counts = new Map<string, number>();
    for (const n of network.nodes) {
      const keys = colourBy === 'type' ? (n.typeId ? [n.typeId] : []) : (n.categories ?? []);
      for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const rows =
      colourBy === 'type'
        ? (network.types ?? []).map((t) => ({
            key: t.id,
            label: `${t.icon} ${t.name}`,
            // Through the same helper the graph draws with — a legend computing
            // its own colour is a key that can disagree with the picture.
            colour: keyColour(t.id, t.color),
            count: counts.get(t.id) ?? 0,
          }))
        : (network.categories ?? []).map((c) => ({
            key: c.slug,
            label: c.name,
            colour: keyColour(c.slug, c.color),
            count: counts.get(c.slug) ?? 0,
          }));
    return rows.filter((r) => r.count > 0).sort((a, b) => b.count - a.count);
  });

  /** Nodes carrying no key at all under the current mode — always worth naming. */
  const unclassified = $derived.by(() => {
    if (colourBy === 'cluster' || !network) return 0;
    return network.nodes.filter((n) =>
      colourBy === 'type' ? !n.typeId : !(n.categories ?? []).length,
    ).length;
  });

  /** 3D is the default view; the choice persists so it is not re-made per visit. */
  const VIEW_KEY = 'intel:graph3d';
  let view3d = $state(true);
  /**
   * Clusters brought to the front, or empty.
   *
   * Distinct from `communityId`, which FILTERS the graph down to one cluster and
   * goes to the server. This keeps everything on screen and only changes how it
   * is drawn — the question "where does this cluster sit among the rest" cannot
   * be answered by a view with the rest removed. Several at once, because the
   * next question after focusing one is nearly always about a second.
   */
  let focusCommunities = $state<number[]>([]);
  /** How far apart the clusters are pushed. 1 is the natural layout. */
  let explode = $state(1);

  function toggleCluster(id: number) {
    focusCommunities = focusCommunities.includes(id)
      ? focusCommunities.filter((c) => c !== id)
      : [...focusCommunities, id];
  }

  function setView(next: boolean) {
    view3d = next;
    try {
      localStorage.setItem(VIEW_KEY, next ? '1' : '0');
    } catch {
      // Private browsing or a full quota. The toggle still works for this
      // session; only remembering it fails.
    }
  }

  /**
   * Which graph is being drawn — entities, or the evidence behind them.
   *
   * NOT persisted, unlike 3D/2D. That one is a preference about rendering and
   * holds across visits; this one is a question you are asking right now, and
   * returning to a page that silently shows a different graph than the one you
   * think of as "the intel graph" is a worse default than re-picking it.
   */
  let evidenceView = $state(false);

  function setMode(next: boolean) {
    if (evidenceView === next) return;
    evidenceView = next;
    // The two graphs share a source picker but nothing else: cluster focus,
    // pins and the community filter all name ids from the graph they were
    // chosen in, and carrying them across would filter to ids that do not
    // exist — an empty view with filters that look like they should match.
    focusCommunities = [];
    communityId = '';
    pinnedIds = [];
    focusId = null;
    typeId = '';
    selectedId = null;
  }

  function toggleSource(id: string) {
    activeSources = activeSources.includes(id)
      ? activeSources.filter((s) => s !== id)
      : [...activeSources, id];
  }

  function clearSources() {
    activeSources = [];
    activeCategories = [];
  }

  function pinEntity(id: string) {
    if (!id || pinnedIds.includes(id)) return;
    pinnedIds = [...pinnedIds, id];
    entityPick = '';
  }

  function unpinEntity(id: string) {
    pinnedIds = pinnedIds.filter((p) => p !== id);
  }

  function clearFilters() {
    keyword = '';
    keywordApplied = '';
    activeCategories = [];
    activeSources = [];
    pinnedIds = [];
    typeId = '';
    activeTypes = [];
    communityId = '';
    minDegree = 1;
    focusId = null;
    // Highlight is a VIEW state, not a filter, so "clear filters" leaves it —
    // except that a highlight against a graph whose filters just changed is
    // usually stale. Cleared, and the count above never counted it.
    highlightKeys = [];
  }

  const filterCount = $derived(
    (keywordApplied ? 1 : 0) +
      activeCategories.length +
      activeSources.length +
      (pinnedIds.length ? 1 : 0) +
      (typeId ? 1 : 0) +
      activeTypes.length +
      (communityId ? 1 : 0) +
      (focusId ? 1 : 0),
  );

  /** Per-section active counts, so a folded section still says what it is doing. */
  const sourceFilterCount = $derived(activeSources.length + activeCategories.length);
  const shapeFilterCount = $derived(
    (typeId ? 1 : 0) + activeTypes.length + (minDegree > 1 ? 1 : 0) + pinnedIds.length + (focusId ? 1 : 0),
  );
  const paintCount = $derived(highlightKeys.length + (colourBy === 'cluster' ? 0 : 1));

  // Path finder
  let pathFrom = $state('');
  let pathTo = $state('');
  let pathResult = $state<any>(null);
  let pathBusy = $state(false);

  let tab = $state<'insights' | 'unlikely' | 'links' | 'quality' | 'commissioned'>('insights');

  type Commission = {
    id: string;
    kind: string;
    payload: string;
    url: string | null;
    status: string;
    createdAt: string;
  };
  let commissions = $state<Commission[]>([]);
  let watchedCount = $state(0);

  // ── Cluster roster ─────────────────────────────────────────────────────────
  //
  // Fetched separately from the graph, and deliberately NOT filtered with it.
  // The graph ships the 600 most central nodes of nine thousand and narrows
  // further with every filter; the roster describes the clusters as they
  // actually are. Joining them by key in the picker is what lets a filtered view
  // still tell you what a cluster holds.
  let roster = $state<ClusterRoster | null>(null);
  let recalculating = $state(false);
  let narrating = $state<string | null>(null);
  let clusterError = $state<string | null>(null);

  async function loadRoster() {
    try {
      const res = await fetch('/api/jkai/intel/clusters');
      if (!res.ok) throw new Error(`the cluster roster came back ${res.status}`);
      roster = await res.json();
      clusterError = null;
    } catch (err) {
      clusterError = err instanceof Error ? err.message : 'the cluster roster failed to load';
    }
  }

  async function recalculateClusters() {
    if (recalculating) return;
    recalculating = true;
    clusterError = null;
    try {
      const res = await fetch('/api/jkai/intel/clusters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'recalculate' }),
      });
      if (!res.ok) throw new Error(`recalculation came back ${res.status}`);
      roster = await res.json();
      // The graph's colours and labels come from the same roster, so it has to
      // be refetched or the picture disagrees with the legend beside it.
      networkAttempt++;
    } catch (err) {
      clusterError = err instanceof Error ? err.message : 'recalculation failed';
    } finally {
      recalculating = false;
    }
  }

  async function renameCluster(key: string, name: string | null) {
    // Optimistic: renaming is the one cluster action with an obvious correct
    // outcome, and waiting on a round trip to see your own typing is worse than
    // reverting on the rare failure.
    const previous = roster;
    if (roster) {
      roster = {
        ...roster,
        clusters: roster.clusters.map((c) =>
          c.key === key ? { ...c, name, label: name ?? c.autoLabel } : c,
        ),
      };
    }
    try {
      const res = await fetch('/api/jkai/intel/clusters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'rename', key, name }),
      });
      if (!res.ok) throw new Error(`the rename came back ${res.status}`);
      // Refetched rather than trusted: the rename also resets the drift baseline
      // and the server is the one that knows the new one.
      await loadRoster();
      networkAttempt++;
    } catch (err) {
      roster = previous;
      clusterError = err instanceof Error ? err.message : 'the rename failed';
    }
  }

  async function narrateCluster(key: string) {
    if (narrating) return;
    narrating = key;
    clusterError = null;
    try {
      const res = await fetch('/api/jkai/intel/clusters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // `force` because this button is only ever pressed to (re)write: the
        // card shows the cached narrative already.
        body: JSON.stringify({ action: 'narrate', key, force: true }),
      });
      if (!res.ok) throw new Error(`the narrative request came back ${res.status}`);
      const body = await res.json();
      if (roster) {
        roster = {
          ...roster,
          clusters: roster.clusters.map((c) =>
            c.key === key
              ? { ...c, narrative: body.narrative, narrativeAt: body.narrativeAt, narrativeStale: false }
              : c,
          ),
        };
      }
    } catch (err) {
      clusterError = err instanceof Error ? err.message : 'the narrative failed';
    } finally {
      narrating = null;
    }
  }

  /** True while a recency window is narrowing the view. */
  const windowActive = $derived(since !== null || until !== null);

  const query = $derived.by(() => {
    const p = new URLSearchParams();
    if (typeId) p.set('typeId', typeId);
    if (activeTypes.length) p.set('types', activeTypes.join(','));
    if (communityId) p.set('community', communityId);
    if (minDegree > 0) p.set('minDegree', String(minDegree));
    if (focusId) {
      p.set('focus', focusId);
      p.set('hops', String(hops));
    }
    if (keywordApplied) {
      p.set('q', keywordApplied);
      p.set('qHops', String(contextHops));
    }
    if (activeCategories.length) p.set('categories', activeCategories.join(','));
    if (activeSources.length) p.set('sources', activeSources.join(','));
    if (pinnedIds.length) p.set('entities', pinnedIds.join(','));
    if (since !== null) p.set('since', String(since));
    if (until !== null) p.set('until', String(until));
    // Only sent when it can change the answer, so the URL stays readable and an
    // unfiltered request is byte-identical to what it was before this existed.
    if (since !== null || until !== null) p.set('clock', clock);
    return p.toString();
  });

  /**
   * Which endpoint serves the current view.
   *
   * Read reactively by the loader below, so flipping the mode refetches exactly
   * as changing a filter does — the evidence route takes the same `sources` and
   * `q` parameters and returns the same payload shape, so nothing downstream
   * needs to know which one answered.
   */
  const networkUrl = $derived(
    `/api/jkai/intel/${evidenceView ? 'evidence-network' : 'network'}?${query}`,
  );

  /**
   * Settle time before a filter change is sent.
   *
   * The range sliders are bound straight to the query, so dragging one from 0 to
   * 10 used to fire eleven full graph analyses — and nothing cancelled the ten
   * that were already obsolete, so they all ran to completion on the server.
   * Short enough to feel immediate, long enough that a drag is one request.
   */
  const FILTER_DEBOUNCE_MS = 200;

  // Refetch when the filter query changes. Only `query` is read reactively;
  // everything the loader touches it writes, so there is no read-own-write loop.
  $effect(() => {
    const url = networkUrl;
    // Read so the retry button re-runs this with the filters unchanged.
    networkAttempt;
    let cancelled = false;
    // Aborts the in-flight request as well as ignoring it: an abandoned
    // analysis is work the server should stop doing, not just work we discard.
    const controller = new AbortController();
    loadingNetwork = true;
    networkError = null;

    const timer = setTimeout(() => {
      fetch(url, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`the analysis request came back ${res.status}`);
          return res.json();
        })
        .then((body) => {
          if (cancelled) return;
          if (body) network = body;
          loadingNetwork = false;
        })
        .catch((err) => {
          // A superseded request is not a failure; leave the spinner to the
          // newer one rather than flashing an error the user cannot act on.
          if (cancelled || (err as Error)?.name === 'AbortError') return;
          // A real failure has to SAY so. When this silently cleared the
          // spinner, a failed request left the panel completely blank — no
          // graph, no message, no retry — which reads as "the 3D view is
          // broken" rather than as "the request failed", and is exactly how a
          // slow analysis timing out at the proxy presented.
          networkError = err instanceof Error ? err.message : 'the analysis request failed';
          loadingNetwork = false;
        });
    }, FILTER_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  });

  onMount(() => {
    // Restore the remembered 2D/3D choice. Read here rather than in the
    // initialiser because localStorage does not exist during SSR.
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved !== null) view3d = saved === '1';
    } catch {
      // Unreadable storage just means the default stands.
    }

    // The cluster roster. Cheap — the analysis it reads is the same cached
    // snapshot the graph request just built.
    void loadRoster();

    // Two cheap counts for the tiles. The expensive analysis behind the findings
    // section is deliberately NOT here — see loadFindings.
    void (async () => {
      const [dupRes, watchRes] = await Promise.all([
        fetch('/api/jkai/intel/duplicates?min=0.5'),
        fetch('/api/jkai/intel/watchlist'),
      ]);
      if (dupRes.ok) {
        const body = await dupRes.json();
        duplicates = { total: body.total ?? 0, autoMergeable: body.autoMergeable ?? 0 };
      }
      if (watchRes.ok) {
        const body = await watchRes.json();
        watchedCount = (body.watched ?? body.entities ?? []).length ?? 0;
      }
    })();
  });

  // ── Findings, on demand ────────────────────────────────────────────────────
  //
  // This section costs a full analytics pass: insights, a three-hop surprise
  // sweep and link prediction over the whole graph. It used to run on mount, so
  // arriving at the page to look at the graph paid for findings nobody had asked
  // to see — and on the real graph that is the single most expensive thing this
  // page can ask for. It now runs the first time the section is opened.

  let findingsOpen = $state(false);
  let loadingFindings = $state(false);
  /** Plain handle: read and written by the same loader, never rendered. */
  let findingsLoaded = false;

  async function loadFindings() {
    if (findingsLoaded) return;
    findingsLoaded = true;
    loadingFindings = true;
    try {
      const [insRes, comRes] = await Promise.all([
        fetch('/api/jkai/intel/insights?limit=40'),
        fetch('/api/jkai/intel/commission?limit=25'),
      ]);
      if (insRes.ok) {
        const body = await insRes.json();
        insights = body.insights ?? [];
        unlikely = body.unlikelyRelations ?? [];
        predicted = body.predictedLinks ?? [];
      }
      // Additive — a failure here must not blank the section.
      if (comRes.ok) commissions = (await comRes.json()).commissions ?? [];
    } catch {
      // Let it be retried by closing and reopening.
      findingsLoaded = false;
    } finally {
      loadingFindings = false;
    }
  }

  function toggleFindings() {
    findingsOpen = !findingsOpen;
    if (findingsOpen) void loadFindings();
  }

  /** Findings about the data itself, kept apart from findings about the world. */
  const QUALITY_KINDS = ['orphan', 'thin_evidence', 'type_outlier', 'dominant_cluster', 'isolated_cluster'];
  const qualityInsights = $derived(insights.filter((i) => QUALITY_KINDS.includes(i.kind)));
  const worldInsights = $derived(insights.filter((i) => !QUALITY_KINDS.includes(i.kind)));

  /**
   * Actions that change the graph in place. Navigating away from these was the
   * whole complaint about "Confirm the link": the answer belongs on this page,
   * next to the finding it came from, not in a chat thread.
   */
  const IN_PLACE_KINDS = new Set(['confirm_link', 'reject_link']);

  async function runCommission(kind: string, payload: string, entityIds: string[], key: string) {
    if (busyId) return;
    busyId = key;
    try {
      const result = await commission(kind, payload, entityIds);

      if (IN_PLACE_KINDS.has(kind)) {
        toast = result.label;
        setTimeout(() => (toast = null), 4000);
        // Drop the finding that was just answered and re-read the graph, so the
        // new edge appears and the prediction stops being offered.
        insights = insights.filter((i) => i.id !== key);
        predicted = [];
        await Promise.all([reloadNetwork(), reloadInsights()]);
        return;
      }

      if (result.started) {
        toast = result.label;
        setTimeout(() => (toast = null), 4000);
      }
      await goto(result.url);
    } catch (err) {
      toast = err instanceof Error ? err.message : 'Could not start that';
      setTimeout(() => (toast = null), 5000);
    } finally {
      busyId = null;
    }
  }

  /** Re-fetch the network for the current filters, outside the reactive effect. */
  async function reloadNetwork() {
    try {
      const res = await fetch(`/api/jkai/intel/network?${query}`);
      if (res.ok) network = await res.json();
    } catch {
      // Keep the stale graph rather than blanking the page.
    }
  }

  async function reloadInsights() {
    // Nothing to refresh if the section has never been opened; the first open
    // will fetch current data anyway.
    if (!findingsLoaded) return;
    try {
      const res = await fetch('/api/jkai/intel/insights?limit=40');
      if (!res.ok) return;
      const body = await res.json();
      insights = body.insights ?? [];
      unlikely = body.unlikelyRelations ?? [];
      predicted = body.predictedLinks ?? [];
    } catch {
      // As above — an additive panel failing must not cost the page.
    }
  }

  /**
   * Dismiss or snooze a finding. Removed optimistically — the persistence
   * layer excludes dismissed/snoozed from the default listing, so leaving the
   * card on screen would contradict what the next reload shows.
   */
  async function triageInsight(i: InsightData, action: 'dismiss' | 'snooze') {
    insights = insights.filter((x) => x.id !== i.id);
    try {
      await fetch('/api/jkai/intel/insights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: i.id, action, ...(action === 'snooze' ? { days: 7 } : {}) }),
      });
      toast = action === 'snooze' ? 'Snoozed for a week' : 'Dismissed';
      setTimeout(() => (toast = null), 2500);
    } catch {
      // Put it back rather than silently losing it.
      insights = [...insights, i].sort((a, b) => b.score - a.score);
      toast = 'Could not update that finding';
      setTimeout(() => (toast = null), 4000);
    }
  }

  function rejectInsightLink(i: InsightData) {
    void runCommission(
      'reject_link',
      `Rejected from the intel dashboard: ${i.title}`,
      i.entities.map((e) => e.id),
      i.id,
    );
  }

  function commissionInsight(i: InsightData) {
    void runCommission(i.action, i.actionPayload, i.entities.map((e) => e.id), i.id);
  }

  function focus(id: string) {
    focusId = id;
    selectedId = id;
  }

  function clearFocus() {
    focusId = null;
    pathResult = null;
  }

  // ── The entity card ────────────────────────────────────────────────────────
  //
  // The same floating card chat uses, opened at the point that was clicked.
  //
  // A graph node has no DOM box to anchor to — it is a circle inside one SVG or
  // a sphere inside one WebGL canvas — so the pointer position is tracked on the
  // way down and handed to the card as a zero-size rect. Everything downstream
  // already works in viewport coordinates.
  //
  // A plain `let`, never $state: nothing reactive reads it, and writing state on
  // every pointerdown would be a reactive update for a value that is only needed
  // at the instant a card opens.
  let lastPoint = { x: 0, y: 0 };

  function trackPointer(event: PointerEvent) {
    lastPoint = { x: event.clientX, y: event.clientY };
  }

  /** Node ids from the evidence view carry this prefix; entities never do. */
  const EVIDENCE_PREFIX = 'note:';

  function onGraphSelect(id: string | null) {
    selectedId = id;
    if (!id) {
      entityHover.close();
      return;
    }
    // A note is not an entity and has no entity card — asking for one would
    // 404 and the card would show "Could not load this entity", which reads as
    // a broken graph rather than as "you clicked a document".
    if (id.startsWith(EVIDENCE_PREFIX)) {
      entityHover.close();
      goto(`/jkai/intel/notes/${id.slice(EVIDENCE_PREFIX.length)}`);
      return;
    }
    entityHover.pinAt(id, {
      top: lastPoint.y,
      bottom: lastPoint.y,
      left: lastPoint.x,
      right: lastPoint.x,
    });
  }

  async function findPath() {
    if (!pathFrom || !pathTo) return;
    pathBusy = true;
    try {
      const res = await fetch(
        `/api/jkai/intel/network/paths?from=${encodeURIComponent(pathFrom)}&to=${encodeURIComponent(pathTo)}&maxHops=5`,
      );
      pathResult = res.ok ? await res.json() : null;
    } finally {
      pathBusy = false;
    }
  }

  const highlightPath = $derived<string[] | null>(
    pathResult?.paths?.[0]?.nodes?.map((n: { id: string }) => n.id) ?? null,
  );

  /** Entities offered in the path-finder selects — most connected first. */
  const pathOptions = $derived(
    (network?.nodes ?? [])
      .slice()
      .sort((a, b) => b.degree - a.degree)
      .slice(0, 300)
      .map((n) => ({ id: n.id, name: n.name })),
  );

  /**
   * Fragmentation — how much of the graph fails to join up. The single most
   * telling quality number: 181 components across 492 entities means most of
   * what you know cannot be reached from the rest of what you know.
   */
  const fragmentation = $derived(
    network && network.stats.totalNodes ? network.stats.components / network.stats.totalNodes : 0,
  );

  /**
   * Whether the tiles are describing a slice rather than the whole graph.
   *
   * The tiles used to read the unfiltered totals unconditionally, so narrowing
   * to one channel left every number on the page unmoved. That reads as a
   * filter that did nothing — and since the graph underneath it HAD narrowed,
   * the page contradicted itself.
   *
   * `filtering` comes from the server, which is the only place that knows the
   * full filter set; falling back to the local count keeps this honest against
   * an older payload rather than silently claiming the whole graph.
   */
  const narrowed = $derived(!!network && (network.filtering ?? filterCount > 0));
  const entityCount = $derived(
    narrowed ? network?.stats.selectedNodes ?? network?.stats.shown : network?.stats.totalNodes,
  );
  const connectionCount = $derived(
    narrowed ? network?.stats.selectedEdges : network?.stats.totalEdges,
  );
  const clusterCount = $derived(
    narrowed
      ? network?.stats.selectedCommunities ?? network?.communities.length
      : roster?.stats.tracked ?? network?.stats.communities,
  );

  /**
   * The roster, restricted to the clusters the current filter reaches.
   *
   * The roster itself stays whole — it is the durable description of every
   * cluster, and a narrative written about 380 entities does not stop being
   * about them because you ticked "chat". What changes is which of them are
   * worth listing: asking for one channel and still being shown all 24 clusters
   * at full size is the same contradiction the tiles had.
   */
  /**
   * The top bar's live search — highlight only, never a filter.
   *
   * Matched against the nodes ALREADY loaded, so it keeps up with typing and
   * costs nothing. That is the whole difference from the rail's Search box:
   * that one sends `q` to the server and narrows the graph, which is right when
   * you know what you want and wrong when the question is "where is this among
   * everything else". Leaving the graph whole is what makes the answer legible.
   *
   * Same fields the server matches on (name, aliases, summary, type), so the two
   * searches cannot disagree about what counts as a hit.
   */
  let liveSearch = $state('');
  const liveMatches = $derived.by(() => {
    const needle = liveSearch.trim().toLowerCase();
    if (!needle || !network) return [];
    return network.nodes
      .filter((n) =>
        [n.name, n.summary ?? '', n.type, ...(n.aliases ?? [])].some((h) =>
          h.toLowerCase().includes(needle),
        ),
      )
      .map((n) => n.id);
  });
  /** What the graphs light up: the live search when there is one, else the
   *  server's keyword hits. Two sources, one prop — never both at once, or a
   *  stale keyword would keep glowing under a new search. */
  /** Node ids the recency window admitted on their own clock. */
  const recentNodeIds = $derived(
    (network?.nodes ?? []).filter((n) => n.recent).map((n) => n.id),
  );

  /**
   * What the graph draws solid, everything else being context.
   *
   * One channel, three sources, in priority order: a live in-canvas search, the
   * server's keyword hits, then — when a recency window is on and no keyword is
   * — the nodes the window itself admitted. Reusing `matchedIds` rather than
   * adding a second highlight prop is deliberate: the semantics are identical
   * ("these are the hits, the rest came along for context"), and two competing
   * highlight channels into the same renderer is how a node ends up solid for
   * one reason and faint for another in the same frame.
   */
  const highlightIds = $derived(
    liveSearch.trim()
      ? liveMatches
      : (network?.matched?.length ? network.matched : recentNodeIds),
  );


  const reachByKey = $derived(
    new Map((network?.communities ?? []).map((c) => [c.key ?? `#${c.id}`, c.reach ?? c.size])),
  );
  const visibleClusters = $derived.by(() => {
    const all = roster?.clusters ?? [];
    if (!narrowed || !network) return all;
    return all
      .filter((c) => reachByKey.has(c.key))
      .map((c) => ({ ...c, reach: reachByKey.get(c.key) ?? 0 }))
      .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  });

  /**
   * The loop as six cells — one per stage, not one per surface.
   *
   * `04 explore` has four surfaces in SURFACES (Graph, Entities, Timeline,
   * Recall); the loop is about stages, so they collapse into one cell that
   * links to the Graph and counts entities. The stage label, the question and
   * `warnAbove` all come from workbench.ts, which is the single place the
   * wording of "what is this FOR" lives.
   */
  const LOOP_STAGES = ['01 capture', '02 triage', '03 repair', '04 explore', '05 collect', '06 act'];
  const loopCounts = $derived({
    notes: data.stats.noteCount,
    pending: data.stats.pendingReviewCount,
    unconnected: data.stats.unconnectedCount,
    entities: data.stats.entityCount,
    dossiers: data.stats.dossierCount,
    alerts: data.recentAlerts.length,
  } as Record<string, number>);

  /** Items actually present in the three compact signal previews. */
  const signalCount = $derived(
    data.recentAlerts.length + data.upcomingTimeline.length + data.recentNotes.length,
  );

  const LOOP_CELLS = $derived(
    LOOP_STAGES.map((stage) => {
      const surface = SURFACES.find((sfc) => sfc.stage === stage)!;
      const value = surface.count ? (loopCounts[surface.count] ?? 0) : (loopCounts.entities ?? 0);
      const label = surface.label.toLowerCase();
      // "02 triage · triage" read as a stutter. When the surface's name IS the
      // stage word, the stage says it once and the label is dropped.
      const stageWord = stage.split(' ')[1];
      return {
        stage,
        label: label === stageWord ? '' : label,
        href: surface.href,
        question: surface.question,
        value,
        // A backlog, not a statistic — the one thing in the loop that is allowed
        // to be orange.
        warn: surface.warnAbove !== undefined && value > surface.warnAbove,
        // Petrol for the collected set: it is the "this is in hand" reading.
        ink: stage === '05 collect',
      };
    }),
  );

  function relDay(iso: string | Date): string {
    const then = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
    if (!Number.isFinite(then)) return '';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
  }

  function shortDate(d: string): string {
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return d;
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
  }

  /** Within a week — the timeline's one accent. */
  function isSoon(d: string): boolean {
    const parsed = Date.parse(d);
    if (!Number.isFinite(parsed)) return false;
    return parsed - Date.now() < 7 * 24 * 60 * 60 * 1000;
  }
</script>

<div class="wrap">
  <CommissionBar
    busy={!!busyId}
    matchCount={liveSearch.trim() ? liveMatches.length : null}
    onRun={(kind, payload) => runCommission(kind, payload, [], 'bar')}
    onSearch={(t) => (liveSearch = t)}
  />

  <!-- Vital signs. The low, dark ledger borrows /health's instrument register:
       paper figures on brown ink, with lifted orange reserved for a backlog or
       data-quality problem. Ten readings, one compact scan line. -->
  <div class="tiles cellgrid">
    <a class="tile" class:narrowed href="/jkai/intel/entities">
      <span class="n">{entityCount ?? data.stats.entityCount}</span>
      <span class="l">{narrowed ? 'Entities here' : 'Entities'}</span>
    </a>
    <div class="tile" class:narrowed>
      <span class="n">{connectionCount ?? '—'}</span>
      <span class="l">{narrowed ? 'Connections here' : 'Connections'}</span>
    </div>
    <div class="tile" class:narrowed>
      <!-- Unfiltered this is the TRACKED count, not the raw community count.
           Louvain detects one community per isolated entity, so the raw figure
           on the live graph is ~2,900 — a true number that describes nothing,
           since 2,632 of them are a single entity connected to nothing.
           Filtered it is the number of clusters the filter actually reaches. -->
      <span class="n">{clusterCount ?? '—'}</span>
      <span class="l">{narrowed ? 'Clusters here' : 'Clusters'}</span>
    </div>
    <div class="tile" class:warn={fragmentation > 0.2}>
      <span class="n">{network?.stats.components ?? '—'}</span>
      <span class="l">Fragments</span>
    </div>
    <a class="tile" class:warn={(duplicates?.total ?? 0) > 0} href="/jkai/intel/quality">
      <span class="n">{duplicates?.total ?? '—'}</span>
      <span class="l">Duplicates</span>
    </a>
    <!-- Stage 00, and the only tile that is about what has NOT reached the graph
         yet. It sits with the other vital signs rather than in the six-stage
         loop because the gate happens BEFORE capture, not inside it.
         `warnAbove` matches the surface definition in workbench.ts. -->
    <a class="tile" class:warn={(data.intelCounts?.heldMail ?? 0) > 200} href="/jkai/intel/mail">
      <span class="n">{data.intelCounts?.heldMail ?? '—'}</span>
      <span class="l">Held mail</span>
    </a>
    <a class="tile" href="/jkai/intel/review">
      <span class="n">{data.stats.pendingReviewCount}</span>
      <span class="l">To review</span>
    </a>
    <a class="tile" href="/jkai/intel/notes">
      <span class="n">{data.stats.noteCount}</span>
      <span class="l">Notes</span>
    </a>
    <a class="tile" href="/jkai/intel/entities?watched=watched">
      <span class="n">{watchedCount || '—'}</span>
      <span class="l">Watched</span>
    </a>
    <a class="tile" href="/jkai/intel/alerts">
      <span class="n">{data.recentAlerts.length}</span>
      <span class="l">Alerts</span>
    </a>
  </div>

  <!-- The loop, stated once. Six cells: where you are, how much is waiting, and
       what the stage is FOR — the question strings come from workbench.ts, so
       the nav and this grid can never drift apart. -->
  <section class="loop cellgrid" aria-label="The intel loop">
    {#each LOOP_CELLS as cell (cell.stage + cell.label)}
      <a class="loop-cell" href={cell.href}>
        <div class="loop-top">
          <span class="metric-label" class:accent={cell.warn}
            >{cell.stage}{cell.label ? ` · ${cell.label}` : ''}</span
          >
          <span class="loop-n" class:accent={cell.warn} class:ink={cell.ink}>{cell.value}</span>
        </div>
        <p class="loop-q">{cell.question}</p>
      </a>
    {/each}
  </section>

  <div class="intel-board">
  <div class="board-main">
  <!-- Network explorer -->
  <section class="explorer">
    <aside class="rail">
      <div class="rail-heading">
        <span class="rail-title">Graph controls</span>
        {#if filterCount > 0}
          <button type="button" class="rail-clear" onclick={clearFilters}>
            Clear {filterCount}
          </button>
        {:else}
          <span class="rail-state">All data</span>
        {/if}
      </div>

      <RailSection title="Search" badge={keywordApplied ? 1 : null}>
        <input
          id="f-q"
          type="search"
          placeholder="name, alias or summary…"
          aria-label="Keyword"
          bind:value={keyword}
          oninput={onKeywordInput}
        />
        {#if keywordApplied}
          <label for="f-qhops">Context around hits: {contextHops} hop{contextHops === 1 ? '' : 's'}</label>
          <input id="f-qhops" type="range" min="0" max="3" bind:value={contextHops} />
          <p class="hint">
            {network?.matched?.length ?? 0} match{(network?.matched?.length ?? 0) === 1 ? '' : 'es'}
            shown solid; the rest is the surrounding neighbourhood.
          </p>
        {/if}
      </RailSection>

      <RailSection title="Colour &amp; highlight" badge={paintCount || null} open={false}>
        <!-- Sits directly under Search because it answers the same shape of
             question — "show me the X in here" — without the removal a filter
             does. The type filter below still exists for when removal IS what
             you want. -->
        <div class="paint-modes" role="group" aria-label="Colour nodes by">
          {#each [['cluster', 'Cluster'], ['type', 'Type'], ['category', 'Category']] as [mode, label] (mode)}
            <button
              type="button"
              class="chip"
              class:on={colourBy === mode}
              onclick={() => setColourBy(mode as ColourMode)}
            >{label}</button>
          {/each}
        </div>

        {#if colourBy === 'cluster'}
          <p class="hint">
            Hue is the detected cluster — the one grouping you cannot read off a label. Switch to
            Type or Category to colour by those and pick which to bring forward.
          </p>
        {:else if !legend.length}
          <p class="hint">
            {colourBy === 'category'
              ? 'Nothing on screen carries a source category. They are set per folder in Drive.'
              : 'Nothing on screen carries a type.'}
          </p>
        {:else}
          <p class="hint">
            Click to bring forward; the rest recedes without moving. Nothing is removed until you
            filter.
          </p>
          <div class="legend">
            {#each legend as row (row.key)}
              <button
                type="button"
                class="legend-chip"
                class:on={highlightKeys.includes(row.key)}
                title="{row.count} on screen"
                aria-pressed={highlightKeys.includes(row.key)}
                onclick={() => toggleHighlight(row.key)}
              >
                <i class="swatch" style="background: {row.colour}" aria-hidden="true"></i>
                <span class="lc-label">{row.label}</span>
                <b>{row.count}</b>
              </button>
            {/each}
          </div>
          {#if unclassified > 0}
            <p class="hint">
              {unclassified} {unclassified === 1 ? 'node carries' : 'nodes carry'} no
              {colourBy === 'type' ? ' type' : ' category'} at all, and {unclassified === 1 ? 'is' : 'are'}
              drawn grey.
            </p>
          {/if}
          {#if highlightKeys.length}
            <div class="paint-acts">
              <button type="button" class="link-btn" onclick={filterToHighlight}>
                Filter to {highlightKeys.length === 1 ? 'it' : `these ${highlightKeys.length}`}
              </button>
              <button type="button" class="link-btn" onclick={() => (highlightKeys = [])}>
                Clear highlight
              </button>
            </div>
          {/if}
        {/if}
      </RailSection>

      <RailSection title="Recency" badge={windowActive ? (network?.stats.recentNodes ?? 0) : null} open={false}>
        <!-- Sits above Sources because it is the filter most often reached for
             first: "what happened since yesterday" is a narrower and more
             useful opening question than "which channel said it". -->
        <RecencySlicer
          activity={network?.activity ?? null}
          {clock}
          {since}
          {until}
          recentNodes={network?.stats.recentNodes ?? 0}
          recentEdges={network?.stats.recentEdges ?? 0}
          onChange={(next) => {
            since = next.since;
            until = next.until;
            clock = next.clock;
          }}
        />
      </RailSection>

      <RailSection title="Sources" badge={sourceFilterCount || null} open={false}>
        <SourcePicker
          sources={network?.sources ?? []}
          sourceKinds={network?.sourceKinds ?? []}
          sourceDomains={network?.sourceDomains ?? []}
          categories={network?.categories ?? []}
          {activeSources}
          {activeCategories}
          onToggleSource={toggleSource}
          onToggleCategory={toggleCategory}
          onClear={clearSources}
        />
      </RailSection>

      <RailSection title="Clusters" badge={focusCommunities.length || null} open={false}>
        <!-- The roster describes clusters of the ENTITY graph. The evidence
             view is a different graph with a different partition, so its groups
             have no durable key, no stored name and nothing to narrate —
             joining them would attach one graph's names to another graph's
             structure. -->
        <ClusterPicker
          communities={network?.communities ?? []}
          roster={evidenceView ? [] : visibleClusters}
          {narrowed}
          reachedTotal={network?.stats.selectedCommunities ?? 0}
          stats={evidenceView ? null : (roster?.stats ?? null)}
          resolution={evidenceView ? null : (roster?.resolution ?? null)}
          {recalculating}
          {narrating}
          focused={focusCommunities}
          filtered={communityId === '' ? null : Number(communityId)}
          onToggleFocus={toggleCluster}
          onClearFocus={() => (focusCommunities = [])}
          onFilter={(id) => (communityId = id === null ? '' : String(id))}
          onRecalculate={evidenceView ? undefined : recalculateClusters}
          onRename={evidenceView ? undefined : renameCluster}
          onNarrate={evidenceView ? undefined : narrateCluster}
          onOpen={evidenceView ? undefined : (key) => goto(`/jkai/intel/clusters/${key}`)}
        />
        {#if clusterError}
          <p class="cluster-err">{clusterError}</p>
        {/if}
      </RailSection>

      <RailSection title="Shape" badge={shapeFilterCount || null} open={false}>
        <label for="f-type">Type</label>
        <select id="f-type" bind:value={typeId}>
          <option value="">All types</option>
          {#each network?.types ?? [] as t (t.id)}
            <option value={t.id}>{t.icon} {t.name}</option>
          {/each}
        </select>
        {#if activeTypes.length}
          <!-- Set by "Filter to these" in Colour & highlight. Shown here, where
               the other narrowing filters live, so it can be undone from the
               same place — a filter you cannot find is a graph that looks
               broken. -->
          <div class="chips">
            {#each activeTypes as id (id)}
              {@const t = (network?.types ?? []).find((x) => x.id === id)}
              <button
                type="button"
                class="chip on"
                onclick={() => (activeTypes = activeTypes.filter((x) => x !== id))}
              >{t ? `${t.icon} ${t.name}` : id.slice(0, 8)} ×</button>
            {/each}
          </div>
        {/if}

        <label for="f-degree">Min connections: {minDegree}</label>
        <input id="f-degree" type="range" min="0" max="10" bind:value={minDegree} />

        <label for="f-pin">Pin to entities</label>
        <select
          id="f-pin"
          bind:value={entityPick}
          onchange={() => pinEntity(entityPick)}
        >
          <option value="">Add an entity…</option>
          {#each pathOptions as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
        </select>
        {#if pinnedIds.length}
          <div class="chips">
            {#each pinnedIds as id (id)}
              {@const node = network?.nodes.find((n) => n.id === id)}
              <button type="button" class="chip on" onclick={() => unpinEntity(id)}>
                {node?.name ?? id.slice(0, 8)} ×
              </button>
            {/each}
          </div>
        {/if}

        {#if focusId}
          <div class="focus-box">
            <label for="f-hops">Hops from focus: {hops}</label>
            <input id="f-hops" type="range" min="1" max="5" bind:value={hops} />
            <button type="button" class="link-btn" onclick={clearFocus}>Clear focus</button>
          </div>
        {/if}
      </RailSection>

      <RailSection title="Route between two" open={false}>
        <select bind:value={pathFrom} aria-label="Path start">
          <option value="">From…</option>
          {#each pathOptions as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
        </select>
        <select bind:value={pathTo} aria-label="Path end">
          <option value="">To…</option>
          {#each pathOptions as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
        </select>
        <button type="button" class="go" onclick={findPath} disabled={!pathFrom || !pathTo || pathBusy}>
          {pathBusy ? 'Tracing…' : 'Trace route'}
        </button>

        {#if pathResult && !pathResult.found}
          <p class="path-none">No route within 5 hops — these sit in different fragments.</p>
        {:else if pathResult?.paths?.length}
          {#each pathResult.paths as p, i}
            <div class="path" class:primary={i === 0}>
              <span class="hops">{p.hops} hops</span>
              {#each p.nodes as n, ni}
                <button type="button" class="pnode" onclick={() => focus(n.id)}>{n.name}</button>
                {#if ni < p.steps.length}
                  <span class="pedge">{p.steps[ni].label}</span>
                {/if}
              {/each}
            </div>
          {/each}
        {/if}
      </RailSection>

      <!-- How email gets into the graph in the first place, and whether it did.
           Folded by default: it answers "why is this missing", which is a
           question you ask occasionally, not one you filter by. -->
      <RailSection title="Email ingest" open={false}>
        <GmailSweepPanel
          onDone={() => {
            void Promise.all([reloadNetwork(), reloadInsights()]);
            // A hand-run sweep is recorded too, so the history directly below is
            // stale the moment this returns — including when it just failed.
            void sweepHistory?.refresh();
          }}
        />
        <SweepHistoryPanel bind:this={sweepHistory} />
      </RailSection>

      <RailSection title="Reading the graph" open={false}>
        <ul class="legend">
          <li><b>Size</b> — how much the entity holds the graph together, shrunk by how stale it is.</li>
          <li><b>Colour</b> — its cluster. Washed towards the page as it goes quiet.</li>
          <li><b>Line thickness</b> — how well corroborated the relationship is. Strongly evidenced pairs also sit closer together.</li>
          <li><b>Orange lines</b> cross clusters. A dashed ring marks a broker holding two apart.</li>
        </ul>
        {#if network?.trimmed}
          <p class="hint trim">Showing the {network.stats.shown} most important of {network.stats.totalNodes}.</p>
        {/if}
      </RailSection>
    </aside>

    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="canvas" onpointerdown={trackPointer}>
      <div class="dims" role="group" aria-label="Graph dimension">
        <button type="button" class:on={view3d} onclick={() => setView(true)} aria-pressed={view3d}>3D</button>
        <button type="button" class:on={!view3d} onclick={() => setView(false)} aria-pressed={!view3d}>2D</button>
      </div>

      <!-- WHAT the graph is made of, as opposed to how it is drawn. Separated
           from the 3D/2D pair for exactly that reason: one changes the
           rendering, this one changes the question. -->
      <div class="modes" role="group" aria-label="What the nodes are">
        <button
          type="button"
          class:on={!evidenceView}
          aria-pressed={!evidenceView}
          title="Entities, connected to each other"
          onclick={() => setMode(false)}>Entities</button
        >
        <button
          type="button"
          class:on={evidenceView}
          aria-pressed={evidenceView}
          title="Sources as nodes — every note, and the entities it mentions"
          onclick={() => setMode(true)}>Sources</button
        >
      </div>
      {#if evidenceView && network?.stats}
        <p class="mode-note">
          {network.stats.evidenceNodes ?? 0} sources · {network.stats.entityNodes ?? 0} entities they
          mention. A line means "this source mentions this entity".
        </p>
      {/if}

      {#if view3d && network}
        <!-- With the 3D/2D toggle rather than in the filter rail: this changes
             how the graph is DRAWN, it does not change which graph you are
             looking at. Same distinction the toggle itself draws. -->
        <div class="spread">
          <label for="f-explode">Spread</label>
          <input id="f-explode" type="range" min="1" max="4" step="0.25" bind:value={explode} />
        </div>
      {/if}

      {#if loadingNetwork && !network}
        <div class="loading">Analysing the graph…</div>
      {:else if networkError && !network}
        <div class="graph-error">
          <p class="ge-head">The graph could not be analysed.</p>
          <p class="ge-detail">{networkError}</p>
          <button type="button" class="ge-retry" onclick={() => networkAttempt++}>Try again</button>
        </div>
      {:else if network}
        {#if view3d}
          <NetworkGraph3D
            nodes={network.nodes}
            edges={network.edges}
            {highlightPath}
            matchedIds={highlightIds}
            {selectedId}
            {focusCommunities}
            {explode}
            {colourBy}
            {highlightKeys}
            {categoryColours}
            communities={network.communities ?? []}
            onSelect={onGraphSelect}
            onOpen={(id) => focus(id)}
          />
        {:else}
          <NetworkGraph
            nodes={network.nodes}
            edges={network.edges}
            {highlightPath}
            matchedIds={highlightIds}
            {selectedId}
            {focusCommunities}
            {colourBy}
            {highlightKeys}
            {categoryColours}
            onSelect={onGraphSelect}
            onOpen={(id) => focus(id)}
          />
        {/if}
      {/if}
    </div>
  </section>

  <!-- Findings. Closed, and unfetched, until asked for. -->
  <section class="findings" class:open={findingsOpen}>
    <button type="button" class="findings-head" aria-expanded={findingsOpen} onclick={toggleFindings}>
      <span class="chev" aria-hidden="true">{findingsOpen ? '▾' : '▸'}</span>
      <span class="fh-title">Findings</span>
      <span class="fh-note">
        {#if findingsOpen && !loadingFindings}
          {insights.length + unlikely.length + predicted.length} across five views
        {:else}
          what stands out that you didn't ask about
        {/if}
      </span>
    </button>

    {#if findingsOpen}
      <nav class="tabs">
        <button class:on={tab === 'insights'} onclick={() => (tab = 'insights')}>
          Insights <span class="c">{worldInsights.length}</span>
        </button>
        <button class:on={tab === 'unlikely'} onclick={() => (tab = 'unlikely')}>
          Unlikely relations <span class="c">{unlikely.length}</span>
        </button>
        <button class:on={tab === 'links'} onclick={() => (tab = 'links')}>
          Missing links <span class="c">{predicted.length}</span>
        </button>
        <button class:on={tab === 'commissioned'} onclick={() => (tab = 'commissioned')}>
          Commissioned <span class="c">{commissions.length}</span>
        </button>
        <button class:on={tab === 'quality'} onclick={() => (tab = 'quality')}>
          Data quality <span class="c">{qualityInsights.length + (duplicates?.total ?? 0)}</span>
        </button>
      </nav>

      {#if loadingFindings}
        <div class="loading">Looking for things you didn't ask about…</div>
      {:else if tab === 'insights'}
        <div class="grid">
          {#each worldInsights as i (i.id)}
            <InsightCard insight={i} busy={busyId === i.id} onCommission={commissionInsight} onFocus={focus} onTriage={triageInsight} onReject={rejectInsightLink} />
          {:else}
            <p class="none">Nothing stands out yet. Add more notes or run a deep dive.</p>
          {/each}
        </div>
      {:else if tab === 'unlikely'}
        <div class="grid">
          {#each unlikely as u, idx (idx)}
            <article class="rel">
              <div class="rel-pair">
                {#each u.entities as e, i}
                  <button type="button" onclick={() => focus(e.id)}>{e.name}</button>
                  {#if i === 0}<span class="arrow">↔</span>{/if}
                {/each}
              </div>
              <p class="rel-why">{u.reasons.join(' · ')}</p>
              <button
                class="action"
                type="button"
                disabled={busyId === `u${idx}`}
                onclick={() =>
                  runCommission(
                    'ask',
                    `In my intel graph, ${u.entities[0]?.name} and ${u.entities[1]?.name} are connected but sit in different clusters and share little context. What is the real relationship, and does it matter?`,
                    u.entities.map((e) => e.id),
                    `u${idx}`,
                  )}
              >
                {busyId === `u${idx}` ? 'Working…' : 'Ask why'}
              </button>
            </article>
          {:else}
            <p class="none">No surprising connections found.</p>
          {/each}
        </div>
      {:else if tab === 'links'}
        <div class="grid">
          {#each predicted as p, idx (idx)}
            <article class="rel">
              <div class="rel-pair">
                {#each p.entities as e, i}
                  <button type="button" onclick={() => focus(e.id)}>{e.name}</button>
                  {#if i === 0}<span class="arrow">⇢</span>{/if}
                {/each}
              </div>
              <p class="rel-why">{p.reason}</p>
              <!-- Records the relationship. This was `runCommission('ask', …)`,
                   which handed the question to jkai and left the graph unchanged —
                   the button said "Confirm link" and confirmed nothing. -->
              <div class="rel-acts">
                <button
                  class="action"
                  type="button"
                  disabled={busyId === `p${idx}`}
                  onclick={() =>
                    runCommission(
                      'confirm_link',
                      `Confirmed from a predicted link — ${p.entities[0]?.name} and ${p.entities[1]?.name}`,
                      p.entities.map((e) => e.id),
                      `p${idx}`,
                    )}
                >
                  {busyId === `p${idx}` ? 'Working…' : 'Confirm link'}
                </button>
                <button
                  class="ghost"
                  type="button"
                  disabled={busyId === `p${idx}`}
                  onclick={() =>
                    runCommission(
                      'reject_link',
                      `Rejected from the intel dashboard — ${p.entities[0]?.name} and ${p.entities[1]?.name}`,
                      p.entities.map((e) => e.id),
                      `p${idx}`,
                    )}
                >
                  Not related
                </button>
              </div>
            </article>
          {:else}
            <p class="none">No missing links predicted.</p>
          {/each}
        </div>
      {:else if tab === 'commissioned'}
        <div class="grid">
          {#each commissions as c (c.id)}
            <article class="rel">
              <div class="rel-pair">
                <span class="kindchip">{c.kind}</span>
                <span class="status" class:running={c.status === 'running'} class:done={c.status === 'complete'}>
                  {c.status}
                </span>
              </div>
              <p class="rel-why">{c.payload}</p>
              {#if c.url}<a class="action" href={c.url}>Open</a>{/if}
            </article>
          {:else}
            <p class="none">Nothing commissioned yet. Start work from a finding, or from the bar above.</p>
          {/each}
        </div>
      {:else}
        {#if duplicates?.total}
          <p class="quality-head">
            <strong>{duplicates.total}</strong> possible duplicate entities
            ({duplicates.autoMergeable} confident enough to merge automatically).
            <a href="/jkai/intel/quality">Review and merge →</a>
          </p>
        {/if}
        <div class="grid">
          {#each qualityInsights as i (i.id)}
            <InsightCard insight={i} busy={busyId === i.id} onCommission={commissionInsight} onFocus={focus} onTriage={triageInsight} onReject={rejectInsightLink} />
          {:else}
            <p class="none">No data-quality problems detected.</p>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
  </div>

  <!-- Signals: what came looking for you, what is coming, what was read last.
       All three were already loaded and only the alert COUNT was being shown. -->
  <aside class="signals" aria-label="Signals">
    <div class="signals-heading">
      <span class="signals-title">Signals</span>
      <span class="signals-state">{signalCount ? `${signalCount} shown` : 'Quiet'}</span>
    </div>

    <div class="sig-cell">
      <div class="sig-hd">
        <span class="sig-label">
          <span class="metric-label">Alerts</span><b>{data.recentAlerts.length}</b>
        </span>
        <a class="sig-more" href="/jkai/intel/alerts">All →</a>
      </div>
      {#if data.recentAlerts.length > 0}
        <ul class="sig-list">
          {#each data.recentAlerts as a (a.id)}
            <!-- The 3px left border encodes WHERE it came from, so the source
                 is legible before the sentence is read. -->
            <li class="alert-row" data-sig={a.significance}>
              <span class="alert-txt">{a.title}</span>
              <span class="alert-meta">{a.type} · {relDay(a.createdAt)}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="sig-none">No unprompted alerts.</p>
      {/if}
    </div>

    <div class="sig-cell">
      <div class="sig-hd">
        <span class="sig-label">
          <span class="metric-label">Upcoming</span><b>{data.upcomingTimeline.length}</b>
        </span>
        <a class="sig-more" href="/jkai/intel/timeline">All →</a>
      </div>
      {#if data.upcomingTimeline.length > 0}
        <ul class="sig-list">
          {#each data.upcomingTimeline as e (e.id)}
            <li class="tl-row">
              <span class="tl-date" class:soon={isSoon(e.date)}>{shortDate(e.date)}</span>
              <span class="tl-txt">{e.title}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="sig-none">Nothing scheduled.</p>
      {/if}
    </div>

    <div class="sig-cell">
      <div class="sig-hd">
        <span class="sig-label">
          <span class="metric-label">Recent notes</span><b>{data.recentNotes.length}</b>
        </span>
        <a class="sig-more" href="/jkai/intel/notes">All →</a>
      </div>
      {#if data.recentNotes.length > 0}
        <ul class="sig-list">
          {#each data.recentNotes as n (n.id)}
            <li class="note-row">
              <a href="/jkai/intel/notes">{n.title}</a>
              <span class="note-meta"
                >{n.source} · {n.entityCount} entit{n.entityCount === 1 ? 'y' : 'ies'}</span
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="sig-none">No notes yet.</p>
      {/if}
    </div>
  </aside>
  </div>
</div>

<!-- The same card chat uses. Portalled to <body>, so nothing on this page can
     clip it and the graph never has to make room for it. -->
<EntityHoverCard />

{#if toast}
  <div class="toast">{toast}</div>
{/if}

<style>
  /* The cluster rail's own failure line. Kept beside the control that failed
     rather than in the page-level toast: a roster that did not load is a
     statement about the cluster list, not about the graph. */
  .cluster-err {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--error);
  }

  /*
   * Full-bleed, and exactly one page-height column.
   *
   * `min-height: 100%` against the layout's scrolling body is what stops the
   * page scrolling AT ALL while the findings section is folded: the explorer
   * takes the slack, so the only scroll region on screen is the control rail.
   * Opening findings makes the page taller than the viewport, and only then does
   * a second scrollbar appear — which is the moment it means something.
   */
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 16px;
    width: 100%;
    box-sizing: border-box;
  }

  /* ── Tiles ── /health's dark instrument register, compressed to a ledger. */
  .tiles {
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    flex: none;
    background: var(--text-primary);
    border-color: rgba(237, 228, 212, 0.18);
  }
  .tiles > .tile {
    min-height: 40px;
    padding: 7px 11px;
    display: flex;
    flex-direction: row;
    align-items: baseline;
    gap: 8px;
    border-color: rgba(237, 228, 212, 0.18);
    text-decoration: none;
    color: var(--bg);
    transition: background var(--t-fast) var(--ease-out);
  }
  a.tile:hover {
    background: rgba(237, 228, 212, 0.08);
  }
  .tile.warn {
    background: rgba(232, 134, 58, 0.1);
  }
  @media (max-width: 1200px) {
    /* Two complete rows instead of an eight-plus-two ledger with a blank dark
       tail. The height is unchanged; the scan order is clearer. */
    .tiles {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }
  }
  @media (max-width: 700px) {
    .tiles {
      grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    }
  }

  /* ── The loop ── six stages, each saying what it is for. ───────────────── */
  .loop {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    flex: none;
    background: var(--surface-card);
  }
  .loop-cell {
    display: block;
    padding: 9px 11px;
    text-decoration: none;
    color: inherit;
    transition: background var(--t-fast) var(--ease-out);
  }
  .loop-cell:hover {
    background: var(--accent-tint-04);
  }
  .loop-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }
  .loop-n {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  /* A backlog above its warnAbove, not a statistic — the one orange thing. */
  .loop-n.accent {
    color: var(--accent);
  }
  .loop-n.ink {
    color: var(--accent-ink);
  }
  .loop-q {
    margin: 4px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }
  @media (max-width: 1200px) {
    .loop {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 700px) {
    .loop {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* ── Board + signals rail ─────────────────────────────────────────────── */
  .intel-board {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 288px;
    gap: 12px;
    align-items: start;
    min-width: 0;
  }
  .board-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .signals {
    background: var(--surface-rail-deep);
    border: 1px solid var(--line-strong);
    min-width: 0;
  }
  .signals-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 13px;
    background: var(--text-primary);
    border-bottom: 1px solid rgba(237, 228, 212, 0.18);
  }
  .signals-title,
  .signals-state {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .signals-title {
    letter-spacing: 0.14em;
    color: rgba(237, 228, 212, 0.62);
  }
  .signals-state {
    letter-spacing: 0.08em;
    color: rgba(237, 228, 212, 0.4);
  }
  .sig-cell {
    padding: 11px 13px 13px;
    border-bottom: 1px solid var(--line-hair);
  }
  .sig-cell:last-child {
    border-bottom: none;
  }
  .sig-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 7px;
  }
  .sig-label {
    display: inline-flex;
    align-items: baseline;
    gap: 7px;
    min-width: 0;
  }
  .sig-label b {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .sig-more {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
  }
  .sig-more:hover {
    color: var(--accent-hover);
  }
  .sig-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sig-none {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-ghost);
  }

  /* Alerts: the left border says where it came from. High significance takes
     the accent, everything else the petrol second series. */
  .alert-row {
    padding-left: 10px;
    border-left: 3px solid var(--accent-ink);
  }
  .alert-row[data-sig='high'] {
    border-left-color: var(--accent);
  }
  .alert-row[data-sig='low'] {
    border-left-color: transparent;
  }
  .alert-txt {
    display: block;
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-primary);
  }
  .alert-meta,
  .note-meta {
    display: block;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .tl-row {
    display: grid;
    grid-template-columns: 62px minmax(0, 1fr);
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .tl-date {
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .tl-date.soon {
    color: var(--accent);
  }
  .tl-txt {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .note-row a {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-primary);
    text-decoration: none;
    /* Note titles can be raw generated paths with no spaces in them. */
    overflow-wrap: anywhere;
  }
  .note-row a:hover {
    color: var(--accent);
  }

  /* Right rails collapse first: below 1280px the signals drop under the board
     as a 3-up strip, and to one column on a phone. */
  @media (max-width: 1280px) {
    .intel-board {
      grid-template-columns: minmax(0, 1fr);
    }
    .signals {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .signals-heading {
      grid-column: 1 / -1;
    }
    .sig-cell {
      border-bottom: none;
      border-right: 1px solid var(--line-hair);
    }
    .sig-cell:last-child {
      border-right: none;
    }
  }
  @media (max-width: 760px) {
    .signals {
      grid-template-columns: minmax(0, 1fr);
    }
    .sig-cell {
      border-right: none;
      border-bottom: 1px solid var(--line-hair);
    }
    .sig-cell:last-child {
      border-bottom: none;
    }
  }
  /* A tile showing a filtered number is marked, so a small figure reads as
     "narrowed" rather than "the graph shrank". The label says so too; this is
     the glanceable half of the same statement. */
  .tile.narrowed {
    border-color: rgba(232, 134, 58, 0.55);
  }
  .tile.narrowed .l {
    color: var(--accent-on-dark);
  }
  .tile .n {
    font-family: var(--font-display);
    font-size: 1.125rem;
    line-height: 1;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .tile.warn .n {
    color: var(--accent-on-dark);
  }
  .tile .l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(237, 228, 212, 0.55);
    white-space: nowrap;
  }

  /* ── Explorer ──────────────────────────────────────────────────────────── */
  /* Two panes. The third — a permanent entity rail — is gone: it cost 340px
     whether or not anything was selected, and what it held now opens over the
     graph as the same card chat uses. */
  .explorer {
    display: grid;
    grid-template-columns: 288px minmax(0, 1fr);
    gap: 10px;
    /*
     * A DEFINITE height, viewport-relative. 62vh is the old fixed 620px at the
     * 1000px viewport this was designed against, and now follows the screen
     * instead of ignoring it.
     *
     * Definite rather than "fill what is left", which was tried first and is a
     * trap: the rail's natural height is the whole control list, so without a
     * height to shrink into it pushes the explorer past the viewport and the
     * page grows a scrollbar again. The rail can only scroll inside a box whose
     * height something else decided.
     */
    height: clamp(460px, 62vh, 860px);
  }
  @media (max-width: 1100px) {
    /* Stacked: the rail runs at its natural height above a fixed-height canvas,
       so nothing is squeezed into a box too small to use. */
    .explorer {
      grid-template-columns: 1fr;
      height: auto;
    }
    .rail {
      overflow-y: visible;
    }
    .canvas {
      height: 60vh;
      min-height: 420px;
    }
  }

  /* The rail is the ONLY scroll region inside the explorer, and the sections
     inside it own no scrollers of their own. */
  .rail {
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    padding: 4px 12px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--card-border) transparent;
  }
  .rail::-webkit-scrollbar {
    width: 6px;
  }
  .rail::-webkit-scrollbar-thumb {
    background: var(--card-border);
    border-radius: var(--radius-round);
  }
  .rail-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin: -4px -12px 2px;
    padding: 10px 13px;
    background: var(--text-primary);
    border-bottom: 1px solid rgba(237, 228, 212, 0.18);
  }
  .rail-title,
  .rail-state,
  .rail-clear {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .rail-title {
    letter-spacing: 0.14em;
    color: rgba(237, 228, 212, 0.62);
  }
  .rail-state {
    letter-spacing: 0.08em;
    color: rgba(237, 228, 212, 0.4);
  }
  .rail-clear {
    padding: 0;
    border: 0;
    background: transparent;
    letter-spacing: 0.08em;
    color: var(--accent-on-dark);
    cursor: pointer;
  }
  .rail-clear:hover {
    color: var(--bg);
  }

  .canvas {
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
    overflow: hidden;
    position: relative;
  }

  /* Sits over the canvas rather than in the rail: it is a property of the view,
     not of the filters.

     Colours are LITERAL, not tokens. Both views draw on the cream page, and a
     control floating over a graph needs to stay legible whatever happens to
     land under it — `--text-ghost` on the inactive button disappeared against a
     pale cluster. Same trap as the modal tokens: anything sitting over a
     surface it does not own needs its own palette. */
  /* Same pill as .dims, on the opposite side. Deliberately not adjacent to it:
     they answer different questions (what the nodes ARE vs how they are drawn)
     and sitting them together made the four buttons read as one four-way
     choice. */
  .modes {
    position: absolute;
    z-index: 4;
    top: 10px;
    left: 10px;
    display: flex;
    gap: 2px;
    padding: 2px;
    background: rgba(28, 25, 23, 0.82);
    border: 1px solid rgba(237, 228, 212, 0.22);
    border-radius: var(--radius-pill);
    backdrop-filter: blur(4px);
  }
  .modes button {
    padding: 3px 11px;
    border: none;
    border-radius: var(--radius-pill);
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.72);
    cursor: pointer;
    transition: all var(--t-fast) var(--ease-out);
  }
  .modes button:hover:not(.on) {
    color: #ede4d4;
    background: rgba(237, 228, 212, 0.12);
  }
  .modes button.on {
    background: var(--accent);
    color: #fff;
  }
  /* Carries its own dark chip rather than borrowing the canvas colour: the 3D
     scene is near-black and the 2D one is cream, so light-on-canvas text is
     legible in exactly one of the two views — and the note was unreadable in
     the one you land on. */
  .mode-note {
    position: absolute;
    z-index: 4;
    top: 44px;
    left: 10px;
    max-width: 340px;
    margin: 0;
    padding: 5px 9px;
    background: rgba(28, 25, 23, 0.82);
    border: 1px solid rgba(237, 228, 212, 0.22);
    border-radius: var(--radius-sharp);
    backdrop-filter: blur(4px);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: rgba(237, 228, 212, 0.82);
    pointer-events: none;
  }

  .dims {
    position: absolute;
    z-index: 4;
    top: 10px;
    right: 10px;
    display: flex;
    gap: 2px;
    padding: 2px;
    background: rgba(28, 25, 23, 0.82);
    border: 1px solid rgba(237, 228, 212, 0.22);
    border-radius: var(--radius-pill);
    backdrop-filter: blur(4px);
  }
  .dims button {
    padding: 3px 11px;
    border: none;
    border-radius: var(--radius-pill);
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.72);
    cursor: pointer;
    transition: all var(--t-fast) var(--ease-out);
  }
  .dims button:hover:not(.on) {
    color: #ede4d4;
    background: rgba(237, 228, 212, 0.12);
  }
  .dims button.on {
    background: var(--accent);
    color: #fff;
  }

  /* ── Rail controls ─────────────────────────────────────────────────────── */
  .rail :global(label),
  .rail :global(.ctl-title) {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .rail select {
    width: 100%;
    padding: 6px 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .rail input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .rail input[type='search'] {
    width: 100%;
    padding: 6px 8px;
    font: inherit;
    /* 16px: anything smaller and iOS zooms the whole page on focus. */
    font-size: var(--fs-body);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
  }
  .hint {
    margin: 2px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    line-height: 1.4;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 3px 8px;
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--chip, var(--accent-ink-tint-35));
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
  }
  .chip:hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .chip.on {
    background: var(--accent-tint-08);
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  /* Colour & highlight ---------------------------------------------------- */
  .paint-modes {
    display: flex;
    gap: 4px;
    margin-bottom: 6px;
  }
  .paint-modes .chip {
    flex: 1 1 0;
    text-align: center;
    border-left-width: 1px;
  }
  /* One row per key, not a wrapping chip cloud.
     The rail is ~280px and a type name is up to twenty characters, so chips
     wrapped into two ragged columns and truncated mid-word — "process_st…",
     "data_sourc…" — which is a legend you cannot read. Rows give the name the
     full width, the count a fixed column, and the swatch a fixed place to be
     compared down. */
  .legend {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
    /* Capped and scrolled: 29 live entity types would otherwise push every
       other rail section off the screen. */
    max-height: 230px;
    overflow-y: auto;
  }
  .legend-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 3px 7px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    cursor: pointer;
    text-align: left;
  }
  .legend-chip:hover {
    border-color: var(--line-strong);
    color: var(--accent);
  }
  .legend-chip.on {
    background: var(--accent-tint-08);
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .lc-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .legend-chip b {
    flex: 0 0 auto;
    font-weight: 400;
    color: var(--text-ghost);
  }
  .legend-chip.on b {
    color: var(--accent);
  }
  .swatch {
    width: 9px;
    height: 9px;
    border-radius: var(--radius-sharp);
    flex: 0 0 auto;
  }
  .paint-acts {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  .focus-box {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--accent-tint-04);
    border-radius: var(--radius-sharp);
    padding: 8px;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }
  .go {
    align-self: flex-start;
    padding: 6px 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sharp);
    cursor: pointer;
  }
  .go:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .path {
    padding: 7px;
    background: var(--surface-sunken);
    border-radius: var(--radius-sharp);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
  }
  .path.primary {
    background: var(--accent-tint-08);
  }
  .hops {
    display: block;
    font-family: var(--font-mono);
    color: var(--accent);
    margin-bottom: 3px;
  }
  .pnode {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-primary);
    text-decoration: underline;
    text-decoration-style: dotted;
    cursor: pointer;
  }
  .pnode:hover {
    color: var(--accent);
  }
  .pedge {
    font-family: var(--font-mono);
    color: var(--text-ghost);
    margin: 0 4px;
  }
  .pedge::before {
    content: '→ ';
  }
  .path-none {
    margin: 0;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .legend b {
    color: var(--text-secondary);
    font-weight: 500;
  }
  .trim {
    color: var(--warn);
  }

  .spread {
    position: absolute;
    top: 10px;
    right: 96px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-round);
  }
  .spread label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .spread input {
    width: 90px;
  }

  .loading {
    display: grid;
    place-items: center;
    height: 100%;
    min-height: 160px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }

  .graph-error {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 0.5rem;
    height: 100%;
    min-height: 160px;
    padding: 1rem;
    text-align: center;
  }

  .ge-head {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .ge-detail {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    max-width: 42ch;
  }

  .ge-retry {
    margin-top: 0.25rem;
    padding: 0.4rem 0.9rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent-ink);
    background: transparent;
    border: 1px solid var(--accent);
    border-radius: 2px;
    cursor: pointer;
  }

  .ge-retry:hover {
    background: var(--accent);
    color: var(--bg);
  }

  /* ── Findings ──────────────────────────────────────────────────────────── */
  .findings {
    flex: none;
    border-top: 1px solid var(--line-hair);
  }
  .findings-head {
    display: flex;
    align-items: baseline;
    gap: 9px;
    width: 100%;
    padding: 11px 2px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .findings-head:hover .fh-title {
    color: var(--accent);
  }
  .chev {
    flex: none;
    width: 9px;
    color: var(--text-ghost);
  }
  .fh-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
  }
  .fh-note {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    border-bottom: 1px solid var(--line-strong);
    margin-bottom: 14px;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .tabs button.on {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .tabs .c {
    font-size: var(--fs-label-xs);
    opacity: 0.7;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 10px;
    padding-bottom: 14px;
  }
  .none {
    color: var(--text-ghost);
    font-size: var(--fs-label);
  }

  .rel {
    background: var(--card-bg);
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--accent-ink-tint-35);
    border-radius: var(--radius-round);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .rel-pair {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-body-sm);
    font-weight: 600;
  }
  .rel-pair button {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-primary);
    cursor: pointer;
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  .rel-pair button:hover {
    color: var(--accent);
  }
  .arrow {
    color: var(--accent);
    font-weight: 400;
  }
  .rel-why {
    margin: 0;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.45;
  }

  /* A prediction has two real answers, so the negative one sits beside the
     positive rather than being a dead end. */
  .rel-acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .rel-acts .ghost {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 5px 9px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    background: none;
    color: var(--text-ghost);
    cursor: pointer;
  }
  .rel-acts .ghost:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--line-strong);
  }
  .rel-acts .ghost:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .action {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 5px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    text-decoration: none;
  }
  .action:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .kindchip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--accent-ink);
  }
  .status {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    text-transform: uppercase;
  }
  .status.running {
    color: var(--warn);
  }
  .status.done {
    color: var(--success);
  }

  .quality-head {
    margin: 0 0 12px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .quality-head a {
    color: var(--accent);
  }

  .toast {
    position: fixed;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    background: var(--surface-elevated);
    border: 1px solid var(--accent-tint-35);
    border-radius: var(--radius-round);
    padding: 9px 16px;
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
</style>
