<script lang="ts">
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import type { PageData } from './$types';
  /**
   * One person's movement — /home/people/[subject]. The frame only for now:
   * the load decides who may open it (the owner anyone, a household viewer
   * only themselves), and the journeys, pace and common trips arrive with the
   * stats work.
   */
  let { data }: { data: PageData } = $props();
</script>

<HomeFrame
  path="/home/people/{data.subject}"
  kicker="Home · People"
  title={[data.displayName, 'on the move']}
  standfirst="Journeys, walking pace and the trips that repeat, read off this person's own trail."
  footer={['strangeramblings.com/home/people', 'One person’s trail · seen by them and the owner only']}
>
  <section class="band">
    <div class="inner">
      <p class="lede">Nothing to show yet. The figures for {data.displayName} are on their way.</p>
    </div>
  </section>
</HomeFrame>
