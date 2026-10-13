<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import TitleBlock from '$lib/components/admin/PageHeader.svelte';
  import TripMap, { type MapDay } from '$lib/components/trips/TripMap.svelte';
  import { dayLabel } from '$lib/trips/changes';
  import { TRAVEL_MODES, type LatLng, type PlannedDay, type TravelMode, type Wish } from '$lib/trips/model';

  let { data } = $props();

  const trip = $derived(data.trip);
  const base = $derived(`/api/trips/${data.trip.id}`);

  // ── Calls: every edit changes a constraint; the server re-plans; the page reloads ──
  let busy = $state(false);
  let notice = $state<string | null>(null);
  let problem = $state<string | null>(null);

  async function call(method: string, url: string, body?: unknown, done?: string): Promise<Record<string, unknown> | null> {
    busy = true;
    problem = null;
    notice = null;
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        problem = String(out.error ?? out.message ?? `That did not work (${res.status}).`);
        return null;
      }
      if (typeof out.warning === 'string') problem = out.warning;
      else if (done) notice = out.replanned ? `${done} Re-planned as version ${out.planVersion}.` : done;
      await invalidateAll();
      return out;
    } catch {
      problem = 'The site did not answer. Try again.';
      return null;
    } finally {
      busy = false;
    }
  }

  // ── Dates and small formatters ──
  const dates = $derived.by(() => {
    const out: string[] = [];
    const [y, m, d] = trip.startDate.split('-').map(Number);
    for (let t = Date.UTC(y, m - 1, d); ; t += 86_400_000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (iso > trip.endDate || out.length > 40) break;
      out.push(iso);
    }
    return out;
  });
  const hhmm = (min: number | null | undefined) =>
    min === null || min === undefined ? '' : `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
  const toMin = (v: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const checked = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'never');
  const MODE_LABEL: Record<TravelMode, string> = { walk: 'walk', cycle: 'cycle', drive: 'drive', transit: 'public transport' };

  // ── Intake ──
  let intake = $state({ destination: '', title: '', startDate: '', endDate: '', timeZone: '', pace: 'normal', modes: [] as TravelMode[], notes: '' });
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

  // ── Free text → wishes ──
  let freeText = $state('');
  let drafts = $state<Array<{ title: string; priority: 'must' | 'nice'; durationSec: number | null; partOfDay: string; note: string | null; keep: boolean }>>([]);
  async function readText() {
    const out = await call('POST', `${base}/wishes/draft`, { text: freeText });
    if (out && Array.isArray(out.wishes)) {
      drafts = (out.wishes as Array<Omit<(typeof drafts)[number], 'keep'>>).map((w) => ({ ...w, keep: true }));
      notice = drafts.length ? `Read ${drafts.length} wishes — untick any you do not want, then add them.` : 'Nothing to add was found in that.';
    }
  }
  async function addDrafts() {
    const wishes = drafts.filter((d) => d.keep).map(({ keep: _k, ...w }) => w);
    if (!wishes.length) return;
    if (await call('POST', `${base}/wishes`, { wishes }, `${wishes.length} wishes added.`)) {
      drafts = [];
      freeText = '';
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

  // ── Bookings ──
  let booking = $state<Record<string, { reference: string; date: string; time: string; open: boolean }>>({});
  const bookingKey = (c: { wishId: string | null; bookingId: string | null }) => c.wishId ?? c.bookingId ?? '';
  function openBooking(c: { wishId: string | null; bookingId: string | null; visitDate: string | null }) {
    booking[bookingKey(c)] = { reference: '', date: c.visitDate ?? '', time: '', open: true };
  }
  async function markBooked(c: { wishId: string | null; bookingId: string | null }) {
    const f = booking[bookingKey(c)];
    await call(
      'POST',
      `${base}/bookings`,
      {
        ...(c.bookingId ? { bookingId: c.bookingId } : { wishId: c.wishId }),
        status: 'booked',
        reference: f?.reference || null,
        date: f?.date || null,
        startMin: f?.time ? toMin(f.time) : null,
      },
      'Marked booked.',
    );
  }
  const URGENCY: Record<string, string> = { overdue: 'overdue', now: 'book now', soon: 'soon', later: 'later', done: 'booked', unknown: 'check' };

  // ── The plan ──
  const plan = $derived(data.plan?.plan ?? null);
  const titleOf = $derived(Object.fromEntries(data.wishes.map((w) => [w.id, w.title])));
  const estimatedModes = $derived(
    Object.entries(data.plan?.estimated ?? {})
      .filter(([, v]) => v)
      .map(([m]) => MODE_LABEL[m as TravelMode] ?? m),
  );
  const mapDays = $derived.by((): MapDay[] => {
    if (!plan) return [];
    return plan.days.map((day) => {
      let n = 0;
      const loc = new Map(day.stops.map((s) => [s.id, s.location]));
      return {
        date: day.date,
        label: dayLabel(day.date),
        stops: day.stops
          .filter((s) => s.kind === 'wish' && s.location)
          .map((s) => ({ id: s.id, title: s.title, location: s.location as LatLng, n: ++n })),
        legs: day.legs
          .filter((l) => loc.get(l.fromStopId) && loc.get(l.toStopId))
          .map((l) => ({ line: l.line, from: loc.get(l.fromStopId) as LatLng, to: loc.get(l.toStopId) as LatLng })),
      };
    });
  });
  const mapSuggestions = $derived(suggestions.filter((w) => w.place).map((w) => ({ title: w.title, location: w.place!.location })));
  let focus = $state<string | null>(null);

  let live = $state<Record<string, number | null>>({});
  let liveNote = $state<Record<string, string>>({});
  async function liveDrive(day: PlannedDay) {
    liveNote[day.date] = 'Asking…';
    const res = await fetch(`${base}/live?date=${day.date}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.available) {
      liveNote[day.date] = 'Live drive times unavailable (no Mapbox token on this server).';
      return;
    }
    for (const l of body.legs as Array<{ fromStopId: string; toStopId: string; liveMin: number | null }>) {
      live[`${day.date}|${l.fromStopId}|${l.toStopId}`] = l.liveMin;
    }
    liveNote[day.date] = `Live, ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — shown only, never saved.`;
  }
  const waitText = (sec: number) => {
    const m = Math.round(sec / 60);
    return m > 45 ? `Free time ${m} min` : `wait ${m} min`;
  };
</script>

<svelte:head><title>{trip.title} — Trips</title></svelte:head>

<PageHeader title="Trips" />

<PageWrap width="wide">
  <TitleBlock
    kicker={trip.destination}
    title={trip.title}
    sub="{dayLabel(trip.startDate)} – {dayLabel(trip.endDate)} · {trip.pace} pace · {trip.modes.map((m) => MODE_LABEL[m]).join(', ')} · {trip.timeZone}"
  >
    {#snippet actions()}
      <button class="nm-btn-ghost" type="button" disabled={busy} onclick={() => call('POST', `${base}/plan`, undefined, 'Plan checked.')}>Re-plan now</button>
    {/snippet}
  </TitleBlock>

  {#if problem}<p class="banner error" role="alert">{problem}</p>{/if}
  {#if notice}<p class="banner" role="status">{notice}</p>{/if}

  <!-- ── Intake ─────────────────────────────────────────── -->
  <details class="nm-sec" open={!data.plan}>
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

  <!-- ── Free text ──────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">What do you want to do?</span><span class="nm-sec-meta">read into wishes; you confirm each</span></div>
    <textarea class="nm-text-input" rows="3" bind:value={freeText} placeholder="The Colosseum for sure, the Vatican if we can get tickets, a long evening in Trastevere…"></textarea>
    <div class="row-actions">
      <button class="nm-btn-ghost" type="button" disabled={busy || freeText.trim().length < 3} onclick={readText}>Read it</button>
      <form class="inline" onsubmit={addOne}>
        <input class="nm-text-input" bind:value={quickWish} placeholder="…or add one wish" />
        <button class="nm-btn-ghost" type="submit" disabled={busy || !quickWish.trim()}>Add</button>
      </form>
    </div>
    {#if drafts.length}
      <ul class="plain drafts">
        {#each drafts as d, i (i)}
          <li class="line">
            <label class="check"><input type="checkbox" bind:checked={d.keep} /> <strong>{d.title}</strong></label>
            <span class="muted">{d.priority}{d.partOfDay !== 'any' ? ` · ${d.partOfDay}` : ''}{d.durationSec ? ` · ${Math.round(d.durationSec / 60)} min` : ''}{d.note ? ` · ${d.note}` : ''}</span>
          </li>
        {/each}
      </ul>
      <div class="row-actions">
        <button class="nm-save-btn" type="button" disabled={busy} onclick={addDrafts}>Add {drafts.filter((d) => d.keep).length} wishes</button>
        <button class="nm-rowact" type="button" onclick={() => (drafts = [])}>Discard</button>
      </div>
    {/if}
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
            <span class="w-title">{w.title}{w.locked ? ' · locked' : ''}{w.skipped ? ' · skipped' : ''}</span>
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
                <dt>Opening hours</dt><dd>{w.facts.openingHoursText ?? 'unknown'}</dd>
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

  <!-- ── Booking checklist (D5: never books) ───────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">To book</span><span class="nm-sec-meta">most urgent first · links go to the official seller · the site never books</span></div>
    {#if data.checklist.length === 0}
      <p class="muted">Nothing needs booking that research has found.</p>
    {:else}
      <ul class="plain checklist">
        {#each data.checklist as c (bookingKey(c))}
          <li class="line">
            <span class="urg urg-{c.urgency}">{URGENCY[c.urgency]}</span>
            <span class="c-main">
              <strong>{c.title}</strong>{c.visitDate ? ` · visit ${dayLabel(c.visitDate)}` : ''}
              <span class="muted block">{c.why}</span>
            </span>
            <span class="inline">
              {#if c.url}<a class="nm-btn-ghost" href={c.url} target="_blank" rel="noopener noreferrer">Official site</a>{/if}
              {#if c.status !== 'booked'}
                {#if booking[bookingKey(c)]?.open}
                  <input class="nm-text-input small" placeholder="reference" bind:value={booking[bookingKey(c)].reference} />
                  <select class="nm-text-input small" bind:value={booking[bookingKey(c)].date}><option value="">day?</option>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}</select>
                  <input class="nm-text-input small" placeholder="hh:mm" bind:value={booking[bookingKey(c)].time} />
                  <button class="nm-save-btn" type="button" disabled={busy} onclick={() => markBooked(c)}>Save</button>
                {:else}
                  <button class="nm-btn-ghost" type="button" onclick={() => openBooking(c)}>Mark booked</button>
                {/if}
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- ── The plan ───────────────────────────────────────── -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">The plan</span>
      <span class="nm-sec-meta">{data.plan ? `version ${data.plan.version} · ${data.plan.source} · ${checked(data.plan.createdAt)}` : 'not solved yet'}</span>
    </div>
    {#if !plan}
      <p class="muted">Add a stay and some wishes; the plan appears here.</p>
    {:else}
      {#if estimatedModes.length}<p class="muted small">Some travel times are estimated from distance ({estimatedModes.join(', ')}), not routed.</p>{/if}
      <div class="row-actions">
        <button class="nm-rowact" type="button" data-active={focus === null} onclick={() => (focus = null)}>All days</button>
        {#each plan.days as d, i (d.date)}
          <button class="nm-rowact" type="button" data-active={focus === d.date} onclick={() => (focus = d.date)}>{i + 1} · {dayLabel(d.date)}</button>
        {/each}
      </div>
      <TripMap days={mapDays} suggestions={mapSuggestions} {focus} />
      {#each plan.warnings as wn, wi (wi)}<p class="warn">{wn}</p>{/each}

      <div class="days">
        {#each plan.days as day, di (day.date)}
          {#if !focus || focus === day.date}
            <article class="day">
              <h3><span class="mono">{di + 1}</span> {dayLabel(day.date)}</h3>
              {#if day.legs.some((l) => l.mode === 'drive')}
                <p class="small"><button class="nm-rowact" type="button" onclick={() => liveDrive(day)}>Live drive times</button> <span class="muted">{liveNote[day.date] ?? ''}</span></p>
              {/if}
              {#each day.warnings as wn, wi (wi)}<p class="warn">{wn}</p>{/each}
              <ol class="timeline">
                {#each day.stops as s, si (s.id)}
                  <li class="stop stop-{s.kind}">
                    <span class="time mono">{hhmm(s.arriveMin)}{s.departMin !== s.arriveMin ? `–${hhmm(s.departMin)}` : ''}</span>
                    <span class="s-body">
                      <strong>{s.title}</strong>{s.locked ? ' · locked' : ''}{s.bookingId ? ' · booked' : ''}
                      {#if s.waitSec >= 60}<span class="muted"> · {waitText(s.waitSec)}</span>{/if}
                      {#each s.warnings as wn, wi (wi)}<span class="warn block">{wn}</span>{/each}
                      {#if s.kind === 'wish' && s.wishId}
                        {@const w = data.wishes.find((x) => x.id === s.wishId)}
                        {#if w}
                          <span class="s-edit">
                            <select class="nm-text-input small" aria-label="Move {s.title} to day" value={w.fixedDate ?? ''} onchange={(e) => patchWish(w, { fixedDate: e.currentTarget.value || null }, 'Moved.')}>
                              <option value="">any day</option>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}
                            </select>
                            <button class="nm-rowact" type="button" onclick={() => patchWish(w, { locked: !w.locked }, w.locked ? 'Unlocked.' : 'Locked to this day and time.')}>{w.locked ? 'Unlock' : 'Lock'}</button>
                            <button class="nm-rowact" type="button" onclick={() => patchWish(w, { priority: w.priority === 'must' ? 'nice' : 'must' })}>Make {w.priority === 'must' ? 'nice' : 'must'}</button>
                          </span>
                        {/if}
                      {/if}
                    </span>
                  </li>
                  {#if day.legs[si]}
                    {@const leg = day.legs[si]}
                    {@const liveMin = live[`${day.date}|${leg.fromStopId}|${leg.toStopId}`]}
                    <li class="leg muted">
                      {MODE_LABEL[leg.mode]} {Math.round(leg.durationSec / 60)} min{leg.distanceM ? ` · ${(leg.distanceM / 1000).toFixed(1)} km` : ''}{leg.estimated ? ' · estimated' : ''}{liveMin !== undefined && liveMin !== null ? ` · live ${liveMin} min` : ''}
                    </li>
                  {/if}
                {/each}
              </ol>
            </article>
          {/if}
        {/each}
      </div>

      {#if plan.dropped.length}
        <h3 class="sub-hd">Not planned</h3>
        <ul class="plain">
          {#each plan.dropped as d (d.wishId)}
            <li class="line"><span><strong>{titleOf[d.wishId] ?? 'A wish'}</strong> — {d.reason}</span></li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- ── What changed ───────────────────────────────────── -->
  {#if data.versions.length}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">What changed</span><span class="nm-sec-meta">every edit is a new version</span></div>
      {#each data.versions as v, vi (v.version)}
        <details open={vi === 0}>
          <summary class="mono small">v{v.version} · {v.source} · {new Date(v.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</summary>
          <ul class="changes">{#each v.changes as c, ci (ci)}<li>{c}</li>{/each}</ul>
        </details>
      {/each}
    </section>
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
</PageWrap>

<style>
  .banner {
    padding: 8px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg-section);
    font-size: var(--fs-label);
    margin: 0 0 1rem;
  }
  .banner.error {
    border-color: var(--error);
    color: var(--error);
  }
  details.nm-sec > summary {
    cursor: pointer;
    list-style: none;
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
  .line:first-child {
    border-top: 0;
  }
  .muted {
    color: var(--text-muted);
  }
  .small {
    font-size: var(--fs-label-xs);
  }
  .block {
    display: block;
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
  textarea.nm-text-input {
    width: 100%;
    resize: vertical;
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
  .urg {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    min-width: 76px;
    color: var(--text-secondary);
  }
  .urg-overdue,
  .urg-now {
    color: var(--error);
  }
  .urg-soon {
    color: var(--warn);
  }
  .urg-done {
    color: var(--success);
  }
  .c-main {
    flex: 1;
    min-width: 200px;
  }
  .days {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    gap: 16px;
    margin-top: 16px;
  }
  .day h3,
  .sub-hd {
    font-family: var(--font-display);
    font-size: 1.05rem;
    margin: 0 0 6px;
  }
  .timeline {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .stop {
    display: flex;
    gap: 10px;
    padding: 4px 0;
  }
  .stop .time {
    min-width: 92px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .stop-stay strong,
  .stop-meal strong {
    font-weight: 400;
    color: var(--text-secondary);
  }
  .s-edit {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
    margin-top: 2px;
  }
  .leg {
    padding: 0 0 0 102px;
    font-size: var(--fs-label-xs);
    font-family: var(--font-mono);
  }
  .changes {
    margin: 4px 0 10px;
    padding-left: 18px;
    font-size: var(--fs-label);
  }
  :global(.nm-rowact[data-active='true']) {
    color: var(--accent);
    text-decoration: underline;
  }
  @media (max-width: 640px) {
    .leg {
      padding-left: 12px;
    }
    .stop {
      flex-direction: column;
      gap: 0;
    }
  }
</style>
