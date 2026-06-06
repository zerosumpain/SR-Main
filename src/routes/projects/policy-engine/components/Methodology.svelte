<script lang="ts">
  import { LEVERS, GROUP_META } from '../lib/levers';
  import { SOURCES } from '../lib/sources';

  const confLabel: Record<string, string> = { high: 'well-evidenced', medium: 'moderate', low: 'weak', assumption: 'assumption' };

  // Key equations, shown verbatim so the calculations are fully transparent.
  const equations: { title: string; eq: string; note: string }[] = [
    {
      title: 'Lever response function',
      eq: 'dep = (value − baseline) / (max − baseline)\nf(dep) = (1 − e^(−1.8·dep)) / (1 − e^(−1.8))   [concave, diminishing returns]\nramp(t, τ) = 1 − e^(−Δyears / τ)               [geometric distributed lag]',
      note: 'Every lever contributes effect = maxEffect · f(dep) · ramp. Diminishing returns mean doubling a lever never doubles its effect; the lag τ ranges from ~1y (breakfast) to ~11y (early years → GCSE).',
    },
    {
      title: 'KS4 disadvantage gap (months)',
      eq: 'gap₍KS4₎(t) = 19.1 + 0.077·(PA_dis(t) − 29.9) + 0.10·(poverty(t) − 31) − Σ structural reductions',
      note: 'Decomposed into an absence component and a structural component. 0.077 months per pp of disadvantaged persistent absence comes from EPI’s finding that the +1-month post-2019 widening ≈ a +13pp rise in disadvantaged PA.',
    },
    {
      title: 'Disadvantaged persistent absence',
      eq: 'PA_dis(t) = 29.9 + 3.25·(absence(t) − 6.63) − 8·f(dep_attendance)·ramp\nabsence(t) = 6.63 − absCut(t) + 0.04·(poverty(t) − 31)',
      note: '3.25 = paLeverage (2.5) × paDisLeverage (1.3): disadvantaged absence is more sensitive to system absence. Mentors cut up to 8pp at full coverage.',
    },
    {
      title: 'Attainment level → disadvantaged sub-level',
      eq: 'A8_all(t) = 46.0 + teacherCapacityNorm·maxₜ·ramp + Σ other channels\nA8_dis(t) = A8_all(t) − 0.487·gap₍KS4₎(t)',
      note: 'Attainment runs through teacher capacity, not £/pupil. The conversion 0.487 A8-points/month is derived exactly so the 2025 baseline reproduces (46.0 − 0.487·19.1 = 36.7). Analogous conversions map KS2/GLD gaps to their sub-levels.',
    },
    {
      title: 'SEND stock-flow & the 2028 cliff',
      eq: 'ehcp%(t) = ehcp%(t−1) + increment·(1 − mitig) + bumps − divert\nincrement = noReform · (ceiling − ehcp%)/(ceiling − 5.3) · mhDamp\ndeficit(t) = deficit(t−1) + (DSG_spend(t) − funding(t))\nif year ≥ 2028:  funding/pupil −= 8·max(0, deficit − 3)',
      note: 'EHCP prevalence grows logistically; inclusion & early-SEND slow it; reform diverts to ISPs from 2030. When the statutory override ends (2028) the accumulated deficit drains mainstream funding — the modelled cliff.',
    },
    {
      title: 'Identification-by-age cost',
      eq: 'cost_band = pop(m) · SENprev(0.20) · (intensity/100) · unit£ / 1000   [£bn]\ntotal = Σ cost_band ;   stretch = total − baseline_total',
      note: 'A high-level estimate of identification + early-support cost. A front-loaded profile (more early-years/primary share) modestly lifts EHCP-pupil attainment and slows late escalation.',
    },
    {
      title: 'NEET (the exit boundary)',
      eq: 'NEET(t) = 13.3 + drift·(1 − mhDriftMitig)·t − 0.35·(A8_all − 46.0) − post16/MH terms',
      note: 'An exogenous youth-ill-health drift (Milburn) pushes NEET up; attainment, post-16/skills and mental-health support pull it down. Unqualified young people have ~2× the NEET rate.',
    },
    {
      title: 'Monte-Carlo & sensitivity',
      eq: 'each draw d:  sampleᵈ(band) = Triangular(low, central, high) · structMultᵈ\nP10/P50/P90 = percentiles over 180 draws ;  tornado swing = |KPI(min) − KPI(max)|',
      note: 'Effect-size bands are sampled independently per draw, plus a shared structural multiplier (~0.8–1.3) representing correlated model uncertainty so the fan does not collapse. The tornado swings each lever min→max with others held.',
    },
  ];

  const baselines = [
    ['Disadvantage gap at 16', '19.1 months', 'EPI Annual Report 2025'],
    ['Disadvantage gap at 11 / age 5', '10.0 / 4.7 months', 'EPI Annual Report 2025'],
    ['Attainment 8 (all) / gap', '46.0 / 15.5 pts', 'DfE KS4 2024/25; White Paper Annex'],
    ['Grade 5+ English & Maths', '~45.5% (disadv. ~25.8%)', 'DfE KS4 2024/25; EEF'],
    ['KS2 reading+writing+maths', '62% (disadv. 47%)', 'DfE KS2 2024/25'],
    ['Good Level of Development (age 5)', '68.3% (FSM gap 21.3pp)', 'DfE EYFSP 2024/25'],
    ['EHCP prevalence', '5.3% of pupils (638,700 plans)', 'DfE EES EHC plans 2025'],
    ['High-needs spend / deficit', '~£12bn / >£3bn', 'IFS Green Budget 2025 ch.5'],
    ['Persistent absence (all / disadv.)', '17.6% / 29.9%', 'DfE EES absence 2024/25'],
    ['Teachers (FTE) / 6,500 pledge gap', '468k / 6.5k', 'DfE SWC 2024; NFER 2025'],
    ['Child poverty (relative, AHC)', '31% (~4.5m)', 'DWP HBAI; CPAG'],
    ['NEET (16–24)', '13.3% (~840k)', 'DfE/ONS 2025; Milburn review 2026'],
  ];

  const techniques = [
    ['Cohort-component projection', 'A representative cohort ages through the system so early-years investment surfaces at GCSE ~11 years later.'],
    ['Elasticity response functions', 'Each lever maps to an outcome via an effect size with diminishing returns (saturating form), so doubling spend never doubles effect.'],
    ['Distributed lags', 'Geometric lag kernels: attendance ~2y, teachers ~4y, early years to KS4 ~11y with fade-out.'],
    ['Causal mediation', 'The KS4 gap = a structural component + an absence component, because EPI attributes the entire post-2019 widening to disadvantaged absence.'],
    ['Monte-Carlo simulation', 'Effect-size uncertainty is propagated by sampling every parameter band (plus a shared structural multiplier) to produce P10–P90 fan charts.'],
    ['Sensitivity (tornado) analysis', 'Each lever is swung min→max individually to rank policies by leverage on a chosen KPI.'],
    ['Cost-effectiveness accounting', '£ per month of gap closed, per Attainment-8 point, per extra grade-5 pupil, and SEND deficit avoided.'],
    ['Budget-constrained optimisation', 'The "Best value" preset runs a greedy allocator against the engine: it repeatedly spends on the lever with the best marginal gap-reduction-per-£ until a fixed annual budget is exhausted — near-optimal on this diminishing-returns surface, and re-solved to the selected horizon.'],
  ];

  const assumptions = [
    'Pupil Premium is modelled as a quality-moderated offset with wide uncertainty, NOT a clean £→attainment elasticity — there is no robust published estimate (EEF; Gorard 2022).',
    'The funded-childcare expansion is treated as largely gap-neutral: it is a working-parent subsidy buying the +3-month "quantity" effect, not the larger quality effects, and reaches few disadvantaged children.',
    'Attainment level is driven by teacher capacity, attendance and curriculum — not directly by £/pupil, whose elasticity is weak/near-zero at current spending (Jackson et al.; IFS).',
    'EHCP reform is double-edged: narrowing plans cuts the deficit but lowers SEND attainment and raises tribunals unless matched by mainstream investment.',
    'The DSG statutory override ends March 2028: from then, any accumulated high-needs deficit is serviced from general funds, cutting mainstream per-pupil funding and (above a threshold) flagging council insolvency — the modelled "cliff".',
    'A representative-cohort model: it shows direction, relative magnitude and interplay — not point forecasts.',
  ];

  const limitations = [
    'England only. Single representative cohort (no full age structure or regional/London-vs-rest breakdown).',
    'Effect sizes are transported from heterogeneous studies; many 2025/26 reforms (curriculum, RISE, report cards, EHCP reform) have NO evaluation yet, so their effects are priors with wide bands.',
    'The White Paper targets (Attainment 8 → 50, gap halved) are stated ambitions with no historical precedent at that pace — the model treats them as a stretch, not a forecast.',
    'Deadweight, displacement and general-equilibrium effects are only partially modelled. Not a fiscal scorecard.',
    'Monte-Carlo bands reflect parametric + a shared structural multiplier; they still understate deep structural/model uncertainty.',
    'Academy structural reform, multi-academy trusts and the end of forced academisation are treated as near-zero-net on attainment (the academisation premium is mixed/null in the evidence) and act only via the RISE lever.',
    'Regional cold spots (e.g. London ~10 months vs the West Midlands ~19 months) and place-based missions (Mission North East / Coastal) are out of scope of this national-aggregate model.',
    'Higher education, tuition fees and the Lifelong Learning Entitlement (post-18) are out of scope — the model stops at the 16–24 NEET / destinations boundary.',
  ];

</script>

<div class="method">
  <section>
    <h3>What this is</h3>
    <p>
      The Whitehall Model is an annual-step, system-dynamics + cohort simulation of the England schools
      system from 2025 to 2040. You move policy levers that mirror real, active and upcoming Department for
      Education policies; the engine recomputes outcomes through research-calibrated response functions. It
      is a <b>decision-support and sense-making tool</b> — its value is in showing direction, relative
      magnitude, interplay and trade-offs, not in predicting exact numbers.
    </p>
  </section>

  <section>
    <h3>The causal spine</h3>
    <pre class="spine">child poverty ─▶ home environment ─▶ age-5 gap ─▶ KS2 gap ─▶ KS4 gap   (≈40% of the age-16 gap is set by age 5)
funding ─▶ teacher capacity ─▶ attainment level                         (weak direct £→outcome link)
breakfast + attendance mentors ─▶ attendance ─▶ attainment & the gap     (the strongest single lever)
early SEND + inclusive mainstream ─▶ slows EHCP demand ─▶ shrinks deficit
EHCP reform ─▶ cuts deficit BUT harms SEND attainment & raises tribunals (unless matched by inclusion)
attainment ─▶ NEET                                                       (+ exogenous youth ill-health)</pre>
  </section>

  <section>
    <h3>Techniques</h3>
    <ul class="tech">
      {#each techniques as [name, desc]}
        <li><b>{name}.</b> {desc}</li>
      {/each}
    </ul>
  </section>

  <section>
    <h3>Key equations &amp; calculations</h3>
    <p>The full model is in <code>lib/engine.ts</code>; the calibrated parameters and their sources in
      <code>lib/params.ts</code>. The core relationships:</p>
    {#each equations as e}
      <div class="eqn">
        <span class="eq-title">{e.title}</span>
        <pre>{e.eq}</pre>
        <p class="eq-note">{e.note}</p>
      </div>
    {/each}
  </section>

  <section>
    <h3>Calibrated baselines (2025)</h3>
    <table>
      <thead><tr><th>Metric</th><th>Value</th><th>Source</th></tr></thead>
      <tbody>
        {#each baselines as [m, v, s]}<tr><td>{m}</td><td class="num">{v}</td><td class="src">{s}</td></tr>{/each}
      </tbody>
    </table>
  </section>

  <section>
    <h3>Levers &amp; evidence</h3>
    <table>
      <thead><tr><th>Lever</th><th>Represents</th><th>Confidence</th></tr></thead>
      <tbody>
        {#each LEVERS as L}
          <tr>
            <td><span class="dot" style="background:{GROUP_META[L.group].colour}"></span>{L.label}</td>
            <td class="src">{L.policyRef}</td>
            <td><span class="conf conf-{L.confidence}">{confLabel[L.confidence]}</span></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <section>
    <h3>Key assumptions</h3>
    <ul>{#each assumptions as a}<li>{a}</li>{/each}</ul>
  </section>

  <section>
    <h3>Limitations &amp; honesty</h3>
    <ul>{#each limitations as l}<li>{l}</li>{/each}</ul>
  </section>

  <section>
    <h3>Sources</h3>
    <ul class="srclist">
      {#each SOURCES as s}
        <li><a href={s.url} target="_blank" rel="noopener">{s.org} ↗</a> — {s.what}</li>
      {/each}
    </ul>
    <p class="caveat">
      Built autonomously from a single prompt: seven parallel research agents surveyed the policy landscape;
      every effect size is labelled by confidence and sourced or flagged as an explicit assumption. Figures
      reflect the evidence base as of mid-2026 and should be checked against primary sources before any real use.
    </p>
  </section>
</div>

<style>
  .method { display: flex; flex-direction: column; gap: 16px; max-width: 78ch; }
  section { display: flex; flex-direction: column; gap: 7px; }
  h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; margin: 0; color: var(--ink, #1c1611); }
  p { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78); }
  .spine {
    font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.7; white-space: pre-wrap;
    background: rgba(28,22,17,0.045); padding: 10px 12px; border-radius: 6px; color: rgba(28,22,17,0.82);
    border-left: 3px solid var(--ink, #1c1611); overflow-x: auto;
  }
  .eqn { margin-bottom: 10px; }
  .eq-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink, #1c1611); font-weight: 600; }
  .eqn pre { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; line-height: 1.6; white-space: pre-wrap; background: rgba(28,22,17,0.05); padding: 7px 10px; border-radius: 5px; margin: 3px 0 3px; color: rgba(28,22,17,0.85); border-left: 2px solid #7a5aa6; overflow-x: auto; }
  .eq-note { margin: 0; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.62); }
  ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 5px; }
  li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.78); }
  .tech li b { color: var(--ink, #1c1611); }
  table { border-collapse: collapse; width: 100%; font-size: 11.5px; }
  th { text-align: left; font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 4px 8px 4px 0; border-bottom: 1px solid rgba(28,22,17,0.15); }
  td { padding: 5px 8px 5px 0; border-bottom: 1px solid rgba(28,22,17,0.07); color: rgba(28,22,17,0.8); vertical-align: top; }
  td.num { font-family: 'JetBrains Mono', monospace; font-size: 11px; white-space: nowrap; }
  td.src { color: rgba(28,22,17,0.55); font-size: 10.5px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
  .conf { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.04em; text-transform: uppercase; padding: 2px 5px; border-radius: 3px; font-weight: 600; white-space: nowrap; }
  .conf-high { background: rgba(47,125,79,0.16); color: #2f7d4f; }
  .conf-medium { background: rgba(176,99,46,0.16); color: #b4632e; }
  .conf-low { background: rgba(177,69,94,0.16); color: #b1455e; }
  .conf-assumption { background: rgba(122,90,166,0.16); color: #7a5aa6; }
  .srclist li { line-height: 1.5; }
  .srclist a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; font-weight: 500; }
  .caveat { margin-top: 8px; font-size: 11px; font-style: italic; color: rgba(28,22,17,0.6); line-height: 1.5; }
</style>
