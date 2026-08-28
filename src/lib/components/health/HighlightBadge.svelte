<script lang="ts">
  // One reason an outing was worth doing, rendered as a badge.
  //
  // Tone carries the scope rather than a colour key nobody reads: a segment
  // placing or an all-time activity record is the loud thing on the page and
  // takes the accent; "hottest ride of the year" and "third day running" are
  // context, not achievement, so they stay in muted ink. A rank of 1 is the
  // only thing allowed to fill.
  import type { Highlight } from '$lib/trails/highlights';

  let {
    highlight,
    size = 'md',
  }: { highlight: Highlight; size?: 'sm' | 'md' } = $props();

  const loud = $derived(highlight.scope === 'segment' || highlight.scope === 'activity');
  const best = $derived(highlight.rank === 1);
</script>

<span
  class="badge"
  class:sm={size === 'sm'}
  class:loud
  class:best
  title={highlight.detail || highlight.label}
>
  <span class="label">{highlight.label}</span>
  {#if highlight.detail}
    <span class="detail">{highlight.detail}</span>
  {/if}
</span>

<style>
  .badge {
    display: inline-flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    max-width: 100%;
    padding: 0.3rem 0.55rem;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--text-secondary);
  }

  .label {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: inherit;
    overflow-wrap: anywhere;
  }

  .detail {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  /* Segment placings and activity records: the accent, the site's only
     primary-action colour, because these are the ones worth stopping on. */
  .badge.loud {
    border-color: var(--accent);
    color: var(--accent);
  }

  /* Environment and rhythm stay muted — they are context, not a result. */
  .badge:not(.loud).best {
    border-color: var(--accent-ink);
    color: var(--accent-ink);
  }

  /* First place is the one thing that fills. */
  .badge.loud.best {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .badge.loud.best .detail {
    color: var(--bg);
    opacity: 0.85;
  }

  /* Table density: one clamped line of supporting text, the rest in the title. */
  .badge.sm {
    padding: 0.2rem 0.4rem;
    gap: 0.05rem;
  }
  .badge.sm .label {
    font-size: var(--fs-label-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge.sm .detail {
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
