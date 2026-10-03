<script lang="ts">
  // Build hub. The part's claim beside the crane, then the live board on ink: how many
  // features have been asked for, how many shipped, how many lessons it keeps, and every
  // delivery by the lane it has reached. Counts only, from live.server.ts.
  import PartHub from '../components/PartHub.svelte';
  import PageFoot from '../components/PageFoot.svelte';
  import Masthead from '../components/kit/Masthead.svelte';
  import StackBar from '../components/viz/StackBar.svelte';
  import Stat from '../components/viz/Stat.svelte';
  import BuildEmblem from '../components/art/build/BuildEmblem.svelte';
  import { LANE_COPY, BUILD_HUB_COPY } from '../lib/build';
  import { app } from '../lib/appState.svelte';
  import type { DevelopmentLane } from '$lib/builds/development-progress';

  let { data } = $props();
  const b = $derived(data.live.build);
  const eli = $derived(app.narrative === 'eli5');
  const lanes = $derived(
    (Object.keys(LANE_COPY) as DevelopmentLane[]).map((id) => ({ label: LANE_COPY[id], value: b?.lanes[id] ?? 0 })),
  );
</script>

<svelte:head><title>Build — The Engine Room</title></svelte:head>

<PartHub part="build">
  {#snippet art()}<BuildEmblem />{/snippet}
  <Masthead kicker="Live" lines={['Everything', 'it’s been *asked*', 'to build']} strap={eli ? BUILD_HUB_COPY.live.plain : BUILD_HUB_COPY.live.eng} />
  {#if b}
    <div class="stats">
      <Stat value={b.deliveries} label="features asked for" lead />
      <Stat value={b.lanes.shipped ?? 0} label="shipped as pull requests or deploys" />
      <Stat value={b.lessons} label="lessons in the build’s memory" />
    </div>
    {#if b.deliveries > 0}<div class="bar"><StackBar segments={lanes.filter((l) => l.value > 0)} height={56} /></div>{/if}
  {:else}
    <p class="none">The live counts aren’t available right now, so nothing is shown rather than a guess.</p>
  {/if}
</PartHub>
<PageFoot />

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px 28px; }
  .bar { margin-top: 36px; }
  .none { margin: 0; font-size: var(--fs-body); color: var(--fg-3); }
</style>
