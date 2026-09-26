<script lang="ts">
  import CommuteMap from '$lib/components/home/CommuteMap.svelte';
  import YourDay from '$lib/components/home/YourDay.svelte';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import SectionHead from '$lib/components/jkai/daydream/hub/SectionHead.svelte';
  import StatDeck from '$lib/components/jkai/daydream/hub/StatDeck.svelte';
  import type { DeckTile } from '$lib/components/jkai/daydream/hub/types';
  import type { PageData } from './$types';
  /**
   * One person's movement — /home/people/[subject]. The load decides who may
   * open it (the owner anyone's, a household viewer only their own) and sends
   * figures: counts, distances, clock times and the names of places. The one
   * exception is Commuting (spec D3, 2026-09-26): the newest drives and train
   * rides carry a thinned route, drawn on a small map under the row selected.
   *
   * Where the time went comes first — each named place's share of the
   * window, then the journeys between places — because that is the question
   * the page is opened with. Then time out by day, then how they travelled.
   * One chart per concern, each with its table.
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
    rail: 'faster and straighter than any road',
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
            sub: t.count ? `${km(t.metres)} km · ${dur(t.seconds)}` : MODE_SUB[b],
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
          { label: 'Out a day', value: avgOut == null ? '—' : dur(avgOut * 60), sub: 'average' },
        ]
      : [],
  );

  const paceTiles = $derived<DeckTile[]>(
    stats?.walkingPace
      ? [
          { key: 'median', label: 'Median', value: kmh(stats.walkingPace.medianMps), suffix: ' km/h', sub: 'half of walks were faster', lit: true },
          { key: 'p75', label: 'Brisk', value: kmh(stats.walkingPace.p75Mps), suffix: ' km/h', sub: '75th percentile: a quarter of walks were faster' },
          { key: 'n', label: 'Walks', value: String(stats.walkingPace.n), sub: '500 m or more, at walking speed' },
        ]
      : [],
  );

  // ── Pace chart: weekly median, one line ─────────────────────────────────
  /** Rendered width of each plot. Once known, the viewBox is exactly that wide,
   *  so a unit is a pixel: text is 12px and bars keep their shape at any width
   *  instead of a 600-unit drawing being blown up to fill a desktop frame.
   *  Before it is known (server render) the fixed widths stand in. */
  let paceW = $state(0);
  let outW = $state(0);
  const PW = 600;
  /** Shorter on a phone: the plot is a third as wide. */
  const PH = $derived(paceW > 0 && paceW < 520 ? 110 : 150);
  const PL = 44; // room for the y labels
  const PT = 10;
  const TICK_PX = 12;
  const tickUnits = (viewW: number, shownW: number) => (shownW > 0 ? (TICK_PX * viewW) / shownW : TICK_PX);
  const PWv = $derived(paceW > 0 ? paceW : PW);
  const paceTick = $derived(tickUnits(PWv, paceW));
  const PB = $derived(paceTick + 10); // room for the x labels
  const weekly = $derived(stats?.walkingPace?.weekly ?? []);
  const paceRange = $derived.by(() => {
    const v = weekly.map((w) => w.medianMps * 3.6);
    if (!v.length) return { lo: 0, hi: 1 };
    const lo = Math.floor(Math.min(...v) - 0.3);
    const hi = Math.ceil(Math.max(...v) + 0.3);
    return { lo, hi: hi > lo ? hi : lo + 1 };
  });
  const paceX = (i: number) => (weekly.length <= 1 ? PL + (PWv - PL) / 2 : PL + 8 + (i / (weekly.length - 1)) * (PWv - PL - 16));
  const paceY = (mps: number) => PT + (1 - (mps * 3.6 - paceRange.lo) / (paceRange.hi - paceRange.lo)) * (PH - PT - PB);
  const pacePath = $derived(weekly.map((w, i) => `${i ? 'L' : 'M'}${paceX(i)},${paceY(w.medianMps)}`).join(' '));

  // ── Time-out chart: minutes per day, bars ───────────────────────────────
  const BAR_W = 14;
  const GAP = 4;
  const CH = $derived(outW > 0 && outW < 520 ? 80 : 120);
  const OW = $derived(outW > 0 ? outW : outDays.length * (BAR_W + GAP) + 30);
  /** Each day's slot, and the bar inside it: at most 22px wide. */
  const slot = $derived(outDays.length ? (OW - 30) / outDays.length : BAR_W + GAP);
  /** A date label is ~50px of mono and the last is pulled left to fit, so a
   *  label every week where a week is 80px or wider, else every fortnight.
   *  Counted back from today, which is always labelled. */
  const outLabelEvery = $derived(slot * 7 < 80 ? 14 : 7);
  const paceLabelEvery = $derived(weekly.length > 1 && (PWv - PL - 16) / (weekly.length - 1) < 80 ? 2 : 1);
  const barW = $derived(Math.max(2, Math.min(slot - GAP, 22)));
  const outTick = $derived(tickUnits(OW, outW));
  const outMax = $derived(Math.max(60, ...outDays.map((d) => d.minutesOut)));
  const outCeilHours = $derived(Math.ceil(outMax / 60));

  // ── Where the time went ─────────────────────────────────────────────────
  const TOP_PLACES = 10;
  const pt = $derived(stats?.placeTime ?? null);
  /** Top ten named places, then everything else as "elsewhere", then time on
   *  the move, then what the trail did not see — so the shares add up. */
  const timeRows = $derived.by(() => {
    if (!pt || !pt.windowMinutes) return [];
    const top = pt.places.slice(0, TOP_PLACES);
    const rest = pt.places.slice(TOP_PLACES);
    const share = (m: number) => m / pt.windowMinutes;
    const rows: Array<{ key: string; label: string; minutes: number; share: number; visits: number | null; arrives: string | null; leaves: string | null; kind: 'place' | 'other' }> =
      top.map((r) => ({ key: `p:${r.label}`, label: r.label, minutes: r.minutes, share: r.share, visits: r.visits, arrives: r.usualArrival, leaves: r.usualDeparture, kind: 'place' }));
    const elsewhere = pt.unnamed.minutes + rest.reduce((n, r) => n + r.minutes, 0);
    const elsewhereVisits = pt.unnamed.visits + rest.reduce((n, r) => n + r.visits, 0);
    if (elsewhere > 0) rows.push({ key: 'elsewhere', label: 'Elsewhere / unnamed', minutes: elsewhere, share: share(elsewhere), visits: elsewhereVisits, arrives: null, leaves: null, kind: 'other' });
    if (pt.transitMinutes > 0) rows.push({ key: 'moving', label: 'On the move', minutes: pt.transitMinutes, share: share(pt.transitMinutes), visits: null, arrives: null, leaves: null, kind: 'other' });
    return rows;
  });
  const unseenMinutes = $derived(pt ? Math.max(0, pt.windowMinutes - timeRows.reduce((n, r) => n + r.minutes, 0)) : 0);
  const pct = (share: number) => {
    const v = share * 100;
    return v > 0 && v < 1 ? '<1%' : `${Math.round(v)}%`;
  };
  /** Long stretches in days and hours; a whole month at home is not "731h". */
  function span(mins: number): string {
    if (mins < 48 * 60) return dur(mins * 60);
    const d = Math.floor(mins / 1440);
    const h = Math.round((mins % 1440) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  const daysNewest = $derived([...outDays].reverse());

  // ── Commuting ───────────────────────────────────────────────────────────
  /** Rows shown before "Show all": keeps the page short on a phone. */
  const COMMUTE_SHOWN = 5;
  const commutes = $derived(data.commuting ?? []);
  let showAllCommutes = $state(false);
  let selectedCommute = $state<string | null>(null);
  const visibleCommutes = $derived(showAllCommutes ? commutes : commutes.slice(0, COMMUTE_SHOWN));
  const COMMUTE_MODE = { car: 'By car', rail: 'By train' } as const;
  const WHEN_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const CLOCK_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const when = (iso: string) => `${WHEN_FMT.format(new Date(iso))} · ${CLOCK_FMT.format(new Date(iso))}`;
  const endName = (label: string | null) => label ?? 'unnamed';
  function toggleCommute(id: string) {
    selectedCommute = selectedCommute === id ? null : id;
  }
</script>

<HomeFrame
  path="/home/people/{data.subject}"
  kicker="Home · People"
  title={[data.displayName, 'on the move']}
  standfirst="Where the last {data.days} days went, read off this person’s own trail."
  {summary}
  footer={['strangeramblings.com/home/people', 'One person’s trail · seen by them and the owner only']}
>
  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The trail did not load" message={data.loadError} /></div></section>
  {/if}

  {#if data.yourDay}
    <!-- Only on the viewer's own page; nothing is fetched until it is opened. -->
    <section class="band" data-section="your-day">
      <div class="inner">
        <SectionHead
          kicker="Yours / Your day"
          title={['A day,', 'minute by minute']}
          strap="From your iPhone: where you went, and your heart rate, sleep and workouts laid under it."
        />
        <YourDay />
      </div>
    </section>
  {/if}

  {#if stats}
    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="A / Where the time went"
          title={['Time,', 'place by place']}
          strap="Each named place’s share of {data.days} days, on the house’s clock. Time the phone was quiet (overnight, say) is unaccounted, not home."
        />
        {#if timeRows.length}
          <div class="tbl-wrap">
            <table class="tbl compact time">
              <thead>
                <tr>
                  <th scope="col">Place</th>
                  <th scope="col" class="right">Time</th>
                  <th scope="col" class="share-col">Share</th>
                  <th scope="col" class="right">Visits</th>
                  <th scope="col" class="right">Arrives</th>
                  <th scope="col" class="right">Leaves</th>
                </tr>
              </thead>
              <tbody>
                {#each timeRows as r (r.key)}
                  <tr class:other={r.kind === 'other'}>
                    <td class="cell-lead">{r.label}</td>
                    <td class="right num">{span(r.minutes)}</td>
                    <td class="share-col">
                      <span class="share">
                        <span class="share-track" aria-hidden="true"><span class="share-bar" style="width: {Math.min(100, r.share * 100)}%"></span></span>
                        <span class="share-pct num">{pct(r.share)}</span>
                      </span>
                    </td>
                    <td class="right num">{r.visits ?? '—'}</td>
                    <td class="right num">{r.arrives ?? '—'}</td>
                    <td class="right num">{r.leaves ?? '—'}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          {#if unseenMinutes > 0}
            <p class="note">The other {span(unseenMinutes)} ({pct(unseenMinutes / (pt?.windowMinutes || 1))}) the phone was quiet or between places too briefly to count.</p>
          {/if}
        {:else}
          <p class="lede">No stay long enough to count in the window yet.</p>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="B / Between places"
          title={['The journeys', 'that repeat']}
          strap="Named place to named place, three times or more, and the time in transit."
        />
        {#if stats.commonTrips.length}
          <div class="tbl-wrap">
            <table class="tbl compact">
              <thead>
                <tr>
                  <th scope="col">From</th>
                  <th scope="col">To</th>
                  <th scope="col" class="right">Times</th>
                  <th scope="col" class="right">Leaves</th>
                  <th scope="col" class="right">Median</th>
                  <th scope="col" class="right">Total</th>
                  <th scope="col">Mostly</th>
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
                    <td class="right num">{dur(t.totalSeconds)}</td>
                    <td>{MODE_LABEL[t.mode].toLowerCase()}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="lede">No trip between two named places has come up three times yet.</p>
        {/if}
        {#if stats.roundTrips || (totalJourneys && pt)}
        <p class="note">
          {#if stats.roundTrips}
            Plus {stats.roundTrips.count} round trip{stats.roundTrips.count === 1 ? '' : 's'} out and back (median {dur(stats.roundTrips.medianSeconds)}).
          {/if}
          {#if totalJourneys && pt}
            {span(pt?.transitMinutes ?? 0)} in transit in all.
          {/if}
        </p>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="C / Commuting"
          title={['Drives', 'and trains']}
          strap="Newest first; select one for its route. Read from speed, so a slow train can pass for a car."
        />
        {#if commutes.length}
          <ul class="commutes">
            {#each visibleCommutes as c (c.id)}
              {@const open = selectedCommute === c.id}
              <li class:open>
                <button
                  type="button"
                  class="commute"
                  aria-expanded={open}
                  aria-controls="route-{c.id}"
                  onclick={() => toggleCommute(c.id)}
                >
                  <span class="c-when num">{when(c.startedAt)}</span>
                  <span class="c-mode">{COMMUTE_MODE[c.mode]}</span>
                  <span class="c-route">
                    <span class:dim={!c.fromLabel}>{endName(c.fromLabel)}</span><span class="arrow" aria-hidden="true">→</span><span class="vh"> to </span><span class:dim={!c.toLabel}>{endName(c.toLabel)}</span>
                  </span>
                  <span class="c-figs num">
                    {km(c.distanceKm * 1000)} km · {dur(c.minutes * 60)}{#if c.meanSpeedKmh != null}&nbsp;· {Math.round(c.meanSpeedKmh)} km/h{/if}
                  </span>
                </button>
                {#if open}
                  <div class="c-map" id="route-{c.id}">
                    <CommuteMap
                      route={c.route}
                      label="{COMMUTE_MODE[c.mode].toLowerCase()} from {endName(c.fromLabel)} to {endName(c.toLabel)}, {when(c.startedAt)}"
                    />
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
          {#if commutes.length > COMMUTE_SHOWN}
            <button type="button" class="more" onclick={() => (showAllCommutes = !showAllCommutes)}>
              {showAllCommutes ? `Show the newest ${COMMUTE_SHOWN}` : `Show all ${commutes.length}`}
            </button>
          {/if}
        {:else}
          <p class="lede">No drive or train journey in the last {data.days} days.</p>
        {/if}
      </div>
    </section>

    <section class="band sunken">
      <div class="inner">
        <SectionHead
          kicker="D / Time out"
          title={['Away from', 'home, by day']}
          strap="Leaving home to getting back. A quiet phone at home is not time out."
        />
        {#if outDays.length}
          <div class="chart" style="--tick: {outTick}px">
            <p class="field-label">Hours out per day, last {outDays.length} days</p>
            <div bind:clientWidth={outW}>
            <svg
              class="out"
              viewBox="0 {-outTick * 1.2} {OW} {CH + outTick * 2.3 + 8}"
              role="img"
              aria-label="Hours away from home per day. Every day follows as a table."
            >
              <line x1="30" x2={OW} y1="4" y2="4" class="grid" />
              <text x="0" y="0" class="tick">{outCeilHours}h</text>
              <line x1="30" x2={OW} y1={CH} y2={CH} class="base" />
              <text x="0" y={CH - 4} class="tick">0</text>
              {#each outDays as d, i (d.date)}
                {@const bh = d.minutesOut ? Math.max(2, (d.minutesOut / (outCeilHours * 60)) * (CH - 4)) : 0}
                <g>
                  <title>{dayLabel(d.date)}: {dur(d.minutesOut * 60)} out{d.firstOut ? `, first out ${d.firstOut}` : ''}{d.lastIn ? `, last in ${d.lastIn}` : ''}</title>
                  <rect x={30 + i * slot} y="0" width={slot} height={CH} class="hit" />
                  {#if bh}
                    <rect x={30 + i * slot + (slot - barW) / 2} y={CH - bh} width={barW} height={bh} rx="2" class="bar" />
                  {/if}
                  {#if (outDays.length - 1 - i) % outLabelEvery === 0}
                    <text
                      x={i === outDays.length - 1 ? 30 + (i + 1) * slot : 30 + i * slot + slot / 2}
                      y={CH + outTick + 4}
                      text-anchor={i === outDays.length - 1 ? 'end' : 'middle'}
                      class="tick">{shortLabel(d.date)}</text
                    >
                  {/if}
                </g>
              {/each}
            </svg>
            </div>
          </div>

          <details class="days">
            <summary>Every day as a table</summary>
            <div class="tbl-wrap">
              <table class="tbl compact">
                <caption class="vh">Time away from home, every day, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col" class="right">Out</th>
                    <th scope="col" class="right">First out</th>
                    <th scope="col" class="right">Last in</th>
                  </tr>
                </thead>
                <tbody>
                  {#each daysNewest as d (d.date)}
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
          </details>
        {:else}
          <p class="lede">No home is named on the trail, so there is no “out” to measure yet.</p>
        {/if}
      </div>
    </section>

    <section class="band">
      <div class="inner">
        <SectionHead
          kicker="E / How they moved"
          title={['Journeys,', 'and pace']}
          strap="Inferred from speed, so a best guess. Pace counts walks of 500 m or more at 3.2–9 km/h."
        />
        <div class="deck modes wide"><StatDeck tiles={modeTiles} min={120} /></div>
        <!-- On a phone: the same four figures as a list, and pace as one line. -->
        <ul class="mode-list narrow">
          {#each modeTiles as t (t.key)}
            <li>
              <span class="ml-label">{t.label}</span>
              <span class="ml-value num">{t.value}</span>
              <span class="ml-sub">{t.sub}</span>
            </li>
          {/each}
        </ul>
        {#if stats.walkingPace}
          <div class="deck paces wide"><StatDeck tiles={paceTiles} min={90} /></div>
          <p class="pace-line narrow">
            Pace <strong>{kmh(stats.walkingPace.medianMps)} km/h</strong> · brisk {kmh(stats.walkingPace.p75Mps)} ·
            {stats.walkingPace.n} walk{stats.walkingPace.n === 1 ? '' : 's'}
          </p>
          <div class="chart" style="--tick: {paceTick}px">
            <p class="field-label">Median pace by week, from Monday</p>
            <div bind:clientWidth={paceW}>
            <svg class="pace" viewBox="0 0 {PWv} {PH}" role="img" aria-label="Median walking pace by week, in km/h. The same figures follow as a table.">
              {#each [paceRange.lo, paceRange.hi] as v (v)}
                <line x1={PL} x2={PWv} y1={paceY(v / 3.6)} y2={paceY(v / 3.6)} class="grid" />
                <text x={PL - 8} y={paceY(v / 3.6) + paceTick / 3} text-anchor="end" class="tick">{v}</text>
              {/each}
              {#if weekly.length > 1}<path d={pacePath} class="line" />{/if}
              {#each weekly as w, i (w.weekStart)}
                <g>
                  <title>Week of {shortLabel(w.weekStart)}: {kmh(w.medianMps)} km/h over {w.n} walk{w.n === 1 ? '' : 's'}</title>
                  <circle cx={paceX(i)} cy={paceY(w.medianMps)} r="12" class="hit" />
                  <circle cx={paceX(i)} cy={paceY(w.medianMps)} r="4.5" class="dot" />
                  {#if (weekly.length - 1 - i) % paceLabelEvery === 0}
                  <text
                    x={i === weekly.length - 1 && weekly.length > 1 ? PWv : paceX(i)}
                    y={PH - 4}
                    text-anchor={i === weekly.length - 1 && weekly.length > 1 ? 'end' : 'middle'}
                    class="tick">{shortLabel(w.weekStart)}</text
                  >
                  {/if}
                </g>
              {/each}
            </svg>
            </div>
            <table class="vh">
              <caption>Median walking pace by week</caption>
              <thead><tr><th scope="col">Week starting</th><th scope="col">Median pace (km/h)</th><th scope="col">Walks</th></tr></thead>
              <tbody>
                {#each weekly as w (w.weekStart)}
                  <tr><th scope="row">{shortLabel(w.weekStart)}</th><td>{kmh(w.medianMps)}</td><td>{w.n}</td></tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="lede">No walk in the window was long enough, and at walking speed, to give a pace.</p>
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
    position: relative;
    margin-top: clamp(20px, 2.4vw, 32px);
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
  }
  .note {
    margin: 14px 0 0;
  }
  /* Time per place: the share as a bar on a hairline track, its figure beside
     it in text, so the bar is never the only carrier. */
  .share-col {
    width: 34%;
    min-width: 90px;
  }
  .share {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .share-track {
    flex: 1 1 auto;
    height: 8px;
    background: var(--line-hair);
    border-radius: 2px;
    overflow: hidden;
  }
  .share-bar {
    display: block;
    height: 100%;
    background: var(--accent-ink);
    border-radius: 0 2px 2px 0;
  }
  tr.other .share-bar {
    background: var(--text-muted);
  }
  tr.other .cell-lead {
    color: var(--text-secondary);
  }
  .share-pct {
    flex: 0 0 4ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .days {
    margin-top: 18px;
  }
  /* Names stay on one line; a table wider than a phone scrolls inside its
     own frame (.tbl-wrap), never the page. */
  .tbl-wrap :global(td.cell-lead),
  .tbl-wrap td {
    white-space: nowrap;
  }
  .days summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-secondary);
    padding: 6px 0;
  }
  .days summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .days .tbl-wrap {
    margin-top: 8px;
  }
  /* How they moved: the four modes in a row (2×2 on a phone), the three pace
     figures always in one row. StatDeck's auto-fit would stack them singly. */
  .deck.paces {
    margin-top: 12px;
  }
  .modes :global(.dk) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .paces :global(.dk) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .narrow {
    display: none;
  }
  .mode-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .mode-list li {
    display: grid;
    grid-template-columns: 6.5em 3ch minmax(0, 1fr);
    align-items: baseline;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  .ml-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .ml-value {
    font-family: var(--font-display);
    font-size: 1.15rem;
    text-align: right;
    color: var(--text-primary);
  }
  .ml-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .pace-line {
    margin: 14px 0 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .pace-line strong {
    color: var(--text-primary);
  }
  @media (max-width: 719px) {
    .wide {
      display: none;
    }
    .days,
    .note,
    .pace-line {
      margin-top: 10px;
    }
    .narrow {
      display: block;
    }
  }
  @media (max-width: 720px) {
    .modes :global(.dk) {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .paces :global(.dk) {
      gap: 8px;
    }
    .deck :global(.dk-tile) {
      padding: 12px;
    }
    .deck :global(.dk-value) {
      font-size: 26px;
    }
    .paces :global(.dk-suffix) {
      display: block;
      margin: 4px 0 0;
      font-size: 13px;
    }
    .paces :global(.dk-sub) {
      display: none;
    }
    .share-col {
      min-width: 90px;
    }
  }
  /* Commuting: one compact row per journey, a button that opens its route
     beneath it. One grid row on a desktop, two lines on a phone. */
  .commutes {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-hair);
  }
  .commutes li {
    border-bottom: 1px solid var(--line-hair);
  }
  .commute {
    all: unset;
    box-sizing: border-box;
    width: 100%;
    cursor: pointer;
    display: grid;
    grid-template-columns: 12em 6.5em minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 2px 14px;
    padding: 9px 4px;
  }
  .commute:hover .c-route,
  li.open .c-route {
    color: var(--accent);
  }
  .commute:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .c-when,
  .c-figs,
  .c-mode {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    white-space: nowrap;
  }
  .c-when,
  .c-figs {
    color: var(--text-secondary);
  }
  .c-mode {
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .c-route {
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .c-route .dim {
    color: var(--text-muted);
  }
  .c-route .arrow {
    margin: 0 0.35em;
    color: var(--text-muted);
  }
  .c-figs {
    text-align: right;
  }
  .c-map {
    padding: 0 0 12px;
  }
  .more {
    margin-top: 10px;
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .more:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .more:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  @media (max-width: 719px) {
    .commute {
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 8px 0;
    }
    .c-mode {
      text-align: right;
    }
    .c-route {
      grid-column: 1;
      grid-row: 2;
    }
    .c-figs {
      grid-column: 2;
      grid-row: 2;
    }
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
    /* viewBox units sized from the chart's rendered width: 12px on screen. */
    font-size: var(--tick, 12px);
    fill: var(--text-muted);
  }
  /* Present to a screen reader, invisible on screen: the charts' figures as
     tables (the aria-label alone carries no numbers). */
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
</style>
