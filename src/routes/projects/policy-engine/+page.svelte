<script lang="ts">
  import { app } from './lib/appState.svelte';
  import { BASELINE } from './lib/params';

  const sH = $derived(app.viewSim.find((y) => y.year === app.horizon) ?? app.viewSim.at(-1)!);
  const bH = $derived(app.viewBase.find((y) => y.year === app.horizon) ?? app.viewBase.at(-1)!);
  const gapClosed = $derived(bH ? bH.gapKS4 - sH.gapKS4 : 0);

  const SECTIONS = [
    { drawer: true, n: '01', t: 'Levers', d: 'Open the drawer of 35 research-backed levers — or let the optimiser spend a budget for you. It pins open so you can tune while you watch the data.' },
    { href: '/projects/policy-engine/outcomes', n: '02', t: 'Outcomes', d: 'The disadvantage gap, attainment, the SEND funding cliff, absence and NEET — each chart with the narrative behind it.' },
    { href: '/projects/policy-engine/population', n: '03', t: 'Population', d: 'The same results as headcounts of real children: who clears each gate, who is lifted from poverty, child-years averted.' },
    { href: '/projects/policy-engine/regions', n: '04', t: 'Regions', d: 'The national model decomposed onto the nine English regions and the coastal cross-cut — with the 2026 area missions.' },
    { href: '/projects/policy-engine/method', n: '05', t: 'Method', d: 'Every equation, every source, the sensitivity analysis, and a written note on all 35 levers — including why money acts through teachers.' },
  ];
</script>

<svelte:head>
  <title>Education Policy Modelling — England Schools Simulator</title>
  <meta name="description" content="An interactive, research-backed simulation of England education policy 2025–2040: move the policy levers and watch the disadvantage gap, attainment, the SEND deficit and NEET respond — with cited sources, assumptions and uncertainty." />
</svelte:head>

<div class="pe-route hero-route">
  <section class="hero">
    <span class="pe-eyebrow">England schools · 2025–2040</span>
    <h1 class="hero-h1">Could England close its disadvantage gap?</h1>
    <p class="pe-lede">
      A disadvantaged sixteen-year-old in England leaves school roughly <b>nineteen months of learning</b> behind their peers — a gap
      that has stopped closing and, since the pandemic, begun to widen. This is a working model of the whole system: move the policy
      levers a government actually controls, and watch the gap, attainment, the SEND funding cliff and youth unemployment respond,
      year by year, to 2040.
    </p>

    {#if app.mounted}
      <div class="snapshot">
        <span class="snap-lab">Your scenario right now —<b> {app.scenarioName}</b>{#if app.region !== 'all'} · {app.regionName}{/if}, by {app.horizon}:</span>
        <div class="snap-nums">
          <span class="sn"><b class={gapClosed >= 0.05 ? 'good' : gapClosed <= -0.05 ? 'bad' : ''}>{gapClosed >= 0 ? '−' : '+'}{Math.abs(gapClosed).toFixed(1)}</b><small>months off the gap vs do-nothing</small></span>
          <span class="sn"><b>{sH.attainment8.toFixed(1)}</b><small>Attainment 8</small></span>
          <span class="sn"><b>£{sH.cumulativeCost.toFixed(0)}bn</b><small>cumulative cost</small></span>
        </div>
        <button class="pe-next" onclick={() => app.toggleDrawer()}>Open the levers &amp; build your scenario →</button>
      </div>
    {/if}
  </section>

  <section class="story pe-prose">
    <h2 class="pe-h2">What this is</h2>
    {#if app.narrative === 'eli5'}
      <p>
        It’s a <b>playable, pretend version of England’s school system</b>. You move the sliders a government actually controls, and it
        shows what might happen — to things like the gap between richer and poorer pupils — every year up to 2040. It’s built on real
        research, and it’s honest about what nobody knows for sure.
      </p>
      <p>
        Three things surprise people. <b>Getting kids to attend school is the single biggest lever.</b> <b>Helping under-fives matters
        most of all</b>, but takes about eleven years to show up in GCSE results. And <b>money on its own doesn’t fix results</b> — it
        only helps if it pays for more and better teachers. That’s why a giant funding slider can cost a fortune and barely move a chart
        unless you also staff the schools.
      </p>
      <p>
        It is <b>not</b> a crystal ball. It’s a place to ask “what would it actually take?”, see the hard trade-offs, and test an idea
        against the evidence.
      </p>
    {:else}
    <p>
      It is a <b>system-dynamics and cohort simulation</b>, calibrated to the Education Policy Institute’s gap estimates, DfE statistics,
      IFS spending analysis and the NFER workforce data, and wired to the policies actually on the table in 2026 — the Schools White
      Paper, the SEND reforms, the 6,500-teacher pledge, Best Start, the curriculum review, and the new area missions. Every effect size
      carries an uncertainty band and a citation, and the weak or contested links are flagged as such rather than hidden.
    </p>
    <p>
      It is built around a few hard truths from the evidence. <b>Attendance is the engine of the gap</b> — EPI attributes the entire
      post-2019 widening to disadvantaged pupils missing more school. <b>Early years matter most but pay off slowest</b>, reaching GCSE
      only after an eleven-year lag. And <b>money is not a lever on its own</b>: the link from per-pupil spending to attainment is close
      to zero, so funding only helps to the extent it buys teachers, specialists and retention. That last point is why a big funding
      slider can cost tens of billions and barely move a chart unless you also staff the system — a feature of the evidence, made
      explicit on the <a href="/projects/policy-engine/method">Method</a> page.
    </p>
    <p>
      It is <b>not</b> a forecast, and not a substitute for judgement. It is a transparent place to ask “what would it actually take?”,
      to see the trade-offs (the SEND deficit cliff, the cost of pay competitiveness, the regional concentration of the gap), and to
      pressure-test a stance against the research.
    </p>
    {/if}
  </section>

  <section class="sections">
    <h2 class="pe-h2">The study, in five parts</h2>
    <div class="sec-grid">
      {#each SECTIONS as s}
        {#if s.drawer}
          <button class="sec-card" onclick={() => app.toggleDrawer()}>
            <span class="sc-n">{s.n}</span><span class="sc-t">{s.t} →</span><span class="sc-d">{s.d}</span>
          </button>
        {:else}
          <a class="sec-card" href={s.href}>
            <span class="sc-n">{s.n}</span><span class="sc-t">{s.t} →</span><span class="sc-d">{s.d}</span>
          </a>
        {/if}
      {/each}
    </div>
  </section>
</div>

<style>
  .hero-route { max-width: 1000px; }
  .hero { padding: 10px 0 8px; max-width: 64ch; }
  .hero-h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(30px, 4.6vw, 46px); line-height: 0.98; letter-spacing: -0.025em; margin: 4px 0 14px; color: var(--ink); max-width: 16ch; }
  .snapshot { margin: 22px 0 8px; padding: 14px 16px; border: 1px solid rgba(28,22,17,0.14); border-radius: 10px; background: rgba(255,255,255,0.4); }
  .snap-lab { font-size: 12px; color: rgba(28,22,17,0.6); } .snap-lab b { color: var(--ink); }
  .snap-nums { display: flex; flex-wrap: wrap; gap: 22px; margin: 10px 0 12px; }
  .sn { display: flex; flex-direction: column; }
  .sn b { font-family: 'Fraunces', serif; font-weight: 600; font-size: 28px; line-height: 1; color: var(--ink); }
  .sn b.good { color: #2f7d4f; } .sn b.bad { color: #b1455e; }
  .sn small { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); margin-top: 3px; max-width: 18ch; }
  .story { margin: 22px 0; }
  .sections { margin: 26px 0 12px; }
  .sec-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .sec-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 15px; border: 1px solid rgba(28,22,17,0.14); border-radius: 10px;
    background: rgba(255,255,255,0.4); text-decoration: none; text-align: left; font: inherit; cursor: pointer; transition: transform 0.12s, box-shadow 0.12s, border-color 0.12s; }
  .sec-card:hover { transform: translateY(-2px); box-shadow: 0 8px 22px -14px rgba(0,0,0,0.4); border-color: rgba(28,22,17,0.3); }
  .sc-n { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.4); }
  .sc-t { font-family: 'Fraunces', serif; font-weight: 600; font-size: 18px; color: var(--ink); }
  .sc-d { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.66); }
</style>
