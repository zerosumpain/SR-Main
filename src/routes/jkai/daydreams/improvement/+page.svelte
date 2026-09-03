<script lang="ts">
  // Is the loop closing? Two dashboards showed a great deal about the
  // self-improvement engine — runs, phases, budget, generated code — and
  // neither showed whether anything it built was ever used. On the day the
  // merge started: 33 tools shipped in a fortnight, none ever called.
  import type { PageData } from './$types';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import LoopScoreboard from '$lib/components/jkai/daydream/LoopScoreboard.svelte';
  import ImprovementPanel from '$lib/components/jkai/daydream/ImprovementPanel.svelte';

  let { data }: { data: PageData } = $props();
</script>

<section class="band">
  <div class="inner">
    <SectionHead
      kicker="A / Is the loop closing?"
      title={['What it built,', 'and what it used']}
      strap="Two dashboards showed everything about the self-improvement engine except whether a single thing it built was ever called. On the day this merged: 33 tools shipped, none used."
    />
    <LoopScoreboard health={data.loop} verdict={data.loopVerdict} />
    {#if data.improvement}
      <div class="ledger">
        <ImprovementPanel data={data.improvement} embedded />
      </div>
    {:else}
      <div class="card t-urgent"><p class="card-body">The improvement ledger could not be read.</p></div>
    {/if}
  </div>
</section>

<style>
  .ledger {
    margin-top: clamp(28px, 4vw, 56px);
    padding-top: clamp(24px, 3vw, 40px);
    border-top: 2px solid var(--text-primary);
  }
</style>
