<script lang="ts">
  /**
   * The guided start (v8): where, when, who, pace, and what your notes
   * already hold (each a tick box, ticked) — about thirty seconds — then the
   * research runs where you can watch it: a line per stage ("Found 38
   * places"), never a seconds counter. You can leave; it carries on, and the
   * trip opens on its shapes when it is done. Cancel really cancels.
   *
   * POST /api/trips { start, async: true } → 202 { job }; the job is polled at
   * /api/trips/jobs/:id (its `stages`); DELETE there cancels. The job's id is
   * kept in this browser only, so coming back to /trips shows it again.
   */
  import { goto } from '$app/navigation';
  import { onMount, tick, untrack } from 'svelte';
  import type { NoteFact } from '$lib/trips/decisions';
  import { api, cancelJob, errorText, jobTripId, watchJob, type JobView } from '$lib/trips/decisions-client';
  import { startProblem, tripStartFrom, type StartForm } from '$lib/trips/decisions-view';
  import { dateSpan } from '$lib/components/trips/notes/notes';
  import JobProgress from '$lib/components/trips/decisions/JobProgress.svelte';

  let { family = [] }: { family?: Array<{ id: string; name: string }> } = $props();

  const KEPT = 'sr-trips-start-job';
  const PACES = [
    { v: 'relaxed', label: 'Relaxed', line: 'Late starts, long lunches, room to wander' },
    { v: 'normal', label: 'Normal', line: 'A full day, home for dinner' },
    { v: 'packed', label: 'Packed', line: 'Early to late, dinner out' },
  ] as const;

  let f = $state<StartForm>({ destination: '', startDate: '', endDate: '', travellers: [], pace: 'normal', text: '' });
  let problem = $state<string | null>(null);
  let sending = $state(false);

  // ── From your notes: looked up once where, first and last day are set ──
  let notes = $state<NoteFact[]>([]);
  let notesState = $state<'idle' | 'looking' | 'done' | 'failed'>('idle');
  let ticked = $state<Set<string>>(new Set());
  let notesFor = '';
  $effect(() => {
    const d = f.destination.trim();
    const a = f.startDate;
    const b = f.endDate;
    if (!d || !a || !b || b < a) return;
    const key = `${d}|${a}|${b}`;
    const t = setTimeout(() => untrack(() => void lookUp(key, d, a, b)), 700);
    return () => clearTimeout(t);
  });
  async function lookUp(key: string, d: string, a: string, b: string) {
    if (key === notesFor) return;
    notesFor = key;
    notesState = 'looking';
    const q = new URLSearchParams({ destination: d, startDate: a, endDate: b });
    const r = await api<{ notes?: NoteFact[] }>('GET', `/api/trips/notes?${q}`);
    if (key !== notesFor) return; // a newer look-up is on its way
    if (!r.ok) {
      notesState = 'failed';
      notes = [];
      return;
    }
    notes = (r.body.notes ?? []).filter((n) => n && typeof n.id === 'string');
    ticked = new Set(notes.map((n) => n.id));
    notesState = 'done';
  }
  function tick_(id: string) {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    ticked = next;
  }

  // ── Who ──
  let peopleEl = $state<HTMLElement | null>(null);
  function addPerson(p: { name: string; age: number | null; personId: string | null } = { name: '', age: null, personId: null }) {
    f.travellers = [...f.travellers, p];
    if (!p.name) void tick().then(() => (peopleEl?.querySelector(`#gs-name-${f.travellers.length - 1}`) as HTMLInputElement | null)?.focus());
  }
  const unlisted = $derived(family.filter((m) => !f.travellers.some((p) => p.personId === m.id || p.name.trim().toLowerCase() === m.name.toLowerCase())));

  // ── The research, once started ──
  let job = $state<JobView | null>(null);
  let startedHere = false;
  let cancelling = $state(false);
  let watching: { aborted: boolean } | null = null;
  let progressEl = $state<HTMLElement | null>(null);
  const tripId = $derived(job ? jobTripId(job) : null);
  const place = $derived(f.destination.trim() || 'the trip');

  function keep(j: JobView | null) {
    try {
      if (j && j.status === 'running') localStorage.setItem(KEPT, JSON.stringify({ id: j.id, destination: f.destination.trim(), startDate: f.startDate, endDate: f.endDate }));
      else localStorage.removeItem(KEPT);
    } catch {
      /* private window: it still runs, it just will not be shown again here */
    }
  }

  async function watch(j: JobView) {
    watching = { aborted: false };
    const end = await watchJob(j.id, { signal: watching, onUpdate: (u) => (job = u) });
    if (watching.aborted) return;
    job = end;
    keep(null);
    if (end.status === 'done' && startedHere) {
      const id = jobTripId(end);
      if (id) await goto(`/trips/${id}`);
    }
  }

  async function start(e: SubmitEvent) {
    e.preventDefault();
    problem = startProblem(f);
    if (problem || sending) return;
    sending = true;
    const r = await api<{ job?: JobView; id?: string }>('POST', '/api/trips', { start: tripStartFrom(f, notes.filter((n) => ticked.has(n.id)).map((n) => n.id)), async: true });
    sending = false;
    if (r.status === 202 && r.body.job) {
      startedHere = true;
      job = r.body.job;
      keep(r.body.job);
      void tick().then(() => progressEl?.focus());
      void watch(r.body.job);
      return;
    }
    if (r.ok && r.body.id) {
      await goto(`/trips/${r.body.id}`);
      return;
    }
    problem = errorText(r, 'Could not start the trip.');
  }

  async function cancel() {
    if (!job || cancelling) return;
    cancelling = true;
    const r = await cancelJob(job.id);
    cancelling = false;
    if (r.ok && r.body.job) job = r.body.job;
    else if (!r.ok) problem = errorText(r, 'Could not stop it just now.');
  }
  function again() {
    watching && (watching.aborted = true);
    job = null;
    problem = null;
    keep(null);
  }

  onMount(() => {
    // A start left running in this browser: show it again and keep watching.
    try {
      const kept = JSON.parse(localStorage.getItem(KEPT) ?? 'null') as { id?: string; destination?: string; startDate?: string; endDate?: string } | null;
      if (kept?.id) {
        f.destination = kept.destination ?? '';
        f.startDate = kept.startDate ?? '';
        f.endDate = kept.endDate ?? '';
        job = { id: kept.id, status: 'running', result: null, error: null, stages: [] };
        void watch(job);
      }
    } catch {
      /* nothing kept */
    }
    return () => watching && (watching.aborted = true);
  });
</script>

{#if job}
  <section class="gs-progress np-card np-card--plain" aria-labelledby="gs-p-h" tabindex="-1" bind:this={progressEl}>
    <p class="dx-k">{job.status === 'running' ? 'Researching' : job.status === 'done' ? 'Ready' : job.status === 'cancelled' ? 'Stopped' : 'Not finished'}</p>
    <h3 id="gs-p-h" class="gs-h">Planning {place}{f.startDate && f.endDate ? `, ${dateSpan(f.startDate, f.endDate)}` : ''}</h3>
    <JobProgress stages={job.stages ?? []} title="What the planner is doing" />
    {#if job.status === 'running'}
      <p class="dx-aside gs-leave">You can leave — it carries on. The trip will be under Coming up, and opens on its shapes when it is ready.</p>
      <div class="gs-go">
        {#if tripId}<a class="dx-link" href="/trips/{tripId}">Look at the trip so far</a>{/if}
        <button class="dx-btn small ghost" type="button" disabled={cancelling} onclick={cancel}>{cancelling ? 'Stopping…' : 'Cancel'}</button>
      </div>
    {:else if job.status === 'done'}
      <div class="gs-go">
        {#if tripId}<a class="dx-btn small" href="/trips/{tripId}">Open the trip →</a>{/if}
        <button class="dx-link" type="button" onclick={again}>Start another</button>
      </div>
    {:else}
      <p class="dx-err" role="alert">{job.status === 'cancelled' ? 'Stopped. Nothing more will be looked up.' : (job.error ?? 'The planner did not finish.')}</p>
      <div class="gs-go">
        {#if tripId}<a class="dx-link" href="/trips/{tripId}">The trip is saved — open it</a>{/if}
        <button class="dx-link" type="button" onclick={again}>Start again</button>
      </div>
    {/if}
    {#if problem}<p class="dx-err" role="alert">{problem}</p>{/if}
  </section>
{:else}
  <form class="gs np-card np-card--plain" onsubmit={start} aria-labelledby="gs-h" novalidate>
    <h3 id="gs-h" class="dx-vh">Start a trip, step by step</h3>

    <div class="gs-row">
      <label class="gs-field wide"><span class="gs-k">Where</span><input class="gs-in" bind:value={f.destination} placeholder="Rome" autocomplete="off" required /></label>
    </div>

    <fieldset class="gs-set">
      <legend class="gs-k">When</legend>
      <div class="gs-row">
        <label class="gs-field"><span class="gs-sub">First day</span><input class="gs-in" type="date" bind:value={f.startDate} required /></label>
        <label class="gs-field"><span class="gs-sub">Last day</span><input class="gs-in" type="date" bind:value={f.endDate} min={f.startDate || undefined} required /></label>
      </div>
    </fieldset>

    <fieldset class="gs-set" bind:this={peopleEl}>
      <legend class="gs-k">Who</legend>
      {#if !f.travellers.length}<p class="dx-aside gs-hint">Add who is going — the planner plans for children’s ages and a sensible pace.</p>{/if}
      {#each f.travellers as p, pi (pi)}
        <div class="gs-person">
          <label class="gs-field"><span class="gs-sub">Name</span><input id="gs-name-{pi}" class="gs-in" bind:value={p.name} /></label>
          <label class="gs-field"><span class="gs-sub">Age, if a child</span><input class="gs-in age" type="number" min="0" max="120" inputmode="numeric" value={p.age ?? ''} oninput={(e) => (p.age = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))} /></label>
          <button class="dx-link danger" type="button" onclick={() => (f.travellers = f.travellers.filter((_, i) => i !== pi))} aria-label="Remove {p.name || 'this traveller'}">Remove</button>
        </div>
      {/each}
      <div class="gs-chips">
        {#each unlisted as m (m.id)}<button class="dx-pen" type="button" onclick={() => addPerson({ name: m.name, age: null, personId: m.id })}>+ {m.name}</button>{/each}
        <button class="dx-pen" type="button" onclick={() => addPerson()}>+ Someone else</button>
      </div>
    </fieldset>

    <fieldset class="gs-set">
      <legend class="gs-k">Pace</legend>
      <div class="gs-paces">
        {#each PACES as pc (pc.v)}
          <label class="gs-pace" class:on={f.pace === pc.v}>
            <input type="radio" name="gs-pace" value={pc.v} bind:group={f.pace} />
            <strong>{pc.label}</strong>
            <span class="dx-aside">{pc.line}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <fieldset class="gs-set">
      <legend class="gs-k">From your notes</legend>
      {#if notesState === 'idle'}
        <p class="dx-aside gs-hint">Once you’ve said where and when, anything your notes hold — flights, the stay, bookings — shows here to confirm.</p>
      {:else if notesState === 'looking'}
        <p class="dx-note" role="status"><span class="dx-pulse" aria-hidden="true"></span> Looking in your notes…</p>
      {:else if notesState === 'failed'}
        <p class="dx-note">Could not look in your notes just now. The planner will look again as it starts.</p>
      {:else if !notes.length}
        <p class="dx-note">Nothing in your notes about this trip.</p>
      {:else}
        <ul class="gs-notes" role="list">
          {#each notes as n (n.id)}
            <li>
              <label class="gs-note">
                <input type="checkbox" checked={ticked.has(n.id)} onchange={() => tick_(n.id)} />
                <span><strong>{n.label}</strong>{#if n.detail}<span class="dx-aside"> — {n.detail}</span>{/if}</span>
              </label>
            </li>
          {/each}
        </ul>
        <p class="dx-aside gs-hint">Ticked ones go in as facts, labelled “from your notes”. Untick anything wrong.</p>
      {/if}
    </fieldset>

    <label class="gs-field wide"><span class="gs-k">Anything else <span class="gs-opt">(optional)</span></span>
      <textarea class="gs-in gs-text" rows="2" bind:value={f.text} placeholder="We love food markets; no early starts; the Vatican is a must."></textarea>
    </label>

    <div class="gs-go">
      <button class="dx-btn" type="submit" disabled={sending}>{sending ? 'Starting…' : 'Start planning →'}</button>
      <span class="dx-aside gs-hint">It reads up on the place first, then offers two or three ways to do it.</span>
    </div>
    {#if problem}<p class="dx-err" role="alert">{problem}</p>{/if}
  </form>
{/if}

<style>
  .gs,
  .gs-progress {
    --np-tilt: 0deg;
    max-width: 880px;
    padding: 16px 20px 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .gs-progress:focus-visible {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .gs-h {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
  }
  .gs-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 20px;
  }
  .gs-set {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .gs-k {
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--np-pen-ink);
  }
  .gs-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--np-ink-soft);
  }
  .gs-opt {
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-muted);
  }
  .gs-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .gs-field.wide {
    flex: 1 1 100%;
  }
  .gs-in {
    font-family: var(--font-body);
    font-size: 18px;
    padding: 4px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-strong);
    border-radius: 0;
    background: transparent;
    color: var(--np-ink);
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
  }
  .gs-in.age {
    width: 6em;
  }
  .gs-in:focus {
    outline: none;
    border-bottom: 2px solid var(--accent-ink);
  }
  .gs-text {
    width: 100%;
    resize: vertical;
    line-height: 24px;
    background: repeating-linear-gradient(to bottom, transparent 0 23px, var(--np-rule) 23px 24px);
  }
  .gs-text::placeholder,
  .gs-in::placeholder {
    font-family: var(--fs-serif);
    font-style: italic;
    color: var(--text-muted);
  }
  .gs-hint {
    font-size: 15px;
    line-height: 22px;
  }
  .gs-person {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px 16px;
  }
  .gs-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .gs-paces {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
    gap: 10px;
  }
  .gs-pace {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 8px;
    align-items: baseline;
    padding: 8px 10px;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    cursor: pointer;
  }
  .gs-pace.on {
    border-color: var(--accent-ink);
    box-shadow: inset 0 3px 0 var(--accent);
  }
  .gs-pace:focus-within {
    outline: 2px solid var(--accent-ink);
    outline-offset: 2px;
  }
  .gs-pace .dx-aside {
    grid-column: 2;
    font-size: 15px;
    line-height: 20px;
  }
  .gs-notes {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .gs-note {
    display: flex;
    gap: 10px;
    align-items: baseline;
    padding: 5px 0;
    border-top: 1px dashed var(--line-strong);
    cursor: pointer;
  }
  .gs-notes li:first-child .gs-note {
    border-top: 0;
  }
  .gs-go {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
  }
  .gs-go a.dx-btn {
    text-decoration: none;
  }
  .gs-leave {
    font-size: 16px;
  }
</style>
