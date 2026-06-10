<script lang="ts">
  // TriageSimulator — the interactive centrepiece of the NEET field study: a synthetic
  // Year-11 cohort calibrated to PUBLISHED risk multipliers, demonstrating the
  // recall / precision / caseload trade-off of flagging the top X% by risk score.
  import { app } from '../lib/appState.svelte';
  import {
    STRATA, residualRR, triageAt, triageCurve, COHORT_SIZE, COHORT_BASE_RATE,
    type TriageMode, type TriageCurve,
  } from '../lib/triage';

  const eli = $derived(app.narrative === 'eli5');
  let flagPct = $state(10);
  let mode = $state<TriageMode>('weighted');

  // curves are deterministic per mode — compute once, cache at module scope
  const curveCache = new Map<TriageMode, TriageCurve>();
  function curveFor(m: TriageMode): TriageCurve {
    let c = curveCache.get(m);
    if (!c) { c = triageCurve(m, 200); curveCache.set(m, c); }
    return c;
  }
  const curve = $derived(curveFor(mode));
  const otherCurve = $derived(curveFor(mode === 'weighted' ? 'checklist' : 'weighted'));
  const point = $derived(triageAt(flagPct, mode));
  const idx = $derived(Math.max(0, Math.min(curve.flagPct.length - 1, Math.round(flagPct) - 1)));

  const fmtPct = (v: number, dp = 0) => `${(v * 100).toFixed(dp)}%`;
  const fmtK = (v: number) => v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v)}`;

  // ---- recall curve geometry ----
  const X0 = 52, X1 = 736, Y0 = 18, Y1 = 268;
  const cx = (f: number) => X0 + ((f - 1) / 39) * (X1 - X0);
  const cy = (r: number) => Y1 - r * (Y1 - Y0);
  const linePath = (xs: number[], ys: number[]) =>
    xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${cx(x).toFixed(1)} ${cy(ys[i]).toFixed(1)}`).join(' ');
  const bandPath = $derived(
    curve.flagPct.map((f, i) => `${i === 0 ? 'M' : 'L'} ${cx(f).toFixed(1)} ${cy(curve.recallP90[i]).toFixed(1)}`).join(' ')
    + ' ' + [...curve.flagPct].reverse().map((f, j) => {
      const i = curve.flagPct.length - 1 - j;
      return `L ${cx(f).toFixed(1)} ${cy(curve.recallP10[i]).toFixed(1)}`;
    }).join(' ') + ' Z'
  );

  // ---- waffle: 100 dots = the cohort at the chosen operating point ----
  const waffle = $derived.by(() => {
    const flaggedShare = flagPct / 100;
    const flaggedTrue = point.recall * COHORT_BASE_RATE;          // share of cohort
    const flaggedFalse = flaggedShare - flaggedTrue;
    const missedTrue = COHORT_BASE_RATE - flaggedTrue;
    const cells: ('ft' | 'ff' | 'mt' | 'rest')[] = [];
    const n = (v: number) => Math.round(v * 100);
    for (let i = 0; i < n(flaggedTrue); i++) cells.push('ft');
    for (let i = 0; i < n(flaggedFalse); i++) cells.push('ff');
    for (let i = 0; i < n(missedTrue); i++) cells.push('mt');
    while (cells.length < 100) cells.push('rest');
    return cells.slice(0, 100);
  });

  const modeLabel: Record<TriageMode, string> = { checklist: 'Checklist (RONI)', weighted: 'Weighted (NERI-style)' };
</script>

<div class="tri">
  <!-- controls -->
  <div class="tri-ctl">
    <div class="tc-slider">
      <span class="tc-lab">{eli ? 'Flag the riskiest…' : 'Flag the top'}</span>
      <input type="range" min="1" max="40" step="1" bind:value={flagPct} aria-label="Share of the cohort to flag" />
      <span class="tc-val">{flagPct}%</span>
      <span class="tc-sub">{eli ? 'of one school year-group' : `of the cohort (${fmtK(flagPct / 100 * COHORT_SIZE)} of ${fmtK(COHORT_SIZE)} Year 11s)`}</span>
    </div>
    <div class="tc-mode" role="group" aria-label="Scoring model">
      {#each (['checklist', 'weighted'] as TriageMode[]) as m}
        <button class:on={mode === m} onclick={() => (mode = m)}>{modeLabel[m]}</button>
      {/each}
    </div>
  </div>

  <!-- readouts -->
  <div class="tri-cards">
    <div class="tcard">
      <span class="tv">{fmtPct(point.recall)}</span>
      <span class="tl">{eli ? 'of future NEETs caught by the list' : 'recall — of future NEETs captured'}</span>
      <span class="tb">P10–P90: {fmtPct(curve.recallP10[idx])}–{fmtPct(curve.recallP90[idx])}</span>
    </div>
    <div class="tcard">
      <span class="tv">{fmtPct(point.precision)}</span>
      <span class="tl">{eli ? 'of flagged kids who actually become NEET' : 'precision — of the flag list who become NEET'}</span>
      <span class="tb">P10–P90: {fmtPct(curve.precisionP10[idx])}–{fmtPct(curve.precisionP90[idx])}</span>
    </div>
    <div class="tcard">
      <span class="tv">{point.falsePerTrue.toFixed(1)}</span>
      <span class="tl">{eli ? 'kids flagged “at risk” for every one who is' : 'false positives per true positive'}</span>
      <span class="tb">{eli ? 'each one a label that can stick' : 'every flag is a label and a caseload entry'}</span>
    </div>
    <div class="tcard">
      <span class="tv">{fmtK(point.caseloadPerLA)}</span>
      <span class="tl">{eli ? 'young people per council to support' : 'caseload per LA (÷153)'}</span>
      <span class="tb">{fmtK(point.flagged)} flagged nationally</span>
    </div>
  </div>

  <!-- recall curve -->
  <div class="tri-chart">
    <svg viewBox="0 0 760 300" role="img" aria-label="Recall against flag rate, with uncertainty band">
      {#each [0.25, 0.5, 0.75, 1] as g}
        <line x1={X0} x2={X1} y1={cy(g)} y2={cy(g)} class="grid" />
        <text x={X0 - 8} y={cy(g) + 3} class="ax-y">{fmtPct(g)}</text>
      {/each}
      {#each [10, 20, 30, 40] as g}
        <text x={cx(g)} y={Y1 + 16} class="ax-x">{g}%</text>
      {/each}
      <!-- random-flagging reference: flagging x% at random catches x% -->
      <line x1={cx(1)} y1={cy(0.01)} x2={cx(40)} y2={cy(0.4)} class="randline" />
      <text x={cx(33)} y={cy(0.33) + 14} class="rand-lab">no model: flag at random</text>
      <path d={bandPath} class="fan" />
      <path d={linePath(otherCurve.flagPct, otherCurve.recall)} class="curve other" />
      <path d={linePath(curve.flagPct, curve.recall)} class="curve main" />
      <circle cx={cx(flagPct)} cy={cy(curve.recall[idx])} r="6" class="dot" />
      <text x={cx(flagPct) + 10} y={cy(curve.recall[idx]) - 8} class="dot-lab">{flagPct}% → {fmtPct(curve.recall[idx])}</text>
      <text x={(X0 + X1) / 2} y={Y1 + 31} class="ax-title">→ share of the cohort flagged</text>
      <text x={14} y={(Y0 + Y1) / 2} class="ax-title" transform="rotate(-90 14 {(Y0 + Y1) / 2})">→ future NEETs caught</text>
    </svg>
    <p class="chart-note">
      {eli
        ? 'The thick line is the model you picked; the faint line is the other one. The shaded band shows how unsure the research numbers are. The dotted diagonal is what you’d get flagging kids at random.'
        : `Active model emphasised; the ${mode === 'weighted' ? 'checklist' : 'weighted'} curve shown faint for comparison. Fan = P10–P90 over the published risk-multiplier bands. The weighted index beats the unweighted checklist everywhere — the whole argument for NERI-style weighting in one chart.`}
    </p>
  </div>

  <!-- waffle -->
  <div class="tri-waffle">
    <div class="waffle" role="img" aria-label="100 dots representing the cohort at this operating point">
      {#each waffle as c, i (i)}<span class="w {c}"></span>{/each}
    </div>
    <div class="w-legend">
      <span class="wl"><i class="w ft"></i>{eli ? 'flagged & really at risk' : 'flagged, becomes NEET'}</span>
      <span class="wl"><i class="w ff"></i>{eli ? 'flagged but would’ve been fine' : 'flagged, false positive'}</span>
      <span class="wl"><i class="w mt"></i>{eli ? 'missed — becomes NEET anyway' : 'missed, becomes NEET'}</span>
      <span class="wl"><i class="w rest"></i>{eli ? 'everyone else' : 'true negatives'}</span>
    </div>
  </div>

  <!-- caveats: ALWAYS visible -->
  <div class="tri-caveats">
    <span class="cav-lab">⚠ {eli ? 'What this toy can and can’t tell you' : 'Caveats — read before drawing conclusions'}</span>
    <ul>
      {#if eli}
        <li>This is a <b>pretend year-group</b> built from real published research numbers — not real children.</li>
        <li>The risk numbers describe <b>who tends to end up NEET</b>, not what caused it — and not who an intervention would actually help.</li>
        <li>Real systems have messy data, delays and consent rules this toy ignores.</li>
        <li>Being likely to struggle isn’t the same as being <b>helpable</b> — the smartest systems target who would <i>benefit</i>, not just who is at risk.</li>
      {:else}
        <li><b>Synthetic cohort.</b> Strata shares and the overlap structure are approximated from published cross-tabs (DfE risk-factors May 2026; Impetus compound-disadvantage); the residual stratum (RR {residualRR().toFixed(2)}) is solved so the cohort reproduces the {fmtPct(COHORT_BASE_RATE)} base rate.</li>
        <li><b>Associational multipliers, not causal.</b> Risk markers predict; they don't explain, and they say nothing about treatment effect.</li>
        <li><b>The model ignores reality's frictions</b>: data quality, lag, the LA "not known" problem, consent and labelling ethics.</li>
        <li><b>Risk ≠ responsiveness.</b> The frontier is uplift modelling — targeting by who would <i>benefit from</i> an intervention, not who is most at risk (see the opportunity ladder below).</li>
        <li><b>No deployed English NEET model publishes these numbers.</b> That a toy on public multipliers can — and the national systems don't — is itself the finding.</li>
      {/if}
    </ul>
    <details class="strata">
      <summary>{eli ? 'The pretend year-group, group by group' : 'The synthetic strata (share × relative risk)'}</summary>
      <table>
        <thead><tr><th>{eli ? 'Group' : 'Stratum'}</th><th class="num">{eli ? 'Share' : 'Share'}</th><th class="num">{eli ? 'Risk vs average' : 'RR (low–high)'}</th><th class="num">{eli ? 'Checklist points' : 'RONI pts'}</th></tr></thead>
        <tbody>
          {#each STRATA as s (s.id)}
            <tr>
              <td>{eli ? s.eli5 : s.label}</td>
              <td class="num">{(s.share * 100).toFixed(1)}%</td>
              <td class="num">{s.rr ? `${s.rr.central.toFixed(1)}× (${s.rr.low.toFixed(1)}–${s.rr.high.toFixed(1)})` : `${residualRR().toFixed(2)}× (solved)`}</td>
              <td class="num">{s.checklistPoints}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </details>
  </div>
</div>

<style>
  .tri { display: flex; flex-direction: column; gap: 14px; }
  .tri-ctl { display: flex; align-items: center; gap: 14px 22px; flex-wrap: wrap; padding: 12px 14px;
    border: 1px solid rgba(28,22,17,0.14); border-radius: 10px; background: rgba(255,255,255,0.42); }
  .tc-slider { display: flex; align-items: center; gap: 10px; flex: 1 1 340px; flex-wrap: wrap; }
  .tc-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.6); }
  .tc-slider input { flex: 1; min-width: 140px; accent-color: #566a8c; }
  .tc-val { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; color: #566a8c; min-width: 60px; }
  .tc-sub { font-size: 11px; color: rgba(28,22,17,0.55); }
  .tc-mode { display: inline-flex; background: rgba(28,22,17,0.07); padding: 3px; border-radius: 8px; }
  .tc-mode button { background: transparent; border: none; color: var(--ink, #1c1611); padding: 6px 12px; border-radius: 6px;
    font-family: 'JetBrains Mono', monospace; font-size: 10.5px; cursor: pointer; }
  .tc-mode button.on { background: #566a8c; color: #fff; }

  .tri-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; }
  .tcard { display: flex; flex-direction: column; gap: 3px; padding: 11px 13px; border: 1px solid rgba(28,22,17,0.14);
    border-left: 3px solid #566a8c; border-radius: 9px; background: rgba(255,255,255,0.42); }
  .tv { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; line-height: 1; color: var(--ink, #1c1611); }
  .tl { font-size: 11px; line-height: 1.35; color: rgba(28,22,17,0.65); }
  .tb { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); }

  .tri-chart { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 12px 14px; overflow-x: auto; }
  .tri-chart svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .ax-x, .ax-y { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.5); }
  .ax-x { text-anchor: middle; } .ax-y { text-anchor: end; }
  .ax-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); text-anchor: middle; text-transform: uppercase; }
  .randline { stroke: rgba(28,22,17,0.4); stroke-width: 1.2; stroke-dasharray: 3 4; }
  .rand-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.45); text-anchor: end; }
  .fan { fill: rgba(86,106,140,0.14); stroke: none; }
  .curve { fill: none; }
  .curve.main { stroke: #566a8c; stroke-width: 2.6; }
  .curve.other { stroke: rgba(28,22,17,0.3); stroke-width: 1.4; }
  .dot { fill: #566a8c; stroke: var(--paper, #f1ead6); stroke-width: 2; }
  .dot-lab { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; fill: #3b4d6b; }
  .chart-note { margin: 8px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.62); }

  .tri-waffle { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .waffle { display: grid; grid-template-columns: repeat(20, 13px); gap: 4px; }
  .w { width: 13px; height: 13px; border-radius: 50%; display: inline-block; }
  .w.ft { background: #9a3b2e; }
  .w.ff { background: transparent; border: 2px solid #b1455e; width: 9px; height: 9px; }
  .w.mt { background: rgba(28,22,17,0.55); }
  .w.rest { background: rgba(28,22,17,0.12); }
  .w-legend { display: flex; flex-direction: column; gap: 5px; }
  .wl { display: inline-flex; align-items: center; gap: 7px; font-size: 11.5px; color: rgba(28,22,17,0.7); }
  .wl i { flex-shrink: 0; }

  .tri-caveats { border: 1px solid rgba(177,69,94,0.3); border-radius: 10px; background: rgba(177,69,94,0.04); padding: 12px 14px; }
  .cav-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    color: #8a2d3a; font-weight: 600; margin-bottom: 7px; }
  .tri-caveats ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
  .tri-caveats li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .tri-caveats b { color: var(--ink, #1c1611); }
  .strata { margin-top: 10px; }
  .strata summary { cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.06em; color: rgba(28,22,17,0.55); }
  .strata table { border-collapse: collapse; width: 100%; font-size: 11.5px; margin-top: 8px; }
  .strata th { text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 3px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.15); }
  .strata td { padding: 4px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.06); color: rgba(28,22,17,0.78); }
  .strata th.num, .strata td.num { text-align: right; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; white-space: nowrap; }
  @media (max-width: 560px) { .waffle { grid-template-columns: repeat(10, 13px); } }
</style>
