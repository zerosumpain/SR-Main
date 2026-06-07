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
  <h1 class="pe-h1">How it works, and why it’s honest</h1>
  <div class="pe-prose cols">
    {#if app.narrative === 'eli5'}
      <p>
        How does it work? It’s like a flight simulator for schools. You change the policies, and a set of rules — based on the research —
        works out what probably happens, year by year. Every rule comes with a “best guess” plus a range, which is why the charts show a
        fuzzy band of uncertainty rather than one confident line.
      </p>
      <p>
        The most important rule answers the big question: “why does spending loads of money barely change anything?” Because <b>money
        doesn’t buy good results directly</b> — it only helps if it pays for <b>more and better teachers</b>. So in the model, funding
        and pay work by hiring and keeping staff. Pour money in but leave the staffing the same and, rightly, not much happens. The same
        goes for the special-needs budget (it fixes the <i>debt</i>, not the gap) and the local “missions” (they help their own regions).
        The chart and per-lever notes below spell out exactly what each slider changes.
      </p>
    {:else}
      <p>
        This is a <b>system-dynamics and cohort model</b>, not an official forecast. It steps from 2025 to 2040, applying
        research-calibrated response functions — elasticities with diminishing returns and distributed lags — to a small set of state
        variables, mediated through a causal spine in which <b>attendance is the central hub</b>. Every parameter carries a low/central/high
        band and a source or an explicit assumption flag; the Monte-Carlo bands propagate that uncertainty.
      </p>
      <p>
        A deliberate design choice runs through the whole thing and answers the most common question — “why does pouring money in barely
        move the outcomes?”. <b>Money does not buy attainment directly.</b> The funding→attainment elasticity is close to zero at current
        spending (IFS, NFER, Jackson et al.), so the model routes core funding, teacher pay and bursaries <i>through teacher capacity</i> —
        they fund the staff, retention and specialists that actually raise results. Spend a fortune and leave the workforce untouched and
        you will, correctly, see little. The same discipline keeps high-needs funding acting on the SEND deficit (not the gap), and the
        area missions acting regionally (not nationally). The “what moves the needle” chart and the per-lever notes below make every one
        of these channels explicit.
      </p>
    {/if}
  </div>

  <h2 class="pe-h2">Outcomes at a glance</h2>
  {#if app.mounted}<Scorecard sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} />{/if}

  <h2 class="pe-h2">What moves the needle</h2>
  {#if app.narrative === 'eli5'}
    <p class="sec-blurb">Each bar shows how much one slider, pushed all the way, changes the number you pick. Short bars aren’t broken — that slider probably changes a <i>different</i> thing (like the special-needs debt or youth unemployment).</p>
  {:else}
    <p class="sec-blurb">Each bar is how far a single lever, swung across its full range, moves the chosen KPI — the model’s sensitivity laid bare. Short bars are not bugs: many levers act on a <i>different</i> outcome (the deficit, NEET, absence) than the one selected.</p>
  {/if}
  {#if app.mounted}<Sensitivity levers={app.levers} horizon={app.horizon} />{/if}

  <h2 class="pe-h2">Cost &amp; value</h2>
  {#if app.narrative === 'eli5'}
    <p class="sec-blurb">What it costs, and what you get for the money. Heads up: funding, pay and special-needs money get more expensive <i>every year</i> they run, so they cost far more than one-off programmes.</p>
  {:else}
    <p class="sec-blurb">The cost side, and the value (gap closed or attainment gained per £bn) of what you’ve switched on. Note that the three growth-rate levers — funding, pay, high-needs — compound year on year, so their cost is larger and later than the flat programme costs.</p>
  {/if}
  {#if app.mounted}<CostPanel sim={app.viewSim} baseSim={app.viewBase} horizon={app.horizon} />{/if}

  <h2 class="pe-h2">The equations</h2>
  <Methodology />

  <h2 class="pe-h2">Every lever — what it does &amp; why</h2>
  {#if app.narrative === 'eli5'}
    <p class="sec-blurb">All 35 sliders, grouped. Each one says what it is, what the research shows, how the model uses it, and what it changes. Tap a group to open it.</p>
  {:else}
    <p class="sec-blurb">All 35 levers, grouped. Each shows what it represents, what the evidence says, how the <b>model</b> treats it, and which outcomes it drives. Click a group to expand.</p>
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
  .sec-blurb { margin: 0 0 12px; font-size: 14.5px; line-height: 1.55; color: rgba(28,22,17,0.66); }
  .sec-blurb b { color: #1c1611; }
  .lever-docs { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
  .ldoc-group { border: 1px solid rgba(28,22,17,0.1); border-radius: 8px; overflow: hidden; background: rgba(255,255,255,0.28); }
  .ldoc-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 12px; background: rgba(28,22,17,0.035); border: none; cursor: pointer; text-align: left; border-left: 3px solid var(--gc); }
  .g-tag { font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 600; letter-spacing: 0.1em; color: #fff; background: var(--gc); padding: 2px 5px; border-radius: 3px; }
  .g-label { font-family: 'Fraunces', serif; font-weight: 500; font-size: 14px; flex: 1; }
  .g-count { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.4); }
  .g-chev { font-size: 10px; color: rgba(28,22,17,0.5); transition: transform 0.2s; }
  .g-chev:not(.open) { transform: rotate(-90deg); }
  .ldoc-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 10px; padding: 10px 12px 12px; }
  .ldoc { border: 1px solid rgba(28,22,17,0.1); border-radius: 7px; padding: 9px 11px; background: rgba(255,255,255,0.4); }
  .ld-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
  .ld-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 13.5px; color: #1c1611; }
  .ld-blurb { margin: 0 0 5px; font-size: 11.5px; line-height: 1.45; color: var(--ink); }
  .ld-ev { margin: 0 0 5px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.7); }
  .ld-model { margin: 0 0 5px; font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.8); }
  .ld-model b { color: #1c1611; }
  .ld-drives { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; }
  .dl { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.45); }
  .drv { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: #3f7d6e; background: rgba(63,125,110,0.12); border-radius: 3px; padding: 1px 5px; }
  .conf { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 5px; border-radius: 3px; font-weight: 600; white-space: nowrap; }
  .conf-high { background: rgba(47,125,79,0.16); color: #2f7d4f; }
  .conf-medium { background: rgba(176,99,46,0.16); color: #b4632e; }
  .conf-low { background: rgba(177,69,94,0.16); color: #b1455e; }
  .conf-assumption { background: rgba(122,90,166,0.16); color: #7a5aa6; }
  .ld-foot { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  .ld-ref { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  .ld-foot a { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
