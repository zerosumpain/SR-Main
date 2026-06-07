<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import RegionsPanel from '../components/RegionsPanel.svelte';
</script>

<svelte:head><title>Regions — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <span class="pe-eyebrow">Regions</span>
  <h1 class="pe-h1">Where the gap lives, and to whom</h1>
  <div class="pe-prose">
    {#if app.narrative === 'eli5'}
      <p>
        A single national average hides a lot. The gap between poorer and richer pupils is small in <b>London</b> but much bigger in
        places like the <b>South East</b> and the <b>North East</b>. The North East is the odd one out: its poorer kids do okay in
        primary school, then fall the furthest behind by sixteen.
      </p>
      <p>
        This page splits the country into its nine regions (the numbers still add back up to the national figure). It’s also where the
        government’s two new 2026 schemes — <b>Mission North East</b> and <b>Mission Coastal</b> (starting in Hastings and Scarborough) —
        try to help the worst-off areas. They’re real, but there’s no published budget and little proof that this kind of local spending
        closes gaps, so the model only gives them a small, slow effect. Click a region to view the whole site through its lens.
      </p>
    {:else}
      <p>
        A national average hides as much as it reveals. The disadvantage gap at GCSE runs from about <b>ten months in London</b> — the
        famous “London effect” — to <b>more than twenty in the South East and East Midlands</b>. The North East is the country’s sharpest
        puzzle: its disadvantaged children do relatively <i>well</i> at primary, then fall the furthest behind by sixteen — the lowest
        Attainment 8 of any region and the highest absence.
      </p>
      <p>
        This page decomposes the national model onto the nine English regions, calibrated to DfE Key-Stage-4 data and EPI’s regional
        gaps, and re-centred so the regions always weight back to the England figure. It is also where the two 2026 area missions earn
        their keep: <b>Mission North East</b> and <b>Mission Coastal</b> (Hastings and Scarborough) are real, London-Challenge-style
        programmes — though no budget has been published and the evidence that place-based money closes attainment gaps is weak, so their
        modelled effect is deliberately small, slow and concentrated on the regions that need it most. Click a region to filter the whole
        site to it.
      </p>
    {/if}
  </div>

  <div class="panel">
    {#if app.mounted}
      <RegionsPanel sim={app.sim.years} baseSim={app.baseSim.years} levers={app.levers} horizon={app.horizon}
        selected={app.region} onSelect={(c) => (app.region = c)} />
    {/if}
  </div>

  <a class="pe-next" href="/projects/policy-engine/method">How it all works → Method</a>
</div>

<style>.panel { margin: 18px 0 22px; }</style>
