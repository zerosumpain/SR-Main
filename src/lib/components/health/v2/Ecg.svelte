<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from './utils';

  let { rhr = 64, fullbleed = true }: { rhr?: number; fullbleed?: boolean } = $props();

  const W = 800;
  const H = 280;
  const beats = 8;
  const beatW = W / beats;

  function beatPath(x0: number): Array<[number, number]> {
    const b = beatW;
    const baseline = H * 0.55;
    return [
      [x0, baseline],
      [x0 + b * 0.1, baseline],
      [x0 + b * 0.16, baseline - 8],
      [x0 + b * 0.22, baseline],
      [x0 + b * 0.3, baseline + 6],
      [x0 + b * 0.34, baseline - H * 0.32],
      [x0 + b * 0.38, baseline + 14],
      [x0 + b * 0.46, baseline],
      [x0 + b * 0.62, baseline - 12],
      [x0 + b * 0.78, baseline],
      [x0 + b, baseline],
    ];
  }
  const all: Array<[number, number]> = [];
  for (let i = 0; i < beats; i++) all.push(...beatPath(i * beatW));
  const d = all
    .map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1))
    .join(' ');

  const grid: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; major: boolean }> = [];
  for (let x = 0; x <= W; x += 20)
    grid.push({ key: 'gx' + x, x1: x, y1: 0, x2: x, y2: H, major: x % 100 === 0 });
  for (let y = 0; y <= H; y += 20)
    grid.push({ key: 'gy' + y, x1: 0, y1: y, x2: W, y2: y, major: y % 100 === 0 });

  let phase = $state(0);
  // svelte-ignore state_referenced_locally
  let bpm = $state(rhr);
  let raf: number | undefined;
  let bpmInterval: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    if (prefersReducedMotion()) {
      phase = 1;
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      phase = phase + dt * 1.18;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const baseBpm = rhr;
    bpmInterval = setInterval(() => {
      bpm = Math.max(58, Math.min(72, baseBpm + Math.round((Math.random() - 0.5) * 4)));
    }, 1500);
    return () => {
      if (raf !== undefined) cancelAnimationFrame(raf);
      if (bpmInterval) clearInterval(bpmInterval);
    };
  });

  let sweepX = $derived((phase % 1) * W);
  let clipId = `ecg-clip-${Math.random().toString(36).slice(2, 8)}`;
</script>

<svg
  class="h-ecg-svg"
  class:fullbleed
  viewBox="0 0 {W} {H}"
  preserveAspectRatio="none"
  role="img"
  aria-label="Live ECG trace at {bpm} bpm"
>
  <g class="h-ecg-grid">
    {#each grid as g (g.key)}
      <line class:major={g.major} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} />
    {/each}
  </g>
  <path class="h-ecg-trace-bg" {d} />
  <defs>
    <clipPath id={clipId}>
      <rect x="0" y="0" width={sweepX} height={H} />
    </clipPath>
  </defs>
  <path class="h-ecg-trace" {d} clip-path="url(#{clipId})" />
  <line class="h-ecg-cursor" x1={sweepX} y1={0} x2={sweepX} y2={H} />
</svg>
{#if !fullbleed}
  <div class="h-ecg-bpm-readout">
    <p class="h-ecg-bpm-num">{bpm}</p>
    <p class="h-ecg-bpm-lbl">BPM · LIVE</p>
  </div>
{/if}

<style>
  .h-ecg-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .h-ecg-svg.fullbleed {
    opacity: 0.55;
  }
  .h-ecg-grid line {
    stroke: rgba(26, 16, 8, 0.06);
    stroke-width: 1;
  }
  .h-ecg-grid line.major {
    stroke: rgba(26, 16, 8, 0.1);
  }
  .h-ecg-trace {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linejoin: round;
    stroke-linecap: round;
    filter: drop-shadow(0 0 4px rgba(196, 87, 10, 0.35));
  }
  .h-ecg-trace-bg {
    fill: none;
    stroke: rgba(196, 87, 10, 0.18);
    stroke-width: 1.2;
  }
  .h-ecg-cursor {
    stroke: var(--accent);
    stroke-width: 1;
    opacity: 0.6;
  }
  .h-ecg-bpm-readout {
    position: absolute;
    top: 24px;
    right: 32px;
    text-align: right;
    pointer-events: none;
  }
  .h-ecg-bpm-num {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 44px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
    color: var(--accent);
    opacity: 0.85;
  }
  .h-ecg-bpm-lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
</style>
