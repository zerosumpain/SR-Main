<svelte:options css="injected" />

<script lang="ts">
  // A run of the essay's prose: plain text, value words and their footnotes,
  // laid out by layoutRun so each card follows the sentence that opened it.
  // A value word with a note is a real button set as type (dotted underline,
  // a mono note number after it); one with a link is a link; one with neither
  // is just the figure in its tone. Rendered inside the chapter's <p>, so the
  // markup below is kept on tight lines: whitespace here is whitespace in
  // the sentence.
  import { layoutRun, type Seg } from '$lib/landing/showcase-sentence';
  import Footnote from './Footnote.svelte';

  let { segs, open, ontoggle }: { segs: Seg[]; open: string | null; ontoggle: (id: string) => void } = $props();

  let pieces = $derived(layoutRun(segs));
</script>

{#each pieces as p, i (i)}{#if p.t === 'text'}{p.s}{:else if p.t === 'note'}<Footnote
      id="ss-fn-{p.id}"
      n={p.n}
      open={open === p.id}
      tone={p.tone}
      note={p.note}
    />{:else if p.note}<span class="ss-nb"
      ><button
        type="button"
        class="ss-w"
        data-tone={p.tone}
        aria-expanded={open === p.id}
        aria-controls="ss-fn-{p.id}"
        onclick={() => ontoggle(p.id)}
        >{#if p.spoken}<span aria-hidden="true">{p.word}</span><span class="ss-vh">{p.spoken}</span>{:else}{p.word}{/if}</button
      >{p.end ?? ''}<sup aria-hidden="true">{p.n}</sup></span
    >{:else if p.href}<a class="ss-w ss-link" data-tone={p.tone} href={p.href}>{p.word}</a>{:else}<span
      class="ss-w ss-plain"
      data-tone={p.tone}>{p.word}</span
    >{/if}{/each}

<style>
  .ss-nb {
    white-space: nowrap;
  }
  .ss-w {
    --tone: var(--t-accent, var(--accent-hover));
    position: relative;
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-family: var(--font-display);
    font-weight: 800;
    font-style: normal;
    font-size: max(0.88em, var(--fs-label-xs));
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--tone);
    -webkit-tap-highlight-color: transparent;
  }
  .ss-w[data-tone='ink'] {
    --tone: var(--t-ink, var(--accent-ink));
  }
  button.ss-w,
  a.ss-w {
    cursor: pointer;
    text-decoration: underline dotted;
    text-decoration-thickness: 0.06em;
    text-underline-offset: 0.18em;
    text-decoration-color: color-mix(in srgb, var(--tone) 60%, transparent);
  }
  a.ss-w {
    text-decoration-style: solid;
    text-decoration-thickness: 0.05em;
  }
  /* An invisible hit area at least 44px each way round the word. WCAG 2.5.8
     exempts inline targets, but the page holds every target to 44px; where
     the line is shorter than that it reaches a little into the lines above
     and below. */
  button.ss-w::after,
  a.ss-w::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: max(100% + 8px, 44px);
    height: max(44px, calc(var(--prose-lh, 1.42) * 1em / 0.88 - 4px));
    transform: translate(-50%, -50%);
  }
  button.ss-w:hover,
  button.ss-w[aria-expanded='true'],
  a.ss-w:hover {
    text-decoration-style: solid;
    text-decoration-color: var(--tone);
  }
  .ss-w:focus-visible {
    outline: 2px solid var(--tone);
    outline-offset: 4px;
    border-radius: 2px;
  }
  .ss-nb > sup {
    display: inline-block;
    margin-left: 0.14em;
    font-family: var(--font-mono);
    font-weight: 500;
    font-style: normal;
    font-size: var(--fs-label-xs);
    letter-spacing: 0;
    line-height: 1;
    /* Raised by a share of the prose's size, not the numeral's, so it sits at
       cap height on a phone as on a desktop, clear of the line above. */
    vertical-align: calc(var(--prose, 20px) * 0.3);
    color: var(--fg3);
  }
  .ss-vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  @media print {
    .ss-w,
    .ss-nb > sup {
      color: #1a1008;
      text-decoration-color: currentColor;
    }
  }
</style>
