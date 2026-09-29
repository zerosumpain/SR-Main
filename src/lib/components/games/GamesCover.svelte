<script lang="ts">
  // The ink cover band /games and a table open with — the /decks lede: mono
  // eyebrow, two-line Archivo Black headline (second line outlined), a
  // standfirst, and a count deck of hairline cells on the right.
  import type { Snippet } from 'svelte';
  import ThemeToggle from './ThemeToggle.svelte';

  interface Props {
    eyebrow: string;
    title: [string, string];
    standfirst?: string | null;
    deck?: { label: string; value: string; note?: string }[];
    night: boolean;
    onnight: (night: boolean) => void;
    children?: Snippet;
  }

  let { eyebrow, title, standfirst = null, deck = [], night, onnight, children }: Props = $props();
</script>

<section class="cover">
  <div class="cover-inner">
    <div class="copy">
      <div class="eyebrow-row">
        <p class="eyebrow">{eyebrow}</p>
        <ThemeToggle {night} onchange={onnight} />
      </div>
      <h1>{title[0]}<br /><span>{title[1]}</span></h1>
      {#if standfirst}<p class="standfirst">{standfirst}</p>{/if}
      {#if children}{@render children()}{/if}
    </div>
    {#if deck.length}
      <dl class="deck" style="--cells: {deck.length}">
        {#each deck as cell (cell.label)}
          <div>
            <dt>{cell.label}</dt>
            <dd>{cell.value}</dd>
            {#if cell.note}<small>{cell.note}</small>{/if}
          </div>
        {/each}
      </dl>
    {/if}
  </div>
</section>

<style>
  .cover {
    padding: clamp(24px, 3.5vw, 44px) clamp(16px, 3vw, 44px);
    background: var(--chrome-bg);
    color: var(--chrome-ink);
    border-bottom: 1px solid var(--chrome-line);
  }
  .cover-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
    align-items: end;
    gap: clamp(24px, 5vw, 64px);
    width: min(var(--hs-max, 1200px), 100%);
    margin: 0 auto;
  }
  .copy {
    min-width: 0;
  }
  .eyebrow-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .eyebrow {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--chrome-accent);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 4.6vw, 4.2rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.04em;
    text-transform: uppercase;
    color: var(--chrome-ink);
    overflow-wrap: anywhere;
  }
  h1 span {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--chrome-ink);
  }
  .standfirst {
    margin: 16px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: var(--chrome-muted);
  }
  .deck {
    display: grid;
    grid-template-columns: repeat(var(--cells), minmax(0, 1fr));
    margin: 0;
    border-top: 1px solid var(--chrome-line);
    border-left: 1px solid var(--chrome-line);
  }
  .deck > div {
    min-width: 0;
    padding: 12px;
    border-right: 1px solid var(--chrome-line);
    border-bottom: 1px solid var(--chrome-line);
    background: rgba(237, 228, 212, 0.04);
  }
  dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--chrome-muted);
  }
  dd {
    margin: 8px 0 4px;
    font-family: var(--font-display);
    font-size: clamp(1.5rem, 2.4vw, 2.3rem);
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--chrome-ink);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }
  small {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--chrome-accent);
  }
  @media (max-width: 860px) {
    .cover-inner {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
  }
</style>
