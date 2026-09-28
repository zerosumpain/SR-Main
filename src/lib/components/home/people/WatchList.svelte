<script lang="ts">
  /**
   * What looks different from each person's own routine right now — a missed
   * departure, a journey running long, hours of silence away from home. Every
   * item needs a dependable routine AND a fresh reading that contradicts it,
   * so a quiet list means nothing looks off, not that nothing was checked.
   * `notify` (owner only) is a slot for the per-kind phone alert switches.
   */
  import type { Snippet } from 'svelte';
  import type { WatchItem } from '$lib/home/presence/forecast';

  let { items, pending = false, notify }: { items: WatchItem[]; pending?: boolean; notify?: Snippet } = $props();
</script>

{#if pending}
  <p class="wl-quiet">Comparing today with everyone's routines…</p>
{:else if !items.length}
  <p class="wl-quiet">Nothing looks off. Everyone who has a routine for now is where it says, and every phone away from home has reported recently.</p>
{:else}
  <ul class="wl">
    {#each items as w (w.key)}
      <li data-severity={w.severity}>
        <span class="wl-mark" aria-hidden="true"></span>
        <div>
          <strong>{w.title}</strong>
          <small>{w.detail}</small>
        </div>
        <span class="wl-kind">{w.kind === 'overdue' ? 'Not left' : w.kind === 'running-long' ? 'Long trip' : 'Quiet'}</span>
      </li>
    {/each}
  </ul>
{/if}
{@render notify?.()}

<style>
  .wl {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: grid;
    grid-template-columns: 4px minmax(0, 1fr) auto;
    gap: 4px 12px;
    padding: 11px 0;
    border-top: 1px solid var(--line);
  }
  .wl-mark {
    align-self: stretch;
    border-radius: 1px;
    background: var(--warn);
  }
  li[data-severity='alert'] .wl-mark {
    background: var(--error, #c44);
  }
  strong {
    font-size: var(--fs-nav);
  }
  small {
    display: block;
    margin-top: 2px;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .wl-kind {
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .wl-quiet {
    color: var(--text-muted);
    font-size: var(--fs-body-sm);
    max-width: 60ch;
  }
</style>
