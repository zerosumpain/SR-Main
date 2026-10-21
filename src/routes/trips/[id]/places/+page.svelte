<script lang="ts">
  // The research pack, browsed (v8): everything the planner found for the
  // trip — the long list — on index cards with photos, facts, sources and
  // when each was checked; the date facts (closures, holidays, events, rain);
  // filters (food, rainy day, children, needs booking, less visited, by
  // neighbourhood). "Add to the plan" asks the planner for checked ways to
  // fit a place in (on the day it sits best), shown here to choose from with
  // What changed and Undo; "Not for us" takes it off the list.
  import { goto, invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TripCover from '$lib/components/trips/notes/TripCover.svelte';
  import MarginBlock from '$lib/components/trips/notes/MarginBlock.svelte';
  import PlacePhoto from '$lib/components/trips/decisions/PlacePhoto.svelte';
  import ProposalGroup from '$lib/components/trips/decisions/ProposalGroup.svelte';
  import ChangeLedger from '$lib/components/trips/decisions/ChangeLedger.svelte';
  import { tripName, dateSpan } from '$lib/components/trips/notes/notes';
  import { dayLabel } from '$lib/trips/changes';
  import { api, errorText } from '$lib/trips/decisions-client';
  import { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import {
    bestDayFor,
    checkedText,
    filterPlaces,
    groupProposals,
    hostOf,
    mergeProposals,
    neighbourhoodsOf,
    PACK_FILTERS,
    PACK_KIND_LABEL,
    placeFacts,
    type PackFilter,
  } from '$lib/trips/decisions-view';
  import { REJECT_REASON_LABEL, type CalendarKind, type PackPlace } from '$lib/trips/decisions';
  import { postAsJob } from '$lib/trips/job-client';

  let { data } = $props();

  const base = $derived(`/api/trips/${data.trip.id}`);
  const name = $derived(tripName(data.trip).name);
  const place = $derived(data.trip.destination.split(',')[0]?.trim() || data.trip.destination);
  const tripHref = $derived(`/trips/${data.trip.id}`);

  // "Ask the planner to remember" (after an answer) is said on the trip page, where the planner is.
  const desk = new DecisionDesk(() => base, { reload: () => invalidateAll(), tell: () => void goto(tripHref) });

  // ── Filters (this page only) ──
  let on = $state<PackFilter[]>([]);
  let area = $state<string | null>(null);
  let showRejected = $state(false);
  let hidden = $state<Set<string>>(new Set());
  const HIDDEN_KEY = $derived(`sr-trips-hidden-${data.trip.id}`);
  onMount(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]');
      if (Array.isArray(raw)) hidden = new Set(raw.filter((x): x is string => typeof x === 'string'));
    } catch {
      /* nothing kept */
    }
  });
  const toggle = (f: PackFilter) => (on = on.includes(f) ? on.filter((x) => x !== f) : [...on, f]);
  const areas = $derived(neighbourhoodsOf(data.places));
  const shown = $derived(filterPlaces(data.places, { on, neighbourhood: area, showRejected, hidden }));

  // ── Add to the plan / Not for us ──
  const added = $derived(groupProposals(mergeProposals([], desk.local, desk.gone)).groups);
  let adding = $state<string | null>(null);
  async function addToPlan(p: PackPlace) {
    adding = p.id;
    const date = bestDayFor(p.place.location, data.days);
    await desk.request({ kind: 'fill', target: { date, packPlaceId: p.id } }, `add:${p.id}`, `add:${p.id}`);
    adding = null;
  }
  async function notForUs(p: PackPlace) {
    const r = await api('POST', `${base}/pack`, { action: 'reject', placeId: p.id, reason: 'not-for-us' });
    // Off the list here either way; kept in this browser if the server could not take it.
    hidden = new Set([...hidden, p.id]);
    if (!r.ok) {
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
      } catch {
        /* private window */
      }
    } else await invalidateAll();
    document.getElementById('places-h')?.focus();
  }

  // ── Look further / build ──
  let theme = $state('');
  let looking = $state(false);
  let lookNote = $state<string | null>(null);
  async function lookFurther(action: 'more' | 'build') {
    looking = true;
    lookNote = null;
    const { ok, body } = await postAsJob<{ places?: PackPlace[] }>(`${base}/pack`, { action, ...(theme.trim() ? { theme: theme.trim() } : {}) });
    looking = false;
    if (!ok) lookNote = body.error ?? 'That did not work. Try again.';
    else {
      lookNote = action === 'more' ? 'Looked further. New places are on the list.' : 'Research done.';
      theme = '';
      await invalidateAll();
    }
  }

  // While the research is still running, look again every so often.
  $effect(() => {
    if (data.pack.status !== 'building') return;
    const t = setInterval(() => void invalidateAll(), 10_000);
    return () => clearInterval(t);
  });

  const CAL: Record<CalendarKind, string> = { closure: 'Closed', holiday: 'Holiday', event: 'Event', strike: 'Strike', weather: 'Weather', sun: 'Sun', other: 'Note' };
  const calendar = $derived([...data.pack.calendar].sort((a, b) => (a.date ?? '0').localeCompare(b.date ?? '0')));
  const builtLine = $derived.by(() => {
    if (data.pack.status === 'building') return `Still reading up on ${place}${data.pack.stage ? ` — ${data.pack.stage.toLowerCase()}` : ''}.`;
    if (!data.places.length) return `Nothing found for ${place} yet.`;
    const when = checkedText(data.pack.refreshedAt ?? data.pack.builtAt);
    return `${data.places.length} places found for ${place}, ${dateSpan(data.trip.startDate, data.trip.endDate)}.${when ? ` ${when}.` : ''}`;
  });
  const TILTS = [-0.7, 0.5, -0.3, 0.8, -0.5, 0.3];
</script>

<svelte:head><title>Places — {name} — Trips</title></svelte:head>

<PageHeader title="Trips" />

<TripCover kicker="Places" title="What’s there" line={builtLine} titleId="places-cover-h">
  {#snippet actions()}
    <a href={tripHref}>← Back to {name}</a>
  {/snippet}
</TripCover>

<main class="desk">
  <div class="sheet np-sheet np-tear">
    {#if !data.available}
      <MarginBlock kicker="Note">
        <p class="np-aside">The research for this trip is not available yet.</p>
        <button class="dx-btn small" type="button" disabled={looking} onclick={() => lookFurther('build')}>{looking ? 'Reading up… it carries on if you leave' : 'Read up on the place'}</button>
        {#if lookNote}<p class="dx-note" role="status">{lookNote}</p>{/if}
      </MarginBlock>
    {/if}

    {#if data.pack.highlights.length || calendar.length}
      <MarginBlock kicker="Dates" aria-labelledby="dates-h">
        <h2 id="dates-h" class="sheet-h small">On your dates</h2>
        {#if data.pack.highlights.length}
          <ul class="hl">{#each data.pack.highlights as h, hi (hi)}<li>{h}</li>{/each}</ul>
        {/if}
        {#if calendar.length}
          <ul class="cal" role="list">
            {#each calendar as c, ci (ci)}
              <li class="cal-row cal-{c.kind}">
                <span class="cal-date">{c.date ? dayLabel(c.date) : 'Any day'}</span>
                <span class="cal-kind">{CAL[c.kind]}</span>
                <span class="cal-text">{c.text}{#each c.sources as s, si (s.url)}{si ? ', ' : ' — '}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? hostOf(s.url)}</a>{/each}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </MarginBlock>
    {/if}

    {#if desk.change || added.length || desk.problem || desk.note}
      <MarginBlock kicker="Adding" aria-label="Fitting a place in">
        <div class="adding">
          {#if desk.problem && !desk.problem.where?.startsWith('add:')}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
          {#if desk.change}
            <ChangeLedger card={desk.change} {desk} />
            <p><a class="dx-link" href={tripHref}>See it in the plan →</a></p>
          {/if}
          {#each added as g (g.groupId)}
            <ProposalGroup heading="Ways to fit in {g.proposals[0]?.title ?? 'it'}" groupId={g.groupId} proposals={g.proposals} {desk} />
          {/each}
        </div>
      </MarginBlock>
    {/if}

    <MarginBlock kicker="Places" aria-labelledby="places-h">
      <h2 id="places-h" class="sheet-h" tabindex="-1">The long list</h2>
      <div class="filters" role="group" aria-label="Show only">
        {#each PACK_FILTERS as pf (pf.key)}
          <button class="dx-pen" type="button" aria-pressed={on.includes(pf.key)} onclick={() => toggle(pf.key)}>{pf.label}</button>
        {/each}
        {#if areas.length}
          <label class="area">
            <span class="dx-vh">Neighbourhood</span>
            <select class="area-in" bind:value={area}>
              <option value={null}>Every neighbourhood</option>
              {#each areas as a (a)}<option value={a}>{a}</option>{/each}
            </select>
          </label>
        {/if}
        <label class="rej"><input type="checkbox" bind:checked={showRejected} /> Show turned down</label>
      </div>
      <p class="np-aside count" role="status">{shown.length === data.places.length ? `All ${shown.length} places` : `${shown.length} of ${data.places.length} places`}{on.length || area ? ' match' : ''}.</p>

      {#if !shown.length}
        <p class="np-aside">{data.places.length ? 'Nothing matches all of those. Take a filter off.' : data.pack.status === 'building' ? 'The list fills in as the research goes.' : 'No places yet.'}</p>
      {:else}
        <ul class="places" role="list">
          {#each shown as p, pi (p.id)}
            {@const facts = placeFacts(p)}
            {@const checked = checkedText(p.checkedAt ?? p.facts?.checkedAt)}
            <li>
              <article class="pl np-card" class:planned={p.status === 'planned'} class:rejected={p.status === 'rejected'} style:--np-tilt="{TILTS[pi % TILTS.length]}deg" aria-labelledby="pl-{p.id}">
                <p class="dx-k pl-k">{PACK_KIND_LABEL[p.kind] ?? 'Place'}{p.neighbourhood ? ` · ${p.neighbourhood}` : ''}</p>
                <h3 id="pl-{p.id}" class="pl-h">{p.name}</h3>
                {#if p.image}<PlacePhoto image={p.image} alt={p.name} compact />{/if}
                {#if p.status === 'planned'}<p class="dx-chip good pl-state">In the plan</p>{/if}
                {#if p.status === 'rejected'}<p class="dx-chip warn pl-state">Turned down{p.rejectReason ? `: ${REJECT_REASON_LABEL[p.rejectReason].toLowerCase()}` : ''}</p>{/if}
                {#if p.why}<p class="pl-why">{p.why}</p>{/if}
                {#if facts.length}<ul class="dx-chips" aria-label="Facts">{#each facts as f, fi (fi)}<li class="dx-chip">{f}</li>{/each}</ul>{/if}
                {#if p.facts?.openingHoursText}<p class="pl-line"><span class="pl-lk">Hours</span> {p.facts.openingHoursText}</p>{/if}
                {#if p.facts?.closedDates?.length}<p class="pl-line"><span class="pl-lk">Closed</span> {p.facts.closedDates.map(dayLabel).join(', ')}</p>{/if}
                {#if p.place.address}<p class="pl-line"><span class="pl-lk">Where</span> {p.place.address}</p>{/if}
                {#if p.facts?.bookingUrl}<p class="pl-line"><a href={p.facts.bookingUrl} target="_blank" rel="noopener noreferrer">Book on the official site ↗</a></p>{/if}
                {#if p.sources.length || checked}
                  <p class="pl-src">{#each p.sources as s, si (s.url)}{si ? ' · ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? hostOf(s.url)}</a>{/each}{#if checked}<span class="pl-checked">{p.sources.length ? ' · ' : ''}{checked}</span>{/if}</p>
                {/if}
                {#if p.status !== 'planned'}
                  <div class="pl-acts">
                    <button class="dx-btn small" type="button" disabled={!!desk.busy} onclick={() => addToPlan(p)}>{adding === p.id ? 'Finding a slot…' : 'Add to the plan'}</button>
                    {#if p.status !== 'rejected'}<button class="dx-link" type="button" onclick={() => notForUs(p)}>Not for us</button>{/if}
                  </div>
                {/if}
                {#if desk.problem?.where === `add:${p.id}`}<p class="dx-err" role="alert">{desk.problem.text}</p>{/if}
                {#if desk.note?.where === `add:${p.id}`}<p class="dx-note" role="status">{desk.note.text}</p>{/if}
              </article>
            </li>
          {/each}
        </ul>
      {/if}
    </MarginBlock>

    {#if data.pack.neighbourhoods.length}
      <MarginBlock kicker="Areas" aria-labelledby="areas-h">
        <h2 id="areas-h" class="sheet-h small">Neighbourhoods</h2>
        <dl class="areas">
          {#each data.pack.neighbourhoods as n (n.name)}
            <dt><button class="dx-link" type="button" onclick={() => (area = n.name)}>{n.name}</button></dt>
            <dd>{n.line}{#if n.places.length}<span class="dx-aside"> — {n.places.join(', ')}</span>{/if}</dd>
          {/each}
        </dl>
      </MarginBlock>
    {/if}

    {#if data.available}
      <MarginBlock kicker="More" aria-labelledby="more-h">
        <h2 id="more-h" class="sheet-h small">Look further</h2>
        <p class="np-aside">The planner searches again and adds what it finds to this list. Say what for, if you like.</p>
        <form class="more" onsubmit={(e) => { e.preventDefault(); void lookFurther('more'); }}>
          <label class="dx-vh" for="theme">What to look for</label>
          <input id="theme" class="more-in" bind:value={theme} placeholder="Rainy-day things for a nine-year-old" />
          <button class="dx-btn small" type="submit" disabled={looking}>{looking ? 'Looking… it carries on if you leave' : 'Look further'}</button>
        </form>
        {#if lookNote}<p class="dx-note" role="status">{lookNote}</p>{/if}
      </MarginBlock>
    {/if}
  </div>
</main>

<style>
  .desk {
    padding: 0 0 72px;
  }
  .sheet {
    max-width: 1480px;
    margin: 0 auto;
    padding: 26px 0 32px;
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--np-rule) 31px 32px);
  }
  .sheet-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(26px, 3vw, 36px);
    line-height: 1.15;
    letter-spacing: -0.03em;
  }
  .sheet-h.small {
    font-size: clamp(20px, 2.2vw, 26px);
  }
  .sheet-h:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .sheet-h:focus:not(:focus-visible) {
    outline: none;
  }
  .hl {
    margin: 8px 0 10px;
    padding-left: 18px;
    line-height: 1.6;
  }
  .hl li::marker {
    color: var(--accent);
  }
  .cal {
    list-style: none;
    margin: 0;
    padding: 0;
    max-width: 880px;
  }
  .cal-row {
    display: grid;
    grid-template-columns: 7.5rem 5.5rem minmax(0, 1fr);
    gap: 4px 12px;
    padding: 6px 0;
    border-top: 1px dashed var(--line-strong);
    font-size: var(--fs-label);
    line-height: 1.5;
  }
  .cal-row:first-child {
    border-top: 0;
  }
  .cal-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .cal-kind {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
  }
  .cal-closure .cal-kind,
  .cal-strike .cal-kind {
    color: var(--np-pen-text);
  }
  .cal-text a {
    color: var(--accent-ink);
  }
  .adding {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 720px;
  }
  .adding p {
    margin: 0;
  }
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 10px 0 4px;
  }
  .area-in {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 3px 6px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--np-card);
    color: var(--np-ink);
    max-width: 100%;
  }
  .rej {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .count {
    font-size: 15px;
  }
  .places {
    list-style: none;
    margin: 12px 0 0;
    padding: 6px 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
    gap: 24px 22px;
    align-items: start;
  }
  .pl {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 16px 14px;
    background-image: none;
  }
  .pl.planned {
    border-color: var(--accent-ink);
    box-shadow: inset 0 4px 0 var(--accent-ink);
  }
  .pl.rejected {
    opacity: 0.75;
  }
  .pl-k {
    line-height: 1.4;
  }
  .pl-h {
    margin: 0;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--np-margin-a);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 19px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }
  .pl-state {
    align-self: flex-start;
    margin: 0;
  }
  .pl-why {
    margin: 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 23px;
    color: var(--np-ink-soft);
  }
  .pl-line {
    margin: 0;
    font-size: var(--fs-label);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  .pl-line a,
  .pl-src a {
    color: var(--accent-ink);
  }
  .pl-lk {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
    margin-right: 4px;
  }
  .pl-src {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .pl-checked {
    color: var(--np-ink-soft);
  }
  .pl-acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    margin-top: 4px;
  }
  .areas {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 6px 16px;
    margin: 8px 0 0;
  }
  .areas dd {
    margin: 0;
  }
  .more {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
    align-items: center;
    margin-top: 8px;
  }
  .more-in {
    flex: 1 1 260px;
    font-family: var(--font-body);
    font-size: 16px;
    padding: 4px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    background: transparent;
    color: var(--np-ink);
    min-width: 0;
  }
  .more-in:focus {
    outline: none;
    border-bottom: 2px solid var(--accent-ink);
  }
  @media (max-width: 760px) {
    .sheet {
      padding-top: 18px;
    }
    .cal-row {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    .areas {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
