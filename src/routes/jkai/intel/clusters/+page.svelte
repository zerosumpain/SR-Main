<script lang="ts">
  // Every cluster the graph is tracking, as cards.
  //
  // The rail on the explorer answers "which cluster is this dot in". This page
  // answers the question the rail has no room for: what does my knowledge
  // actually divide into, and which parts of it are worth anything.
  //
  // Ordered by SIGNAL, not size — how many kinds of source corroborate a
  // cluster, which is what separates a subject from a feed. Size alone puts
  // four retail-mailshot clusters above both clusters carrying real work.

  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import ClusterMap from '$lib/components/intel/ClusterMap.svelte';
  import { clusterColour } from '$lib/components/intel/graph-visual';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let recalculating = $state(false);
  let error = $state<string | null>(null);
  let showMap = $state(true);
  /**
   * The roster a recalculation returned, if one has been run.
   *
   * Held apart from `data` rather than copied over it: copying a prop into
   * $state captures its first value for good, so a later navigation or
   * invalidation would refresh the server data and leave this page showing the
   * old. The override wins only while it exists.
   */
  let recalculated = $state<typeof data | null>(null);

  const roster = $derived(recalculated ?? data);
  const clusters = $derived(roster.clusters);

  async function recalculate() {
    if (recalculating) return;
    recalculating = true;
    error = null;
    try {
      const res = await fetch('/api/jkai/intel/clusters', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'recalculate' }),
      });
      if (!res.ok) throw new Error(`recalculation came back ${res.status}`);
      recalculated = await res.json();
    } catch (err) {
      error = err instanceof Error ? err.message : 'recalculation failed';
    } finally {
      recalculating = false;
    }
  }

  const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
</script>

<JkaiPageTitle title="CLUSTERS" titleHref="/jkai/intel" />

<div class="wrap">
  <header class="page-hdr">
    <p class="kicker">Intelligence graph</p>
    <h1>Clusters</h1>
    <p class="sub">
      The graph divides itself into {roster.stats.tracked} neighbourhoods worth naming, covering
      {clusters.reduce((s, c) => s + c.size, 0).toLocaleString()} of
      {roster.stats.totalEntities.toLocaleString()} entities. Ranked by how many kinds of source
      corroborate them.
    </p>
    <div class="hdr-actions">
      <button type="button" class="nm-save-btn" disabled={recalculating} onclick={recalculate}>
        {recalculating ? 'Recalculating…' : 'Recalculate'}
      </button>
      <a class="back-link" href="/jkai/intel">← Explorer</a>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
  </header>

  <section class="stats">
    <div class="stat">
      <span class="n">{roster.stats.tracked}</span><span class="l">Clusters</span>
    </div>
    <div class="stat">
      <span class="n">{roster.resolution}</span><span class="l">Resolution</span>
    </div>
    <div class="stat">
      <span class="n">{roster.stats.modularity}</span><span class="l">Modularity</span>
    </div>
    <div class="stat">
      <span class="n">{roster.stats.isolated.toLocaleString()}</span><span class="l">Unconnected</span>
    </div>
  </section>

  <!-- The only view that shows the whole graph. The entity views ship the 600
       most central nodes of nine thousand; one bubble per cluster does not have
       to leave anything out. -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <h2 class="sr-label-tight">The map</h2>
      <button type="button" class="row-link" onclick={() => (showMap = !showMap)}>
        {showMap ? 'hide' : 'show'}
      </button>
    </div>
    {#if showMap}
      <ClusterMap graph={roster.clusterGraph} onSelect={(key) => goto(`/jkai/intel/clusters/${key}`)} />
      <p class="note">
        Each bubble is a cluster, sized by entities; a line means relationships cross between them,
        thicker where more do. Click one to open it.
      </p>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd"><h2 class="sr-label-tight">All clusters</h2></div>
    <div class="grid">
      {#each clusters as c (c.key)}
        <a class="tile" href="/jkai/intel/clusters/{c.key}" style="--cl: {clusterColour(c.colourIndex)}">
          <div class="t-hd">
            <span class="dot" aria-hidden="true"></span>
            <span class="t-name">{c.label}</span>
            {#if c.name}<span class="mine" title="You named this">named</span>{/if}
          </div>
          <p class="t-meta">
            {c.size} entities · {c.composition.noteTotal} notes · diversity
            {c.composition.diversity.toFixed(2)}
          </p>
          <div class="bar" aria-hidden="true">
            {#each c.composition.sources as [name, n] (name)}
              <span
                data-src={name}
                style="width: {pct(n, c.composition.sources.reduce((s, [, v]) => s + v, 0))}%"
              ></span>
            {/each}
          </div>
          <p class="t-src">
            {c.composition.sources.map(([s, n]) => `${s} ${n}`).join(' · ') || 'no evidence'}
          </p>
          {#if c.narrative}
            <p class="t-narr">{c.narrative.replace(/^#+ .*$/gm, '').replace(/\[\d+\]/g, '').trim().slice(0, 150)}…</p>
          {/if}
          {#if c.nameDrifted}
            <p class="t-drift">Drifted from what you named</p>
          {/if}
        </a>
      {/each}
    </div>
  </section>

  {#if roster.stats.isolated > 0 || roster.stats.untracked > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd"><h2 class="sr-label-tight">What is not here</h2></div>
      <p class="note">
        {roster.stats.isolated.toLocaleString()} entities are connected to nothing at all and cannot be
        clustered at any resolution — that is a data-quality question, not a clustering one, and
        <a href="/jkai/intel/quality">Quality</a> owns it. A further
        {roster.stats.untracked.toLocaleString()} sit in fragments of fewer than five, too small to
        describe.
      </p>
    </section>
  {/if}
</div>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px 20px 64px;
  }

  .page-hdr {
    padding-bottom: 16px;
    border-bottom: 2px solid var(--text-primary);
    margin-bottom: 22px;
  }
  .kicker {
    margin: 0 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  h1 {
    margin: 0 0 8px;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 4vw, 2.6rem);
    line-height: 1.05;
    color: var(--text-primary);
  }
  .sub {
    margin: 0;
    max-width: 62ch;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .hdr-actions {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 12px;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    text-decoration: none;
  }
  .back-link:hover {
    color: var(--accent);
  }
  .err {
    margin: 10px 0 0;
    font-size: var(--fs-label);
    color: var(--error);
  }

  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 26px;
    margin-bottom: 24px;
  }
  .stat {
    display: flex;
    flex-direction: column;
  }
  .stat .n {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    color: var(--text-primary);
  }
  .stat .l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }

  .nm-sec {
    margin-bottom: 28px;
  }
  .nm-sec-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 8px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--divider);
  }
  .sr-label-tight {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .row-link {
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
    cursor: pointer;
  }
  .nm-save-btn {
    padding: 7px 16px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    color: var(--bg);
    cursor: pointer;
  }
  .nm-save-btn:disabled {
    background: none;
    color: var(--text-ghost);
    border-color: var(--card-border);
    cursor: default;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
    gap: 12px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 11px 12px 13px;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--cl);
    border-radius: var(--radius-sharp);
    text-decoration: none;
    background: var(--card-bg);
  }
  .tile:hover {
    background: var(--accent-tint-08);
  }
  .t-hd {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: var(--radius-round);
    background: var(--cl);
  }
  .t-name {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-body-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mine {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    color: var(--accent);
  }
  .t-meta,
  .t-src {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .t-narr {
    margin: 0;
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-secondary);
  }
  .t-drift {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--warn);
  }

  .bar {
    display: flex;
    height: 5px;
    overflow: hidden;
    border-radius: var(--radius-sharp);
    background: var(--divider);
  }
  .bar span {
    height: 100%;
  }
  [data-src='email'] {
    background: var(--accent);
  }
  [data-src='chat'] {
    background: var(--accent-ink);
  }
  [data-src='file'] {
    background: var(--success);
  }
  [data-src='research'] {
    background: var(--warn);
  }
  [data-src='web'] {
    background: var(--text-muted);
  }
  [data-src='whatsapp'] {
    background: var(--accent-hover);
  }
  [data-src='workflow'] {
    background: var(--text-ghost);
  }

  .note {
    margin: 8px 0 0;
    max-width: 70ch;
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-secondary);
  }
  .note a {
    color: var(--accent);
  }
</style>
