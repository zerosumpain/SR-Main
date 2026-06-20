<script lang="ts">
  // LeverResponseCurve — the dose-response exhibit: sweep ONE engine lever across its
  // full range (all other levers held at the current scenario) and plot the resulting
  // outcome at the horizon. Shows diminishing returns / thresholds that a single slider
  // can't. A marker tracks the current value and moves as you drag the slider beneath.
  // Reads the real engine (runSim), so it is consistent with every other surface.
  import LeverSlider from './LeverSlider.svelte';
  import { app } from '../lib/appState.svelte';
  import { runSim } from '../lib/engine';
  import { LEVERS_BY_ID, GROUP_META, LEVER_ELI5_NAME } from '../lib/levers';
  import { OUTCOMES_BY_ID, OUTCOME_ELI5_LABEL } from '../lib/outcomes';
  import { linScale, niceTicks, extent, polyline, fmt } from '../lib/chartkit';

  interface Props {
    lever: string;
    outcome: string;
    steps?: number;
    height?: number;
    title?: string;
  }
  let { lever, outcome, steps = 26, height = 200, title }: Props = $props();

  const L = $derived(LEVERS_BY_ID[lever]);
  const meta = $derived(OUTCOMES_BY_ID[outcome]);
  const col = $derived(GROUP_META[L.group]?.colour ?? '#7a5aa6');
  const lname = $derived(app.narrative === 'eli5' ? (LEVER_ELI5_NAME[lever] ?? L.label) : L.label);
  const oname = $derived(app.narrative === 'eli5' ? (OUTCOME_ELI5_LABEL[outcome] ?? meta?.label) : meta?.label);
  const curVal = $derived(app.levers[lever] ?? L.baseline);

  // sweep the lever min→max, holding all others at the current scenario, read the horizon outcome
  const sweep = $derived.by(() => {
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < steps; i++) {
      const v = L.min + (i / (steps - 1)) * (L.max - L.min);
      const sim = runSim({ ...app.levers, [lever]: v });
      const row = sim.years.find((y) => y.year === app.horizon) ?? sim.years[sim.years.length - 1];
      xs.push(v);
      ys.push((row as any)[outcome] as number);
    }
    return { xs, ys };
  });

  const padL = 44, padR = 12, padT = 12, padB = 30;
  let w = $state(440);
  let host: HTMLDivElement;
  $effect(() => {
    if (!host) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((e) => {
      const cw = e[e.length - 1]?.contentRect.width ?? 0;
      if (t) clearTimeout(t);
      t = setTimeout(() => { w = Math.max(260, cw); }, 80);
    });
    ro.observe(host);
    return () => { if (t) clearTimeout(t); ro.disconnect(); };
  });
  const innerW = $derived(w - padL - padR);
  const innerH = $derived(height - padT - padB);

  const yE = $derived(extent(sweep.ys, 0.1));
  const xs = $derived(linScale([L.min, L.max], [padL, padL + innerW]));
  const ys = $derived(linScale([yE.lo, yE.hi], [padT + innerH, padT]));
  const path = $derived(polyline(sweep.xs.map((v) => xs(v)), sweep.ys.map((v) => ys(v))));
  const yTicks = $derived(niceTicks(yE.lo, yE.hi, 4));

  // current marker
  const curY = $derived.by(() => {
    const sim = runSim(app.levers);
    const row = sim.years.find((y) => y.year === app.horizon) ?? sim.years[sim.years.length - 1];
    return (row as any)[outcome] as number;
  });
  const dp = $derived(meta?.dp ?? 1);
</script>

<div class="rc" bind:this={host}>
  <div class="rc-head">
    <span class="rc-title">{title ?? `${oname} vs ${lname}`}</span>
    <span class="rc-cur" style="color:{col}">now: {fmt(curY, dp)}{meta?.unit}</span>
  </div>
  <svg viewBox="0 0 {w} {height}" width="100%" {height} role="img" aria-label="{oname} response to {lname}">
    {#each yTicks as t}
      <line x1={padL} x2={w - padR} y1={ys(t)} y2={ys(t)} class="grid" />
      <text x={padL - 6} y={ys(t) + 3} class="ylab" text-anchor="end">{fmt(t, dp)}</text>
    {/each}
    <!-- lever min/max x labels -->
    <text x={padL} y={height - 8} class="xlab" text-anchor="start">{L.format ? L.format(L.min) : `${L.min}`}</text>
    <text x={padL + innerW} y={height - 8} class="xlab" text-anchor="end">{L.format ? L.format(L.max) : `${L.max}`}</text>
    <text x={padL + innerW / 2} y={height - 8} class="xlab2" text-anchor="middle">{lname} →</text>
    <!-- the response curve -->
    <path d={path} fill="none" stroke={col} stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
    <!-- current value marker -->
    <line x1={xs(curVal)} x2={xs(curVal)} y1={padT} y2={padT + innerH} class="cur-line" />
    <circle cx={xs(curVal)} cy={ys(curY)} r="4.5" fill={col} stroke="#fff" stroke-width="1.5" />
  </svg>
  <LeverSlider id={lever} />
</div>

<style>
  .rc { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); padding: 8px 10px 6px; }
  .rc-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 2px; }
  .rc-title { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 13px; color: var(--ink); }
  .rc-cur { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; }
  svg { display: block; }
  .grid { stroke: rgba(28,22,17,0.08); stroke-width: 1; }
  .ylab, .xlab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.55); }
  .xlab2 { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.4); }
  .cur-line { stroke: rgba(28,22,17,0.3); stroke-width: 1; stroke-dasharray: 3 2; }
</style>
