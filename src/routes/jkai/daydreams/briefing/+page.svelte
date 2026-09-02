<script lang="ts">
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import BriefingPanel from '$lib/components/jkai/daydream/BriefingPanel.svelte';

  let { data }: { data: PageData } = $props();
</script>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / What matters today"
      title={['The morning', 'briefing']}
      strap="The scheduled digest lives beside the observations that feed it: source-traced, gap-aware, and ready to rerun without leaving the background-intelligence workspace."
    />
    {#if data.briefing}
      <BriefingPanel data={data.briefing} embedded />
    {:else}
      <div class="card t-urgent"><p class="card-body">The briefing ledger could not be read.</p></div>
    {/if}
  </div>
</section>
