<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import PopulationPanel from '../components/PopulationPanel.svelte';
</script>

<svelte:head><title>Population — Education Policy Modelling</title></svelte:head>

<div class="pe-route">
  <span class="pe-eyebrow">Population</span>
  <h1 class="pe-h1">Real children, not percentages</h1>
  <div class="pe-prose">
    <p>
      The model speaks in rates — a gap of so many months, a percentage reaching a standard. This page translates those rates into
      <b>headcounts of actual children and young people</b>, because a tenth of a percentage point on Attainment 8 is abstract, but
      “eighteen thousand more disadvantaged pupils leave school with a strong pass” is not.
    </p>
    <p>
      Every rate is multiplied by its <b>own</b> England population base — the disadvantage gap over a year-group of school leavers,
      child poverty over the 0–17 population, NEET over the 16–24 population — and the difference your package makes is measured
      against the status-quo (do-nothing) path. The synthetic-cohort funnel below tracks one notional year-group through the gates of
      school-readiness, secondary-readiness and a strong GCSE pass; the ledger and the “child-years averted” count the human scale of
      the change. If a region is selected in the bar above, the whole page rescales to that region’s share of each population.
    </p>
  </div>

  <div class="panel">
    {#if app.mounted}
      <PopulationPanel sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} scenarioName={app.scenarioName}
        compare={app.compareB && app.viewSimB ? { sim: app.viewSimB, name: app.compareB.name } : null}
        scale={app.scale} regionName={app.region === 'all' ? '' : app.regionName} />
    {/if}
  </div>

  <a class="pe-next" href="/projects/policy-engine/regions">Where & to whom → Regions</a>
</div>

<style>.panel { margin: 18px 0 22px; }</style>
