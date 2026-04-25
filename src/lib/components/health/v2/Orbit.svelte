<script lang="ts">
  import type { HealthDay } from '$lib/health/series-30d-service';
  import { clamp } from './utils';

  let {
    series,
    today,
    fullbleed = true,
  }: { series: HealthDay[]; today: HealthDay; fullbleed?: boolean } = $props();

  const W = 360;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const radii = [0.28, 0.52, 0.76];
  const R = Math.min(W, H) * 0.42;

  function avg(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  // Normalize each axis 0..1
  function norm(metric: 'rec' | 'hrv' | 'rhr' | 'slept' | 'strain' | 'steps', d: HealthDay): number {
    switch (metric) {
      case 'rec':
        return clamp(d.rec / 100, 0, 1);
      case 'hrv':
        return clamp((d.hrv - 25) / 50, 0, 1);
      case 'rhr':
        return clamp(1 - (d.rhr - 50) / 22, 0, 1);
      case 'slept':
        return clamp((d.slept - 5) / 4, 0, 1);
      case 'strain':
        return clamp(d.strain / 21, 0, 1);
      case 'steps':
        return clamp(d.steps / 16000, 0, 1);
    }
  }

  const axes = $derived([
    {
      key: 'HRV',
      today: norm('hrv', today),
      base: avg(series.map((d) => norm('hrv', d))),
    },
    {
      key: 'SLEEP',
      today: norm('slept', today),
      base: avg(series.map((d) => norm('slept', d))),
    },
    {
      key: 'REC',
      today: norm('rec', today),
      base: avg(series.map((d) => norm('rec', d))),
    },
    {
      key: 'RHR',
      today: norm('rhr', today),
      base: avg(series.map((d) => norm('rhr', d))),
    },
    {
      key: 'STRAIN',
      today: norm('strain', today),
      base: avg(series.map((d) => norm('strain', d))),
    },
    {
      key: 'STEPS',
      today: norm('steps', today),
      base: avg(series.map((d) => norm('steps', d))),
    },
  ]);

  const N = 6;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / N;

  function poly(values: number[]): Array<[number, number]> {
    return values.map((v, i) => {
      const a = angle(i);
      const r = R * v;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    });
  }
  const pToD = (pts: Array<[number, number]>) =>
    pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' Z';

  const baselinePoly = $derived(poly(axes.map((a) => a.base)));
  const todayPoly = $derived(poly(axes.map((a) => a.today)));
</script>

<svg
  class="h-orbit-svg"
  class:fullbleed
  viewBox="0 0 {W} {H}"
  preserveAspectRatio={fullbleed ? 'xMidYMid slice' : 'xMidYMid meet'}
  role="img"
  aria-label="Today vs 30-day baseline radar"
>
  {#each radii as r, i (i)}
    <circle class="h-orbit-ring" {cx} {cy} r={R * r} />
  {/each}
  <circle class="h-orbit-ring h-orbit-ring-outer" {cx} {cy} r={R} />
  {#each axes as a, i (a.key)}
    {@const ang = angle(i)}
    {@const x2 = cx + Math.cos(ang) * R}
    {@const y2 = cy + Math.sin(ang) * R}
    {@const lx = cx + Math.cos(ang) * (R + 20)}
    {@const ly = cy + Math.sin(ang) * (R + 20)}
    <line class="h-orbit-axis" x1={cx} y1={cy} {x2} {y2} />
    <text class="h-orbit-label" x={lx} y={ly} text-anchor="middle" dominant-baseline="middle"
      >{a.key}</text
    >
  {/each}
  <path class="h-orbit-baseline" d={pToD(baselinePoly)} />
  <path class="h-orbit-today" d={pToD(todayPoly)} />
  {#each todayPoly as p, i (i)}
    <circle cx={p[0]} cy={p[1]} r={2.5} fill="var(--accent)" />
  {/each}
</svg>

<style>
  .h-orbit-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .h-orbit-svg.fullbleed {
    opacity: 0.55;
  }
  .h-orbit-axis {
    stroke: rgba(26, 16, 8, 0.18);
    stroke-width: 1;
  }
  .h-orbit-ring {
    fill: none;
    stroke: rgba(26, 16, 8, 0.1);
    stroke-width: 1;
    stroke-dasharray: 2 4;
  }
  .h-orbit-ring-outer {
    stroke: rgba(26, 16, 8, 0.18);
    stroke-dasharray: 0;
  }
  .h-orbit-baseline {
    fill: none;
    stroke: var(--text-ghost);
    stroke-width: 1.2;
  }
  .h-orbit-today {
    fill: rgba(196, 87, 10, 0.12);
    stroke: var(--accent);
    stroke-width: 1.8;
  }
  .h-orbit-label {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    fill: var(--text-muted);
  }
</style>
