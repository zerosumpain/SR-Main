<script lang="ts">
  // Instrument — the frame every visual on this study sits in.
  //
  // The consistency device. A reader should be able to land on any page and know instantly
  // where the thing to operate is, what it is showing, and what they were meant to notice.
  // Order is deliberate: label, controls, the visual, then at most one sentence of payoff.
  // The caption goes UNDER the instrument — if it goes above, people read instead of touch.
  import type { Snippet } from 'svelte';

  interface Props {
    kicker?: string;
    title: string;
    /** One line naming what is plotted. Not an argument — an axis label in prose. */
    reading?: string;
    /** The payoff, under 40 words. Optional: a good instrument often needs none. */
    takeaway?: string;
    tone?: string;
    /** Controls render top-right, always above the visual so they are found first. */
    controls?: Snippet;
    children: Snippet;
    /** Let the visual bleed to the frame edge (maps, matrices). */
    flush?: boolean;
  }
  let { kicker, title, reading, takeaway, tone, controls, children, flush = false }: Props = $props();
</script>

<figure class="inst" style={tone ? `--tone:${tone}` : ''}>
  <div class="i-head">
    <div class="i-id">
      {#if kicker}<span class="i-kick">{kicker}</span>{/if}
      <h3 class="i-title">{title}</h3>
    </div>
    {#if controls}<div class="i-ctl">{@render controls()}</div>{/if}
  </div>

  {#if reading}<p class="i-read">{reading}</p>{/if}

  <div class="i-body" class:flush>{@render children()}</div>

  {#if takeaway}
    <figcaption class="i-take"><span class="t-mark" aria-hidden="true">▸</span>{takeaway}</figcaption>
  {/if}
</figure>

<style>
  .inst {
    --tone: var(--accent-ink);
    margin: 0 0 22px; padding: 14px 16px 13px;
    border: 1px solid rgba(28,22,17,0.16); border-top: 2px solid var(--tone);
    border-radius: var(--radius-round); background: rgba(255,255,255,0.5);
  }
  .i-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px 16px; flex-wrap: wrap; }
  .i-id { min-width: 0; }
  .i-kick { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--tone); margin-bottom: 3px; }
  .i-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; line-height: 1.2;
    margin: 0; color: var(--text-primary); letter-spacing: -0.01em; }
  .i-ctl { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }

  .i-read { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.6); max-width: 78ch; }

  .i-body { margin-top: 12px; min-width: 0; }
  .i-body.flush { margin-left: -16px; margin-right: -16px; }

  .i-take { display: flex; gap: 7px; margin: 12px 0 0; padding-top: 10px;
    border-top: 1px dashed rgba(28,22,17,0.18); font-size: 13px; line-height: 1.55;
    color: rgba(28,22,17,0.78); max-width: 84ch; }
  .t-mark { color: var(--tone); flex-shrink: 0; }
  .i-take :global(b) { color: var(--text-primary); }

  @media (max-width: 620px) {
    .inst { padding: 12px 12px 11px; }
    .i-body.flush { margin-left: -12px; margin-right: -12px; }
  }
</style>
