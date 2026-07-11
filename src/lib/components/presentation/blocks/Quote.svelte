<script lang="ts">
  // Pull quote — data-spine .quote shape at slide scale: accent-ink left
  // border, Fraunces italic, mono attribution.
  import type { QuoteBlock } from '$lib/presentation/types';

  let { block }: { block: QuoteBlock } = $props();
</script>

<blockquote class="q">
  <span class="q-rail" aria-hidden="true"></span>
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
    padding: 6px 0 6px clamp(18px, 2.5vw, 30px);
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
    font-size: clamp(22px, 3.4vw, 40px);
    line-height: 1.3;
    letter-spacing: -0.01em;
    color: var(--ink);
    margin: 0;
  }
  .q-attr {
    margin-top: 14px;
    font-family: 'JetBrains Mono', monospace;
    font-size: clamp(10px, 1.2vw, 12px);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .q-attr a { color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
