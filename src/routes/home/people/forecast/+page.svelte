<script lang="ts">
  /**
   * /home/people/forecast — the forecast looked at, not used: how often it has
   * been right (replayed nightly against what then happened), what changed
   * this fortnight, where each person is likeliest to go next, a week of
   * health from the app, and the school holidays it keeps to. Scoped in the
   * load; this page only draws what it was given.
   */
  import { enhance } from '$app/forms';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PeopleNav from '$lib/components/home/PeopleNav.svelte';
  import KpiStrip from '$lib/components/home/people/KpiStrip.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import ForecastInsights from '$lib/components/home/people/ForecastInsights.svelte';
  import { cap, dayLabel } from '$lib/components/home/people/format';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const nameOf = (s: string) => data.names[s] ?? cap(s);
  const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);
  const card = $derived(data.scorecard?.latest ?? null);

  const kpis = $derived(
    card
      ? [
          { label: 'Next move right', value: pct(card.next.precision), sub: `${card.next.hits} of ${card.next.predictions} said 30 min ahead` },
          { label: 'Journeys foreseen', value: pct(card.next.recall), sub: `${card.next.foreseen} of ${card.next.eligible} trips from a known place` },
          {
            label: 'Journey-time band',
            value: pct(card.duration.band),
            sub: `held the next trip; promised 80%`,
            note: card.duration.band != null && card.duration.band < 0.7 ? 'narrower than it should be' : null,
            tone: card.duration.band != null && card.duration.band < 0.7 ? ('watch' as const) : null,
          },
          { label: 'Live arrival window', value: pct(card.eta.window), sub: `${card.eta.rightPlace} right-place estimates; ${card.eta.wrongPlace} wrong place` },
          { label: 'Where-next top pick', value: pct(card.odds?.top1), sub: `top two ${pct(card.odds?.top2)} · offered before ${card.odds?.offered ?? 0} trips` },
        ]
      : [],
  );

  const summary = $derived([
    { label: 'Changes', value: String(data.changes.length), sub: 'this fortnight' },
    ...(card ? [{ label: 'Right', value: pct(card.next.precision), sub: `next moves, ${card.days} days` }] : []),
    { label: 'Holidays', value: String(data.holidays.length), sub: 'school breaks entered' },
  ]);

  const today = $derived(data.now.slice(0, 10));
  const upcoming = $derived(data.holidays.filter((h) => h.to >= today));
  const past = $derived(data.holidays.filter((h) => h.to < today));
</script>

<svelte:head><title>Family forecast — Strange Ramblings</title><meta name="robots" content="noindex" /></svelte:head>

<HomeFrame
  path="/home/people/forecast"
  kicker="Home · People / Forecast"
  title={['How good is', 'the forecast']}
  standfirst={data.isOwner
    ? 'Every night the last four weeks are replayed: the forecast is rebuilt from only what it knew at each moment and checked against what the family then did. Then what changed, where next, and a week of health.'
    : 'What changed in your own movements this fortnight, where you are likeliest to go next, and your week of health from the app.'}
  {summary}
  navBack={data.isOwner}
  footer={['strangeramblings.com/home/people/forecast', 'Scored nightly against real trips', 'Owner · the whole household']}
>
  <PeopleNav active="forecast" owner={data.isOwner} />
  {#if card}<KpiStrip cells={kpis} />{/if}
  {#if data.forecastError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The forecast did not load" message={data.forecastError} /></div></section>
  {/if}

  <div class="desk">
    {#if data.isOwner}
      <section class="card" aria-labelledby="score-h">
        <p class="kicker">Scorecard</p>
        <h2 id="score-h">Right, wrong, and not asked</h2>
        {#if card}
          <p class="strap">{dayLabel(`${card.from}T12:00:00Z`)} to {dayLabel(`${card.to}T12:00:00Z`)}, learning from the 28 days before each moment. Scored {dayLabel(card.generatedAt)}.</p>
          <dl class="facts">
            <div><dt>Journey time, typical miss</dt><dd>{card.duration.medianError ?? '—'} min</dd><small>mean {card.duration.mae ?? '—'} min over {card.duration.estimated} trips</small></div>
            <div><dt>“Four in five arrive by”</dt><dd>{pct(card.duration.p80)}</dd><small>of trips made it; 80% is honest</small></div>
            <div><dt>“Hasn’t left” alerts</dt><dd>{card.overdue.fired}</dd><small>{card.overdue.late} went late · {card.overdue.skipped} never went</small></div>
          </dl>
          {#if card.overdue.recent.length}
            <h3>Recent “hasn’t left” alerts</h3>
            <ul class="rows">
              {#each card.overdue.recent.slice(-6).reverse() as o (o.date + o.subject + o.to)}
                <li><span>{dayLabel(`${o.date}T12:00:00Z`)} · {nameOf(o.subject)} → {o.to}</span><span class="tag" data-tone={o.outcome === 'late' ? 'good' : 'watch'}>{o.outcome === 'late' ? 'went late' : 'never went'}</span></li>
              {/each}
            </ul>
            <p class="strap">A day nobody went is often a holiday or an INSET day. Enter those below and the forecast stops expecting the school run.</p>
          {/if}
        {:else}
          <p class="strap">Not scored yet. The scorecard is built at 2am; the first appears tomorrow morning.</p>
        {/if}
      </section>
    {/if}

    <ForecastInsights changes={data.changes} odds={data.odds} health={data.health} names={data.names} isOwner={data.isOwner} digestAt={data.digestAt} top1={card?.odds?.top1 ?? null} />
    <section class="card" class:wide={data.isOwner} aria-labelledby="hol-h">
      <p class="kicker">School holidays</p>
      <h2 id="hol-h">Days the school run is not expected</h2>
      <p class="strap">Half-terms, holidays and INSET days. On these, routines to or from a school place are not offered, never “overdue”, and do not count as misses.</p>
      {#if data.isOwner}
        <form method="POST" action="?/holidays" use:enhance class="hol">
          {#each [...data.holidays, { from: '', to: '', label: '' }] as h, i (i)}
            <div class="hol-row" class:past={h.to && h.to < today}>
              <label>From <input class="nm-text-input" type="date" name="from" value={h.from} /></label>
              <label>To <input class="nm-text-input" type="date" name="to" value={h.to} /></label>
              <label class="grow">Name <input class="nm-text-input" type="text" name="label" maxlength="60" placeholder={h.from ? '' : 'e.g. October half term'} value={h.label ?? ''} /></label>
            </div>
          {/each}
          <p class="strap">Clear a row’s dates to remove it. A one-day INSET needs only “From”.</p>
          <button class="nm-save-btn" type="submit">Save holidays</button>
          {#if form && 'saved' in form}<p class="strap" role="status">Saved {form.saved}{form.dropped ? `; ${form.dropped} not understood and left out` : ''}.</p>{/if}
          {#if form && 'error' in form}<p class="strap" role="alert">Not saved: {form.error}</p>{/if}
        </form>
      {:else if upcoming.length || past.length}
        <ul class="rows">
          {#each upcoming as h (h.from)}<li><span>{h.label ?? 'Holiday'}</span><span>{dayLabel(`${h.from}T12:00:00Z`)}{h.to !== h.from ? ` – ${dayLabel(`${h.to}T12:00:00Z`)}` : ''}</span></li>{/each}
        </ul>
      {:else}
        <p class="strap quiet">None entered yet.</p>
      {/if}
    </section>
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
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px 18px;
    margin: 0;
  }
  .facts dt {
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .facts dd {
    margin: 2px 0;
    font: var(--fs-body-lg) var(--font-display);
  }
  small {
    display: block;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .rows li {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .tag {
    font: 600 var(--fs-label-xs) var(--font-mono);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--warn);
  }
  .tag[data-tone='good'] {
    color: var(--success);
  }
  .hol {
    display: grid;
    gap: 8px;
  }
  .hol-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: end;
  }
  .hol-row.past {
    opacity: 0.6;
  }
  .hol-row label {
    display: grid;
    gap: 2px;
    font: var(--fs-label-xs) var(--font-mono);
    color: var(--text-muted);
  }
  .hol-row .grow {
    flex: 1;
    min-width: 180px;
  }
  .nm-save-btn {
    justify-self: start;
  }
</style>
