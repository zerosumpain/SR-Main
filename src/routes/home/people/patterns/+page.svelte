<script lang="ts">
  /**
   * /home/people/patterns — ninety days of the household's movement, looked
   * at for its patterns rather than its moment: what is worth knowing, the
   * shape of each person's day, where the time goes by kind of place, who is
   * with whom, each person's destinations, their steps against where they
   * went, their rhythm, and the weeks. Built nightly; this page only draws
   * the stored report, narrowed by `?person=`.
   */
  import { enhance } from '$app/forms';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PeopleNav from '$lib/components/home/PeopleNav.svelte';
  import KpiStrip from '$lib/components/home/people/KpiStrip.svelte';
  import PeopleFilterBar from '$lib/components/home/people/PeopleFilterBar.svelte';
  import DepartureHeat from '$lib/components/home/people/DepartureHeat.svelte';
  import PatternDayShape from '$lib/components/home/people/PatternDayShape.svelte';
  import PatternTogether from '$lib/components/home/people/PatternTogether.svelte';
  import PatternPlaces from '$lib/components/home/people/PatternPlaces.svelte';
  import PatternSteps from '$lib/components/home/people/PatternSteps.svelte';
  import { GROUPS, categoryLabel, groupOf, type Group } from '$lib/home/presence/patterns';
  import { dayLabel } from '$lib/components/home/people/format';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const report = $derived(data.report);
  const names = $derived(Object.fromEntries((report?.people ?? []).map((p) => [p.subject, p.displayName])));
  const focus = $derived(report?.people.find((p) => p.subject === data.person) ?? null);
  const shown = $derived(focus ? [focus] : (report?.people ?? []));
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const n = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-GB'));
  const hrefFor = (next: { person?: string | null }) => (next.person ? `?person=${encodeURIComponent(next.person)}` : '?');

  const findings = $derived(
    (report?.findings ?? []).filter((f) => !focus || f.subject === focus.subject || f.subject == null).slice(0, focus ? 8 : 10),
  );

  const kpis = $derived.by(() => {
    if (!report) return [];
    const ps = shown;
    const sum = (f: (p: (typeof ps)[number]) => number) => ps.reduce((a, p) => a + f(p), 0);
    const steps = ps.filter((p) => p.steps.homeDay != null && p.steps.outDay != null);
    const gap = steps.length ? Math.round(steps.reduce((a, p) => a + (p.steps.outDay! - p.steps.homeDay!), 0) / steps.length) : null;
    const pair = focus ? report.together.pairs.filter((p) => p.a === focus.subject || p.b === focus.subject)[0] : report.together.pairs[0];
    return [
      { label: 'Seen', value: pct(sum((p) => p.coverage) / Math.max(1, ps.length)), sub: `of ${report.days} days, on average` },
      { label: 'Places', value: String(focus ? focus.distinctPlaces : new Set(ps.flatMap((p) => p.places.map((x) => x.placeId))).size), sub: 'stayed at for 10 min or more' },
      { label: 'Hours out', value: n(Math.round(sum((p) => p.awayHours))), sub: `${n(Math.round(sum((p) => p.travelHours)))} h travelling, ${n(sum((p) => p.trips))} journeys` },
      { label: 'Steps a day out', value: gap == null ? '—' : `+${n(gap)}`, sub: 'against a day at home' },
      ...(pair ? [{ label: 'Most together', value: `${Math.round(pair.outHours)} h`, sub: `${names[pair.a]} and ${names[pair.b]}, out` }] : []),
    ];
  });

  /** Away time by the page's colour groups, for the "where the time goes" bars. */
  const FILL: Record<Group, string> = {
    home: 'color-mix(in srgb, var(--text-primary) 13%, var(--surface-card))',
    duty: 'var(--chart-cat-1)',
    family: 'var(--chart-cat-3)',
    far: 'var(--chart-cat-4)',
    about: 'var(--chart-cat-2)',
    travel: 'var(--text-secondary)',
  };
  const AWAY = GROUPS.filter((g) => g.id !== 'home');
  function awayBars(p: (typeof shown)[number]) {
    const by = new Map<Group, number>();
    for (const c of p.categories) if (c.category !== 'home') by.set(groupOf(c.category), (by.get(groupOf(c.category)) ?? 0) + c.hours);
    by.set('travel', p.travelHours);
    const total = [...by.values()].reduce((a, b) => a + b, 0) || 1;
    return AWAY.filter((g) => by.get(g.id)).map((g) => ({ ...g, hours: by.get(g.id)!, share: by.get(g.id)! / total }));
  }

  const summary = $derived(
    report
      ? [
          { label: 'People', value: String(report.people.length), sub: 'sharing their movement' },
          { label: 'Window', value: `${report.days}d`, sub: `${dayLabel(report.from)} to ${dayLabel(report.to)}` },
          { label: 'Built', value: dayLabel(report.generatedAt), sub: 'nightly at 2am' },
        ]
      : [],
  );
  const weekPeak = $derived(Math.max(1, ...shown.flatMap((p) => p.weekly.map((w) => w.awayHours))));
  const stepPeak = $derived(Math.max(1, ...shown.flatMap((p) => p.weekly.map((w) => w.steps ?? 0))));
</script>

<svelte:head><title>Movement patterns — Strange Ramblings</title><meta name="robots" content="noindex" /></svelte:head>

<HomeFrame
  path="/home/people/patterns"
  kicker="Home · People / Patterns"
  title={['How the family', 'moves']}
  standfirst="Ninety days of everyone's trail, read for its habits: where each person goes and what kind of place it is, the shape of their day, who they are with, what they travel for what they stay, and what their steps do on the days they go out."
  {summary}
  footer={['strangeramblings.com/home/people/patterns', 'Rebuilt nightly from the trail and the app', 'Owner · the whole household']}
>
  <PeopleNav active="patterns" />
  {#if report}
    <PeopleFilterBar people={report.people.map((p) => ({ subject: p.subject, label: p.displayName }))} person={data.person} days={report.days} windows={[]} {hrefFor} checkedAt={null} />
    <KpiStrip cells={kpis} />
  {/if}

  <div class="desk">
    {#if !report}
      <section class="card wide">
        <p class="kicker">Not built yet</p>
        <h2>The patterns are built at 2am</h2>
        <p class="strap">The first build reads ninety days of trail and each person's daily steps; it takes under a minute.</p>
      </section>
    {:else}
      <section class="card wide" aria-labelledby="find-h">
        <p class="kicker">Worth knowing</p>
        <h2 id="find-h">{focus ? `${focus.displayName}, in a few lines` : 'The household, in a few lines'}</h2>
        {#if findings.length}
          <ol class="finds">{#each findings as f, i (i)}<li>{f.text}</li>{/each}</ol>
        {:else}
          <p class="strap quiet">Nothing stands out yet.</p>
        {/if}
      </section>

      <section class="card wide" aria-labelledby="shape-h">
        <p class="kicker">Times of day</p>
        <h2 id="shape-h">The shape of {focus ? `${focus.displayName}'s` : 'everyone’s'} day</h2>
        <p class="strap">Each column is one hour: where the observed time in it went, across the window. Hover a block for its share.</p>
        <PatternDayShape people={shown} />
      </section>

      <section class="card" aria-labelledby="where-h">
        <p class="kicker">Destinations by kind</p>
        <h2 id="where-h">Where the time out goes</h2>
        <p class="strap">Hours away from home by kind of place, and the time on the road between. Kind comes from the place's name and type; unnamed stops count as out and about.</p>
        <ul class="aw">
          {#each shown as p (p.subject)}
            {@const bars = awayBars(p)}
            <li>
              <span class="aw-name">{p.displayName}<small>{Math.round(p.awayHours)} h out · {pct(p.homeShare)} home</small></span>
              <span class="aw-bar" role="img" aria-label={bars.map((b) => `${b.label} ${pct(b.share)}`).join(', ')}>
                {#each bars as b (b.id)}<span style:width={`${b.share * 100}%`} style:background={FILL[b.id]} title={`${b.label}: ${Math.round(b.hours)} h (${pct(b.share)})`}></span>{/each}
              </span>
            </li>
          {/each}
        </ul>
        <ul class="aw-legend" aria-label="Legend">{#each AWAY as g (g.id)}<li><span class="sw" style:background={FILL[g.id]}></span>{g.label}</li>{/each}</ul>
        <h3>By kind of place{focus ? '' : ', the household'}</h3>
        <table class="kinds">
          <thead><tr><th scope="col">Kind</th><th scope="col">Hours</th><th scope="col">Visits</th>{#if !focus}<th scope="col">People</th>{/if}</tr></thead>
          <tbody>
            {#each focus ? focus.categories.map((c) => ({ ...c, people: 1 })) : report.household.categories as c (c.category)}
              <tr><th scope="row">{categoryLabel(c.category)}</th><td>{n(Math.round(c.hours))}</td><td>{c.visits}</td>{#if !focus}<td>{c.people}</td>{/if}</tr>
            {/each}
          </tbody>
        </table>
      </section>

      <section class="card" aria-labelledby="tg-h">
        <p class="kicker">Clusters</p>
        <h2 id="tg-h">Who is with whom</h2>
        <PatternTogether together={report.together} {names} focus={data.person} />
      </section>

      <section class="card wide" aria-labelledby="pl-h">
        <p class="kicker">Destinations</p>
        {#if focus}
          <h2 id="pl-h">Where {focus.displayName} goes</h2>
          <p class="strap">Most time first. “Way in” is the journey that arrived (and how often it was on foot); “× stay” is the stay against that journey. Steps are an estimate: the day’s steps above a day at home, shared out by minutes on foot.</p>
          <PatternPlaces person={focus} {names} />
        {:else}
          <h2 id="pl-h">The places the household shares</h2>
          <p class="strap">Away from home, somewhere two or more people stay. Pick a person above for their own destinations in full.</p>
          <ul class="rows">
            {#each report.household.shared as s (s.placeId)}
              <li><span><strong>{s.name}</strong><small>{s.people.map((x) => names[x] ?? x).join(', ')}</small></span><span class="num">{s.visits} visits · {Math.round(s.hours)} h</span></li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="card wide" aria-labelledby="st-h">
        <p class="kicker">Steps</p>
        <h2 id="st-h">What going out does to the step count</h2>
        <p class="strap">Daily steps from the app against the days' movement. Only days the trail saw for 16 hours or more are compared.</p>
        <PatternSteps people={report.people} {focus} />
      </section>

      <section class="card wide" aria-labelledby="rh-h">
        <p class="kicker">Rhythm</p>
        <h2 id="rh-h">Habits, side by side</h2>
        <div class="rh-wrap">
          <table class="rh">
            <thead>
              <tr>
                <th scope="col">Person</th><th scope="col">First out<small>wkdy · wknd</small></th><th scope="col">Home by<small>wkdy · wknd</small></th>
                <th scope="col">Days in<small>never left</small></th><th scope="col">Habit<small>usual place for the hour</small></th>
                <th scope="col">Roams<small>weekly radius</small></th><th scope="col">Farthest</th><th scope="col">Places<small>new in 4 wk</small></th>
                <th scope="col">Out alone</th><th scope="col">Journeys<small>median · on foot</small></th>
              </tr>
            </thead>
            <tbody>
              {#each report.people as p (p.subject)}
                <tr class:lit={focus?.subject === p.subject}>
                  <th scope="row"><a href={hrefFor({ person: p.subject })} data-sveltekit-noscroll>{p.displayName}</a><small>seen {pct(p.coverage)}</small></th>
                  <td>{p.firstOut.weekday ?? '—'} · {p.firstOut.weekend ?? '—'}</td>
                  <td>{p.lastHome.weekday ?? '—'} · {p.lastHome.weekend ?? '—'}</td>
                  <td>{p.homeDays}<small>of {p.observedDays}</small></td>
                  <td>{pct(p.predictability)}</td>
                  <td>{p.roamKm} km</td>
                  <td>{p.farthest ? `${n(p.farthest.km)} km` : '—'}<small>{p.farthest?.name ?? ''}</small></td>
                  <td>{p.distinctPlaces}<small>{p.newPlaces} new</small></td>
                  <td>{pct(p.aloneOutShare)}</td>
                  <td>{p.medianTrip} min<small>{pct(p.activeTripShare)} on foot</small></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="strap">“Home by” past midnight reads as the evening before. “Habit” is the share of observed time spent where that person most often is at that hour of a weekday or weekend.</p>
      </section>

      <section class="card" aria-labelledby="wk-h">
        <p class="kicker">Trend</p>
        <h2 id="wk-h">Week by week</h2>
        <p class="strap">Hours out of the house each week, and the week's mean steps — two charts, each on its own scale, shared across people.</p>
        {#each shown as p (p.subject)}
          <div class="wk">
            <span class="wk-name">{p.displayName}</span>
            <div class="wk-charts">
              <div class="wk-bars" aria-label={`${p.displayName}: hours out by week`} role="img">
                {#each p.weekly as w (w.week)}<span class="wk-plot" title={`Week of ${dayLabel(`${w.week}T12:00:00Z`)}: ${w.awayHours} h out, ${w.trips} journeys, ${w.places} places`}><span style:height={`${(w.awayHours / weekPeak) * 100}%`}></span></span>{/each}
              </div>
              <div class="wk-bars steps" aria-label={`${p.displayName}: mean steps by week`} role="img">
                {#each p.weekly as w (w.week)}<span class="wk-plot" title={`Week of ${dayLabel(`${w.week}T12:00:00Z`)}: ${n(w.steps)} steps a day`}><span style:height={`${((w.steps ?? 0) / stepPeak) * 100}%`}></span></span>{/each}
              </div>
            </div>
          </div>
        {/each}
        <p class="wk-key"><span class="sw out"></span>Hours out <span class="sw stp"></span>Steps a day</p>
      </section>

      <section class="card" aria-labelledby="dep-h">
        <p class="kicker">Departures</p>
        <h2 id="dep-h">When the house empties</h2>
        <DepartureHeat grid={report.household.departures} />
        <form method="POST" action="?/rebuild" use:enhance class="rebuild">
          <button class="row-link" type="submit">Rebuild now</button>
          <span class="strap">Built {dayLabel(report.generatedAt)}. A rebuild takes under a minute.</span>
          {#if form && 'rebuilt' in form}<span class="strap" role="status">Rebuilt for {form.rebuilt} people.</span>{/if}
          {#if form && 'error' in form}<span class="strap" role="alert">Not rebuilt: {form.error}</span>{/if}
        </form>
      </section>
    {/if}
  </div>
</HomeFrame>

<style>
  .desk {
    width: min(1400px, 100%);
    margin: 0 auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-left: 1px solid var(--line);
  }
  .card {
    padding: 22px clamp(16px, 2.4vw, 32px) 26px;
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }
  .card.wide {
    grid-column: 1 / -1;
  }
  @media (max-width: 900px) {
    .desk {
      grid-template-columns: minmax(0, 1fr);
      border-left: 0;
    }
    .card {
      border-right: 0;
    }
  }
  .kicker {
    margin: 0 0 4px;
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  h2 {
    margin: 0 0 6px;
    font: var(--fs-display-xs) var(--font-display);
    text-wrap: balance;
  }
  h3 {
    margin: 18px 0 6px;
    font: 600 var(--fs-label) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .strap {
    margin: 0 0 14px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    max-width: 75ch;
  }
  .quiet {
    font-style: italic;
  }
  small {
    display: block;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    font-weight: 400;
  }
  .finds {
    margin: 0;
    padding-left: 1.4em;
    columns: 2 420px;
    column-gap: 40px;
  }
  .finds li {
    margin-bottom: 8px;
    font-size: var(--fs-body);
    break-inside: avoid;
  }
  .aw {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .aw li {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
  }
  .aw-name {
    font: var(--fs-label) var(--font-mono);
  }
  .aw-bar {
    display: flex;
    gap: 2px;
    height: 16px;
  }
  .aw-bar span {
    min-width: 2px;
    border-radius: 1px;
  }
  .aw-legend,
  .wk-key {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-secondary);
  }
  .aw-legend li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sw {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 2px;
    vertical-align: -1px;
  }
  .kinds,
  .rh {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-body-sm);
    font-variant-numeric: tabular-nums;
  }
  .kinds th,
  .kinds td,
  .rh th,
  .rh td {
    text-align: left;
    vertical-align: top;
    padding: 6px 8px 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .kinds thead th,
  .rh thead th {
    font: 500 var(--fs-label-xs) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--line-strong);
  }
  .rh thead th small {
    text-transform: none;
    letter-spacing: 0;
  }
  .rh-wrap {
    overflow-x: auto;
    margin-bottom: 10px;
  }
  .rh {
    min-width: 900px;
  }
  .rh tr.lit th a {
    color: var(--accent);
  }
  .rh th a {
    color: inherit;
    font-weight: 700;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
    columns: 2 340px;
    column-gap: 32px;
  }
  .rows li {
    display: flex;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
    break-inside: avoid;
  }
  .num {
    font: var(--fs-label) var(--font-mono);
    white-space: nowrap;
  }
  .wk {
    display: grid;
    grid-template-columns: 80px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    margin-bottom: 10px;
  }
  .wk-name {
    font: var(--fs-label) var(--font-mono);
  }
  .wk-charts {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .wk-bars {
    display: flex;
    gap: 2px;
    height: 36px;
    border-bottom: 1px solid var(--line);
  }
  .wk-plot {
    flex: 1;
    display: flex;
    align-items: flex-end;
  }
  .wk-plot span {
    width: 100%;
    background: var(--accent-ink);
    border-radius: 2px 2px 0 0;
  }
  .wk-bars.steps .wk-plot span,
  .sw.stp {
    background: var(--accent);
  }
  .sw.out {
    background: var(--accent-ink);
  }
  .rebuild {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
    align-items: baseline;
    margin-top: 18px;
  }
  .rebuild .strap {
    margin: 0;
  }
</style>
