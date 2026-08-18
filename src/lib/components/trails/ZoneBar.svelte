<script lang="ts">
  // Time-in-zone as one stacked horizontal bar plus a labelled legend row.
  // Sequential single-hue ramp (accent, light → dark) because intensity is a
  // magnitude, not five identities; Z0 (below 50% HRmax) stays neutral ink.
  // Labels live in the legend row, never inside segments — thin slices would
  // swallow them.
  import { formatDuration } from '$lib/trails/format';
  import type { ZoneSeconds } from '$lib/health/analytics/hr-zones';

  let {
    zones,
    edges,
    showZ0 = true,
  }: {
    zones: ZoneSeconds;
    /** Absolute bpm starts for z1..z5 (from zoneEdges). */
    edges: number[];
    showZ0?: boolean;
  } = $props();

  const RAMP = [
    'color-mix(in srgb, var(--text-primary) 18%, transparent)',
    'color-mix(in srgb, var(--accent) 18%, transparent)',
    'color-mix(in srgb, var(--accent) 34%, transparent)',
    'color-mix(in srgb, var(--accent) 52%, transparent)',
    'color-mix(in srgb, var(--accent) 74%, transparent)',
    'var(--accent)',
  ];

  interface Row {
    key: string;
    label: string;
    range: string;
    seconds: number;
    colour: string;
  }

  const rows = $derived.by((): Row[] => {
    const all: Row[] = [
      { key: 'z0', label: 'Z0', range: `< ${edges[0]}`, seconds: zones.z0, colour: RAMP[0] },
      { key: 'z1', label: 'Z1', range: `${edges[0]}–${edges[1]}`, seconds: zones.z1, colour: RAMP[1] },
      { key: 'z2', label: 'Z2', range: `${edges[1]}–${edges[2]}`, seconds: zones.z2, colour: RAMP[2] },
      { key: 'z3', label: 'Z3', range: `${edges[2]}–${edges[3]}`, seconds: zones.z3, colour: RAMP[3] },
      { key: 'z4', label: 'Z4', range: `${edges[3]}–${edges[4]}`, seconds: zones.z4, colour: RAMP[4] },
      { key: 'z5', label: 'Z5', range: `${edges[4]}+`, seconds: zones.z5, colour: RAMP[5] },
    ];
    return showZ0 ? all : all.slice(1);
  });

  const total = $derived(rows.reduce((a, r) => a + r.seconds, 0));
  let active = $state<string | null>(null);
</script>

{#if total > 0}
  <div class="zonebar">
    <div class="bar" role="img" aria-label="Time in heart-rate zones">
      {#each rows as r (r.key)}
        {#if r.seconds > 0}
          <div
            class="seg"
            class:dim={active != null && active !== r.key}
            style:flex-grow={r.seconds}
            style:background={r.colour}
            onpointerenter={() => (active = r.key)}
            onpointerleave={() => (active = null)}
          ></div>
        {/if}
      {/each}
    </div>
    <div class="legend">
      {#each rows as r (r.key)}
        <button
          type="button"
          class="cell"
          class:on={active === r.key}
          onpointerenter={() => (active = r.key)}
          onpointerleave={() => (active = null)}
        >
          <span class="swatch" style:background={r.colour}></span>
          <span class="z">{r.label}</span>
          <span class="range">{r.range}</span>
          <span class="time">{formatDuration(r.seconds)}</span>
          <span class="pct">{total ? Math.round((r.seconds / total) * 100) : 0}%</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .zonebar {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .bar {
    display: flex;
    gap: 2px; /* the surface gap between stacked fills */
    height: 26px;
  }

  .seg {
    flex-basis: 0;
    min-width: 3px;
    transition: opacity 80ms ease;
  }

  .seg.dim {
    opacity: 0.35;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1.1rem;
  }

  .cell {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    padding: 0;
    border: none;
    background: none;
    cursor: default;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }

  .cell.on .z {
    color: var(--accent);
  }

  .swatch {
    width: 10px;
    height: 10px;
    align-self: center;
    flex-shrink: 0;
  }

  .z {
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }

  .range {
    color: var(--text-ghost);
  }

  .time {
    color: var(--text-secondary);
  }

  .pct {
    color: var(--text-muted);
  }
</style>
