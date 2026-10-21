<script lang="ts">
  // Two proposals side by side, on one card: a row per thing either says,
  // and only the rows where they differ are inked in (the rest are pencil
  // grey and marked "same"). Each column can be used from here.
  import { compareRows } from '$lib/trips/decisions-view';
  import type { Proposal } from '$lib/trips/decisions';
  import type { DecisionDesk } from '$lib/trips/decisions-desk.svelte';

  let { a, b, desk, onClose }: { a: Proposal; b: Proposal; desk: DecisionDesk; onClose: () => void } = $props();

  const rows = $derived(compareRows(a, b));
  const differing = $derived(rows.filter((r) => r.differs).length);
  let el = $state<HTMLElement | null>(null);
  $effect(() => {
    // Bring the comparison into view and give it focus when it opens (once per pair).
    void a.id;
    void b.id;
    el?.focus();
  });
</script>

<section class="cmp np-card np-card--plain" aria-label="Comparing {a.title} and {b.title}" tabindex="-1" bind:this={el}>
  <header class="cmp-hd">
    <p class="dx-k">Side by side</p>
    <p class="dx-aside">{differing ? `${differing} thing${differing === 1 ? '' : 's'} differ — inked in below.` : 'They come out the same.'}</p>
    <button class="dx-link" type="button" onclick={onClose}>Close</button>
  </header>
  <div class="cmp-grid" role="table" aria-label="Differences">
    <div class="cmp-row head" role="row">
      <span class="cmp-label" role="columnheader"><span class="dx-vh">What</span></span>
      <span class="cmp-cell" role="columnheader">{a.title}</span>
      <span class="cmp-cell" role="columnheader">{b.title}</span>
    </div>
    {#each rows.filter((r) => r.key !== 'what') as r (r.key)}
      <div class="cmp-row" class:differs={r.differs} role="row">
        <span class="cmp-label" role="rowheader">{r.label}{#if !r.differs}<span class="same"> · same</span>{/if}</span>
        <span class="cmp-cell" role="cell">{r.a}</span>
        <span class="cmp-cell" role="cell">{r.b}</span>
      </div>
    {/each}
    <div class="cmp-row acts" role="row">
      <span class="cmp-label" role="cell"></span>
      <span class="cmp-cell" role="cell"><button class="dx-btn small" type="button" disabled={!!desk.busy} onclick={() => desk.accept(a)}>Use this</button></span>
      <span class="cmp-cell" role="cell"><button class="dx-btn small" type="button" disabled={!!desk.busy} onclick={() => desk.accept(b)}>Use this</button></span>
    </div>
  </div>
</section>

<style>
  .cmp {
    --np-tilt: 0deg;
    padding: 12px 14px;
    border-color: var(--accent-ink);
  }
  .cmp:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .cmp-hd {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--np-margin-a);
  }
  .cmp-hd .dx-link {
    margin-left: auto;
  }
  .cmp-row {
    display: grid;
    grid-template-columns: minmax(6rem, 0.8fr) minmax(0, 1fr) minmax(0, 1fr);
    gap: 4px 10px;
    padding: 5px 0;
    border-bottom: 1px dashed var(--line-strong);
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-ghost);
  }
  .cmp-row.head {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    color: var(--np-ink);
  }
  .cmp-row.differs {
    color: var(--np-ink);
  }
  .cmp-row.differs .cmp-cell {
    background: linear-gradient(transparent 62%, var(--accent-tint-25) 62%);
  }
  .cmp-row.acts {
    border-bottom: 0;
  }
  .cmp-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--np-pen-ink);
  }
  .same {
    color: var(--text-ghost);
  }
  .cmp-cell {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* On a phone the label goes above its two values. */
  @media (max-width: 520px) {
    .cmp-row {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .cmp-label {
      grid-column: 1 / -1;
    }
    .cmp-row.head .cmp-label,
    .cmp-row.acts .cmp-label {
      display: none;
    }
  }
</style>
