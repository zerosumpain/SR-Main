<script lang="ts">
  // Editorial text block — five preformatted registers selected by `style`:
  // body / lede (large opener) / band (the data-spine federation inverted
  // emphasis band — Fraunces, amber italics) / cards (each paragraph a
  // bordered card, bold opener as its title) / aside (small mono footnote).
  // Body is markdown-lite rendered through the escape-then-allowlist helper.
  import { renderProse } from '$lib/presentation/prose';
  import type { ProseBlock } from '$lib/presentation/types';

  let { block }: { block: ProseBlock } = $props();
  const style = $derived(block.style ?? (block.lede ? 'lede' : 'body'));
  const html = $derived(renderProse(block.body));
  // cards: one card per blank-line paragraph, rendered separately.
  const cardHtml = $derived(
    style === 'cards' ? block.body.split(/\n{2,}/).map((p) => renderProse(p)) : [],
  );
</script>

{#if style === 'cards'}
  <div class="prose-cards">
    {#each cardHtml as card, i (i)}
      <!-- eslint-disable-next-line svelte/no-at-html-tags — renderProse escapes first -->
      <div class="pcard">{@html card}</div>
    {/each}
  </div>
{:else if style === 'band'}
  <div class="prose-band">
    <!-- eslint-disable-next-line svelte/no-at-html-tags — renderProse escapes first -->
    <div class="band-inner">{@html html}</div>
  </div>
{:else}
  <div
    class="prose"
    class:lede={style === 'lede'}
    class:aside={style === 'aside'}
    class:pull={style === 'pull'}
    class:columns={style === 'columns'}
    class:callout={style === 'callout'}
    class:numbered={style === 'numbered'}
    class:ledger={style === 'ledger'}
    class:interview={style === 'interview'}
    class:manifesto={style === 'manifesto'}
    class:verse={style === 'verse'}
    class:checklist={style === 'checklist'}
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags — renderProse escapes first -->
    {@html html}
  </div>
{/if}

<style>
  .prose { max-width: 58ch; }
  .prose :global(p) {
    font-size: clamp(15px, 1.8vw, 19px);
    line-height: 1.65;
    color: var(--ink-soft);
    margin: 0 0 14px;
  }
  .prose :global(p:last-child) { margin-bottom: 0; }
  .prose.lede :global(p) {
    font-size: clamp(18px, 2.4vw, 26px);
    line-height: 1.5;
    color: var(--ink);
  }
  .prose.aside :global(p) {
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(10px, 1.2vw, 12.5px);
    letter-spacing: 0.05em;
    line-height: 1.7;
    color: var(--ink-soft);
  }
  .prose :global(b) { color: var(--ink); }
  .prose :global(a) { color: var(--accent-ink); }
  .prose :global(u) { text-decoration-color: var(--accent); text-underline-offset: 3px; }
  .prose :global(ul) {
    margin: 0 0 14px;
    padding-left: 1.2em;
    list-style: none;
  }
  .prose :global(li) {
    font-size: clamp(15px, 1.8vw, 19px);
    line-height: 1.6;
    color: var(--ink-soft);
    margin-bottom: 6px;
    position: relative;
  }
  .prose :global(li)::before {
    content: '—';
    position: absolute;
    left: -1.2em;
    color: var(--accent);
  }
  .prose.lede :global(li) { font-size: clamp(18px, 2.4vw, 26px); color: var(--ink); }

  /* pull — oversized italic pull-text between hairlines (not a quotation) */
  .prose.pull {
    max-width: 46ch;
    border-top: 1px solid var(--ink);
    border-bottom: 1px solid var(--ink);
    padding: clamp(14px, 2.4vh, 26px) 0;
  }
  .prose.pull :global(p) {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 500;
    font-size: clamp(21px, 2.9vw, 34px);
    line-height: 1.35;
    color: var(--ink);
  }

  /* columns — dense reference text flowed into two columns */
  .prose.columns {
    max-width: none;
    width: 100%;
    column-count: 2;
    column-gap: clamp(24px, 3vw, 44px);
    column-rule: 1px solid rgba(28, 22, 17, 0.14);
  }
  .prose.columns :global(p) { font-size: clamp(13px, 1.5vw, 16px); line-height: 1.62; }
  .prose.columns :global(li) { font-size: clamp(13px, 1.5vw, 16px); }

  /* callout — tinted petrol note box, bold opener as its title */
  .prose.callout {
    background: rgba(14, 91, 102, 0.08);
    border-left: 4px solid var(--accent-ink);
    border-radius: var(--radius-round, 4px);
    padding: clamp(14px, 1.9vw, 22px);
  }
  .prose.callout :global(p) { color: var(--ink-soft); }
  .prose.callout :global(b) {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(10px, 1.2vw, 12px);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-ink);
    margin-bottom: 6px;
  }
  /* numbered — editorial 01/02/03 sequence, one paragraph per step */
  .prose.numbered { max-width: 54ch; counter-reset: pn; }
  .prose.numbered :global(p) {
    counter-increment: pn;
    position: relative;
    padding-left: clamp(52px, 6vw, 76px);
    min-height: 44px;
    margin-bottom: clamp(14px, 2.2vh, 24px);
  }
  .prose.numbered :global(p)::before {
    content: counter(pn, decimal-leading-zero);
    position: absolute;
    left: 0;
    top: -2px;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    font-size: clamp(20px, 2.6vw, 30px);
    letter-spacing: -0.02em;
    color: var(--accent);
  }
  .prose.numbered :global(p > b:first-child) {
    display: block;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(17px, 2vw, 22px);
    margin-bottom: 2px;
  }

  /* ledger — spec-sheet rows: bold opener = left-column label. The label is
     absolutely positioned so any inline content in the value (links, italics)
     wraps cleanly in the right column. */
  .prose.ledger { max-width: 62ch; width: 100%; }
  .prose.ledger :global(p) {
    position: relative;
    padding: clamp(9px, 1.3vh, 14px) 0 clamp(9px, 1.3vh, 14px) clamp(130px, 32%, 220px);
    margin: 0;
    border-bottom: 1px solid rgba(28, 22, 17, 0.16);
    font-size: clamp(14px, 1.6vw, 17px);
    min-height: 1.4em;
  }
  .prose.ledger :global(p:first-child) { border-top: 1px solid var(--ink); }
  .prose.ledger :global(p > b:first-child) {
    position: absolute;
    left: 0;
    max-width: clamp(118px, 30%, 208px);
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    font-size: clamp(10px, 1.2vw, 12.5px);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }

  /* interview — Q&A exchange: bold opener = speaker eyebrow; odd paragraphs
     (the questions) render italic serif */
  .prose.interview { max-width: 58ch; }
  .prose.interview :global(p) { margin-bottom: clamp(14px, 2.2vh, 24px); }
  .prose.interview :global(p > b:first-child) {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    font-size: clamp(9.5px, 1.1vw, 11.5px);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 3px;
  }
  .prose.interview :global(p:nth-of-type(odd)) {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 500;
    font-size: clamp(16px, 2vw, 22px);
    line-height: 1.45;
    color: var(--ink);
  }
  .prose.interview :global(p:nth-of-type(odd) > b:first-child) { font-style: normal; }

  /* manifesto — a stack of shouted display lines, one paragraph per line.
     Fraunces 600 like the band, but on paper: the lighter creed. */
  .prose.manifesto { max-width: none; }
  .prose.manifesto :global(p) {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(28px, 4.6vw, 64px);
    line-height: 1.06;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0 0 clamp(8px, 1.4vh, 16px);
  }
  .prose.manifesto :global(em) { font-style: normal; color: var(--accent); }
  .prose.manifesto :global(b) { color: var(--accent-ink); }

  /* verse — centered lyric: italic serif, airy leading */
  .prose.verse { max-width: 48ch; text-align: center; }
  .prose.verse :global(p) {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 500;
    font-size: clamp(16px, 2.1vw, 23px);
    line-height: 1.85;
    color: var(--ink);
  }
  .prose.verse :global(em) { color: var(--accent-ink); }

  /* checklist — "- " lines become accent-ticked items */
  .prose.checklist :global(li)::before {
    content: '✓';
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    color: var(--success, #2d7a3a);
  }
  .prose.checklist :global(li) {
    margin-bottom: 10px;
    color: var(--ink);
  }

  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    color: var(--ink);
    line-height: 1.12;
    letter-spacing: -0.015em;
    margin: 0 0 12px;
  }
  .prose :global(h1) { font-size: clamp(30px, 4.4vw, 54px); }
  .prose :global(h2) { font-size: clamp(24px, 3.4vw, 40px); }
  .prose :global(h3) { font-size: clamp(20px, 2.6vw, 30px); }
  .prose :global(h4) {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    font-size: clamp(11px, 1.3vw, 13px);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-ink);
  }

  /* band — the federation "Refusal. Auditability." inverted emphasis band */
  .prose-band {
    width: 100%;
    background: var(--ink);
    border-radius: 2px;
    padding: clamp(28px, 6vh, 64px) clamp(20px, 4vw, 56px);
    box-sizing: border-box;
  }
  .band-inner { max-width: 1100px; margin: 0 auto; text-align: center; }
  .band-inner :global(p) {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(24px, 3.8vw, 52px);
    line-height: 1.16;
    letter-spacing: -0.02em;
    color: var(--paper);
    margin: 0;
  }
  .band-inner :global(em) { font-style: italic; color: #d9a05e; font-size: 0.62em; letter-spacing: 0; }
  .band-inner :global(b) { color: var(--paper); }

  /* cards — detail-dense paragraphs as bordered cards (data-spine .limit) */
  .prose-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
    gap: clamp(12px, 1.6vw, 18px);
    width: 100%;
  }
  .pcard {
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-left: 4px solid var(--accent-ink);
    border-radius: var(--radius-round, 4px);
    background: rgba(255, 255, 255, 0.45);
    padding: clamp(14px, 1.8vw, 22px);
    min-width: 0;
  }
  .pcard :global(p) {
    font-size: clamp(13px, 1.5vw, 16px);
    line-height: 1.6;
    color: var(--ink-soft);
    margin: 0;
  }
  .pcard :global(b) {
    display: block;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(16px, 1.9vw, 21px);
    color: var(--ink);
    margin-bottom: 6px;
  }
  .pcard :global(a) { color: var(--accent-ink); }
</style>
