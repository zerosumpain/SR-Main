<script lang="ts">
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import type { PageData } from './$types';
  /**
   * One person's movement — /home/people/[subject]. The load decides who may
   * open it (the owner anyone's, a household viewer only their own) and sends
   * figures only: counts, distances, clock times and the names of places. No
   * map and no coordinates, by design (spec section 5).
   *
   * One chart per concern — walking pace by week, time out by day — with the
   * mode split as figures and the repeating trips as a table.
   */
  let { data }: { data: PageData } = $props();

  const stats = $derived(data.stats);

  // ── Formatting ───────────────────────────────────────────────────────────
  const km = (metres: number) => (metres >= 10_000 ? `${Math.round(metres / 1000)}` : `${Math.round(metres / 100) / 10}`);
  function dur(seconds: number): string {
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  /** m/s as km/h, the unit people actually know a walk in. */
  const kmh = (mps: number) => (Math.round(mps * 36) / 10).toFixed(1);
  const DAY_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const SHORT_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  /** A local YYYY-MM-DD as words. Formatted in UTC because the date is already local. */
  const dayLabel = (date: string) => DAY_FMT.format(new Date(`${date}T12:00:00Z`));
  const shortLabel = (date: string) => SHORT_FMT.format(new Date(`${date}T12:00:00Z`));

  const MODE_LABEL = { foot: 'On foot', car: 'By car', rail: 'By train', other: 'Other' } as const;
  const MODE_SUB = {
    foot: 'walking speed',
    car: 'vehicle speed, not a straight fast line',
    rail: 'fast and straight — or a motorway',
    other: 'running or cycling pace, or unclear',
  } as const;

  // ── Figures ──────────────────────────────────────────────────────────────
  const modeTiles = $derived<DeckTile[]>(
    stats
      ? (['foot', 'car', 'rail', 'other'] as const).map((b) => {
          const t = stats.byMode[b];
          return {
            key: b,
            label: MODE_LABEL[b],
            value: String(t.count),
            suffix: t.count === 1 ? ' journey' : ' journeys',
            sub: t.count ? `${km(t.metres)} km · ${dur(t.seconds)} · ${MODE_SUB[b]}` : MODE_SUB[b],
            tone: t.count ? 'steady' : 'quiet',
          };
        })
      : [],
  );

  const totalJourneys = $derived(stats ? Object.values(stats.byMode).reduce((n, t) => n + t.count, 0) : 0);
  const totalMetres = $derived(stats ? Object.values(stats.byMode).reduce((n, t) => n + t.metres, 0) : 0);
  const outDays = $derived(stats?.timeOut ?? []);
  const avgOut = $derived(
    outDays.length ? Math.round(outDays.reduce((n, d) => n + d.minutesOut, 0) / outDays.length) : null,
  );

  const summary = $derived(
    stats
      ? [
          { label: 'Journeys', value: String(totalJourneys), sub: `${data.days} days` },
          { label: 'Distance', value: `${km(totalMetres)} km`, sub: 'all modes' },
          {
            label: 'Walking pace',
            value: stats.walkingPace ? `${kmh(stats.walkingPace.medianMps)}` : '—',
            sub: stats.walkingPace ? 'km/h, median' : 'no qualifying walk',
          },
          { label: 'Out a day', value: avgOut == null ? '—' : dur(avgOut * 60), sub: 'average' },
        ]
      : [],
  );

  const paceTiles = $derived<DeckTile[]>(
    stats?.walkingPace
      ? [
          { key: 'median', label: 'Median', value: kmh(stats.walkingPace.medianMps), suffix: ' km/h', sub: 'half of walks were faster', lit: true },
          { key: 'p75', label: 'Brisk (75th percentile)', value: kmh(stats.walkingPace.p75Mps), suffix: ' km/h', sub: 'a quarter of walks were faster' },
          { key: 'n', label: 'Walks counted', value: String(stats.walkingPace.n), sub: '500 m or more, at walking speed' },
        ]
      : [],
  );

  // ── Pace chart: weekly median, one line ─────────────────────────────────
  const PW = 600;
  const PH = 150;
  const PL = 44; // room for the y labels
  const PB = 22; // room for the x labels
  const PT = 10;
  const weekly = $derived(stats?.walkingPace?.weekly ?? []);
  const paceRange = $derived.by(() => {
    const v = weekly.map((w) => w.medianMps * 3.6);
    if (!v.length) return { lo: 0, hi: 1 };
    const lo = Math.floor(Math.min(...v) - 0.3);
    const hi = Math.ceil(Math.max(...v) + 0.3);
    return { lo, hi: hi > lo ? hi : lo + 1 };
  });
  const paceX = (i: number) => (weekly.length <= 1 ? PL + (PW - PL) / 2 : PL + 8 + (i / (weekly.length - 1)) * (PW - PL - 16));
  const paceY = (mps: number) => PT + (1 - (mps * 3.6 - paceRange.lo) / (paceRange.hi - paceRange.lo)) * (PH - PT - PB);
  const pacePath = $derived(weekly.map((w, i) => `${i ? 'L' : 'M'}${paceX(i)},${paceY(w.medianMps)}`).join(' '));

  // ── Time-out chart: minutes per day, bars ───────────────────────────────
  const BAR_W = 14;
  const GAP = 4;
  const CH = 120;
  const outMax = $derived(Math.max(60, ...outDays.map((d) => d.minutesOut)));
  const outCeilHours = $derived(Math.ceil(outMax / 60));
  const lastWeek = $derived([...outDays].slice(-7).reverse());
</script>

<HomeFrame
  path="/home/people/{data.subject}"
  kicker="Home · People"
  title={[data.displayName, 'on the move']}
  standfirst="Journeys, walking pace and the trips that repeat over the last {data.days} days, read off this person’s own trail. How someone travelled is inferred from speed, never known."
  {summary}
  footer={['strangeramblings.com/home/people', 'One person’s trail · seen by them and the owner only']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The trail did not load" message={data.loadError} /></div></section>
  {/if}

  {#if stats}
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / How they got about"
          title={['Journeys,', 'by mode']}
          strap="Inferred from speed. GPS cannot tell running from cycling, and a straight motorway looks like a railway, so each count is a best guess from how fast the phone moved."
        />
        <StatDeck tiles={modeTiles} min={200} />
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="B / Walking pace"
          title={['How fast,', 'on foot']}
          strap="Each walk’s distance over its time, for walks of 500 m or more between 3.2 and 9 km/h. Slower is a stroll with stops; faster is a jog or a bike."
        />
        {#if stats.walkingPace}
          <StatDeck tiles={paceTiles} min={200} />
          <div class="chart">
            <p class="field-label">Median pace by week (weeks start Monday)</p>
            <svg class="pace" viewBox="0 0 {PW} {PH}" role="img" aria-label="Median walking pace by week, in km/h">
              {#each [paceRange.lo, paceRange.hi] as v (v)}
                <line x1={PL} x2={PW} y1={paceY(v / 3.6)} y2={paceY(v / 3.6)} class="grid" />
                <text x={PL - 8} y={paceY(v / 3.6) + 4} text-anchor="end" class="tick">{v}</text>
              {/each}
              {#if weekly.length > 1}<path d={pacePath} class="line" />{/if}
              {#each weekly as w, i (w.weekStart)}
                <g>
                  <title>Week of {shortLabel(w.weekStart)}: {kmh(w.medianMps)} km/h over {w.n} walk{w.n === 1 ? '' : 's'}</title>
                  <circle cx={paceX(i)} cy={paceY(w.medianMps)} r="12" class="hit" />
                  <circle cx={paceX(i)} cy={paceY(w.medianMps)} r="4.5" class="dot" />
                  <text x={paceX(i)} y={PH - 4} text-anchor="middle" class="tick">{shortLabel(w.weekStart)}</text>
                </g>
              {/each}
            </svg>
          </div>
        {:else}
          <p class="lede">No walk in the window was long enough, and at walking speed, to give a pace.</p>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="C / Common trips"
          title={['The journeys', 'that repeat']}
          strap="From one named place to another, seen at least three times. A journey that starts or ends somewhere unnamed is not counted — name the place and it will be."
        />
        {#if stats.commonTrips.length}
          <div class="tbl-wrap">
            <table class="tbl compact">
              <thead>
                <tr>
                  <th>From</th>
                  <th>To</th>
                  <th class="right">Times</th>
                  <th class="right">Usually leaves</th>
                  <th class="right">Takes</th>
                  <th>Mostly</th>
                </tr>
              </thead>
              <tbody>
                {#each stats.commonTrips as t (`${t.fromLabel}→${t.toLabel}`)}
                  <tr>
                    <td class="cell-lead">{t.fromLabel}</td>
                    <td>{t.toLabel}</td>
                    <td class="right num">{t.count}</td>
                    <td class="right num">{t.usualDeparture}</td>
                    <td class="right num">{dur(t.medianSeconds)}</td>
                    <td>{MODE_LABEL[t.mode].toLowerCase()}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="lede">No trip between two named places has come up three times yet.</p>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="D / Time out"
          title={['Away from', 'home, by day']}
          strap="From leaving home to getting back, counted only when a journey began in between — a phone that went quiet at home overnight is not time out. Times are the house’s clock."
        />
        {#if outDays.length}
          <div class="chart">
            <p class="field-label">Hours out per day, last {outDays.length} days</p>
            <svg
              class="out"
              viewBox="0 0 {outDays.length * (BAR_W + GAP) + 30} {CH + 20}"
              role="img"
              aria-label="Hours away from home per day"
            >
              <line x1="30" x2={outDays.length * (BAR_W + GAP) + 30} y1="4" y2="4" class="grid" />
              <text x="24" y="8" text-anchor="end" class="tick">{outCeilHours}h</text>
              <line x1="30" x2={outDays.length * (BAR_W + GAP) + 30} y1={CH} y2={CH} class="base" />
              <text x="24" y={CH + 4} text-anchor="end" class="tick">0</text>
              {#each outDays as d, i (d.date)}
                {@const bh = d.minutesOut ? Math.max(2, (d.minutesOut / (outCeilHours * 60)) * (CH - 4)) : 0}
                <g>
                  <title>{dayLabel(d.date)}: {dur(d.minutesOut * 60)} out{d.firstOut ? `, first out ${d.firstOut}` : ''}{d.lastIn ? `, last in ${d.lastIn}` : ''}</title>
                  <rect x={30 + i * (BAR_W + GAP)} y="0" width={BAR_W + GAP} height={CH} class="hit" />
                  {#if bh}
                    <rect x={30 + i * (BAR_W + GAP) + GAP / 2} y={CH - bh} width={BAR_W} height={bh} rx="2" class="bar" />
                  {/if}
                  {#if (outDays.length - 1 - i) % 7 === 0}
                    <text x={30 + i * (BAR_W + GAP) + (BAR_W + GAP) / 2} y={CH + 16} text-anchor="middle" class="tick">{shortLabel(d.date)}</text>
                  {/if}
                </g>
              {/each}
            </svg>
          </div>

          <div class="tbl-wrap week">
            <table class="tbl compact">
              <thead>
                <tr>
                  <th>Day</th>
                  <th class="right">Out</th>
                  <th class="right">First out</th>
                  <th class="right">Last in</th>
                </tr>
              </thead>
              <tbody>
                {#each lastWeek as d (d.date)}
                  <tr>
                    <td class="cell-lead nowrap">{dayLabel(d.date)}</td>
                    <td class="right num">{d.minutesOut ? dur(d.minutesOut * 60) : '—'}</td>
                    <td class="right num">{d.firstOut ?? '—'}</td>
                    <td class="right num">{d.lastIn ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="lede">No home is named on the trail, so there is no “out” to measure yet.</p>
        {/if}
      </div>
    </section>
  {/if}
</HomeFrame>

<style>
  /* Page-specific only — `.band`, `.inner`, `.tbl`, `.lede`, `.field-label`
     come from `.ds-vocab` (HomeFrame's DsVocab). Marks follow /home/voice's
     hour chart: petrol ink, accent on hover, recessive axes. */
  .chart {
    margin-top: clamp(20px, 2.4vw, 32px);
  }
  .week {
    margin-top: 22px;
    max-width: 520px;
  }
  svg {
    display: block;
    width: 100%;
    max-width: 720px;
    height: auto;
  }
  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .base {
    stroke: var(--line-strong);
    stroke-width: 1;
  }
  .hit {
    fill: transparent;
  }
  .bar {
    fill: var(--accent-ink);
  }
  .out g:hover .bar {
    fill: var(--accent);
  }
  .line {
    fill: none;
    stroke: var(--accent-ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .dot {
    fill: var(--accent-ink);
    stroke: var(--bg);
    stroke-width: 2;
  }
  .pace g:hover .dot {
    fill: var(--accent);
  }
  .tick {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-muted);
  }
</style>
