<script lang="ts">
  import { invalidateAll, replaceState } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import StageBand from '$lib/components/trips/StageBand.svelte';
  import { changedStops, dayBrief, groupDay } from '$lib/trips/stages';
  import { DAY_STAGES, DAY_STAGE_LABEL } from '$lib/trips/model';
  import PageHeader from '$lib/components/PageHeader.svelte';
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
  const loadOf = (d: string) => (data.trip.dayLoads ?? {})[d] ?? 'normal';
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
  const MODE_LABEL: Record<TravelMode, string> = { walk: 'walk', cycle: 'cycle', drive: 'drive', transit: 'public transport', taxi: 'taxi' };

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

  // ── The conversation (v2): the planner is the editor; the forms below are a view ──
  type Msg = (typeof data.messages)[number];
  let draft = $state('');
  let sending = $state(false);
  let pending = $state<string | null>(null);
  let quick = $state<string[]>([]);
  let talkEl = $state<HTMLDivElement | null>(null);
  const shown = $derived<Msg[]>(data.messages);

  // ── The studio's tabs (v4): Overview, then one per day; ?day= in the URL ──
  // The tab the page opened on (?day=); after that the studio owns it.
  let tab = $state<string>(untrack(() => data.initialDay ?? 'overview'));
  const tabs = $derived(['overview', ...(data.plan?.plan.days.map((d) => d.date) ?? [])]);
  function selectTab(t: string, focus = false) {
    tab = t;
    try {
      replaceState(t === 'overview' ? '?' : `?day=${t}`, {});
    } catch {
      /* shallow routing unavailable (tests): the tab still changes */
    }
    if (focus) void tick().then(() => document.getElementById(`tab-${t}`)?.focus());
  }
  function onTabKey(e: KeyboardEvent) {
    const i = tabs.indexOf(tab);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    selectTab(tabs[(next + tabs.length) % tabs.length], true);
  }
  // Changed items glow briefly after a reply.
  let highlight = $state<Set<string>>(new Set());
  let composer = $state<HTMLTextAreaElement | null>(null);
  function ask(text: string) {
    draft = text;
    void tick().then(() => {
      composer?.focus();
      composer?.setSelectionRange(text.length, text.length);
    });
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    const before = data.plan?.plan ?? null;
    sending = true;
    pending = t;
    draft = '';
    quick = [];
    problem = null;
    try {
      const res = await fetch(`${base}/converse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: t }) });
      const out = (await res.json().catch(() => ({}))) as { quickReplies?: string[]; error?: string; changes?: string[]; planVersion?: number | null };
      if (!res.ok) {
        problem = out.error ?? 'The planner did not answer.';
        draft = t;
      } else {
        quick = out.quickReplies ?? [];
        if (out.changes?.length) notice = `Re-planned as version ${out.planVersion}.`;
      }
      await invalidateAll();
      if (data.plan) {
        highlight = changedStops(before, data.plan.plan);
        setTimeout(() => (highlight = new Set()), 4000);
      }
    } catch {
      problem = 'The site did not answer. Try again.';
      draft = t;
    } finally {
      sending = false;
      pending = null;
    }
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  }
  $effect(() => {
    // Keep the newest message in view. Tracked: the message count and the pending line.
    void shown.length;
    void pending;
    if (talkEl) talkEl.scrollTop = talkEl.scrollHeight;
  });
  const timeOf = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

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

<div class="studio-wrap">
  <header class="studio-hd">
    <div>
      <p class="kicker">Trip studio · {trip.destination}</p>
      <h1>{trip.title}</h1>
      <p class="sub">{dayLabel(trip.startDate)} – {dayLabel(trip.endDate)} · {trip.pace} pace · {trip.modes.map((m) => MODE_LABEL[m]).join(', ')}</p>
    </div>
    <div class="hd-actions">
      <button class="nm-btn-ghost" type="button" disabled={busy} onclick={() => call('POST', `${base}/plan`, undefined, 'Plan checked.')}>Re-plan now</button>
      <a class="nm-btn-ghost" href="#details">Details</a>
    </div>
  </header>

  {#if problem}<p class="banner error" role="alert">{problem}</p>{/if}
  {#if notice}<p class="banner" role="status">{notice}</p>{/if}

  <div class="studio">
    <div class="canvas">
      <div class="tabs" role="tablist" aria-label="Overview and days of the trip" tabindex="-1" onkeydown={onTabKey}>
        {#each tabs as t, ti (t)}
          <button
            id="tab-{t}"
            class="tab"
            class:overview={t === 'overview'}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls="studio-panel"
            tabindex={tab === t ? 0 : -1}
            onclick={() => selectTab(t)}
          >
            {#if t === 'overview'}
              <span class="tab-num">∗</span><span class="tab-label">Overview</span>
            {:else}
              <span class="tab-num">{ti}</span><span class="tab-label">{dayLabel(t)}</span>{#if loadOf(t) !== 'normal'}<span class="tab-load">{loadOf(t)}</span>{/if}
            {/if}
          </button>
        {/each}
      </div>

      <div id="studio-panel" class="panel" role="tabpanel" aria-labelledby="tab-{tab}" tabindex="0">
        {#if !plan}
          <div class="empty-studio">
            <h2>Nothing on the board yet</h2>
            <p class="muted">Tell the planner where you are going, when, and where you are staying — the days appear here as you talk.</p>
          </div>
        {:else if tab === 'overview'}
          <div class="ov-grid">
            <div class="ov-map">
              <TripMap days={mapDays} suggestions={mapSuggestions} focus={null} />
              {#if estimatedModes.length}<p class="muted small">Some travel times are estimated from distance ({estimatedModes.join(', ')}).</p>{/if}
            </div>
            <ol class="day-cards">
              {#each plan.days as d, di (d.date)}
                {@const brief = dayBrief(d)}
                <li>
                  <button class="day-card" type="button" onclick={() => selectTab(d.date, true)} aria-label="Open {dayLabel(d.date)}">
                    <span class="dc-hd"><span class="dc-num">{di + 1}</span><span class="dc-date">{dayLabel(d.date)}</span>{#if loadOf(d.date) !== 'normal'}<span class="tab-load">{loadOf(d.date)}</span>{/if}</span>
                    {#each DAY_STAGES as st (st)}
                      <span class="dc-stage dcs-{st}"><span class="dcs-label">{DAY_STAGE_LABEL[st]}</span><span class="dcs-what">{brief[st].join(' · ') || 'free'}</span></span>
                    {/each}
                  </button>
                </li>
              {/each}
            </ol>
          </div>
          {#each plan.warnings as wn, wi (wi)}<p class="warn">{wn}</p>{/each}
          {#if plan.dropped.length}
            <div class="ov-block">
              <h3 class="block-hd">Not planned</h3>
              <ul class="plain">{#each plan.dropped as d (d.wishId)}<li class="line"><span><strong>{titleOf[d.wishId] ?? 'A wish'}</strong> — {d.reason}</span></li>{/each}</ul>
            </div>
          {/if}
          <section class="nm-sec">
            <div class="nm-sec-hd"><span class="sr-label-tight">Getting there and back</span><span class="nm-sec-meta">frames the first and last day</span></div>
            {#if !data.transport.length}
              <p class="muted">No journey yet — tell the planner your flight or train (“we fly from Newcastle at 07:35 on the 27th”).</p>
            {:else}
              <ul class="plain">
                {#each data.transport as t (t.id)}
                  <li class="line">
                    <span>
                      <strong>{t.direction === 'outbound' ? 'Out' : t.direction === 'return' ? 'Back' : 'Between'}: {t.kind}{t.number ? ` ${t.number}` : ''}{t.carrier ? ` (${t.carrier})` : ''}</strong>
                      — {t.from.name}{t.from.code ? ` ${t.from.code}` : ''} {dayLabel(t.departDate)} {hhmm(t.departMin)} → {t.to.name}{t.to.code ? ` ${t.to.code}` : ''} {dayLabel(t.arriveDate)} {hhmm(t.arriveMin)}
                      <span class="mono small src">{t.confidence}{t.delayMin ? ` · ${t.delayMin} min late` : ''}</span>
                      {#each t.sources as src, si (src.url)}{si ? ', ' : ' · '}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.title ?? 'source'}</a>{/each}
                    </span>
                    <button class="nm-rowact danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/transport/${t.id}`, undefined, 'Journey removed.')}>Remove</button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>

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

          <details class="nm-sec" open={!!data.profile && !data.messages.length}>
            <summary class="nm-sec-hd"><span class="sr-label-tight">What I know about you</span><span class="nm-sec-meta">from your JKAI memory, notes and family roster{data.profile ? ` · ${checked(data.profile.gatheredAt)}` : ''}</span></summary>
            {#if !data.profile}
              <p class="muted">Not gathered yet — it will be on your first message.</p>
            {:else}
              <p class="muted small">The planner uses this without being asked. Tell it in the conversation if anything is wrong; lasting preferences you state can be saved to memory.</p>
              <dl class="profile">
                <dt>Travelling</dt><dd>{data.profile.travellers.map((t) => `${t.name}${t.relation ? ` (${t.relation})` : ''}${t.notes.length ? ` — ${t.notes.join('; ')}` : ''}`).join(', ')}</dd>
                <dt>Needs</dt><dd>{#if data.profile.constraints.length}<ul>{#each data.profile.constraints as c, ci (ci)}<li>{c.text} <span class="mono small src">{c.source}</span></li>{/each}</ul>{:else}none known{/if}</dd>
                <dt>Likes</dt><dd>{#if data.profile.preferences.length}<ul>{#each data.profile.preferences as c, ci (ci)}<li>{c.text} <span class="mono small src">{c.source}</span></li>{/each}</ul>{:else}none known{/if}</dd>
                {#if data.profile.history.length}<dt>Before</dt><dd><ul>{#each data.profile.history as h, hi (hi)}<li>{h}</li>{/each}</ul></dd>{/if}
              </dl>
            {/if}
            <button class="nm-btn-ghost" type="button" disabled={busy} onclick={() => call('POST', `${base}/profile`, undefined, 'Gathered again.')}>Gather again</button>
          </details>

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
        {:else}
          {@const day = plan.days.find((x) => x.date === tab)}
          {#if day}
            {@const di = plan.days.indexOf(day)}
            <header class="day-hd">
              <span class="day-num">{di + 1}</span>
              <div>
                <h2>{dayLabel(day.date)}</h2>
                <p class="muted small">{loadOf(day.date)} day{day.stayId ? ` · from ${data.stays.find((s) => s.id === day.stayId)?.name ?? 'the stay'}` : ''}</p>
              </div>
              {#if day.legs.some((l) => l.mode === 'drive' || l.mode === 'taxi')}
                <button class="nm-rowact" type="button" onclick={() => liveDrive(day)}>Live drive times</button>
                <span class="muted small">{liveNote[day.date] ?? ''}</span>
              {/if}
            </header>
            {#each day.warnings as wn, wi (wi)}<p class="warn">{wn}</p>{/each}
            <div class="day-grid">
              <div class="day-map"><TripMap days={mapDays} suggestions={[]} focus={day.date} /></div>
              <div class="bands">
                {#each groupDay(day) as g (g.stage)}
                  <StageBand
                    stage={g.stage}
                    items={g.items}
                    dayName={dayLabel(day.date)}
                    date={day.date}
                    wishes={data.wishes}
                    {dates}
                    {highlight}
                    {live}
                    {busy}
                    onAsk={ask}
                    onPatch={(w, patch, done) => patchWish(w, patch, done)}
                    dateLabel={dayLabel}
                  />
                {/each}
              </div>
            </div>
          {:else}
            <p class="muted">That day is not in the plan. <button class="nm-rowact" type="button" onclick={() => selectTab('overview')}>Back to the overview</button></p>
          {/if}
        {/if}
      </div>
    </div>

    <aside class="talk" aria-label="Planning conversation">
      <div class="nm-sec-hd"><span class="sr-label-tight">Plan it together</span><span class="nm-sec-meta">the planner changes the trip; you can also edit the details below</span></div>
      <div class="messages" bind:this={talkEl}>
        {#if !shown.length && !pending}
          <p class="muted">Tell the planner about the trip — where and when, where you’re staying, who’s going and what you want to do. It will ask for anything missing.</p>
        {/if}
        {#each shown as m (m.id)}
          {#if m.role === 'event'}
            <p class="msg event"><span class="mono small">{timeOf(m.createdAt)}</span> Changed directly: {m.text}</p>
          {:else}
            <div class="msg {m.role}">
              <p>{m.text}</p>
              {#if m.research?.length}
                <details class="lookups">
                  <summary class="small">Looked up {m.research.length} thing{m.research.length === 1 ? '' : 's'}</summary>
                  <ul>
                    {#each m.research as r, ri (ri)}
                      <li>{r.summary}{#each r.sources as src, si (src.url)}{si ? ', ' : ' — '}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.title ?? new URL(src.url).hostname}</a>{/each}</li>
                    {/each}
                  </ul>
                </details>
              {/if}
              <span class="meta mono small">{m.role === 'user' ? (m.surface === 'phone' ? 'you, on the phone' : 'you') : 'planner'} · {timeOf(m.createdAt)}{m.ops.length ? ` · ${m.ops.length} change${m.ops.length === 1 ? '' : 's'}` : ''}{m.planVersion ? ` · plan v${m.planVersion}` : ''}</span>
            </div>
          {/if}
        {/each}
        {#if pending}
          <div class="msg user"><p>{pending}</p></div>
          <p class="msg event" role="status">The planner is thinking…</p>
        {/if}
      </div>
      {#if quick.length}
        <div class="quick">
          {#each quick as q (q)}<button class="nm-btn-ghost" type="button" disabled={sending} onclick={() => send(q)}>{q}</button>{/each}
        </div>
      {/if}
      <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea class="nm-text-input" rows="2" bind:this={composer} bind:value={draft} onkeydown={onKey} placeholder="“Make Thursday lighter”, “we’re staying near Campo de’ Fiori”, “add the Borghese”…" aria-label="Message the planner"></textarea>
        <button class="nm-save-btn" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
      </form>
    </aside>
  </div>

  <details class="drawer" id="details">
    <summary><span class="drawer-title">Details</span> <span class="muted small">the trip, stays, wishes and research — what the conversation set; edit directly if you like</span></summary>
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
  </details>
</div>

<style>
  /* ── The studio (v4) ── */
  .studio-wrap {
    max-width: 1480px;
    margin: 0 auto;
    padding: 1.6rem 1.5rem 4rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .studio-hd {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    flex-wrap: wrap;
    padding-bottom: 14px;
    margin-bottom: 18px;
    border-bottom: 2px solid var(--line-title);
  }
  .kicker {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent-ink);
  }
  .studio-hd h1 {
    margin: 4px 0;
    font-family: var(--font-display);
    font-size: clamp(1.8rem, 4vw, 2.8rem);
    line-height: 1.05;
  }
  .sub {
    margin: 0;
    color: var(--text-secondary);
  }
  .hd-actions {
    display: flex;
    gap: 8px;
  }
  .studio {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
    gap: 20px;
    align-items: start;
  }
  .canvas {
    min-width: 0;
  }
  .tabs {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
  }
  .tab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    padding: 8px 14px 9px;
    border: 1px solid var(--line-strong);
    border-bottom: 0;
    border-radius: 2px 2px 0 0;
    background: var(--surface-rail);
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
  }
  .tab[aria-selected='true'] {
    background: var(--surface-card);
    color: var(--text-primary);
    box-shadow: inset 0 3px 0 var(--accent);
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .tab-num {
    font-family: var(--font-display);
    font-size: 1.2rem;
    color: var(--accent);
  }
  .tab-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .tab-load {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    border: 1px solid var(--accent-ink);
    color: var(--accent-ink);
    border-radius: 100px;
    padding: 0 6px;
  }
  .panel {
    border: 1px solid var(--line-strong);
    background: var(--surface-card);
    padding: 18px;
    min-height: 420px;
  }
  .panel:focus-visible {
    outline: 2px solid var(--accent-ink);
  }
  .empty-studio h2,
  .day-hd h2 {
    font-family: var(--font-display);
    margin: 0;
  }
  .ov-grid {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 16px;
    align-items: start;
  }
  .day-cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  .day-card {
    display: grid;
    gap: 3px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
  }
  .day-card:hover,
  .day-card:focus-visible {
    border-color: var(--accent-ink);
    outline: none;
  }
  .dc-hd {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }
  .dc-num {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--accent);
  }
  .dc-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .dc-stage {
    display: grid;
    grid-template-columns: 9.5rem minmax(0, 1fr);
    gap: 8px;
    padding: 3px 8px;
    font-size: var(--fs-label);
    border-radius: 2px;
  }
  .dcs-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
  }
  .dcs-what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dcs-morning {
    background: var(--accent-ink-tint-06);
    color: var(--accent-ink);
  }
  .dcs-lunch {
    background: var(--accent-tint-08);
  }
  .dcs-afternoon {
    background-color: var(--surface-rail);
    background-image: repeating-linear-gradient(135deg, var(--surface-overlay) 0 2px, transparent 2px 9px);
  }
  .dcs-evening {
    background: var(--chrome-bg);
    color: var(--chrome-ink);
  }
  .ov-block {
    margin-top: 18px;
  }
  .block-hd {
    font-family: var(--font-display);
    font-size: 1.05rem;
    margin: 0 0 6px;
  }
  .day-hd {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .day-num {
    font-family: var(--font-display);
    font-size: 3rem;
    line-height: 1;
    color: var(--accent);
  }
  .day-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .bands {
    display: grid;
    gap: 10px;
  }
  @media (max-width: 900px) {
    .ov-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 640px) {
    .studio-wrap {
      padding: 1rem 16px 3rem;
    }
    .panel {
      padding: 12px;
    }
    .dc-stage {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }
    .day-num {
      font-size: 2.2rem;
    }
  }
  .talk {
    position: sticky;
    top: calc(var(--site-nav-height, 48px) + 8px);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - var(--site-nav-height, 48px) - 24px);
    border: 1px solid var(--line-strong);
    background: var(--bg);
    padding: 12px 14px;
  }
  .drawer {
    margin-top: 24px;
    border-top: 2px solid var(--line-title);
    padding-top: 12px;
  }
  .drawer > summary {
    cursor: pointer;
    margin-bottom: 14px;
  }
  .drawer-title {
    font-family: var(--font-display);
    font-size: 1.3rem;
  }
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
  .talk {
    position: sticky;
    top: calc(var(--site-nav-height, 48px) + 8px);
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - var(--site-nav-height, 48px) - 24px);
  }
  .messages {
    flex: 1;
    min-height: 200px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-right: 4px;
  }
  .msg {
    max-width: 92%;
    padding: 8px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--bg);
  }
  .msg p {
    margin: 0;
    white-space: pre-wrap;
  }
  .msg.user {
    align-self: flex-end;
    border-color: var(--accent);
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--bg-section);
  }
  .msg.event {
    align-self: center;
    border: 0;
    background: none;
    color: var(--text-muted);
    font-size: var(--fs-label-xs);
    padding: 0;
  }
  .msg .meta {
    display: block;
    margin-top: 4px;
    color: var(--text-ghost);
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .composer {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    margin-top: 8px;
  }
  .composer textarea {
    flex: 1;
  }
  .details-hd {
    font-family: var(--font-display);
    font-size: 1.2rem;
    margin: 1.5rem 0 0.8rem;
  }
  .lookups {
    margin-top: 6px;
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .lookups summary {
    cursor: pointer;
  }
  .lookups ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .lookups a,
  .line a {
    color: var(--accent-ink);
  }
  .stage {
    text-transform: uppercase;
    color: var(--accent-ink);
  }
  .profile {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 14px;
    margin: 8px 0;
  }
  .profile dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .profile dd {
    margin: 0;
  }
  .profile ul {
    margin: 0;
    padding-left: 16px;
  }
  .src {
    color: var(--text-ghost);
  }
  .guide {
    margin-top: 4px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .guide summary {
    cursor: pointer;
    color: var(--accent-ink);
  }
  .guide ul {
    margin: 4px 0;
    padding-left: 18px;
  }
  .guide p {
    margin: 4px 0;
  }
  .links a {
    color: var(--accent-ink);
  }
  @media (max-width: 1100px) {
    .studio {
      grid-template-columns: 1fr;
    }
    .talk {
      position: static;
      max-height: none;
    }
    .messages {
      max-height: 420px;
    }
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
