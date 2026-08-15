<script lang="ts">
  // Early Years (0-5) — Field Study №9. The model's own self-identified blind spot: it acts
  // on 0-5 through levers but first measures a child at age 5. This page opens the front door,
  // and uses the new below-age-5 engine variables (gapAge3, eyTakeUp) so the 0-5 claims are
  // live and lever-driven. Composes the standard study scaffold + the new interactive/evidence
  // components. Self-contained.
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import LeverChart from '../components/LeverChart.svelte';
  import LeverResponseCurve from '../components/LeverResponseCurve.svelte';
  import Contradiction from '../components/Contradiction.svelte';
  import AnalysisOnOutcome from '../components/AnalysisOnOutcome.svelte';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';
  import { STORIES } from '../lib/stories';
  import { CONTRADICTIONS_BY_ID } from '../lib/contradictions.ts';
  import {
    ENTITLEMENTS, KEY_STATS, WHAT_WORKS, IMPROVE, BEST_START, DATA_PICTURE, ELIGIBILITY,
  } from '../lib/earlyYearsIntel';

  const eli = $derived(app.narrative === 'eli5');
  const card = (c: { research: string; eli5: string }) => (eli ? c.eli5 : c.research);

  // Heckman-curve illustration: rate of return declines with age of investment (schematic).
  const HECK = [
    { age: 0, r: 1.0 }, { age: 3, r: 0.78 }, { age: 6, r: 0.55 }, { age: 12, r: 0.34 },
    { age: 18, r: 0.20 }, { age: 30, r: 0.12 }, { age: 45, r: 0.07 },
  ];
  const hx = (a: number) => 8 + (a / 45) * 84;          // % across
  const hy = (r: number) => 86 - r * 70;                // % down (r in 0..1)
  const heckPath = HECK.map((p, i) => `${i === 0 ? 'M' : 'L'}${hx(p.age).toFixed(1)},${hy(p.r).toFixed(1)}`).join(' ');
</script>

<svelte:head><title>Early Years (0–5) — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.earlyYears} />

  <!-- headline dashboard -->
  <div class="stats">
    {#each KEY_STATS as s (s.key)}
      <div class="stat" style="--c:{s.color}">
        <span class="stat-v">{s.value}</span>
        <span class="stat-l">{s.label}</span>
        <span class="stat-n">{s.note}</span>
      </div>
    {/each}
  </div>

  <!-- ============ 1 · What we do now ============ -->
  <StorySection title="1 · What we do now — four overlapping offers">
    {#snippet prose()}
    <div class="pe-prose">
      {#if eli}
        <p>England gives families several blocks of free childcare. The newest and biggest — <b>30 hours</b> for working
          parents from 9 months — is the one poorer families are least likely to qualify for, because you have to be
          working and earning a minimum amount. The offer aimed at the poorest, the <b>2-year-old offer</b>, reaches the
          fewest of the children it targets.</p>
        <p>Move the sliders: the share of poorer toddlers actually in nursery is something policy can change — and the gap
          between the universal offer and the poorer-child offer is the early-years story in one number.</p>
      {:else}
        <p>England runs four overlapping funded entitlements. The largest recent expansion — the 30-hour working-parent
          offer (fully live from September 2025) — is work-conditional: each parent must earn at least ~£10,158/yr and
          under £100,000, which by design excludes non-working and very-low-earning families. The equity entitlement (the
          disadvantaged 2-year-old offer) records the lowest take-up of those it targets.</p>
        <p>The engine now models early-education take-up directly: <b>eyTakeUp</b> (disadvantaged) tracks the access lever
          and Family-Hub outreach, against a near-saturated universal rate. The persistent all-vs-disadvantaged gap at this
          first gate is the early-years equity signal.</p>
      {/if}
    </div>
    {/snippet}
    {#snippet data()}
    <div class="panel">
      <table class="ent">
        <thead><tr><th>Entitlement</th><th>Hours</th><th>Reaches</th></tr></thead>
        <tbody>
          {#each ENTITLEMENTS as e (e.label)}
            <tr>
              <td><b>{e.label}</b><span class="ent-status">{e.status}</span></td>
              <td class="ent-h">{e.hours}</td>
              <td class="ent-who">{e.who}<span class="ent-eq">{e.equity}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if app.mounted}
        <LeverChart outcome="eyTakeUp" levers={['ey_access', 'send_early']}
          title="Disadvantaged early-education take-up" color="#3f7d6e" />
      {/if}
    </div>
    {/snippet}
  </StorySection>

  <!-- ============ 2 · The gap is set before age 5 ============ -->
  <StorySection title="2 · The gap is set before age 5">
    {#snippet prose()}
    <div class="pe-prose">
      {#if eli}
        <p>By the time children start school at 5, poorer children are already months behind — and the gap is visible from
          age 3. About <b>40% of the eventual gap at 16 is already there at 5</b>. So the years before school aren't a
          warm-up; they're where a big part of the problem is decided.</p>
        <p>The model now follows this back to age 3. Pull the early-years sliders and watch the age-3 gap move — and
          remember it then grows, roughly four months at 5 into nineteen-plus by sixteen.</p>
      {:else}
        <p>Around 40% of the eventual age-16 disadvantage gap is already present by age 5 (EPI), and the gap is observable
          from age 3. The model previously began observation at age 5; it now carries a <b>development gap at age 3</b>
          (<code>gapAge3</code>), driven by the same early-years inputs, responding fastest of all the gap measures.</p>
        <p>There is no official England "gap-in-months at age 3", so the level is an <ConfidenceBadge level="assumption"
          label="estimate" /> anchored below the age-5 figure (4.7 months) — an assumption to test, documented on the
          Method page. The home learning environment is modelled as the dominant early driver.</p>
      {/if}
    </div>
    {/snippet}
    {#snippet data()}
    <div class="panel">
      {#if app.mounted}
        <LeverChart outcome="gapAge3" levers={['ey_quality', 'ey_access', 'eypp', 'poverty_action']}
          title="Development gap at age 3 (months)" color="#b1455e" />
        <LeverResponseCurve lever="ey_quality" outcome="gapReception"
          title="Diminishing returns: early-years quality → the age-5 gap" />
      {/if}
    </div>
    {/snippet}
  </StorySection>

  <!-- ============ 3 · What works ============ -->
  <section class="block">
    <h2 class="pe-h2">3 · What the evidence says works</h2>
    <p class="cap">{eli
      ? 'The early years have some of the clearest "what works" evidence anywhere — and a strong economic case for spending early. The catch is that it is quality, and the home, that do the work, not hours alone.'
      : 'The 0-5 period carries unusually strong evidence. The recurring qualifier: it is quality and the home learning environment that drive durable gains, and the returns are highest at the youngest ages — the Heckman logic the engine\'s front-loaded age-3 channel encodes.'}</p>
    <div class="ev-grid">
      <div class="ev-cards">
        {#each WHAT_WORKS as c (c.key)}
          <article class="ev-card">
            <header><span class="ev-t">{c.title}</span>{#if c.flag}<ConfidenceBadge level="assumption" label={c.flag} small />{/if}</header>
            <p>{card(c)}</p>
            {#if c.url}<a class="ev-src" href={c.url} target="_blank" rel="noopener">{c.source} ↗</a>{/if}
          </article>
        {/each}
      </div>
      <figure class="heck">
        <figcaption>The Heckman curve — rate of return by age of investment (schematic)</figcaption>
        <svg viewBox="0 0 100 96" role="img" aria-label="Rate of return to investment declines with age">
          <line x1="8" y1="86" x2="92" y2="86" class="ax" />
          <line x1="8" y1="6" x2="8" y2="86" class="ax" />
          <path d={heckPath} fill="none" stroke="#3f7d6e" stroke-width="2" />
          {#each HECK as p}<circle cx={hx(p.age)} cy={hy(p.r)} r="1.5" fill="#3f7d6e" />{/each}
          <rect x="8" y="6" width={hx(5) - 8} height="80" class="early" />
          <text x={(8 + hx(5)) / 2} y="14" class="hl" text-anchor="middle">0–5</text>
          <text x="8" y="94" class="hax" text-anchor="start">birth</text>
          <text x="92" y="94" class="hax" text-anchor="end">adult</text>
        </svg>
        <span class="heck-note">~13% annual ROI for high-quality birth-to-5 programmes (Heckman) — an estimate from small US RCTs, used for direction and magnitude.</span>
      </figure>
    </div>
    <AnalysisOnOutcome theme="early-identification" title="What the analysts find on early identification" max={5} />
  </section>

  <!-- ============ 4 · What could be improved ============ -->
  <section class="block">
    <h2 class="pe-h2">4 · What could be improved</h2>
    <p class="cap">{eli
      ? 'Three things stand out — not as opinions, but as gaps you can measure: the biggest money misses the poorest children, the early years get the least targeted funding, and the workforce that does the baby checks has shrunk.'
      : 'Stated as evaluable observations rather than recommendations: the distribution of new spending, the size of early-years targeted funding, and the workforce behind the developmental check.'}</p>
    <div class="ev-grid">
      <figure class="elig">
        <figcaption>Who qualifies for the 30-hour 3–4yo entitlement, by earnings third (Sutton Trust / IFS)</figcaption>
        {#each ELIGIBILITY as b (b.label)}
          <div class="elig-row">
            <span class="elig-l">{b.label}</span>
            <div class="elig-track"><span class="elig-bar" style="width:{b.share * 100}%"></span></div>
            <span class="elig-v">{Math.round(b.share * 100)}%</span>
          </div>
        {/each}
        <span class="elig-note">IFS estimates ~five-sixths of new-entitlement spend is deadweight — childcare better-off parents would have bought anyway.</span>
      </figure>
      <div class="ev-cards">
        {#each IMPROVE as c (c.key)}
          <article class="ev-card">
            <header><span class="ev-t">{c.title}</span>{#if c.flag}<ConfidenceBadge level="contested" label={c.flag} small />{/if}</header>
            <p>{card(c)}</p>
            {#if c.url}<a class="ev-src" href={c.url} target="_blank" rel="noopener">{c.source} ↗</a>{/if}
          </article>
        {/each}
      </div>
    </div>
  </section>

  <!-- ============ 5 · the role for data & monitoring ============ -->
  <StorySection title="5 · The role for data &amp; monitoring">
    {#snippet prose()}
    <div class="pe-prose">
      {#if eli}
        <p>Here's the early-years version of the question this whole project asks: <b>how would we know if any of this is
          working?</b> Once a child is 5, we can see school-readiness by how poor the area is. Before that, the picture is
          held by health services — and it never reaches the school system.</p>
        <p>The frustrating part: the data to follow a child from the baby checks to their GCSEs already exists for
          research. It just isn't published as a regular national number.</p>
      {:else}
        <p>The 0-5 monitoring picture is sharply uneven. Age-5 GLD is publishable by IDACI decile and reasonably
          instrumented. Before that, the developmental signal — the ASQ-3 at the 2–2½-year review — sits in NHS systems
          that do not connect to the education estate. This is the same <b>health↔education data gap</b> that recurs in the
          SEND and Jigsaw studies.</p>
        <p>ECHILD and Children of the 2020s make a perinatal → age-2 → age-5 → KS → earnings readout constructible — as a
          research capability, not a standing statistic. That gap is the credible "how we'd monitor this" hook.</p>
      {/if}
    </div>
    {/snippet}
    {#snippet data()}
    <div class="panel">
      <div class="ev-cards">
        {#each DATA_PICTURE as c (c.key)}
          <article class="ev-card">
            <header><span class="ev-t">{c.title}</span></header>
            <p>{card(c)}</p>
            {#if c.url}<a class="ev-src" href={c.url} target="_blank" rel="noopener">{c.source} ↗</a>{/if}
          </article>
        {/each}
      </div>
      <AnalysisOnOutcome theme="data-gap" title="What the analysts find on the data gap" max={4} />
    </div>
    {/snippet}
  </StorySection>

  <!-- ============ 6 · contradiction + Best Start ============ -->
  <section class="block">
    <h2 class="pe-h2">6 · Where the evidence is contested</h2>
    <p class="cap">{eli
      ? 'Not everything here is settled. The biggest open question is whether the huge childcare expansion actually helps close the gap — or just helps working parents.'
      : 'The central early-years contradiction, laid out with what the model assumes and what would resolve it.'}</p>
    <Contradiction c={CONTRADICTIONS_BY_ID['thirty-hours-gap']} />
    <article class="best-start">
      <header><span class="bs-tag">2025</span><span class="bs-t">{BEST_START.title}</span></header>
      <p>{card(BEST_START)}</p>
      {#if BEST_START.url}<a class="ev-src" href={BEST_START.url} target="_blank" rel="noopener">{BEST_START.source} ↗</a>{/if}
    </article>
  </section>
</div>

<style>
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; margin: 6px 0 8px; }
  .stat { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--c); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 9px 11px; display: flex; flex-direction: column; gap: 2px; }
  .stat-v { font-family: var(--fs-serif); font-size: 24px; font-weight: 600; color: var(--c); line-height: 1; }
  .stat-l { font-size: var(--fs-label-xs); color: var(--ink); line-height: 1.3; }
  .stat-n { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); line-height: 1.35; }

  .panel { display: flex; flex-direction: column; gap: 12px; }
  .ent { width: 100%; border-collapse: collapse; font-size: var(--fs-label-xs); }
  .ent th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); padding: 3px 6px; border-bottom: 1px solid rgba(28,22,17,0.15); }
  .ent td { padding: 6px; border-bottom: 1px solid rgba(28,22,17,0.08); vertical-align: top; }
  .ent-status { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.45); margin-top: 1px; }
  .ent-h { font-family: var(--font-mono); font-weight: 600; white-space: nowrap; }
  .ent-who { color: rgba(28,22,17,0.75); }
  .ent-eq { display: block; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); margin-top: 2px; line-height: 1.35; }

  .ev-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 860px) { .ev-grid { grid-template-columns: 1fr; } }
  .ev-cards { display: flex; flex-direction: column; gap: 9px; }
  .ev-card { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.35); padding: 9px 11px; }
  .ev-card header { display: flex; align-items: center; gap: 7px; justify-content: space-between; margin-bottom: 3px; }
  .ev-t { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: var(--ink); }
  .ev-card p { margin: 0 0 5px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.82); }
  .ev-src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; }
  .ev-src:hover { text-decoration: underline; }

  .heck { margin: 0; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 10px 12px; }
  .heck figcaption { font-family: var(--fs-serif); font-size: var(--fs-label); color: var(--ink); margin-bottom: 6px; }
  .heck svg { width: 100%; height: auto; }
  .heck .ax { stroke: rgba(28,22,17,0.3); stroke-width: 0.5; }
  .heck .early { fill: rgba(63,125,110,0.1); }
  .heck .hl { font-family: var(--font-mono); font-size: 4px; fill: #2f6155; } /* svg-user-units: viewBox 0 0 100 96 */
  .heck .hax { font-family: var(--font-mono); font-size: 3.5px; fill: rgba(28,22,17,0.5); } /* svg-user-units: viewBox 0 0 100 96 */
  .heck-note { display: block; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); line-height: 1.4; margin-top: 5px; }

  .elig { margin: 0; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); padding: 10px 12px; }
  .elig figcaption { font-family: var(--fs-serif); font-size: var(--fs-label); color: var(--ink); margin-bottom: 8px; }
  .elig-row { display: grid; grid-template-columns: 120px 1fr 34px; gap: 8px; align-items: center; margin-bottom: 6px; }
  .elig-l { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.75); text-align: right; }
  .elig-track { height: 16px; background: rgba(28,22,17,0.06); border-radius: var(--radius-sharp); overflow: hidden; }
  .elig-bar { display: block; height: 100%; background: #b4632e; border-radius: var(--radius-sharp); }
  .elig-v { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .elig-note { display: block; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); line-height: 1.4; margin-top: 6px; }

  .best-start { margin-top: 12px; border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-sharp); background: var(--accent-ink-tint-06); padding: 10px 12px; }
  .best-start header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .bs-tag { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: #fff; background: var(--accent-ink); padding: 1px 5px; border-radius: var(--radius-sharp); }
  .bs-t { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .best-start p { margin: 0 0 5px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.82); }
</style>
