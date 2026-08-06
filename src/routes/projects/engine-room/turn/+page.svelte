<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { MANIFEST, TTFT_TOTAL, WATERFALL } from '../lib/tools';

  const siteMs = WATERFALL.filter((s) => s.kind === 'site').reduce((a, s) => a + s.ms, 0);
</script>

<svelte:head>
  <title>Part I — A turn · The Engine Room</title>
  <meta name="description" content="What happens when you type: how a message is assembled, routed to a model, paid for and streamed back." />
</svelte:head>

<section class="pe-route wide">
  <PartHub part="turn">
    <div class="row">
      <Stat lead value={(TTFT_TOTAL / 1000).toFixed(1)} unit="s" label="before the first character appears"
            how="measured, submit to first visible token" />
      <Stat value={siteMs} unit="ms" label="of that is this site's own code"
            how="routing + POST + stream open, from the same trace" />
      <Stat value={MANIFEST.medianPrompt} label="tokens in a median prompt"
            how="median prompt size across recorded turns" tone="var(--accent)" />
    </div>
  </PartHub>
  <PageFoot />
</section>

<style>
  .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
</style>
