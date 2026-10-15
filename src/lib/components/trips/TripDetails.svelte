<script lang="ts">
  /**
   * The trip studio's Details drawer (v4): the constraints the conversation
   * set, as forms you can still edit directly — the trip, its stays, the
   * wishes with their researched facts, suggestions, the city guide and what
   * the phone reported. Every edit goes through the page's `call`, which
   * re-plans and logs the edit in the conversation.
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

</script>

{#if problem}<p class="warn" role="alert">{problem}</p>{/if}
  <!-- ── Intake ─────────────────────────────────────────── -->
  <details class="nm-sec" open={!hasPlan}>
<summary class="nm-sec-hd"><span class="sr-label-tight">The trip</span><span class="nm-sec-meta">destination, dates, pace, how you get about</span></summary>
<form class="grid" onsubmit={saveIntake}>
  <label>Destination<input class="nm-text-input" bind:value={intake.destination} required /></label>
  <label>Name<input class="nm-text-input" bind:value={intake.title} /></label>
  <label>First day<input class="nm-text-input" type="date" bind:value={intake.startDate} required /></label>
  <label>Last day<input class="nm-text-input" type="date" bind:value={intake.endDate} required /></label>
  <label>Time zone<input class="nm-text-input" bind:value={intake.timeZone} required /></label>
  <label
    >Pace<select class="nm-text-input" bind:value={intake.pace}>
      <option value="relaxed">Relaxed</option><option value="normal">Normal</option><option value="packed">Packed</option>
    </select></label
  >
  <fieldset class="modes">
    <legend>Getting about</legend>
    {#each TRAVEL_MODES as m (m)}
      <label class="check"><input type="checkbox" checked={intake.modes.includes(m)} disabled={m === 'walk'} onchange={() => toggleMode(m)} /> {MODE_LABEL[m]}</label>
    {/each}
  </fieldset>
  <fieldset class="modes wide">
    <legend>How full each day is</legend>
    {#each dates as d (d)}
      <label class="check"
        >{dayLabel(d)}
        <select class="nm-text-input small" value={intake.dayLoads[d] ?? 'normal'} onchange={(e) => (intake.dayLoads = { ...intake.dayLoads, [d]: e.currentTarget.value })}>
          <option value="light">light</option><option value="normal">normal</option><option value="full">full</option>
        </select></label
      >
    {/each}
  </fieldset>
  <label class="wide">Notes<textarea class="nm-text-input" rows="2" bind:value={intake.notes}></textarea></label>
  <div class="row-actions wide"><button class="nm-save-btn" type="submit" disabled={busy}>Save trip</button></div>
</form>
  </details>
  <!-- ── Stays ──────────────────────────────────────────── -->
  <section class="nm-sec">
<div class="nm-sec-hd"><span class="sr-label-tight">Where you stay</span><span class="nm-sec-meta">each day starts and ends here</span></div>
{#if data.stays.length}
  <ul class="plain">
    {#each data.stays as s (s.id)}
      <li class="line">
        <span><strong>{s.name}</strong> · {dayLabel(s.fromDate)} for {Math.round((Date.parse(s.toDate) - Date.parse(s.fromDate)) / 86_400_000)} nights{s.checkInMin !== null ? ` · in ${hhmm(s.checkInMin)}` : ''}{s.checkOutMin !== null ? ` · out ${hhmm(s.checkOutMin)}` : ''}</span>
        <button class="nm-rowact danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/stays/${s.id}`, undefined, 'Stay removed.')}>Remove</button>
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted">No stay yet — the planner needs one to start and end each day.</p>
{/if}
<form class="grid" onsubmit={addStay}>
  <label>Name<input class="nm-text-input" bind:value={stay.name} placeholder="Hotel or flat" /></label>
  <label
    >Address or search
    <span class="inline"><input class="nm-text-input" bind:value={stay.query} placeholder="Via dei Cappellari 10" /><button class="nm-btn-ghost" type="button" onclick={findStay}>Find</button></span>
  </label>
  <label>First night<select class="nm-text-input" bind:value={stay.fromDate}>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}</select></label>
  <label>Nights<input class="nm-text-input" type="number" min="1" max="31" bind:value={stay.nights} /></label>
  <label>Check in<input class="nm-text-input" bind:value={stay.checkIn} placeholder="15:00" /></label>
  <label>Check out<input class="nm-text-input" bind:value={stay.checkOut} placeholder="10:00" /></label>
  <div class="row-actions wide">
    {#if stayPlace}<span class="muted">Found: {stayPlace.address ?? stayPlace.name}</span>{:else if stayLookup}<span class="muted">{stayLookup}</span>{/if}
    <button class="nm-save-btn" type="submit" disabled={busy || !stayPlace}>Add stay</button>
  </div>
</form>
  </section>
  <!-- ── Wishes ─────────────────────────────────────────── -->
  <section class="nm-sec">
<div class="nm-sec-hd">
  <span class="sr-label-tight">Wishes</span>
  <span class="nm-sec-meta">{active.length} · {unresearched} not researched</span>
</div>
<div class="row-actions">
  <button class="nm-btn-ghost" type="button" disabled={busy || scanning || unresearched === 0} onclick={() => call('POST', `${base}/research`, {}, 'Research started.')}>Research all ({unresearched})</button>
  {#if research}
    <span class="progress" role="status" aria-live="polite">
      {#if research.state === 'running'}
        <span class="bar"><span class="fill" style="width: {research.total ? Math.round((research.done / research.total) * 100) : 0}%"></span></span>
        Researching {research.done + 1} of {research.total}{research.current ? ` — ${research.current}` : ''}…
      {:else if research.state === 'done'}
        Last scan {research.depth === 'deep' ? '(deeper)' : '(brief)'} finished {checked(research.finishedAt)}{research.note ? ` · ${research.note}` : ''}
      {:else}
        {research.note ?? 'The last scan failed.'}
      {/if}
    </span>
  {/if}
</div>
{#if active.length === 0}
  <p class="muted">No wishes yet.</p>
{/if}
<ol class="wishes">
  {#each active as w, i (w.id)}
    <li class="wish" class:skipped={w.skipped}>
      <div class="wish-hd">
        <span class="order">
          <button class="nm-rowact" type="button" aria-label="Move {w.title} up" disabled={busy || i === 0} onclick={() => move(w, -1)}>↑</button>
          <button class="nm-rowact" type="button" aria-label="Move {w.title} down" disabled={busy || i === active.length - 1} onclick={() => move(w, 1)}>↓</button>
        </span>
        <span class="w-title">{w.title}{w.replacesMeal ? ` · is ${w.replacesMeal}` : ''}{w.locked ? ' · locked' : ''}{w.skipped ? ' · skipped' : ''}</span>
        <span class="pill" class:must={w.priority === 'must'}>{w.priority}</span>
      </div>
      <div class="w-place muted">
        {#if w.place}
          {w.place.name}{w.place.address ? ` — ${w.place.address.split(',').slice(0, 3).join(',')}` : ''}
        {:else}
          <span class="needs">Needs a place</span> — research finds one, or
          <input class="nm-text-input small" placeholder="search name" bind:value={placeQuery[w.id]} />
          <button class="nm-rowact" type="button" disabled={busy} onclick={() => findWishPlace(w)}>Set place</button>
        {/if}
      </div>
      <div class="w-edit">
        <label>Priority<select class="nm-text-input small" value={w.priority} onchange={(e) => patchWish(w, { priority: e.currentTarget.value })}><option value="must">must</option><option value="nice">nice</option></select></label>
        <label>Minutes<input class="nm-text-input small" type="number" min="5" max="720" value={w.durationSec ? Math.round(w.durationSec / 60) : ''} placeholder={w.facts?.typicalVisitSec ? String(Math.round(w.facts.typicalVisitSec / 60)) : '60'} onchange={(e) => patchWish(w, { durationMin: e.currentTarget.value === '' ? null : Number(e.currentTarget.value) })} /></label>
        <label>Part of day<select class="nm-text-input small" value={w.partOfDay} onchange={(e) => patchWish(w, { partOfDay: e.currentTarget.value })}><option value="any">any</option><option value="morning">morning</option><option value="afternoon">afternoon</option><option value="evening">evening</option></select></label>
        <label>Day<select class="nm-text-input small" value={w.fixedDate ?? ''} onchange={(e) => patchWish(w, { fixedDate: e.currentTarget.value || null })}><option value="">any day</option>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}</select></label>
        <label>Is the meal<select class="nm-text-input small" value={w.replacesMeal ?? ''} onchange={(e) => patchWish(w, { replacesMeal: e.currentTarget.value || null })}><option value="">no</option><option value="lunch">lunch</option><option value="dinner">dinner</option></select></label>
        <label>Fixed time<input class="nm-text-input small" value={hhmm(w.fixedStartMin)} placeholder="hh:mm" onchange={(e) => patchWish(w, { fixedStartMin: e.currentTarget.value.trim() || null })} /></label>
        <label class="check"><input type="checkbox" checked={w.locked} onchange={(e) => patchWish(w, { locked: e.currentTarget.checked })} /> lock</label>
        <label class="check"><input type="checkbox" checked={w.skipped} onchange={(e) => patchWish(w, { skipped: e.currentTarget.checked })} /> skip</label>
        <button class="nm-rowact danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/wishes/${w.id}`, undefined, 'Wish removed.')}>Remove</button>
      </div>
      {#if w.facts}
        <details class="facts">
          <summary>Facts · checked {checked(w.facts.checkedAt)} · {w.facts.depth}{w.facts.unknown.length ? ` · ${w.facts.unknown.length} unknown` : ''}</summary>
          {#if w.facts.summary}<p>{w.facts.summary}</p>{/if}
          <dl>
            <dt>Opening hours</dt><dd>{w.facts.openingHoursText ?? (w.facts.hours ? 'from the web — see the sources' : 'unknown')}</dd>
            <dt>Booking</dt><dd>{w.facts.bookingRequired === null ? 'unknown' : w.facts.bookingRequired ? 'required' : 'not needed'}{w.facts.bookAheadDays !== null ? ` · book ${w.facts.bookAheadDays} days ahead` : ''}</dd>
            <dt>Price</dt><dd>{w.facts.priceText ?? 'unknown'}</dd>
            <dt>Typical visit</dt><dd>{w.facts.typicalVisitSec ? `${Math.round(w.facts.typicalVisitSec / 60)} min` : 'unknown'}</dd>
            <dt>Official</dt><dd>{#if w.facts.officialUrl}<a href={w.facts.officialUrl} target="_blank" rel="noopener noreferrer">{new URL(w.facts.officialUrl).hostname}</a>{:else}unknown{/if}{#if w.facts.bookingUrl} · <a href={w.facts.bookingUrl} target="_blank" rel="noopener noreferrer">official tickets</a>{/if}</dd>
          </dl>
          {#if w.facts.unknown.length}<p class="muted">Not found: {w.facts.unknown.join(', ')}.</p>{/if}
          {#if w.facts.sources.length}
            <p class="sources">Sources: {#each w.facts.sources as s, si (s.url)}{si ? ' · ' : ''}<a href={s.url} target="_blank" rel="noopener noreferrer">{s.title ?? new URL(s.url).hostname}</a>{/each}</p>
          {/if}
          <button class="nm-btn-ghost" type="button" disabled={busy || scanning} onclick={() => call('POST', `${base}/research`, { wishId: w.id }, 'Looking deeper.')}>Look deeper</button>
        </details>
      {:else}
        <p class="muted small">Not researched yet.</p>
      {/if}
    </li>
  {/each}
</ol>
  </section>
  {#if suggestions.length}
<section class="nm-sec">
  <div class="nm-sec-hd"><span class="sr-label-tight">Suggestions nearby</span><span class="nm-sec-meta">never planned until you accept</span></div>
  <ul class="plain">
    {#each suggestions as w (w.id)}
      <li class="line">
        <span><strong>{w.title}</strong>{w.note ? ` — ${w.note}` : ''}{w.facts?.officialUrl ? ' · ' : ''}{#if w.facts?.officialUrl}<a href={w.facts.officialUrl} target="_blank" rel="noopener noreferrer">website</a>{/if}</span>
        <span class="inline">
          <button class="nm-btn-ghost" type="button" disabled={busy} onclick={() => patchWish(w, { suggested: false }, 'Suggestion accepted.')}>Accept</button>
          <button class="nm-rowact danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/wishes/${w.id}`, undefined, 'Suggestion rejected.')}>Reject</button>
        </span>
      </li>
    {/each}
  </ul>
</section>
  {/if}
  {#if data.guide}
<details class="nm-sec">
  <summary class="nm-sec-hd"><span class="sr-label-tight">Getting around {trip.destination}</span><span class="nm-sec-meta">written {checked(data.guide.generatedAt)}</span></summary>
  <p>{data.guide.gettingAround}</p>
  {#if data.guide.transitTickets}<p><strong>Tickets:</strong> {data.guide.transitTickets}</p>{/if}
  {#if data.guide.taxi}
    <p><strong>Taxis:</strong> {data.guide.taxi.how}</p>
    {#if data.guide.taxi.links.length}<p class="links">{#each data.guide.taxi.links as l, li (l.url)}{li ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>{/each}</p>{/if}
  {/if}
  {#if data.guide.tips.length}<ul>{#each data.guide.tips as t, ti (ti)}<li>{t}</li>{/each}</ul>{/if}
</details>
  {/if}
  {#if data.events.length}
<section class="nm-sec">
  <div class="nm-sec-hd"><span class="sr-label-tight">From the phone</span><span class="nm-sec-meta">latest {data.events.length}</span></div>
  <ul class="plain">
    {#each data.events as e (e.clientId)}
      <li class="line small"><span class="mono">{new Date(e.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> <span>{e.kind}{e.wishId && titleOf[e.wishId] ? ` · ${titleOf[e.wishId]}` : ''}</span></li>
    {/each}
  </ul>
</section>
  {/if}

<style>
  label.check,
  .grid label.check,
  .w-edit label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    text-transform: none;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr));
    gap: 10px 14px;
    margin-top: 10px;
  }
  .grid label,
  .w-edit label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .grid .wide {
    grid-column: 1 / -1;
  }
  .modes {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .modes legend {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    margin: 10px 0;
  }
  .inline {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .plain {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    padding: 8px 0;
    border-top: 1px solid var(--line-hair);
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: var(--fs-label-xs);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .warn {
    color: var(--warn);
    font-size: var(--fs-label);
    margin: 4px 0;
  }
  .nm-text-input.small {
    padding: 3px 6px;
    font-size: var(--fs-label);
    max-width: 150px;
  }
  .wishes {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .wish {
    padding: 10px 0;
    border-top: 1px solid var(--line-hair);
  }
  .wish.skipped {
    opacity: 0.6;
  }
  .wish-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .order {
    display: inline-flex;
    gap: 2px;
  }
  .w-title {
    flex: 1;
    font-weight: 600;
  }
  .pill {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    border: 1px solid var(--line-strong);
    border-radius: 100px;
    padding: 0 8px;
  }
  .pill.must {
    border-color: var(--accent);
    color: var(--accent);
  }
  .w-place {
    font-size: var(--fs-label);
    margin: 2px 0 6px;
  }
  .needs {
    color: var(--warn);
  }
  .w-edit {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: flex-end;
  }
  .facts {
    margin-top: 6px;
    font-size: var(--fs-label);
  }
  .facts summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .facts dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 6px 0;
  }
  .facts dt {
    color: var(--text-secondary);
  }
  .facts dd {
    margin: 0;
  }
  .sources a,
  .facts a,
  .line a {
    color: var(--accent-ink);
  }
  .progress {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .bar {
    display: inline-block;
    width: 120px;
    height: 8px;
    background: var(--bg-section);
    border: 1px solid var(--line-strong);
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
</style>
