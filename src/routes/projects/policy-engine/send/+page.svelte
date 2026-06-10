<script lang="ts">
  // SEND — Field Study №7: the £12bn blind spot. The fiscal cliff everyone can
  // see, traced to the information failure underneath it. Acts: the 99% hero,
  // the demand curve, the tribunal machine, the money + override timeline,
  // placement economics, the five blind spots, the evidence vacuum, the
  // health-side queue, the reform bet, and the instrument asks.
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import { STORIES } from '../lib/stories';
  import {
    SEND_HERO, EHCP_SERIES, DEMAND_STATS, TRIBUNAL_SERIES, TRIBUNAL_NOTE, MONEY_STATS,
    OVERRIDE_TIMELINE, PLACE_COSTS, PLACE_NOTE, BLIND_SPOTS, VACUUM, QUEUE_STATS,
    QUEUE_NOTE, REFORM, SEND_ASKS, SEND_CLOSER,
  } from '../lib/sendIntel';

  const eli = $derived(app.narrative === 'eli5');

  // ---- chart 1: EHCP curve ----
  const C1 = { w: 720, h: 260, padL: 56, padR: 18, padT: 16, padB: 30 };
  const maxPlans = 660_000;
  const c1x = (year: number) => C1.padL + ((year - 2015) / 10) * (C1.w - C1.padL - C1.padR);
  const c1y = (v: number) => C1.padT + (1 - v / maxPlans) * (C1.h - C1.padT - C1.padB);
  const curvePath = EHCP_SERIES.map((d, i) => `${i === 0 ? 'M' : 'L'} ${c1x(d.year)} ${c1y(d.plans)}`).join(' ');
  const areaPath = `${curvePath} L ${c1x(2025)} ${c1y(0)} L ${c1x(2015)} ${c1y(0)} Z`;

  // ---- chart 2: tribunal bars ----
  const C2 = { w: 720, h: 200, padL: 88, barH: 38, gap: 18, padT: 18 };
  const maxAppeals = 26_000;
  const c2w = (v: number) => (v / maxAppeals) * (C2.w - C2.padL - 90);

  // ---- chart 3: place costs ----
  const C3 = { w: 720, h: 190, padL: 16, barH: 34, gap: 18, padT: 16 };
  const maxCost = 64_000;
  const c3w = (v: number) => (v / maxCost) * (C3.w - C3.padL - 110);
  const fmt = (n: number) => n >= 1000 ? `£${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : `£${n}`;
</script>

<svelte:head><title>SEND — the £12bn blind spot · Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.send} />

  <!-- ===================== 1 · the number ===================== -->
  <section class="block">
    <h2 class="pe-h2">1 · The number that frames everything</h2>
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
        ? 'The number of children with a legal support plan, every January since the plans were invented. It has never once gone down.'
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

  <!-- ===================== 3 · the tribunal machine ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The tribunal machine — the only feedback loop that works</h2>
    <div class="chart-scroll">
      <svg viewBox="0 0 {C2.w} {C2.h}" role="img" aria-label="SEND tribunal appeals: 7,000 in 2018-19 to about 25,000 in 2024-25, with 99% found for families">
        {#each TRIBUNAL_SERIES as t, i (t.year)}
          {@const y = C2.padT + i * (C2.barH + C2.gap)}
          <text x={C2.padL - 10} y={y + C2.barH / 2 + 4} class="ax" text-anchor="end">{t.year}</text>
          <rect x={C2.padL} {y} width={c2w(t.appeals)} height={C2.barH} rx="5" class="tbar" />
          <text x={C2.padL + c2w(t.appeals) + 8} y={y + C2.barH / 2 + 4} class="bar-lab">{t.appeals.toLocaleString()} appeals · {t.favour} for families</text>
        {/each}
      </svg>
    </div>
    <p class="note">{eli ? TRIBUNAL_NOTE.eli5 : TRIBUNAL_NOTE.research}</p>
  </section>

  <!-- ===================== 4 · the money ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · The money — a cliff, an override, a 90% bailout</h2>
    <div class="stat-tiles">
      {#each MONEY_STATS as s (s.big)}
        <div class="st warn"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
    <div class="ovr-tl">
      {#each OVERRIDE_TIMELINE as t (t.date)}
        <div class="ot">
          <span class="ot-date">{t.date}</span>
          <div class="ot-body"><span class="ot-title">{t.title}</span><p class="ot-det">{t.detail}</p></div>
        </div>
      {/each}
    </div>
  </section>

  <!-- ===================== 5 · placement economics ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · The placement economics</h2>
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

  <!-- ===================== 6 · the information crisis ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The information crisis — five blind spots</h2>
    <p class="cap">
      {eli
        ? 'Here’s the page’s real argument: the money crisis sits on top of an information crisis. Five things the state cannot see.'
        : 'The thesis act. Each blind spot below is a measurement the system does not have — and together they explain why demand surprises it, why provision varies wildly, and why the tribunal ends up as the arbiter of record.'}
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
  </section>

  <!-- ===================== 7 · the evidence vacuum ===================== -->
  <section class="block">
    <h2 class="pe-h2">7 · The evidence vacuum — nobody knows which placements work</h2>
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

  <!-- ===================== 8 · the health-side queue ===================== -->
  <section class="block">
    <h2 class="pe-h2">8 · The queue the 20-week clock can’t see</h2>
    <div class="stat-tiles">
      {#each QUEUE_STATS as s (s.big)}
        <div class="st warn"><span class="st-big">{s.big}</span><p class="st-lab">{eli ? s.eli5 : s.label}</p></div>
      {/each}
    </div>
    <p class="note">{eli ? QUEUE_NOTE.eli5 : QUEUE_NOTE.research}
      <a class="inline-link" href="/projects/policy-engine/jigsaw">Who owns the health-side pieces → the Jigsaw</a></p>
  </section>

  <!-- ===================== 9 · the reform bet ===================== -->
  <section class="block">
    <h2 class="pe-h2">9 · The reform on the table — and the wager underneath it</h2>
    <p class="note">{eli ? REFORM.eli5 : REFORM.research}</p>
    <div class="refrow">
      {#each REFORM.refs as r (r.url)}<a class="refchip" href={r.url} target="_blank" rel="noopener">{r.label} ↗</a>{/each}
    </div>
  </section>

  <!-- ===================== 10 · the asks ===================== -->
  <section class="block">
    <h2 class="pe-h2">10 · What to instrument — three asks, in priority order</h2>
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

  <a class="pe-next" href="/projects/policy-engine/memo">These asks, ranked against everything else → The Memo</a>
</div>

<style>
  .block { margin: 34px 0; }
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

  /* stat tiles */
  .stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr)); gap: 10px; margin-top: 14px; }
  .st { border: 1px solid rgba(28,22,17,0.14); border-radius: 10px; background: rgba(255,255,255,0.45); padding: 12px 14px; }
  .st.warn { border-color: rgba(177,69,94,0.4); background: rgba(177,69,94,0.04); }
  .st-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(20px, 3vw, 27px); color: var(--ink, #1c1611); }
  .st.warn .st-big { color: #8a2d3a; }
  .st-lab { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.72); }

  /* override timeline */
  .ovr-tl { margin-top: 16px; display: flex; flex-direction: column; gap: 0; max-width: 96ch; }
  .ot { display: flex; gap: 14px; padding: 10px 0; border-left: 2px solid rgba(138,45,58,0.35); padding-left: 16px; position: relative; }
  .ot::before { content: ''; position: absolute; left: -5px; top: 16px; width: 8px; height: 8px; border-radius: 50%; background: #8a2d3a; }
  .ot-date { flex: 0 0 96px; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; color: #8a2d3a; padding-top: 2px; }
  .ot-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: var(--ink, #1c1611); }
  .ot-det { margin: 3px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.72); }

  /* blind spots */
  .bs-list { display: flex; flex-direction: column; gap: 10px; max-width: 96ch; }
  .bs { display: flex; gap: 13px; align-items: flex-start; border: 1px dashed rgba(177,69,94,0.45); border-radius: 10px;
    background: rgba(177,69,94,0.04); padding: 12px 15px; }
  .bs-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; background: #8a2d3a; color: #fff;
    font-family: 'JetBrains Mono', monospace; font-size: 13px; display: inline-flex; align-items: center; justify-content: center; }
  .bs-body { display: flex; flex-direction: column; gap: 4px; }
  .bs-gap { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: #8a2d3a; }
  .bs-det { margin: 0; font-size: 12.5px; line-height: 1.55; color: rgba(28,22,17,0.76); }

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
