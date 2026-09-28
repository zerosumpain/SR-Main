<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PeopleNav from '$lib/components/home/PeopleNav.svelte';
  import ArrivalBoard from '$lib/components/home/ArrivalBoard.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const d = $derived(data.insights);
  const duration = (n: number) => n < 60 ? `${Math.round(n)}m` : `${Math.floor(n / 60)}h ${Math.round(n % 60)}m`;
  const total = (k: 'wander' | 'daylight' | 'away' | 'observed') => d?.people.reduce((n, p) => n + p[k], 0) ?? 0;
  const summary = $derived(d ? [
    { label: 'Wander time', value: duration(total('wander')), sub: 'observed active travel away from home' },
    { label: 'Together', value: duration(d.together), sub: 'at least two people · overlapping time' },
    { label: 'Daylight movement', value: duration(total('daylight')), sub: 'estimated outdoor time · person-hours' },
    { label: 'Routes learned', value: String(d.routes.filter(r => r.samples >= 3).length), sub: `${data.days}-day history · both directions separate` },
  ] : []);
  const maxDay = $derived(Math.max(1, ...(d?.daily.map(x => x.wander) ?? [])));
  const time = (s: string | null) => s ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s)) : 'No usable fixes';
  onMount(() => {
    let pending = false;
    const refresh = async () => { if (document.hidden || pending) return; pending = true; try { await invalidate('home:insights'); } finally { pending = false; } };
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000);
    return () => clearInterval(timer);
  });
</script>
<svelte:head><title>People insights — Strange Ramblings</title><meta name="robots" content="noindex" /></svelte:head>
<HomeFrame path="/home/people/insights" kicker="Home · People / Insights" title={['The shape of', 'everyday life']} standfirst="Journeys, shared moments and the places that make up your days." {summary} footer={['Private household insights', 'Observed trail · Europe/London', 'Estimates, with their evidence']}>
  <PeopleNav active="insights" />
  <div class="dashboard">
    <form class="filters" method="GET">
      <label>Person<select name="person" value={data.person ?? ''}><option value="">Whole household</option>{#each data.members as p}<option value={p.subject}>{p.displayName}</option>{/each}</select></label>
      <label>History<select name="days" value={String(data.days)}><option value="7">7 days</option><option value="28">28 days</option><option value="90">90 days</option></select></label>
      <button class="cta" type="submit">Apply</button>
      <span>{d ? `${duration(total('observed'))} observed across ${d.people.length} people` : 'Observation unavailable'}</span>
    </form>
    {#if d?.people.some(p => p.subject.startsWith('sample-insights-'))}<p class="note">Local preview includes clearly labelled synthetic family places and journeys.</p>{/if}
    {#if data.loadError}<p class="error" role="alert">{data.loadError}</p>{/if}
    {#if d}
      <ArrivalBoard arrivals={d.arrivals} generatedAt={d.generatedAt} />
      <section class="section">
        <div class="section-head"><div><p class="eyebrow">02 / Familiar journeys</p><h2>Routes & routines</h2></div><a href="/home/people/places">Give your places a name ↗</a></div>
        {#if d.routes.length}
          <div class="table-wrap"><table><caption>Completed routes in the selected history. Range is the 10th–90th percentile.</caption><thead><tr><th>Journey / person</th><th>Trips</th><th>Average</th><th>Typical range</th><th>Routine</th></tr></thead><tbody>
            {#each d.routes as r}<tr><td><strong>{r.from} → {r.to}</strong><small>{r.person} · {r.mode === 'vehicle' ? 'vehicle likely' : 'active travel likely'}</small></td><td>{r.samples}</td><td class="number">{duration(r.average)}</td><td>{Math.round(r.low)}–{Math.round(r.high)} min</td><td>{r.samples < 3 ? 'Still learning' : r.morning >= 3 && r.morning / r.samples >= .6 ? 'Weekdays · 08:00–09:00' : 'Varied departures'}</td></tr>{/each}
          </tbody></table></div>
        {:else}<p class="empty">Routes will appear after a continuous journey between two places with observed stays. Naming places makes each route easier to recognise.</p>{/if}
      </section>
      <div class="two-columns">
        <section class="section"><div class="section-head"><div><p class="eyebrow">03 / Out & about</p><h2>Daily movement</h2></div></div>
          <p class="legend"><span>▰ Wandering / active travel</span><span>▰ In daylight</span></p>
          {#if d.daily.length}<div class="daily-chart" role="img" aria-label="Daily active travel away from home, with daylight movement highlighted">
            {#each d.daily as day}<div class="day"><span>{day.date.slice(5)}</span><div class="track" title={`${day.date}: ${duration(day.wander)} active, ${duration(day.daylight)} in daylight`}><div class="wander" style:width={`${day.wander / maxDay * 100}%`}><div class="daylight" style:width={`${day.wander ? day.daylight / day.wander * 100 : 0}%`}></div></div></div><span>{duration(day.wander)}</span></div>{/each}
          </div>{:else}<p class="empty">No observed movement in this window.</p>{/if}
          <p class="note">Daylight movement is an outdoor-time proxy. Stationary time is assumed indoors; vehicle travel is excluded. It does not measure sunshine, shade, weather or UV exposure.</p>
        </section>
        <section class="section"><div class="section-head"><div><p class="eyebrow">04 / Shared moments</p><h2>Time together</h2></div><strong class="big-number">{duration(d.together)}</strong></div>
          {#if d.groups.length}<ul class="group-list">{#each d.groups as g}<li><span>{g.names.join(' + ')}<small>{g.subjects.length} people · nearby throughout each interval</small></span><strong>{duration(g.minutes)}</strong></li>{/each}</ul>
          {:else}<p class="empty">No overlapping, sufficiently accurate observations of two or more people nearby.</p>{/if}
          <p class="note">Within 75 m at both ends of overlapping observations. This suggests time together; it cannot establish interaction. The headline counts each minute once, even when several groups are together.</p>
        </section>
      </div>
      <section class="section"><div class="section-head"><div><p class="eyebrow">05 / Everyone’s balance</p><h2>Where the time goes</h2></div></div>
        {#if d.people.length}<div class="table-wrap"><table><caption>Only observed intervals of six minutes or less are counted. Coverage is the observed share of the entire selected period.</caption><thead><tr><th>Person / last fix</th><th>Home</th><th>Away</th><th>Wandering</th><th>Daylight</th><th>Longest still</th><th>Coverage</th></tr></thead><tbody>
          {#each d.people as p}<tr><td><strong>{p.displayName}</strong><small>{time(p.lastSeen)}</small></td><td>{duration(p.home)}</td><td>{duration(p.away)}</td><td>{duration(p.wander)}</td><td>{duration(p.daylight)}</td><td>{duration(p.longestStill)}</td><td><strong>{Math.round(p.coverage * 100)}%</strong><small>{duration(p.observed)} observed</small></td></tr>{/each}
        </tbody></table></div>{:else}<p class="empty">No sharing household members available for analysis.</p>{/if}
      </section>
      <details class="methodology"><summary>How to read these insights</summary><p>Routes require a ten-minute observed stay at each end. Average and range use completed trips by the same person and mode. Live estimates compare weekday/weekend departures within 90 minutes of the current departure and require progress along a previously observed route. Conflicting destinations, old fixes and long gaps suppress estimates.</p><p>Wander time means likely walking or active travel away from home. It may include a purposeful walk. Home and away totals require agreement from both observations; unknown home status remains unclassified. No data is counted as missing observation, not inactivity. GPS alone cannot distinguish all transport modes or prove indoor/outdoor activity.</p><p>Phone notifications use existing household followers and sharing preferences. Each journey gets one estimated arrival notification; delivery depends on the app’s notification settings and connectivity. The dashboard refreshes every 30 seconds while visible.</p></details>
    {/if}
  </div>
</HomeFrame>
<style>
  .dashboard { max-width: 1488px; margin: auto; padding: 0 clamp(20px, 3vw, 44px) 3rem; }
  .filters { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem; padding: 1.4rem 0; }
  .filters label { display: grid; gap: .35rem; font-size: var(--fs-label); font-weight: 700; }
  select { padding: .65rem .8rem; border: 1px solid var(--line-strong); background: var(--surface-card); color: var(--text-primary); font-size: var(--fs-body); }
  .filters > span { margin-left: auto; font-size: var(--fs-label); color: var(--text-muted); padding-bottom: .6rem; }
  .section { padding: 2.2rem 0 .6rem; min-width: 0; }
  .section-head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 1rem; border-bottom: 2px solid var(--text-primary); padding-bottom: .8rem; }
  .eyebrow { font: var(--fs-label-xs) var(--font-mono); letter-spacing: .08em; text-transform: uppercase; margin: 0 0 .5rem; color: var(--accent); }
  h2 { font: clamp(1.3rem, 2.4vw, 2rem) var(--font-display); margin: 0; }
  .section-head a { color: var(--accent-ink); font-size: var(--fs-label); }
  .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; text-align: left; font-size: var(--fs-nav); }
  caption { text-align: left; padding: 1rem 0; font-size: var(--fs-label); color: var(--text-muted); }
  th { text-transform: uppercase; letter-spacing: .04em; font-size: var(--fs-label-xs); padding: .8rem; background: var(--surface-rail); white-space: nowrap; }
  td { padding: 1rem .8rem; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
  td:first-child { min-width: 200px; } small { display: block; margin-top: .3rem; color: var(--text-muted); font-size: var(--fs-label-xs); }
  .number, .big-number { font-family: var(--font-display); color: var(--accent-ink); }
  .big-number { font-size: 1.7rem; }
  .two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; }
  .empty, .note, .methodology { color: var(--text-muted); line-height: 1.65; } .empty { padding: 1rem 0; }
  .note { font-size: var(--fs-label); }
  .legend { display: flex; flex-wrap: wrap; gap: 1rem; font-size: var(--fs-label-xs); color: var(--accent-ink); }
  .legend span:last-child { color: var(--accent); }
  .daily-chart { max-height: 310px; overflow: auto; margin: 1rem 0; }
  .day { display: grid; grid-template-columns: 3.5rem 1fr 4rem; align-items: center; gap: .6rem; margin: .6rem 0; font-size: var(--fs-label-xs); font-variant-numeric: tabular-nums; }
  .track { height: 12px; background: var(--surface-rail); } .wander { height: 100%; background: var(--accent-ink); } .daylight { height: 100%; background: var(--accent); }
  .group-list { list-style: none; padding: 0; } .group-list li { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--line); }
  .group-list strong { white-space: nowrap; } .methodology { border-top: 1px solid var(--line-strong); margin-top: 2rem; padding-top: 1rem; font-size: var(--fs-label); }
  summary { cursor: pointer; font-weight: 700; color: var(--text-primary); } .error { border-left: 3px solid var(--accent); padding: 1rem; }
  @media(max-width: 850px) { .two-columns { grid-template-columns: 1fr; gap: 0; } .filters > span { width: 100%; margin-left: 0; } }
</style>
