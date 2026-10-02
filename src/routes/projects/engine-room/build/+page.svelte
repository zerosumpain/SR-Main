<script lang="ts">
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Instrument from '../components/viz/Instrument.svelte';
  import StackBar from '../components/viz/StackBar.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import { LANE_COPY } from '../lib/build';
  import { num } from '../lib/format';
  import type { DevelopmentLane } from '$lib/builds/development-progress';

  let { data } = $props();
  const b = $derived(data.live.build);
  const lanes = $derived(
    (Object.keys(LANE_COPY) as DevelopmentLane[]).map((id) => ({ label: LANE_COPY[id], value: b?.lanes[id] ?? 0 })),
  );
</script>

<svelte:head><title>Build — The Engine Room</title></svelte:head>

<section class="pe-route">
  <PartHub part="build">
    <Instrument
      kicker="Live"
      title="Every delivery, by where it’s got to"
      reading="Features I’ve asked the site to build, grouped the way the develop page groups them. Counts only."
    >
      {#if b}
        <div class="stats">
          <Stat value={num(b.deliveries)} label="deliveries asked for" lead />
          <Stat value={num(b.lanes.shipped ?? 0)} label="shipped" />
          <Stat value={num(b.lessons)} label="lessons in the build’s memory" />
        </div>
        {#if b.deliveries > 0}<StackBar segments={lanes.filter((l) => l.value > 0)} />{/if}
      {:else}
        <p class="pe-prose">The live counts aren’t available right now.</p>
      {/if}
    </Instrument>
  </PartHub>
  <PageFoot />
</section>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; margin-bottom: 14px; }
</style>
