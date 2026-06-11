<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import StoryMasthead from '../components/StoryMasthead.svelte';
  import StorySection from '../components/StorySection.svelte';
  import MeasurementPopover from '../components/MeasurementPopover.svelte';
  import { MEASUREMENT } from '../lib/measurement';
  import { STORIES } from '../lib/stories';
  import {
    COUNTRIES, OECD_AVG, TIER_META, ANCHOR, SPEND_PLOT, SPEND_THRESHOLD, ENGLAND_PISA,
    BY_EQUITY, BY_TREND, type Country, type Tier,
  } from '../lib/comparators';
  import {
    BORROWINGS, VERDICT_META, BORROW_CAUTION, RESPONSES, ANTIPATTERN, RESPONSE_CHECKLIST, READOUTS, READOUT_GAP,
  } from '../lib/globalIntel';

  const eli = $derived(app.narrative === 'eli5');
  const tc = (t: Tier) => TIER_META[t].colour;
  const TIER_FLOW: Tier[] = ['anchor', 'leader', 'peer', 'other'];
  const inTier = (t: Tier) => COUNTRIES.filter((c) => c.tier === t);
  const fmtTrend = (v: number | null) => (v == null ? 'n/a' : v > 0 ? `+${v}` : `${v}`);
  const fmtK = (v: number) => `$${Math.round(v / 1000)}k`;

  // ---- chart A: cumulative spend (age 6–15) vs maths (scatter) ----
  const SX0 = 64, SX1 = 736, SY0 = 30, SY1 = 404;
  const sxMin = 8000, sxMax = 172000, syMin = 460, syMax = 580;
  const sx = (v: number) => SX0 + ((v - sxMin) / (sxMax - sxMin)) * (SX1 - SX0);
  const sy = (v: number) => SY1 - ((v - syMin) / (syMax - syMin)) * (SY1 - SY0);
  const xGrid = [50000, 100000, 150000];
  const yGrid = [480, 500, 520, 540, 560];
  // per-country label placement to avoid overlap in the dense mid cluster (side + vertical nudge)
  const LABEL: Record<string, { side: 'l' | 'r'; dy: number }> = {
    VN: { side: 'r', dy: 0 }, PL: { side: 'l', dy: 0 }, EE: { side: 'r', dy: -2 }, IE: { side: 'r', dy: 0 },
    JP: { side: 'r', dy: 0 }, IT: { side: 'l', dy: 7 }, FR: { side: 'r', dy: -11 }, DE: { side: 'r', dy: 12 },
    UK: { side: 'r', dy: 0 }, SG: { side: 'l', dy: 0 },
  };
  const thrX = sx(SPEND_THRESHOLD);

  // ---- chart B / C: ranked bars ----
  const BX0 = 172, BX1 = 712, rowH = 33, rowTop = 50;
  const rowY = (i: number) => rowTop + i * rowH + rowH / 2;
  const chartH = (n: number) => rowTop + n * rowH + 28;
  const egMax = 122;
  const ebw = (v: number) => (v / egMax) * (BX1 - BX0);
  const tMin = -30, tMax = 12;
  const tx = (v: number) => BX0 + ((v - tMin) / (tMax - tMin)) * (BX1 - BX0);
  const zeroX = tx(0);
</script>

<svelte:head><title>Global comparators — Education Policy Modelling</title></svelte:head>

<div class="pe-route wide">
  <StoryMasthead story={STORIES.global} />

  <div class="pe-prose lede-prose">
    {#if eli}
      <p>
        The engine rests on three debated claims: <b>that spending on its own moves results only weakly</b>, <b>that how little a child’s
        background predicts their results matters more than how much a system spends</b>, and <b>that the levers that work concern teaching
        and attendance, not cash</b>. This page tests them against the international evidence — ten countries, measured the same
        way by the OECD’s 2022 PISA tests, with the figures fact-checked against the original OECD reports.
      </p>
      <p>
        The countries split three ways: <b>three of the highest-scoring systems in the world</b> (to show how high attainment is reached),
        <b>three big rich countries like Britain</b> (the closest comparison), and <b>three that each test a common assumption</b> — plus
        England itself. The data points one way: the highest-spending systems are <i>not</i> the highest-scoring, and countries
        spending the same amount show very different disadvantage gaps. (A snapshot like this can show patterns, but cannot on its own establish cause.)
      </p>
    {:else}
      <p>
        England’s model rests on three contested claims: that <b>per-pupil spending is close to a non-lever</b>, that <b>equity — how
        little a child’s background predicts their results — matters more than spending</b>, and that the working levers are <b>teacher
        capacity and attendance, not money</b>. This page pressure-tests all three against the international evidence: ten systems on a
        single comparable yardstick, <b>OECD PISA 2022</b> (maths, reading, science), with the spending measure OECD itself uses and
        equity from each country’s official PISA country note. Every figure here was independently re-verified against the OECD primary
        sources (see <a href="/projects/policy-engine/method#comparators">Method → International comparators</a> for the audit).
      </p>
      <p>
        The cast is deliberately constructed: <b>three education leaders</b> (Singapore, Japan, Estonia) to show how the top is reached;
        <b>three economic peers</b> (France, Germany, Italy) as like-for-like G7-type comparators; and <b>three wildcards</b> (Ireland,
        Poland, Vietnam) each chosen to puncture an assumption — with the <b>UK</b> as the anchor. The clearest pattern across these ten:
        <b>spending barely predicts maths once a basic threshold is met, and equity varies enormously at the same price</b> — though
        cross-country correlations are suggestive, not proof of cause.
      </p>
    {/if}
  </div>

  <!-- the cast -->
  <section class="cast">
    {#each TIER_FLOW as t}
      <div class="cast-tier">
        <span class="cast-dot" style="background:{tc(t)}"></span>
        <div class="cast-body">
          <span class="cast-lab">{eli ? TIER_META[t].eli5 : TIER_META[t].label}</span>
          <span class="cast-names">{inTier(t).map((c) => `${c.flag} ${c.name}`).join('  ·  ')}</span>
          <span class="cast-blurb">{eli ? TIER_META[t].eli5Blurb : TIER_META[t].blurb}</span>
        </div>
      </div>
    {/each}
  </section>

  <p class="eng-note">
    {#if eli}
      <b>One caveat:</b> PISA scores the whole UK together. <b>England</b> on its own did a little better — maths {ENGLAND_PISA.maths},
      reading {ENGLAND_PISA.reading}, science {ENGLAND_PISA.science} — but fewer English schools took part than PISA asks for, which may
      nudge England’s figures up. The charts use the comparable UK number.
    {:else}
      <b>England vs UK:</b> PISA reports the UK as a whole; <b>England</b> specifically scored higher — maths <b>{ENGLAND_PISA.maths}</b>,
      reading <b>{ENGLAND_PISA.reading}</b>, science <b>{ENGLAND_PISA.science}</b> (vs UK {ANCHOR.maths}/{ANCHOR.reading}/{ANCHOR.science},
      pulled down by the other three nations). England’s school response rate fell below PISA standards, so higher-performing pupils may be
      over-represented and its means somewhat flattered. The charts plot the comparable UK figure.
    {/if}
  </p>

  <!-- ============ CHART A: cumulative spend vs maths ============ -->
  <section class="block">
    <StorySection title="1 · Does money buy results?">
    {#snippet prose()}
    <p class="cap">
      {#if eli}
        Each dot is a country. Left-to-right is <b>the total spent on a child’s whole schooling</b> (ages 6–15); up-and-down is its
        <b>maths score</b>. If money bought results, the dots would climb to the right. They don’t. Past the shaded line — about
        <b>$75,000 per child</b>, which the OECD says is the point where extra money stops predicting results — the cloud is flat:
        <b>Germany and the UK spend most and sit below Estonia and Japan</b>. Vietnam reaches nearly England’s score on a ninth of the money.
      {:else}
        <b>Cumulative expenditure per student over ages 6–15 (USD PPP)</b> — the exact measure OECD plots against PISA — versus PISA 2022
        maths. The shaded zone is above the OECD’s <b>~$75,000 threshold</b>, beyond which it finds “almost no relationship between extra
        investment and performance”. <b>Eight of these ten sit inside it</b>, and there the cloud is flat-to-negative: Germany ($121k) and
        the UK ($124k) trail cheaper Estonia and Japan; only Vietnam (far left, ~$14k) is below the threshold. The international face of the
        engine’s “money is a conditional lever” assumption.
      {/if}
    </p>
    {/snippet}
    {#snippet data()}
    <div class="chart">
      <svg viewBox="0 0 760 460" role="img" aria-label="Scatter plot of cumulative spend per student age 6 to 15 against PISA maths score">
        <!-- above-threshold zone -->
        <rect x={thrX} y={SY0} width={SX1 - thrX} height={SY1 - SY0} class="zone" />
        <text x={thrX + 8} y={SY0 + 13} class="zone-lab">above $75k — extra spend no longer predicts performance (OECD)</text>
        <line x1={thrX} x2={thrX} y1={SY0} y2={SY1} class="thresh" />
        <text x={thrX - 5} y={SY1 - 6} class="thresh-lab" text-anchor="end">$75k</text>
        <!-- gridlines -->
        {#each yGrid as g}
          <line x1={SX0} x2={SX1} y1={sy(g)} y2={sy(g)} class="grid" />
          <text x={SX0 - 8} y={sy(g) + 3} class="ax-y">{g}</text>
        {/each}
        {#each xGrid as g}
          <text x={sx(g)} y={SY1 + 18} class="ax-x">{fmtK(g)}</text>
        {/each}
        <!-- OECD average maths -->
        <line x1={SX0} x2={SX1} y1={sy(OECD_AVG.maths)} y2={sy(OECD_AVG.maths)} class="oecd" />
        <text x={SX0 + 6} y={sy(OECD_AVG.maths) - 6} class="oecd-lab" text-anchor="start">OECD average maths →</text>
        <!-- axis titles -->
        <text x={(SX0 + SX1) / 2} y={SY1 + 40} class="ax-title">→ total spent per pupil, age 6–15 (USD PPP)</text>
        <text x={16} y={(SY0 + SY1) / 2} class="ax-title" transform="rotate(-90 16 {(SY0 + SY1) / 2})">→ higher maths score</text>
        <!-- points -->
        {#each SPEND_PLOT as c (c.code)}
          {@const px = sx(c.spendCumulative ?? 0)}
          {@const py = sy(c.maths)}
          {@const lab = LABEL[c.code] ?? { side: 'r', dy: 0 }}
          {@const left = lab.side === 'l'}
          {@const isUK = c.tier === 'anchor'}
          {@const est = c.spendCumulativeEst}
          <circle cx={px} cy={py} r={isUK ? 8 : 6} fill={est ? 'var(--paper, #f1ead6)' : tc(c.tier)}
                  stroke={est ? tc(c.tier) : isUK ? '#1c1611' : 'rgba(255,255,255,0.7)'} stroke-width={est ? 2 : isUK ? 2 : 1}
                  stroke-dasharray={est ? '3 2' : ''} />
          <text x={px + (left ? -12 : 12)} y={py + 4 + lab.dy} class="pt-lab" class:uk={isUK} text-anchor={left ? 'end' : 'start'}>{c.flag} {c.code}{est ? '*' : ''}{isUK ? ' · us' : ''}</text>
        {/each}
      </svg>
    </div>
    <p class="offaxis">
      {eli
        ? '*Estonia is the one country the OECD didn’t publish a total-spend figure for, so its dot (~$90k) is our best estimate from its yearly spending. Singapore and Vietnam aren’t in the rich-countries club, so their yearly budgets are counted differently — but this whole-schooling total is comparable for them.'
        : '*OECD did not publish Estonia’s cumulative figure (the only blank in Table I.B3.2.2); its ~$90k dot is reconstructed from its annual ISCED 1+2 per-student spend. Singapore & Vietnam have no comparable annual %-GDP/per-student EaG figure (non-OECD), but the cumulative-6→15 measure plotted here IS comparable for them.'}
    </p>
    <div class="mrow"><MeasurementPopover m={MEASUREMENT.pisaComparators} /></div>
    {/snippet}
    </StorySection>
  </section>

  <!-- ============ CHART B: equity ============ -->
  <section class="block">
    <StorySection title="2 · The same money, very different disadvantage gaps">
    {#snippet prose()}
    <p class="cap">
      {#if eli}
        This is a comparative strength for England. The bar is the <b>gap in maths between the richest and poorest quarter of pupils</b> —
        shorter is a smaller gap. <b>England (86) has a smaller gap than the average</b>, and a much smaller gap than France or Germany,
        which spend as much or more. Ireland, next door, has the smallest gap of all. A high-income or high-scoring system does not
        necessarily have a small gap — Singapore scores highest but has one of the widest gaps.
      {:else}
        The advantaged−disadvantaged maths gap (top vs bottom socio-economic quartile) — the clearest cross-country equity measure.
        A shorter bar is a smaller gap. <b>England (86) sits below the OECD average (93)</b> and well below its economic peers
        <b>France (113)</b> and <b>Germany (111)</b> at equal-or-higher spend. Note the dissociation from attainment: <b>Singapore</b>,
        highest-scoring in the world, carries one of the widest gaps — a high floor with a very high ceiling.
      {/if}
    </p>
    {/snippet}
    {#snippet data()}
    <div class="chart">
      <svg viewBox="0 0 760 {chartH(BY_EQUITY.length)}" role="img" aria-label="Ranked bar chart of the rich–poor maths gap by country">
        <text x={12} y={26} class="hint-l">← smaller gap</text>
        <text x={BX1} y={26} class="hint-r" text-anchor="end">wider gap →</text>
        <line x1={BX0 + ebw(OECD_AVG.escsGap)} x2={BX0 + ebw(OECD_AVG.escsGap)} y1={36} y2={chartH(BY_EQUITY.length) - 18} class="oecd" />
        <text x={BX0 + ebw(OECD_AVG.escsGap)} y={chartH(BY_EQUITY.length) - 4} class="oecd-lab" text-anchor="middle">OECD avg {OECD_AVG.escsGap}</text>
        {#each BY_EQUITY as c, i (c.code)}
          {@const y = rowY(i)}
          {@const isUK = c.tier === 'anchor'}
          <text x={BX0 - 10} y={y + 4} class="row-name" class:uk={isUK} text-anchor="end">{c.flag} {c.name}</text>
          <rect x={BX0} y={y - 11} width={ebw(c.escsGap)} height={22} rx="3" fill={tc(c.tier)} opacity={isUK ? 1 : 0.82} stroke={isUK ? '#1c1611' : 'none'} stroke-width="1.5" />
          <text x={BX0 + ebw(c.escsGap) + 8} y={y + 4} class="row-val" class:uk={isUK}>{c.escsGap}{isUK ? ' ← us' : ''}</text>
        {/each}
      </svg>
    </div>
    {/snippet}
    </StorySection>
  </section>

  <!-- ============ CHART C: trend ============ -->
  <section class="block">
    <StorySection title="3 · Direction of travel since 2018">
    {#snippet prose()}
    <p class="cap">
      {#if eli}
        How each country’s maths score moved between the last two PISA rounds (2018 → 2022), across the pandemic. Almost everyone fell.
        <b>England’s drop (−13) is smaller than the average</b>. Japan and Singapore <b>held steady</b> in maths (the hatched bars) — that’s
        a notable result when most fell, but it is not a statistically solid <i>rise</i>. Germany and Poland fell sharply. Strong results
        are not permanent; they require sustained effort to maintain.
      {:else}
        Change in PISA maths, 2018→2022 — the pandemic shock. The OECD average fell a record 15 points. <b>England (−13) beat that
        average</b>. The hatched bars (<b>Japan +9</b>, <b>Singapore +6</b>) are <b>NOT statistically significant</b> — OECD’s own wording
        is “about the same as in 2018 in mathematics” (their real gains were in reading/science), so they held the line rather than truly
        rose. Previously high-performing <b>Germany (−25)</b> and <b>Poland (−27)</b> fell hardest — gains are reversible. (Vietnam’s trend is
        not comparable across cycles and is omitted.)
      {/if}
    </p>
    {/snippet}
    {#snippet data()}
    <div class="chart">
      <svg viewBox="0 0 760 {chartH(BY_TREND.length)}" role="img" aria-label="Diverging bar chart of the change in PISA maths 2018 to 2022">
        <defs>
          <pattern id="hatch" width="5" height="5" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width="5" height="5" fill="rgba(255,255,255,0.55)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="rgba(28,22,17,0.5)" stroke-width="2.2" />
          </pattern>
        </defs>
        <text x={12} y={26} class="hint-l">← fell</text>
        <text x={BX1} y={26} class="hint-r" text-anchor="end">rose →</text>
        <line x1={zeroX} x2={zeroX} y1={36} y2={chartH(BY_TREND.length) - 18} class="zero" />
        <line x1={tx(OECD_AVG.mathsTrend)} x2={tx(OECD_AVG.mathsTrend)} y1={36} y2={chartH(BY_TREND.length) - 18} class="oecd" />
        <text x={tx(OECD_AVG.mathsTrend)} y={chartH(BY_TREND.length) - 4} class="oecd-lab" text-anchor="middle">OECD avg {OECD_AVG.mathsTrend}</text>
        {#each BY_TREND as c, i (c.code)}
          {@const y = rowY(i)}
          {@const isUK = c.tier === 'anchor'}
          {@const v = c.mathsTrend}
          {@const ns = c.trendSig === false}
          <text x={BX0 - 10} y={y + 4} class="row-name" class:uk={isUK} text-anchor="end">{c.flag} {c.name}</text>
          {#if v == null}
            <text x={zeroX + 8} y={y + 4} class="row-na">not comparable</text>
          {:else}
            {@const x0 = v >= 0 ? zeroX : tx(v)}
            <rect x={x0} y={y - 11} width={Math.abs(tx(v) - zeroX)} height={22} rx="3" fill={tc(c.tier)} opacity={isUK ? 1 : 0.82} stroke={isUK ? '#1c1611' : 'none'} stroke-width="1.5" />
            {#if ns}<rect x={x0} y={y - 11} width={Math.abs(tx(v) - zeroX)} height={22} rx="3" fill="url(#hatch)" />{/if}
            <text x={v >= 0 ? tx(v) + 8 : tx(v) - 8} y={y + 4} class="row-val" class:uk={isUK} text-anchor={v >= 0 ? 'start' : 'end'}>{fmtTrend(v)}{ns ? ' n.s.' : ''}{isUK ? ' ← us' : ''}</text>
          {/if}
        {/each}
      </svg>
    </div>
    <p class="offaxis">{eli ? 'Hatched bars = “about the same as 2018” — not a statistically reliable change, per the OECD.' : 'Hatched bars are statistically NOT significant (OECD: “about the same as in 2018 in mathematics”) — shown at their measured value but flagged, not counted as real gains.'}</p>
    {/snippet}
    </StorySection>
  </section>

  <!-- ============ the ten, in their own words ============ -->
  <section class="block">
    <h2 class="pe-h2">The ten, in their own words</h2>
    <p class="cap">{eli ? 'What each country is here to teach us.' : 'Each country earns its place by making a specific point. The badges are PISA 2022 (M / R / S), annual spend per student, the rich–poor gap, and the 2018→2022 maths trend.'}</p>
    {#each TIER_FLOW as t}
      <div class="tier-group">
        <h3 class="tier-h" style="--tcol:{tc(t)}">{eli ? TIER_META[t].eli5 : TIER_META[t].label}</h3>
        <div class="cards">
          {#each inTier(t) as c (c.code)}
            <article class="ccard" class:anchor={c.tier === 'anchor'} style="--tcol:{tc(c.tier)}">
              <header class="cc-head">
                <span class="cc-flag">{c.flag}</span>
                <span class="cc-name">{c.name}</span>
                <span class="cc-maths">{c.maths}<small>maths</small></span>
              </header>
              <div class="cc-badges">
                <span class="bdg" title="PISA 2022: maths / reading / science">M {c.maths} · R {c.reading} · S {c.science}</span>
                <span class="bdg" title="Annual spend per student, USD PPP (OECD); n/a for non-OECD">{c.spendStudent ? `$${(c.spendStudent / 1000).toFixed(1)}k/yr` : 'spend n/a'}</span>
                <span class="bdg" title="Rich–poor maths gap (lower = smaller gap)">gap {c.escsGap}</span>
                {#if c.mathsTrend == null}
                  <span class="bdg trend-na" title="Maths change 2018→2022 not comparable">trend n/a</span>
                {:else if c.trendSig === false}
                  <span class="bdg trend-flat" title="Maths change 2018→2022: not statistically significant">≈ flat since ’18</span>
                {:else}
                  <span class="bdg trend-{c.mathsTrend >= 0 ? 'up' : 'down'}" title="Maths change 2018→2022">{fmtTrend(c.mathsTrend)} since ’18</span>
                {/if}
              </div>
              <p class="cc-lesson">{eli ? c.eli5 : c.lesson}</p>
            </article>
          {/each}
        </div>
      </div>
    {/each}
    <p class="src-note">
      Sources: OECD <a href="https://www.oecd.org/en/publications/pisa-2022-results-volume-i_53f23881-en.html" target="_blank" rel="noopener">PISA 2022</a>
      (scores, equity, cumulative spend &amp; 2018→22 trend) and <a href="https://www.oecd.org/en/about/programmes/education-at-a-glance.html" target="_blank" rel="noopener">Education at a Glance 2024</a>
      (annual spend); GDP/capita World Bank. Independently re-verified against the OECD country notes and Table I.B3.2.2; see
      <a href="/projects/policy-engine/method#comparators">Method → International comparators</a> for the full audit and caveats.
    </p>
  </section>

  <!-- ============ 4 · the borrowing ledger ============ -->
  <section class="block">
    <h2 class="pe-h2">4 · The borrowing ledger — what England imported</h2>
    <p class="cap">
      {eli
        ? 'Comparing is the first step; copying carries more risk. This is what England took from the higher-scoring systems — each with a badge for what the evaluations found.'
        : 'Benchmarking’s applied end is policy borrowing. The ledger of England’s imports, each with its evaluated verdict — and the pattern to note: the flagship import scaled for a decade before its first RCT.'}
    </p>
    <div class="bw-cards">
      {#each BORROWINGS as b (b.name)}
        <article class="bw" style="--vc:{VERDICT_META[b.verdict].colour}">
          <header class="bw-head">
            <div class="bw-names"><span class="bw-name">{b.name}</span><span class="bw-from">from {b.from} · {b.when}</span></div>
            <span class="bw-verdict" style="background:{VERDICT_META[b.verdict].colour}">{eli ? VERDICT_META[b.verdict].eli5 : VERDICT_META[b.verdict].label}</span>
          </header>
          <p class="bw-what">{b.what}</p>
          <p class="bw-outcome"><b>{eli ? 'What happened:' : 'Outcome:'}</b> {b.outcome}</p>
          <p class="bw-lesson"><span class="bw-tag">The lesson</span>{b.lesson}</p>
          <a class="bw-src" href={b.url} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
    <p class="caution">{eli ? BORROW_CAUTION.eli5 : BORROW_CAUTION.research}</p>
  </section>

  <!-- ============ 5 · the response function ============ -->
  <section class="block">
    <h2 class="pe-h2">5 · How systems respond to a result</h2>
    <p class="cap">
      {eli
        ? 'A poor result tests the system that receives it. Four countries, four different responses — and England’s own record, included as the cautionary case.'
        : 'The response function is a strong differentiator: what a system does with a result can matter more than the result. Four named patterns — then England’s documented anti-pattern, and the checklist it implies.'}
    </p>
    <div class="rs-cards">
      {#each RESPONSES as r (r.country)}
        <article class="rs" style="--rc:{r.colour}">
          <header class="rs-head"><span class="rs-flag">{r.flag}</span><span class="rs-name">{r.country}</span><span class="rs-pattern">{r.pattern}</span></header>
          <p class="rs-story">{r.story}</p>
          <p class="rs-lesson"><span class="rs-tag">The lesson</span>{r.lesson}</p>
          <a class="rs-src" href={r.url} target="_blank" rel="noopener">source ↗</a>
        </article>
      {/each}
    </div>
    <div class="anti">
      <span class="anti-lab">⚠ {ANTIPATTERN.title}</span>
      <p>{eli ? ANTIPATTERN.eli5 : ANTIPATTERN.research} <a href={ANTIPATTERN.url} target="_blank" rel="noopener">UKSA letter ↗</a></p>
    </div>
    <h3 class="sub-h">{eli ? 'What an effective response function needs' : 'The response-function checklist — England scored'}</h3>
    <div class="check">
      {#each RESPONSE_CHECKLIST as c (c.item)}
        <div class="ck"><span class="ck-item">✓ {c.item}</span><span class="ck-status">{c.status}</span></div>
      {/each}
    </div>
  </section>

  <!-- ============ 6 · the next readouts ============ -->
  <section class="block">
    <h2 class="pe-h2">6 · The next readout</h2>
    <p class="cap">
      {eli
        ? 'What’s coming, when — and in each case, what England should actually be watching for (hint: it’s usually not the ranking).'
        : 'The cycle calendar, with the England angle per study. The wider point: after 2022’s response-rate shortfall, sample integrity is the metric that matters most.'}
    </p>
    <div class="ro-cards">
      {#each READOUTS as r (r.study)}
        <article class="ro" style="--oc:{r.colour}">
          <header class="ro-head"><span class="ro-study">{r.study}</span><span class="ro-when">{r.when}</span></header>
          <p class="ro-what">{r.what}</p>
          <p class="ro-angle"><span class="ro-tag">{eli ? 'Watch for' : 'The England angle'}</span>{r.englandAngle}</p>
        </article>
      {/each}
    </div>
    <div class="gap-box">
      <span class="gb-lab">{eli ? 'The missing instrument' : 'The structural gap'}</span>
      <p>{eli ? READOUT_GAP.eli5 : READOUT_GAP.research}</p>
      <a class="gb-link" href="/projects/policy-engine/monitor">The same theme, system-wide → the data spine</a>
    </div>
  </section>

  <!-- ============ tie back to the engine ============ -->
  <section class="block takeaway">
    <h2 class="pe-h2">{eli ? 'So what does this mean for the sliders?' : 'How this compares with the model’s assumptions'}</h2>
    <div class="pe-prose">
      {#if eli}
        <p>The rest of the world lines up with what the engine assumes — though a snapshot like this can’t prove cause:</p>
      {:else}
        <p>This cross-country snapshot is consistent with the three assumptions the engine is built on (cross-country correlations are suggestive, not causal):</p>
      {/if}
      <ul class="take-list">
        <li>
          <b>{eli ? 'Money alone looks weak — but it’s debated.' : 'Spending looks like a conditional lever — but the evidence is contested.'}</b>
          {eli
            ? 'Eight of these ten spend past the point where, across countries, more money stops predicting results — and there Germany and the UK trail cheaper Estonia and Japan. In the model the funding sliders mostly help when they buy teachers — but this is a debated point, and studies of funding reforms within a single country do find positive effects.'
            : 'Eight of ten sit above the OECD’s $75k cumulative threshold, where this cross-country spend→maths link is flat-to-negative — consistent with how the engine treats funding (as enabling teacher capacity rather than acting directly). But a cross-country snapshot can’t prove causation, and quasi-experimental studies of funding reforms do find positive effects, so this stays an assumption to test, not a settled rule.'}
          <a href="/projects/policy-engine/outcomes">See it in Attainment ↗</a>
        </li>
        <li>
          <b>{eli ? 'The disadvantage gap separates systems more than spending does.' : 'Equity is a stronger differentiator than spend.'}</b>
          {eli
            ? 'Countries on the same budget show very different gaps. England’s gap is comparatively small; in the model, the disadvantage-targeted sliders act on that.'
            : 'At equal spend, the disadvantage gap ranges from Ireland’s 74 to France’s 113. England’s gap is comparatively small; in the model, the gap-closing levers (attendance, early years, pupil-premium targeting) carry most of the leverage.'}
          <a href="/projects/policy-engine">Open the levers ↗</a>
        </li>
        <li>
          <b>{eli ? 'Good results can slip.' : 'Gains are reversible.'}</b>
          {eli
            ? 'Poland and Germany fell sharply. Progress is not permanent — which is why the model runs to 2040, well beyond a single electoral cycle.'
            : 'Poland and Germany shed 25–27 points in one cycle. The engine’s long horizon (to 2040) and uncertainty bands exist precisely because trajectories are fragile, not guaranteed.'}
          <a href="/projects/policy-engine/method#equations">How the model handles this ↗</a>
        </li>
      </ul>
    </div>
  </section>

  <a class="pe-next" href="/projects/policy-engine/monitor">Next → How we’d know if it worked</a>
</div>

<style>
  .lede-prose { max-width: 78ch; }
  .lede-prose a { color: #2f6f97; }

  /* the cast */
  .cast { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 10px; margin: 18px 0 8px; }
  .cast-tier { display: flex; gap: 10px; align-items: flex-start; padding: 11px 13px; border-radius: 10px; background: rgba(255,255,255,0.34); border: 1px solid rgba(28,22,17,0.1); }
  .cast-dot { flex-shrink: 0; width: 12px; height: 12px; border-radius: 50%; margin-top: 4px; }
  .cast-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .cast-lab { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14px; color: var(--ink); }
  .cast-names { font-size: 12.5px; color: rgba(28,22,17,0.82); }
  .cast-blurb { font-size: 11.5px; line-height: 1.4; color: rgba(28,22,17,0.58); margin-top: 2px; }

  .eng-note { margin: 6px 0 0; padding: 9px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.74);
    background: rgba(58,95,168,0.07); border: 1px solid rgba(58,95,168,0.22); }
  .eng-note b { color: var(--ink); }

  .block { margin: 30px 0; }
  .mrow { margin: 10px 0 0; }
  .cap { margin: 0 0 14px; font-size: 14px; line-height: 1.58; color: rgba(28,22,17,0.7); max-width: 88ch; }
  .cap b { color: var(--ink); }
  .offaxis { margin: 10px 0 0; padding: 9px 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.7);
    background: rgba(28,22,17,0.04); border: 1px solid rgba(28,22,17,0.1); }
  .offaxis b { color: var(--ink); }

  .chart { background: rgba(255,255,255,0.4); border: 1px solid rgba(28,22,17,0.1); border-radius: 12px; padding: 12px 14px; }
  .chart svg { display: block; width: 100%; height: auto; }

  /* svg primitives */
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .oecd { stroke: rgba(28,22,17,0.45); stroke-width: 1.3; stroke-dasharray: 4 3; }
  .zero { stroke: rgba(28,22,17,0.5); stroke-width: 1.4; }
  .zone { fill: rgba(176,99,46,0.06); }
  .zone-lab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(176,99,46,0.85); text-anchor: start; letter-spacing: 0.02em; }
  .thresh { stroke: #b4632e; stroke-width: 1.4; stroke-dasharray: 5 3; opacity: 0.7; }
  .thresh-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; fill: #b4632e; font-weight: 600; }
  .oecd-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; fill: rgba(28,22,17,0.55); }
  .ax-x, .ax-y { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.5); }
  .ax-x { text-anchor: middle; }
  .ax-y { text-anchor: end; }
  .ax-title { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.04em; fill: rgba(28,22,17,0.5); text-anchor: middle; text-transform: uppercase; }
  .pt-lab { font-family: 'JetBrains Mono', monospace; font-size: 12px; fill: rgba(28,22,17,0.82); }
  .pt-lab.uk { font-weight: 700; fill: #9a3b2e; }
  .hint-l, .hint-r { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; fill: rgba(28,22,17,0.45); }
  .row-name { font-family: 'DM Sans', sans-serif; font-size: 12.5px; fill: rgba(28,22,17,0.82); }
  .row-name.uk { font-weight: 700; fill: #9a3b2e; }
  .row-val { font-family: 'JetBrains Mono', monospace; font-size: 12px; fill: rgba(28,22,17,0.7); }
  .row-val.uk { font-weight: 700; fill: #9a3b2e; }
  .row-na { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; fill: rgba(28,22,17,0.4); font-style: italic; }

  /* country cards */
  .tier-group { margin: 16px 0; }
  .tier-h { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink);
    margin: 0 0 9px; padding-left: 10px; border-left: 3px solid var(--tcol); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr)); gap: 11px; }
  .ccard { border: 1px solid rgba(28,22,17,0.12); border-top: 3px solid var(--tcol); border-radius: 10px; padding: 12px 13px; background: rgba(255,255,255,0.4); }
  .ccard.anchor { background: rgba(154,59,46,0.06); border-color: rgba(154,59,46,0.3); }
  .cc-head { display: flex; align-items: baseline; gap: 8px; }
  .cc-flag { font-size: 18px; }
  .cc-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; color: var(--ink); flex: 1; }
  .cc-maths { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 17px; color: var(--tcol); }
  .cc-maths small { display: block; font-weight: 400; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.45); text-align: right; }
  .cc-badges { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 9px; }
  .bdg { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.68); background: rgba(28,22,17,0.05); border: 1px solid rgba(28,22,17,0.1); border-radius: 4px; padding: 2px 6px; }
  .bdg.trend-up { color: #2f7d4f; background: rgba(47,125,79,0.1); border-color: rgba(47,125,79,0.25); }
  .bdg.trend-down { color: #b1455e; background: rgba(177,69,94,0.1); border-color: rgba(177,69,94,0.22); }
  .bdg.trend-flat, .bdg.trend-na { color: rgba(28,22,17,0.55); background: rgba(28,22,17,0.05); border-style: dashed; }
  .cc-lesson { margin: 0; font-size: 13px; line-height: 1.5; color: rgba(28,22,17,0.74); }

  .src-note { margin: 14px 0 0; font-size: 11px; line-height: 1.5; color: rgba(28,22,17,0.5); }
  .sub-h { font-family: 'Fraunces', serif; font-weight: 600; font-size: 16px; margin: 20px 0 10px; color: var(--ink, #1c1611); }

  /* 4 · borrowing ledger */
  .bw-cards, .rs-cards, .ro-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(330px, 100%), 1fr)); gap: 12px; }
  .bw, .rs, .ro { border: 1px solid rgba(28,22,17,0.13); border-radius: 10px; padding: 12px 14px;
    background: rgba(255,255,255,0.42); display: flex; flex-direction: column; gap: 7px; }
  .bw { border-top: 3px solid var(--vc); }
  .bw-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .bw-names { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .bw-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 14.5px; color: var(--ink, #1c1611); }
  .bw-from { font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.5); }
  .bw-verdict { flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.04em;
    color: #fff; padding: 3px 7px; border-radius: 4px; white-space: nowrap; }
  .bw-what, .bw-outcome { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .bw-outcome b { color: var(--ink, #1c1611); }
  .bw-lesson { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink, #1c1611); }
  .bw-tag, .rs-tag, .ro-tag { display: block; font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
  .bw-tag { color: var(--vc); }
  .bw-src, .rs-src { margin-top: auto; align-self: flex-start; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .caution { margin: 14px 0 0; padding: 11px 14px; border-radius: 9px; max-width: 96ch; font-size: 12.5px; line-height: 1.55;
    color: rgba(28,22,17,0.76); border: 1px dashed rgba(122,90,166,0.45); background: rgba(122,90,166,0.05); }

  /* 5 · responses */
  .rs { border-top: 3px solid var(--rc); }
  .rs-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
  .rs-flag { font-size: 17px; }
  .rs-name { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--ink, #1c1611); flex: 1; }
  .rs-pattern { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--rc); }
  .rs-story { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .rs-lesson { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink, #1c1611); }
  .rs-tag { color: var(--rc); }
  .anti { margin: 14px 0 0; border: 1px solid rgba(177,69,94,0.4); border-left: 3px solid #b1455e; border-radius: 10px;
    background: rgba(177,69,94,0.05); padding: 12px 15px; max-width: 96ch; }
  .anti-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: #8a2d3a; font-weight: 600; margin-bottom: 6px; }
  .anti p { margin: 0; font-size: 12.5px; line-height: 1.6; color: rgba(28,22,17,0.78); }
  .anti a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .check { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(290px, 100%), 1fr)); gap: 9px; }
  .ck { display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border: 1px solid rgba(28,22,17,0.12); border-radius: 8px; background: rgba(255,255,255,0.4); }
  .ck-item { font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 600; color: #2f7d4f; }
  .ck-status { font-size: 11px; line-height: 1.45; color: rgba(28,22,17,0.66); }

  /* 6 · readouts */
  .ro { border-top: 3px solid var(--oc); }
  .ro-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .ro-study { font-family: 'Fraunces', serif; font-weight: 600; font-size: 15px; color: var(--ink, #1c1611); }
  .ro-when { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; color: var(--oc); }
  .ro-what { margin: 0; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.74); }
  .ro-angle { margin: 0; font-size: 12px; line-height: 1.5; color: var(--ink, #1c1611); }
  .ro-tag { color: var(--oc); }
  .gap-box { margin: 14px 0 0; border: 1px solid rgba(74,124,124,0.35); border-left: 3px solid #4a7c7c; border-radius: 10px;
    background: rgba(74,124,124,0.06); padding: 13px 16px; max-width: 96ch; }
  .gb-lab { display: block; font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: #3a5f5f; font-weight: 600; margin-bottom: 6px; }
  .gap-box p { margin: 0 0 8px; font-size: 13px; line-height: 1.6; color: rgba(28,22,17,0.78); }
  .gb-link { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .src-note a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; }

  .takeaway { border-top: 1px solid rgba(28,22,17,0.12); padding-top: 14px; }
  .take-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .take-list li { font-size: 14.5px; line-height: 1.55; color: rgba(28,22,17,0.74); padding-left: 14px; border-left: 2px solid rgba(28,22,17,0.18); }
  .take-list b { color: var(--ink); }
  .take-list a { color: #2f6f97; text-decoration: none; border-bottom: 1px dashed currentColor; margin-left: 4px; white-space: nowrap; }

  @media (max-width: 760px) { .pt-lab, .row-name { font-size: 11px; } .zone-lab { font-size: 7.5px; } }
</style>
