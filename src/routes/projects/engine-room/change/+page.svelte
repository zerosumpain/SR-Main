<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { FORBIDDEN, PHASES } from '../lib/building';
  import { PIPELINE } from '../lib/shipping';
  import { RAILS } from '../lib/guardrails';

  const boundaries = RAILS.filter((r) => r.kind === 'boundary').length;
</script>

<svelte:head>
  <title>Part IV — Change · The Engine Room</title>
  <meta name="description" content="How the system rebuilds itself: the overnight improvement run, the gate that inspects what it wrote, the deploy pipeline, and the limits that hold." />
</svelte:head>

<section class="pe-route wide">
  <PartHub part="change">
    <div class="row">
      <Stat lead value={PHASES.length} label="phases in the overnight run" tone="#8a2d3a"
            how="stages of the nightly self-improvement job" />
      <Stat value={FORBIDDEN.length} label="patterns the gate refuses outright" tone="#8a2d3a"
            how="entries in the static deny-list" />
      <Stat value={PIPELINE.length} label="stages between a commit and production" tone="#8a2d3a"
            how="jobs in the deploy pipeline" />
      <Stat value="{boundaries} of {RAILS.length}" label="guardrails that hold regardless of intent" tone="#8a2d3a"
            how="rails classified as a boundary rather than a request" />
    </div>
  </PartHub>
  <PageFoot />
</section>

<style>
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
</style>
