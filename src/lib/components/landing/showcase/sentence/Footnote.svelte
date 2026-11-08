<svelte:options css="injected" />

<script lang="ts">
  // One footnote of the sentence showcase: the paper sibling of the hero's
  // HeroNote. It sits inside the paragraph, after the sentence whose word
  // opened it, so it is the next thing a screen reader reads; closed it is
  // display:none and its link leaves the tab order. Everything is a <span>
  // because it lives in a <p>. Print opens every one.
  //
  // Colours come from the chapter (--fg, --fg2, --fg3, --hair and the tone),
  // so the same card reads on the paper and in the app chapter's ink band.
  import type { Note, Tone } from '$lib/landing/showcase-sentence';
  import Visual from './Visual.svelte';

  let { id, n, open, tone, note }: { id: string; n: number; open: boolean; tone: Tone; note: Note } = $props();

  let v = $derived(note.visual);
</script>

<span class="ss-fn" class:ss-open={open} {id} role="note" aria-label="Footnote {n}" data-tone={tone}>
  <span class="ss-card">
    <span class="ss-head">{n} · {note.head}</span>
    <span class="ss-grid" class:ss-solo={v.kind === 'none'}>
      <span class="ss-copy">
        <span class="ss-text">{note.text}</span>
        {#if note.href}<a class="ss-more" href={note.href}>{note.cta} <span aria-hidden="true">→</span></a>{/if}
      </span>
      {#if v.kind !== 'none'}<span class="ss-pic"><Visual visual={v} /></span>{/if}
    </span>
  </span>
</span>

<style>
  .ss-fn {
    --tone: var(--t-accent, var(--accent-hover));
    display: block;
    margin: 0.4em 0 0.7em;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    font-weight: 400;
    font-style: normal;
    line-height: 1.55;
    letter-spacing: 0;
    white-space: normal;
    color: var(--fg2);
  }
  .ss-fn[data-tone='ink'] {
    --tone: var(--t-ink, var(--accent-ink));
  }
  .ss-fn:not(.ss-open) {
    display: none;
  }
  /* Inline in the paragraph, so it grows with its contents: no inner
     scrolling region a keyboard couldn't reach. */
  .ss-card {
    display: block;
    padding: 12px 0 10px 18px;
    border-left: 2px solid var(--tone);
    animation: ss-fn-in var(--t-slow, 360ms) var(--ease-out, ease-out) both;
  }
  @keyframes ss-fn-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  .ss-head,
  .ss-more {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .ss-head {
    display: block;
    margin-bottom: 8px;
    color: var(--tone);
  }
  .ss-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: 8px 32px;
    align-items: start;
  }
  .ss-grid.ss-solo {
    grid-template-columns: minmax(0, 1fr);
    max-width: 40em;
  }
  .ss-copy,
  .ss-text,
  .ss-pic {
    display: block;
  }
  .ss-pic {
    min-width: 0;
  }
  .ss-more {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    color: var(--fg);
    text-decoration: none;
  }
  .ss-more:hover {
    color: var(--tone);
  }
  .ss-more:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
  }

  @media (max-width: 760px) {
    .ss-card {
      padding-left: 14px;
    }
    .ss-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .ss-pic {
      order: -1;
      padding: 2px 0 6px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ss-card {
      animation: none;
    }
  }
  @media print {
    .ss-fn,
    .ss-fn:not(.ss-open) {
      display: block;
      color: #1a1008;
      break-inside: avoid;
    }
    .ss-card {
      animation: none;
      border-left-color: #1a1008;
    }
    .ss-head,
    .ss-more {
      color: #1a1008;
    }
  }
</style>
