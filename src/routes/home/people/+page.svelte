<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import HomeFrame from '$lib/components/home/HomeFrame.svelte';
  import PeopleNav from '$lib/components/home/PeopleNav.svelte';
  import PeopleMovement from '$lib/components/home/PeopleMovement.svelte';
  import LoadErrorCard from '$lib/components/jkai/daydream/hub/LoadErrorCard.svelte';
  import PeopleFilterBar from '$lib/components/home/people/PeopleFilterBar.svelte';
  import KpiStrip from '$lib/components/home/people/KpiStrip.svelte';
  import NowBoard from '$lib/components/home/people/NowBoard.svelte';
  import WatchList from '$lib/components/home/people/WatchList.svelte';
  import RoutineStrips from '$lib/components/home/people/RoutineStrips.svelte';
  import DepartureHeat from '$lib/components/home/people/DepartureHeat.svelte';
  import NamingQueue from '$lib/components/home/people/NamingQueue.svelte';
  import ComingUp from '$lib/components/home/people/ComingUp.svelte';
  import NotifySwitches from '$lib/components/home/people/NotifySwitches.svelte';
  import { cap, clock, hours } from '$lib/components/home/people/format';
  import { nowCounts } from '$lib/home/presence/now';
  import type { PageData } from './$types';
  /**
   * /home/people — the family travel desk. One page: where everyone is, where
   * they are likely going next and when they will get there, what looks off,
   * the routines behind those guesses, when the house empties, and the places
   * still waiting for a name. Every figure comes from the learned trail
   * (`forecast.ts` over `insights.ts`), never a model.
   *
   * Two viewers, scoped in the load and nowhere else: the owner sees everyone
   * and the naming queue; a household viewer sees everyone's live status and
   * the forecast only for themselves and their wards.
   *
   * The forecast and the naming queue STREAM: the live band paints first. The
   * last resolved forecast is kept across the 30-second refresh, so the page
   * never blanks while the next one is read.
   */

  let { data }: { data: PageData } = $props();

  type Forecast = NonNullable<Awaited<PageData['forecast']>>;
  type Naming = NonNullable<Awaited<NonNullable<PageData['naming']>>>;
  type Agenda = NonNullable<Awaited<NonNullable<PageData['agenda']>>>;
  let agenda = $state<Agenda | null>(null);
  let agendaState = $state<'pending' | 'ready' | 'failed'>('pending');
  $effect(() => {
    const promise = data.agenda;
    let current = true;
    promise?.then((v) => {
      if (!current) return;
      if (v) {
        agenda = v;
        agendaState = 'ready';
      } else if (!agenda) agendaState = 'failed';
    });
    return () => {
      current = false;
    };
  });
  let fc = $state<Forecast | null>(null);
  let fcState = $state<'pending' | 'ready' | 'failed'>('pending');
  let naming = $state<Naming | null>(null);

  $effect(() => {
    const promise = data.forecast;
    let current = true;
    promise.then((v) => {
      if (!current) return;
      if (v) {
        fc = v;
        fcState = 'ready';
      } else if (!fc) fcState = 'failed';
    });
    return () => {
      current = false;
    };
  });
  $effect(() => {
    const promise = data.naming;
    let current = true;
    promise?.then((v) => {
      if (current && v) naming = v;
    });
    return () => {
      current = false;
    };
  });

  let clockNow = $state<Date | null>(null);
  const now = $derived(clockNow ?? new Date(data.loadedAt));
  const members = $derived(
    data.family.members.map((m) => ({
      ...m,
      ageMins: m.lastSeenAt ? Math.max(0, Math.round((now.getTime() - new Date(m.lastSeenAt).getTime()) / 60_000)) : null,
    })),
  );
  const isOwner = $derived(data.viewer.kind === 'owner');
  const names = $derived(new Map<string, string>(data.movement.map((p) => [p.subject, p.displayName])));
  const nameOf = (s: string) => names.get(s) ?? cap(s);

  let liveFixes = $state<Record<string, { lat: number; lon: number; at: string }>>({});
  let liveRevoked = $state(false);
  const mapPositions = $derived.by(() => {
    if (liveRevoked) return [];
    const positions = new Map(data.positions.map(p => [p.subject, p]));
    for (const [subject, fix] of Object.entries(liveFixes)) {
      const previous = positions.get(subject);
      if (previous && Date.parse(previous.at) >= Date.parse(fix.at)) continue;
      positions.set(subject, previous ? { ...previous, ...fix }
        : { subject, ...fix, isHome: null });
    }
    return [...positions.values()];
  });
  onMount(() => {
    let stopped = false;
    let controller: AbortController | undefined;
    let revision = '';
    let scope: string | undefined;
    const visibility = () => { if (document.hidden) controller?.abort(); };
    const follow = async () => {
      while (!stopped) {
        if (document.hidden) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
        controller = new AbortController();
        try {
          const response = await fetch(`/api/apple/household/live?since=${encodeURIComponent(revision)}`, { signal: controller.signal });
          if (response.status === 401 || response.status === 403) {
            liveFixes = {}; liveRevoked = true;
            await invalidate('home:people');
            return;
          }
          if (!response.ok) throw new Error('Live positions unavailable');
          const result = await response.json();
          if (stopped || document.hidden) continue;
          revision = String(result.revision ?? '');
          if (revision === 'unavailable') {
            liveRevoked = true; liveFixes = {};
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
          }
          if (result.scope && result.scope !== scope) {
            liveRevoked = true; liveFixes = {};
            await invalidate('home:people');
            scope = result.scope;
          }
          const next = { ...liveFixes };
          for (const fix of result.positions ?? []) {
            if (!next[fix.subject] || Date.parse(next[fix.subject].at) < Date.parse(fix.position.at)) next[fix.subject] = fix.position;
          }
          liveFixes = next;
          liveRevoked = false;
        } catch {
          if (!stopped) await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    };
    void follow();
    document.addEventListener('visibilitychange', visibility);
    return () => { stopped = true; controller?.abort(); document.removeEventListener('visibilitychange', visibility); };
  });

  onMount(() => {
    clockNow = new Date();
    const tick = setInterval(() => (clockNow = new Date()), 30_000);
    let refreshing = false;
    const refresh = async () => {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        await invalidate('home:people');
      } catch {
        /* keep the last good read */
      } finally {
        refreshing = false;
      }
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(tick);
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  });

  // ── Filters ────────────────────────────────────────────────────────────
  const WINDOWS = [7, 28, 90] as const;
  const filterPeople = $derived(
    Object.keys(data.links).map((s) => ({ subject: s, label: nameOf(s) })),
  );
  function hrefFor(next: { person?: string | null; days?: number }): string {
    const q = new URLSearchParams();
    const person = next.person !== undefined ? next.person : data.person;
    const days = next.days ?? data.days;
    if (person) q.set('person', person);
    if (days !== 28) q.set('days', String(days));
    const s = q.toString();
    return `/home/people${s ? `?${s}` : ''}`;
  }

  // ── Headline ───────────────────────────────────────────────────────────
  const counts = $derived(nowCounts(members));
  const summary = $derived([
    { label: 'Home', value: String(counts.home), sub: `of ${counts.sharing} sharing` },
    { label: 'Out', value: String(counts.out), sub: 'recent location' },
    { label: 'Last known', value: String(counts.unknown), sub: 'older location' },
  ]);

  const routines = $derived(fc?.forecast.routines ?? []);
  const cleanRoutes = $derived(fc?.routes ?? []);
  const soonest = $derived(
    (fc?.forecast.next ?? [])
      .filter((n) => n.kind === 'routine' && +new Date(n.leaveAt) >= now.getTime() - 15 * 60_000)
      .sort((a, b) => +new Date(a.leaveAt) - +new Date(b.leaveAt))[0] ?? null,
  );
  const coverage = $derived.by(() => {
    const people = fc?.people ?? [];
    return people.length ? people.reduce((n, p) => n + p.coverage, 0) / people.length : null;
  });
  const kpis = $derived([
    {
      label: 'Next regular trip',
      value: soonest ? clock(soonest.leaveAt) : '—',
      sub: soonest ? `${nameOf(soonest.subject)} → ${soonest.to}` : fcState === 'pending' ? 'reading routines…' : 'nothing due today',
    },
    {
      label: 'On the way',
      value: String(fc?.forecast.arrivals.length ?? 0),
      sub: fc?.forecast.arrivals.length ? 'with an arrival window' : 'no journey matched now',
    },
    {
      label: 'Routines',
      value: String(routines.length),
      sub: `${cleanRoutes.length} routes · ${cleanRoutes.reduce((n, r) => n + r.samples - r.broken, 0)} trips`,
    },
    {
      label: 'Observed',
      value: coverage == null ? '—' : `${Math.round(coverage * 100)}%`,
      sub: `of the last ${data.days} days`,
      note: coverage != null && coverage < 0.6 ? 'thin — estimates held back' : null,
      tone: 'watch' as const,
    },
    ...(isOwner && naming
      ? [{
          label: 'Unnamed',
          value: String(naming.unnamed),
          sub: naming.queue.length ? `${hours(naming.queue.reduce((n, q) => n + q.minutes, 0))} in the top ${naming.queue.length}` : 'places',
          note: naming.queue.length ? 'name them below' : null,
        }]
      : []),
  ]);
</script>

<svelte:head><title>People — Strange Ramblings</title><meta name="robots" content="noindex" /></svelte:head>

<HomeFrame
  path="/home/people"
  kicker="Home · People"
  title={['Where everyone', 'is heading']}
  standfirst={isOwner
    ? 'Live locations, the routines learned from ninety days of trail, and what looks different today. Every estimate says what it stands on.'
    : 'Where everyone who shares their location is now, and where your own days usually take you.'}
  {summary}
  navBack={isOwner}
  footer={isOwner
    ? ['strangeramblings.com/home/people', 'Learned from the trail · Europe/London', 'Owner-gated · the whole household, never shared']
    : ['strangeramblings.com/home/people', 'The household · live status', 'Your routines are shown to you and the owner']}
>
  <PeopleNav active="now" owner={isOwner} />
  <PeopleFilterBar
    people={filterPeople}
    person={data.person}
    days={data.days}
    windows={WINDOWS}
    {hrefFor}
    checkedAt={clock(data.loadedAt)}
  />
  <KpiStrip cells={kpis} />

  {#if data.loadError}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The household did not load" message={data.loadError} /></div></section>
  {/if}

  <NowBoard
    {members}
    positions={mapPositions}
    {names}
    links={data.links}
    next={fc?.forecast.next ?? null}
    watch={fc?.forecast.watch ?? []}
    pending={fcState === 'pending'}
  />

  {#if fcState === 'failed'}
    <section class="band"><div class="inner"><LoadErrorCard kicker="The forecast did not load" message="Routines and estimates could not be read just now. Live locations above are unaffected; refresh to try again." /></div></section>
  {/if}

  <div class="desk">
    {#if isOwner}
      <section class="card" aria-labelledby="coming-h">
        <p class="kicker">Coming up</p>
        <h2 id="coming-h">The next two days, with leave-by times</h2>
        <p class="strap">Your calendar’s events with a location, timed from the journeys the family has actually made.</p>
        {#if agenda?.available}
          <ComingUp
            items={agenda.items}
            calendars={agenda.calendars}
            calendarMap={agenda.calendarMap}
            unlocated={agenda.unlocated}
            partial={agenda.partial}
            {names}
            person={data.person}
          />
        {:else if agenda && !agenda.available}
          <p class="strap">The calendar could not be read just now, so nothing here is planned. That is not the same as a free diary.</p>
        {:else}
          <p class="strap">{agendaState === 'failed' ? 'Unavailable just now.' : 'Reading the calendar…'}</p>
        {/if}
      </section>
    {/if}
    <section class="card" class:wide={!isOwner} aria-labelledby="watch-h">
      <p class="kicker">Watch</p>
      <h2 id="watch-h">What looks off</h2>
      <p class="strap">Compared with each person’s own routine for this weekday and hour.</p>
      <WatchList items={fc?.forecast.watch ?? []} pending={fcState === 'pending'}>
        {#snippet notify()}
          {#if data.notify}<NotifySwitches settings={data.notify.settings} labels={data.notify.labels} />{/if}
        {/snippet}
      </WatchList>
    </section>
    <section class="card wide" aria-labelledby="routes-h">
      <p class="kicker">Routines</p>
      <h2 id="routes-h">Learned routes: every trip, the usual time, the spread</h2>
      <p class="strap">One dot per trip; the band holds four trips in five, the tick is the median. Hollow dots missed their arrival and are not counted. Select a route to see how the time of leaving changes the journey.</p>
      {#if fc}
        <RoutineStrips routes={fc.routes} routines={fc.forecast.routines} />
      {:else}
        <p class="strap">{fcState === 'failed' ? 'Unavailable.' : 'Reading…'}</p>
      {/if}
    </section>

    <section class="card" class:wide={!isOwner} aria-labelledby="pattern-h">
      <p class="kicker">Patterns</p>
      <h2 id="pattern-h">When the house empties</h2>
      <p class="strap">Departures from home in the last {data.days} days.</p>
      {#if fc}<DepartureHeat grid={fc.forecast.departures} />{:else}<p class="strap">Reading…</p>{/if}
    </section>

    {#if isOwner}
      <section class="card" aria-labelledby="name-h">
        <div class="card-head">
          <div>
            <p class="kicker">Places</p>
            <h2 id="name-h">Name the places that matter</h2>
          </div>
          <a class="card-link" href="/home/people/places">Edit shapes on the map →</a>
        </div>
        <p class="strap">A named place joins routes, forecasts and alerts. Most-lived-in first.</p>
        {#if naming}
          <NamingQueue queue={naming.queue} unnamed={naming.unnamed} {names} />
        {:else}
          <p class="strap">Reading…</p>
        {/if}
      </section>
    {/if}
  </div>

  <PeopleMovement movement={data.movement} person={data.person} ownSubject={data.ownSubject} days={data.movementDays} />
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
  .strap {
    margin: 0 0 14px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
    max-width: 75ch;
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: end;
    gap: 8px 16px;
  }
  .card-link {
    font: 600 var(--fs-label) var(--font-mono);
    color: var(--accent-ink);
  }
</style>
