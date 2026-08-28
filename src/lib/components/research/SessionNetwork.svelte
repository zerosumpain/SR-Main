<script lang="ts">
  /**
   * The session's entity network — the Intel graph, pointed at one research run.
   *
   * This renders `$lib/components/intel/NetworkGraph.svelte` directly rather
   * than reimplementing a force layout. That component already sizes nodes by
   * PageRank so one hub cannot flatten everything else into identical dots,
   * colours by detected community, draws cross-community edges in accent
   * because those are the interesting ones, and labels only what matters. The
   * dashboard's own graph did none of that, and there is no reason for this
   * codebase to hold two answers to the same question.
   *
   * The payload comes from `/api/research/<id>/network`, which runs the same
   * `pagerank` / `detectCommunities` / `brokerageScore` pass the intel endpoint
   * runs. Fetched on mount rather than in the page load: the analysis is
   * cheap but pointless for anyone who never scrolls to it, and a run still in
   * progress has nothing to draw yet.
   */
  import { onMount } from 'svelte';
  import NetworkGraph from '$lib/components/intel/NetworkGraph.svelte';
  import type { NetNode, NetEdge } from '$lib/codegraph/types';

  let {
    sessionId,
    onAsk,
  }: {
    sessionId: string;
    /** Hand a question about an entity to the Ask panel. */
    onAsk?: (question: string) => void;
  } = $props();

  interface Community {
    id: number;
    size: number;
    label: string;
  }
  interface Stats {
    totalNodes: number;
    totalEdges: number;
    shown: number;
    communities: number;
    modularity: number;
    isolated: number;
  }

  let nodes = $state<NetNode[]>([]);
  let edges = $state<NetEdge[]>([]);
  let communities = $state<Community[]>([]);
  let stats = $state<Stats | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let selectedId = $state<string | null>(null);
  let focusCommunities = $state<number[]>([]);
  let expanded = $state(false);

  const byId = $derived(new Map(nodes.map((n) => [n.id, n])));
  const selected = $derived(selectedId ? (byId.get(selectedId) ?? null) : null);

  /** Who the selected entity is joined to, strongest link first. */
  const neighbours = $derived.by(() => {
    if (!selectedId) return [] as { node: NetNode; label: string }[];
    const out: { node: NetNode; label: string }[] = [];
    for (const e of edges) {
      const otherId = e.source === selectedId ? e.target : e.target === selectedId ? e.source : null;
      if (!otherId) continue;
      const node = byId.get(otherId);
      if (node) out.push({ node, label: e.label ?? e.type });
    }
    return out.sort((a, b) => b.node.importance - a.node.importance);
  });

  onMount(async () => {
    try {
      const res = await fetch(`/api/research/${sessionId}/network`);
      if (!res.ok) throw new Error(`Network unavailable (${res.status})`);
      const body = await res.json();
      nodes = body.nodes ?? [];
      edges = body.edges ?? [];
      communities = body.communities ?? [];
      stats = body.stats ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load the network';
    } finally {
      loading = false;
    }
  });

  function toggleCommunity(id: number) {
    focusCommunities = focusCommunities.includes(id)
      ? focusCommunities.filter((c) => c !== id)
      : [...focusCommunities, id];
  }

  function askAbout(node: NetNode) {
    onAsk?.(
      `Tell me about ${node.name} in this research — who or what it is, why it sits where it does in the network, and what it connects.`,
    );
  }
</script>

<section class="nm-sec" id="network">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Entity network</span>
    {#if stats}
      <span class="nm-sec-meta">
        {stats.shown} of {stats.totalNodes} entities · {stats.totalEdges} links
        {#if stats.communities > 1}· {stats.communities} clusters, modularity {stats.modularity}{/if}
      </span>
    {/if}
    <button
      type="button"
      class="expand"
      onclick={() => (expanded = !expanded)}
      aria-pressed={expanded}
    >{expanded ? 'Shrink' : 'Expand'}</button>
  </div>

  {#if loading}
    <p class="note">Analysing the network…</p>
  {:else if error}
    <p class="note err">{error}</p>
  {:else if nodes.length === 0}
    <p class="note">This run produced no entities to draw.</p>
  {:else if edges.length === 0}
    <!-- Worth saying out loud rather than drawing a field of loose dots and
         letting the reader wonder what they did wrong. Runs from before the
         relationship-extraction fix genuinely have no edges. -->
    <p class="note">
      {nodes.length} entities, but no relationships were extracted — so there is no network to draw.
      Only the deepest tier extracts relationships.
    </p>
  {:else}
    {#if communities.length > 1}
      <div class="clusters">
        <span class="sr-label-tight">Clusters</span>
        {#each communities as c (c.id)}
          <button
            type="button"
            class="chip"
            class:on={focusCommunities.includes(c.id)}
            onclick={() => toggleCommunity(c.id)}
            title="Bring this cluster forward"
          >{c.label} <b>{c.size}</b></button>
        {/each}
        {#if focusCommunities.length}
          <button type="button" class="chip clear" onclick={() => (focusCommunities = [])}>Clear</button>
        {/if}
      </div>
    {/if}

    <div class="graph-frame" class:expanded>
      <NetworkGraph
        {nodes}
        {edges}
        {selectedId}
        {focusCommunities}
        onSelect={(id) => (selectedId = id)}
        onOpen={(id) => {
          const n = byId.get(id);
          if (n) askAbout(n);
        }}
      />
    </div>

    {#if selected}
      <div class="detail">
        <div class="detail-hd">
          <span class="ico" aria-hidden="true">{selected.icon}</span>
          <strong>{selected.name}</strong>
          <span class="detail-type">{selected.type}</span>
          <button type="button" class="close" onclick={() => (selectedId = null)} aria-label="Close">×</button>
        </div>
        {#if selected.summary}<p class="detail-sum">{selected.summary}</p>{/if}
        <div class="detail-meta">
          {selected.degree} {selected.degree === 1 ? 'link' : 'links'} ·
          centrality {Math.round(selected.importance * 100)}%
          {#if selected.brokerage > 0.02}· connects separate clusters{/if}
        </div>

        {#if neighbours.length}
          <div class="neighbours">
            {#each neighbours.slice(0, 12) as n (n.node.id)}
              <button type="button" class="nb" onclick={() => (selectedId = n.node.id)}>
                <span class="nb-rel">{n.label}</span>
                <span class="nb-name">{n.node.name}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if onAsk}
          <button type="button" class="ask-link" onclick={() => askAbout(selected!)}>
            Ask jkai about {selected.name} →
          </button>
        {/if}
      </div>
    {:else}
      <p class="hint">Click an entity to inspect it · double-click to ask jkai about it · scroll to zoom</p>
    {/if}
  {/if}
</section>

<style>
  /* .nm-sec, .nm-sec-hd, .sr-label-tight and .nm-sec-meta come from
     $lib/styles/nm-tokens.css (imported by the root layout). Not redefined
     here — that file is the source of truth and says so at the top. */
  .expand { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; background: none; border: 1px solid var(--line-strong); color: var(--text-muted); cursor: pointer; padding: 3px 8px; }
  .expand:hover { border-color: var(--accent); color: var(--accent); }

  .clusters { display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; margin-bottom: 0.6rem; }
  .chip { font-family: var(--font-mono); font-size: var(--fs-label-xs); border: 1px solid var(--line-strong); background: transparent; color: var(--text-secondary); padding: 2px 7px; cursor: pointer; }
  .chip:hover { border-color: var(--accent); color: var(--accent); }
  .chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-tint-14); }
  .chip b { color: var(--text-ghost); font-weight: 500; }
  .chip.clear { color: var(--text-ghost); }

  /* The graph fills a frame with an explicit height: NetworkGraph is height:100%
     and would collapse to its min-height in an auto-height parent. */
  .graph-frame { height: 440px; border: 1px solid var(--line-hair); transition: height 0.2s ease; }
  .graph-frame.expanded { height: 78vh; }

  .detail { margin-top: 0.6rem; border-top: 1px solid var(--line-hair); padding-top: 0.6rem; }
  .detail-hd { display: flex; align-items: baseline; gap: 0.5rem; }
  .ico { color: var(--accent); }
  .detail-type { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .close { margin-left: auto; background: none; border: none; color: var(--text-muted); font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0 4px; }
  .close:hover { color: var(--error); }
  .detail-sum { margin: 0.35rem 0 0; font-size: 0.9rem; line-height: 1.5; color: var(--text-secondary); }
  .detail-meta { margin-top: 0.3rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .neighbours { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.5rem; }
  .nb { display: inline-flex; align-items: baseline; gap: 0.35rem; border: 1px solid var(--line-strong); background: var(--bg); padding: 2px 7px; cursor: pointer; text-align: left; }
  .nb:hover { border-color: var(--accent); }
  .nb-rel { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); text-transform: lowercase; }
  .nb-name { font-size: 0.85rem; color: var(--text-primary); }

  .ask-link { display: inline-block; margin-top: 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; }
  .ask-link:hover { text-decoration: underline; }

  .note { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; }
  .note.err { color: var(--error); font-style: normal; }
  .hint { margin: 0.5rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
</style>
