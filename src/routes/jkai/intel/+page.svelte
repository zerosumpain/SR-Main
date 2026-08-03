<script lang="ts">
  // The Intel command centre.
  //
  // Replaces a page of four counters and two lists. The organising idea is that
  // every panel answers a question and every answer carries an action:
  //   - the graph answers "what is connected to what"
  //   - insights answer "what should I look at that I didn't ask about"
  //   - the commission bar answers "and what do I do about it"
  //
  // Heavy work (analytics, insights, duplicate detection) is fetched after
  // first paint, so the page renders immediately off the server-loaded counts.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import NetworkGraph from '$lib/components/intel/NetworkGraph.svelte';
  import NetworkGraph3D from '$lib/components/intel/NetworkGraph3D.svelte';
  import SourcePicker from '$lib/components/intel/SourcePicker.svelte';
  import GmailSweepPanel from '$lib/components/intel/GmailSweepPanel.svelte';
  import EntityCard from '$lib/components/intel/EntityCard.svelte';
  import InsightCard from '$lib/components/intel/InsightCard.svelte';
  import CommissionBar from '$lib/components/intel/CommissionBar.svelte';
  import { commission } from '$lib/jkai/intel/entity-card-store';
  import type {
    InsightData,
    NetworkPayload,
    UnlikelyRelation,
    PredictedLink,
  } from '$lib/components/intel/types';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { SURFACES, STAGES } from '$lib/components/intel/workbench';

  let { data } = $props();

  let network = $state<NetworkPayload | null>(null);
  let insights = $state<InsightData[]>([]);
  let unlikely = $state<UnlikelyRelation[]>([]);
  let predicted = $state<PredictedLink[]>([]);
  let duplicates = $state<{ total: number; autoMergeable: number } | null>(null);

  let loadingNetwork = $state(true);
  let loadingInsights = $state(true);
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
  let entityPick = $state('');
  let showGuide = $state(false);

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

  /** 3D is the default view; the choice persists so it is not re-made per visit. */
  const VIEW_KEY = 'intel:graph3d';
  let view3d = $state(true);

  function setView(next: boolean) {
    view3d = next;
    try {
      localStorage.setItem(VIEW_KEY, next ? '1' : '0');
    } catch {
      // Private browsing or a full quota. The toggle still works for this
      // session; only remembering it fails.
    }
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
    communityId = '';
    minDegree = 1;
    focusId = null;
  }

  const filterCount = $derived(
    (keywordApplied ? 1 : 0) +
      activeCategories.length +
      activeSources.length +
      (pinnedIds.length ? 1 : 0) +
      (typeId ? 1 : 0) +
      (communityId ? 1 : 0) +
      (focusId ? 1 : 0),
  );

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

  const query = $derived.by(() => {
    const p = new URLSearchParams();
    if (typeId) p.set('typeId', typeId);
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
    return p.toString();
  });

  // Refetch when the filter query changes. Only `query` is read reactively;
  // everything the loader touches it writes, so there is no read-own-write loop.
  $effect(() => {
    const q = query;
    let cancelled = false;
    loadingNetwork = true;
    fetch(`/api/jkai/intel/network?${q}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (cancelled) return;
        if (body) network = body;
        loadingNetwork = false;
      })
      .catch(() => {
        if (!cancelled) loadingNetwork = false;
      });
    return () => {
      cancelled = true;
    };
  });

  onMount(async () => {
    // Restore the remembered 2D/3D choice. Read here rather than in the
    // initialiser because localStorage does not exist during SSR.
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved !== null) view3d = saved === '1';
    } catch {
      // Unreadable storage just means the default stands.
    }

    try {
      const [insRes, dupRes, comRes, watchRes] = await Promise.all([
        fetch('/api/jkai/intel/insights?limit=40'),
        fetch('/api/jkai/intel/duplicates?min=0.5'),
        fetch('/api/jkai/intel/commission?limit=25'),
        fetch('/api/jkai/intel/watchlist'),
      ]);
      if (insRes.ok) {
        const body = await insRes.json();
        insights = body.insights ?? [];
        unlikely = body.unlikelyRelations ?? [];
        predicted = body.predictedLinks ?? [];
      }
      if (dupRes.ok) {
        const body = await dupRes.json();
        duplicates = { total: body.total ?? 0, autoMergeable: body.autoMergeable ?? 0 };
      }
      // Both are additive panels — a failure in either must not blank the page.
      if (comRes.ok) commissions = (await comRes.json()).commissions ?? [];
      if (watchRes.ok) {
        const body = await watchRes.json();
        watchedCount = (body.watched ?? body.entities ?? []).length ?? 0;
      }
    } finally {
      loadingInsights = false;
    }
  });

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
</script>

<JkaiPageTitle title="INTEL" />

<div class="wrap">
  <div class="topbar">
    <CommissionBar busy={!!busyId} onRun={(kind, payload) => runCommission(kind, payload, [], 'bar')} />
    <div class="quick">
      <a href="/jkai/intel/notes/new">+ Note</a>
      <button type="button" class="guide-toggle" class:on={showGuide} onclick={() => (showGuide = !showGuide)}>
        {showGuide ? 'Hide guide' : 'How this fits together'}
      </button>
    </div>
  </div>

  {#if showGuide}
    <!-- The loop, stated once. Which surface answers which question was the
         thing nobody could work out from six equal links. -->
    <section class="guide">
      {#each STAGES as stage (stage)}
        {@const inStage = SURFACES.filter((sf) => sf.stage === stage)}
        {#if inStage.length}
          <div class="guide-stage">
            <h2>{stage}</h2>
            {#each inStage as sf (sf.href)}
              <article class="guide-item">
                <a href={sf.href}>{sf.label}</a>
                <p class="q">{sf.question}</p>
                <p class="vs">{sf.ratherThan}</p>
              </article>
            {/each}
          </div>
        {/if}
      {/each}
    </section>
  {/if}

  <!-- Vital signs -->
  <div class="tiles">
    <a class="tile" href="/jkai/intel/entities">
      <span class="n">{network?.stats.totalNodes ?? data.stats.entityCount}</span>
      <span class="l">Entities</span>
    </a>
    <div class="tile">
      <span class="n">{network?.stats.totalEdges ?? '—'}</span>
      <span class="l">Connections</span>
    </div>
    <div class="tile">
      <span class="n">{network?.stats.communities ?? '—'}</span>
      <span class="l">Clusters</span>
    </div>
    <div class="tile" class:warn={fragmentation > 0.2}>
      <span class="n">{network?.stats.components ?? '—'}</span>
      <span class="l">Fragments</span>
    </div>
    <a class="tile" class:warn={(duplicates?.total ?? 0) > 0} href="/jkai/intel/quality">
      <span class="n">{duplicates?.total ?? '—'}</span>
      <span class="l">Duplicates</span>
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

  <!-- Network explorer -->
  <section class="explorer">
    <aside class="controls">
      <div class="ctl">
        <label for="f-q">Keyword</label>
        <input
          id="f-q"
          type="search"
          placeholder="name, alias or summary…"
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
      </div>

      <SourcePicker
        sources={network?.sources ?? []}
        categories={network?.categories ?? []}
        {activeSources}
        {activeCategories}
        onToggleSource={toggleSource}
        onToggleCategory={toggleCategory}
        onClear={clearSources}
      />

      <!-- Sits under Sources because that is what it changes: it is how email
           gets into the graph in the first place. -->
      <GmailSweepPanel onDone={() => void Promise.all([reloadNetwork(), reloadInsights()])} />

      <div class="ctl">
        <span class="ctl-title">Pin to entities</span>
        <select
          bind:value={entityPick}
          onchange={() => pinEntity(entityPick)}
          aria-label="Add an entity to the pinned set"
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
      </div>

      {#if filterCount > 0}
        <div class="ctl filters-on">
          <button type="button" class="link-btn" onclick={clearFilters}>
            Clear {filterCount} filter{filterCount === 1 ? '' : 's'}
          </button>
        </div>
      {/if}

      <div class="ctl">
        <label for="f-type">Type</label>
        <select id="f-type" bind:value={typeId}>
          <option value="">All types</option>
          {#each network?.types ?? [] as t (t.id)}
            <option value={t.id}>{t.icon} {t.name}</option>
          {/each}
        </select>
      </div>

      <div class="ctl">
        <label for="f-cluster">Cluster</label>
        <select id="f-cluster" bind:value={communityId}>
          <option value="">All clusters</option>
          {#each network?.communities ?? [] as c (c.id)}
            <option value={String(c.id)}>{c.label} ({c.size})</option>
          {/each}
        </select>
      </div>

      <div class="ctl">
        <label for="f-degree">Min connections: {minDegree}</label>
        <input id="f-degree" type="range" min="0" max="10" bind:value={minDegree} />
      </div>

      {#if focusId}
        <div class="ctl focus-box">
          <label for="f-hops">Hops from focus: {hops}</label>
          <input id="f-hops" type="range" min="1" max="5" bind:value={hops} />
          <button type="button" class="link-btn" onclick={clearFocus}>Clear focus</button>
        </div>
      {/if}

      <div class="ctl">
        <span class="ctl-title">Find a path</span>
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
      </div>

      {#if network}
        <div class="legend">
          <span class="ctl-title">Reading the graph</span>
          <p>Size = importance. Colour = cluster. Orange links cross clusters. A dashed ring marks a broker.</p>
          {#if network.trimmed}
            <p class="trim">Showing the {network.stats.shown} most important of {network.stats.totalNodes}.</p>
          {/if}
        </div>
      {/if}
    </aside>

    <div class="canvas">
      <div class="dims" role="group" aria-label="Graph dimension">
        <button type="button" class:on={view3d} onclick={() => setView(true)} aria-pressed={view3d}>3D</button>
        <button type="button" class:on={!view3d} onclick={() => setView(false)} aria-pressed={!view3d}>2D</button>
      </div>

      {#if loadingNetwork && !network}
        <div class="loading">Analysing the graph…</div>
      {:else if network}
        {#if view3d}
          <NetworkGraph3D
            nodes={network.nodes}
            edges={network.edges}
            {highlightPath}
            matchedIds={network.matched ?? []}
            {selectedId}
            onSelect={(id) => (selectedId = id)}
            onOpen={(id) => focus(id)}
          />
        {:else}
          <NetworkGraph
            nodes={network.nodes}
            edges={network.edges}
            {highlightPath}
            matchedIds={network.matched ?? []}
            {selectedId}
            onSelect={(id) => (selectedId = id)}
            onOpen={(id) => focus(id)}
          />
        {/if}
      {/if}
    </div>

    <aside class="detail">
      {#if selectedId}
        <EntityCard
          entityId={selectedId}
          onFocus={focus}
          onCommission={(kind, payload, ids) => runCommission(kind, payload, ids, `card-${selectedId}`)}
        />
      {:else}
        <div class="detail-empty">
          <p>Click any entity to inspect it — its connections, sources, timeline, and the work you can commission from it.</p>
          <p>Double-click to centre the graph on it and explore outward by hops.</p>
        </div>
      {/if}
    </aside>
  </section>

  <!-- Findings -->
  <section class="findings">
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

    {#if loadingInsights}
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
  </section>
</div>

{#if toast}
  <div class="toast">{toast}</div>
{/if}

<style>
  /* Full-bleed: the explorer is a three-pane instrument and the findings grid
     is auto-fill — both get strictly better with width, and a centred column
     was wasting a third of a wide screen on margins. */
  .wrap {
    padding: 20px;
    width: 100%;
  }

  .topbar {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .topbar > :global(.bar) {
    flex: 1;
    min-width: 340px;
  }
  .quick {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .quick a {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    text-decoration: none;
    white-space: nowrap;
  }
  .quick a:hover,
  .guide-toggle:hover {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }
  .guide-toggle {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 12px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .guide-toggle.on {
    border-color: var(--accent-tint-35);
    color: var(--accent);
  }

  /* ── Guide ─────────────────────────────────────────────────────────────── */
  .guide {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
    margin-top: 12px;
    padding: 14px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
  }
  .guide-stage h2 {
    margin: 0 0 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
  }
  .guide-item + .guide-item {
    margin-top: 12px;
  }
  .guide-item a {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-35);
  }
  .guide-item a:hover {
    color: var(--accent);
  }
  .guide-item .q {
    margin: 5px 0 0;
    font-size: var(--fs-label);
    color: var(--text-secondary);
    line-height: 1.45;
  }
  .guide-item .vs {
    margin: 4px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    line-height: 1.45;
  }

  /* ── Tiles ─────────────────────────────────────────────────────────────── */
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(112px, 1fr));
    gap: 8px;
    margin: 14px 0;
  }
  .tile {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-decoration: none;
    color: inherit;
    transition: border-color var(--t-fast) var(--ease-out);
  }
  a.tile:hover {
    border-color: var(--accent-tint-35);
  }
  .tile.warn {
    border-color: var(--warn-border);
    background: var(--warn-bg);
  }
  .tile .n {
    font-family: var(--font-display);
    font-size: 1.5rem;
    line-height: 1.05;
    color: var(--accent-ink);
  }
  .tile.warn .n {
    color: var(--warn);
  }
  .tile .l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }

  /* ── Explorer ──────────────────────────────────────────────────────────── */
  .explorer {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 340px;
    gap: 10px;
    height: 620px;
    margin-bottom: 18px;
  }
  @media (max-width: 1200px) {
    .explorer {
      grid-template-columns: 1fr;
      height: auto;
    }
    .canvas {
      height: 480px;
    }
  }

  .controls,
  .detail {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    padding: 12px;
    overflow-y: auto;
  }
  .canvas {
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    overflow: hidden;
    position: relative;
  }

  /* Sits over the canvas rather than in the rail: it is a property of the view,
     not of the filters.

     Colours are LITERAL, not tokens. This control floats over two different
     backgrounds — the cream 2D canvas and the near-black 3D scene — and the
     page tokens all assume the cream one, so `--text-ghost` on the inactive
     button rendered invisible over the 3D view. Same trap as the modal tokens:
     anything sitting over a surface it does not own needs its own palette. */
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

  .ctl {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-bottom: 12px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--divider);
  }
  .ctl:last-child {
    border-bottom: none;
  }
  .ctl label,
  .ctl-title {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
  }
  .ctl select {
    width: 100%;
    padding: 5px 7px;
    font: inherit;
    font-size: var(--fs-label);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
  }
  .ctl input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  .ctl input[type='search'] {
    width: 100%;
    padding: 5px 7px;
    font: inherit;
    font-size: var(--fs-body);
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
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
    border: 1px solid var(--card-border);
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
  .filters-on {
    background: var(--accent-tint-04);
    border-radius: var(--radius-sharp);
    padding: 8px;
  }
  .focus-box {
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
    padding: 5px 10px;
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
    margin-top: 8px;
    padding: 7px;
    background: var(--bg-section);
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
    margin: 8px 0 0;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .legend p {
    margin: 4px 0 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
  }
  .trim {
    color: var(--warn);
  }

  .detail-empty {
    color: var(--text-ghost);
    font-size: var(--fs-label);
    line-height: 1.5;
    padding: 20px 4px;
  }
  .detail-empty p + p {
    margin-top: 10px;
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

  /* ── Findings ──────────────────────────────────────────────────────────── */
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    border-bottom: 1px solid var(--card-border);
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
  }
  .none {
    color: var(--text-ghost);
    font-size: var(--fs-label);
  }

  .rel {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
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
    border-color: var(--card-border);
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
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
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
