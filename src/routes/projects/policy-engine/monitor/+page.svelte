<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import {
    TIMELINE, INFRA, INFRA_COLS, STATUS_META, LOOP, KEY_STATS,
  } from '../lib/monitoring';
  import SpineVsIdentifier from '../components/SpineVsIdentifier.svelte';
  import EthicsGuardrails from '../components/EthicsGuardrails.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import AnalysisOnOutcome from '../components/AnalysisOnOutcome.svelte';
  import ConfidenceBadge from '../components/ConfidenceBadge.svelte';
  import TrackingDashboard from '../components/TrackingDashboard.svelte';
  import { STORIES } from '../lib/stories';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  import {
    SUBSID_NOTES, SECTOR_LEDGER, TRUST_LEDGER, COUNTERWEIGHTS, SHARING_LADDER, AGENDAS,
    SUBSID_TEST, SUBSID_PRINCIPLES,
    EDTECH_THESIS, EDTECH_ESTATE, EDTECH_PRECEDENTS, EDTECH_BARRIERS, EDTECH_LEVERS,
  } from '../lib/monitorIntel';

  const eli = $derived(app.narrative === 'eli5');
  const TAG_COLOUR: Record<string, string> = { spine: '#2f6f97', identifier: '#7a5aa6', attendance: '#b1455e', ai: '#3f7d6e' };

  // ---- feedback-loop ring geometry ----
  const CX = 175, CY = 175, R = 116, GAP = 6;
  const QUAD = [-135, -45, 45, 135]; // quadrant boundaries
  const polar = (deg: number, r = R) => {
    const a = (deg * Math.PI) / 180;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  };
  const arcPath = (a0: number, a1: number) => {
    const p0 = polar(a0), p1 = polar(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${p0.x.toFixed(1)} ${p0.y.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  };
  const ARCS = LOOP.map((l, i) => {
    const a0 = QUAD[i] + GAP, a1 = QUAD[i + 1 === 4 ? 0 : i + 1] + (i === 3 ? 360 : 0) - GAP;
    const mid = (QUAD[i] + (i === 3 ? QUAD[0] + 360 : QUAD[i + 1])) / 2;
    return { ...l, path: arcPath(a0, a1), badge: polar(mid), n: i + 1 };
  });

  const silos = ['NPD', 'School census', 'Workforce census', 'Attendance feed', 'Explore Ed Stats'];
</script>

<svelte:head><title>Monitoring — How would we know if a policy worked? · Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.monitor} />

  {#snippet subnote(k: string)}
    <aside class="subsid">
      <span class="sb-lab">⚖ Central or local?</span>
      <p>{eli ? SUBSID_NOTES[k].eli5 : SUBSID_NOTES[k].research}</p>
    </aside>
  {/snippet}

  <div class="pe-prose lede">
    {#if eli}
      <p>
        This whole simulator lets you pull levers and watch the numbers move. But a model that never meets reality is just a confident
        guess. So here’s the question sitting underneath every scenario: in the <b>real</b> school system, how would anyone know whether a
        policy actually worked — soon enough to do something about it?
      </p>
      <p>
        England has just promised the plumbing to answer that: a <b>“data spine”</b> announced at Bett in January 2026, a new <b>one-number-per-child</b>
        law, and a growing stack of AI tools — one already compares every school’s attendance to its 20 most-similar schools twice a day. Other
        countries got there first. This page is about building that feedback loop — and the cautionary tale of getting it badly wrong.
      </p>
    {:else}
      <p>
        Every scenario in this Field Study rests on one assumption: that someone, somewhere, can <i>observe</i> the outcome a lever is meant to
        move. In England’s real data estate that has historically been intermittent — and a simulation is only ever as reliable as the data that
        corrects it. So the question underneath the model is an infrastructure question: <b>how would the actual school system know whether a
        policy worked, fast enough to steer within a child’s school career rather than after it?</b>
      </p>
      <p>
        England has just committed to the plumbing — a DfE <b>“data spine”</b> (Bett, Jan 2026; White Paper, Feb 2026), a statutory <b>consistent
        identifier</b> for every child (Children’s Wellbeing and Schools Act 2026), and an emerging AI layer, one piece of which already
        benchmarks every school’s attendance against its 20 nearest peers twice daily. Estonia, New Zealand, the Netherlands and the Nordics got
        there years earlier. This page draws out what a real feedback loop looks like, what other countries already run — and why the same
        machinery that enables it can do real harm.
      </p>
    {/if}
  </div>

  <!-- ===================== 0 · live tracking — model vs reality ===================== -->
  <section class="block">
    <h2 class="pe-h2">Is reality tracking the model?</h2>
    <p class="cap">
      {#if eli}
        The whole point of a model is to be checked against what actually happens. Below, every projection the simulator can be held to is
        lined up against the real official number — and a robot quietly refreshes it whenever the government publishes new data, stamping when
        it last changed. Green means reality is keeping up with the plan; red means it has fallen behind.
      {:else}
        A model that never meets reality is just a confident guess. This table closes the loop: each indicator the engine projects is paired
        with its live official counterpart (DfE Explore Education Statistics, ONS, the World Bank), compared against <b>both</b> the status-quo and
        announced-policy trajectories, and refreshed automatically by scheduled jkai workflows — each carrying a "data last updated" stamp drawn
        from the source's own publication date.
      {/if}
    </p>
    <TrackingDashboard tracked={data.tracked} />
  </section>

  <!-- ===================== 1 · the measurement problem ===================== -->
  <section class="block">
    <h2 class="pe-h2">1 · You can’t manage what you can’t see</h2>
    <p class="cap">
      {#if eli}
        England already collects an enormous amount about schools — but it’s kept in separate boxes that don’t talk to each other, so by the
        time you learn whether something worked, the children it was meant to help have moved on. The government now admits the data is
        “trapped in closed systems”. A spine is the wiring that connects them.
      {:else}
        The DfE already holds extraordinary raw material — the National Pupil Database, the school and workforce censuses, Explore Education
        Statistics, and now a daily attendance feed — but historically as <b>separate surfaces, not a connected whole</b>. The OECD’s diagnosis
        (and the Education Secretary’s own phrase): insight stays <b>“trapped in closed systems”</b>. The value of a measurement system isn’t the
        data it stores; it’s the speed and accuracy of the correction it enables.
      {/if}
    </p>
    <div class="spinemap">
      <div class="sm-side today">
        <span class="sm-lab">Today — siloed</span>
        <div class="sm-silos">
          {#each silos as s (s)}<span class="sm-silo">{s}</span>{/each}
        </div>
        <span class="sm-x">✕ can’t exchange · re-entered system by system</span>
      </div>
      <div class="sm-arrow" aria-hidden="true">→</div>
      <div class="sm-side withspine">
        <span class="sm-lab">With a data spine</span>
        <div class="sm-conn">
          <div class="sm-srcs">{#each silos as s (s)}<span class="sm-src">{s}</span>{/each}</div>
          <div class="sm-spine"><span>DATA SPINE · open standards</span></div>
          <div class="sm-outs">
            <span class="sm-out">Teachers</span><span class="sm-out">Leaders</span><span class="sm-out">Parents</span><span class="sm-out hot">Faster “did it work?”</span>
          </div>
        </div>
      </div>
    </div>
    <p class="offaxis">
      {eli
        ? 'The White Paper’s goal: data should “flow seamlessly, not be locked within individual systems”, so schools get quicker insight into what’s working.'
        : 'White Paper (CP 1508-I): data should “flow seamlessly, not be locked within individual systems”, giving schools “more immediate insight about the effectiveness of interventions”. That last clause is the finding this page examines.'}
    </p>
    <div class="conf-row">
      <ConfidenceBadge level="contested" note="The spine is announced but unbuilt; the custody design is unresolved as of June 2026." />
      <span class="conf-note">{eli ? 'How settled is the data-gap picture? Independent analysts broadly agree the gap is real; the fix is contested.' : 'Confidence on the data-gap finding: independent analyses broadly converge that the measurement gaps are real; the appropriate remedy (and the spine’s custody design) is contested.'}</span>
    </div>
    <AnalysisOnOutcome theme="data-gap" title={eli ? 'What independent analysts say about the data gaps' : 'What the analysts find — the data-gap theme'} />
    {@render subnote('silos')}
  </section>

  <!-- ===================== 2 · spine + join key ===================== -->
  <section class="block">
    <StorySection title="2 · England’s answer — and the thing everyone conflates">
    {#snippet prose()}
    <p class="cap">
      {eli
        ? 'Two different things got announced close together, and people keep mixing them up. One is the wiring. The other is a shared number for each child. Here’s the difference — and the timeline that put them on the table.'
        : 'England’s response has two distinct moving parts with different legal bases, easily — and constantly — conflated. The timeline is the public record; the cards beneath it keep the two instruments strictly apart.'}
    </p>
    <p class="offaxis warn">
      {eli
        ? 'Reality check: the spine is a promise, not a built thing. As of mid-2026 there’s no published design, no procurement and no finish date — which also means the big choices about how it works are still open.'
        : 'Status: the data spine is an announced commitment, not a live system — as of June 2026 there are no published architecture, procurement or delivery artefacts. That cuts both ways: nothing is built, so the custody design (the theme of this page) is still entirely open.'}
    </p>
    {/snippet}
    {#snippet data()}
    <!-- announcement timeline -->
    <div class="tl">
      <div class="tl-line" aria-hidden="true"></div>
      {#each TIMELINE as e (e.date)}
        <div class="tl-ev" style="--c:{TAG_COLOUR[e.tag]}">
          <span class="tl-dot"></span>
          <span class="tl-date">{e.date}</span>
          <span class="tl-title">{e.title}</span>
          <span class="tl-what">{eli ? e.eli5 : e.what}</span>
          <a class="tl-src" href={e.url} target="_blank" rel="noopener" aria-label="source">↗</a>
        </div>
      {/each}
    </div>

    <SpineVsIdentifier />
    {/snippet}
    </StorySection>
  </section>

  <!-- ===================== 3 · attendance is the leading indicator ===================== -->
  <section class="block">
    <h2 class="pe-h2">3 · Attendance is the leading indicator — and it’s already wired</h2>
    <p class="cap">
      {#if eli}
        Out of everything a school tracks, <b>attendance is the smoke alarm</b> — it tells you a child is in trouble earlier and more reliably
        than test scores do. And it’s the one piece that already exists at national scale: England collects attendance from every school twice
        a day. This is why the whole simulator treats attendance as the hub.
      {:else}
        If the spine is mostly promise, attendance is the part that already runs — and it is the single strongest early signal in the dossier.
        US dropout research converges on the <b>“ABC”</b> indicators (Attendance, Behaviour, Course performance); within them attendance is the
        <b>earliest and most predictive</b>. It is also operational in England: daily attendance sharing has been mandatory since 2024/25. This is
        the empirical reason the engine makes <b>attendance the central hub</b>.
      {/if}
    </p>

    <div class="cascade">
      {#each [
        { stage: 'Reception / Year 1', find: eli ? 'Missing lots of school this early is linked to not reading well by age 8.' : 'Chronic absence (missing ≥10% of days) predicts not reading at grade level by age 8.', mult: '', tone: 'a' },
        { stage: 'Age 8 · reading', find: eli ? 'Children who can’t read well by 8 are far more likely to drop out later.' : 'Third-grade non-readers are about 4× more likely to drop out (Casey Foundation, 2011).', mult: '~4×', tone: 'b' },
        { stage: 'Secondary · Y8–11', find: eli ? 'Being often absent in any single secondary year sharply raises the odds of dropping out.' : 'Chronic absence in any single year (grades 8–12): >7× more likely to drop out (Utah / Attendance Works).', mult: '>7×', tone: 'c' },
        { stage: 'Age 16+ · post-16', find: eli ? 'By this age, whether they turn up tells you more than their grades do.' : 'By high school, attendance out-predicts test scores — the NEET exit boundary.', mult: '', tone: 'd' },
      ] as s, i (s.stage)}
        <div class="csc {s.tone}">
          <span class="csc-stage">{s.stage}</span>
          {#if s.mult}<span class="csc-mult">{s.mult}</span>{/if}
          <span class="csc-find">{s.find}</span>
        </div>
        {#if i < 3}<span class="csc-arr" aria-hidden="true">→</span>{/if}
      {/each}
    </div>

    <div class="similar">
      <svg viewBox="0 0 120 120" class="ring" role="img" aria-label="A school benchmarked against its 20 most-similar peers">
        <circle cx="60" cy="60" r="50" class="ring-track" />
        {#each Array.from({ length: 20 }) as _, i (i)}
          {@const a = (i / 20) * 2 * Math.PI - Math.PI / 2}
          <circle cx={60 + 50 * Math.cos(a)} cy={60 + 50 * Math.sin(a)} r="4.6" class="ring-peer" />
        {/each}
        <circle cx="60" cy="60" r="13" class="ring-self" />
        <text x="60" y="64" class="ring-txt">you</text>
      </svg>
      <div class="similar-body">
        <h3>Already deployed: the “similar 20 schools” algorithm</h3>
        <p>
          {#if eli}
            A live DfE tool gives each school its 20 most-alike schools and quietly says “here are three things to look at”. The attendance data
            behind it refreshes <b>twice a day</b> — close to live, but not quite real-time.
          {:else}
            A deployed DfE model (gradient-boosted trees for variable selection, then weighted Euclidean distance) assigns each school its <b>20
            most-similar peers</b> and returns half-termly comparison reports — logged on the Algorithmic Transparency Standard. The feed refreshes
            <b>twice daily</b> from school systems: near-daily batch, <i>not</i> real-time.
          {/if}
        </p>
      </div>
    </div>
    {@render subnote('attendance')}
  </section>

  <!-- ===================== 4 · AI in the loop ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · From data to decision — AI in the feedback loop</h2>
    <p class="cap">
      {eli
        ? 'A feedback loop has two halves: spotting what’s happening, and acting on it fast enough to matter. AI is starting to help with both — but the loop only closes if you also check whether things actually worked.'
        : 'A feedback loop has two halves — detecting what’s happening, and acting on it fast enough to matter. England’s emerging AI stack touches both, from grounding models in real curriculum data to theming consultation responses ~120× faster. The loop only closes with evaluation — and one official piece (a national education-policy simulator) is absent.'}
    </p>
    <div class="loop">
      <svg viewBox="0 0 350 350" class="loop-svg" role="img" aria-label="The four arcs of a policy feedback loop: collect, analyse, evaluate, decide">
        {#each ARCS as a (a.key)}
          <path d={a.path} fill="none" stroke={a.colour} stroke-width="26" stroke-linecap="round" opacity="0.9" />
          <circle cx={a.badge.x} cy={a.badge.y} r="13" fill="#f1ead6" stroke={a.colour} stroke-width="2.5" />
          <text x={a.badge.x} y={a.badge.y + 4} class="loop-n" fill={a.colour}>{a.n}</text>
        {/each}
        <text x={CX} y={CY - 6} class="loop-c1">THE FEEDBACK</text>
        <text x={CX} y={CY + 12} class="loop-c1">LOOP</text>
        <text x={CX} y={CY + 32} class="loop-c2">↻ correct within a school career</text>
      </svg>
      <div class="loop-legend">
        {#each LOOP as l, i (l.key)}
          <div class="ll" style="--c:{l.colour}">
            <span class="ll-n">{i + 1}</span>
            <div>
              <span class="ll-lab">{eli ? l.eli5 : l.label}</span>
              <span class="ll-det">{l.detail}</span>
            </div>
          </div>
        {/each}
      </div>
    </div>
    <p class="offaxis">
      {eli
        ? 'One point to note: the official government “digital twins” are for roads and energy, not schools. A research-backed policy simulator like this one is a real gap — which is partly why it exists (as a personal project, not an official tool).'
        : 'One gap to note: government “digital twins” (the National Digital Twin Programme) are infrastructure-focused — there is no national education-policy simulator. This Field Study addresses that gap as a personal-capacity experiment, and is not an official DfE tool.'}
    </p>
  </section>

  <!-- ===================== 5 · what other countries do ===================== -->
  <section class="block">
    <h2 class="pe-h2">5 · What other countries already do</h2>
    <p class="cap">
      {eli
        ? 'England is a relative latecomer. The pattern abroad is always the same: one durable ID for each person + systems that genuinely talk to each other = a system you can actually steer. Here’s who runs what.'
        : 'England is a relative latecomer, and the international field shows both the prize and the variety of routes to it. The common thread the OECD draws: a single durable identifier plus genuine interoperability is what turns scattered records into a steerable system. The matrix shows how far each has got; England’s row is the catch-up.'}
    </p>

    <!-- matrix -->
    <div class="matrix">
      <div class="mx-head">
        <span class="mx-country">System</span>
        {#each INFRA_COLS as c (c.key)}<span class="mx-col">{c.label}</span>{/each}
      </div>
      {#each INFRA as r (r.country)}
        <div class="mx-row" class:eng={r.country === 'England'}>
          <span class="mx-country"><b>{r.flag} {r.country}</b><small>{r.system}</small></span>
          {#each INFRA_COLS as c (c.key)}
            {@const cell = r.cells[c.key]}
            {@const m = STATUS_META[cell.level]}
            <span class="mx-cell" style="--cc:{m.colour};--cr:{m.ring}"><i></i>{cell.label}</span>
          {/each}
        </div>
      {/each}
      <div class="mx-key">
        {#each Object.entries(STATUS_META) as [k, m] (k)}<span class="mx-kk"><i style="background:{m.colour}"></i>{m.note}</span>{/each}
      </div>
    </div>

    <!-- country cards -->
    <div class="cards">
      {#each INFRA as r (r.country)}
        <article class="ccard" class:eng={r.country === 'England'}>
          <header><span class="cc-flag">{r.flag}</span><span class="cc-name">{r.country}</span></header>
          <span class="cc-sys">{r.system}</span>
          <p class="cc-mech">{r.mechanism}</p>
          <p class="cc-res"><b>Result:</b> {r.result}</p>
          <p class="cc-les"><span class="cc-tag">For England</span>{r.lesson}</p>
          <a class="cc-src" href={r.sourceUrl} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
  </section>

  <!-- ===================== 6 · the sector ledger ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · Who shares what today — the sector ledger</h2>
    <p class="cap">
      {eli
        ? 'Before designing anything new, the baseline: what each part of the system already hands to the centre, since when, and what it keeps. Plus the recorded history of how that trust was earned, lost and partly rebuilt.'
        : 'The current sharing settlement, sector by sector: every statutory flow, its cadence and vintage, and what deliberately stays local — followed by the trust ledger, because the published register and approval machinery exist as scar tissue from specific failures.'}
    </p>
    <div class="ledger">
      {#each SECTOR_LEDGER as s (s.sector)}
        <article class="sec" style="--sc:{s.colour}">
          <h3 class="sec-h">{s.sector}</h3>
          <div class="sec-flows">
            {#each s.shares as f (f.name)}
              <div class="flow">
                <span class="fl-name">{f.name}</span>
                <span class="fl-meta">{f.cadence} · since {f.since}</span>
                {#if !eli}<span class="fl-note">{f.note}</span>{/if}
              </div>
            {/each}
          </div>
          <p class="sec-not"><b>{eli ? 'Stays local:' : 'Not centrally collected:'}</b> {eli ? '' : s.notShared}{#if eli}{s.eli5}{/if}</p>
        </article>
      {/each}
    </div>

    <h3 class="sub-h">{eli ? 'How the trust was won and lost' : 'The trust ledger, 2002–2026'}</h3>
    <div class="trust">
      {#each TRUST_LEDGER as t (t.year + t.event)}
        <div class="tr-ev {t.tone}">
          <span class="tr-yr">{t.year}</span>
          <span class="tr-what">{t.event}</span>
        </div>
      {/each}
    </div>
    {@render subnote('ledger')}
  </section>

  <!-- ===================== 7 · the sector-led counterweight ===================== -->
  <section class="block">
    <h2 class="pe-h2">7 · The counterweight — centre funds, sector owns</h2>
    <p class="cap">
      {eli
        ? 'The alternative to “send it all to Whitehall” already exists and works. In each of these, the centre pays for tools or sets a framework — and the data stays with the people who collected it.'
        : 'The working alternatives to central custody, by sector. The common architecture: the centre funds, convenes or legislates the connection; the sector builds, holds and operates. These are documented instances of the lower-custody posture.'}
    </p>
    <div class="cw-cards">
      {#each COUNTERWEIGHTS as c (c.name)}
        <article class="cw" style="--cc:{c.colour}">
          <header class="cw-head"><span class="cw-name">{c.name}</span><span class="cw-sec">{c.sector}</span></header>
          <p class="cw-what">{c.what}</p>
          <p class="cw-num"><b>{eli ? 'Scale:' : 'Numbers:'}</b> {c.numbers}</p>
          <p class="cw-lesson"><span class="cw-tag">The lesson</span>{c.lesson}</p>
          <a class="cw-src" href={c.url} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
    {@render subnote('counterweight')}
  </section>

  <!-- ===================== 8 · the sharing ladder ===================== -->
  <section class="block">
    <h2 class="pe-h2">8 · The sharing ladder — five ways to learn without taking</h2>
    <p class="cap">
      {eli
        ? 'Technology has quietly solved most of this argument: there are now at least five ways to answer national questions from local data, from “take a copy of everything” down to “the data never moves at all”.'
        : 'The methodological menu, ordered from most to least extractive. The strategic question for every future collection: what is the LOWEST rung that meets the purpose? Today’s estate sits almost entirely on rung 1; health has industrialised rung 4.'}
    </p>
    <div class="rungs">
      {#each SHARING_LADDER as r (r.rung)}
        <article class="lrung" class:opp={r.opportunity} style="--lc:{r.colour}">
          <header class="lr-head">
            <span class="lr-n">{r.rung}</span>
            <span class="lr-name">{r.name}</span>
            {#if r.opportunity}<span class="lr-opp">{eli ? 'the missing piece' : 'the unbuilt opportunity'}</span>{/if}
          </header>
          <p class="lr-how">{r.how}</p>
          <div class="lr-meta">
            <span><b>{eli ? 'Who keeps the data:' : 'Custody:'}</b> {r.custody}</span>
            <span><b>{eli ? 'In schools today:' : 'In education:'}</b> {r.inEducation}</span>
          </div>
        </article>
      {/each}
    </div>
    {@render subnote('ladder')}
  </section>

  <!-- ===================== 9 · the shadow estate (edtech) ===================== -->
  <section class="block">
    <h2 class="pe-h2">9 · The shadow estate — what the edtech market already measures</h2>
    <p class="cap">{eli ? EDTECH_THESIS.eli5 : EDTECH_THESIS.research}</p>

    <div class="et-cats">
      {#each EDTECH_ESTATE as c (c.category)}
        <article class="etc" style="--ec:{c.colour}">
          <h3 class="etc-h">{c.category}</h3>
          <div class="etc-entries">
            {#each c.entries as e (e.name)}
              <div class="ete">
                <span class="ete-name">{e.name}</span>
                <span class="ete-scale">{e.scale}</span>
                {#if !eli}<span class="ete-data">{e.data}</span>{/if}
              </div>
            {/each}
          </div>
          <p class="etc-signal"><span class="etc-tag">{eli ? 'What it could tell us' : 'The system signal'}</span>{c.signal}</p>
        </article>
      {/each}
    </div>

    <h3 class="sub-h">{eli ? 'Proof it can work' : 'The precedents — and the dogs that didn’t bark'}</h3>
    <div class="et-prec">
      {#each EDTECH_PRECEDENTS as p (p.name)}
        <div class="etp">
          <span class="etp-name">{p.name}</span>
          <p class="etp-what">{eli ? p.eli5 : p.what}</p>
        </div>
      {/each}
    </div>

    <h3 class="sub-h">{eli ? 'Why it hasn’t happened' : 'The barriers'}</h3>
    <div class="et-bars">
      {#each EDTECH_BARRIERS as b (b.kind)}
        <div class="etb">
          <span class="etb-kind">{b.kind}</span>
          <p class="etb-det">{eli ? b.eli5 : b.detail}</p>
        </div>
      {/each}
    </div>

    <h3 class="sub-h">{eli ? 'Options that need no new collection' : 'Options that would not require new central collection'}</h3>
    <div class="et-levers">
      {#each EDTECH_LEVERS as l, i (l.name)}
        <div class="etl"><span class="etl-n">{i + 1}</span><div><span class="etl-name">{l.name}</span><span class="etl-what">{l.what}</span></div></div>
      {/each}
    </div>
    {@render subnote('edtech')}
  </section>

  <!-- ===================== 10 · the agenda collision map ===================== -->
  <section class="block">
    <h2 class="pe-h2">10 · The agendas that overlink</h2>
    <p class="cap">
      {eli
        ? 'The spine isn’t happening in a vacuum — half a dozen big government plans pull on the same data. Each card says what the plan is and what it means for schools data.'
        : 'The strategic context: every live cross-government data agenda intersects the spine, and each will inherit — or set — its custody posture. The map, with the education implication drawn out per agenda.'}
    </p>
    <div class="ag-cards">
      {#each AGENDAS as a (a.name)}
        <article class="ag" style="--ac:{a.colour}">
          <header class="ag-head"><span class="ag-name">{a.name}</span><span class="ag-owner">{a.owner}</span></header>
          <p class="ag-what">{a.what}</p>
          <p class="ag-link"><span class="ag-tag">{eli ? 'What it means here' : 'For the spine'}</span>{a.spineLink}</p>
        </article>
      {/each}
    </div>
    {@render subnote('agendas')}
  </section>

  <!-- ===================== 11 · the subsidiarity test ===================== -->
  <section class="block">
    <h2 class="pe-h2">11 · The subsidiarity test — when should the centre collect?</h2>
    <p class="cap">
      {eli
        ? 'Pulling the thread that’s run through this whole page into four questions any new data collection should have to answer — and the posture that falls out of them.'
        : 'The theme, made operational: four questions that decide whether central collection, central support or local custody is the right answer for any proposed flow — the test the spine’s architecture should be held to.'}
    </p>
    <div class="test">
      {#each SUBSID_TEST as t, i (t.q)}
        <div class="tq">
          <span class="tq-n">{i + 1}</span>
          <div class="tq-body">
            <span class="tq-q">{t.q}</span>
            <span class="tq-a yes"><b>{eli ? 'If yes →' : 'Yes →'}</b> {t.ifYes}</span>
            <span class="tq-a no"><b>{eli ? 'If no →' : 'No →'}</b> {t.ifNo}</span>
          </div>
        </div>
      {/each}
    </div>
    <div class="posture">
      <span class="po-lab">{eli ? 'The rule of thumb' : 'The lower-custody posture, as one criterion'}</span>
      <p>{eli ? SUBSID_PRINCIPLES.eli5 : SUBSID_PRINCIPLES.research}</p>
    </div>
  </section>

  <!-- ===================== 12 · ethics ===================== -->
  <section class="block">
    <h2 class="pe-h2">12 · The hard part — support, not surveillance</h2>
    <p class="cap">
      {eli
        ? 'The same tools that spot a struggling child early can also mislabel them. This isn’t hypothetical — here’s what went wrong elsewhere, and the safeguards that address it.'
        : 'The analytical core of this page: the same machinery that enables a good feedback loop also enables documented harm, and the evidence is not hypothetical. The line the simulator draws — a model, or an algorithm, as a tool for asking better questions of humans rather than a verdict delivered to a child — is an evaluable design criterion, not a normative claim.'}
    </p>
    <EthicsGuardrails />
  </section>

  <!-- ===================== stats + closer ===================== -->
  <section class="block">
    <h2 class="pe-h2">The numbers behind the loop</h2>
    <div class="stats">
      {#each KEY_STATS as s (s.big)}
        <a class="stat" href={s.url} target="_blank" rel="noopener"><span class="stat-big">{s.big}</span><span class="stat-lab">{s.label}</span></a>
      {/each}
    </div>
  </section>

  <section class="block takeaway">
    <h2 class="pe-h2">{eli ? 'So what does this mean for the sliders?' : 'How this ties back to the model'}</h2>
    <div class="pe-prose">
      <p>
        {eli
          ? 'This simulator is a guess that gets better the more it meets reality. The data spine, the one-number-per-child law and the attendance feed are how reality could talk back — letting you check the model’s lines against what actually happens, and steer while it still matters.'
          : 'This engine is an explicit, research-backed hypothesis. A data spine, a consistent identifier and the live attendance feed are how reality could close the loop on it — letting the model’s projections be checked against the real system fast enough to act. The clearest worked example is the one this site already models as an outcome: NEET.'}
      </p>
    </div>
    <a class="pe-next" href="/projects/policy-engine/neet">A worked example → A NEET early-warning system</a>
  </section>
</div>

<style>
  .lede { max-width: 80ch; }
  .lede b { color: var(--ink); } .lede a { color: var(--accent-ink); }
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: var(--fs-nav); line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 90ch; }
  .cap b { color: var(--ink); }
  .offaxis { margin: 12px 0 0; padding: 9px 13px; border-radius: var(--radius-sharp); font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.72);
    background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.1); }
  .offaxis b { color: var(--ink); }
  .offaxis.warn { background: var(--error-bg); border-color: var(--error-border); color: var(--error); }
  .offaxis.warn b { color: var(--error); }
  .sub-h { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); margin: 22px 0 10px; color: var(--ink); }
  .conf-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 12px 0 0; }
  .conf-note { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.66); flex: 1 1 280px; }

  /* the recurring theme aside */
  .subsid { margin: 14px 0 0; padding: 11px 14px; border-radius: var(--radius-sharp); max-width: 88ch;
    border: 1px solid rgba(154,123,31,0.35); border-left: 3px solid #9a7b1f; background: rgba(154,123,31,0.06); }
  .sb-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.12em;
    text-transform: uppercase; color: #7a621a; font-weight: 600; margin-bottom: 5px; }
  .subsid p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.76); }

  /* 6 · sector ledger */
  .ledger { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(330px, 100%), 1fr)); gap: 12px; }
  .sec { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--sc); border-radius: var(--radius-sharp); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 8px; }
  .sec-h { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); margin: 0; color: var(--sc); }
  .sec-flows { display: flex; flex-direction: column; gap: 7px; }
  .flow { border-left: 2px solid rgba(28,22,17,0.15); padding-left: 9px; display: flex; flex-direction: column; gap: 1px; }
  .fl-name { font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .fl-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .fl-note { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.65); }
  .sec-not { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); padding-top: 6px; border-top: 1px dashed rgba(28,22,17,0.15); }
  .sec-not b { color: var(--ink); }

  .trust { display: flex; flex-direction: column; gap: 6px; max-width: 88ch; }
  .tr-ev { display: grid; grid-template-columns: 52px 1fr; gap: 10px; align-items: baseline; padding: 6px 10px; border-radius: var(--radius-sharp); }
  .tr-ev.bad { background: var(--error-bg); border-left: 3px solid var(--error-border); }
  .tr-ev.good { background: var(--success-bg); border-left: 3px solid var(--success-border); }
  .tr-ev.neutral { background: rgba(28,22,17,0.03); border-left: 3px solid rgba(28,22,17,0.25); }
  .tr-yr { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .tr-what { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.76); }

  /* 7 · counterweights */
  .cw-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 12px; }
  .cw { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--cc); border-radius: var(--radius-sharp); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 7px; }
  .cw-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .cw-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); color: var(--ink); }
  .cw-sec { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--cc); }
  .cw-what, .cw-num { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .cw-num b { color: var(--ink); }
  .cw-lesson { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: var(--ink); }
  .cw-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--cc); margin-bottom: 2px; }
  .cw-src { margin-top: auto; align-self: flex-start; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }

  /* 8 · sharing ladder */
  .rungs { display: flex; flex-direction: column; gap: 10px; max-width: 96ch; }
  .lrung { border: 1px solid rgba(28,22,17,0.13); border-left: 4px solid var(--lc); border-radius: var(--radius-sharp); padding: 11px 14px; background: rgba(255,255,255,0.42); }
  .lrung.opp { background: var(--accent-ink-tint-12); border-color: var(--accent-ink-tint-35); }
  .lr-head { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; flex-wrap: wrap; }
  .lr-n { font-family: var(--fs-serif); font-weight: 600; font-size: 18px; color: var(--lc); }
  .lr-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .lr-opp { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    color: #fff; background: var(--accent-ink); padding: 2px 7px; border-radius: var(--radius-sharp); }
  .lr-how { margin: 0 0 6px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .lr-meta { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.68); }
  .lr-meta b { color: var(--ink); }

  /* 9 · the shadow estate (edtech) */
  .et-cats { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(330px, 100%), 1fr)); gap: 12px; }
  .etc { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--ec); border-radius: var(--radius-sharp); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 8px; }
  .etc-h { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); margin: 0; color: var(--ec); }
  .etc-entries { display: flex; flex-direction: column; gap: 7px; }
  .ete { border-left: 2px solid rgba(28,22,17,0.15); padding-left: 9px; display: flex; flex-direction: column; gap: 1px; }
  .ete-name { font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .ete-scale { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .ete-data { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.65); }
  .etc-signal { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: var(--ink); padding-top: 6px; border-top: 1px dashed rgba(28,22,17,0.15); }
  .etc-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ec); margin-bottom: 2px; }
  .et-prec { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 10px; }
  .etp { border: 1px solid var(--success-border); border-radius: var(--radius-sharp); padding: 10px 12px; background: var(--success-bg); }
  .etp-name { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--success); text-transform: uppercase; letter-spacing: 0.03em; }
  .etp-what { margin: 5px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .et-bars { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 10px; }
  .etb { border: 1px dashed var(--error-border); border-radius: var(--radius-sharp); padding: 10px 12px; background: var(--error-bg); }
  .etb-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: #8a2d3a; text-transform: uppercase; letter-spacing: 0.03em; }
  .etb-det { margin: 5px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .et-levers { display: flex; flex-direction: column; gap: 8px; max-width: 96ch; }
  .etl { display: flex; gap: 11px; align-items: flex-start; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 10px 13px; background: rgba(255,255,255,0.4); }
  .etl-n { flex-shrink: 0; width: 24px; height: 24px; border-radius: var(--radius-pill); background: var(--ink); color: var(--paper);
    font-family: var(--font-mono); font-size: var(--fs-label-xs); display: inline-flex; align-items: center; justify-content: center; }
  .etl-name { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); color: var(--ink); margin-bottom: 2px; }
  .etl-what { display: block; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); }

  /* 10 · agendas */
  .ag-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 12px; }
  .ag { border: 1px solid rgba(28,22,17,0.13); border-top: 3px solid var(--ac); border-radius: var(--radius-sharp); padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 7px; }
  .ag-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .ag-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .ag-owner { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .ag-what { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .ag-link { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: var(--ink); }
  .ag-tag { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ac); margin-bottom: 2px; }

  /* 10 · the test */
  .test { display: flex; flex-direction: column; gap: 10px; max-width: 96ch; margin-bottom: 16px; }
  .tq { display: flex; gap: 12px; align-items: flex-start; border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 11px 14px; background: rgba(255,255,255,0.4); }
  .tq-n { flex-shrink: 0; width: 26px; height: 26px; border-radius: var(--radius-pill); background: var(--ink); color: var(--paper);
    font-family: var(--font-mono); font-size: var(--fs-label); display: inline-flex; align-items: center; justify-content: center; }
  .tq-body { display: flex; flex-direction: column; gap: 4px; }
  .tq-q { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .tq-a { font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .tq-a.yes b { color: var(--success); } .tq-a.no b { color: #b4632e; }
  .posture { border: 1px solid var(--accent-ink-tint-35); border-left: 3px solid var(--accent-ink); border-radius: var(--radius-sharp);
    background: var(--accent-ink-tint-06); padding: 13px 16px; max-width: 96ch; }
  .po-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-ink); font-weight: 600; margin-bottom: 6px; }
  .posture p { margin: 0; font-size: var(--fs-label); line-height: 1.6; color: rgba(28,22,17,0.78); }

  /* 1 · spine before/after */
  .spinemap { display: grid; grid-template-columns: 1fr auto 1.25fr; align-items: center; gap: 10px;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 16px 16px; }
  .sm-side { min-width: 0; }
  .sm-lab { display: block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); margin-bottom: 9px; }
  .sm-silos { display: flex; flex-wrap: wrap; gap: 6px; }
  .sm-silo { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 8px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.05);
    border: 1px dashed rgba(28,22,17,0.28); color: rgba(28,22,17,0.7); }
  .sm-x { display: block; margin-top: 9px; font-size: var(--fs-label-xs); color: var(--error); font-style: italic; }
  .sm-arrow { font-size: 22px; color: rgba(28,22,17,0.3); }
  .sm-conn { display: flex; flex-direction: column; gap: 7px; }
  .sm-srcs, .sm-outs { display: flex; flex-wrap: wrap; gap: 6px; }
  .sm-src { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 8px; border-radius: var(--radius-sharp); background: var(--accent-ink-tint-12); border: 1px solid var(--accent-ink-tint-35); color: var(--accent-ink); }
  .sm-spine { background: linear-gradient(90deg, var(--accent-ink), var(--accent-ink)); border-radius: var(--radius-sharp); padding: 7px 10px; text-align: center; }
  .sm-spine span { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.08em; color: #fff; font-weight: 600; }
  .sm-out { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 5px 8px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.05); border: 1px solid rgba(28,22,17,0.15); color: rgba(28,22,17,0.72); }
  .sm-out.hot { background: var(--success-bg); border-color: var(--success-border); color: var(--success); font-weight: 600; }

  /* 2 · timeline */
  .tl { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 4px 0 18px; padding-top: 10px; }
  .tl-line { position: absolute; top: 16px; left: 2%; right: 2%; height: 2px; background: rgba(28,22,17,0.15); }
  .tl-ev { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 14px 8px 0; }
  .tl-dot { position: absolute; top: 1px; left: 8px; width: 11px; height: 11px; border-radius: var(--radius-pill); background: var(--c); border: 2px solid var(--paper); }
  .tl-date { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: var(--c); }
  .tl-title { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-label); line-height: 1.2; color: var(--ink); }
  .tl-what { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.62); }
  .tl-src { position: absolute; top: 12px; right: 8px; font-size: var(--fs-label-xs); color: var(--c); text-decoration: none; }

  /* 3 · attendance cascade */
  .cascade { display: flex; align-items: stretch; gap: 4px; flex-wrap: wrap; }
  .csc { flex: 1 1 180px; border-radius: var(--radius-sharp); padding: 11px 12px; display: flex; flex-direction: column; gap: 5px; border: 1px solid rgba(28,22,17,0.12); }
  .csc.a { background: var(--accent-ink-tint-12); } .csc.b { background: rgba(180,99,46,0.08); }
  .csc.c { background: var(--error-bg); } .csc.d { background: var(--accent-ink-tint-12); }
  .csc-stage { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.55); }
  .csc-mult { font-family: var(--fs-serif); font-weight: 600; font-size: 26px; line-height: 1; color: var(--error); }
  .csc.b .csc-mult { color: #b4632e; }
  .csc-find { font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.78); }
  .csc-arr { align-self: center; color: rgba(28,22,17,0.3); font-size: var(--fs-body); }
  .similar { display: grid; grid-template-columns: 130px 1fr; gap: 14px; align-items: center; margin-top: 14px;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 12px 16px; }
  .ring { width: 120px; height: 120px; }
  .ring-track { fill: none; stroke: rgba(28,22,17,0.08); stroke-width: 1.5; }
  .ring-peer { fill: #2f6f97; opacity: 0.55; }
  .ring-self { fill: #b1455e; }
  .ring-txt { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: #fff; text-anchor: middle; font-weight: 600; }
  .similar-body h3 { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body-sm); margin: 0 0 5px; color: var(--ink); }
  .similar-body p { margin: 0; font-size: var(--fs-label); line-height: 1.55; color: rgba(28,22,17,0.74); }
  .similar-body b { color: var(--ink); }

  /* 4 · feedback loop */
  .loop { display: grid; grid-template-columns: 350px 1fr; gap: 18px; align-items: center;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 14px 16px; }
  .loop-svg { width: 100%; max-width: 350px; height: auto; }
  .loop-n { font-family: var(--font-mono); font-size: var(--fs-label); font-weight: 700; text-anchor: middle; }
  .loop-c1 { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.08em; fill: rgba(28,22,17,0.7); text-anchor: middle; }
  .loop-c2 { font-family: var(--font-body); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); text-anchor: middle; }
  .loop-legend { display: flex; flex-direction: column; gap: 9px; }
  .ll { display: grid; grid-template-columns: 26px 1fr; gap: 9px; align-items: start; }
  .ll-n { width: 24px; height: 24px; border-radius: var(--radius-pill); background: var(--c); color: #fff; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; display: grid; place-items: center; }
  .ll-lab { display: block; font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-nav); color: var(--ink); }
  .ll-det { display: block; font-size: var(--fs-label-xs); line-height: 1.45; color: rgba(28,22,17,0.68); margin-top: 1px; }

  /* 5 · matrix + cards */
  .matrix { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); padding: 6px 10px 10px; overflow-x: auto; }
  .mx-head, .mx-row { display: grid; grid-template-columns: 1.4fr 1fr 1.15fr 1.2fr 1fr; gap: 8px; align-items: center; min-width: 720px; }
  .mx-head { padding: 8px 6px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .mx-col { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }
  .mx-row { padding: 8px 6px; border-bottom: 1px solid rgba(28,22,17,0.06); }
  .mx-row.eng { background: var(--error-bg); border-radius: var(--radius-sharp); }
  .mx-country { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .mx-country b { font-size: var(--fs-label); color: var(--ink); } .mx-country small { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .mx-cell { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-label-xs); color: rgba(28,22,17,0.78); background: var(--cr); border: 1px solid var(--cc); border-radius: var(--radius-sharp); padding: 3px 7px; }
  .mx-cell i { width: 7px; height: 7px; border-radius: var(--radius-pill); background: var(--cc); flex-shrink: 0; }
  .mx-key { display: flex; flex-wrap: wrap; gap: 12px; padding: 9px 6px 2px; }
  .mx-kk { display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.55); }
  .mx-kk i { width: 8px; height: 8px; border-radius: var(--radius-pill); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr)); gap: 11px; margin-top: 14px; }
  .ccard { border: 1px solid rgba(28,22,17,0.12); border-radius: var(--radius-sharp); padding: 13px 14px; background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 5px; }
  .ccard.eng { background: var(--error-bg); border-color: var(--error-border); }
  .ccard header { display: flex; align-items: baseline; gap: 8px; }
  .cc-flag { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; letter-spacing: 0.04em; color: var(--accent-ink); background: var(--accent-ink-tint-12); border-radius: var(--radius-sharp); padding: 1px 5px; } .cc-name { font-family: var(--fs-serif); font-weight: 600; font-size: var(--fs-body); color: var(--ink); }
  .cc-sys { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); }
  .cc-mech { margin: 4px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.76); }
  .cc-res { margin: 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); } .cc-res b { color: var(--ink); }
  .cc-les { margin: 4px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.82); }
  .cc-tag { display: inline-block; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: var(--accent-ink); border-radius: var(--radius-sharp); padding: 1px 5px; margin-right: 6px; }
  .cc-src { margin-top: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }

  /* stats */
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); gap: 10px; }
  .stat { display: flex; flex-direction: column; gap: 4px; padding: 13px 15px; border-radius: var(--radius-sharp); background: rgba(255,255,255,0.42);
    border: 1px solid rgba(28,22,17,0.12); text-decoration: none; transition: border-color 0.12s, background 0.12s; }
  .stat:hover { border-color: var(--accent-ink-tint-35); background: rgba(255,255,255,0.6); }
  .stat-big { font-family: var(--fs-serif); font-weight: 600; font-size: 24px; color: var(--accent-ink); line-height: 1; }
  .stat-lab { font-size: var(--fs-label-xs); line-height: 1.4; color: rgba(28,22,17,0.68); }

  .takeaway { border-top: 1px solid rgba(28,22,17,0.12); padding-top: 16px; }
  .takeaway .pe-prose { max-width: 88ch; } .takeaway p { margin: 0 0 10px; } .takeaway b { color: var(--ink); }

  @media (max-width: 860px) {
    .spinemap { grid-template-columns: 1fr; } .sm-arrow { transform: rotate(90deg); justify-self: center; }
    .tl { grid-template-columns: repeat(2, 1fr); } .tl-line { display: none; }
    .loop { grid-template-columns: 1fr; } .loop-svg { max-width: 300px; margin: 0 auto; }
    .similar { grid-template-columns: 1fr; justify-items: center; text-align: center; }
  }
  @media (max-width: 560px) { .tl { grid-template-columns: 1fr; } }
</style>
