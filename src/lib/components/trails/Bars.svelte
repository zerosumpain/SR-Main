<script lang="ts" module>
  export interface Bar {
    key: string;
    /** Short x-axis label; the chart thins these to avoid collisions. */
    tick: string;
    value: number;
    /** Pre-formatted hover readout, e.g. "2h 10m · 21.3 km". */
    readout: string;
    readoutSub?: string;
  }
</script>

<script lang="ts">
  // One measure as vertical bars — single hue, because a bar chart of one
  // measure is magnitude, not identity. The caller pre-formats the hover
  // readout (weekly volume with a per-sport breakdown, daily training load,
  // …) so this stays a dumb renderer.
  import { onMount } from 'svelte';

  let {
    bars,
    label,
    height = 150,
    formatY = (v: number) => String(Math.round(v)),
  }: {
    bars: Bar[];
    label: string;
    height?: number;
    formatY?: (v: number) => string;
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
