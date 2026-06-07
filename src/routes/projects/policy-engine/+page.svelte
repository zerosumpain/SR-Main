<script lang="ts">
  import { app } from './lib/appState.svelte';
</script>

<svelte:head>
  <title>Education Policy Modelling — England Schools Simulator</title>
  <meta name="description" content="An interactive, research-backed simulation of England education policy 2025–2040: move the policy levers and watch the disadvantage gap, attainment, the SEND deficit and NEET respond — with cited sources, assumptions and uncertainty." />
</svelte:head>

<div class="pe-route wide">
  <section class="hero">
    <span class="pe-eyebrow">England schools · 2025–2040</span>
    <h1 class="hero-h1">Could England close its disadvantage gap?</h1>
    <p class="hero-lede">
      A disadvantaged sixteen-year-old in England leaves school roughly <b>nineteen months of learning</b> behind their peers — a gap
      that has stopped closing and, since the pandemic, begun to widen. This is a working model of the whole system: move the policy
      levers a government actually controls, and watch the gap, attainment, the SEND funding cliff and youth unemployment respond,
      year by year, to 2040.
    </p>
    <div class="cta-row">
      <button class="pe-next" onclick={() => app.toggleDrawer()}>Open the levers &amp; start →</button>
      <a class="cta-ghost" href="/projects/policy-engine/outcomes">or jump to the outcomes</a>
      <button class="cta-ghost as-btn" onclick={() => (app.showHelp = true)}>How does this work?</button>
    </div>
  </section>

  <section class="story pe-prose cols">
    {#if app.narrative === 'eli5'}
      <p>
        <b>What is this?</b> It’s a playable, pretend version of England’s school system. You move the sliders a government actually
        controls, and it shows what might happen — to things like the gap between richer and poorer pupils — every year up to 2040.
        It’s built on real research, and honest about what nobody knows for sure.
      </p>
      <p>
        Three things surprise people. <b>Getting kids to attend school is the single biggest lever.</b> <b>Helping under-fives matters
        most of all</b>, but takes about eleven years to show up in GCSE results. And <b>money on its own doesn’t fix results</b> — it
        only helps if it pays for more and better teachers. That’s why a giant funding slider can cost a fortune and barely move a chart
        unless you also staff the schools.
      </p>
      <p>
        It is <b>not</b> a crystal ball. It’s a place to ask “what would it actually take?”, see the hard trade-offs, and test an idea
        against the evidence. Flip <b>Explain it as</b> at the top of the page between <i>Research</i> and <i>ELI5</i> to read everything
        in plain or technical language.
      </p>
    {:else}
      <p>
        <b>What this is.</b> A <b>system-dynamics and cohort simulation</b>, calibrated to the Education Policy Institute’s gap estimates,
        DfE statistics, IFS spending analysis and NFER workforce data, and wired to the policies actually on the table in 2026 — the
        Schools White Paper, the SEND reforms, the 6,500-teacher pledge, Best Start, the curriculum review, and the new area missions.
        Every effect size carries an uncertainty band and a citation, and the weak or contested links are flagged rather than hidden.
      </p>
      <p>
        It is built around a few hard truths from the evidence. <b>Attendance is the engine of the gap</b> — EPI attributes the entire
        post-2019 widening to disadvantaged pupils missing more school. <b>Early years matter most but pay off slowest</b>, reaching GCSE
        only after an eleven-year lag. And <b>money is not a lever on its own</b>: the link from per-pupil spending to attainment is close
        to zero, so funding only helps to the extent it buys teachers, specialists and retention — which is why a big funding slider can
        cost tens of billions and barely move a chart unless you also staff the system.
      </p>
      <p>
        It is <b>not</b> a forecast, and not a substitute for judgement. It is a transparent place to ask “what would it actually take?”,
        to see the trade-offs (the SEND deficit cliff, the cost of pay competitiveness, the regional concentration of the gap), and to
        pressure-test a stance against the research. Use the <b>Explain it as</b> toggle (top of every page) to switch between the full
        research narrative and a plain-English one.
      </p>
    {/if}
  </section>
</div>

<style>
  .hero { padding: 18px 0 6px; }
  .hero-h1 { font-family: 'Fraunces', serif; font-weight: 600; font-size: clamp(34px, 6.2vw, 66px); line-height: 0.96; letter-spacing: -0.03em; margin: 6px 0 16px; color: var(--ink); }
  .hero-lede { font-size: clamp(17px, 1.6vw, 20px); line-height: 1.55; color: rgba(28,22,17,0.74); margin: 0 0 18px; max-width: 52ch; }
  .cta-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .cta-ghost { font-family: 'DM Sans', sans-serif; font-size: 13px; color: #2f6f97; text-decoration: none; border: none; background: none; cursor: pointer; padding: 0; border-bottom: 1px dashed currentColor; }
  .cta-ghost:hover { color: #1c4a66; }
  .story { margin: 30px 0 8px; padding-top: 22px; border-top: 1px solid rgba(28,22,17,0.12); }
</style>
