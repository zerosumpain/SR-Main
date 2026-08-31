<script lang="ts">
  // One chip row: a fixed mono label on the left, then the facets.
  //
  // Every control on this hub that groups, filters or orders is one of these,
  // because the three read identically to a user — "which of these am I
  // looking at" — and giving each its own widget is how the old page ended up
  // with pill buttons in one section, a `<select>` in another and a plain
  // link list in a third.
  //
  // Chip shape copied from `SegmentLedger` on /health: 0 radius, mono, 1px
  // rule, and the selected one INVERTS to ink-on-cream rather than tinting.

  import type { Facet } from './types';

  interface Props {
    /** `ARRANGE`, `SHOW`, `ORDER`, `WHOSE`. */
    label: string;
    facets: Facet[];
    active: string;
    onpick: (id: string) => void;
  }

  let { label, facets, active, onpick }: Props = $props();
</script>

<div class="fb">
  <p class="fb-label">{label}</p>
  <div class="fb-chips">
    {#each facets as f (f.id)}
      <button
        type="button"
        class="fb-chip"
        class:on={active === f.id}
        aria-pressed={active === f.id}
        onclick={() => onpick(f.id)}
      >
        {f.label}{#if f.count != null}<span class="fb-n">{f.count}</span>{/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .fb {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .fb-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    width: 72px;
    flex-shrink: 0;
    margin: 0;
  }
  .fb-chips {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .fb-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 6px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition:
      background-color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      color var(--t-fast) var(--ease-out);
  }
  .fb-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .fb-chip.on {
    font-weight: 500;
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .fb-chip.on:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .fb-chip:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .fb-n {
    color: var(--text-muted);
    margin-left: 7px;
  }
  .fb-chip.on .fb-n {
    color: inherit;
    opacity: 0.6;
  }

  @media (max-width: 560px) {
    .fb-label {
      width: auto;
    }
  }
</style>
