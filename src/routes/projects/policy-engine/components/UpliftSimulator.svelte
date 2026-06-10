<script lang="ts">
  // UpliftSimulator — the triage simulator's sequel: same synthetic cohort, but now a
  // budget buys PROGRAMME PLACES, and the question is who to give them to. Targeting
  // by risk vs targeting by treatment effect produce different lists — and different
  // numbers of NEET outcomes averted for the same money.
  import { app } from '../lib/appState.svelte';
  import { STRATA, residualRR } from '../lib/triage';
  import { UPLIFT, upliftAt, upliftCurve, type UpliftStrategy, type UpliftCurve } from '../lib/uplift';

  const eli = $derived(app.narrative === 'eli5');
  let budgetPct = $state(10);

  const curveCache = new Map<UpliftStrategy, UpliftCurve>();
  function curveFor(s: UpliftStrategy): UpliftCurve {
    let c = curveCache.get(s);
    if (!c) { c = upliftCurve(s, 200); curveCache.set(s, c); }
    return c;
  }
  const cu = $derived(curveFor('uplift'));
  const cr = $derived(curveFor('risk'));
  const idx = $derived(Math.max(0, Math.min(39, Math.round(budgetPct) - 1)));
  const pRisk = $derived(upliftAt(budgetPct, 'risk'));
  const pUp = $derived(upliftAt(budgetPct, 'uplift'));
  const advantage = $derived(pRisk.averted > 0 ? (pUp.averted / pRisk.averted - 1) * 100 : 0);

  const fmtK = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

  // ---- averted-vs-budget curve ----
  const X0 = 52, X1 = 736, Y0 = 18, Y1 = 248;
  const yMax = $derived(Math.max(...cu.avertedP90) * 1.06);
  const cx = (b: number) => X0 + ((b - 1) / 39) * (X1 - X0);
  const cy = $derived((v: number) => Y1 - (v / yMax) * (Y1 - Y0));
  const linePath = (xs: number[], ys: number[]) =>
    xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${cx(x).toFixed(1)} ${cy(ys[i]).toFixed(1)}`).join(' ');
  const bandPath = $derived(
    cu.budgetPct.map((b, i) => `${i === 0 ? 'M' : 'L'} ${cx(b).toFixed(1)} ${cy(cu.avertedP90[i]).toFixed(1)}`).join(' ')
    + ' ' + [...cu.budgetPct].reverse().map((b, j) => {
      const i = cu.budgetPct.length - 1 - j;
      return `L ${cx(b).toFixed(1)} ${cy(cu.avertedP10[i]).toFixed(1)}`;
    }).join(' ') + ' Z'
  );

  // ---- risk-vs-uplift scatter (the mismatch, visible) ----
  const SX0 = 60, SX1 = 340, SY0 = 16, SY1 = 196;
  const rrMax = 3.4, upMax = 0.10;
  const noneRR = residualRR();
  const sx = (rr: number) => SX0 + (rr / rrMax) * (SX1 - SX0);
  const sy = (up: number) => SY1 - (Math.min(up, upMax) / upMax) * (SY1 - SY0);
  const dots = STRATA.map((s) => ({
    id: s.id, label: eliLabel(s.id), rr: s.rr ? s.rr.central : noneRR, up: UPLIFT[s.id].central, share: s.share,
  }));
  function eliLabel(id: string): string {
    const s = STRATA.find((x) => x.id === id)!;
    return s.eli5;
  }
  const labelOf = (id: string) => {
    const s = STRATA.find((x) => x.id === id)!;
    return app.narrative === 'eli5' ? s.eli5 : s.label;
  };
</script>

<div class="up">
  <div class="up-ctl">
    <span class="uc-lab">{eli ? 'Programme places for the…' : 'Budget: places for'}</span>
    <input type="range" min="1" max="40" step="1" bind:value={budgetPct} aria-label="Share of the cohort given programme places" />
    <span class="uc-val">{budgetPct}%</span>
    <span class="uc-sub">{eli ? 'of the year-group' : 'of the cohort — same spend, two ways to choose who gets a place'}</span>
  </div>

  <div class="up-cards">
    <div class="ucard risk">
      <span class="uv">{fmtK(pRisk.averted)}</span>
      <span class="ul">{eli ? 'helped out of NEET — picking the riskiest' : 'NEET outcomes averted — targeting by RISK'}</span>
      <span class="ub">{pRisk.perTreated.toFixed(0)} averted per 1,000 places</span>
    </div>
    <div class="ucard uplift">
      <span class="uv">{fmtK(pUp.averted)}</span>
      <span class="ul">{eli ? 'helped out of NEET — picking who’d benefit most' : 'averted — targeting by TREATMENT EFFECT'}</span>
      <span class="ub">{pUp.perTreated.toFixed(0)} averted per 1,000 places</span>
    </div>
    <div class="ucard adv">
      <span class="uv">+{advantage.toFixed(0)}%</span>
      <span class="ul">{eli ? 'more young people helped, for exactly the same money' : 'more averted for the same budget'}</span>
      <span class="ub">{eli ? 'just by choosing differently' : 'the whole strategic argument, in one number'}</span>
    </div>
  </div>

  <div class="up-row">
    <div class="up-chart">
      <svg viewBox="0 0 760 280" role="img" aria-label="NEET outcomes averted against budget, for risk targeting versus uplift targeting">
        {#each [0.25, 0.5, 0.75, 1] as g}
          <line x1={X0} x2={X1} y1={cy(g * yMax)} y2={cy(g * yMax)} class="grid" />
          <text x={X0 - 8} y={cy(g * yMax) + 3} class="ax-y">{fmtK(g * yMax)}</text>
        {/each}
        {#each [10, 20, 30, 40] as g}<text x={cx(g)} y={Y1 + 16} class="ax-x">{g}%</text>{/each}
        <path d={bandPath} class="fan" />
        <path d={linePath(cr.budgetPct, cr.averted)} class="curve risk" />
        <path d={linePath(cu.budgetPct, cu.averted)} class="curve uplift" />
        <circle cx={cx(budgetPct)} cy={cy(cu.averted[idx])} r="6" class="dot uplift" />
        <circle cx={cx(budgetPct)} cy={cy(cr.averted[idx])} r="5" class="dot risk" />
        <text x={(X0 + X1) / 2} y={Y1 + 31} class="ax-title">→ share of the cohort given a place</text>
        <text x={14} y={(Y0 + Y1) / 2} class="ax-title" transform="rotate(-90 14 {(Y0 + Y1) / 2})">→ NEET outcomes averted</text>
        <text x={X1 - 6} y={cy(cu.averted[39]) - 8} class="cl uplift" text-anchor="end">{eli ? 'pick who’d benefit' : 'uplift targeting'}</text>
        <text x={X1 - 6} y={cy(cr.averted[39]) + 16} class="cl risk" text-anchor="end">{eli ? 'pick the riskiest' : 'risk targeting'}</text>
      </svg>
    </div>

    <div class="up-scatter">
      <svg viewBox="0 0 380 230" role="img" aria-label="Risk versus responsiveness per group">
        <line x1={SX0} x2={SX1} y1={SY1} y2={SY1} class="grid" />
        <line x1={SX0} x2={SX0} y1={SY0} y2={SY1} class="grid" />
        {#each dots as d (d.id)}
          <circle cx={sx(d.rr)} cy={sy(d.up)} r={4 + d.share * 30} class="sdot" class:hi={d.id === 'pa_fsm' || d.id === 'pa'} class:lo={d.id === 'compound' || d.id === 'ehcp' || d.id === 'care'} />
          <text x={sx(d.rr)} y={sy(d.up) - 9} class="slab" text-anchor="middle">{labelOf(d.id)}</text>
        {/each}
        <text x={(SX0 + SX1) / 2} y={SY1 + 24} class="ax-title">→ risk (likelihood of NEET)</text>
        <text x={16} y={(SY0 + SY1) / 2} class="ax-title" transform="rotate(-90 16 {(SY0 + SY1) / 2})">→ how much a place helps</text>
      </svg>
      <p class="sc-note">{eli
        ? 'If risk and helpability were the same thing, the dots would line up. They don’t: the riskiest groups (bottom right) often benefit least from a work programme, because their barrier is something else.'
        : 'The mismatch, plotted. The highest-risk strata sit bottom-right: multi-barrier and health/provision-driven groups where an employment-side programme addresses the wrong constraint. Risk-ranking spends there first.'}</p>
    </div>
  </div>

  <div class="up-caveats">
    <span class="cav-lab">⚠ {eli ? 'The honest catch' : 'Why these numbers are illustrative — and why that is the finding'}</span>
    <ul>
      {#if eli}
        <li>The “how much a place helps” numbers are <b>made up but shaped by real evidence</b> — nobody in the UK has measured them properly for NEET programmes.</li>
        <li>Measuring them is exactly what linking <b>real programme trials to the government’s earnings data</b> would do. The ingredients exist; the link hasn’t been built.</li>
        <li>Until then, every NEET programme in England is targeted by risk — which this toy suggests leaves a lot of help on the table.</li>
      {:else}
        <li><b>The uplift bands are illustrative-by-necessity.</b> No UK per-group treatment-effect estimates for NEET programmes exist. The qualitative shape follows the evidence (causal-forest analyses of US summer-jobs RCTs; YFF toolkit; the health segment's stickiness), the magnitudes do not.</li>
        <li><b>The UK uniquely has the ingredients to estimate them for real</b>: Youth Futures Foundation's RCT portfolio × LEO's 5-year outcomes. That linkage is rung 8 of the opportunity ladder — and the strongest data-strategy case on this page.</li>
        <li><b>Current practice is risk-targeting by default</b> (RONI lists → support). If the real uplift surface looks anything like this one, that default forgoes a material share of avertable NEET outcomes at fixed budget.</li>
      {/if}
    </ul>
  </div>
</div>

<style>
  .up { display: flex; flex-direction: column; gap: 14px; }
  .up-ctl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 14px;
    border: 1px solid rgba(28,22,17,0.14); border-radius: 10px; background: rgba(255,255,255,0.42); }
  .uc-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.6); }
  .up-ctl input { flex: 1; min-width: 140px; accent-color: #7a5aa6; }
  .uc-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; color: #7a5aa6; min-width: 60px; }
  .uc-sub { font-size: 11px; color: rgba(28,22,17,0.55); }

  .up-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
  .ucard { display: flex; flex-direction: column; gap: 3px; padding: 11px 13px; border: 1px solid rgba(28,22,17,0.14); border-radius: 9px; background: rgba(255,255,255,0.42); }
  .ucard.risk { border-left: 3px solid rgba(28,22,17,0.45); }
  .ucard.uplift { border-left: 3px solid #7a5aa6; }
  .ucard.adv { border-left: 3px solid #2f7d4f; background: rgba(47,125,79,0.05); }
  .uv { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; line-height: 1; color: var(--ink, #1c1611); }
  .ucard.adv .uv { color: #2f7d4f; }
  .ul { font-size: 11px; line-height: 1.35; color: rgba(28,22,17,0.65); }
  .ub { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); }

  .up-row { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(260px, 1fr); gap: 12px; align-items: start; }
  @media (max-width: 900px) { .up-row { grid-template-columns: 1fr; } }
  .up-chart, .up-scatter { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 12px 14px; }
  .up-chart svg, .up-scatter svg { display: block; width: 100%; height: auto; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .ax-x, .ax-y { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.5); }
  .ax-x { text-anchor: middle; } .ax-y { text-anchor: end; }
  .ax-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); text-anchor: middle; text-transform: uppercase; }
  .fan { fill: rgba(122,90,166,0.13); stroke: none; }
  .curve { fill: none; }
  .curve.uplift { stroke: #7a5aa6; stroke-width: 2.6; }
  .curve.risk { stroke: rgba(28,22,17,0.45); stroke-width: 1.6; stroke-dasharray: 5 3; }
  .dot.uplift { fill: #7a5aa6; stroke: var(--paper, #f1ead6); stroke-width: 2; }
  .dot.risk { fill: rgba(28,22,17,0.55); stroke: var(--paper, #f1ead6); stroke-width: 2; }
  .cl { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600; }
  .cl.uplift { fill: #7a5aa6; } .cl.risk { fill: rgba(28,22,17,0.55); }
  .sdot { fill: rgba(86,106,140,0.5); stroke: #566a8c; stroke-width: 1; }
  .sdot.hi { fill: rgba(122,90,166,0.55); stroke: #7a5aa6; }
  .sdot.lo { fill: rgba(177,69,94,0.4); stroke: #b1455e; }
  .slab { font-family: 'DM Sans', sans-serif; font-size: 8px; fill: rgba(28,22,17,0.6); }
  .sc-note { margin: 8px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.62); }

  .up-caveats { border: 1px solid rgba(122,90,166,0.35); border-radius: 10px; background: rgba(122,90,166,0.05); padding: 12px 14px; }
  .cav-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: #5d4480; font-weight: 600; margin-bottom: 7px; }
  .up-caveats ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
  .up-caveats li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .up-caveats b { color: var(--ink, #1c1611); }
</style>
