<script lang="ts">
  // Codegraph — the build's memory. Edge kinds, verdict weights and query caps are read from
  // src/lib/codegraph by the layout load; the lesson count is live.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Instrument from '../../components/viz/Instrument.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import { BUILD_COPY as C, EDGE_COPY } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';
  import { num, words } from '../../lib/format';
  import type { EDGE_KINDS } from '$lib/codegraph/query';

  let { data } = $props();
  const g = $derived(data.facts.build.codegraph);
  const lessons = $derived(data.live.build?.lessons ?? null);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  let edge = $state<string | null>(null);
</script>

<svelte:head><title>Codegraph — Build — The Engine Room</title></svelte:head>

<section class="pe-route">
  <LeafHead part="build" title="Codegraph" line={C.codegraph.line.eng} lineEli5={C.codegraph.line.plain} />

  <div class="stats">
    <Stat value={num(lessons)} label="lessons it can serve right now" lead />
    <Stat value={g.edgeKinds.length} label="kinds of link between things" />
    <Stat value={g.maxHops} label="hops a query may walk" />
    <Stat value={g.maxLimit} label="results per query, at most" />
  </div>

  <Instrument kicker="The graph" title="How things are linked" reading="Every kind of edge the graph stores. Select one.">
    <div class="edges">
      {#each g.edgeKinds as k (k)}
        <button class="edge" class:on={edge === k} onclick={() => (edge = edge === k ? null : k)}><code>{k}</code></button>
      {/each}
    </div>
    <p class="explain">{edge ? `${words(edge)}: ${EDGE_COPY[edge as (typeof EDGE_KINDS)[number]]}.` : 'Files, the checks that guard them, past build episodes and the lessons drawn from them, all joined by these.'}</p>
  </Instrument>

  <Instrument
    kicker="Ranking"
    title="How much a past build’s outcome counts"
    reading="The multiplier a lesson gets from the verdict of the build it came from. A lesson from a verified build counts in full."
    takeaway={t(C.codegraph.ranking)}
  >
    <Bars
      grouped={false}
      items={g.verdicts.filter((v) => v.weight != null).map((v) => ({ label: v.id, value: v.weight as number }))}
    />
  </Instrument>

  <Instrument kicker="Asking it" title="The query budget" reading="A build can query the graph, but every query is capped so one can’t eat the context window.">
    <div class="stats">
      <Stat value={g.defaultBudget.toLocaleString('en-GB')} label="characters a result gets by default" />
      <Stat value={g.maxBudget.toLocaleString('en-GB')} label="characters at most" />
      <Stat value={g.evidenceMaturity} label="resolved serves before ranking trusts outcomes over recency" />
    </div>
  </Instrument>

  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 0 0 18px; }
  .edges { display: flex; flex-wrap: wrap; gap: 6px; }
  .edge { padding: 5px 10px; border-radius: var(--radius-sharp); border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.6); cursor: pointer; }
  .edge.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }
  .edge code { font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .explain { margin: 12px 0 0; font-size: var(--fs-body-sm); line-height: 1.55; color: rgba(28,22,17,0.8); }
</style>
