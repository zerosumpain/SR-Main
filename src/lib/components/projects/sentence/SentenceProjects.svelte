<svelte:options css="injected" />

<script lang="ts">
  import type { ProjectsViewProps } from '$lib/projects/views';
  let { hand, agent, showAgent, counts, owner, dateline, controls, switcher }: ProjectsViewProps = $props();
</script>

<section>
  {@render switcher()}
  <h1>Things I've built (sentence)</h1>
  <p>{counts.bench} {owner} {dateline} {showAgent}</p>
  <ul>
    {#each [...hand, ...agent] as e (e.key)}<li><a href={e.href}>{e.title}</a> {@render controls(e)}</li>{/each}
  </ul>
</section>
