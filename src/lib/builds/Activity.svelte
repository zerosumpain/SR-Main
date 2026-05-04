<script lang="ts">
  import IterationCard from './IterationCard.svelte';
  import type { FeedState } from './feed';

  let { feed }: { feed: FeedState } = $props();
</script>

<div class="activity">
  {#if feed.iterations.length === 0}
    <section class="nm-sec">
      <p class="dim">Waiting for activity…</p>
    </section>
  {:else}
    {#each feed.iterations as it, idx (it.id)}
      <!-- The last iteration in feed.iterations is the most recent / active
           one. Past iterations collapse to a 1-line summary by default. -->
      <IterationCard iter={it} isActive={idx === feed.iterations.length - 1} />
    {/each}
  {/if}
</div>

<style>
  .activity {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 0;
  }
</style>
