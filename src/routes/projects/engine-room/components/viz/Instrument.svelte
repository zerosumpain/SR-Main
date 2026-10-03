<script lang="ts">
  // Instrument — the frame every operable visual on this study sits in.
  //
  // The consistency device. A reader should be able to land on any page and know instantly
  // where the thing to operate is, what it is showing, and what they were meant to notice.
  // Order is deliberate: label, controls, the visual, then at most one sentence of payoff.
  // The caption goes UNDER the instrument — if it goes above, people read instead of touch.
  //
  // It takes its colours from the band it sits on, so the same instrument reads on ink or on
  // paper. Instruments are control surfaces, so no serif here (the field-study rule).
  import type { Snippet } from 'svelte';
  import { app } from '../../lib/appState.svelte';
  import { reveal } from '../../lib/motion';

  interface Props {
    kicker?: string;
    title: string;
    /** One line naming what is plotted. Not an argument — an axis label in prose. */
    reading?: string;
    /** Same line for the plain-English register (the default). Falls back to `reading`. */
    readingEli5?: string;
    /** The payoff, under forty words. Optional: a good instrument often needs none. */
    takeaway?: string;
    /** Same payoff for the plain-English register (the default). Falls back to `takeaway`. */
    takeawayEli5?: string;
    /** A colour override for this one frame. Normally the page's part colour is right. */
    tone?: string;
    /** Controls render top-right, always above the visual so they are found first. */
    controls?: Snippet;
    children: Snippet;
    /** Let the visual bleed to the frame edge (maps, matrices). */
    flush?: boolean;
    /** No frame: for an instrument that is the whole band. */
    bare?: boolean;
  }
  let { kicker, title, reading, readingEli5, takeaway, takeawayEli5, tone, controls, children, flush = false, bare = false }: Props = $props();

  const eli = $derived(app.narrative === 'eli5');
  const readingText = $derived(eli && readingEli5 ? readingEli5 : reading);
  const takeawayText = $derived(eli && takeawayEli5 ? takeawayEli5 : takeaway);
</script>

<figure class="inst" class:bare style={tone ? `--tone:${tone};--tone-text:${tone}` : ''} {@attach reveal({ y: 24 })}>
  <div class="i-head">
    <div class="i-id">
      {#if kicker}<span class="i-kick">{kicker}</span>{/if}
      <h3 class="i-title">{title}</h3>
    </div>
    {#if controls}<div class="i-ctl">{@render controls()}</div>{/if}
  </div>

  {#if readingText}<p class="i-read">{readingText}</p>{/if}

  <div class="i-body" class:flush>{@render children()}</div>

  {#if takeawayText}
    <figcaption class="i-take"><span class="t-mark" aria-hidden="true"></span>{takeawayText}</figcaption>
  {/if}
</figure>

<style>
  .inst { margin: 0 0 24px; padding: clamp(18px, 2vw, 28px); border: 1px solid var(--rule); border-top: 3px solid var(--tone);
    border-radius: 0; background: var(--wash); }
  .inst.bare { padding: 0; border: none; background: none; }
  .i-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 18px; flex-wrap: wrap; }
  .i-id { min-width: 0; }
  .i-kick { display: block; font-family: var(--er-mono); font-size: var(--fs-label-xs); letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--tone-text); margin-bottom: 6px; }
  .i-title { font-family: var(--er-display); font-weight: 400; text-transform: uppercase; font-size: clamp(19px, 1.8vw, 24px);
    line-height: 1.05; margin: 0; color: var(--fg); letter-spacing: -0.005em; }
  .i-ctl { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }

  .i-read { margin: 10px 0 0; font-size: var(--fs-label); line-height: 1.55; color: var(--fg-3); max-width: 80ch; }

  .i-body { margin-top: 18px; min-width: 0; }
  .i-body.flush { margin-left: calc(-1 * clamp(18px, 2vw, 28px)); margin-right: calc(-1 * clamp(18px, 2vw, 28px)); }

  .i-take { display: flex; gap: 12px; margin: 18px 0 0; padding-top: 14px; border-top: 1px solid var(--rule);
    font-size: var(--fs-body-sm); line-height: 1.6; color: var(--fg-2); }
  .t-mark { flex-shrink: 0; width: 14px; height: 2px; margin-top: 0.75em; background: var(--tone-text); }
  .i-take :global(b) { color: var(--fg); }

  /* Shared control styles: a segmented switch and chips, used by most instruments. */
  .inst :global(.seg) { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 2px; border: 1px solid var(--rule); border-radius: var(--radius-sharp); }
  .inst :global(.seg button) { background: transparent; border: none; padding: 6px 11px; border-radius: var(--radius-sharp);
    font-family: var(--er-mono); font-size: var(--fs-label-xs); cursor: pointer; color: var(--fg-2); transition: background 0.2s, color 0.2s; }
  .inst :global(.seg button:hover) { color: var(--fg); background: var(--wash); }
  .inst :global(.seg button.on) { background: var(--tone); color: #fff; }
  .inst :global([data-surface='ink'] .seg button.on), :global([data-surface='ink']) .inst :global(.seg button.on) { color: var(--er-ink); background: var(--tone-text); }
</style>
