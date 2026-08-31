<script lang="ts">
  // The tile deck — the shape /health's `SegmentTotals` uses, in both registers.
  //
  // Each tile carries its OWN border with a real gap between them. The
  // tempting alternative (`gap: 1px` over a background, so the gaps read as
  // hairlines) paints every unfilled `auto-fit` track as a solid block the
  // moment the row is not full, which is most of the time on a hub whose decks
  // are three and four tiles wide. That trap is written up in the /health
  // handoff and it is the same one here.
  import type { DeckTile } from './types';

  interface Props {
    tiles: DeckTile[];
    /** On the `#1a1008` bands. Changes every colour, not just the text. */
    dark?: boolean;
    /** Minimum tile width; 3-up decks want more than 5-up ones. */
    min?: number;
  }

  let { tiles, dark = false, min = 200 }: Props = $props();
</script>

<div class="dk" class:dark style="--dk-min: {min}px">
  {#each tiles as t (t.key)}
    <div class="dk-tile" class:lit={t.lit}>
      <p class="dk-label">{t.label}</p>
      <p class="dk-value tone-{t.tone ?? 'steady'}">
        {t.value}{#if t.suffix}<span class="dk-suffix">{t.suffix}</span>{/if}
      </p>
      {#if t.sub}<p class="dk-sub">{t.sub}</p>{/if}
    </div>
  {/each}
</div>

<style>
  .dk {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--dk-min), 1fr));
    gap: 12px;
  }

  .dk-tile {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--surface-card);
    padding: 16px;
    min-width: 0;
  }
  .dk-tile.lit {
    border-color: var(--accent-tint-35);
    background: var(--accent-tint-04);
  }
  .dk.dark .dk-tile {
    border-color: rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.05);
  }
  .dk.dark .dk-tile.lit {
    border-color: rgba(232, 134, 58, 0.4);
    background: rgba(232, 134, 58, 0.09);
  }

  .dk-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 10px;
  }
  .dk.dark .dk-label {
    color: rgba(237, 228, 212, 0.55);
  }
  .dk-tile.lit .dk-label {
    color: var(--accent);
  }
  .dk.dark .dk-tile.lit .dk-label {
    color: var(--accent-on-dark);
  }

  .dk-value {
    font-family: var(--font-display);
    font-size: 32px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .dk-suffix {
    font-size: 17px;
    color: var(--text-muted);
    margin-left: 2px;
  }
  .dk.dark .dk-suffix {
    color: rgba(237, 228, 212, 0.45);
  }

  /* Paper tones. */
  .dk-value.tone-good {
    color: var(--good);
  }
  .dk-value.tone-action {
    color: var(--accent);
  }
  .dk-value.tone-urgent {
    color: var(--error);
  }
  .dk-value.tone-watch {
    color: var(--warn);
  }
  .dk-value.tone-steady {
    color: var(--text-primary);
  }
  .dk-value.tone-quiet {
    color: var(--text-ghost);
  }

  /* On dark the olive and the orange both move — the paper values go muddy on
     #1a1008, which is exactly the deviation the /health handoff records. */
  .dk.dark .dk-value.tone-good {
    color: var(--good-on-dark);
  }
  .dk.dark .dk-value.tone-action {
    color: var(--accent-on-dark);
  }
  .dk.dark .dk-value.tone-urgent {
    color: #e08b8b;
  }
  .dk.dark .dk-value.tone-watch {
    color: #d8b45e;
  }
  .dk.dark .dk-value.tone-steady {
    color: var(--bg);
  }
  .dk.dark .dk-value.tone-quiet {
    color: rgba(237, 228, 212, 0.35);
  }

  .dk-sub {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: var(--text-muted);
    text-wrap: pretty;
    margin: 10px 0 0;
  }
  .dk.dark .dk-sub {
    color: rgba(237, 228, 212, 0.55);
  }
</style>
