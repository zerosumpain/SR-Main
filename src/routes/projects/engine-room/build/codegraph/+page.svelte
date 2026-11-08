<script lang="ts">
  // Codegraph — the build's memory. Edge kinds, verdict weights and query caps are read from
  // src/lib/codegraph by the layout load; the lesson count is live.
  //
  // Bands: live figures on ink with the graph you can pull about, the ranking on paper, and
  // the query budget on deep paper.
  import LeafHead from '../../components/LeafHead.svelte';
  import PageFoot from '../../components/PageFoot.svelte';
  import Band from '../../components/kit/Band.svelte';
  import Masthead from '../../components/kit/Masthead.svelte';
  import Bars from '../../components/viz/Bars.svelte';
  import Stat from '../../components/viz/Stat.svelte';
  import MemoryGraph from '../../components/art/build/MemoryGraph.svelte';
  import { BUILD_COPY as C, EDGE_COPY, CODEGRAPH_EXTRA as X } from '../../lib/build';
  import { app } from '../../lib/appState.svelte';

  let { data } = $props();
  const g = $derived(data.facts.build.codegraph);
  const gates = $derived(data.facts.build.gates.filter((x) => x !== 'cmd' && x !== 'gate'));
  const lessons = $derived(data.live.build?.lessons ?? null);
  const eli = $derived(app.narrative === 'eli5');
  const t = (x: { plain: string; eng: string }) => (eli ? x.plain : x.eng);

  let edge = $state<string | null>(null);
  const share = $derived(g.maxBudget > 0 ? g.defaultBudget / g.maxBudget : 0);
</script>

<svelte:head><title>Codegraph — Build — The Engine Room</title></svelte:head>

<LeafHead part="build" title="Codegraph" line={C.codegraph.line.eng} lineEli5={C.codegraph.line.plain} />

<Band surface="ink" part="build">
  <div class="stats">
    <Stat value={lessons} label="lessons it can hand the next build right now" lead />
    <Stat value={g.edgeKinds.length} label="kinds of link between things" />
    <Stat value={g.maxHops} label="hops a question may walk" />
    <Stat value={g.maxLimit} label="answers per question, at most" />
  </div>
  <div class="graph">
    <Masthead kicker="The graph" lines={['Pull its memory', '*about*']} strap={t(X.graph)} size="md" />
    <MemoryGraph kinds={g.edgeKinds} edgeCopy={EDGE_COPY} nodeCopy={X.nodes} {gates} selected={edge} onselect={(k) => (edge = k)} />
  </div>
</Band>

<Band surface="paper" part="build">
  <div class="split">
    <Masthead kicker="Ranking" lines={['A lesson is', 'worth what it *did*']} strap={t(C.codegraph.ranking)} size="md" />
    <div>
      <p class="reading">The multiplier a lesson gets from the verdict of the build it came from. A lesson from a verified build counts in full.</p>
      <Bars grouped={false} max={1} items={g.verdicts.filter((v) => v.weight != null).map((v) => ({ label: v.id, value: v.weight as number }))} />
    </div>
  </div>
</Band>

<Band surface="deep" part="build">
  <Masthead kicker="Asking it" lines={['Every answer', 'is cut to *size*']} strap={t(X.budget)} />
  <div class="budget" role="img" aria-label="A default answer gets {g.defaultBudget} characters, out of a ceiling of {g.maxBudget}.">
    <div class="b-track"><span class="b-def" style="width:{share * 100}%"></span></div>
    <div class="b-key">
      <span><i class="k-def"></i>by default</span><span><i class="k-max"></i>the ceiling</span>
    </div>
  </div>
  <div class="stats">
    <Stat value={g.defaultBudget} label="characters an answer gets by default" />
    <Stat value={g.maxBudget} label="characters at most, however it asks" />
    <Stat value={g.evidenceMaturity} label="settled uses before ranking trusts outcomes over recency" />
  </div>
</Band>

<PageFoot />

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 18px 24px; }
  .graph { margin-top: clamp(40px, 5vw, 72px); }
  .split { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: clamp(24px, 4vw, 64px); align-items: start; }
  .reading { margin: 0 0 18px; font-size: var(--fs-label); color: var(--fg-3); }
  .budget { margin-bottom: 32px; }
  .b-track { position: relative; height: 34px; border: 2px solid var(--fg); background: repeating-linear-gradient(90deg, var(--rule) 0 2px, transparent 2px 12px); }
  .b-def { position: absolute; inset: 0 auto 0 0; background: var(--tone); }
  .b-key { display: flex; gap: 22px; margin-top: 10px; font-family: var(--er-mono); font-size: var(--fs-label-xs); color: var(--fg-3); }
  .b-key i { display: inline-block; width: 12px; height: 12px; margin-right: 8px; vertical-align: -1px; }
  .k-def { background: var(--tone); }
  .k-max { border: 2px solid var(--fg); }
  @media (max-width: 860px) { .split { grid-template-columns: minmax(0, 1fr); } }
</style>
