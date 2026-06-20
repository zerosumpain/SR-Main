<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import Methodology from '../components/Methodology.svelte';
  import Scorecard from '../components/Scorecard.svelte';
  import CostPanel from '../components/CostPanel.svelte';
  import Sensitivity from '../components/Sensitivity.svelte';
  import { LEVERS, GROUP_META, GROUP_ORDER, LEVER_META, DRIVE_LABEL, LEVER_ELI5_NAME } from '../lib/levers';

  const confLabel: Record<string, string> = { high: 'well-evidenced', medium: 'moderate', low: 'weak', assumption: 'assumption' };
  const lname = (id: string, label: string) => (app.narrative === 'eli5' ? LEVER_ELI5_NAME[id] ?? label : label);
  const gname = (g: string) => (app.narrative === 'eli5' ? GROUP_META[g].eli5 : GROUP_META[g].label);
  let openGroup = $state<string | null>('macro'); // start with the funding group open (the one people ask about)
</script>

<svelte:head><title>Method & calculations — Education Policy Modelling</title></svelte:head>

<div class="pe-route">
  <span class="pe-eyebrow">Method &amp; calculations</span>
  <h1 class="pe-h1">How it works, and what it assumes</h1>
  <div class="pe-prose cols">
    {#if app.narrative === 'eli5'}
      <p>
        How does it work? It’s like a flight simulator for schools. You change the policies, and a set of rules — based on the research —
        works out what probably happens, year by year. Every rule comes with a “best guess” plus a range, which is why the charts show a
        fuzzy band of uncertainty rather than one confident line.
      </p>
      <p>
        One modelling choice shapes a lot of the results, and it’s worth being upfront about. <b>Whether money on its own lifts results is
        genuinely debated</b>: some studies find little effect at the amounts England already spends, others find clear gains when it reaches
        teaching. This model takes the cautious view — funding and pay work by hiring and keeping staff, so pour money in but leave the
        staffing the same and, in the model, not much happens. That’s an assumption you can test, not a fact. The same design choices keep
        the special-needs budget acting on the <i>debt</i> (not the gap) and the local “missions” acting on their own regions. The chart and
        per-lever notes below spell out exactly what each slider changes.
      </p>
    {:else}
      <p>
        This is a <b>system-dynamics and cohort model</b>, not an official forecast. It steps from 2025 to 2040, applying
        research-calibrated response functions — elasticities with diminishing returns and distributed lags — to a small set of state
        variables, mediated through a causal spine in which <b>attendance is the central hub</b>. Every parameter carries a low/central/high
        band and a source or an explicit assumption flag; the Monte-Carlo bands propagate that uncertainty.
      </p>
      <p>
        One design choice runs through the whole model and is worth stating plainly, because it is contested. <b>The strength of the
        funding→attainment link is debated</b>: some analyses find it weak at England’s current per-pupil spending (Hanushek; cross-sectional
        spend-vs-PISA), while quasi-experimental studies of school-finance reforms (Jackson, Johnson &amp; Persico; Lafortune et al.) find
        clear positive effects, particularly for disadvantaged pupils, where the extra money reaches the classroom. This model adopts the
        cautious reading and routes core funding, teacher pay and bursaries <i>through teacher capacity</i> — they fund the staff, retention
        and specialists that raise results — so money left un-spent on the workforce moves the modelled outcomes little. That is an
        assumption the user can change, not a verdict on the debate. The same design keeps high-needs funding acting on the SEND deficit
        (not the gap), and the area missions acting regionally (not nationally). The “what moves the needle” chart and the per-lever notes
        below make every one of these channels explicit.
      </p>
    {/if}
  </div>

  <aside class="seealso">
    <span class="sa-tag">Beyond the model</span>
    {#if app.narrative === 'eli5'}
      <p>
        This model is a careful guess. Two companion pages look at how you’d <b>check it against the real world</b>:
        <a href="/projects/policy-engine/monitor">Monitoring</a> — how you’d actually tell whether a policy worked (through the new
        “data spine” and AI, and what other countries already do); and <a href="/projects/policy-engine/neet">NEET</a> — a worked
        example: spotting young people slipping out of school or work, early enough to help.
      </p>
    {:else}
      <p>
        Everything here is an explicit, research-backed <b>hypothesis</b>. Two companion studies ask how you’d <b>validate it against
        reality</b>: <a href="/projects/policy-engine/monitor">Monitoring</a> — measuring policy impact through the DfE data spine and AI,
        and what Estonia, the Netherlands and others already run; and <a href="/projects/policy-engine/neet">NEET</a> — a worked example,
        designing a humane early-warning system to catch young people before they fall out of education, employment or training.
      </p>
    {/if}
  </aside>

  <h2 class="pe-h2">Outcomes at a glance</h2>
  {#if app.mounted}<Scorecard sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} />{/if}

  <h2 class="pe-h2 anchor" id="sensitivity">What moves the needle</h2>
  {#if app.narrative === 'eli5'}
    <p class="sec-blurb">Each bar shows how much one slider, pushed all the way, changes the number you pick. Short bars aren’t broken — that slider probably changes a <i>different</i> thing (like the special-needs debt or youth unemployment).</p>
  {:else}
    <p class="sec-blurb">Each bar is how far a single lever, swung across its full range, moves the chosen KPI — the model’s sensitivity shown directly. Short bars are not bugs: many levers act on a <i>different</i> outcome (the deficit, NEET, absence) than the one selected.</p>
  {/if}
  {#if app.mounted}<Sensitivity levers={app.levers} horizon={app.horizon} />{/if}

  <h2 class="pe-h2 anchor" id="cost-value">Cost &amp; value</h2>
  {#if app.narrative === 'eli5'}
    <p class="sec-blurb">What it costs, and what you get for the money. Heads up: funding, pay and special-needs money get more expensive <i>every year</i> they run, so they cost far more than one-off programmes.</p>
  {:else}
    <p class="sec-blurb">The cost side, and the value (gap closed or attainment gained per £bn) of what you’ve switched on. Note that the three growth-rate levers — funding, pay, high-needs — compound year on year, so their cost is larger and later than the flat programme costs.</p>
  {/if}
  {#if app.mounted}<CostPanel sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} />{/if}

  <h2 class="pe-h2 anchor" id="equations">The equations</h2>
  <Methodology />

  <h2 class="pe-h2 anchor" id="levers">Every lever — what it does &amp; why</h2>
  {#if app.narrative === 'eli5'}
    <p class="sec-blurb">All {LEVERS.length} sliders, grouped. Each one says what it is, what the research shows, how the model uses it, and what it changes. Tap a group to open it.</p>
  {:else}
    <p class="sec-blurb">All {LEVERS.length} levers, grouped. Each shows what it represents, what the evidence says, how the <b>model</b> treats it, and which outcomes it drives. Click a group to expand.</p>
  {/if}
  <div class="lever-docs">
    {#each GROUP_ORDER as g}
      {@const meta = GROUP_META[g]}
      {@const items = LEVERS.filter((l) => l.group === g)}
      <section class="ldoc-group">
        <button class="ldoc-head" onclick={() => (openGroup = openGroup === g ? null : g)} style="--gc:{meta.colour}">
          <span class="g-tag">{meta.tag}</span><span class="g-label">{gname(g)}</span><span class="g-count">{items.length}</span>
          <span class="g-chev" class:open={openGroup === g}>▾</span>
        </button>
        {#if openGroup === g}
          <div class="ldoc-cards">
            {#each items as L (L.id)}
              <div class="ldoc">
                <div class="ld-top"><span class="ld-name">{lname(L.id, L.label)}</span><span class="conf conf-{L.confidence}">{confLabel[L.confidence]}</span></div>
                <p class="ld-blurb">{L.blurb}</p>
                <p class="ld-ev">{L.evidence}</p>
                {#if LEVER_META[L.id]}<p class="ld-model"><b>In the model:</b> {LEVER_META[L.id].modelNote}</p>
                  <div class="ld-drives"><span class="dl">moves:</span>{#each LEVER_META[L.id].drives as d}<span class="drv">{DRIVE_LABEL[d]}</span>{/each}</div>{/if}
                <div class="ld-foot"><span class="ld-ref">{L.policyRef}</span>{#if L.url}<a href={L.url} target="_blank" rel="noopener">source ↗</a>{/if}</div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>

  <button class="pe-next" onclick={() => app.toggleDrawer()}>Open the levers drawer →</button>
</div>

<style>
  /* deep-link targets land below the sticky top stack + section nav */
  .anchor { scroll-margin-top: calc(var(--topH, 60px) + 64px); }
  .sec-blurb { margin: 0 0 12px; font-size: 14.5px; line-height: 1.55; color: rgba(28,22,17,0.66); }
  .sec-blurb b { color: var(--ink); }
  .lever-docs { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .ldoc-group { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); overflow: hidden; background: rgba(255,255,255,0.28); }
  .ldoc-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: rgba(28,22,17,0.035); border: none; cursor: pointer; text-align: left; border-left: 3px solid var(--gc); }
  .g-tag { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; color: #fff; background: var(--gc); padding: 2px 5px; border-radius: var(--radius-sharp); }
  .g-label { font-family: 'Fraunces', serif; font-weight: 500; font-size: 14px; flex: 1; }
  .g-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.4); }
  .g-chev { font-size: 10px; color: rgba(28,22,17,0.5); transition: transform 0.2s; }
  .g-chev:not(.open) { transform: rotate(-90deg); }
  .ldoc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; padding: 10px 12px 12px; }
  .ldoc { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-round); padding: 9px 11px; background: rgba(255,255,255,0.4); }
  .ld-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
  .ld-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13.5px; color: var(--ink); }
  .ld-blurb { margin: 0 0 5px; font-size: 11.5px; line-height: 1.45; color: var(--ink); }
  .ld-ev { margin: 0 0 5px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.7); }
  .ld-model { margin: 0 0 5px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.8); }
  .ld-model b { color: var(--ink); }
  .ld-drives { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
  .dl { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.45); }
  .drv { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 1px 5px; }
  .conf { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 5px; border-radius: var(--radius-sharp); font-weight: 600; white-space: nowrap; }
  .conf-high { background: var(--success-bg); color: var(--success); }
  .conf-medium { background: rgba(176,99,46,0.16); color: #b4632e; }
  .conf-low { background: var(--error-border); color: var(--error); }
  .conf-assumption { background: var(--accent-ink-tint-22); color: var(--accent-ink); }
  .ld-foot { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .ld-ref { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  .ld-foot a { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  .seealso { margin: 16px 0 4px; padding: 12px 16px; border-radius: var(--radius-round); border: 1px solid var(--accent-ink-tint-22);
    border-left: 3px solid var(--accent-ink); background: var(--accent-ink-tint-06); }
  .sa-tag { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase;
    color: var(--accent-ink); font-weight: 600; margin-bottom: 5px; }
  .seealso p { margin: 0; font-size: 14px; line-height: 1.6; color: rgba(28,22,17,0.78); }
  .seealso b { color: var(--ink); }
  .seealso a { color: var(--accent-ink); font-weight: 500; text-decoration: none; border-bottom: 1px solid var(--accent-ink-tint-35); }
  .seealso a:hover { border-bottom-color: var(--accent-ink); }
</style>
