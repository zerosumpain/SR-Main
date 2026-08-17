<script lang="ts">
  import { FIX } from '../lib/fixtures';
  import { stats } from '../lib/checks';
  import {
    CATS,
    CONTINGENCY_COLOUR,
    COST,
    COVER,
    PRIOS,
    ROUTE,
    TIERS,
    buildSpec,
    daysOnSite,
    lineTotal,
    money,
    quantities,
    totals,
    type CoverKey,
    type RouteKey,
    type Tier,
  } from '../lib/cost';
  import { persist, s } from '../lib/state.svelte';

  const st = $derived(stats(s.plan));
  const T = $derived(totals(s.cost, st));
  const q = $derived(quantities(st, s.cost.cover));
  const perM2 = $derived(T.total / Math.max(1, q.floor));
  const labourPct = $derived(T.sub ? Math.round((T.by.labour / T.sub) * 100) : 0);

  const bands = $derived([
    ...CATS.map((c) => ({ n: c.n, c: c.c, v: T.by[c.id] })),
    { n: 'Contingency', c: CONTINGENCY_COLOUR, v: T.cont },
  ]);
  const bandSum = $derived(bands.reduce((a, b) => a + b.v, 0) || 1);

  let specMsg = $state('');

  function setMode(m: 'pick' | 'budget') {
    s.cost.mode = m;
    persist();
  }
  function togglePrio(id: string) {
    const at = s.cost.prios.indexOf(id);
    if (at >= 0) s.cost.prios.splice(at, 1);
    else if (s.cost.prios.length < 4) s.cost.prios.push(id);
    persist();
  }
  function runSolver() {
    specMsg = buildSpec(s.cost, st);
    persist();
  }
  function fromPlan() {
    const has = (k: string) => s.plan.items.some((i) => FIX[i.t].k === k);
    s.cost.items.bath.on = has('bath');
    s.cost.items.tray.on = has('shower');
    s.cost.items.valve.on = has('shower') || has('bath');
    s.cost.items.store.on = has('store');
    s.cost.items.rail.on = true;
    if (s.plan.items.some((i) => i.t === 'wcWH'))
      s.cost.items.wc.tier = Math.max(s.cost.items.wc.tier, 1) as Tier;
    if (s.plan.items.some((i) => ['van80', 'van100', 'combo'].includes(i.t)))
      s.cost.items.basin.tier = Math.max(s.cost.items.basin.tier, 1) as Tier;
    if (st.stackDist != null && st.stackDist > 1500) s.cost.items.movewc.on = true;
    specMsg = 'Costed off your layout.';
    persist();
  }
</script>

<svelte:head>
  <title>Money — Bathroom Planner</title>
</svelte:head>

<div class="bth-wrap bth-stack g40">
  <header class="bth-stack g12">
    <span class="bth-eyebrow">04 · Money</span>
    <h1 class="bth-h1">What this is going to cost</h1>
    <p class="bth-lead">
      Two ways round. Either tell it your budget and let it pick a spec, or pick the spec yourself
      and watch the number climb. Both use the same line items, at 2026 North East rates, and both
      size the tiling and flooring off the room in your planner.
    </p>
  </header>

  <div class="bth-stack g16">
    <div class="bth-row">
      <div class="seg" role="group" aria-label="Costing mode">
        <button type="button" aria-pressed={s.cost.mode === 'pick'} onclick={() => setMode('pick')}>
          I'll pick the features
        </button>
        <button type="button" aria-pressed={s.cost.mode === 'budget'} onclick={() => setMode('budget')}>
          I've got a budget
        </button>
      </div>
      <button class="bth-btn" type="button" onclick={fromPlan}>Take the fittings from my plan</button>
    </div>

    {#if s.cost.mode === 'budget'}
      <div class="bth-card">
        <div class="bth-row" style="justify-content:space-between">
          <span class="bth-eyebrow">Total budget, fitted</span>
          <span class="bth-num" style="font-size:var(--fs-num-md)">{money(s.cost.budget)}</span>
        </div>
        <input
          type="range"
          min="3000"
          max="20000"
          step="250"
          bind:value={s.cost.budget}
          oninput={persist}
          aria-label="Total budget"
        />
        <p class="bth-small bth-muted">
          Including labour, materials, waste and a contingency. Not including a new boiler or
          anything structural.
        </p>
        <hr class="bth-rule" />
        <span class="bth-eyebrow">What matters most? Pick up to four</span>
        <div class="prios">
          {#each PRIOS as p (p.id)}
            <label class="prio" class:on={s.cost.prios.includes(p.id)}>
              <input
                type="checkbox"
                checked={s.cost.prios.includes(p.id)}
                onchange={() => togglePrio(p.id)}
              />
              <span>
                <strong>{p.n}</strong><br />
                <span class="bth-small bth-muted">{p.d}</span>
              </span>
            </label>
          {/each}
        </div>
        <div class="bth-row">
          <button class="bth-btn primary" type="button" onclick={runSolver}>Build me a spec →</button>
          {#if specMsg}<span class="bth-small bth-muted">{specMsg}</span>{/if}
        </div>
      </div>
    {/if}

    <div class="bth-tiles">
      <div>
        <div class="k">All in</div>
        <div class="v">{money(T.total)}</div>
        <div class="s">including {s.cost.cont}% contingency</div>
      </div>
      <div>
        <div class="k">Per m²</div>
        <div class="v">{money(perM2)}</div>
        <div class="s">{q.floor.toFixed(1)} m² of floor</div>
      </div>
      <div>
        <div class="k">Labour share</div>
        <div class="v">{labourPct}%</div>
        <div class="s">{money(T.by.labour)} of the works</div>
      </div>
      <div>
        <div class="k">Days on site</div>
        <div class="v">{daysOnSite(s.cost)}</div>
        <div class="s">working days</div>
      </div>
      <div>
        <div class="k">Wall tiling</div>
        <div class="v">{q.wall.toFixed(1)}</div>
        <div class="s">m² · {COVER[s.cost.cover].n.toLowerCase()}</div>
      </div>
    </div>

    <div class="bth-card">
      <h2 class="bth-h3">Where the money goes</h2>
      <div class="bar" role="img" aria-label="Cost breakdown by category">
        {#each bands as b (b.n)}
          <span style="width:{((b.v / bandSum) * 100).toFixed(2)}%;background:{b.c}" title="{b.n}: {money(b.v)}"></span>
        {/each}
      </div>
      <div class="key">
        {#each bands as b (b.n)}
          <span class="keyitem">
            <span class="sw" style="background:{b.c}"></span>{b.n}
            <span class="bth-num bth-muted">{money(b.v)}</span>
          </span>
        {/each}
      </div>
    </div>

    <div class="bth-card">
      <div class="bth-row" style="justify-content:space-between">
        <span class="bth-eyebrow">Contingency for the surprises</span>
        <span class="bth-num"><strong>{s.cost.cont}%</strong></span>
      </div>
      <input type="range" min="0" max="25" step="1" bind:value={s.cost.cont} oninput={persist} aria-label="Contingency percentage" />
      <p class="bth-small bth-muted">
        In a period terrace, 12–15% is realistic. Under 10% is optimistic. It is not spending money
        — it's money you hope to keep.
      </p>
    </div>

    <div class="bth-card">
      <div class="bth-row" style="align-items:flex-end; gap:1rem">
        <div class="bth-field" style="min-width:190px">
          <label for="cover">How much tiling?</label>
          <select class="bth-input" id="cover" bind:value={s.cost.cover} onchange={persist}>
            {#each Object.keys(COVER) as k (k)}
              <option value={k}>{COVER[k as CoverKey].n}</option>
            {/each}
          </select>
        </div>
        <div class="bth-field" style="min-width:230px">
          <label for="route">Who's running it?</label>
          <select class="bth-input" id="route" bind:value={s.cost.route} onchange={persist}>
            {#each Object.keys(ROUTE) as k (k)}
              <option value={k}>Route {k} — {ROUTE[k as RouteKey].n}</option>
            {/each}
          </select>
        </div>
        <p class="bth-small bth-muted" style="flex:1 1 220px">
          Route A adds a showroom's design and management margin; Route C takes off the fitter's
          coordination margin and puts the work on you.
        </p>
      </div>
    </div>

    {#each CATS as cat (cat.id)}
      {@const lines = COST.filter((l) => l.cat === cat.id)}
      {@const catTotal = lines.reduce((a, l) => a + lineTotal(l, s.cost, q), 0) * ROUTE[s.cost.route].m}
      <div class="cat">
        <div class="cathead">
          <span class="dot" style="background:{cat.c}"></span>{cat.n}
          <span class="bth-num cattotal">{money(catTotal)}</span>
        </div>
        {#each lines as line (line.id)}
          {@const state = s.cost.items[line.id]}
          {@const v = lineTotal(line, s.cost, q) * ROUTE[s.cost.route].m}
          <div class="line" class:off={!state.on}>
            <div class="nm">
              {#if line.opt}
                <label class="bth-check">
                  <input type="checkbox" bind:checked={s.cost.items[line.id].on} onchange={persist} />
                  {line.n}
                </label>
              {:else}
                {line.n}
              {/if}
              <span class="sub">
                {#if line.per}
                  {money(line.t[state.tier])} per m² × {(line.per === 'wall' ? q.wall : q.floor).toFixed(1)} m²{line.mat
                    ? ' + waste'
                    : ''}
                {:else}
                  {line.s}
                {/if}
              </span>
            </div>
            <div class="rt">
              <span class="tiersel" role="group" aria-label="Quality for {line.n}">
                {#each TIERS as tn, ti (tn)}
                  <button
                    type="button"
                    aria-pressed={state.tier === ti}
                    onclick={() => { s.cost.items[line.id].tier = ti as Tier; persist(); }}>{tn}</button
                  >
                {/each}
              </span>
              <span class="bth-num amt">{state.on ? money(v) : '—'}</span>
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </div>

  <section class="bth-stack g24">
    <div class="bth-stack g8">
      <span class="bth-eyebrow">Things quotes don't say out loud</span>
      <h2 class="bth-h2">Reading a bathroom quote</h2>
      <hr class="bth-rule" />
    </div>
    <div class="bth-grid two">
      <dl class="bth-defs">
        <dt>"Supply and fit" hides the split</dt>
        <dd>
          Ask for the materials list separately with model numbers. You want to know whether the
          £7,500 is £2,000 of stuff and £5,500 of labour or the other way round. Both are
          legitimate; only one matches what you thought you were buying.
        </dd>
        <dt>Estimate vs quote</dt>
        <dd>
          A quote is a fixed price you can hold someone to. An estimate is a guess with a nice font.
          Get the word "quotation" and a total on the paper.
        </dd>
        <dt>Provisional sums</dt>
        <dd>
          A line like "allow £600 for tiles" means you haven't chosen tiles and the price will
          change. Fine early on; convert them to real numbers before you sign.
        </dd>
        <dt>VAT</dt>
        <dd>
          A VAT-registered firm adds 20%. A sole trader under the threshold doesn't. That's a fifth
          of the bill, so check whether quotes are comparing like with like.
        </dd>
        <dt>Who takes the rubbish?</dt>
        <dd>
          A bath, a suite, old tiles and floor is a proper skip. £200–£400, plus a permit if it's
          going on the street. Make sure it's in someone's price.
        </dd>
        <dt>Parking</dt>
        <dd>
          Genuinely worth a sentence on a terraced street. Where does the van go for nine days, and
          does anyone need a permit?
        </dd>
      </dl>
      <div class="bth-stack g16">
        <div class="bth-note crit">
          <span class="bth-eyebrow">Wildcards worth pricing before you start</span>
          <div class="bth-tablewrap">
            <table>
              <thead><tr><th>Surprise</th><th>Likely cost</th></tr></thead>
              <tbody>
                <tr><td>Rotten or bouncy floor under the bath</td><td class="n">£200–£800</td></tr>
                <tr><td>Moving waste / soil connection</td><td class="n">£300–£1,000</td></tr>
                <tr><td>New soil stack</td><td class="n">£500–£1,500</td></tr>
                <tr><td>Lath &amp; plaster ceiling comes down</td><td class="n">£300–£700</td></tr>
                <tr><td>Consumer unit needs upgrading</td><td class="n">£450–£900</td></tr>
                <tr><td>Old lead or steel pipework found</td><td class="n">£200–£800</td></tr>
                <tr><td>Asbestos test on artex</td><td class="n">£60–£150</td></tr>
                <tr><td>Shower pump or unvented cylinder</td><td class="n">£900–£2,500</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="bth-note">
          <span class="bth-eyebrow">On finance</span>
          <p class="bth-small">
            The big retailers all offer interest-free credit over 2–4 years, usually with a 10–20%
            deposit. It's genuinely free money if you clear it in the term — but the price you're
            financing is a showroom price, typically 15–30% above what the same job costs through a
            local fitter. Compare the total you'll pay, not the monthly. And put at least part of it
            on a credit card: over £100, Section 75 makes the card company jointly liable if it all
            goes wrong.
          </p>
        </div>
      </div>
    </div>
  </section>
</div>

<style>
  .seg {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow: hidden;
    background: var(--surface-card);
  }
  .seg button {
    background: none;
    border: 0;
    border-right: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    padding: 0.45rem 0.8rem;
    cursor: pointer;
  }
  .seg button:last-child { border-right: 0; }
  .seg button[aria-pressed='true'] { background: var(--accent); color: var(--bg); }

  .prios {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 0.5rem;
  }
  .prio {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    cursor: pointer;
    font-size: var(--fs-nav);
    line-height: 1.45;
  }
  .prio.on { border-color: var(--accent); background: var(--accent-tint-08); }
  .prio input { margin-top: 2px; flex: none; }

  /* 2px surface gaps keep adjacent bands legible without a border. */
  .bar {
    display: flex;
    width: 100%;
    height: 32px;
    gap: 2px;
    background: var(--bg-section);
    border-radius: var(--radius-sharp);
    overflow: hidden;
  }
  .bar span { display: block; height: 100%; }
  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.1rem;
  }
  .keyitem {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-size: var(--fs-nav);
    color: var(--text-secondary);
  }
  .key .sw { width: 10px; height: 10px; flex: none; border-radius: var(--radius-sharp); }
  .key .bth-num { font-size: var(--fs-label-xs); }

  .cat {
    border: 1px solid var(--line);
    border-radius: var(--radius-sharp);
    background: var(--surface-card);
    overflow: hidden;
  }
  .cathead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.8rem;
    background: var(--bg-section);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-primary);
  }
  .cathead .dot { width: 9px; height: 9px; border-radius: var(--radius-sharp); flex: none; }
  .cattotal { margin-left: auto; letter-spacing: 0; }
  .line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.5rem 0.9rem;
    padding: 0.5rem 0.8rem;
    border-top: 1px solid var(--line-hair);
    align-items: center;
  }
  .line.off { opacity: 0.45; }
  .nm { font-size: var(--fs-nav); line-height: 1.4; min-width: 0; color: var(--text-primary); }
  .nm .sub {
    display: block;
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    line-height: 1.4;
  }
  .rt { display: flex; align-items: center; gap: 0.6rem; justify-content: flex-end; }
  .amt { font-size: var(--fs-nav); min-width: 66px; text-align: right; color: var(--text-primary); }
  .tiersel {
    display: inline-flex;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    overflow: hidden;
  }
  .tiersel button {
    border: 0;
    border-right: 1px solid var(--line);
    background: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0.15rem 0.4rem;
    cursor: pointer;
    color: var(--text-ghost);
  }
  .tiersel button:last-child { border-right: 0; }
  .tiersel button[aria-pressed='true'] { background: var(--accent); color: var(--bg); }
</style>
