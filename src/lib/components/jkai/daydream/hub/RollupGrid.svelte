<script lang="ts">
  // A grid of EVEN cells, each a category with a figure.
  //
  // `StatDeck` is for a masthead: a handful of headline statistics whose
  // tiles may be as tall as their subtitles. This is for the body of a room:
  // eight, twelve, twenty-three cells that must read as one object, which
  // means every cell the same height (`grid-auto-rows: 1fr`), content
  // bounded so no cell can grow (label one line, sub two), and a cell that
  // does something is a link or a button — never a div with a handler.
  //
  // The sparkline is drawn here rather than through `Sparkline.svelte`
  // because it sits INSIDE a cell that is already a link, and a component
  // with its own tooltip and axis inside an anchor is two interactive
  // elements nested. Nulls are gaps, not zeros.
  import type { RollupCell } from './types';

  interface Props {
    cells: RollupCell[];
    /** Minimum cell width; the column count follows from it. */
    min?: number;
    /** Tighter padding and a smaller figure, for a wall of twenty. */
    dense?: boolean;
  }

  let { cells, min = 180, dense = false }: Props = $props();

  function path(series: Array<number | null>): string {
    const vals = series.filter((v): v is number => v != null && Number.isFinite(v));
    if (vals.length < 2) return '';
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    const w = 100;
    const h = 24;
    const step = w / (series.length - 1);
    let d = '';
    let pen = false;
    series.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      const x = (i * step).toFixed(1);
      const y = (h - 2 - ((v - lo) / span) * (h - 4)).toFixed(1);
      d += `${pen ? 'L' : 'M'}${x},${y} `;
      pen = true;
    });
    return d.trim();
  }
</script>

<div class="rg" class:dense style="--rg-min: {min}px">
  {#each cells as c (c.key)}
    {#if c.href}
      <a class="rg-cell t-{c.tone ?? 'steady'}" class:active={c.active} href={c.href}>
        {@render body(c)}
      </a>
    {:else if c.onclick}
      <button type="button" class="rg-cell t-{c.tone ?? 'steady'}" class:active={c.active} onclick={c.onclick}>
        {@render body(c)}
      </button>
    {:else}
      <div class="rg-cell t-{c.tone ?? 'steady'} still" class:active={c.active}>
        {@render body(c)}
      </div>
    {/if}
  {/each}
</div>

{#snippet body(c: RollupCell)}
  <div class="rg-top">
    <p class="rg-label">
      {#if c.mark}<span class="rg-mark">{c.mark}</span>{/if}{c.label}
    </p>
    {#if c.corner}<span class="rg-corner">{c.corner}</span>{/if}
  </div>
  <p class="rg-value">
    {c.value}{#if c.suffix}<span class="rg-suffix">{c.suffix}</span>{/if}
  </p>
  {#if c.sub}<p class="rg-sub">{c.sub}</p>{/if}
  {#if c.spark && c.spark.length > 1}
    <svg class="rg-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
      <path d={path(c.spark)} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  {/if}
{/snippet}

<style>
  .rg {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--rg-min), 1fr));
    grid-auto-rows: 1fr;
    align-items: stretch;
    gap: 10px;
  }

  .rg-cell {
    --tone: var(--accent-ink);
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    min-height: 118px;
    padding: 14px 16px 12px;
    background: var(--surface-card);
    border: 1px solid var(--card-border);
    border-top: 3px solid var(--tone);
    border-radius: 0;
    color: var(--text-primary);
    text-align: left;
    text-decoration: none;
    font: inherit;
    cursor: default;
    transition:
      border-color var(--t-fast) var(--ease-out),
      background-color var(--t-fast) var(--ease-out);
  }
  .rg.dense .rg-cell {
    min-height: 96px;
    padding: 10px 12px 10px;
    gap: 6px;
  }
  a.rg-cell,
  button.rg-cell {
    cursor: pointer;
  }
  a.rg-cell:hover,
  button.rg-cell:hover {
    border-color: var(--tone);
    background: var(--accent-tint-04);
  }
  a.rg-cell:focus-visible,
  button.rg-cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .rg-cell.active {
    border-color: var(--tone);
    background: var(--accent-tint-08);
  }

  .rg-cell.t-urgent {
    --tone: var(--error);
  }
  .rg-cell.t-action {
    --tone: var(--accent);
  }
  .rg-cell.t-watch {
    --tone: var(--warn);
  }
  .rg-cell.t-good {
    --tone: var(--good);
  }
  .rg-cell.t-steady {
    --tone: var(--accent-ink);
  }
  .rg-cell.t-quiet {
    --tone: var(--line-strong);
    color: var(--text-muted);
  }

  .rg-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .rg-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rg-mark {
    color: var(--tone);
    margin-right: 8px;
  }
  .rg-corner {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    white-space: nowrap;
  }

  .rg-value {
    font-family: var(--font-display);
    font-size: 28px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--tone);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .rg.dense .rg-value {
    font-size: 22px;
  }
  .rg-cell.t-steady .rg-value {
    color: var(--text-primary);
  }
  .rg-suffix {
    font-size: 15px;
    color: var(--text-muted);
    margin-left: 2px;
  }

  .rg-sub {
    font-size: var(--fs-label);
    line-height: 1.4;
    color: var(--text-muted);
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-wrap: pretty;
  }

  .rg-spark {
    margin-top: auto;
    width: 100%;
    height: 24px;
    color: var(--tone);
    opacity: 0.8;
  }
</style>
