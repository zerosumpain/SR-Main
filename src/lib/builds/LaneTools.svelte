<script lang="ts">
  import ToolPill from './ToolPill.svelte';
  import type { ToolEntry } from './feed';

  let { tools }: { tools: ToolEntry[] } = $props();
</script>

<div class="lane-tools">
  {#each tools as t (t.id)}
    <ToolPill tool={t} />
  {/each}
</div>

<style>
  .lane-tools {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin: 0.5rem 0;
  }
</style>
