<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import {
    TIMELINE, INFRA, INFRA_COLS, STATUS_META, LOOP, KEY_STATS,
  } from '../lib/monitoring';
  import SpineVsIdentifier from '../components/SpineVsIdentifier.svelte';
  import EthicsGuardrails from '../components/EthicsGuardrails.svelte';

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
  <span class="pe-eyebrow">The feedback loop · monitoring policy impact</span>
  <h1 class="pe-h1">How would we actually know if a policy worked?</h1>

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
        move. In England’s real data estate that has historically been shaky — and a simulation is only ever as honest as the data that
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
        data it stores; it’s the speed and honesty of the correction it enables.
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
        : 'White Paper (CP 1508-I): data should “flow seamlessly, not be locked within individual systems”, giving schools “more immediate insight about the effectiveness of interventions”. That last clause is the thesis of this page.'}
    </p>
  </section>

  <!-- ===================== 2 · spine + join key ===================== -->
  <section class="block">
    <h2 class="pe-h2">2 · England’s answer — and the thing everyone conflates</h2>
    <p class="cap">
      {eli
        ? 'Two different things got announced close together, and people keep mixing them up. One is the wiring. The other is a shared number for each child. Here’s the difference — and the timeline that put them on the table.'
        : 'England’s response has two distinct moving parts with different legal bases, easily — and constantly — conflated. The timeline below is the public record; the cards underneath keep the two instruments strictly apart.'}
    </p>

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

    <p class="offaxis warn">
      {eli
        ? 'Reality check: the spine is a promise, not a built thing. As of mid-2026 there’s no design and no finish date — just the commitment and a £200k boss hired to deliver it.'
        : 'Honest status: the data spine is an announced commitment, not a live system — as of June 2026 there is no published architecture, build timeline or delivery date. Everything below is read against that fact.'}
    </p>
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
  </section>

  <!-- ===================== 4 · AI in the loop ===================== -->
  <section class="block">
    <h2 class="pe-h2">4 · From data to decision — AI in the feedback loop</h2>
    <p class="cap">
      {eli
        ? 'A feedback loop has two halves: spotting what’s happening, and acting on it fast enough to matter. AI is starting to help with both — but the loop only closes if you also check, honestly, whether things worked.'
        : 'A feedback loop has two halves — detecting what’s happening, and metabolising it fast enough to act. England’s emerging AI stack touches both, from grounding models in real curriculum data to theming consultation responses ~120× faster. The loop only closes with honest evaluation — and one official piece is conspicuously missing.'}
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
        ? 'One honest admission: the official government “digital twins” are for roads and energy, not schools. A research-backed policy simulator like this one is a genuine gap — which is partly why it exists (as a personal project, not an official tool).'
        : 'One honest gap: government “digital twins” (the National Digital Twin Programme) are infrastructure-focused — there is no national education-policy simulator. This Field Study fills that gap as a personal-capacity experiment, emphatically not an official DfE tool.'}
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

  <!-- ===================== 6 · ethics ===================== -->
  <section class="block">
    <h2 class="pe-h2">6 · The hard part — support, not surveillance</h2>
    <p class="cap">
      {eli
        ? 'The same tools that spot a struggling child early can also brand them unfairly. This isn’t hypothetical — here’s what went wrong elsewhere, and the guardrails that keep it honest.'
        : 'The honest core of this page: the same machinery that enables a good feedback loop enables real harm, and the evidence is not hypothetical. The defensible line is the same one the simulator draws — a model, or an algorithm, is a tool for asking better questions of humans, never a verdict delivered to a child.'}
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
  .lede b { color: var(--ink); } .lede a { color: #2f6f97; }
  .block { margin: 34px 0; }
  .cap { margin: 0 0 16px; font-size: 14.5px; line-height: 1.6; color: rgba(28,22,17,0.72); max-width: 90ch; }
  .cap b { color: var(--ink); }
  .offaxis { margin: 12px 0 0; padding: 9px 13px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.72);
    background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.1); }
  .offaxis b { color: var(--ink); }
  .offaxis.warn { background: rgba(177,69,94,0.07); border-color: rgba(177,69,94,0.22); color: #7a3340; }
  .offaxis.warn b { color: #6f2230; }

  /* 1 · spine before/after */
  .spinemap { display: grid; grid-template-columns: 1fr auto 1.25fr; align-items: center; gap: 10px;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 16px 16px; }
  .sm-side { min-width: 0; }
  .sm-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); margin-bottom: 9px; }
  .sm-silos { display: flex; flex-wrap: wrap; gap: 6px; }
  .sm-silo { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 5px 8px; border-radius: 6px; background: rgba(28,22,17,0.05);
    border: 1px dashed rgba(28,22,17,0.28); color: rgba(28,22,17,0.7); }
  .sm-x { display: block; margin-top: 9px; font-size: 11px; color: #b1455e; font-style: italic; }
  .sm-arrow { font-size: 22px; color: rgba(28,22,17,0.3); }
  .sm-conn { display: flex; flex-direction: column; gap: 7px; }
  .sm-srcs, .sm-outs { display: flex; flex-wrap: wrap; gap: 6px; }
  .sm-src { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 5px 8px; border-radius: 6px; background: rgba(47,111,151,0.1); border: 1px solid rgba(47,111,151,0.3); color: #2f6f97; }
  .sm-spine { background: linear-gradient(90deg, #2f6f97, #3f7d6e); border-radius: 7px; padding: 7px 10px; text-align: center; }
  .sm-spine span { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; color: #fff; font-weight: 600; }
  .sm-out { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; padding: 5px 8px; border-radius: 6px; background: rgba(28,22,17,0.05); border: 1px solid rgba(28,22,17,0.15); color: rgba(28,22,17,0.72); }
  .sm-out.hot { background: rgba(47,125,79,0.12); border-color: rgba(47,125,79,0.35); color: #2f7d4f; font-weight: 600; }

  /* 2 · timeline */
  .tl { position: relative; display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 4px 0 18px; padding-top: 10px; }
  .tl-line { position: absolute; top: 16px; left: 2%; right: 2%; height: 2px; background: rgba(28,22,17,0.15); }
  .tl-ev { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 14px 8px 0; }
  .tl-dot { position: absolute; top: 1px; left: 8px; width: 11px; height: 11px; border-radius: 50%; background: var(--c); border: 2px solid #f1ead6; box-shadow: 0 0 0 1px var(--c); }
  .tl-date { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; font-weight: 600; color: var(--c); }
  .tl-title { font-family: 'Fraunces', serif; font-weight: 600; font-size: 12.5px; line-height: 1.2; color: var(--ink); }
  .tl-what { font-size: 10.8px; line-height: 1.4; color: rgba(28,22,17,0.62); }
  .tl-src { position: absolute; top: 12px; right: 8px; font-size: 10px; color: var(--c); text-decoration: none; }

  /* 3 · attendance cascade */
  .cascade { display: flex; align-items: stretch; gap: 4px; flex-wrap: wrap; }
  .csc { flex: 1 1 180px; border-radius: 10px; padding: 11px 12px; display: flex; flex-direction: column; gap: 5px; border: 1px solid rgba(28,22,17,0.12); }
  .csc.a { background: rgba(63,125,110,0.07); } .csc.b { background: rgba(180,99,46,0.08); }
  .csc.c { background: rgba(177,69,94,0.09); } .csc.d { background: rgba(86,106,140,0.09); }
  .csc-stage { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.55); }
  .csc-mult { font-family: 'Fraunces', serif; font-weight: 600; font-size: 26px; line-height: 1; color: #b1455e; }
  .csc.b .csc-mult { color: #b4632e; }
  .csc-find { font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.78); }
  .csc-arr { align-self: center; color: rgba(28,22,17,0.3); font-size: 16px; }
  .similar { display: grid; grid-template-columns: 130px 1fr; gap: 14px; align-items: center; margin-top: 14px;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 12px 16px; }
  .ring { width: 120px; height: 120px; }
  .ring-track { fill: none; stroke: rgba(28,22,17,0.08); stroke-width: 1.5; }
  .ring-peer { fill: #2f6f97; opacity: 0.55; }
  .ring-self { fill: #b1455e; }
  .ring-txt { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: #fff; text-anchor: middle; font-weight: 600; }
  .similar-body h3 { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; margin: 0 0 5px; color: var(--ink); }
  .similar-body p { margin: 0; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); }
  .similar-body b { color: var(--ink); }

  /* 4 · feedback loop */
  .loop { display: grid; grid-template-columns: 350px 1fr; gap: 18px; align-items: center;
    background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 14px 16px; }
  .loop-svg { width: 100%; max-width: 350px; height: auto; }
  .loop-n { font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; text-anchor: middle; }
  .loop-c1 { font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; fill: rgba(28,22,17,0.7); text-anchor: middle; }
  .loop-c2 { font-family: 'DM Sans', sans-serif; font-size: 9.5px; fill: rgba(28,22,17,0.5); text-anchor: middle; }
  .loop-legend { display: flex; flex-direction: column; gap: 9px; }
  .ll { display: grid; grid-template-columns: 26px 1fr; gap: 9px; align-items: start; }
  .ll-n { width: 24px; height: 24px; border-radius: 50%; background: var(--c); color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; display: grid; place-items: center; }
  .ll-lab { display: block; font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: var(--ink); }
  .ll-det { display: block; font-size: 12px; line-height: 1.45; color: rgba(28,22,17,0.68); margin-top: 1px; }

  /* 5 · matrix + cards */
  .matrix { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 6px 10px 10px; overflow-x: auto; }
  .mx-head, .mx-row { display: grid; grid-template-columns: 1.4fr 1fr 1.15fr 1.2fr 1fr; gap: 8px; align-items: center; min-width: 720px; }
  .mx-head { padding: 8px 6px; border-bottom: 1px solid rgba(28,22,17,0.12); }
  .mx-col { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.5); }
  .mx-row { padding: 8px 6px; border-bottom: 1px solid rgba(28,22,17,0.06); }
  .mx-row.eng { background: rgba(177,69,94,0.06); border-radius: 7px; }
  .mx-country { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .mx-country b { font-size: 13px; color: var(--ink); } .mx-country small { font-size: 10px; color: rgba(28,22,17,0.5); }
  .mx-cell { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(28,22,17,0.78); background: var(--cr); border: 1px solid var(--cc); border-radius: 5px; padding: 3px 7px; }
  .mx-cell i { width: 7px; height: 7px; border-radius: 50%; background: var(--cc); flex-shrink: 0; }
  .mx-key { display: flex; flex-wrap: wrap; gap: 12px; padding: 9px 6px 2px; }
  .mx-kk { display: inline-flex; align-items: center; gap: 5px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: rgba(28,22,17,0.55); }
  .mx-kk i { width: 8px; height: 8px; border-radius: 50%; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr)); gap: 11px; margin-top: 14px; }
  .ccard { border: 1px solid rgba(28,22,17,0.12); border-radius: 11px; padding: 13px 14px; background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 5px; }
  .ccard.eng { background: rgba(177,69,94,0.05); border-color: rgba(177,69,94,0.28); }
  .ccard header { display: flex; align-items: baseline; gap: 8px; }
  .cc-flag { font-size: 18px; } .cc-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); }
  .cc-sys { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #2f6f97; }
  .cc-mech { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.76); }
  .cc-res { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.7); } .cc-res b { color: var(--ink); }
  .cc-les { margin: 4px 0 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.82); }
  .cc-tag { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: #566a8c; border-radius: 3px; padding: 1px 5px; margin-right: 6px; }
  .cc-src { margin-top: auto; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; align-self: flex-start; }

  /* stats */
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); gap: 10px; }
  .stat { display: flex; flex-direction: column; gap: 4px; padding: 13px 15px; border-radius: 11px; background: rgba(255,255,255,0.42);
    border: 1px solid rgba(28,22,17,0.12); text-decoration: none; transition: border-color 0.12s, background 0.12s; }
  .stat:hover { border-color: rgba(47,111,151,0.4); background: rgba(255,255,255,0.6); }
  .stat-big { font-family: 'Fraunces', serif; font-weight: 600; font-size: 24px; color: #2f6f97; line-height: 1; }
  .stat-lab { font-size: 11.5px; line-height: 1.4; color: rgba(28,22,17,0.68); }

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
