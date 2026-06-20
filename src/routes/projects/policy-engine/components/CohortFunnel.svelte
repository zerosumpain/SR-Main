<script lang="ts">
  // CohortFunnel — the population-simulation centerpiece. A bespoke-SVG attrition funnel
  // for ONE synthetic year-group of 600,000 children passing through the academic pipeline
  // (school-ready at 5 → secondary-ready at 11 → strong GCSE pass at 16). The vertical axis
  // is the cohort: the "success stream" (teal advantaged + terracotta disadvantaged) thins
  // gate by gate, the grey channel above is those below the standard. The status-quo reach
  // is drawn as a dashed high-water line, so the gap the package opens up is the visible thing.
  // A detached 4th panel shows the 16–24 destination rate as CONTEXT (a different denominator).

  import type { GateState } from '../lib/population';
  import { COHORT_N, DIS_COHORT_N } from '../lib/population';
  import { fmtCompact } from '../lib/format';

  interface Props { pipeline: GateState[]; horizon: number; comparatorName?: string; scale?: number; regionName?: string; }
  let { pipeline, horizon, comparatorName = 'status quo', scale = 1, regionName = '' }: Props = $props();

  const comparing = $derived(comparatorName !== 'status quo');
  const cohortN = $derived(Math.round(COHORT_N * scale));
  const disCohortN = $derived(Math.round(DIS_COHORT_N * scale));

  const H = 392;
  const padT = 30, padB = 58, padL = 14, padR = 14;
  let w = $state(720);
  let host: HTMLDivElement;
  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver((es) => { for (const e of es) w = Math.max(360, e.contentRect.width); });
    ro.observe(host);
    return () => ro.disconnect();
  });

  const academic = $derived(pipeline.filter((g) => !g.proxy));
  const dest = $derived(pipeline.find((g) => g.proxy) ?? null);

  // layout: academic gates fill the left ~78%, the destination context panel sits right of a divider
  const innerH = $derived(H - padT - padB);
  const baselineY = $derived(padT + innerH);
  const acW = $derived((w - padL - padR) * 0.76);
  const divX = $derived(padL + acW + 18);
  const bw = $derived(Math.min(60, Math.max(34, acW / (academic.length * 2.4))));
  function gateX(i: number): number {
    const n = academic.length;
    return padL + bw / 2 + (i * (acW - bw)) / Math.max(1, n - 1);
  }
  const yTop = (count: number) => padT + (1 - count / cohortN) * innerH; // count→y (top of a stack of `count`)

  interface Geo { g: GateState; x: number; rT: number; dT: number; ghostY: number; }
  const geo = $derived<Geo[]>(academic.map((g, i) => ({
    g, x: gateX(i), rT: yTop(g.reach), dT: yTop(g.reachDis), ghostY: yTop(g.reachBase),
  })));

  // a smooth ribbon between two vertical edges (top + bottom curves), CausalFlow bez idiom
  function ribbon(x1: number, t1: number, b1: number, x2: number, t2: number, b2: number): string {
    const dx = (x2 - x1) * 0.42;
    return `M${x1.toFixed(1)},${t1.toFixed(1)} C${(x1 + dx).toFixed(1)},${t1.toFixed(1)} ${(x2 - dx).toFixed(1)},${t2.toFixed(1)} ${x2.toFixed(1)},${t2.toFixed(1)} `
      + `L${x2.toFixed(1)},${b2.toFixed(1)} C${(x2 - dx).toFixed(1)},${b2.toFixed(1)} ${(x1 + dx).toFixed(1)},${b1.toFixed(1)} ${x1.toFixed(1)},${b1.toFixed(1)} Z`;
  }
  const advRibbons = $derived(geo.slice(0, -1).map((a, i) => {
    const b = geo[i + 1], r = bw / 2;
    return ribbon(a.x + r, a.rT, a.dT, b.x - r, b.rT, b.dT);
  }));
  const disRibbons = $derived(geo.slice(0, -1).map((a, i) => {
    const b = geo[i + 1], r = bw / 2;
    return ribbon(a.x + r, a.dT, baselineY, b.x - r, b.dT, baselineY);
  }));

  const destBar = $derived(dest ? { x: divX + 24, rT: yTop(dest.reach), bw: Math.min(54, (w - padR - divX - 30)) } : null);

  const C_DIS = '#9a3b2e';   // disadvantaged cleared (terracotta — the page's primary)
  const C_ADV = '#3f7d6e';   // advantaged cleared (teal)
  const C_MISS = 'rgba(28,22,17,0.13)';
  const C_DEST = '#566a8c';

  const sig = (n: number) => Math.abs(n) >= 500; // suppress noise deltas
  function deltaLabel(n: number): string { return `${n > 0 ? '+' : '−'}${fmtCompact(Math.abs(n))}`; }
</script>

<div class="funnel" bind:this={host}>
  <svg viewBox="0 0 {w} {H}" width="100%" height={H} role="img"
       aria-label="Synthetic cohort funnel: {cohortN.toLocaleString()} children through school-readiness, secondary-readiness and a strong GCSE pass, scenario versus status quo">
    <!-- ribbons (drawn first, behind the bars) -->
    {#each advRibbons as d}<path {d} fill={C_ADV} opacity="0.30" />{/each}
    {#each disRibbons as d}<path {d} fill={C_DIS} opacity="0.26" />{/each}

    <!-- academic gate bars -->
    {#each geo as ge}
      {@const g = ge.g}
      <!-- missed (below standard) -->
      <rect class="seg" x={ge.x - bw / 2} y={padT} width={bw} height={Math.max(0, ge.rT - padT)} fill={C_MISS} />
      <!-- advantaged cleared -->
      <rect class="seg" x={ge.x - bw / 2} y={ge.rT} width={bw} height={Math.max(0, ge.dT - ge.rT)} fill={C_ADV} opacity="0.92" />
      <!-- disadvantaged cleared -->
      <rect class="seg" x={ge.x - bw / 2} y={ge.dT} width={bw} height={Math.max(0, baselineY - ge.dT)} fill={C_DIS} opacity="0.92" />

      <!-- comparator high-water line (status quo, or Scenario B when comparing) -->
      <line x1={ge.x - bw / 2 - 5} x2={ge.x + bw / 2 + 5} y1={ge.ghostY} y2={ge.ghostY} class="ghost" class:cmp={comparing} />

      <!-- scenario vs status-quo delta -->
      {#if sig(g.delta)}
        <text x={ge.x} y={Math.min(ge.rT, ge.ghostY) - 5} class="delta {g.delta > 0 ? 'up' : 'down'}" text-anchor="middle">{deltaLabel(g.delta)}</text>
      {/if}

      <!-- gate labels -->
      <text x={ge.x} y={padT - 16} class="g-label" text-anchor="middle">{g.label}</text>
      <text x={ge.x} y={padT - 5} class="g-age" text-anchor="middle">{g.age}</text>
      <text x={ge.x} y={baselineY + 16} class="g-pct" text-anchor="middle">{g.pctAll.toFixed(0)}%</text>
      <text x={ge.x} y={baselineY + 28} class="g-count" text-anchor="middle">{fmtCompact(g.reach)}</text>
      <text x={ge.x} y={baselineY + 40} class="g-dis" text-anchor="middle">{fmtCompact(g.reachDis)} disadv ({g.pctDis.toFixed(0)}%)</text>
    {/each}

    <!-- divider before the destination context panel -->
    {#if destBar && dest}
      <line x1={divX} x2={divX} y1={padT - 22} y2={baselineY + 44} class="divider" />
      <rect class="seg dest" x={destBar.x} y={destBar.rT} width={destBar.bw} height={Math.max(0, baselineY - destBar.rT)} fill={C_DEST} opacity="0.82" />
      <line x1={destBar.x} x2={destBar.x + destBar.bw} y1={destBar.rT} y2={destBar.rT} class="dest-top" />
      <text x={destBar.x + destBar.bw / 2} y={padT - 16} class="g-label dest-lab" text-anchor="middle">In ed / work*</text>
      <text x={destBar.x + destBar.bw / 2} y={padT - 5} class="g-age" text-anchor="middle">{dest.age}</text>
      <text x={destBar.x + destBar.bw / 2} y={baselineY + 16} class="g-pct" text-anchor="middle">{dest.pctAll.toFixed(0)}%</text>
      <text x={destBar.x + destBar.bw / 2} y={baselineY + 28} class="g-count" text-anchor="middle">{fmtCompact(dest.reach)}</text>
      {#if sig(dest.delta)}
        <text x={destBar.x + destBar.bw / 2} y={destBar.rT - 5} class="delta {dest.delta > 0 ? 'up' : 'down'}" text-anchor="middle">{deltaLabel(dest.delta)}</text>
      {/if}
    {/if}
  </svg>

  <div class="cap">
    <div class="legend">
      <span class="lg"><i style="background:{C_DIS}"></i>Disadvantaged, cleared</span>
      <span class="lg"><i style="background:{C_ADV}"></i>Other pupils, cleared</span>
      <span class="lg"><i style="background:rgba(28,22,17,0.18)"></i>Below the standard</span>
      <span class="lg"><i class="dash" class:cmp={comparing}></i>{comparing ? comparatorName : 'Status quo (do-nothing)'} high-water</span>
    </div>
    <p class="note">
      One <b>synthetic cohort</b> of {cohortN.toLocaleString()} {regionName ? regionName + ' ' : ''}children ({disCohortN.toLocaleString()} disadvantaged) run through
      the <b>{horizon}</b> snapshot's age-5/11/16 rates — a period cohort, not a tracked birth cohort. The success stream visibly
      thins at each gate, and the disadvantaged sub-stream (terracotta) thins fastest — that wedge is the gap.
      <br /><span class="fn">* “In ed / work” is the 16–24 not-NEET rate on the whole 16–24 population (~6.55m) — shown for context beside the divider, <b>not</b> a flow from this 600k cohort.</span>
    </p>
  </div>
</div>

<style>
  .funnel { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-round); padding: 10px 12px 8px; }
  svg { display: block; }
  .seg { transition: y 0.28s ease, height 0.28s ease; }
  @media (prefers-reduced-motion: reduce) { .seg { transition: none; } }
  .ghost { stroke: rgba(28,22,17,0.55); stroke-width: 1.2; stroke-dasharray: 4 3; }
  .ghost.cmp { stroke: #3a5fa8; stroke-width: 1.4; }
  .divider { stroke: rgba(28,22,17,0.22); stroke-width: 1; stroke-dasharray: 2 3; }
  .dest-top { stroke: #566a8c; stroke-width: 1.4; stroke-dasharray: 4 3; }
  .g-label { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12px; fill: #1c1611; }
  .dest-lab { fill: #566a8c; }
  .g-age { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); }
  .g-pct { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13px; fill: #1c1611; }
  .g-count { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; fill: rgba(28,22,17,0.66); }
  .g-dis { font-family: 'JetBrains Mono', monospace; font-size: 8px; fill: #9a3b2e; }
  .delta { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; }
  .delta.up { fill: #2f7d4f; }
  .delta.down { fill: #b1455e; }
  .cap { margin-top: 6px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .lg { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.7); }
  .lg i { width: 11px; height: 8px; border-radius: var(--radius-sharp); display: inline-block; }
  .lg i.dash { width: 14px; height: 0; border-top: 1.4px dashed rgba(28,22,17,0.6); border-radius: 0; }
  .lg i.dash.cmp { border-top-color: var(--accent-ink); }
  .note { margin: 6px 0 0; font-size: 10.5px; line-height: 1.5; color: rgba(28,22,17,0.62); }
  .note b { color: var(--ink); }
  .fn { color: rgba(28,22,17,0.5); font-size: 10px; }
</style>
