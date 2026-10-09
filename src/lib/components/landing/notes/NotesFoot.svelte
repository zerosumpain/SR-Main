<script lang="ts">
  // The foot of the notes sheet (HeroNotes): the caption with the pen's
  // tempo, then the switches, "hold still" and "fair copy". On a wide sheet
  // every note is also set here blind, stacked unseen under the caption, so
  // the foot is as deep as the longest note and an open one (which hangs
  // here) never moves the page or lies over the readings above it.
  import type { Plate } from '$lib/landing/notes';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import type { NoteId } from '$lib/landing/sentence';
  import NotePlate from './NotePlate.svelte';

  let {
    tempo,
    notes,
    hold,
    held = $bindable(),
    typed,
    onfair,
  }: {
    /** What the pen keeps time to, in words. */
    tempo: string;
    notes: Record<NoteId, Plate>;
    /** Something moves, so "hold still" is offered. */
    hold: boolean;
    held: boolean;
    /** The sheet is typed up. */
    typed: boolean;
    onfair: () => void;
  } = $props();
</script>

<div class="hn-foot">
  <div class="hn-say">
    <p class="hn-tempo">{tempo} · tap a note to read it</p>
    <div class="hn-blinds" aria-hidden="true">
      {#each Object.entries(notes) as [id, p] (id)}<NotePlate id={id as NoteId} {p} blind />{/each}
    </div>
  </div>
  <div class="hn-ctl">
    {#if hold}
      <button type="button" class="hn-ctl-b hn-hold" aria-pressed={held} onclick={() => (held = !held)}>
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          {#if held}<path d="M2 1 L9 5 L2 9 Z" />{:else}<path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" />{/if}
        </svg>
        hold still
      </button>
    {/if}
    <!-- The lowest ledge, a short drop above the hero's bottom edge. -->
    <button type="button" class="hn-ctl-b" aria-pressed={typed} onclick={onfair}><span use:scenery={{ text: true }}>fair copy</span></button>
  </div>
</div>

<style>
  .hn-foot {
    grid-area: foot;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 18px;
    min-height: 44px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.06em;
    color: var(--on-ink-55);
  }
  .hn-tempo {
    margin: 0;
  }
  /* The blind copies only ever measure, on the wide sheet. */
  .hn-blinds {
    display: none;
  }
  .hn-ctl {
    display: flex;
    gap: 22px;
  }
  .hn-ctl-b {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 44px;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    color: var(--on-ink-80);
    cursor: pointer;
  }
  .hn-ctl-b::after {
    content: '';
    position: absolute;
    inset: 0 -8px;
  }
  .hn-ctl-b:hover,
  .hn-ctl-b[aria-pressed='true'] {
    color: var(--accent-on-dark);
  }
  .hn-ctl-b:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 2px;
  }
  .hn-hold svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }

  @media (min-width: 761px) {
    /* The foot is as deep as the longest note: its blind copies are stacked
       unseen under the caption, so opening one never moves the page or lies
       over the readings above it. */
    .hn-foot {
      display: grid;
      grid-template-columns: minmax(0, 1fr) var(--ctl);
      align-items: end;
      gap: 0;
      min-height: 50px;
      margin-top: 2px;
    }
    .hn-say,
    .hn-blinds {
      display: grid;
    }
    .hn-say > *,
    .hn-blinds > :global(*) {
      grid-area: 1 / 1;
    }
    .hn-blinds {
      visibility: hidden;
    }
    .hn-tempo {
      align-self: end;
      padding-bottom: 12px;
    }
    .hn-ctl {
      justify-content: flex-end;
    }
    :global(.hn[data-open]) .hn-tempo {
      visibility: hidden;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .hn-hold {
      display: none;
    }
  }
  @media print {
    .hn-foot {
      display: none;
    }
  }
</style>
