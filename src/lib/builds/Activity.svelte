<script lang="ts">
  import IterationCard from './IterationCard.svelte';
  import type { FeedState } from './feed';

  let { feed }: { feed: FeedState } = $props();

  // Most-recent iteration is the LAST entry in feed.iterations. The user
  // wants the active iteration always visible at the top while history
  // scrolls below — so render it first (sticky-positioned via the
  // .iter-active wrapper) and then the rest in reverse order beneath.
  const active = $derived(feed.iterations[feed.iterations.length - 1] ?? null);
  const past = $derived(feed.iterations.slice(0, -1).slice().reverse());
</script>

<div class="activity">
  {#if !active}
    <section class="nm-sec">
      <p class="dim">Waiting for activity…</p>
    </section>
  {:else}
    <div class="iter-active">
      <IterationCard iter={active} isActive={true} />
    </div>
    {#if past.length > 0}
      <header class="hist-hdr">
        <span class="hist-label">History · {past.length} earlier iteration{past.length === 1 ? '' : 's'}</span>
      </header>
      <div class="iter-history">
        {#each past as it (it.id)}
          <IterationCard iter={it} isActive={false} />
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .activity {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  /* Sticky pin: the active iteration stays at the viewport top while the
     user scrolls through history below. `top` matches the sticky preview
     banner's height so they don't collide. */
  .iter-active {
    position: sticky;
    top: 64px;
    z-index: 10;
    background: var(--bg, #ede4d4);
    /* Border so the boundary between sticky pin and scrolling history
       is visible once the user has scrolled past. */
    border-bottom: 1px solid var(--card-border);
  }
  .hist-hdr {
    margin-top: 0.5rem;
    padding: 0.4rem 0;
    border-top: 1px dashed var(--card-border);
  }
  .hist-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .iter-history {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin: 0;
  }
</style>
