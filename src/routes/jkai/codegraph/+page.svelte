<script lang="ts">
  // The build-history map.
  //
  // Drawn with the SAME components as /jkai/intel — `NetworkGraph` in 2D,
  // `NetworkGraph3D` in 3D — rather than a second force layout of its own. The
  // first cut hand-rolled an SVG on the grounds that those components were
  // "bound to intel's types"; they are not, their node shape is generic, and
  // the fork cost this page its 3D view, its zoom, its cluster shells and every
  // encoding the rest of the site shares. `$lib/codegraph/network` adapts the
  // rows; nothing here re-implements physics.
  //
  // WHAT IS DIFFERENT FROM INTEL, deliberately: in intel a cluster is a Louvain
  // result — a fact about the graph. Here the useful groupings are the ones you
  // already think in (directory, layer, gate, outcome, activity), so the
  // clustering is a CHOICE and `groupBy` is the primary control.
  import { onMount } from 'svelte';
  import NetworkGraph from '$lib/components/intel/NetworkGraph.svelte';
  import NetworkGraph3D from '$lib/components/intel/NetworkGraph3D.svelte';
  import RailSection from '$lib/components/intel/RailSection.svelte';
  import { GROUP_BY, type GroupBy } from '$lib/codegraph/network';
  import type { NetworkPayload } from '$lib/codegraph/types';

  /** 3D is the default, and the choice persists — same key idiom as intel so
   *  the two graphs do not disagree about what "the view" means. */
  const VIEW_KEY = 'codegraph:graph3d';
  let view3d = $state(true);
  let explode = $state(1);
  let focusCommunities = $state<number[]>([]);

  // ── Slicing state ─────────────────────────────────────────────────────────
  // `layer`, not `directory`, as the opening view: directory yields 86 groups
  // on this repo, which is past what any categorical palette can distinguish —
  // it renders as confetti in 2D and as one enormous cluster shell in 3D.
  // Layer gives 11, which is legible, and directory is one click away for the
  // drill-down. The default should answer a question, not show off the data.
  let groupBy = $state<GroupBy>('layer');
  let q = $state('');
  let liveness = $state<'all' | 'live' | 'deleted'>('all');
  let onlyWithHistory = $state(true);
  let edgeKinds = $state<string[]>(['co_change', 'needs_context']);
  let gates = $state<string[]>([]);
  let verdicts = $state<string[]>([]);

  let network = $state<NetworkPayload | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let selectedId = $state<string | null>(null);
  let attempt = $state(0);

  // NOT $state: a fetch sequence guard, read and written by the loader. As
  // reactive state the loader would subscribe to what it writes, which is the
  // documented route to effect_update_depth_exceeded.
  let seq = 0;

  const params = $derived(
    new URLSearchParams({
      groupBy,
      q,
      liveness,
      onlyWithHistory: onlyWithHistory ? '1' : '0',
      edgeKinds: edgeKinds.join(','),
      gates: gates.join(','),
      verdicts: verdicts.join(','),
    }).toString(),
  );

  $effect(() => {
    // Tracked reads: the query string and the retry counter, nothing else.
    const query = params;
    attempt;
    const mine = ++seq;
    loading = true;
    fetch(`/api/jkai/codegraph/network?${query}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
        return r.json();
      })
      .then((payload: NetworkPayload) => {
        if (mine !== seq) return; // a newer request has overtaken this one
        network = payload;
        loadError = null;
      })
      .catch((e: Error) => {
        if (mine !== seq) return;
        // Loud, and the previous graph stays on screen: a blank canvas with no
        // message is the failure mode this whole project exists to stop.
        loadError = e.message;
      })
      .finally(() => {
        if (mine === seq) loading = false;
      });
  });

  onMount(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    if (saved !== null) view3d = saved === '1';
  });

  function setView(next: boolean) {
    view3d = next;
    try {
      localStorage.setItem(VIEW_KEY, next ? '1' : '0');
    } catch {
      // Private browsing — the toggle still works, it just will not persist.
    }
  }

  function toggleIn(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  function toggleFocus(id: number) {
    focusCommunities = focusCommunities.includes(id)
      ? focusCommunities.filter((c) => c !== id)
      : [...focusCommunities, id];
  }

  const selected = $derived(network?.nodes.find((n) => n.id === selectedId) ?? null);

  // Double-click opens the full record. Single click only selects — the two
  // gestures answer different questions ("which is this" vs "tell me everything")
  // and collapsing them would fire a fetch on every stray click while panning.
  let detail = $state<{
    path: string;
    episodes: Array<Record<string, unknown>>;
    lessons: Array<Record<string, unknown>>;
    neighbours: Array<{ path: string; kind: string; weight: number }>;
  } | null>(null);
  let detailLoading = $state(false);
  let detailError = $state<string | null>(null);
  let detailSeq = 0;

  async function openNode(id: string) {
    selectedId = id;
    const mine = ++detailSeq;
    detailLoading = true;
    detailError = null;
    try {
      const r = await fetch(`/api/jkai/codegraph/node/${encodeURIComponent(id)}`);
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 100)}`);
      const j = await r.json();
      if (mine === detailSeq) detail = j;
    } catch (e) {
      if (mine === detailSeq) detailError = (e as Error).message;
    } finally {
      if (mine === detailSeq) detailLoading = false;
    }
  }
  const groupLabel = $derived(GROUP_BY.find((g) => g.id === groupBy)?.label ?? '');
  const groupQuestion = $derived(GROUP_BY.find((g) => g.id === groupBy)?.question ?? '');

  const GATES = ['svelte-check', 'vitest', 'typecheck', 'build', 'lint', 'gate'];
  const VERDICTS = ['verified', 'landed', 'unverified', 'repaired', 'abandoned'];
  const LIVENESS: Array<[typeof liveness, string]> = [
    ['all', 'All'],
    ['live', 'At HEAD'],
    ['deleted', 'Deleted'],
  ];
  const EDGE_KINDS: Array<[string, string]> = [
    ['co_change', 'Changes together'],
    ['needs_context', 'Read before editing'],
  ];
</script>

<svelte:head><title>Codegraph — map</title></svelte:head>

<section class="wrap">
  <header class="head">
    <h1>Build-history map</h1>
    <p class="lede">
      Files and gates, sized by how much recorded history each carries, joined where they change
      together. Colour is <strong>{groupLabel}</strong> — {groupQuestion}
    </p>
  </header>

  <section class="explorer">
    <aside class="rail">
      <RailSection title="Colour by">
        <div class="group-by">
          {#each GROUP_BY as g (g.id)}
            <button
              type="button"
              class:on={groupBy === g.id}
              aria-pressed={groupBy === g.id}
              title={g.question}
              onclick={() => {
                groupBy = g.id;
                focusCommunities = [];
              }}>{g.label}</button
            >
          {/each}
        </div>
      </RailSection>

      <RailSection title="Find" badge={network?.matched.length || null}>
        <input class="q" type="search" placeholder="path contains…" bind:value={q} spellcheck="false" />
        <p class="hint">
          Matches are highlighted; everything around them stays on screen and dims. A keyword view
          with no edges would say nothing about a network.
        </p>
      </RailSection>

      <RailSection title="Which files" badge={onlyWithHistory ? 'with history' : null}>
        <label class="check">
          <input type="checkbox" bind:checked={onlyWithHistory} />
          Only files with recorded history
        </label>
        <div class="seg" role="group" aria-label="Present at git HEAD">
          {#each LIVENESS as [v, label] (v)}
            <button
              type="button"
              class:on={liveness === v}
              aria-pressed={liveness === v}
              onclick={() => (liveness = v)}>{label}</button
            >
          {/each}
        </div>
        <p class="hint">
          A deleted file is drawn hollow — its lessons may still be true, but nothing can act on
          them.
        </p>
      </RailSection>

      <RailSection title="Links" badge={edgeKinds.length < 2 ? edgeKinds.length : null} open={false}>
        {#each EDGE_KINDS as [k, label] (k)}
          <label class="check">
            <input
              type="checkbox"
              checked={edgeKinds.includes(k)}
              onchange={() => (edgeKinds = toggleIn(edgeKinds, k))}
            />
            {label}
          </label>
        {/each}
      </RailSection>

      <RailSection title="Gate" badge={gates.length || null} open={false}>
        <div class="chips">
          {#each GATES as g (g)}
            <button
              type="button"
              class:on={gates.includes(g)}
              aria-pressed={gates.includes(g)}
              onclick={() => (gates = toggleIn(gates, g))}>{g}</button
            >
          {/each}
        </div>
      </RailSection>

      <RailSection title="Outcome" badge={verdicts.length || null} open={false}>
        <div class="chips">
          {#each VERDICTS as v (v)}
            <button
              type="button"
              class:on={verdicts.includes(v)}
              aria-pressed={verdicts.includes(v)}
              onclick={() => (verdicts = toggleIn(verdicts, v))}>{v}</button
            >
          {/each}
        </div>
        <p class="hint">
          The worst outcome on a file, not the latest — one repaired after being verified is a file
          that needed repairing.
        </p>
      </RailSection>

      {#if network?.communities?.length}
        <RailSection title="Groups" badge={focusCommunities.length || network.communities.length}>
          <ul class="clusters">
            {#each network.communities.slice(0, 24) as c (c.id)}
              <li>
                <button
                  type="button"
                  class:on={focusCommunities.includes(c.id)}
                  aria-pressed={focusCommunities.includes(c.id)}
                  onclick={() => toggleFocus(c.id)}
                >
                  <span class="swatch" style="--i:{c.id}"></span>
                  <span class="cl">{c.label}</span>
                  <span class="cn">{c.size}</span>
                </button>
              </li>
            {/each}
          </ul>
          {#if focusCommunities.length}
            <button type="button" class="clear" onclick={() => (focusCommunities = [])}>
              Clear focus
            </button>
          {/if}
          <p class="hint">
            Focus brings a group forward; the rest recede rather than disappear, so you can still
            see where it sits among them.
          </p>
        </RailSection>
      {/if}

      {#if network?.stats}
        <RailSection title="What's drawn" open={false}>
          <dl class="stats">
            <div><dt>Shown</dt><dd>{network.stats.shown} of {network.stats.totalNodes}</dd></div>
            <div><dt>Links</dt><dd>{network.edges.length}</dd></div>
            <div><dt>Groups</dt><dd>{network.stats.communities}</dd></div>
            <div><dt>Unconnected</dt><dd>{network.stats.isolated}</dd></div>
          </dl>
          <p class="hint">
            Most files genuinely connect to nothing — a co-change link needs two files edited in the
            same session. The scatter is the data, not a bug.
          </p>
        </RailSection>
      {/if}
    </aside>

    <div class="canvas">
      <div class="dims" role="group" aria-label="Graph dimension">
        <button type="button" class:on={view3d} onclick={() => setView(true)} aria-pressed={view3d}>3D</button>
        <button type="button" class:on={!view3d} onclick={() => setView(false)} aria-pressed={!view3d}>2D</button>
      </div>

      {#if view3d && network}
        <!-- Beside the 3D/2D pair, not in the rail: this changes how the graph
             is DRAWN, not which graph you are looking at. -->
        <div class="spread">
          <label for="cg-explode">Spread</label>
          <input id="cg-explode" type="range" min="1" max="4" step="0.25" bind:value={explode} />
        </div>
      {/if}

      {#if loading && !network}
        <div class="loading">Building the map…</div>
      {:else if loadError && !network}
        <div class="graph-error">
          <p class="ge-head">The map could not be built.</p>
          <p class="ge-detail">{loadError}</p>
          <button type="button" class="ge-retry" onclick={() => attempt++}>Try again</button>
        </div>
      {:else if network && network.nodes.length === 0}
        <div class="loading">
          Nothing matches.{onlyWithHistory
            ? ' Try including files with no recorded history.'
            : ''}
        </div>
      {:else if network}
        {#if view3d}
          <NetworkGraph3D
            nodes={network.nodes}
            edges={network.edges}
            matchedIds={network.matched}
            {selectedId}
            {focusCommunities}
            {explode}
            communities={network.communities ?? []}
            onSelect={(id) => (selectedId = id)}
            onOpen={(id) => openNode(id)}
          />
        {:else}
          <NetworkGraph
            nodes={network.nodes}
            edges={network.edges}
            matchedIds={network.matched}
            {selectedId}
            {focusCommunities}
            onSelect={(id) => (selectedId = id)}
            onOpen={(id) => openNode(id)}
          />
        {/if}
      {/if}

      {#if loadError && network}
        <p class="stale-warn">Showing the last good map — refresh failed: {loadError}</p>
      {/if}
    </div>

    <aside class="detail">
      {#if selected}
        <h2>{selected.type}</h2>
        <dl class="stats">
          <div><dt>Episodes</dt><dd>{selected.noteCount}</dd></div>
          <div><dt>Links</dt><dd>{selected.degree}</dd></div>
          <div><dt>At HEAD</dt><dd>{selected.confirmed ? 'yes' : 'deleted'}</dd></div>
          <div><dt>Group</dt><dd>{selected.categories[0]}</dd></div>
        </dl>
        {#if detailLoading}
          <p class="hint">Loading the record…</p>
        {:else if detailError}
          <p class="err">Could not load the record: {detailError}</p>
        {:else if detail && detail.path === selected.type}
          {#if detail.lessons.length}
            <h3>Rules ({detail.lessons.length})</h3>
            <ul class="recs">
              {#each detail.lessons.slice(0, 6) as l (l.id)}
                <li><strong>{l.title}</strong>{l.stale_at ? ' · stale' : ''}</li>
              {/each}
            </ul>
          {/if}
          {#if detail.episodes.length}
            <h3>Episodes ({detail.episodes.length})</h3>
            <ul class="recs">
              {#each detail.episodes.slice(0, 6) as e (e.id)}
                <li><code>{e.fingerprint ?? e.gate ?? '—'}</code> · {e.verdict}</li>
              {/each}
            </ul>
          {/if}
          {#if detail.neighbours.length}
            <h3>Linked to</h3>
            <ul class="recs">
              {#each detail.neighbours.slice(0, 8) as nb, i (`${nb.kind}:${nb.path}:${i}`)}
                <li><span class="ek">{nb.kind}</span> {nb.path.split('/').slice(-2).join('/')}{nb.weight > 1 ? ` ×${nb.weight}` : ''}</li>
              {/each}
            </ul>
          {/if}
          {#if !detail.lessons.length && !detail.episodes.length && !detail.neighbours.length}
            <p class="hint">Nothing recorded against this file yet.</p>
          {/if}
        {:else}
          <p class="hint">Double-click the node to load its full record.</p>
        {/if}

        <a
          class="ask"
          href="/jkai/codegraph/ask?q={encodeURIComponent(`file:${selected.type} | hops 1`)}"
        >
          Ask the graph about this file →
        </a>
      {:else}
        <h2>Pick a file</h2>
        <p class="hint">
          Size is history carried — episodes plus lessons. Colour is the grouping you chose. Hollow
          nodes no longer exist at HEAD.
        </p>
        <p class="hint">Accent links cross a group boundary; those are usually the interesting ones.</p>
        <p class="hint">
          Drag to rotate in 3D, scroll to zoom, click to select — <strong>double-click to open the
          full record</strong>.
        </p>
      {/if}
    </aside>
  </section>
</section>

<style>
  .wrap {
    /*
     * `width: 100%`, not a max-width, and it is load-bearing: the hub shell
     * `.jkai-body` is a FLEX container, so a block child sizes to its content
     * rather than to the row. Without this the page settled at 754px of a
     * 1600px viewport and the graph column — the only part anyone came for —
     * got 164px. Same declaration intel's own wrap carries, for the same reason.
     */
    width: 100%;
    box-sizing: border-box;
    padding: 14px 16px 2rem;
  }
  .head h1 {
    font-family: var(--font-display);
    font-size: var(--fs-display-sm);
    margin: 0 0 0.35rem;
  }
  .lede {
    color: var(--text-secondary);
    max-width: 74ch;
    margin: 0 0 1.25rem;
    font-size: var(--fs-body-sm);
  }
  .explorer {
    display: grid;
    grid-template-columns: 250px minmax(0, 1fr) 260px;
    gap: 10px;
    /*
     * A DEFINITE height, viewport-relative — copied from intel, including the
     * reason. "Fill what is left" is the trap: the rail's natural height is the
     * whole control list, so with no height to shrink into it pushes the
     * explorer past the viewport and the page grows a second scrollbar. A rail
     * can only scroll inside a box whose height something else decided.
     */
    height: clamp(460px, 68vh, 900px);
  }
  .rail,
  .detail {
    border: 1px solid var(--card-border);
    background: var(--card-bg);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--card-border) transparent;
  }
  .detail {
    padding: 1rem;
  }
  .canvas {
    border: 1px solid var(--card-border);
    overflow: hidden;
    position: relative;
    /* Height comes from the explorer row; min-height:0 lets a grid item shrink
       below its content, which is what stops the canvas forcing the row taller. */
    min-height: 0;
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
    border-radius: 100px;
    backdrop-filter: blur(4px);
  }
  .dims button {
    padding: 3px 11px;
    border: none;
    border-radius: 100px;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.72);
    cursor: pointer;
  }
  .dims button.on {
    background: var(--accent);
    color: #fff;
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
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .group-by,
  .chips,
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .seg {
    margin: 0.5rem 0;
  }
  .group-by button,
  .chips button,
  .seg button {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.25rem 0.55rem;
    border: 1px solid var(--divider);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .group-by button.on,
  .chips button.on,
  .seg button.on {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }
  .q {
    width: 100%;
    font-size: var(--fs-body);
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--fs-body-sm);
    padding: 0.15rem 0;
    cursor: pointer;
  }
  .hint {
    color: var(--text-secondary);
    font-size: var(--fs-label);
    line-height: 1.5;
    margin: 0.5rem 0 0;
  }
  .clusters {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 260px;
    overflow-y: auto;
  }
  .clusters button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.2rem 0.1rem;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    text-align: left;
  }
  .clusters button.on {
    color: var(--accent-ink);
  }
  .swatch {
    width: 9px;
    height: 9px;
    flex: none;
    border-radius: 2px;
    background: hsl(calc(var(--i) * 47deg) 45% 52%);
  }
  .cl {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cn {
    color: var(--text-secondary);
    opacity: 0.7;
  }
  .clear {
    margin-top: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    background: none;
    border: 1px solid var(--divider);
    color: var(--text-secondary);
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }
  .stats {
    display: grid;
    gap: 0.25rem;
    margin: 0;
  }
  .stats > div {
    display: flex;
    justify-content: space-between;
    font-size: var(--fs-label);
  }
  .stats dt {
    color: var(--text-secondary);
  }
  .stats dd {
    margin: 0;
    font-family: var(--font-mono);
  }
  .detail h2 {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    word-break: break-all;
    margin: 0 0 0.6rem;
  }
  .detail h3 { font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--text-secondary); margin: 0.9rem 0 0.3rem; }
  .recs { list-style: none; padding: 0; margin: 0; font-size: var(--fs-label); }
  .recs li { padding: 0.15rem 0; border-top: 1px solid var(--divider); word-break: break-word; }
  .recs code { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .ek { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary);
        border: 1px solid var(--divider); padding: 0 0.25rem; margin-right: 0.25rem; }
  .err { color: var(--error); font-size: var(--fs-label); }
  .ask {
    display: inline-block;
    margin-top: 0.8rem;
    font-size: var(--fs-label);
    color: var(--accent-ink);
  }
  .loading,
  .graph-error {
    display: grid;
    place-content: center;
    height: 100%;
    text-align: center;
    color: var(--text-secondary);
    font-size: var(--fs-body-sm);
    padding: 2rem;
  }
  .ge-head {
    color: var(--error);
    margin: 0 0 0.3rem;
  }
  .ge-detail {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin: 0 0 0.8rem;
  }
  .ge-retry {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.3rem 0.8rem;
    border: 1px solid var(--accent-ink);
    background: var(--accent-ink);
    color: var(--bg);
    cursor: pointer;
  }
  .stale-warn {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 4;
    margin: 0;
    padding: 0.3rem 0.6rem;
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    color: var(--error);
    font-size: var(--fs-label-xs);
    font-family: var(--font-mono);
  }
  @media (max-width: 1200px) {
    .explorer {
      grid-template-columns: minmax(0, 1fr);
      height: auto;
    }
    .canvas {
      height: 62vh;
      min-height: 420px;
    }
    .rail,
    .detail {
      max-height: 40vh;
    }
  }
</style>
