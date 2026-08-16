<script lang="ts">
  import { app } from './lib/appState.svelte';
  import AskModel from './components/AskModel.svelte';
</script>

<svelte:head>
  <title>Education Policy Modelling — England Schools Simulator</title>
  <meta name="description" content="A research-backed working model of England's school system, 2025–2040: move the policy levers and watch attainment, the disadvantage gap, the SEND deficit, absence and NEET respond together — plus intelligence field studies and a cross-cutting evidence synthesis on the data needed to steer any of it." />
</svelte:head>

<div class="pe-route wide">
  <section class="hero">
    <span class="pe-eyebrow">England schools · 2025–2040</span>
    <h1 class="hero-h1">What would it actually take?</h1>
    <p class="hero-lede">
      A working model of <b>England’s whole school system</b> — and the intelligence to steer it. Move the <b>39 policies</b> a
      government actually controls and watch the dashboard respond together, year by year to 2040: GCSE attainment, the
      <b>disadvantage gap</b> (still ~nineteen months at sixteen), the <b>SEND funding cliff</b>, school absence, child poverty,
      <b>youth unemployment</b> and the teacher workforce — nationally, by region, and in real numbers of children. Then go deeper:
      nine <b>field studies</b> pull the threads inside the system — from the <b>early years</b>, where most of the gap is set before
      age 5, to SEND, attendance and NEET — each ending in the same strategic question, <b>what data would tell us this is working?</b>
      A <b>Themes</b> synthesis then reads across them: what the studies say in common, what the outside analysts find, and where the
      evidence is genuinely contested.
    </p>
    <div class="cta-row">
      <a class="pe-next" href="/projects/policy-engine/outcomes" onclick={() => app.openDrawer()}>Open the levers &amp; start →</a>
      <a class="cta-ghost" href="/projects/policy-engine/outcomes">or read the Briefing</a>
      <button class="cta-ghost as-btn" onclick={() => (app.showHelp = true)}>How does this work?</button>
    </div>
  </section>

  <section class="story pe-prose cols">
    {#if app.narrative === 'eli5'}
      <p>
        <b>What is this?</b> It’s a playable, pretend version of England’s school system. You move the sliders a government actually
        controls, and it shows what might happen every year up to 2040. It’s built on real research, and open about what nobody
        knows for sure. It doesn’t only track the gap between richer and poorer pupils: it follows <b>GCSE results</b>, <b>special-needs
        support and its growing debt</b>, kids <b>missing school</b>, child poverty, and <b>young people with no job or training</b> —
        for the whole country and broken down by area.
      </p>
      <p>
        Three findings stand out. <b>In the model, getting kids to attend school is the strongest single lever.</b> <b>Helping under-fives
        has the biggest long-run effect</b>, but takes about eleven years to show up in GCSE results. And <b>whether money on its own lifts
        results is genuinely debated</b> — some studies find little effect at the amounts England already spends, others find clear gains
        when the money reaches teaching. This model takes the cautious view and assumes funding helps mainly by paying for more and better
        teachers, so a giant funding slider barely moves a chart unless you also staff the schools. Treat that as an assumption to test, not a fact.
      </p>
      <p>
        It is <b>not</b> a crystal ball. It’s a place to ask “what would it actually take?”, see the hard trade-offs, and test an idea
        against the evidence. And half the site isn’t about the simulator at all: the <b>field studies</b> dig into who’s actually
        making a difference, what other countries do, and the data the government would need to spot problems early — from the
        under-fives, where the gap opens, to young people drifting out of work and the wide differences between regions. Flip <b>Explain it as</b> at the top of the page between
        <i>Research</i> and <i>ELI5</i> to read everything in plain or technical language.
      </p>
    {:else}
      <p>
        <b>What this is.</b> A <b>system-dynamics and cohort simulation</b>, calibrated to the Education Policy Institute’s gap estimates,
        DfE statistics, IFS spending analysis and NFER workforce data, and wired to the policies actually on the table in 2026 — the
        Schools White Paper, the SEND reforms, the 6,500-teacher pledge, Best Start, the curriculum review, and the new area missions.
        Every effect size carries an uncertainty band and a citation, and the weak or contested links are flagged rather than hidden.
        It tracks more than a dozen outcomes at once — not just the gap, but GCSE attainment, the <b>EHCP/SEND system and its 2028
        funding cliff</b>, absence, child poverty, <b>NEET</b> and the teacher shortfall — nationally, across the <b>nine English
        regions</b>, and as headcounts of real children.
      </p>
      <p>
        It is built around a few findings from the evidence — each of them debated, and treated here as an assumption you can test rather
        than a settled fact. <b>EPI attributes most of the post-2019 widening of the gap to disadvantaged pupils missing more school</b>,
        which is why attendance is the model’s strongest single lever. <b>Early-years investment carries the largest long-run effect but the
        slowest</b>, reaching GCSE only after an eleven-year lag. And <b>the link from per-pupil spending to attainment is contested</b>:
        some studies find it weak at England’s current spending levels, while quasi-experimental school-finance-reform studies (Jackson,
        Johnson &amp; Persico; Lafortune et al.) find clear gains, especially for disadvantaged pupils, where the money reaches teaching.
        This model takes the cautious reading and routes funding <i>through</i> teacher capacity, so a funding slider moves the charts only
        to the extent it buys staff and retention — a modelling choice, not a verdict on whether money matters.
      </p>
      <p>
        It is <b>not</b> a forecast, and not a substitute for judgement. It is a transparent place to ask “what would it actually take?”,
        to see the trade-offs (the SEND deficit cliff, the cost of pay competitiveness, the regional concentration of the gap), and to
        pressure-test a stance against the research. The simulator is also only half of it: each <b>field study</b> is an intelligence
        exploration — exemplar places and programmes with honest evidence tiers, international response patterns, the NEET early-warning
        case, the data-sharing settlement — converging on one strategic thread: <b>how the department should use data to know whether any
        of this is working</b>. Use the <b>Explain it as</b> toggle (top of every page) to switch between the full research narrative
        and a plain-English one.
      </p>
    {/if}
  </section>

  <section class="ask-section">
    <span class="pe-eyebrow">Ask the model</span>
    <h2 class="ask-h">Put a question to the project</h2>
    <p class="ask-intro">
      A chat bound entirely to this project. Ask about the model and its calculations, the policy levers and
      their evidence, the field studies, or the policy documents it draws on — and about <b>your current scenario</b>.
      Every answer is grounded in the project's own corpus and shows its sources. It answers about nothing else.
    </p>
    <div class="ask-host"><AskModel /></div>
  </section>
</div>

<style>
  .ask-section { margin: 34px 0 8px; padding-top: 22px; border-top: 1px solid rgba(28,22,17,0.12); }
  .ask-h { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(22px, 3vw, 30px); letter-spacing: -0.02em; margin: 4px 0 10px; color: var(--ink); }
  .ask-intro { font-size: var(--fs-body-sm); line-height: 1.6; color: rgba(28,22,17,0.74); max-width: 70ch; margin: 0 0 16px; }
  .ask-host { height: 520px; max-height: 70vh; border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 14px 16px; display: flex; flex-direction: column; }
  .hero { padding: 18px 0 6px; }
  .hero-h1 { font-family: var(--fs-serif); font-weight: 600; font-size: clamp(34px, 6.2vw, 66px); line-height: 0.96; letter-spacing: -0.03em; margin: 6px 0 16px; color: var(--ink); }
  .hero-lede { font-size: clamp(17px, 1.6vw, 20px); line-height: 1.5; color: rgba(28,22,17,0.74); margin: 0 0 18px; }
  .cta-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .cta-ghost { font-family: var(--font-body); font-size: var(--fs-label); color: var(--accent-ink); text-decoration: none; border: none; background: none; cursor: pointer; padding: 0; border-bottom: 1px dashed currentColor; }
  .cta-ghost:hover { color: var(--accent-ink-hover); }
  .story { margin: 30px 0 8px; padding-top: 22px; border-top: 1px solid rgba(28,22,17,0.12); }
</style>
