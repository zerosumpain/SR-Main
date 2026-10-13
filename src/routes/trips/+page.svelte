<script lang="ts">
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import TitleBlock from '$lib/components/admin/PageHeader.svelte';
  import { dayLabel } from '$lib/trips/changes';
  import { TRAVEL_MODES, type Pace, type TravelMode } from '$lib/trips/model';

  let { data } = $props();

  // New-trip form. Walk is always on; the zone defaults to the browser's own
  // until a destination suggests otherwise (the person can type any IANA zone).
  let destination = $state('');
  let title = $state('');
  let startDate = $state('');
  let endDate = $state('');
  let timeZone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London');
  let pace = $state<Pace>('normal');
  let modes = $state<TravelMode[]>(['walk', 'transit']);
  let busy = $state(false);
  let message = $state<string | null>(null);

  function toggleMode(m: TravelMode) {
    if (m === 'walk') return;
    modes = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    message = null;
    try {
      const res = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ destination, title: title || undefined, startDate, endDate, timeZone, pace, modes }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        message = body.error ?? body.message ?? 'Could not create the trip.';
        return;
      }
      await goto(`/trips/${body.id}`);
    } finally {
      busy = false;
    }
  }

  const STATUS: Record<string, string> = { draft: 'Draft', planned: 'Planned', active: 'Under way', done: 'Done' };
</script>

<svelte:head><title>Trips</title></svelte:head>

<PageHeader title="Trips" />

<PageWrap>
  <TitleBlock
    kicker="Planner"
    title="Trips"
    sub="Say what you want to do; the planner researches each place, lists what to book and when, and solves the days. Edits change the wishes, never the schedule by hand."
  />

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Your trips</span>
      <span class="nm-sec-meta">{data.trips.length} {data.trips.length === 1 ? 'trip' : 'trips'}</span>
    </div>
    {#if data.trips.length === 0}
      <p class="empty">No trips yet. Start one below.</p>
    {:else}
      <ul class="trips">
        {#each data.trips as t (t.id)}
          <li>
            <a href="/trips/{t.id}" class="trip-link">
              <span class="t-title">{t.title}</span>
              <span class="t-meta">{t.destination} · {dayLabel(t.startDate)} – {dayLabel(t.endDate)}</span>
            </a>
            <span class="chip">{STATUS[t.status] ?? t.status}</span>
            <span class="t-ver">{t.planVersion ? `plan v${t.planVersion}` : 'no plan yet'}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">New trip</span></div>
    <form class="grid" onsubmit={create}>
      <label>Destination<input class="nm-text-input" bind:value={destination} required placeholder="Rome, Italy" /></label>
      <label>Name <span class="opt">(optional)</span><input class="nm-text-input" bind:value={title} placeholder="Rome in October" /></label>
      <label>First day<input class="nm-text-input" type="date" bind:value={startDate} required /></label>
      <label>Last day<input class="nm-text-input" type="date" bind:value={endDate} required /></label>
      <label>Time zone<input class="nm-text-input" bind:value={timeZone} required placeholder="Europe/Rome" /></label>
      <label
        >Pace
        <select class="nm-text-input" bind:value={pace}>
          <option value="relaxed">Relaxed — 9:30 to 18:30</option>
          <option value="normal">Normal — 9:00 to 19:00</option>
          <option value="packed">Packed — 8:00 to 21:00, with dinner</option>
        </select>
      </label>
      <fieldset class="modes">
        <legend>Getting about</legend>
        {#each TRAVEL_MODES as m (m)}
          <label class="check">
            <input type="checkbox" checked={modes.includes(m)} disabled={m === 'walk'} onchange={() => toggleMode(m)} />
            {m === 'transit' ? 'public transport' : m}
          </label>
        {/each}
      </fieldset>
      <div class="actions">
        <button class="nm-save-btn" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create trip'}</button>
        {#if message}<span class="error" role="alert">{message}</span>{/if}
      </div>
    </form>
  </section>
</PageWrap>

<style>
  .empty {
    color: var(--text-muted);
    margin: 0;
  }
  .trips {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .trips li {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 10px 0;
    border-top: 1px solid var(--line-hair);
  }
  .trips li:first-child {
    border-top: 0;
  }
  .trip-link {
    flex: 1;
    min-width: 0;
    color: var(--text-primary);
    text-decoration: none;
    display: flex;
    flex-direction: column;
  }
  .trip-link:hover .t-title {
    color: var(--accent-ink);
    text-decoration: underline;
  }
  .t-title {
    font-family: var(--font-display);
    font-size: 1.15rem;
  }
  .t-meta,
  .t-ver {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    padding: 1px 8px;
    color: var(--text-secondary);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
    gap: 12px 16px;
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .opt {
    text-transform: none;
    color: var(--text-ghost);
  }
  .modes {
    border: 0;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 14px;
    align-items: center;
  }
  .modes legend {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 4px;
  }
  .grid .check {
    flex-direction: row;
    align-items: center;
    text-transform: none;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .actions {
    grid-column: 1 / -1;
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .error {
    color: var(--error);
    font-size: var(--fs-label);
  }
</style>
