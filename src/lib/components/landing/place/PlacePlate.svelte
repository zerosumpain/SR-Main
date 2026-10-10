<svelte:options css="injected" />

<script lang="ts">
  // The place's one plate (HeroPlace): the dateline, then whichever label is
  // open explained with its link, else the key, then the lamp's caption and
  // "hold still". HeroPlace decides what is shown; this only sets it.
  import type { NoteId } from '$lib/landing/sentence';
  import type { Plate } from '$lib/landing/place-copy';
  import { scenery } from '$lib/landing/ramblers/scenery';

  let {
    dateline,
    shown,
    note,
    caption,
    stirs,
    held = $bindable(),
    onlinkkey,
  }: {
    dateline: string;
    /** The label being explained, if any, and its plate. */
    shown: NoteId | null;
    note: Plate | null;
    /** What the beacon is doing, in words. */
    caption: string;
    /** Something moves, so "hold still" is offered. */
    stirs: boolean;
    held: boolean;
    /** Tab from the link carries on to the next label. */
    onlinkkey: (e: KeyboardEvent) => void;
  } = $props();
</script>

<!-- One plate explains whichever label is open. A fixed size, so opening
     one never moves the picture (or the floors the rambler is on). -->
<div class="pl-plate" id="pl-plate">
  <!-- The plate's top never moves, whatever it says: a floor between the title and the shore. -->
  <p class="pl-date" use:scenery>{dateline}</p>
  <div class="pl-say" aria-live="polite">
    {#if shown && note}
      {@const n = note}
      <p class="pl-head" data-tone={shown === 'daydream' || shown === 'releases' ? 'ink' : 'accent'}>{n.head}</p>
      <p class="pl-text">{n.text}</p>
      <a class="pl-link" href={n.href} onkeydown={onlinkkey}>{n.cta} <span aria-hidden="true">→</span></a>
    {:else}
      <p class="pl-text pl-key">Left to right is then to now. Each label lights up its part of the picture.</p>
    {/if}
  </div>
  <p class="pl-cap">
    <span>{caption}</span>
    {#if stirs}
      <button type="button" class="pl-hold" aria-pressed={held} onclick={() => (held = !held)}>
        <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          {#if held}<path d="M2 1 L9 5 L2 9 Z" />{:else}<path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" />{/if}
        </svg>
        hold still
      </button>
    {/if}
  </p>
</div>

<style>
  /* On a desktop the plate hangs in the sky over the start of the ridge; it
     takes no room of its own, so it may grow with its text. */
  .pl-plate {
    grid-area: world;
    align-self: start;
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: var(--plate-w);
    margin-top: 10px;
    padding: 2px 0 0 16px;
    border-left: 1px solid rgba(var(--type), 0.24);
  }
  .pl-date,
  .pl-head {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .pl-head {
    letter-spacing: 0.08em;
  }
  .pl-head[data-tone='ink'] {
    color: var(--accent-ink-on-dark);
  }
  .pl-text {
    margin: 2px 0 0;
    font-size: 15px;
    line-height: 1.45;
    color: rgba(var(--type), 0.86);
    text-wrap: pretty;
  }
  .pl-key {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    line-height: 1.4;
    color: rgba(var(--type), 0.82);
  }
  .pl-link {
    position: relative;
    display: inline-block;
    margin-top: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    text-decoration: none;
  }
  .pl-link::after {
    content: '';
    position: absolute;
    inset: -12px -10px;
  }
  .pl-link:hover {
    text-decoration: underline;
  }
  .pl-link:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .pl-cap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 14px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.06em;
    color: rgba(var(--type), 0.72);
  }
  .pl-hold {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    color: rgba(var(--type), 0.86);
    cursor: pointer;
  }
  .pl-hold::after {
    content: '';
    position: absolute;
    inset: -10px -8px;
  }
  .pl-hold:hover,
  .pl-hold[aria-pressed='true'] {
    color: var(--accent-on-dark);
  }
  .pl-hold:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .pl-hold svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }

  @media (max-width: 1099px) {
    .pl-text {
      font-size: 14px;
    }
    .pl-key {
      font-size: 16px;
    }
  }
  /* A phone: under the picture, at a fixed height (--plate-h), so opening a
     label never moves the hero's lower edge or anything under it. */
  @media (max-width: 759px) {
    .pl-plate {
      /* Under the picture, on the ground, which is dark at every hour. */
      --type: 237, 228, 212;
      --accent-on-dark: #e8863a;
      --accent-ink-on-dark: #7fb8c0;
      grid-area: plate;
      width: auto;
      height: var(--plate-h);
      margin-top: 8px;
    }
    .pl-date {
      letter-spacing: 0.06em;
    }
    .pl-text {
      font-size: 13px;
      line-height: 1.4;
    }
    .pl-cap {
      line-height: 1.45;
    }
    .pl-key {
      font-size: 16px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pl-hold {
      display: none;
    }
  }
  /* Print: the dateline stays; the explanations print in HeroPlace's list. */
  @media print {
    .pl-say,
    .pl-cap {
      display: none;
    }
    .pl-plate {
      grid-area: plate;
      width: auto;
      height: auto;
      border: 0;
      padding: 0;
      margin-top: 12px;
    }
    .pl-date {
      color: #1a1008;
    }
  }
</style>
