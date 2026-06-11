<script lang="ts">
  // SEND — Field Study №7: the £12bn system and its evidence base. A neutral,
  // analytical assessment of the England SEND machinery. Acts: the 99% read
  // precisely, the demand curve, the EHC needs-assessment pipeline as a
  // stock-and-flow, what the tribunal numbers each measure, high-needs funding
  // mechanics + the override timeline, placement economics, the measurement
  // gaps, the evidence vacuum, system edges (transition / AP / EP), the
  // health-side queue, the Isos diagnosis + the reform on the table, and the
  // open evidence questions. Composes StoryMasthead + bespoke SVG/CSS exhibits +
  // the shared engine-fused widgets (LeverChart / Contradiction / Analysis).
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import LeverChart from '../components/LeverChart.svelte';
  import Contradiction from '../components/Contradiction.svelte';
  import AnalysisOnOutcome from '../components/AnalysisOnOutcome.svelte';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';
  import { CONTRADICTIONS_BY_ID } from '../lib/contradictions';
  import { STORIES } from '../lib/stories';
  import {
    SEND_HERO, EHCP_SERIES, DEMAND_STATS,
    PIPELINE, PIPELINE_INTRO, PIPELINE_NOTE,
    TRIBUNAL_SERIES, TRIBUNAL_METRICS, TRIBUNAL_NOTE,
    MONEY_STATS, FUNDING_ELEMENTS, FUNDING_NOTE, OVERRIDE_TIMELINE,
    PLACE_COSTS, PLACE_NOTE, BLIND_SPOTS, VACUUM,
    SYSTEM_EDGES, QUEUE_STATS, QUEUE_NOTE,
    REFORM, ISOS, SEND_ASKS, SEND_CLOSER,
  } from '../lib/sendIntel';

  const eli = $derived(app.narrative === 'eli5');

  // ---- chart 1: EHCP curve ----
  const C1 = { w: 720, h: 260, padL: 56, padR: 18, padT: 16, padB: 30 };
  const maxPlans = 660_000;
  const c1x = (year: number) => C1.padL + ((year - 2015) / 10) * (C1.w - C1.padL - C1.padR);
  const c1y = (v: number) => C1.padT + (1 - v / maxPlans) * (C1.h - C1.padT - C1.padB);
  const curvePath = EHCP_SERIES.map((d, i) => `${i === 0 ? 'M' : 'L'} ${c1x(d.year)} ${c1y(d.plans)}`).join(' ');
  const areaPath = `${curvePath} L ${c1x(2025)} ${c1y(0)} L ${c1x(2015)} ${c1y(0)} Z`;

  // ---- exhibit: EHC pipeline funnel (stock-and-flow) ----
  // The first three stages are flows within the 2024 cohort (requests → assess →
  // plan), normalised against requests; the last two (new plans / in force) are
  // drawn on their own absolute scale, separated by a divider, because the stock
  // is ~6.5× any year's flow and would otherwise dwarf the funnel.
  const PF = { w: 720, rowH: 46, gap: 12, padL: 16, padR: 16, labW: 188, padT: 8 };
  const flowStages = PIPELINE.slice(0, 3);   // requests, assess, plan (cohort flow)
  const stockStages = PIPELINE.slice(3);     // new plans, in force
  const maxFlow = PIPELINE[0].value;         // 154,489 requests = 100%
  const maxStock = PIPELINE[PIPELINE.length - 1].value; // 638,745 in force
  const pfTrackW = PF.w - PF.padL - PF.padR - PF.labW;
  const pfFlowW = (v: number) => Math.max(4, (v / maxFlow) * pfTrackW);
  const pfStockW = (v: number) => Math.max(4, (v / maxStock) * pfTrackW);
  const pfH = PF.padT + (PIPELINE.length) * (PF.rowH + PF.gap) + 18;
  // y of the flow/stock divider (between the 3rd flow row and the stock rows)
  const pfDivY = PF.padT + flowStages.length * (PF.rowH + PF.gap) - PF.gap / 2 + 2;

  // ---- chart 2: tribunal bars ----
  const C2 = { w: 720, h: 200, padL: 88, barH: 38, gap: 18, padT: 18 };
  const maxAppeals = 26_000;
  const c2w = (v: number) => (v / maxAppeals) * (C2.w - C2.padL - 150);

  // ---- chart 3: place costs ----
  const C3 = { w: 720, h: 190, padL: 16, barH: 34, gap: 18, padT: 16 };
  const maxCost = 64_000;
  const c3w = (v: number) => (v / maxCost) * (C3.w - C3.padL - 110);
  const fmt = (n: number) => n >= 1000 ? `£${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `£${n}`;
  const fmtN = (n: number) => n.toLocaleString();
</script>

<svelte:head><title>SEND — the £12bn system · Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.send} />

  <!-- ===================== 1 · the number ===================== -->
  <section class="block">
    <h2 class="pe-h2">1 · The number, stated precisely</h2>
    <div class="hero99">
      <span class="h99-big">{SEND_HERO.big}</span>
      <p class="h99-lab">{eli ? SEND_HERO.labelEli5 : SEND_HERO.label}</p>
    </div>
    <p class="h99-kicker">{eli ? SEND_HERO.kicker.eli5 : SEND_HERO.kicker.research}</p>
    <div class="refrow">
      {#each SEND_HERO.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 2 · the demand curve ===================== -->
  <section class="block">
    <h2 class="pe-h2">2 · The demand curve</h2>
    <p class="cap">
      {eli
        ? 'The number of children with a legal support plan, every January since the plans began. It has not gone down once.'
        : 'EHC plans by January count, SEN2 series (2015 and 2024–25 endpoints verified in the 2025 release; intermediate years from the published series). Eleven years, eleven rises — and the inflow is accelerating: requests grew faster than plans in 2024.'}
    </p>
    <div class="chart-scroll">
      <svg viewBox="0 0 {C1.w} {C1.h}" role="img" aria-label="EHC plans 2015 to 2025, rising from 240,183 to 638,745">
        {#each [200_000, 400_000, 600_000] as g (g)}
          <line x1={C1.padL} x2={C1.w - C1.padR} y1={c1y(g)} y2={c1y(g)} class="grid" />
          <text x={C1.padL - 8} y={c1y(g) + 3} class="ax" text-anchor="end">{g / 1000}k</text>
        {/each}
        <path d={areaPath} class="area" />
        <path d={curvePath} class="curve" />
        {#each EHCP_SERIES as d (d.year)}
          <circle cx={c1x(d.year)} cy={c1y(d.plans)} r="3" class="dot" />
          <text x={c1x(d.year)} y={C1.h - 10} class="ax" text-anchor="middle">{String(d.year).slice(2)}</text>
        {/each}
        <text x={c1x(2015) + 6} y={c1y(240_183) - 10} class="pt-lab">240,183</text>
        <text x={c1x(2025) - 6} y={c1y(638_745) - 10} class="pt-lab end" text-anchor="end">638,745</text>
      </svg>
    </div>
    <div class="stat-tiles">
      {#each DEMAND_STATS as s (s.big)}
        <div class="st"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
  </section>

  <!-- ===================== 3 · the EHC pipeline (stock-and-flow) ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The EHC needs-assessment pipeline — as a stock-and-flow</h2>
    <p class="cap">{eli ? PIPELINE_INTRO.eli5 : PIPELINE_INTRO.research}</p>
    <div class="chart-scroll">
      <svg viewBox="0 0 {PF.w} {pfH}" role="img" aria-label="EHC pipeline: 154,489 requests, 65.4% proceed to assess, 93.6% of assessments yield a plan, 97,747 new plans, 638,745 in force">
        <!-- cohort-flow stages (normalised to requests) -->
        {#each flowStages as st, i (st.id)}
          {@const y = PF.padT + i * (PF.rowH + PF.gap)}
          <text x={PF.padL} y={y + 16} class="pf-name">{st.label}</text>
          <text x={PF.padL} y={y + 32} class="pf-pct">{st.pct}</text>
          <rect x={PF.padL + PF.labW} {y} width={pfFlowW(st.value)} height={PF.rowH} rx="6" class="pf-bar flow" class:refuse={st.id === 'assess'} />
          <text x={PF.padL + PF.labW + 10} y={y + PF.rowH / 2 + 5} class="pf-val">{fmtN(st.value)}</text>
        {/each}
        <!-- divider: flows above, stock below (separate scale) -->
        <line x1={PF.padL} x2={PF.w - PF.padR} y1={pfDivY} y2={pfDivY} class="pf-div" />
        <text x={PF.padL} y={pfDivY + 12} class="pf-divlab">— above: 2024 flow · below: standing stock (own scale) —</text>
        <!-- stock stages -->
        {#each stockStages as st, i (st.id)}
          {@const y = PF.padT + (flowStages.length + i) * (PF.rowH + PF.gap) + 14}
          <text x={PF.padL} y={y + 16} class="pf-name">{st.label}</text>
          <text x={PF.padL} y={y + 32} class="pf-pct">{st.pct}</text>
          <rect x={PF.padL + PF.labW} {y} width={pfStockW(st.value)} height={PF.rowH} rx="6" class="pf-bar stock" class:hi={st.id === 'stock'} />
          <text x={PF.padL + PF.labW + 10} y={y + PF.rowH / 2 + 5} class="pf-val light">{fmtN(st.value)}</text>
        {/each}
      </svg>
    </div>
    <div class="pf-detail">
      {#each PIPELINE as st (st.id)}
        <p class="pf-line"><span class="pf-tag">{st.label}</span> {eli ? st.eli5 : st.detail}</p>
      {/each}
    </div>
    <p class="note">{eli ? PIPELINE_NOTE.eli5 : PIPELINE_NOTE.research}</p>
    <div class="refrow">
      {#each PIPELINE_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 4 · the tribunal numbers, unpacked ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · The tribunal — two numbers, two questions</h2>
    <div class="chart-scroll">
      <svg viewBox="0 0 {C2.w} {C2.h}" role="img" aria-label="SEND tribunal appeals registered: 7,000 in 2018-19 rising to about 25,000 in 2024-25">
        {#each TRIBUNAL_SERIES as t, i (t.year)}
          {@const y = C2.padT + i * (C2.barH + C2.gap)}
          <text x={C2.padL - 10} y={y + C2.barH / 2 + 4} class="ax" text-anchor="end">{t.year}</text>
          <rect x={C2.padL} {y} width={c2w(t.appeals)} height={C2.barH} rx="5" class="tbar" />
          <text x={C2.padL + c2w(t.appeals) + 8} y={y + C2.barH / 2 + 4} class="bar-lab">{t.appeals.toLocaleString()} registered · {t.favour}</text>
        {/each}
      </svg>
    </div>
    <div class="metrics2">
      {#each TRIBUNAL_METRICS as m (m.big)}
        <div class="m2">
          <span class="m2-big">{m.big}</span>
          <span class="m2-q">{m.question}</span>
          <p class="m2-what">{eli ? m.eli5 : m.what}</p>
          <span class="m2-cited">{m.cited}</span>
        </div>
      {/each}
    </div>
    <p class="note">{eli ? TRIBUNAL_NOTE.eli5 : TRIBUNAL_NOTE.research}</p>
    <div class="refrow">
      {#each TRIBUNAL_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 5 · the money + mechanics ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · High-needs funding — the mechanics, the deficit, the override</h2>
    <div class="stat-tiles">
      {#each MONEY_STATS as s (s.big)}
        <div class="st warn"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>

    <h3 class="pe-h3">The three funding elements</h3>
    <p class="note">{eli ? FUNDING_NOTE.eli5 : FUNDING_NOTE.research}</p>
    <div class="elements">
      {#each FUNDING_ELEMENTS as e (e.el)}
        <div class="el" class:e3={e.el === 'Element 3'}>
          <span class="el-tag">{e.el}</span>
          <span class="el-amt">{e.amount}</span>
          <p class="el-what">{eli ? e.eli5 : e.what}</p>
        </div>
      {/each}
    </div>
    <div class="refrow">
      {#each FUNDING_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>

    <h3 class="pe-h3">The statutory override — extended to March 2028</h3>
    <div class="ovr-tl">
      {#each OVERRIDE_TIMELINE as t (t.date)}
        <div class="ot">
          <span class="ot-date">{t.date}</span>
          <div class="ot-body"><span class="ot-title">{t.title}</span><p class="ot-det">{t.detail}</p></div>
        </div>
      {/each}
    </div>

    <!-- the live contradiction on the cost driver -->
    <h3 class="pe-h3">What is driving the cost — the open disagreement</h3>
    <Contradiction c={CONTRADICTIONS_BY_ID['send-cost-driver']} />
    <AnalysisOnOutcome outcome="highNeedsDeficitStock" title="What the analysts find about the deficit" />

    <!-- live engine: the SEND levers driving the deficit + attainment -->
    <h3 class="pe-h3">The same levers, in the model</h3>
    <p class="note">{eli
      ? 'These are the actual model dials for special needs. Drag them to see the projected debt and GCSE results move — the same numbers every other page uses.'
      : 'The SEND levers, fused to the live engine. The deficit responds to high-needs uplift and reform intensity; SEND attainment responds to inclusion investment and specialist capacity — the same outcomes the whole interactive shares.'}</p>
    <LeverChart
      outcome="highNeedsDeficitStock"
      levers={['high_needs', 'ehcp_reform', 'inclusion_fund']}
      title="High-needs (DSG) deficit — your scenario" />
    <LeverChart
      outcome="ehcpAttainment8"
      levers={['inclusion_fund', 'ehcp_reform', 'send_pipeline']}
      title="SEND (EHCP) Attainment 8 — your scenario" />
  </section>

  <!-- ===================== 6 · placement economics ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The placement economics</h2>
    <div class="chart-scroll">
      <svg viewBox="0 0 {C3.w} {C3.h}" role="img" aria-label="Cost per place: mainstream about £8k, state special £23,900, independent special £61,500">
        {#each PLACE_COSTS as p, i (p.setting)}
          {@const y = C3.padT + i * (C3.barH + C3.gap)}
          <rect x={C3.padL} {y} width={c3w(p.cost)} height={C3.barH} rx="5" class="cbar" class:hi={i === 2} />
          <text x={C3.padL + 10} y={y + C3.barH / 2 + 4} class="cbar-name">{p.setting}</text>
          <text x={C3.padL + c3w(p.cost) + 8} y={y + C3.barH / 2 + 4} class="bar-lab"><tspan class="b">{fmt(p.cost)}</tspan>/yr · {p.note}</text>
        {/each}
      </svg>
    </div>
    <p class="note">{eli ? PLACE_NOTE.eli5 : PLACE_NOTE.research}</p>
    <div class="refrow">
      {#each PLACE_NOTE.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 7 · the measurement gaps ===================== -->
  <section class="block">
    <h2 class="pe-h2">7 · The measurement gaps — what the system cannot currently see</h2>
    <p class="cap">
      {eli
        ? 'A recurring finding across the sources: the funding pressure sits on top of a set of things the state cannot measure. Five of them.'
        : 'The analytical core. Each item below is a measurement the system does not hold — together they explain why demand surprises it, why identification varies, and why the tribunal ends up as the de-facto arbiter of record.'}
    </p>
    <div class="bs-list">
      {#each BLIND_SPOTS as b, i (b.gap)}
        <div class="bs">
          <span class="bs-n">{i + 1}</span>
          <div class="bs-body">
            <span class="bs-gap">{b.gap}</span>
            <p class="bs-det">{eli ? b.eli5 : b.detail}</p>
            {#if b.refs?.length}
              <div class="refrow">
                {#each b.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
    <AnalysisOnOutcome theme="data-gap" title="What the analysts find on the SEND data gap" />
  </section>

  <!-- ===================== 8 · the evidence vacuum ===================== -->
  <section class="block">
    <h2 class="pe-h2">8 · The placement-outcomes question — still unanswered</h2>
    <p class="note">{eli ? VACUUM.eli5 : VACUUM.research}</p>
    <div class="stat-tiles">
      {#each VACUUM.outcomes as s (s.big)}
        <div class="st"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
    <div class="refrow">
      {#each VACUUM.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 9 · the system edges ===================== -->
  <section class="block">
    <h2 class="pe-h2">9 · The system edges — transition, Alternative Provision, the EP bottleneck</h2>
    <div class="edges">
      {#each SYSTEM_EDGES as e (e.title)}
        <div class="edge">
          <span class="edge-t">{e.title}</span>
          <p class="edge-d">{eli ? e.eli5 : e.detail}</p>
          {#if e.refs?.length}
            <div class="refrow">
              {#each e.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- ===================== 10 · the health-side queue ===================== -->
  <section class="block">
    <h2 class="pe-h2">10 · The queue the 20-week clock does not see</h2>
    <div class="stat-tiles">
      {#each QUEUE_STATS as s (s.big)}
        <div class="st warn"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
    <p class="note">{eli ? QUEUE_NOTE.eli5 : QUEUE_NOTE.research}
      <a class="inline-link" href="/projects/policy-engine/jigsaw">Who owns the health-side pieces → the Jigsaw</a></p>
  </section>

  <!-- ===================== 11 · the Isos diagnosis + the reform ===================== -->
  <section class="block">
    <h2 class="pe-h2">11 · The Isos diagnosis — and the reform on the table</h2>
    <div class="isos">
      <div class="isos-head">
        <span class="isos-t">Isos Partnership — "Towards an effective SEND system" (2025)</span>
        <ConfidenceBadge level="medium" note="Sector-commissioned whole-system review; widely cited, not a controlled study" />
      </div>
      <p class="isos-body">{eli ? ISOS.eli5 : ISOS.research}</p>
      <ol class="isos-props">
        {#each ISOS.proposals as p (p)}<li>{p}</li>{/each}
      </ol>
      <div class="refrow">
        {#each ISOS.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
      </div>
    </div>
    <h3 class="pe-h3">The 2026 white paper</h3>
    <p class="note">{eli ? REFORM.eli5 : REFORM.research}</p>
    <div class="refrow">
      {#each REFORM.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 12 · open evidence questions ===================== -->
  <section class="block">
    <h2 class="pe-h2">12 · Open evidence questions — what better instrumentation would require</h2>
    <div class="asks">
      {#each SEND_ASKS as a, i (a.ask)}
        <div class="ask">
          <span class="ask-n">{i + 1}</span>
          <div class="ask-body">
            <span class="ask-t">{a.ask}</span>
            <p class="ask-w">{eli ? a.eli5 : a.what}</p>
          </div>
        </div>
      {/each}
    </div>
    <div class="closer">
      <p>{eli ? SEND_CLOSER.eli5 : SEND_CLOSER.research}</p>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/attendance">The signal that precedes it → Field Study №8: Attendance</a>
</div>

<style>
  .block { margin: 34px 0; }
  .pe-h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink, #1c1611); margin: 26px 0 8px; }
  .cap { margin: 0 0 16px; font-size: 14.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 92ch; }
  .note { margin: 12px 0 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.76); max-width: 96ch; }
  .inline-link { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; margin-left: 6px; }

  /* 1 · hero */
  .hero99 { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; padding: 18px 22px; border-radius: 14px;
    border: 1.5px solid rgba(177,69,94,0.45); background: rgba(177,69,94,0.06); max-width: 96ch; }
  .h99-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(56px, 9vw, 96px); line-height: 0.9; color: #8a2d3a; }
  .h99-lab { margin: 0; flex: 1 1 320px; font-size: 15px; line-height: 1.55; color: rgba(28,22,17,0.8); }
  .h99-kicker { margin: 12px 0 0; font-size: 13.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 96ch; }

  /* charts */
  .chart-scroll { overflow-x: auto; background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 10px; }
  .chart-scroll svg { display: block; width: 100%; min-width: 560px; height: auto; }
  .grid { stroke: rgba(28,22,17,0.1); stroke-width: 1; }
  .ax { font-family: 'JetBrains Mono', monospace; font-size: 10px; fill: rgba(28,22,17,0.55); }
  .area { fill: rgba(138,45,58,0.1); }
  .curve { fill: none; stroke: #8a2d3a; stroke-width: 2.2; }
  .dot { fill: #8a2d3a; }
  .pt-lab { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; fill: #8a2d3a; }
  .tbar { fill: rgba(138,45,58,0.75); }
  .bar-lab { font-family: 'DM Sans', sans-serif; font-size: 11.5px; fill: rgba(28,22,17,0.75); }
  .bar-lab .b { font-weight: 700; fill: var(--ink, #1c1611); }
  .cbar { fill: rgba(47,111,151,0.55); }
  .cbar.hi { fill: rgba(138,45,58,0.75); }
  .cbar-name { font-family: 'DM Sans', sans-serif; font-size: 11.5px; font-weight: 600; fill: #fff; }

  /* pipeline funnel */
  .pf-name { font-family: 'DM Sans', sans-serif; font-size: 12px; font-weight: 600; fill: var(--ink, #1c1611); }
  .pf-pct { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.55); }
  .pf-bar.flow { fill: rgba(47,111,151,0.6); }
  .pf-bar.flow.refuse { fill: rgba(154,123,31,0.55); }
  .pf-bar.stock { fill: rgba(138,45,58,0.55); }
  .pf-bar.stock.hi { fill: rgba(138,45,58,0.78); }
  .pf-val { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; fill: #fff; }
  .pf-val.light { fill: #fff; }
  .pf-div { stroke: rgba(28,22,17,0.2); stroke-width: 1; stroke-dasharray: 3 3; }
  .pf-divlab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: rgba(28,22,17,0.5); }
  .pf-detail { margin-top: 14px; display: flex; flex-direction: column; gap: 5px; max-width: 96ch; }
  .pf-line { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78); }
  .pf-tag { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 700; color: #2f6f97;
    background: rgba(47,111,151,0.08); border-radius: 4px; padding: 1px 6px; margin-right: 5px; white-space: nowrap; }

  /* stat tiles */
  .stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); gap: 10px; margin-top: 14px; }
  .st { border: 1px solid rgba(28,22,17,0.14); border-radius: 10px; background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .st.warn { border-color: rgba(177,69,94,0.4); background: rgba(177,69,94,0.04); }
  .st-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(20px, 3vw, 27px); color: var(--ink, #1c1611); }
  .st.warn .st-big { color: #8a2d3a; }
  .st-lab { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.72); }

  /* tribunal two-metric panel */
  .metrics2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 12px; margin-top: 16px; }
  .m2 { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid #8a2d3a; border-radius: 10px; background: rgba(255,255,255,0.45); padding: 13px 15px; display: flex; flex-direction: column; gap: 5px; }
  .m2-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(24px, 4vw, 34px); color: #8a2d3a; line-height: 1; }
  .m2-q { font-family: 'Fraunces', serif; font-style: italic; font-size: 13.5px; color: var(--ink, #1c1611); }
  .m2-what { margin: 2px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.78); }
  .m2-cited { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); margin-top: 2px; }

  /* funding elements */
  .elements { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 10px; margin-top: 12px; }
  .el { border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid #2f6f97; border-radius: 10px; background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .el.e3 { border-left-color: #8a2d3a; }
  .el-tag { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.55); }
  .el-amt { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 22px; color: var(--ink, #1c1611); margin: 3px 0 2px; }
  .el-what { margin: 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.74); }

  /* override timeline */
  .ovr-tl { margin-top: 12px; display: flex; flex-direction: column; gap: 0; max-width: 96ch; }
  .ot { display: flex; gap: 14px; padding: 10px 0; border-left: 2px solid rgba(138,45,58,0.35); padding-left: 16px; position: relative; }
  .ot::before { content: ''; position: absolute; left: -5px; top: 16px; width: 8px; height: 8px; border-radius: 50%; background: #8a2d3a; }
  .ot-date { flex: 0 0 108px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: #8a2d3a; padding-top: 2px; }
  .ot-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: var(--ink, #1c1611); }
  .ot-det { margin: 3px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.72); }

  /* measurement gaps */
  .bs-list { display: flex; flex-direction: column; gap: 10px; max-width: 96ch; }
  .bs { display: flex; gap: 13px; align-items: flex-start; border: 1px dashed rgba(177,69,94,0.45); border-radius: 10px;
    background: rgba(177,69,94,0.04); padding: 12px 15px; }
  .bs-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: #8a2d3a; color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
  .bs-body { display: flex; flex-direction: column; gap: 4px; }
  .bs-gap { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: #8a2d3a; }
  .bs-det { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); }

  /* system edges */
  .edges { display: flex; flex-direction: column; gap: 10px; max-width: 96ch; }
  .edge { border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid #4a7c7c; border-radius: 10px; background: rgba(74,124,124,0.05); padding: 12px 15px; }
  .edge-t { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--ink, #1c1611); }
  .edge-d { margin: 4px 0 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.78); }

  /* isos panel */
  .isos { border: 1px solid rgba(28,22,17,0.16); border-left: 3px solid #b4632e; border-radius: 10px; background: rgba(180,99,46,0.05); padding: 14px 16px; max-width: 96ch; }
  .isos-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .isos-t { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--ink, #1c1611); }
  .isos-body { margin: 9px 0 4px; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.8); }
  .isos-props { margin: 6px 0 4px; padding-left: 20px; display: flex; flex-direction: column; gap: 3px; }
  .isos-props li { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.76); }

  /* asks */
  .asks { display: flex; flex-direction: column; gap: 9px; max-width: 96ch; margin-bottom: 14px; }
  .ask { display: flex; gap: 12px; align-items: flex-start; border: 1px solid rgba(47,125,79,0.3); border-radius: 10px; padding: 11px 14px; background: rgba(47,125,79,0.04); }
  .ask-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: #2f7d4f; color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
  .ask-body { display: flex; flex-direction: column; gap: 3px; }
  .ask-t { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); }
  .ask-w { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .closer { border: 1px solid rgba(74,124,124,0.35); border-left: 3px solid #4a7c7c; border-radius: 10px;
    background: rgba(74,124,124,0.06); padding: 13px 16px; max-width: 96ch; }
  .closer p { margin: 0; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* citation chips */
  .refrow { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 9px; }
  .refchip { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: #2f6f97; text-decoration: none;
    border: 1px solid rgba(47,111,151,0.3); border-radius: 5px; padding: 2px 7px; background: rgba(47,111,151,0.05); }
  .refchip:hover { border-color: #2f6f97; background: rgba(47,111,151,0.1); }
</style>
