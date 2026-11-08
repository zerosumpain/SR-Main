<script lang="ts">
  // The trip studio, written in the notebook (the landing page's NOTES
  // theme): an ink cover with the trip's dates stamped on it and what is
  // still to book ringed; a strip of day tabs; then one ruled sheet holding
  // either the overview (the map or a hand sketch, the days as pinned index
  // cards, what to book as a tick list, the latest revision) or one day (its
  // four stages, each on its own kind of paper). The planner is a notepad
  // beside the sheet on a wide screen and a sheet that slides up on a phone,
  // so it is never more than one tap away.
  //
  // v8 (propose, research, ask): the brief sits at the top as labelled chips;
  // open trip shapes come next, as the first thing to choose; the column
  // beside the plan is the Decisions rail (What changed with Undo, quick
  // questions, proposal groups, the research) with "Tell the planner…" at its
  // foot — on a phone the rail stacks above the days and the planner is a bar
  // that opens a sheet. Swap / Fill / day variants on the plan bring proposals
  // into the rail; Preview draws a proposal's ghost on the map.
  import { postAsJob } from '$lib/trips/job-client';
  import { api } from '$lib/trips/decisions-client';
  import { DecisionDesk } from '$lib/trips/decisions-desk.svelte';
  import { affectedDates, affectedStops, changeLines, ghostDays, groupProposals, mapDayOf, mergeProposals } from '$lib/trips/decisions-view';
  import type { PlanDiff, Proposal, Question } from '$lib/trips/decisions';
  import type { PlanOption } from '$lib/trips/options';
  import type { DayStage } from '$lib/trips/model';
  import DecisionsRail from '$lib/components/trips/decisions/DecisionsRail.svelte';
  import BriefChips from '$lib/components/trips/decisions/BriefChips.svelte';
  import ProposalGroup from '$lib/components/trips/decisions/ProposalGroup.svelte';
  import QuestionCard from '$lib/components/trips/decisions/QuestionCard.svelte';
  import VersionHistory from '$lib/components/trips/decisions/VersionHistory.svelte';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import StageBand from '$lib/components/trips/StageBand.svelte';
  import TripDetails from '$lib/components/trips/TripDetails.svelte';
  import DayCards from '$lib/components/trips/DayCards.svelte';
  import { changedStops, groupDay } from '$lib/trips/stages';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TripMap, { type MapDay } from '$lib/components/trips/TripMap.svelte';
  import { dayLabel } from '$lib/trips/changes';
  import { type PlannedDay, type TravelMode, type Wish } from '$lib/trips/model';
  import DateStamp from '$lib/components/notes-paper/DateStamp.svelte';
  import InkRing from '$lib/components/notes-paper/InkRing.svelte';
  import Tally from '$lib/components/notes-paper/Tally.svelte';
  import TripCover from '$lib/components/trips/notes/TripCover.svelte';
  import MarginBlock from '$lib/components/trips/notes/MarginBlock.svelte';
  import RouteSketch from '$lib/components/trips/notes/RouteSketch.svelte';
  import { countWord, dateSpan, firstChanges, stampDate, tripName, weekday } from '$lib/components/trips/notes/notes';

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
    const before = data.plan?.plan ?? null;
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
      else if (done && !out.replanned) notice = done;
      await reloadAndHighlight(before);
      // v8: a direct edit shows What changed, with Undo, like every other change.
      if (out.replanned && typeof out.planVersion === 'number') {
        desk.showChange(done ? `Changed directly: ${done.replace(/\.$/, '').toLowerCase()}` : 'Changed directly', { planVersion: out.planVersion, changes: data.versions[0]?.changes ?? [] });
      }
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
    void tick().then(() => {
      const el = document.getElementById(`tab-${t}`);
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (focus) el?.focus();
    });
  }
  $effect(() => {
    // On load, bring the open day's tab into view in a strip narrower than the trip.
    untrack(() => document.getElementById(`tab-${tab}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  });
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
  // On a phone the planner is a sheet that slides up; everything that hands
  // the planner a question opens it.
  let talkOpen = $state(false);
  function openTalk() {
    talkOpen = true;
    void tick().then(() => {
      if (talkEl) talkEl.scrollTop = talkEl.scrollHeight;
      composer?.focus();
    });
  }
  function ask(text: string) {
    talkOpen = true;
    draft = text;
    void tick().then(() => {
      if (talkEl) talkEl.scrollTop = talkEl.scrollHeight;
      composer?.focus();
      composer?.setSelectionRange(text.length, text.length);
    });
  }

  // v8: what the last turn brought back — proposals and questions as cards in
  // the thread (the legacy `options`, never shown before, as cards when a turn
  // has no proposals).
  type TurnOut = {
    quickReplies?: string[];
    changes?: string[];
    planVersion?: number | null;
    proposals?: Proposal[];
    questions?: Question[];
    options?: PlanOption[];
    diff?: PlanDiff | null;
    undo?: { toVersion: number } | null;
  };
  let turn = $state<{ proposals: Proposal[]; questions: Question[] }>({ proposals: [], questions: [] });

  /** Reload the page's data and briefly highlight what the change moved. */
  async function reloadAndHighlight(before = data.plan?.plan ?? null) {
    await invalidateAll();
    if (!data.plan) return;
    highlight = changedStops(before, data.plan.plan);
    setTimeout(() => (highlight = new Set()), 4000);
  }

  // ── v8: decisions ──
  const desk = new DecisionDesk(() => base, {
    reload: async () => {
      const was = data.plan?.version ?? null;
      await reloadAndHighlight();
      const now = data.plan?.version ?? null;
      return now !== null && now !== was ? { planVersion: now, changes: data.versions[0]?.changes ?? [] } : undefined;
    },
    tell: ask,
  });
  const proposals = $derived(mergeProposals(data.decisions.proposals, desk.local, desk.gone));
  const grouped = $derived(groupProposals(proposals));
  const questions = $derived(data.decisions.questions.filter((q) => !desk.goneQuestions.has(q.id)));
  const turnProposals = $derived(turn.proposals.filter((p) => !desk.gone.has(p.id) && !desk.gone.has(`group:${p.groupId}`)));
  const turnGroups = $derived.by(() => {
    const g = groupProposals(turnProposals);
    return g.shapes.length ? [{ groupId: 'turn-shapes', kind: 'shape' as const, heading: 'Ways to do the trip', proposals: g.shapes }, ...g.groups] : g.groups;
  });
  const turnQuestions = $derived(turn.questions.filter((q) => !desk.goneQuestions.has(q.id)));
  const travellers = $derived(
    (data.profile?.travellers ?? []).map((t) => ({ name: t.name, age: t.age ?? null, personId: t.personId ?? null })),
  );

  // The conversation is the escape hatch, not the page: the latest exchange
  // shows, the whole thread on request.
  const THREAD_TAIL = 2;
  let showAll = $state(false);
  // On a wide sheet the planner's pad is always beside the rail; on a phone it
  // is a sheet. Cards the last reply brought sit in the thread, and leave the
  // rail while the thread is on screen (never shown twice side by side).
  let wide = $state(false);
  $effect(() => {
    const mq = window.matchMedia?.('(min-width: 1101px)');
    if (!mq) return;
    wide = mq.matches;
    const on = () => (wide = mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  });
  const inThread = $derived(new Set(wide || talkOpen ? [...turnProposals.map((p) => p.id), ...turnQuestions.map((q) => q.id)] : []));
  const railQuestions = $derived(questions.filter((q) => !inThread.has(q.id)));
  const railGroups = $derived(grouped.groups.map((g) => ({ ...g, proposals: g.proposals.filter((p) => !inThread.has(p.id)) })).filter((g) => g.proposals.length));

  // Preview: the proposal drawn as a ghost on the map, its days and stops marked.
  let previewId = $state<string | null>(null);
  const previewing = $derived(previewId ? (proposals.find((p) => p.id === previewId) ?? turnProposals.find((p) => p.id === previewId) ?? null) : null);
  const ghost = $derived(previewing ? ghostDays(previewing) : []);
  const markedStops = $derived(previewing ? affectedStops(previewing) : new Set<string>());
  const markedDates = $derived(new Set(previewing ? affectedDates(previewing) : []));
  function preview(p: Proposal | null) {
    previewId = p?.id ?? null;
    if (!p || !plan) return;
    if (!wide) talkOpen = false; // on a phone the sheet would hide the map
    const days = affectedDates(p).filter((d) => plan.days.some((x) => x.date === d));
    selectTab(days.length === 1 ? days[0] : 'overview');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    void tick().then(() => document.getElementById('studio-panel')?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }));
  }

  // Swap, Fill and day variants: proposals arrive in the rail as a group.
  const swapFor = (date: string, stage: DayStage) => (stop: { id: string; wishId: string | null }) =>
    void desk.request({ kind: 'swap', target: { stopId: stop.id, wishId: stop.wishId, date, stage } }, `swap:${stop.id}`, 'plan');
  const fillFor = (date: string, stage: DayStage) => () => void desk.request({ kind: 'fill', target: { date, stage } }, `fill:${date}:${stage}`, 'plan');
  let swapDays = $state<{ date: string; with: string } | null>(null);
  function dayVariant(date: string, variant: 'lighter' | 'rainy' | 'swap-days', withDate: string | null = null) {
    void desk.request({ kind: 'day', target: { date }, variant, ...(withDate ? { withDate } : {}) }, `day:${date}:${variant}`, 'plan').then((ps) => {
      if (ps.length) swapDays = null;
    });
  }

  // A choice made in the planner's sheet on a phone: close the sheet so What
  // changed (in the rail, which takes focus) is what you see next.
  let seenChange = 0;
  $effect(() => {
    const c = desk.change;
    if (!c || c.id === seenChange) return;
    seenChange = c.id;
    if (c.quiet) return;
    untrack(() => {
      if (talkOpen && !wide) talkOpen = false;
    });
  });

  // Another trip in the same page (a client-side navigation reuses it): start clean.
  let shownTrip = '';
  $effect(() => {
    const id = data.trip.id;
    if (id === shownTrip) return;
    const first = !shownTrip;
    shownTrip = id;
    if (first) return;
    untrack(() => {
      desk.reset();
      previewId = null;
      swapDays = null;
      turn = { proposals: [], questions: [] };
      quick = [];
    });
  });

  // While the research is still running, look again every so often; reload once it is done.
  $effect(() => {
    if (data.decisions.pack.status !== 'building') return;
    const url = `${base}/decisions`;
    const t = setInterval(async () => {
      const r = await api<{ pack?: { status?: string } }>('GET', url);
      if (!r.ok || r.body.pack?.status !== 'building') {
        clearInterval(t);
        await invalidateAll();
      }
    }, 10_000);
    return () => clearInterval(t);
  });

  async function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    const before = data.plan?.plan ?? null;
    sending = true;
    pending = t;
    draft = '';
    quick = [];
    problem = null;
    turn = { proposals: [], questions: [] };
    try {
      // v6: as a job, polled, so a long turn is not cut off by a proxy timeout.
      const { ok, body: out } = await postAsJob<TurnOut>(`${base}/converse`, { text: t });
      if (!ok) {
        problem = out.error ?? 'The planner did not answer.';
        draft = t;
      } else {
        quick = out.quickReplies ?? [];
        const ps = Array.isArray(out.proposals) ? out.proposals : [];
        const options = !ps.length && Array.isArray(out.options) ? desk.optionCards(out.options) : [];
        turn = { proposals: [...ps, ...options], questions: Array.isArray(out.questions) ? out.questions : [] };
        // Shown in the rail without taking focus: the person is still in the conversation.
        if (changeLines(out.changes).length || out.diff?.changes?.length) desk.showChange('The planner changed the plan', out, { quiet: true });
      }
      await reloadAndHighlight(before);
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

  // ── Wishes (the full editor is in the Details drawer) ──
  const suggestions = $derived(data.wishes.filter((w) => w.suggested));
  const patchWish = (w: Wish, patch: Record<string, unknown>, done = 'Saved.') => call('PATCH', `${base}/wishes/${w.id}`, patch, done);

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
  const mapDays = $derived.by((): MapDay[] => (plan ? plan.days.map(mapDayOf) : []));
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

  // ── The cover and the overview ──
  const name = $derived(tripName(trip));
  const place = $derived(trip.destination.split(',')[0]?.trim() || trip.destination);
  const coverLine = $derived.by(() => {
    const n = dates.length;
    const words = `${countWord(n)} ${n === 1 ? 'day' : 'days'} in ${place}, ${dateSpan(trip.startDate, trip.endDate)}`;
    return words.charAt(0).toUpperCase() + words.slice(1);
  });
  const toBook = $derived(data.checklist.filter((c) => c.status !== 'booked').length);
  const places = $derived(data.wishes.filter((w) => !w.suggested && !w.skipped).length);
  const latest = $derived(data.versions[0] ?? null);
  const latestShown = $derived(latest ? firstChanges(latest.changes, 4) : { shown: [], more: 0 });
  let allChanges = $state(false);
  const hasProfile = $derived(
    !!data.profile && (data.profile.travellers.length > 0 || data.profile.constraints.length > 0 || data.profile.preferences.length > 0 || data.profile.history.length > 0),
  );
  const dayIndex = $derived(plan ? plan.days.findIndex((d) => d.date === tab) : -1);
  const stayName = (id: string | null) => (id ? (data.stays.find((s) => s.id === id)?.name ?? 'the stay') : null);
  function onWindowKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && talkOpen) talkOpen = false;
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<svelte:head><title>{name.name} — Trips</title></svelte:head>

<PageHeader title="Trips" />

<TripCover kicker="Trip" title={name.name} line={coverLine} titleId="trip-h">
  {#snippet actions()}
    <a href="/trips">← All trips</a>
    <button type="button" disabled={busy} onclick={() => call('POST', `${base}/plan`, undefined, 'Plan checked.')}>{busy ? 'Working…' : 'Re-plan now'}</button>
    <a href="/trips/{trip.id}/places">The places</a>
    <a href="#details">The details</a>
  {/snippet}
  {#snippet marks()}
    <div class="mark">
      <span class="mark-k">Leaving</span>
      <DateStamp date={stampDate(trip.startDate)} sub={weekday(trip.startDate)} datetime={trip.startDate} tilt={-4} seed={41} />
    </div>
    <div class="mark">
      <span class="mark-k">Places</span>
      <span class="mark-fig"><span class="fig">{places}</span>{#if places > 0 && places <= 20}<Tally count={places} seed={23} height={18} />{/if}</span>
    </div>
    <div class="mark">
      <span class="mark-k">To book</span>
      <span class="mark-fig">
        {#if toBook > 0}<span class="fig"><InkRing seed={59} pad={0.32}>{toBook}</InkRing></span>{:else}<span class="fig done">✓</span><span class="mark-note">all booked</span>{/if}
      </span>
    </div>
  {/snippet}
</TripCover>

<main class="desk">
  <div class="sheet np-sheet np-tear">
    {#if problem}<p class="banner error" role="alert">{problem}</p>{/if}
    {#if notice}<p class="banner" role="status">{notice}</p>{/if}

    {#if data.decisions.brief.items.length}
      <MarginBlock kicker="Brief" aria-labelledby="brief-h">
        <h2 id="brief-h" class="sheet-h small">What the planner knows</h2>
        <p class="np-aside lede">Each fact says where it came from. Anything assumed is marked — say Right, or change it.</p>
        <BriefChips brief={data.decisions.brief} trip={data.trip} stays={data.stays} {travellers} family={data.family} {desk} />
      </MarginBlock>
    {/if}

    {#if grouped.shapes.length}
      <MarginBlock kicker="Choose" aria-label="Ways to do the trip">
        <p class="np-aside lede">Each is a whole plan, checked against opening times and the walks between. Pick one — you can change anything after.</p>
        <ProposalGroup heading="Ways to do the trip" groupId="shapes" proposals={grouped.shapes} {desk} {previewId} onPreview={preview} grid headingLevel={2} />
      </MarginBlock>
    {/if}

    <div class="studio">
      <div class="canvas">
        <MarginBlock kicker={tab === 'overview' ? 'The trip' : `Day ${dayIndex + 1}`} as="nav" aria-label="Overview and days of the trip">
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
                  <span class="tab-num">∗</span><span class="tab-label"><span class="tab-day">Overview</span><span class="tab-date">all days</span></span>
                {:else}
                  <span class="tab-num">{ti}</span><span class="tab-label"><span class="tab-day">{weekday(t).slice(0, 3)}</span><span class="tab-date">{stampDate(t)}{#if loadOf(t) !== 'normal'} · {loadOf(t)}{/if}</span></span>
                {/if}
              </button>
            {/each}
          </div>
        </MarginBlock>

        <div id="studio-panel" class="panel" role="tabpanel" aria-labelledby="tab-{tab}" tabindex="-1">
          {#if previewing}
            <div class="preview-bar" role="status">
              <p><strong>Previewing: {previewing.title}.</strong> The dashed ink line and hollow pins show how it would go{markedStops.size ? '; stops marked “would change” move or go' : ''}. Nothing has changed yet.</p>
              <span class="preview-acts">
                <button class="dx-btn small" type="button" disabled={!!desk.busy} onclick={() => desk.accept(previewing).then((ok) => ok && (previewId = null))}>Use this</button>
                <button class="dx-link" type="button" onclick={() => preview(null)}>Stop preview</button>
              </span>
            </div>
          {/if}
          {#if desk.problem?.where === 'plan'}<p class="banner error inset" role="alert">{desk.problem.text}</p>{/if}
          {#if desk.note?.where === 'plan'}<p class="banner inset" role="status">{desk.note.text}</p>{/if}
          {#if desk.busy?.startsWith('swap:') || desk.busy?.startsWith('fill:') || desk.busy?.startsWith('day:')}
            <p class="banner inset" role="status"><span class="dx-pulse" aria-hidden="true"></span> Finding checked alternatives — they will appear under Decisions.</p>
          {/if}
          {#if !plan}
            <MarginBlock kicker="Begin">
              <h2 class="sheet-h">Nothing on the page yet</h2>
              {#if grouped.shapes.length}
                <p class="np-aside">Choose one of the ways to do the trip above, and its days appear here.</p>
              {:else if data.decisions.pack.status === 'building'}
                <p class="np-aside">The planner is still reading up on the place. The days appear here when it is ready — it carries on if you leave.</p>
              {:else}
                <p class="np-aside">Tell the planner where you’re going, when, and where you’re staying — the days appear here as you talk.</p>
              {/if}
              <button class="pen-btn" type="button" onclick={openTalk}>Tell the planner →</button>
            </MarginBlock>
          {:else if tab === 'overview'}
            <MarginBlock kicker="Map" aria-labelledby="map-h">
              <h2 id="map-h" class="vh">Where everything is</h2>
              <div class="ov-map np-taped">
                <TripMap days={mapDays} suggestions={mapSuggestions} focus={null} {ghost}>
                  {#snippet fallback()}<RouteSketch days={mapDays} {ghost} />{/snippet}
                </TripMap>
              </div>
              {#if estimatedModes.length}<p class="np-aside small">Some travel times are estimated from distance ({estimatedModes.join(', ')}).</p>{/if}
            </MarginBlock>

            <MarginBlock kicker="Days" aria-labelledby="days-h">
              <h2 id="days-h" class="sheet-h">Day by day</h2>
              <p class="np-aside lede">Each day in four parts. Open one to see the times, the walks between and what to do when you get there.</p>
              <DayCards days={plan.days} {loadOf} onOpen={(d) => selectTab(d, true)} marked={markedDates} />
            </MarginBlock>

            {#if plan.warnings.length || plan.dropped.length}
              <MarginBlock kicker="Note" aria-label="Worth knowing">
                <div class="np-sticky sticky">
                  <h3 class="sticky-h">Worth knowing</h3>
                  {#each plan.warnings as wn, wi (wi)}<p>{wn}</p>{/each}
                  {#if plan.dropped.length}
                    <p class="sticky-k">Couldn’t fit in:</p>
                    <ul>{#each plan.dropped as d (d.wishId)}<li><strong>{titleOf[d.wishId] ?? 'A wish'}</strong> — {d.reason}</li>{/each}</ul>
                  {/if}
                </div>
              </MarginBlock>
            {/if}

            <MarginBlock kicker="Book" aria-labelledby="book-h">
              <h2 id="book-h" class="sheet-h">To book</h2>
              <p class="np-aside lede">Most urgent first. Links go to the official seller — the site never books anything.</p>
              {#if data.checklist.length === 0}
                <p class="np-aside">Nothing needs booking that research has found.</p>
              {:else}
                <ul class="ticks" role="list">
                  {#each data.checklist as c (bookingKey(c))}
                    <li class="tick-row" class:done={c.status === 'booked'}>
                      <span class="box" aria-hidden="true">{#if c.status === 'booked'}<svg viewBox="0 0 20 20"><path d="M4 10.5 L8.5 15 L16.5 4.5" /></svg>{/if}</span>
                      <span class="c-main">
                        <span class="c-title"><strong>{c.title}</strong>{#if c.visitDate}<span class="c-visit"> · {dayLabel(c.visitDate)}</span>{/if}</span>
                        <span class="c-why">{c.why}</span>
                      </span>
                      <span class="c-side">
                        <span class="urg urg-{c.urgency}">{URGENCY[c.urgency]}</span>
                        {#if c.url}<a class="pen-link" href={c.url} target="_blank" rel="noopener noreferrer">Official site ↗</a>{/if}
                        {#if c.status !== 'booked'}
                          {#if booking[bookingKey(c)]?.open}
                            <span class="book-form">
                              <input class="field" placeholder="reference" aria-label="Booking reference" bind:value={booking[bookingKey(c)].reference} />
                              <select class="field" aria-label="Day" bind:value={booking[bookingKey(c)].date}><option value="">day?</option>{#each dates as d (d)}<option value={d}>{dayLabel(d)}</option>{/each}</select>
                              <input class="field time" placeholder="hh:mm" aria-label="Time" bind:value={booking[bookingKey(c)].time} />
                              <button class="pen-btn small" type="button" disabled={busy} onclick={() => markBooked(c)}>Save</button>
                            </span>
                          {:else}
                            <button class="pen-link" type="button" onclick={() => openBooking(c)}>Mark booked</button>
                          {/if}
                        {/if}
                      </span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </MarginBlock>

            <MarginBlock kicker="Travel" aria-labelledby="travel-h">
              <h2 id="travel-h" class="sheet-h small">Getting there and back</h2>
              {#if !data.transport.length}
                <p class="np-aside">No journey yet. Tell the planner your flight or train and it frames the first and last day round it.</p>
                <button class="pen-link" type="button" onclick={() => ask('We fly from … at … on …, and back at … on …')}>Tell the planner →</button>
              {:else}
                <ul class="journeys" role="list">
                  {#each data.transport as t (t.id)}
                    <li class="journey">
                      <span class="j-dir">{t.direction === 'outbound' ? 'Out' : t.direction === 'return' ? 'Back' : 'Between'}</span>
                      <span class="j-main">
                        <strong>{t.from.name}{t.from.code ? ` ${t.from.code}` : ''} → {t.to.name}{t.to.code ? ` ${t.to.code}` : ''}</strong>
                        <span class="j-when">{dayLabel(t.departDate)} {hhmm(t.departMin)} → {dayLabel(t.arriveDate)} {hhmm(t.arriveMin)} · {t.kind}{t.number ? ` ${t.number}` : ''}{t.carrier ? ` (${t.carrier})` : ''}</span>
                        <span class="j-src">{t.confidence}{t.delayMin ? ` · ${t.delayMin} min late` : ''}{#each t.sources as src, si (src.url)}{si ? ', ' : ' · '}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.title ?? 'source'}</a>{/each}</span>
                      </span>
                      <button class="pen-link danger" type="button" disabled={busy} onclick={() => call('DELETE', `${base}/transport/${t.id}`, undefined, 'Journey removed.')}>Remove</button>
                    </li>
                  {/each}
                </ul>
              {/if}
            </MarginBlock>

            <MarginBlock kicker="You" aria-labelledby="you-h">
              <h2 id="you-h" class="sheet-h small">What the planner knows about you</h2>
              {#if !data.profile}
                <p class="np-aside">Not gathered yet — it will be on your first message.</p>
              {:else if !hasProfile}
                <p class="np-aside">Nothing trip-relevant found in your memory, notes or family roster yet ({checked(data.profile.gatheredAt)}). Tell the planner anything it should know.</p>
              {:else}
                <p class="np-aside lede">From your jkai memory, notes and family roster, {checked(data.profile.gatheredAt)}. It uses this without being asked; say in the conversation if anything is wrong.</p>
                <dl class="profile">
                  {#if data.profile.travellers.length}<dt>Travelling</dt><dd>{data.profile.travellers.map((t) => `${t.name}${t.relation ? ` (${t.relation})` : ''}${t.notes.length ? ` — ${t.notes.join('; ')}` : ''}`).join(', ')}</dd>{/if}
                  {#if data.profile.constraints.length}<dt>Needs</dt><dd><ul>{#each data.profile.constraints as c, ci (ci)}<li>{c.text} <span class="src">{c.source}</span></li>{/each}</ul></dd>{/if}
                  {#if data.profile.preferences.length}<dt>Likes</dt><dd><ul>{#each data.profile.preferences as c, ci (ci)}<li>{c.text} <span class="src">{c.source}</span></li>{/each}</ul></dd>{/if}
                  {#if data.profile.history.length}<dt>Before</dt><dd><ul>{#each data.profile.history as h, hi (hi)}<li>{h}</li>{/each}</ul></dd>{/if}
                </dl>
              {/if}
              <button class="pen-link" type="button" disabled={busy} onclick={() => call('POST', `${base}/profile`, undefined, 'Gathered again.')}>Gather again</button>
            </MarginBlock>

            {#if latest}
              <MarginBlock kicker="Changes" aria-labelledby="changes-h">
                <div class="rev-hd">
                  <h2 id="changes-h" class="sheet-h small">What changed last</h2>
                  <DateStamp date="v{latest.version}" sub={timeOf(latest.createdAt)} tilt={3} seed={latest.version * 7} />
                </div>
                <ul class="changes">
                  {#each allChanges ? latest.changes : latestShown.shown as c, ci (ci)}<li>{c}</li>{/each}
                </ul>
                {#if latestShown.more && !allChanges}<button class="pen-link" type="button" onclick={() => (allChanges = true)}>and {latestShown.more} more</button>{/if}
                {#if latest.version > 1}
                  <button class="pen-link" type="button" disabled={!!desk.busy} onclick={() => desk.undo(latest.version - 1)}>Undo this change</button>
                {/if}
                <VersionHistory versions={data.versions} current={latest.version} {desk} />
              </MarginBlock>
            {/if}
          {:else}
            {@const day = plan.days.find((x) => x.date === tab)}
            {#if day}
              {@const di = plan.days.indexOf(day)}
              {@const stay = stayName(day.stayId)}
              <MarginBlock kicker={stampDate(day.date)} aria-labelledby="day-h">
                <header class="day-hd">
                  <div class="day-title">
                    <h2 id="day-h" class="sheet-h"><span class="day-num">{di + 1}</span> {weekday(day.date)}</h2>
                    <p class="np-aside">{loadOf(day.date) === 'normal' ? 'A full day' : `A ${loadOf(day.date)} day`}{stay ? `, starting from ${stay}` : ''}.</p>
                  </div>
                  <div class="day-step">
                    <button class="pen-link" type="button" disabled={di === 0} onclick={() => selectTab(di === 0 ? 'overview' : plan.days[di - 1].date, true)}>← {di === 0 ? 'Overview' : 'Day before'}</button>
                    {#if di < plan.days.length - 1}<button class="pen-link" type="button" onclick={() => selectTab(plan.days[di + 1].date, true)}>Next day →</button>{/if}
                  </div>
                </header>
                <div class="day-ways" role="group" aria-label="Other ways to do {weekday(day.date)}">
                  <span class="np-aside small">Other ways to do it:</span>
                  <button class="dx-pen" type="button" disabled={!!desk.busy} onclick={() => dayVariant(day.date, 'lighter')}>{desk.busy === `day:${day.date}:lighter` ? 'Finding…' : 'Make it lighter'}</button>
                  <button class="dx-pen" type="button" disabled={!!desk.busy} onclick={() => dayVariant(day.date, 'rainy')}>{desk.busy === `day:${day.date}:rainy` ? 'Finding…' : 'Rainy-day version'}</button>
                  {#if plan.days.length > 1}
                    <button class="dx-pen" type="button" aria-expanded={swapDays?.date === day.date} onclick={() => (swapDays = swapDays?.date === day.date ? null : { date: day.date, with: plan.days.find((x) => x.date !== day.date)?.date ?? '' })}>Swap with another day</button>
                  {/if}
                  {#if swapDays?.date === day.date}
                    <span class="swap-days">
                      <label class="vh" for="swap-with">Swap {weekday(day.date)} with</label>
                      <select id="swap-with" class="field" bind:value={swapDays.with}>
                        {#each plan.days.filter((x) => x.date !== day.date) as o (o.date)}<option value={o.date}>{dayLabel(o.date)}</option>{/each}
                      </select>
                      <button class="dx-btn small" type="button" disabled={!!desk.busy || !swapDays.with} onclick={() => swapDays && dayVariant(day.date, 'swap-days', swapDays.with)}>{desk.busy === `day:${day.date}:swap-days` ? 'Finding…' : 'Show me'}</button>
                    </span>
                  {/if}
                </div>
                {#each day.warnings as wn, wi (wi)}<p class="warn">{wn}</p>{/each}
                <div class="day-map np-taped">
                  <TripMap days={mapDays} suggestions={[]} focus={day.date} ghost={ghost.filter((g) => !g.date || g.date === day.date)}>
                    {#snippet fallback()}<RouteSketch days={mapDays} focus={day.date} ghost={ghost.filter((g) => !g.date || g.date === day.date)} />{/snippet}
                  </TripMap>
                </div>
                {#if day.legs.some((l) => l.mode === 'drive' || l.mode === 'taxi')}
                  <p class="live"><button class="pen-link" type="button" onclick={() => liveDrive(day)}>Live drive times</button> <span class="np-aside small">{liveNote[day.date] ?? ''}</span></p>
                {/if}
              </MarginBlock>
              <MarginBlock kicker="Plan" aria-label="The day, in four parts">
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
                      {base}
                      dayStopIds={day.stops.map((x) => x.id)}
                      onAdded={() => reloadAndHighlight()}
                      marked={markedStops}
                      onSwap={swapFor(day.date, g.stage)}
                      onFill={fillFor(day.date, g.stage)}
                      asking={desk.busy}
                    />
                  {/each}
                </div>
              </MarginBlock>
            {:else}
              <MarginBlock>
                <p class="np-aside">That day is not in the plan. <button class="pen-link" type="button" onclick={() => selectTab('overview')}>Back to the overview</button></p>
              </MarginBlock>
            {/if}
          {/if}
        </div>

        <MarginBlock kicker="Details" id="details" aria-labelledby="details-h">
          <details class="drawer">
            <summary><span id="details-h" class="drawer-title">The details</span> <span class="np-aside small">the trip, stays, wishes and research the conversation set — edit them directly if you like</span></summary>
            <div class="drawer-body">
              <TripDetails
                trip={data.trip}
                stays={data.stays}
                wishes={data.wishes}
                guide={data.guide}
                events={data.events}
                {dates}
                {busy}
                {call}
                {base}
                hasPlan={!!data.plan}
              />
            </div>
          </details>
        </MarginBlock>
      </div>

      <aside class="rail" aria-label="Decisions and the planner">
        <div class="rail-scroll">
          <DecisionsRail
            questions={railQuestions}
            answered={data.decisions.answered}
            groups={railGroups}
            pack={data.decisions.pack}
            {desk}
            today={data.today}
            {previewId}
            onPreview={preview}
            placesHref="/trips/{trip.id}/places"
            shapesOpen={grouped.shapes.length}
            questionPushes={data.questionPushes}
          />
          {#if inThread.size}<p class="np-aside small rail-more">The planner’s last reply has {inThread.size} more {inThread.size === 1 ? 'card' : 'cards'} — below, with the conversation.</p>{/if}
        </div>

      <section class="talk" class:open={talkOpen} aria-labelledby="talk-h">
        <div class="pad">
          <header class="talk-hd">
            <div>
              <h2 id="talk-h" class="talk-h">Tell the planner</h2>
              <p class="talk-sub">Anything you’d like. It comes back as a change you can undo, a few cards to choose from, or a quick question.</p>
            </div>
            <button class="close" type="button" onclick={() => (talkOpen = false)} aria-label="Close the planner">Close</button>
          </header>
          <div class="messages" bind:this={talkEl}>
            {#if !shown.length && !pending}
              <p class="np-aside">Tell the planner about the trip — where and when, where you’re staying, who’s going and what you want to do. It assumes what it must, and shows you.</p>
            {/if}
            {#if shown.length > THREAD_TAIL}
              <button class="pen-link earlier-msgs" type="button" aria-expanded={showAll} onclick={() => (showAll = !showAll)}>{showAll ? 'Show only the latest' : `Show the whole conversation (${shown.length})`}</button>
            {/if}
            {#each showAll ? shown : shown.slice(-THREAD_TAIL) as m (m.id)}
              {#if m.role === 'event'}
                <p class="msg event"><span class="meta">{timeOf(m.createdAt)}</span> Changed directly: {m.text}</p>
              {:else}
                <div class="msg {m.role}">
                  <span class="who">{m.role === 'user' ? (m.surface === 'phone' ? 'you, on the phone' : m.surface === 'jkai' ? 'you, through jkai' : 'you') : 'planner'} · {timeOf(m.createdAt)}{m.planVersion ? ` · v${m.planVersion}` : ''}</span>
                  <p>{m.text}</p>
                  {#if m.research?.length}
                    <details class="lookups">
                      <summary>Looked up {m.research.length} thing{m.research.length === 1 ? '' : 's'}</summary>
                      <ul>
                        {#each m.research as r, ri (ri)}
                          <li>{r.summary}{#each r.sources as src, si (src.url)}{si ? ', ' : ' — '}<a href={src.url} target="_blank" rel="noopener noreferrer">{src.title ?? new URL(src.url).hostname}</a>{/each}</li>
                        {/each}
                      </ul>
                    </details>
                  {/if}
                  {#if m.ops.length}<span class="ops">{m.ops.length} change{m.ops.length === 1 ? '' : 's'} to the plan</span>{/if}
                </div>
              {/if}
            {/each}
            {#if pending}
              <div class="msg user"><span class="who">you · now</span><p>{pending}</p></div>
              <p class="msg event thinking" role="status">The planner is thinking<span class="dots" aria-hidden="true">…</span></p>
            {/if}
            {#if !pending && (turnQuestions.length || turnGroups.length)}
              <div class="turn" role="group" aria-label="What the planner offered">
                {#each turnQuestions as q (q.id)}<QuestionCard {q} {desk} today={data.today} tilt={-0.8} />{/each}
                {#each turnGroups as g (g.groupId)}
                  <ProposalGroup heading={g.heading} groupId="turn-{g.groupId}" proposals={g.proposals} {desk} {previewId} onPreview={preview} />
                {/each}
              </div>
            {/if}
          </div>
          {#if quick.length}
            <div class="quick">
              {#each quick as q (q)}<button class="prompt" type="button" disabled={sending} onclick={() => send(q)}>{q}</button>{/each}
            </div>
          {/if}
          <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(draft); }}>
            <textarea rows="3" bind:this={composer} bind:value={draft} onkeydown={onKey} placeholder="Tell the planner… “make Thursday lighter”, “somewhere for dinner near the flat”, “we land at 10:40”" aria-label="Tell the planner"></textarea>
            <div class="composer-go">
              <span class="hint">Enter to send · Shift + Enter for a new line</span>
              <button class="pen-btn" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
            </div>
          </form>
        </div>
      </section>
      </aside>
    </div>
  </div>
</main>

{#if talkOpen}<button class="scrim" type="button" tabindex="-1" aria-label="Close the planner" onclick={() => (talkOpen = false)}></button>{/if}
{#if !talkOpen}
  <button class="talk-fab" type="button" onclick={openTalk}><span class="fab-text">Tell the planner…</span>{#if turnQuestions.length + turnProposals.length} <span class="fab-n">{turnQuestions.length + turnProposals.length} new</span>{/if}</button>
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
  /* ── Cover marks ── */
  .mark {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .mark-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--on-ink-70);
    white-space: nowrap;
  }
  .mark-fig {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    min-height: 44px;
  }
  .fig {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .fig.done {
    color: var(--accent-on-dark);
  }
  .mark-note {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--on-ink-70);
    margin-bottom: 4px;
  }
  .mark-fig :global(.np-tally) {
    margin-bottom: 6px;
  }
  .mark-fig :global(.np-ring svg) {
    top: calc(50% - 0.62em);
    height: 1.24em;
  }

  /* ── The sheet ── */
  .desk {
    padding: 0 0 72px;
  }
  .sheet {
    max-width: 1480px;
    margin: 0 auto;
    padding: 26px 0 32px;
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--np-rule) 31px 32px);
  }
  .studio {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(340px, 420px);
    gap: 8px;
    align-items: start;
  }
  .canvas {
    min-width: 0;
  }
  .panel:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: -2px;
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
  .lede {
    margin: 2px 0 14px;
  }
  .small {
    font-size: var(--fs-label);
  }
  .banner {
    margin: 0 28px 12px calc(var(--np-margin-x) + 28px);
    padding: 8px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: var(--np-card);
    font-size: var(--fs-label);
  }
  .banner.error {
    border-color: var(--error);
    color: var(--error);
  }
  .warn {
    margin: 6px 0;
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--warn);
  }

  /* ── Pens: buttons and links in the notebook's hand ── */
  .pen-btn {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    padding: 9px 16px;
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
  }
  .pen-link:disabled {
    color: var(--text-ghost);
    text-decoration: none;
    cursor: default;
  }
  .pen-link.danger {
    color: var(--error);
  }
  .prompt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    padding: 4px 10px;
    border: 1px dashed var(--np-pen-ink);
    border-radius: 100px;
    background: transparent;
    color: var(--np-pen-ink);
    cursor: pointer;
    text-align: left;
  }
  .prompt:hover:not(:disabled),
  .prompt:focus-visible {
    border-style: solid;
    background: var(--accent-ink-tint-06);
    outline: none;
  }
  .field {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    padding: 3px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--np-ink);
    max-width: 150px;
  }
  .field.time {
    max-width: 70px;
  }
  .field:focus {
    outline: none;
    border-bottom: 2px solid var(--accent-ink);
  }

  /* ── The day strip: index tabs along the top of the sheet ── */
  .tabs {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 6px 2px 4px;
    scrollbar-width: thin;
  }
  .tab {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px 8px 12px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    background: transparent;
    color: var(--np-ink-soft);
    cursor: pointer;
    font: inherit;
    transition: transform 120ms ease;
  }
  .tab:hover {
    background: var(--np-card);
    color: var(--np-ink);
  }
  .tab[aria-selected='true'] {
    background: var(--np-card);
    color: var(--np-ink);
    border-color: var(--accent-ink);
    box-shadow: inset 0 3px 0 var(--accent);
    transform: rotate(-0.6deg);
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .tab-num {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 26px;
    line-height: 1;
    color: var(--accent);
  }
  .tab-label {
    display: flex;
    flex-direction: column;
    text-align: left;
    line-height: 1.2;
  }
  .tab-day {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
  }
  .tab-date {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 14px;
  }

  /* ── Overview ── */
  .ov-map,
  .day-map {
    margin-top: 6px;
    padding: 10px;
    background: var(--np-card);
    border: 1px solid var(--line-strong);
  }
  .sticky {
    max-width: 640px;
  }
  .sticky p,
  .sticky ul {
    margin: 4px 0;
  }
  .sticky ul {
    padding-left: 18px;
  }
  .sticky-h {
    margin: 0 0 4px;
    font-family: var(--fs-serif);
    font-style: italic;
    font-weight: 400;
    font-size: 22px;
  }
  .sticky-k {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* The booking list: a hand-ruled tick box per line. */
  .ticks {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tick-row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: start;
    padding: 10px 0;
    border-top: 1px dashed var(--line-strong);
  }
  .tick-row:first-child {
    border-top: 0;
  }
  .box {
    width: 18px;
    height: 18px;
    margin-top: 3px;
    border: 1.5px solid var(--np-ink);
    border-radius: 2px;
    transform: rotate(-2deg);
  }
  .box svg {
    width: 26px;
    height: 26px;
    margin: -8px 0 0 -1px;
    overflow: visible;
  }
  .box path {
    fill: none;
    stroke: var(--good, var(--success));
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .done .c-title strong {
    text-decoration: line-through;
    text-decoration-color: var(--np-ink-soft);
  }
  .c-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .c-visit {
    color: var(--np-ink-soft);
  }
  .c-why {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--np-ink-soft);
  }
  .c-side {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: 6px 12px;
    max-width: 360px;
  }
  .book-form {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .urg {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--np-ink-soft);
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

  .journeys {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }
  .journey {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr) auto;
    gap: 12px;
    align-items: baseline;
    padding: 8px 0;
    border-top: 1px dashed var(--line-strong);
  }
  .journey:first-child {
    border-top: 0;
  }
  .j-dir {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--np-pen-text);
  }
  .j-main {
    display: flex;
    flex-direction: column;
  }
  .j-when,
  .j-src {
    font-size: var(--fs-label);
    color: var(--np-ink-soft);
  }
  .j-src a,
  .lookups a {
    color: var(--accent-ink);
  }

  .profile {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px 16px;
    margin: 4px 0 12px;
  }
  .profile dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
    padding-top: 3px;
  }
  .profile dd {
    margin: 0;
  }
  .profile ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .src {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }

  .rev-hd {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }
  .changes {
    margin: 10px 0 6px;
    padding-left: 18px;
    line-height: 1.6;
  }
  .changes li::marker {
    color: var(--accent);
  }

  /* ── v8: preview, plan notes, day variants ── */
  .preview-bar {
    position: sticky;
    top: calc(var(--site-nav-height, 48px) + 4px);
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    margin: 0 28px 8px calc(var(--np-margin-x) + 28px);
    padding: 8px 12px;
    border: 1px dashed var(--accent-ink);
    background: var(--np-card);
    font-size: var(--fs-label);
  }
  .preview-bar p {
    flex: 1 1 260px;
    margin: 0;
  }
  .preview-acts {
    display: inline-flex;
    align-items: center;
    gap: 12px;
  }
  .banner.inset {
    margin: 0 28px 10px calc(var(--np-margin-x) + 28px);
  }
  .day-ways {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 8px 0 6px;
  }
  .swap-days {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
  }

  /* ── A day ── */
  .day-hd {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: flex-end;
    gap: 8px 20px;
  }
  .day-num {
    color: var(--accent);
    margin-right: 4px;
  }
  .day-title .np-aside {
    margin-top: 2px;
  }
  .day-step {
    display: flex;
    gap: 16px;
    padding-bottom: 6px;
  }
  .live {
    margin: 8px 0 0;
  }
  .bands {
    display: grid;
    gap: 16px;
  }

  /* ── The details drawer: the forms, on the same paper ── */
  .drawer > summary {
    cursor: pointer;
    list-style-position: outside;
  }
  .drawer-title {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(20px, 2.2vw, 26px);
    letter-spacing: -0.02em;
  }
  .drawer-body {
    margin-top: 14px;
  }

  /* ── v8: the rail beside the sheet — Decisions above, "Tell the planner" at its foot ── */
  .rail {
    position: sticky;
    top: calc(var(--site-nav-height, 48px) + 12px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-sizing: border-box;
    max-height: calc(100vh - var(--site-nav-height, 48px) - 24px);
    padding: 20px 24px 20px 0;
  }
  .rail-scroll {
    flex: 1 1 auto;
    min-height: 140px;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 6px 8px 4px;
  }
  .rail-more {
    margin: 10px 0 0;
  }
  .talk {
    flex: 0 1 auto;
    display: flex;
    min-height: 0;
    max-height: 58%;
  }
  .pad {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background-color: var(--np-card);
    background-image: repeating-linear-gradient(to bottom, transparent 0 23px, var(--np-rule) 23px 24px);
    border: 1px solid var(--line-strong);
    border-top: 0;
    box-shadow: 0 18px 36px -24px rgba(26, 16, 8, 0.4);
  }
  .talk-hd {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    padding: 16px 18px 12px;
    background: var(--text-primary);
    color: var(--bg);
    border-top: 6px solid var(--accent);
  }
  .talk-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
    color: var(--bg);
  }
  .talk-sub {
    margin: 2px 0 0;
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 15px;
    color: var(--accent-on-dark);
  }
  .close {
    display: none;
    padding: 4px 10px;
    border: 1px solid var(--on-ink-45);
    border-radius: 100px;
    background: transparent;
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    cursor: pointer;
  }
  .messages {
    flex: 1 1 auto;
    min-height: 48px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 18px 8px;
  }
  .msg {
    max-width: 100%;
  }
  .msg p {
    margin: 0;
    white-space: pre-wrap;
    line-height: 24px;
  }
  .who {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    line-height: 20px;
  }
  /* What you wrote, in petrol pen, set in from the right. */
  .msg.user {
    align-self: flex-end;
    max-width: 88%;
    padding-left: 12px;
    border-left: 2px solid var(--accent-ink);
  }
  .msg.user p {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 17px;
    color: var(--accent-ink);
  }
  .msg.user .who {
    color: var(--accent-ink);
  }
  .msg.assistant .who {
    color: var(--np-pen-text);
  }
  .msg.event {
    margin: 0;
    padding-left: 12px;
    border-left: 2px dotted var(--line-strong);
    font-size: var(--fs-label-xs);
    line-height: 18px;
    color: var(--text-muted);
  }
  .msg.event .meta {
    font-family: var(--font-mono);
  }
  .thinking .dots {
    display: inline-block;
    animation: blink 1.2s steps(4) infinite;
  }
  @keyframes blink {
    50% {
      opacity: 0.2;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .thinking .dots {
      animation: none;
    }
    .tab {
      transition: none;
    }
  }
  .ops {
    display: inline-block;
    margin-top: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent-ink);
  }
  .lookups {
    margin-top: 4px;
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .lookups summary {
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .lookups ul {
    margin: 4px 0 0;
    padding-left: 16px;
  }
  .earlier-msgs {
    align-self: flex-start;
  }
  .turn {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 6px 0 4px;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 18px 0;
  }
  .composer {
    padding: 10px 18px 14px;
    border-top: 1px solid var(--line-strong);
    background: var(--np-card);
  }
  .composer textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    min-height: 72px;
    padding: 2px;
    border: 0;
    background: repeating-linear-gradient(to bottom, transparent 0 23px, var(--np-rule) 23px 24px);
    resize: vertical;
    font-family: var(--font-body);
    font-size: 16px;
    line-height: 24px;
    color: var(--np-ink);
  }
  .composer textarea::placeholder {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--text-muted);
  }
  .composer textarea:focus {
    outline: none;
  }
  .composer:focus-within {
    box-shadow: inset 0 2px 0 var(--accent-ink);
  }
  .composer-go {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  /* The floating "Ask the planner" pen and the sheet's scrim, only where the pad is not on screen. */
  .talk-fab,
  .scrim {
    display: none;
  }

  @media (max-width: 1100px) {
    /* The rail stacks above the days. */
    .studio {
      display: flex;
      flex-direction: column;
      gap: 0;
    }
    .rail {
      order: -1;
      position: static;
      max-height: none;
      padding: 12px 28px 4px calc(var(--np-margin-x) + 28px);
    }
    .rail-scroll {
      overflow: visible;
      min-height: 0;
      padding: 0;
    }
    /* The pad becomes a sheet that slides up over the page. */
    .talk {
      display: none;
      position: fixed;
      inset: auto 0 0 0;
      top: auto;
      z-index: 60;
      padding: 0;
      max-height: none;
    }
    .talk.open {
      display: block;
      animation: rise 220ms ease-out;
    }
    .messages {
      min-height: 120px;
    }
    .pad {
      height: min(86dvh, 760px);
      max-height: none;
      border: 0;
      box-shadow: 0 -20px 40px -10px rgba(26, 16, 8, 0.45);
    }
    .close {
      display: inline-block;
    }
    .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 55;
      border: 0;
      padding: 0;
      background: rgba(26, 16, 8, 0.45);
      cursor: default;
    }
    .talk-fab {
      display: inline-flex;
      max-width: calc(100vw - 32px);
      align-items: center;
      gap: 8px;
      position: fixed;
      right: 16px;
      bottom: calc(16px + env(safe-area-inset-bottom, 0px));
      z-index: 50;
      padding: 12px 18px;
      border: 0;
      border-radius: 100px;
      background: var(--text-primary);
      color: var(--bg);
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 15px;
      box-shadow: 0 10px 24px -8px rgba(26, 16, 8, 0.55);
      cursor: pointer;
    }
    .talk-fab:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 3px;
    }
    .fab-n {
      min-width: 22px;
      padding: 1px 6px;
      border-radius: 100px;
      background: var(--accent);
      font-family: var(--font-mono);
      font-weight: 400;
      font-size: var(--fs-label-xs);
      text-align: center;
    }
    .hint {
      display: none;
    }
  }
  @keyframes rise {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .talk.open {
      animation: none;
    }
  }
  @media (max-width: 760px) {
    .mark-fig :global(.np-tally) {
      display: none;
    }
    .fig {
      font-size: 32px;
    }
    .mark-fig {
      min-height: 38px;
    }
    .mark-note {
      display: none;
    }
    .sheet {
      padding-top: 18px;
    }
    .banner {
      margin: 0 16px 10px calc(var(--np-margin-x) + 12px);
    }
    .banner.inset {
      margin: 0 16px 10px calc(var(--np-margin-x) + 12px);
    }
    .rail {
      padding: 10px 16px 4px calc(var(--np-margin-x) + 12px);
    }
    .preview-bar {
      margin-left: calc(var(--np-margin-x) + 12px);
      margin-right: 16px;
    }
    .tick-row {
      grid-template-columns: 22px minmax(0, 1fr);
    }
    .c-side {
      grid-column: 2;
      justify-content: flex-start;
    }
    .journey {
      grid-template-columns: 44px minmax(0, 1fr);
    }
    .journey .pen-link {
      grid-column: 2;
      justify-self: start;
    }
    .ov-map,
    .day-map {
      padding: 6px;
    }
  }
  @media print {
    .talk,
    .rail,
    .talk-fab,
    .tabs,
    .day-ways,
    .preview-bar {
      display: none !important;
    }
    .studio {
      grid-template-columns: 1fr;
    }
  }
</style>
