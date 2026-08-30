<script lang="ts" module>
  export interface Bar {
    key: string;
    /** Short x-axis label; the chart thins these to avoid collisions. */
    tick: string;
    value: number;
    /** Pre-formatted hover readout, e.g. "2h 10m · 21.3 km". */
    readout: string;
    readoutSub?: string;
    /**
     * Strip variant only. `ink` is the default weight; the accent tones mark
     * the recent weeks the load ratio is actually reading.
     */
    tone?: 'ink' | 'accent-soft' | 'accent';
  }
</script>

<script lang="ts">
  // One measure as vertical bars — single hue, because a bar chart of one
  // measure is magnitude, not identity. The caller pre-formats the hover
  // readout (weekly volume with a per-sport breakdown, daily training load,
  // …) so this stays a dumb renderer.
  //
  // Two variants, one component:
  //
  //  * `axis` — the original. A measured SVG with a y-axis, gridlines and
  //    thinned ticks, for a series whose absolute value has to be readable.
  //  * `strip` — the /health training strip. A fixed-count CSS grid, no axis,
  //    no frame, radius 0, one tick under every bar. It is a SHAPE, not a
  //    scale: the figures that matter sit beside it in Archivo Black, and the
  //    strip's job is to show the last twelve weeks falling away.
  //
  // The strip is a grid rather than an SVG because it is `repeat(12, 1fr)`
  // with a hard 118px height — the design's own geometry — and drawing that in
  // a viewBox would mean recomputing every bar's width on resize to keep the
  // gaps at 5px.
  import { onMount } from 'svelte';

  let {
    bars,
    label,
    height = 150,
    formatY = (v: number) => String(Math.round(v)),
    variant = 'axis',
    caption = null,
  }: {
    bars: Bar[];
    label: string;
    height?: number;
    formatY?: (v: number) => string;
    variant?: 'axis' | 'strip';
    /** Strip variant: the mono note on the right of the header row. */
    caption?: string | null;
  } = $props();

  const PAD = { top: 12, right: 12, bottom: 24, left: 44 };

  let width = $state(720);
  let frameEl: HTMLDivElement | undefined = $state();
  let observer: ResizeObserver | null = null; // machinery, not state

  onMount(() => {
    if (!frameEl) return;
    observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) width = w;
    });
    observer.observe(frameEl);
    return () => {
      observer?.disconnect();
      observer = null;
    };
  });

  const maxV = $derived(Math.max(...bars.map((b) => b.value), 1));
  const innerW = $derived(width - PAD.left - PAD.right);
  const slot = $derived(bars.length ? innerW / bars.length : innerW);
  const barW = $derived(Math.max(4, Math.min(34, slot * 0.62)));

  const sy = $derived(
    (v: number) => height - PAD.bottom - (v / maxV) * (height - PAD.top - PAD.bottom),
  );
  const sx = $derived((i: number) => PAD.left + i * slot + (slot - barW) / 2);

  const yTicks = $derived([0, maxV / 2, maxV]);

  // Show at most a handful of x labels; always include the first bar of a run.
  const tickEvery = $derived(Math.max(1, Math.ceil(bars.length / (width < 420 ? 3 : 6))));

  let hoverIndex = $state<number | null>(null);
  const hovered = $derived(hoverIndex == null ? null : bars[hoverIndex]);

  /**
   * A strip bar's height as a percentage of the tallest week. Floored at 3%
   * so a week with one short walk in it is still a mark rather than nothing —
   * the strip's job is to show which weeks HAPPENED as well as how big they
   * were, and a bar rounded down to invisible reads as a rest week.
   */
  function stripPct(value: number): number {
    return Math.max(3, (value / maxV) * 100);
  }

  /** Which of the strip's columns the pointer is over, or none. */
  function trackColumn(event: PointerEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (box.width <= 0 || bars.length === 0) return;
    const i = Math.floor(((event.clientX - box.left) / box.width) * bars.length);
    hoverIndex = i >= 0 && i < bars.length ? i : null;
  }

  /** Bar with a 4px rounded data-end, anchored flat on the baseline. */
  function roundedBar(x: number, y: number, w: number, h: number): string {
    const r = Math.min(4, w / 2, h);
    const bottom = y + h;
    return [
      `M${x},${bottom}`,
      `L${x},${y + r}`,
      `Q${x},${y} ${x + r},${y}`,
      `L${x + w - r},${y}`,
      `Q${x + w},${y} ${x + w},${y + r}`,
      `L${x + w},${bottom}`,
      'Z',
    ].join('');
  }
</script>

{#if variant === 'strip'}
  <figure class="chart">
    <figcaption class="chart-hd strip-hd">
      <span class="strip-label">{label}</span>
      {#if hovered}
        <span class="readout">
          {hovered.readout}
          {#if hovered.readoutSub}
            <span class="readout-at">{hovered.readoutSub}</span>
          {/if}
        </span>
      {:else if caption}
        <span class="strip-cap">{caption}</span>
      {/if}
    </figcaption>

    {#if bars.length === 0}
      <div class="empty" style:height="{height}px">Not enough data yet</div>
    {:else}
      <!-- The pointer is tracked on the CONTAINER, not on each bar: a
           short week is a 4px target, and hovering the column it sits in is
           what a reader means. It also keeps the bars inert elements. -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="strip-bars"
        style="--n: {bars.length}; height: {height}px"
        role="img"
        aria-label={label}
        onpointermove={trackColumn}
        onpointerleave={() => (hoverIndex = null)}
      >
        {#each bars as b, i (b.key)}
          <div
            class="sbar tone-{b.tone ?? 'ink'}"
            class:flat={b.value <= 0}
            class:hot={hoverIndex === i}
            style:height={b.value > 0 ? `${stripPct(b.value)}%` : '2px'}
            title="{b.tick} · {b.readout}"
          ></div>
        {/each}
      </div>
      <div class="strip-ticks" style="--n: {bars.length}" aria-hidden="true">
        {#each bars as b (b.key)}
          <p class:lit={b.tone === 'accent'}>{b.tick}</p>
        {/each}
      </div>
    {/if}
  </figure>
{:else}
<figure class="chart">
  <figcaption class="chart-hd">
    <span class="sr-label-tight">{label}</span>
    {#if hovered}
      <span class="readout">
        {hovered.readout}
        {#if hovered.readoutSub}
          <span class="readout-at">{hovered.readoutSub}</span>
        {/if}
      </span>
    {/if}
  </figcaption>

  <div class="frame" bind:this={frameEl}>
    {#if bars.length === 0}
      <div class="empty" style:height="{height}px">Not enough data yet</div>
    {:else}
      <svg
        width={width}
        height={height}
        viewBox="0 0 {width} {height}"
        role="img"
        aria-label={label}
        onpointerleave={() => (hoverIndex = null)}
      >
        {#each yTicks as t, ti (ti)}
          <line class="grid" x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} />
          <text class="tick" x={PAD.left - 8} y={sy(t) + 4} text-anchor="end">{formatY(t)}</text>
        {/each}

        {#each bars as b, i (b.key)}
          <rect
            class="hit"
            x={PAD.left + i * slot}
            y={PAD.top}
            width={slot}
            height={height - PAD.top - PAD.bottom}
            onpointerenter={() => (hoverIndex = i)}
          />
          {#if b.value > 0}
            <path
              class="bar"
              class:dim={hoverIndex != null && hoverIndex !== i}
              d={roundedBar(sx(i), sy(b.value), barW, height - PAD.bottom - sy(b.value))}
            />
          {:else}
            <rect class="stub" x={sx(i)} y={height - PAD.bottom - 2} width={barW} height={2} />
          {/if}
        {/each}

        {#each bars as b, i (b.key)}
          {#if i % tickEvery === 0}
            <text class="tick" x={sx(i) + barW / 2} y={height - 6} text-anchor="middle">
              {b.tick}
            </text>
          {/if}
        {/each}
      </svg>
    {/if}
  </div>
</figure>
{/if}

<style>
  .chart {
    margin: 0;
  }

  .chart-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.4rem;
    min-height: 1.2em;
  }

  /* Readouts wear text tokens, never the series colour. */
  .readout {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .readout-at {
    color: var(--text-muted);
  }

  .frame {
    width: 100%;
  }

  svg {
    display: block;
    border: 1px solid var(--line-hair);
    background: var(--surface-sunken);
    touch-action: pan-y;
  }

  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }

  .tick {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    fill: var(--text-ghost);
  }

  .hit {
    fill: transparent;
  }

  .bar {
    fill: var(--accent);
    transition: opacity 80ms ease;
  }

  .bar.dim {
    opacity: 0.45;
  }

  .stub {
    fill: var(--line-strong);
  }

  /* ——— strip variant ——— radius 0, no frame, no axis, one tick per bar. */
  .strip-hd {
    align-items: baseline;
    margin-bottom: 18px;
  }
  .strip-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .strip-cap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .strip-bars,
  .strip-ticks {
    display: grid;
    /* A FIXED count, so the auto-fit trap that paints empty tracks as blocks
       cannot apply here. */
    grid-template-columns: repeat(var(--n), 1fr);
    gap: 5px;
  }
  .strip-bars {
    align-items: end;
  }
  .sbar {
    min-width: 0;
    border-radius: 0;
    background: rgba(26, 16, 8, 0.25);
    transition: background-color 0.2s ease-out;
  }
  .sbar.tone-accent-soft {
    background: var(--accent-tint-50);
  }
  .sbar.tone-accent {
    background: var(--accent);
  }
  .sbar.flat {
    background: var(--line-strong);
  }
  /* Hover is a colour change and nothing else — no lift, no fade, no scale. */
  .sbar.hot {
    background: var(--text-primary);
  }
  .sbar.tone-accent-soft.hot,
  .sbar.tone-accent.hot {
    background: var(--accent-hover);
  }

  .strip-ticks {
    margin-top: 8px;
  }
  .strip-ticks p {
    margin: 0;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .strip-ticks p.lit {
    color: var(--accent);
  }
  /* Twelve dates do not fit on a phone. Every other one goes, rather than the
     row shrinking below the 12px floor. */
  @media (max-width: 640px) {
    .strip-ticks p:nth-child(even) {
      visibility: hidden;
    }
  }

  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line-hair);
    background: var(--surface-sunken);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
</style>
