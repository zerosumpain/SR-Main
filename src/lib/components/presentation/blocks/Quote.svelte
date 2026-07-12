<script lang="ts">
  // Pull quote, three registers picked by `style`: rail (default — data-spine
  // .quote shape: accent-ink left rail, Fraunces italic, mono attribution),
  // pull (huge centered under an ornamental mark — the quote IS the page),
  // boxed (inset bordered card with a large opening glyph — a documentary
  // aside beside other content).
  import type { QuoteBlock } from '$lib/presentation/types';

  let { block }: { block: QuoteBlock } = $props();
  const style = $derived(block.style ?? 'rail');
</script>

<blockquote class="q" class:q-pull={style === 'pull'} class:q-boxed={style === 'boxed'}>
  {#if style === 'rail'}
    <span class="q-rail" aria-hidden="true"></span>
  {:else if style === 'pull'}
    <span class="q-mark" aria-hidden="true">“</span>
  {:else}
    <span class="q-glyph" aria-hidden="true">“</span>
  {/if}
  <p class="q-text">“{block.text}”</p>
  {#if block.attribution}
    <footer class="q-attr">
      {#if block.url}
        <a href={block.url} target="_blank" rel="noopener">{block.attribution} ↗</a>
      {:else}
        {block.attribution}
      {/if}
    </footer>
  {/if}
</blockquote>

<style>
  .q {
    position: relative;
    margin: 0;
    padding: 6px 0 6px 30px;
    max-width: 44ch;
  }
  .q-rail {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: var(--accent-ink);
    transform-origin: top;
  }
  @media (prefers-reduced-motion: no-preference) {
    .q-rail { animation: q-rail-grow 700ms cubic-bezier(0.33, 1, 0.68, 1) both; }
  }
  @keyframes q-rail-grow {
    from { transform: scaleY(0); }
    to { transform: scaleY(1); }
  }
  .q-text {
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-weight: 500;
    font-size: 40px;
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .q-attr {
    margin-top: 14px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .q-attr a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  /* pull — huge centered, no rail: the quote IS the page */
  .q.q-pull {
    padding: 0;
    max-width: 24ch;
    text-align: center;
  }
  .q.q-pull .q-mark {
    display: block;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 115px;
    line-height: 0.55;
    color: var(--accent);
    margin-bottom: 14.5px;
  }
  .q.q-pull .q-text {
    font-size: 58px;
    line-height: 1.2;
  }
  .q.q-pull .q-attr { margin-top: 18.5px; }

  /* boxed — inset bordered card with a large opening glyph */
  .q.q-boxed {
    padding: 30px 30px 24px 77px;
    border: 1px solid rgba(28, 22, 17, 0.18);
    border-radius: var(--radius-round, 4px);
    background: rgba(255, 255, 255, 0.45);
  }
  .q.q-boxed .q-glyph {
    position: absolute;
    left: 20px;
    top: 12px;
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 71.5px;
    line-height: 1;
    color: var(--accent);
  }
  .q.q-boxed .q-text { font-size: 26px; }
  .q.q-boxed .q-attr { text-align: right; }
</style>
