<script lang="ts">
  /**
   * The trip studio's Details drawer (v4): the constraints the conversation
   * set, as forms you can still edit directly — the trip, its stays, the
   * wishes with their researched facts, suggestions, the city guide and what
   * the phone reported. Every edit goes through the page's `call`, which
   * re-plans and logs the edit in the conversation.
   *
   * Written on the notebook's paper like the rest of /trips: each part is a
   * heading and a line of marginalia, not a box. The places read as a list
   * — what each one is set to, said in a few chips — and a place's full
   * form and researched facts open only when you choose "Edit".
   */
  import { invalidateAll } from '$app/navigation';
  import { dayLabel } from '$lib/trips/changes';
  import { TRAVEL_MODES, type LatLng, type TravelMode, type TripEvent, type TripGuide, type Stay, type Wish } from '$lib/trips/model';
  import type { TripRecord } from '$lib/trips/store.server';

  let {
    trip,
    stays,
    wishes,
    guide,
    events,
    dates,
    busy,
    call,
    base,
    hasPlan,
  }: {
    trip: TripRecord;
    stays: Stay[];
    wishes: Wish[];
    guide: TripGuide | null;
    events: Array<TripEvent & { receivedAt: string }>;
    dates: string[];
    busy: boolean;
    call: (method: string, url: string, body?: unknown, done?: string) => Promise<Record<string, unknown> | null>;
    base: string;
    hasPlan: boolean;
  } = $props();

  let problem = $state<string | null>(null);
  const hhmm = (min: number | null | undefined) =>
    min === null || min === undefined ? '' : `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
  const toMin = (v: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const checked = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');
  const MODE_LABEL: Record<TravelMode, string> = { walk: 'walk', cycle: 'cycle', drive: 'drive', transit: 'public transport', taxi: 'taxi' };
  const titleOf = $derived(Object.fromEntries(wishes.map((w) => [w.id, w.title])));
  const data = $derived({ trip, stays, wishes, guide, events });

  // ── Intake ──
  let intake = $state({ destination: '', title: '', startDate: '', endDate: '', timeZone: '', pace: 'normal', modes: [] as TravelMode[], notes: '', dayLoads: {} as Record<string, string> });
  $effect(() => {
    // Reset the form whenever a fresh trip arrives from the server.
    const t = data.trip;
    intake = {
      destination: t.destination,
      title: t.title,
      startDate: t.startDate,
      endDate: t.endDate,
      timeZone: t.timeZone,
      pace: t.pace,
      modes: [...t.modes],
      notes: t.notes ?? '',
      dayLoads: { ...(t.dayLoads ?? {}) } as Record<string, string>,
    };
  });
  function toggleMode(m: TravelMode) {
    if (m === 'walk') return;
    intake.modes = intake.modes.includes(m) ? intake.modes.filter((x) => x !== m) : [...intake.modes, m];
  }
  async function saveIntake(e: SubmitEvent) {
    e.preventDefault();
    await call('PATCH', base, { ...intake, notes: intake.notes || null }, 'Trip saved.');
  }

  // ── Stays ──
  let stay = $state({ name: '', query: '', nights: 1, fromDate: '', checkIn: '15:00', checkOut: '10:00' });
  let stayPlace = $state<{ name: string; address: string | null; location: LatLng } | null>(null);
  let stayLookup = $state<string | null>(null);
  async function findStay() {
    stayLookup = 'Looking…';
    stayPlace = null;
    const res = await fetch(`/api/trips/places?q=${encodeURIComponent(`${stay.query || stay.name}, ${trip.destination}`)}`);
    const body = await res.json().catch(() => ({}));
    stayPlace = body.place ?? null;
    stayLookup = stayPlace ? null : (body.error ?? 'Not found on OpenStreetMap — try the street address.');
  }
  async function addStay(e: SubmitEvent) {
    e.preventDefault();
    if (!stayPlace) {
      problem = 'Find the stay on the map first.';
      return;
    }
    const ok = await call(
      'POST',
      `${base}/stays`,
      {
        name: stay.name || stayPlace.name,
        address: stayPlace.address,
        location: stayPlace.location,
        fromDate: stay.fromDate || trip.startDate,
        nights: stay.nights,
        checkInMin: toMin(stay.checkIn),
        checkOutMin: toMin(stay.checkOut),
      },
      'Stay added.',
    );
    if (ok) {
      stay = { name: '', query: '', nights: 1, fromDate: '', checkIn: '15:00', checkOut: '10:00' };
      stayPlace = null;
    }
  }

  let quickWish = $state('');
  async function addOne(e: SubmitEvent) {
    e.preventDefault();
    if (await call('POST', `${base}/wishes`, { title: quickWish }, 'Wish added.')) quickWish = '';
  }

  // ── Wishes ──
  const active = $derived(data.wishes.filter((w) => !w.suggested));
  const suggestions = $derived(data.wishes.filter((w) => w.suggested));
  const patchWish = (w: Wish, patch: Record<string, unknown>, done = 'Saved.') => call('PATCH', `${base}/wishes/${w.id}`, patch, done);
  async function move(w: Wish, delta: -1 | 1) {
    const ids = active.map((x) => x.id);
    const i = ids.indexOf(w.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await call('POST', `${base}/wishes/order`, { ids }, 'Order saved.');
  }
  let placeQuery = $state<Record<string, string>>({});
  async function findWishPlace(w: Wish) {
    const q = placeQuery[w.id] || w.title;
    const near = data.stays[0]?.location;
    const res = await fetch(`/api/trips/places?q=${encodeURIComponent(`${q}, ${trip.destination}`)}${near ? `&lat=${near.lat}&lng=${near.lng}` : ''}`);
    const body = await res.json().catch(() => ({}));
    if (!body.place) {
      problem = body.error ?? `“${q}” was not found on OpenStreetMap.`;
      return;
    }
    await patchWish(w, { place: body.place }, `Placed at ${body.place.name}.`);
  }

  // ── Research progress (polled while a scan runs) ──
  const research = $derived(data.trip.research);
  const scanning = $derived(research?.state === 'running');
  $effect(() => {
    if (!scanning) return;
    const timer = setInterval(async () => {
      const res = await fetch(`${base}/research`).catch(() => null);
      const body = await res?.json().catch(() => null);
      const r = body?.research;
      if (!r || r.state !== 'running' || r.done !== research?.done) await invalidateAll();
    }, 2500);
    return () => clearInterval(timer);
  });
  const unresearched = $derived(active.filter((w) => !w.skipped && !w.facts).length);


  /** Places whose full form is open. */
  let editing = $state<Set<string>>(new Set());
  function toggleEdit(id: string) {
    const next = new Set(editing);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    editing = next;
  }
  const PART: Record<string, string> = { morning: 'mornings', afternoon: 'afternoons', evening: 'evenings' };
  const nights = (s: Stay) => Math.round((Date.parse(s.toDate) - Date.parse(s.fromDate)) / 86_400_000);
</script>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}

<!-- ── The trip ── -->
<details class="part" open={!hasPlan}>
  <summary><span class="part-h">The trip</span> <span class="part-sub">destination, dates, pace, how you get about, how full each day is</span></summary>
  <form class="grid" onsubmit={saveIntake}>
    <label>Destination<input class="field" bind:value={intake.destination} required /></label>
    <label>Name<input class="field" bind:value={intake.title} /></label>
    <label>First day<input class="field" type="date" bind:value={intake.startDate} required /></label>
    <label>Last day<input class="field" type="date" bind:value={intake.endDate} required /></label>
    <label>Time zone<input class="field" bind:value={intake.timeZone} required /></label>
    <label
      >Pace<select class="field" bind:value={intake.pace}>
        <option value="relaxed">Relaxed</option><option value="normal">Normal</option><option value="packed">Packed</option>
      </select></label
    >
    <fieldset class="modes wide">
      <legend>Getting about</legend>
      {#each TRAVEL_MODES as m (m)}
        <label class="check"><input type="checkbox" checked={intake.modes.includes(m)} disabled={m === 'walk'} onchange={() => toggleMode(m)} /> {MODE_LABEL[m]}</label>
      {/each}
    </fieldset>
    <fieldset class="modes wide">
      <legend>How full each day is</legend>
      {#each dates as d (d)}
        <label class="check day-load"
          >{dayLabel(d)}
          <select class="field small" value={intake.dayLoads[d] ?? 'normal'} onchange={(e) => (intake.dayLoads = { ...intake.dayLoads, [d]: e.currentTarget.value })}>
            <option value="light">light</option><option value="normal">normal</option><option value="full">full</option>
          </select></label
        >
      {/each}
    </fieldset>
    <label class="wide">Notes<textarea class="field" rows="2" bind:value={intake.notes}></textarea></label>
    <div class="acts wide"><button class="pen-btn" type="submit" disabled={busy}>Save the trip</button></div>
  </form>
</details>

<!-- ── Stays ── -->
<section class="part">
  <h3 class="part-h">Where you stay</h3>
  <p class="part-sub">Each day starts and ends here.</p>
  {#if data.stays.length}
    <ul class="stays" role="list">
      {#each data.stays as s (s.id)}
        <li class="stay np-card np-card--plain">
          <span class="stay-name">{s.name}</span>
          <span class="stay-when">{dayLabel(s.fromDate)} · {nights(s)} {nights(s) === 1 ? 'night' : 'nights'}{s.checkInMin !== null ? ` · in ${hhmm(s.checkInMin)}` : ''}{s.checkOutMin !== null ? ` · out ${hhmm(s.checkOutMin)}` : ''}</span>
          {#if s.address}<span class="stay-addr">{s.address}</span>{/if}
          <button class="pen-link danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/stays/${s.id}`, undefined, 'Stay removed.')}>Remove</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="aside">No stay yet — the planner needs one to start and end each day.</p>
  {/if}
  <details class="add" open={!data.stays.length}>
    <summary>+ Add a stay</summary>
    <form class="grid" onsubmit={addStay}>
      <label>Name<input class="field" bind:value={stay.name} placeholder="Hotel or flat" /></label>
      <label
        >Address or search
        <span class="inline"><input class="field" bind:value={stay.query} placeholder="Via dei Cappellari 10" /><button class="pen-link" type="button" onclick={findStay}>Find</button></span>
      </label>
      <label>First night<select class="field" bind:value={stay.fromDate}>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}</select></label>
      <label>Nights<input class="field" type="number" min="1" max="31" bind:value={stay.nights} /></label>
      <label>Check in<input class="field" bind:value={stay.checkIn} placeholder="15:00" /></label>
      <label>Check out<input class="field" bind:value={stay.checkOut} placeholder="10:00" /></label>
      <div class="acts wide">
        {#if stayPlace}<span class="aside">Found: {stayPlace.address ?? stayPlace.name}</span>{:else if stayLookup}<span class="aside">{stayLookup}</span>{/if}
        <button class="pen-btn" type="submit" disabled={busy || !stayPlace}>Add the stay</button>
      </div>
    </form>
  </details>
</section>

<!-- ── Places (wishes) ── -->
<section class="part">
  <div class="part-row">
    <div>
      <h3 class="part-h">Places you want to go</h3>
      <p class="part-sub">{active.length} {active.length === 1 ? 'place' : 'places'}{unresearched ? ` · ${unresearched} not looked up yet` : ' · all looked up'}. Order is a tie-breaker, not a schedule.</p>
    </div>
    <button class="pen-link" type="button" disabled={busy || scanning || unresearched === 0} onclick={() => call('POST', `${base}/research`, {}, 'Research started.')}>Look up all ({unresearched})</button>
  </div>
  {#if research}
    <p class="progress" role="status" aria-live="polite">
      {#if research.state === 'running'}
        <span class="bar"><span class="fill" style="width: {research.total ? Math.round((research.done / research.total) * 100) : 0}%"></span></span>
        Looking up {research.done + 1} of {research.total}{research.current ? ` — ${research.current}` : ''}…
      {:else if research.state === 'done'}
        Last look-up {research.depth === 'deep' ? '(deeper)' : '(brief)'} finished {checked(research.finishedAt)}{research.note ? ` · ${research.note}` : ''}
      {:else}
        {research.note ?? 'The last look-up failed.'}
      {/if}
    </p>
  {/if}
  <form class="add-one" onsubmit={addOne}>
    <label class="vh" for="add-place">Add a place</label>
    <input id="add-place" class="field" bind:value={quickWish} placeholder="Add a place — “Galleria Borghese”, “a market on Saturday morning”" />
    <button class="pen-btn small" type="submit" disabled={busy || !quickWish.trim()}>Add</button>
  </form>
  {#if active.length === 0}
    <p class="aside">No places yet. Add one above, or tell the planner what you’d like to do.</p>
  {/if}
  <ol class="wishes">
    {#each active as w, i (w.id)}
      <li class="wish" class:skipped={w.skipped} class:open={editing.has(w.id)}>
        <div class="wish-row">
          <span class="order">
            <button type="button" aria-label="Move {w.title} up" disabled={busy || i === 0} onclick={() => move(w, -1)}>↑</button>
            <button type="button" aria-label="Move {w.title} down" disabled={busy || i === active.length - 1} onclick={() => move(w, 1)}>↓</button>
          </span>
          <span class="w-main">
            <span class="w-title">{w.title}</span>
            <span class="w-place">
              {#if w.place}{w.place.name !== w.title ? w.place.name : ''}{w.place.address ? `${w.place.name !== w.title ? ' — ' : ''}${w.place.address.split(',').slice(0, 2).join(',')}` : ''}{:else}<span class="needs">needs a place</span>{/if}
            </span>
            <span class="chips">
              <span class="chip" class:must={w.priority === 'must'}>{w.priority === 'must' ? 'must' : 'nice to have'}</span>
              {#if w.durationSec}<span class="chip">{Math.round(w.durationSec / 60)} min</span>{:else if w.facts?.typicalVisitSec}<span class="chip ghost">~{Math.round(w.facts.typicalVisitSec / 60)} min</span>{/if}
              {#if w.partOfDay !== 'any'}<span class="chip">{PART[w.partOfDay] ?? w.partOfDay}</span>{/if}
              {#if w.fixedDate}<span class="chip">{dayLabel(w.fixedDate)}{w.fixedStartMin !== null ? ` ${hhmm(w.fixedStartMin)}` : ''}</span>{/if}
              {#if w.replacesMeal}<span class="chip">is {w.replacesMeal}</span>{/if}
              {#if w.locked}<span class="chip">locked</span>{/if}
              {#if w.skipped}<span class="chip">skipped</span>{/if}
              <span class="chip ghost">{!w.facts ? 'not looked up' : w.facts.checkedAt ? `looked up ${checked(w.facts.checkedAt)}` : 'facts added by hand'}</span>
            </span>
          </span>
          <button class="pen-link" type="button" aria-expanded={editing.has(w.id)} onclick={() => toggleEdit(w.id)}>{editing.has(w.id) ? 'Done' : 'Edit'}</button>
        </div>
        {#if editing.has(w.id)}
          <div class="w-open">
            {#if !w.place}
              <p class="w-find">
                Research finds a place, or set one:
                <input class="field small" placeholder="search name" aria-label="Search for {w.title}" bind:value={placeQuery[w.id]} />
                <button class="pen-link" type="button" disabled={busy} onclick={() => findWishPlace(w)}>Set place</button>
              </p>
            {/if}
            <div class="w-edit">
              <label>Priority<select class="field small" value={w.priority} onchange={(e) => patchWish(w, { priority: e.currentTarget.value })}><option value="must">must</option><option value="nice">nice</option></select></label>
              <label>Minutes<input class="field small" type="number" min="5" max="720" value={w.durationSec ? Math.round(w.durationSec / 60) : ''} placeholder={w.facts?.typicalVisitSec ? String(Math.round(w.facts.typicalVisitSec / 60)) : '60'} onchange={(e) => patchWish(w, { durationMin: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} /></label>
              <label>Part of day<select class="field small" value={w.partOfDay} onchange={(e) => patchWish(w, { partOfDay: e.currentTarget.value })}><option value="any">any</option><option value="morning">morning</option><option value="afternoon">afternoon</option><option value="evening">evening</option></select></label>
              <label>Day<select class="field small" value={w.fixedDate ?? ''} onchange={(e) => patchWish(w, { fixedDate: e.currentTarget.value || null })}><option value="">any day</option>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}</select></label>
              <label>Is the meal<select class="field small" value={w.replacesMeal ?? ''} onchange={(e) => patchWish(w, { replacesMeal: e.currentTarget.value || null })}><option value="">no</option><option value="lunch">lunch</option><option value="dinner">dinner</option></select></label>
              <label>Fixed time<input class="field small" value={hhmm(w.fixedStartMin)} placeholder="hh:mm" onchange={(e) => patchWish(w, { fixedStartMin: e.currentTarget.value.trim() || null })} /></label>
              <label class="check"><input type="checkbox" checked={w.locked} onchange={(e) => patchWish(w, { locked: e.currentTarget.checked })} /> lock</label>
              <label class="check"><input type="checkbox" checked={w.skipped} onchange={(e) => patchWish(w, { skipped: e.currentTarget.checked })} /> skip</label>
            </div>
            {#if w.facts}
              <div class="facts np-card np-card--plain">
                <p class="facts-h">{w.facts.checkedAt ? 'What research found' : 'Facts added by hand'} <span class="aside">{w.facts.checkedAt ? `· ${w.facts.depth === 'deep' ? 'a deeper look' : 'a brief look'}, ${checked(w.facts.checkedAt)}` : ''}{w.facts.unknown.length ? ` · ${w.facts.unknown.length} not found` : ''}</span></p>
                {#if w.facts.summary}<p>{w.facts.summary}</p>{/if}
                <dl>
                  <dt>Opening hours</dt><dd>{w.facts.openingHoursText ?? (w.facts.hours ? 'from the web — see the sources' : 'unknown')}</dd>
                  <dt>Booking</dt><dd>{w.facts.bookingRequired === null ? 'unknown' : w.facts.bookingRequired ? 'required' : 'not needed'}{w.facts.bookAheadDays !== null ? ` · book ${w.facts.bookAheadDays} days ahead` : ''}</dd>
                  <dt>Price</dt><dd>{w.facts.priceText ?? 'unknown'}</dd>
                  <dt>Typical visit</dt><dd>{w.facts.typicalVisitSec ? `${Math.round(w.facts.typicalVisitSec / 60)} min` : 'unknown'}</dd>
                  <dt>Official</dt><dd>{#if w.facts.officialUrl}<a href={w.facts.officialUrl} target="_blank" rel="noopener noreferrer">{new URL(w.facts.officialUrl).hostname}</a>{:else}unknown{/if}{#if w.facts.bookingUrl} · <a href={w.facts.bookingUrl} target="_blank" rel="noopener noreferrer">official tickets</a>{/if}</dd>
                </dl>
                {#if w.facts.unknown.length}<p class="aside">Not found: {w.facts.unknown.join(', ')}.</p>{/if}
                {#if w.facts.sources.length}
                  <p class="sources">Sources: {#each w.facts.sources as s, si (s.url)}{si ? ' · ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? new URL(s.url).hostname}</a>{/each}</p>
                {/if}
                <button class="pen-link" type="button" disabled={busy || scanning} onclick={() => call('POST', `${base}/research`, { wishId: w.id }, 'Looking deeper.')}>Look deeper</button>
              </div>
            {/if}
            <button class="pen-link danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/wishes/${w.id}`, undefined, 'Wish removed.')}>Remove {w.title}</button>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</section>

{#if suggestions.length}
  <section class="part">
    <h3 class="part-h">Suggestions nearby</h3>
    <p class="part-sub">Never planned until you accept one.</p>
    <ul class="suggest" role="list">
      {#each suggestions as w, i (w.id)}
        <li class="np-sticky" style:--np-tilt="{i % 2 ? 1.4 : -1.6}deg">
          <strong>{w.title}</strong>
          {#if w.note}<p>{w.note}</p>{/if}
          {#if w.facts?.officialUrl}<a href={w.facts.officialUrl} target="_blank" rel="noopener noreferrer">website ↗</a>{/if}
          <span class="s-acts">
            <button class="pen-btn small" type="button" disabled={busy} onclick={() => patchWish(w, { suggested: false }, 'Suggestion accepted.')}>Accept</button>
            <button class="pen-link danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/wishes/${w.id}`, undefined, 'Suggestion rejected.')}>Reject</button>
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if data.guide}
  <details class="part">
    <summary><span class="part-h">Getting around {trip.destination.split(',')[0]}</span> <span class="part-sub">written {checked(data.guide.generatedAt)}</span></summary>
    <div class="guide">
      <p>{data.guide.gettingAround}</p>
      {#if data.guide.transitTickets}<p><strong>Tickets:</strong> {data.guide.transitTickets}</p>{/if}
      {#if data.guide.taxi}
        <p><strong>Taxis:</strong> {data.guide.taxi.how}</p>
        {#if data.guide.taxi.links.length}<p class="links">{#each data.guide.taxi.links as l, li (l.url)}{li ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>{/each}</p>{/if}
      {/if}
      {#if data.guide.tips.length}<ul>{#each data.guide.tips as t, ti (ti)}<li>{t}</li>{/each}</ul>{/if}
    </div>
  </details>
{/if}

{#if data.events.length}
  <details class="part">
    <summary><span class="part-h">From the phone</span> <span class="part-sub">the latest {data.events.length} things the phone reported</span></summary>
    <ul class="events" role="list">
      {#each data.events as e (e.clientId)}
        <li><span class="ev-at">{new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> {e.kind}{e.wishId && titleOf[e.wishId] ? ` · ${titleOf[e.wishId]}` : ''}</li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .warn {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--warn);
  }
  /* Each part: a heading and its marginalia, ruled off from the next. */
  .part {
    padding: 18px 0 20px;
    border-top: 1px dashed var(--line-strong);
  }
  .part:first-of-type {
    border-top: 0;
  }
  details.part > summary {
    cursor: pointer;
  }
  .part-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    letter-spacing: -0.02em;
    color: var(--np-ink, var(--text-primary));
  }
  .part-sub,
  .aside {
    margin: 2px 0 0;
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .part-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 8px 16px;
  }

  /* Pens */
  .pen-btn {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    padding: 8px 14px;
    border: 0;
    border-radius: 2px;
    background: var(--accent);
    color: var(--text-on-accent, #fff);
    cursor: pointer;
  }
  .pen-btn.small {
    padding: 4px 10px;
    font-size: 13px;
  }
  .pen-btn:hover:not(:disabled),
  .pen-btn:focus-visible {
    background: var(--accent-hover);
    outline: none;
  }
  .pen-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .pen-link {
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    white-space: nowrap;
  }
  .pen-link:disabled {
    color: var(--text-ghost);
    text-decoration: none;
    cursor: default;
  }
  .pen-link.danger {
    color: var(--error);
  }
  .field {
    font-family: var(--font-body);
    font-size: 15px;
    letter-spacing: 0;
    text-transform: none;
    padding: 5px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--np-ink, var(--text-primary));
    min-width: 0;
  }
  .field.small {
    font-size: var(--fs-label);
    padding: 3px 2px;
  }
  .field:focus {
    outline: none;
    border-bottom: 2px solid var(--accent-ink);
  }
  textarea.field {
    resize: vertical;
    background: repeating-linear-gradient(to bottom, transparent 0 23px, var(--np-rule, rgba(14, 91, 102, 0.16)) 23px 24px);
    line-height: 24px;
  }

  /* Forms */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    gap: 14px 18px;
    margin-top: 14px;
  }
  .grid label,
  .w-edit label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--np-pen-ink, var(--accent-ink));
  }
  .grid .wide {
    grid-column: 1 / -1;
  }
  label.check {
    flex-direction: row !important;
    align-items: center;
    gap: 6px !important;
    text-transform: none !important;
    letter-spacing: 0 !important;
    font-family: var(--font-body) !important;
    font-size: var(--fs-label) !important;
    color: var(--np-ink, var(--text-primary)) !important;
  }
  .day-load .field {
    margin-left: 4px;
  }
  .modes {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
  }
  .modes legend {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--np-pen-ink, var(--accent-ink));
    margin-bottom: 6px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
  }
  .inline {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .inline .field {
    flex: 1;
  }
  .add {
    margin-top: 12px;
  }
  .add > summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }

  /* Stays */
  .stays {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
    gap: 12px;
  }
  .stay {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px !important;
  }
  .stay-name {
    font-weight: 700;
  }
  .stay-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .stay-addr {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .stay .pen-link {
    align-self: flex-start;
    margin-top: 6px;
  }

  /* Places */
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .bar {
    width: 120px;
    height: 6px;
    border: 1px solid var(--line-strong);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .add-one {
    display: flex;
    gap: 10px;
    align-items: flex-end;
    margin: 14px 0 6px;
    max-width: 720px;
  }
  .add-one .field {
    flex: 1;
  }
  .add-one .field::placeholder {
    font-family: var(--fs-serif);
    font-style: italic;
  }
  .wishes {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    counter-reset: wish;
  }
  .wish {
    counter-increment: wish;
    border-top: 1px solid var(--np-rule, var(--line-hair));
  }
  .wish:first-child {
    border-top: 0;
  }
  .wish.skipped .w-title {
    text-decoration: line-through;
    color: var(--text-muted);
  }
  .wish.open {
    background: var(--np-card, var(--surface-card));
    box-shadow: inset 3px 0 0 var(--accent-ink);
  }
  .wish-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    padding: 10px 8px;
  }
  .order {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .order button {
    padding: 0 4px;
    border: 0;
    background: none;
    color: var(--accent-ink);
    font-size: 14px;
    line-height: 16px;
    cursor: pointer;
  }
  .order button:disabled {
    color: var(--text-ghost);
    cursor: default;
  }
  .w-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .w-title {
    font-weight: 700;
  }
  .w-title::before {
    content: counter(wish) '. ';
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: var(--fs-label-xs);
    color: var(--np-pen-text, var(--accent-hover));
  }
  .w-place {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-label);
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .needs {
    color: var(--warn);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 6px;
    margin-top: 4px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 0 8px;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    color: var(--np-ink-soft, var(--text-secondary));
  }
  .chip.must {
    border-color: var(--accent);
    color: var(--accent-hover);
  }
  .chip.ghost {
    border-style: dashed;
    color: var(--text-muted);
  }
  .w-open {
    display: grid;
    gap: 12px;
    padding: 2px 12px 16px 40px;
  }
  .w-open > .pen-link {
    justify-self: start;
  }
  .w-find {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
    font-family: var(--fs-serif);
    font-style: italic;
  }
  .w-edit {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 16px;
  }
  .facts {
    padding: 12px 14px !important;
    font-size: var(--fs-label);
  }
  .facts p {
    margin: 4px 0;
  }
  .facts-h {
    font-weight: 700;
  }
  .facts dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 14px;
    margin: 6px 0;
  }
  .facts dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--np-pen-ink, var(--accent-ink));
  }
  .facts dd {
    margin: 0;
  }
  .facts a,
  .sources a,
  .guide a,
  .suggest a {
    color: var(--accent-ink);
  }
  .sources {
    font-size: var(--fs-label-xs);
  }

  /* Suggestions: sticky notes */
  .suggest {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    gap: 18px;
  }
  .suggest p {
    margin: 4px 0;
    font-size: var(--fs-label);
  }
  .suggest a {
    color: #0e5b66;
  }
  .s-acts {
    display: flex;
    gap: 12px;
    align-items: center;
    margin-top: 8px;
  }

  .guide {
    margin-top: 10px;
    max-width: 72ch;
  }
  .guide ul {
    padding-left: 18px;
  }
  .events {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    font-size: var(--fs-label);
  }
  .events li {
    padding: 2px 0;
  }
  .ev-at {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft, var(--text-secondary));
    margin-right: 6px;
  }
  @media (max-width: 640px) {
    .w-open {
      padding-left: 12px;
    }
    .wish-row {
      gap: 8px;
      padding: 10px 2px;
    }
    .add-one {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
