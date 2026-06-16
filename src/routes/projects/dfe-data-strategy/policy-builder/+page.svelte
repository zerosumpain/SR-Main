<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import PolicyBuilder from '../components/PolicyBuilder.svelte';
  const eli = $derived(app.narrative === 'eli5');
</script>

<svelte:head>
  <title>Policy Builder — Keystone</title>
  <meta name="description" content="Write headline policies for a DfE data strategy in plain English; an LLM weighs each against the pressures, the strategy landscape, the legal stack and the Policy Engine, surfacing pros, cons, tensions, trade-offs and the stakeholders affected." />
</svelte:head>

<div class="pe-route pb-route">
  <span class="pe-eyebrow">Workbench · Policy Builder</span>
  <h1 class="pe-h1">Write a policy. See what it really means.</h1>
  <p class="pe-lede intro">
    {#if eli}
      Type a factor you think the data strategy should include, in plain English. The model reads everything this tool knows — the pressures, the strategies that matter, the law, and the Policy Engine — and tells you the upsides, the downsides, the clashes, and who it affects.
    {:else}
      State a headline policy for the data strategy in plain English. The <b>consideration builder</b> reviews all the strategic material referenced here — the pressures, the influence map, the legal stack, the maturity model and the sector’s voices — together with the <a href="/projects/policy-engine">Policy Engine’s</a> data conclusions, and returns a structured, grounded appraisal: pros, cons, tensions, trade-offs, the stakeholders impacted and interested, and the things to weigh — each linked back to the evidence.
    {/if}
  </p>

  <PolicyBuilder />

  <p class="note">The model is grounded in this project’s material; treat its appraisal as a structured prompt for judgement, not a verdict. Your policies are saved only in this browser.</p>
</div>

<style>
  .pb-route { max-width: 1000px; }
  .intro { max-width: 76ch; margin-bottom: 18px; }
  .note { margin-top: 20px; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.5); max-width: 76ch; }
</style>
