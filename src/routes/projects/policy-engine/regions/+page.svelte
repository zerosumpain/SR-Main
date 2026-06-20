<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import RegionsPanel from '../components/RegionsPanel.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import MeasurementPopover from '../components/MeasurementPopover.svelte';
  import { MEASUREMENT } from '../lib/measurement';
  import { STORIES } from '../lib/stories';
  import {
    EXEMPLARS, TIER_META, LONDON_EFFECT, PROGRAMMES, CHURN_FACTS, PLACE_OWNERS, PLACE_GAPS, PLACE_TAKEAWAY,
  } from '../lib/regionsIntel';

  const eli = $derived(app.narrative === 'eli5');

  // ---- programme-churn timeline geometry ----
  const T0 = 2003, T1 = 2036;
  const tx = (y: number) => ((y - T0) / (T1 - T0)) * 100; // %
  const tw = (s: number, e: number | null) => (((e ?? T1) - s) / (T1 - T0)) * 100;
  const EVAL_META: Record<string, { label: string; colour: string }> = {
    counterfactual: { label: 'counterfactual', colour: '#2f7d4f' },
    'process-only': { label: 'process-only evaluation', colour: '#b4632e' },
    none: { label: 'never evaluated', colour: '#b1455e' },
    pending: { label: 'evaluation pending', colour: '#7a5aa6' },
  };
</script>

<svelte:head><title>Regions — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.regions} />
  <StorySection title="1 · Nine regions, re-centred to England">
  {#snippet prose()}
  <div class="pe-prose">
    {#if app.narrative === 'eli5'}
      <p>
        A single national average hides a lot. The gap between poorer and richer pupils is small in <b>London</b> but much bigger in
        places like the <b>South East</b> and the <b>North East</b>. The North East is the odd one out: its poorer kids do okay in
        primary school, then fall the furthest behind by sixteen.
      </p>
      <p>
        This page splits the country into its nine regions (the numbers still add back up to the national figure). It’s also where the
        government’s two new 2026 schemes — <b>Mission North East</b> and <b>Mission Coastal</b> (starting in Hastings and Scarborough) —
        aim to help the worst-off areas. They’re real, but new and not yet evaluated, and no budget has been published — so the model gives
        them a deliberately small, slow effect. That caution reflects how little is yet known about schemes like these, not a prediction that
        they won’t work — <a href="/projects/policy-engine/method#levers">the lever notes</a> spell out exactly how. Click a region to view
        the whole site through its lens.
      </p>
    {:else}
      <p>
        A national average hides as much as it reveals. The disadvantage gap at GCSE runs from about <b>ten months in London</b> — the
        famous “London effect” — to <b>more than twenty in the South East and East Midlands</b>. The North East is the country’s sharpest
        puzzle: its disadvantaged children do relatively <i>well</i> at primary, then fall the furthest behind by sixteen — the lowest
        Attainment 8 of any region and the highest absence.
      </p>
      <p>
        This page decomposes the national model onto the nine English regions, calibrated to DfE Key-Stage-4 data and EPI’s regional
        gaps, and re-centred so the regions always weight back to the England figure. It is also where the two 2026 area missions appear:
        <b>Mission North East</b> and <b>Mission Coastal</b> (Hastings and Scarborough) are real, London-Challenge-style programmes. They are
        new and not yet evaluated, and no budget has been published, so the model treats their effect cautiously — modest, gradual and
        concentrated on the regions they target. That caution reflects how thin the evidence on place-based attainment programmes still is,
        not a prediction about whether they will succeed — <a href="/projects/policy-engine/method#levers">the per-lever notes</a> document
        each assumption. Click a region to filter the whole site to it.
      </p>
    {/if}
  </div>
  {/snippet}
  {#snippet data()}
  <div class="panel">
    {#if app.mounted}
      <RegionsPanel sim={app.sim.years} baseSim={app.baseSim.years} levers={app.levers} horizon={app.horizon}
        selected={app.region} onSelect={(c) => (app.region = c)} />
    {/if}
    <div class="mrow"><MeasurementPopover m={MEASUREMENT.regionalBreakdown} /></div>
  </div>
  {/snippet}
  </StorySection>

  <!-- ===================== 2 · exemplars ===================== -->
  <section class="block">
    <h2 class="pe-h2">2 · Who has actually moved the needle</h2>
    <p class="cap">
      {eli
        ? 'Beyond the averages, some places really did change their children’s results. Here are the best-documented cases — each with an honest badge for how solid the evidence is. Notice what the proven ones have in common: they were patient and unglamorous.'
        : 'The exemplar record, with evidence tiers worn openly. The pattern across the strong cases: LA-led, decade-long, built on teacher supply, universal entitlements and stable leadership — and the single causal result in the whole space came from a boring universal pilot with a comparator design, not a flagship programme.'}
    </p>
    <div class="ex-cards">
      {#each EXEMPLARS as e (e.place)}
        <article class="ex" style="--tc:{TIER_META[e.tier].colour}">
          <header class="ex-head">
            <div class="ex-names"><span class="ex-place">{e.place}</span><span class="ex-who">{e.who} · {e.when}</span></div>
            <span class="ex-tier" style="background:{TIER_META[e.tier].colour}">{eli ? TIER_META[e.tier].eli5 : TIER_META[e.tier].label}</span>
          </header>
          <p class="ex-what">{e.what}</p>
          <p class="ex-result"><b>Result:</b> {e.result}</p>
          <p class="ex-lesson"><span class="ex-tag">The lesson</span>{e.lesson}</p>
          {#if e.caveat}<p class="ex-caveat">⚠ {e.caveat}</p>{/if}
          <a class="ex-src" href={e.url} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
  </section>

  <!-- ===================== 3 · the London effect ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · The London effect, honestly</h2>
    <p class="cap">{eli ? LONDON_EFFECT.eli5 : LONDON_EFFECT.research}</p>
    <div class="le">
      <span class="le-lab">{eli ? 'What explained London’s 2013 results advantage' : 'Decomposition of the 2013 London GCSE-progress advantage (FFT)'}</span>
      <div class="le-bar">
        {#each LONDON_EFFECT.shares as s (s.key)}
          <div class="le-seg" style="width:{s.share * 100}%; background:{s.colour}">
            <span class="le-pct">{Math.round(s.share * 100)}%</span>
          </div>
        {/each}
      </div>
      <div class="le-key">
        {#each LONDON_EFFECT.shares as s (s.key)}
          <span class="le-k"><i style="background:{s.colour}"></i>{s.label}</span>
        {/each}
      </div>
      <p class="le-note">
        {eli
          ? 'Why this matters here: when the engine treats Mission North East cautiously, this is why — even the most famous place programme’s effect was two-thirds demographics.'
          : 'This decomposition is why the engine models the 2026 missions cautiously: the canonical place programme’s headline effect was mostly compositional. The defensible claim is the residual — and the disadvantaged-pupil gap-narrowing inside it.'}
      </p>
    </div>
  </section>

  <!-- ===================== 4 · the Whitehall record ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · Four waves from Whitehall — the programme record</h2>
    <p class="cap">{eli ? CHURN_FACTS.eli5 : CHURN_FACTS.research}</p>
    <div class="gantt-scroll">
      <div class="gantt">
        {#each [2005, 2010, 2015, 2020, 2025, 2030, 2035] as y (y)}
          <span class="g-year" style="left:{tx(y)}%">{y}</span>
          <span class="g-grid" style="left:{tx(y)}%"></span>
        {/each}
        <span class="g-now" style="left:{tx(2026.5)}%"></span>
        <span class="g-nowlab" style="left:{tx(2026.5)}%">now</span>
        {#each PROGRAMMES as p, i (p.name)}
          <div class="g-row">
            <span class="g-name">{p.name} <small>{p.owner} · {p.budget}</small></span>
            <div class="g-track">
              <div class="g-bar" class:open={p.end === null} style="left:{tx(p.start)}%; width:{tw(p.start, p.end)}%; background:{p.colour}">
                <span class="g-eval" style="background:{EVAL_META[p.evaluated].colour}" title={EVAL_META[p.evaluated].label}></span>
              </div>
            </div>
            <span class="g-status">{p.status}</span>
          </div>
        {/each}
        <div class="g-key">
          {#each Object.entries(EVAL_META) as [k, m] (k)}<span class="g-kk"><i style="background:{m.colour}"></i>{m.label}</span>{/each}
          <span class="g-kk"><i class="g-open-key"></i>announced / ongoing</span>
        </div>
      </div>
    </div>

    <h3 class="sub-h">{eli ? 'Who actually holds which lever' : 'Ownership of the place levers'}</h3>
    <div class="owners">
      {#each PLACE_OWNERS as o (o.owner)}
        <div class="own" style="--oc:{o.colour}">
          <span class="own-name">{o.owner}</span>
          <span class="own-holds">{o.holds}</span>
          {#if o.gap}<span class="own-gap">▸ {o.gap}</span>{/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- ===================== 5 · the intelligence gap ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · The place-intelligence gap</h2>
    <p class="cap">
      {eli
        ? 'If the question is “which places are actually working?”, the honest answer is the data can’t currently tell you — for five specific, fixable reasons.'
        : 'The data-strategy thread, mirroring the NEET field study: the measurement surface for places is structurally weaker than for schools or pupils — five named gaps, each buildable.'}
    </p>
    <div class="gaps">
      {#each PLACE_GAPS as g (g.gap)}
        <div class="gp">
          <span class="gp-name">{g.gap}</span>
          <p class="gp-det">{eli ? g.eli5 : g.detail}</p>
        </div>
      {/each}
    </div>
    <div class="takeaway-box">
      <span class="tb-lab">{eli ? 'The bottom line' : 'For the data strategist'}</span>
      <p>{eli ? PLACE_TAKEAWAY.eli5 : PLACE_TAKEAWAY.research}</p>
      <a class="tb-link" href="/projects/policy-engine/neet">The same playbook, worked through fully → the NEET field study</a>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/global">Now against the world → Global</a>
</div>

<style>
  .panel { margin: 0; }
  .mrow { margin: 8px 0 0; }
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: 14.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 90ch; }
  .sub-h { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; margin: 22px 0 10px; color: var(--ink); }

  /* 2 · exemplar cards */
  .ex-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(340px, 100%), 1fr)); gap: 12px; }
  .ex { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--tc); border-radius: var(--radius-round); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 7px; }
  .ex-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .ex-names { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .ex-place { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15.5px; color: var(--ink); }
  .ex-who { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  .ex-tier { flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em;
    color: #fff; padding: 3px 7px; border-radius: var(--radius-round); white-space: nowrap; }
  .ex-what { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .ex-result { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.78); }
  .ex-result b { color: var(--ink); }
  .ex-lesson { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink); }
  .ex-tag { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--tc); margin-bottom: 2px; }
  .ex-caveat { margin: 0; font-size: 11px; line-height: 1.45; color: #8a2d3a; }
  .ex-src { margin-top: auto; align-self: flex-start; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  /* 3 · London effect decomposition */
  .le { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 14px 16px; max-width: 88ch; }
  .le-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.55); margin-bottom: 9px; }
  .le-bar { display: flex; height: 38px; border-radius: var(--radius-round); overflow: hidden; }
  .le-seg { display: flex; align-items: center; justify-content: center; min-width: 0; }
  .le-pct { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: #fff; }
  .le-key { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 9px; }
  .le-k { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: rgba(28,22,17,0.7); }
  .le-k i { width: 11px; height: 11px; border-radius: var(--radius-sharp); display: inline-block; flex-shrink: 0; }
  .le-note { margin: 10px 0 0; font-size: 12px; line-height: 1.55; color: rgba(28,22,17,0.65); }

  /* 4 · programme gantt */
  .gantt-scroll { overflow-x: auto; }
  .gantt { position: relative; min-width: 720px; padding: 26px 0 8px; }
  .g-year { position: absolute; top: 0; transform: translateX(-50%); font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.45); }
  .g-grid { position: absolute; top: 20px; bottom: 44px; width: 1px; background: rgba(28,22,17,0.08); }
  .g-now { position: absolute; top: 20px; bottom: 44px; width: 1.5px; background: #9a3b2e; opacity: 0.55; }
  .g-nowlab { position: absolute; top: 6px; transform: translateX(-50%); font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; color: #9a3b2e; }
  .g-row { position: relative; display: grid; grid-template-columns: 215px 1fr; gap: 4px 10px; align-items: center; margin: 7px 0; }
  .g-name { font-size: 11.5px; line-height: 1.3; color: var(--ink); font-weight: 500; }
  .g-name small { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; font-weight: 400; color: rgba(28,22,17,0.5); }
  .g-track { position: relative; height: 16px; }
  .g-bar { position: absolute; top: 0; height: 16px; border-radius: var(--radius-round); opacity: 0.85; }
  .g-bar.open { border-radius: var(--radius-round) 0 0 4px; -webkit-mask-image: linear-gradient(90deg, #000 75%, transparent); mask-image: linear-gradient(90deg, #000 75%, transparent); }
  .g-eval { position: absolute; left: -3px; top: -3px; width: 9px; height: 9px; border-radius: var(--radius-pill); border: 1.5px solid var(--paper); }
  .g-status { grid-column: 1 / -1; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.6); margin: 0 0 4px; }
  .g-key { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 12px; }
  .g-kk { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.6); }
  .g-kk i { width: 9px; height: 9px; border-radius: var(--radius-pill); display: inline-block; }
  .g-open-key { background: linear-gradient(90deg, rgba(28,22,17,0.5), transparent); border-radius: var(--radius-sharp) !important; width: 16px !important; height: 8px !important; }

  /* owners */
  .owners { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 10px; }
  .own { border: 1px solid rgba(28,22,17,0.12); border-left: 3px solid var(--oc); border-radius: var(--radius-round); padding: 10px 12px;
    background: rgba(255,255,255,0.4); display: flex; flex-direction: column; gap: 4px; }
  .own-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: var(--oc); }
  .own-holds { font-size: 11.5px; line-height: 1.45; color: rgba(28,22,17,0.74); }
  .own-gap { font-size: 11px; line-height: 1.4; font-weight: 600; color: #8a2d3a; }

  /* 5 · gaps + takeaway */
  .gaps { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 10px; margin-bottom: 16px; }
  .gp { border: 1px dashed var(--error-border); border-radius: var(--radius-round); padding: 10px 12px; background: var(--error-bg); }
  .gp-name { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: #8a2d3a; text-transform: uppercase; letter-spacing: 0.04em; }
  .gp-det { margin: 5px 0 0; font-size: 11.5px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .takeaway-box { border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-round);
    background: var(--accent-ink-tint-06); padding: 13px 16px; max-width: 88ch; }
  .tb-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .takeaway-box p { margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }
  .tb-link { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
