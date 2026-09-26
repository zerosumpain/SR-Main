<script lang="ts">
  /**
   * "Your day" — the signed-in person's own day from the iPhone app, on their
   * own /home/people page. What the pilot's retired Movement tab showed: the
   * day's track on a map, and under it a timeline (heart rate, sleep,
   * workouts, journeys and stops) that owns a cursor — move along it and a dot
   * follows you round the map.
   *
   * Collapsed by default behind "Show my day": the page is long on a phone
   * already, and nothing is fetched until it is asked for. Data comes from
   * /api/home/people/my-day, keyed on the session alone. Days are bucketed in
   * THIS browser's timezone offset, as the dashboard did.
   *
   * The pure reading of the day lives in `$lib/home/presence/day-timeline`.
   */
  import DayMap from './DayMap.svelte';
  import type { DayPoint, DayTimeline, DayTrack } from '$lib/home/presence/companion-accounts';
  import {
    clockAt,
    dayChoices,
    duration,
    heartRateAt,
    heartRateRuns,
    kilometres,
    momentAt,
    segmentsFor,
    sleepBands,
    stepsForDay,
    workoutSpans,
  } from '$lib/home/presence/day-timeline';

  type Day = { date: string; tz: number; track: DayTrack; timeline: DayTimeline };

  let open = $state(false);
  let choices = $state<Array<{ date: string; label: string }>>([]);
  let date = $state('');
  let tz = $state(0);
  let loading = $state(false);
  let problem = $state<'' | 'no-account' | 'error'>('');
  let problemText = $state('');
  // Raw, not a deep proxy: a day is hundreds of tuples and nothing mutates them.
  let day = $state.raw<Day | null>(null);
  let cursorAt = $state<number | null>(null);
  let width = $state(0);

  // Not state: read by nothing in the template (svelte5-pitfalls §1).
  let inflight: AbortController | null = null;

  async function load(d: string) {
    inflight?.abort();
    const ctrl = new AbortController();
    inflight = ctrl;
    loading = true;
    problem = '';
    cursorAt = null;
    try {
      const res = await fetch(`/api/home/people/my-day?date=${encodeURIComponent(d)}&tz=${tz}`, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (ctrl.signal.aborted) return;
      if (res.status === 404 && body?.error === 'no-account') {
        problem = 'no-account';
        day = null;
      } else if (!res.ok) {
        problem = 'error';
        problemText = typeof body?.error === 'string' ? body.error : 'The day could not be read just now.';
        day = null;
      } else {
        day = body as Day;
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      problem = 'error';
      problemText = 'The day could not be read just now.';
      day = null;
    } finally {
      if (inflight === ctrl) {
        inflight = null;
        loading = false;
      }
    }
  }

  function show() {
    tz = new Date().getTimezoneOffset();
    choices = dayChoices(Math.floor(Date.now() / 1000), tz);
    date = choices[0].date;
    open = true;
    void load(date);
  }

  function pick(d: string) {
    if (!d || d === date) return;
    date = d;
    void load(d);
  }

  const index = $derived(choices.findIndex((c) => c.date === date));

  // ── The day, read ────────────────────────────────────────────────────────
  const track = $derived(day?.track ?? null);
  const timeline = $derived(day?.timeline ?? null);
  const segments = $derived(track ? segmentsFor(track) : []);
  const from = $derived(track?.from ?? 0);
  const to = $derived(track?.to ?? 86_400);
  const sleep = $derived(timeline ? sleepBands(timeline.sleep, from, to) : []);
  const asleepSeconds = $derived(sleep.reduce((s, [a, b]) => s + (b - a), 0));
  const workouts = $derived(timeline ? workoutSpans(timeline.workouts, from, to) : []);
  const steps = $derived(timeline ? stepsForDay(timeline.steps, from, to) : null);
  const hrRuns = $derived(timeline ? heartRateRuns(timeline.heartRate) : []);
  const hrValues = $derived(timeline ? timeline.heartRate.bins.map(([, v]) => v) : []);
  const hrLow = $derived(hrValues.length ? Math.min(...hrValues) : 0);
  const hrHigh = $derived(hrValues.length ? Math.max(...hrValues) : 0);
  const stops = $derived(track ? track.activities.filter((a) => a.kind === 'stop').length : 0);

  const moment = $derived(track && cursorAt !== null ? momentAt(track.points, cursorAt, track.gapSeconds) : null);
  const cursorPoint = $derived<DayPoint | null>(moment?.point ?? null);

  // ── Timeline geometry ────────────────────────────────────────────────────
  const H = 168;
  const PAD_L = 34;
  const PAD_R = 8;
  const HR_TOP = 16;
  const HR_H = 80;
  const WORK_TOP = HR_TOP + HR_H + 10;
  const REC_TOP = WORK_TOP + 16;
  const plot = $derived(Math.max(10, width - PAD_L - PAD_R));
  const x = (t: number) => PAD_L + ((t - from) / (to - from || 1)) * plot;
  const hrY = (v: number) => HR_TOP + HR_H - ((v - hrLow) / Math.max(1, hrHigh - hrLow)) * (HR_H - 8) - 4;
  const hrPaths = $derived(
    hrRuns.map((run) => run.map(([t, v], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${hrY(v).toFixed(1)}`).join('')),
  );
  const tickEvery = $derived(width < 520 ? 6 : 3);
  const ticks = $derived(Array.from({ length: Math.floor(24 / tickEvery) + 1 }, (_, i) => from + i * tickEvery * 3600));

  function scrubTo(clientX: number, el: Element) {
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left - PAD_L) / plot));
    cursorAt = from + ratio * (to - from);
  }
  function onKey(e: KeyboardEvent) {
    const step = (e.shiftKey ? 30 : 5) * 60;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const base = cursorAt ?? (track?.points[0]?.[2] ?? from);
      cursorAt = Math.min(to, Math.max(from, base + (e.key === 'ArrowRight' ? step : -step)));
    } else if (e.key === 'Escape') {
      cursorAt = null;
    }
  }

  const readout = $derived.by(() => {
    if (!track) return '';
    if (cursorAt === null) {
      if (!track.points.length) return 'No location was recorded on this day.';
      const first = track.points[0][2];
      const last = track.points[track.points.length - 1][2];
      return `Recorded ${clockAt(first, tz)} to ${clockAt(last, tz)}. Move along the timeline to follow the day.`;
    }
    const parts = [clockAt(cursorAt, tz)];
    const bpm = timeline ? heartRateAt(timeline.heartRate, cursorAt) : null;
    if (bpm) parts.push(`${bpm} bpm`);
    const p = moment?.point;
    if (p) {
      parts.push(`${(p[5] * 3.6).toFixed(1)} km/h`, p[4] ? 'moving' : 'still', `±${Math.round(p[3])} m`);
      if ((moment?.gap ?? 0) > 60) parts.push(`nearest fix ${duration(moment?.gap ?? 0)} away`);
    } else {
      parts.push(moment?.gap != null ? 'no fix — the phone was asleep' : 'no location recorded');
    }
    return parts.join(' · ');
  });

  const dayLabel = $derived(choices[index]?.label ?? date);
</script>

<div class="your-day">
  {#if !open}
    <p class="lede">Your own track and health for any of the last 31 days, from your iPhone. Only you see this.</p>
    <button type="button" class="show" onclick={show}>Show my day</button>
  {:else}
    <div class="picker">
      <button type="button" class="step" onclick={() => pick(choices[index + 1]?.date)} disabled={index >= choices.length - 1 || loading} aria-label="Previous day">←</button>
      <label class="pick">
        <span class="vh">Day</span>
        <select value={date} onchange={(e) => pick((e.currentTarget as HTMLSelectElement).value)}>
          {#each choices as c (c.date)}
            <option value={c.date}>{c.label}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="step" onclick={() => pick(choices[index - 1]?.date)} disabled={index <= 0 || loading} aria-label="Next day">→</button>
      <button type="button" class="hide" onclick={() => (open = false)}>Hide</button>
    </div>

    {#if problem === 'no-account'}
      <p class="lede">Your iPhone isn’t set up with the SR app yet. <a href="/welcome">Set it up</a> and your days fill in as it syncs.</p>
    {:else if problem === 'error'}
      <p class="lede" role="alert">{problemText}</p>
    {:else if !day}
      <p class="lede" role="status">Reading your day…</p>
    {:else if track}
      <dl class="figs" aria-busy={loading}>
        <div><dt>Recorded</dt><dd class="num">{kilometres(track.totals.metres)}</dd></div>
        <div><dt>Moving</dt><dd class="num">{duration(track.totals.movingSeconds)}</dd></div>
        <div><dt>Steps</dt><dd class="num">{steps != null ? steps.toLocaleString('en-GB') : '—'}</dd></div>
        <div><dt>Asleep</dt><dd class="num">{asleepSeconds ? duration(asleepSeconds) : '—'}</dd></div>
        <div><dt>Journeys</dt><dd class="num">{track.totals.journeys}<span class="sub">&nbsp;· {stops} stop{stops === 1 ? '' : 's'}</span></dd></div>
      </dl>

      {#if track.points.length}
        <DayMap points={track.points} {segments} cursor={cursorPoint} label="Your track, {dayLabel}" />
      {:else}
        <p class="lede">No location was recorded on this day{timeline?.heartRate.bins.length ? ' — the health below still is' : ''}.</p>
      {/if}

      <div class="timeline" bind:clientWidth={width}>
        {#if width}
          <svg
            width={width}
            height={H}
            viewBox="0 0 {width} {H}"
            role="slider"
            tabindex="0"
            aria-label="Timeline of {dayLabel}: heart rate, sleep, workouts, journeys. Arrow keys move the cursor."
            aria-valuemin={0}
            aria-valuemax={1440}
            aria-valuenow={cursorAt === null ? undefined : Math.round((cursorAt - from) / 60)}
            aria-valuetext={cursorAt === null ? 'No time selected' : readout}
            onpointermove={(e) => scrubTo(e.clientX, e.currentTarget)}
            onpointerdown={(e) => scrubTo(e.clientX, e.currentTarget)}
            onpointerleave={(e) => {
              if (e.pointerType === 'mouse') cursorAt = null;
            }}
            onkeydown={onKey}
          >
            {#each sleep as [a, b] (a)}
              <rect class="sleep" x={x(a)} y={HR_TOP} width={Math.max(1, x(b) - x(a))} height={HR_H} />
            {/each}
            {#each ticks as t, i (t)}
              <line class="grid" x1={x(t)} x2={x(t)} y1={HR_TOP} y2={REC_TOP + 12} />
              {#if i < ticks.length - 1}
                <text class="axis" x={x(t) + 3} y={H - 4}>{clockAt(t, tz)}</text>
              {/if}
            {/each}
            {#if hrPaths.length}
              {#each hrPaths as d, i (i)}
                <path class="hr" {d} />
              {/each}
              <text class="axis" x="2" y={hrY(hrHigh) + 4}>{hrHigh}</text>
              <text class="axis" x="2" y={hrY(hrLow) + 4}>{hrLow}</text>
              <text class="axis" x="2" y={HR_TOP - 5}>bpm</text>
            {:else}
              <text class="axis" x={PAD_L} y={HR_TOP + HR_H / 2}>No heart rate recorded for this day</text>
            {/if}
            {#each workouts as w (w.start)}
              <rect class="workout" x={x(w.from)} y={WORK_TOP} width={Math.max(2, x(w.to) - x(w.from))} height={10}>
                <title>{w.activity} · {duration(w.seconds)} from {clockAt(Date.parse(w.start) / 1000, tz)}</title>
              </rect>
            {/each}
            <rect class="rec-off" x={PAD_L} y={REC_TOP} width={plot} height={8} />
            {#each track.activities as a (a.first + ':' + a.kind)}
              <rect class={a.kind === 'journey' ? 'rec-journey' : 'rec-stop'} x={x(a.from)} y={REC_TOP} width={Math.max(2, x(a.to) - x(a.from))} height={8} />
            {/each}
            {#if cursorAt !== null}
              <line class="cursor" x1={x(cursorAt)} x2={x(cursorAt)} y1={HR_TOP} y2={REC_TOP + 8} />
            {/if}
          </svg>
        {/if}
      </div>
      <p class="readout" aria-live="polite">{readout}</p>
      <p class="key" aria-hidden="true">
        <span><i class="k-sleep"></i>Asleep</span>
        <span><i class="k-hr"></i>Heart rate</span>
        <span><i class="k-workout"></i>Workout</span>
        <span><i class="k-journey"></i>Journey</span>
        <span><i class="k-stop"></i>Stopped</span>
      </p>
      {#if track.truncated}
        <p class="note">Only the most recent fixes are shown — this account has more than the app keeps in one view.</p>
      {/if}
      <p class="note">
        Location is kept for {track.retentionDays ?? 30} days on the app server, then deleted. A dashed line is time the phone
        was asleep: where you went in between is not known.
      </p>
    {/if}
  {/if}
</div>

<style>
  .your-day {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .show,
  .hide,
  .step,
  .pick select {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-primary);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 2px;
    padding: 8px 12px;
    cursor: pointer;
  }
  .show {
    align-self: flex-start;
    background: var(--text-primary);
    color: var(--bg);
    border-color: var(--text-primary);
  }
  .show:hover {
    background: var(--accent);
    border-color: var(--accent);
  }
  .step:hover:not(:disabled),
  .hide:hover,
  .pick select:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .step:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .show:focus-visible,
  .hide:focus-visible,
  .step:focus-visible,
  .pick select:focus-visible,
  svg:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .picker {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pick select {
    text-transform: none;
    letter-spacing: 0.04em;
    min-width: 12ch;
  }
  .hide {
    margin-left: auto;
    color: var(--text-secondary);
  }
  .figs {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    border-top: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
  }
  .figs div {
    padding: 10px 12px 10px 0;
  }
  .figs dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .figs dd {
    margin: 4px 0 0;
    font-family: var(--font-display);
    font-size: 1.35rem;
    color: var(--text-primary);
  }
  .figs .sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .figs[aria-busy='true'] {
    opacity: 0.55;
  }
  .timeline {
    width: 100%;
    min-height: 168px;
    touch-action: pan-y;
  }
  svg {
    display: block;
    cursor: crosshair;
    user-select: none;
  }
  .sleep {
    fill: var(--accent-ink);
    opacity: 0.16;
  }
  .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .axis {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--text-muted);
  }
  .hr {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.75;
    stroke-linejoin: round;
  }
  .workout {
    fill: var(--accent-ink);
  }
  .rec-off {
    fill: var(--line-hair);
  }
  .rec-journey {
    fill: var(--text-primary);
  }
  .rec-stop {
    fill: var(--text-muted);
    opacity: 0.55;
  }
  .cursor {
    stroke: var(--text-primary);
    stroke-width: 1.5;
  }
  .readout {
    margin: 0;
    min-height: 1.5em;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .key {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .key span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .key i {
    display: inline-block;
    width: 14px;
    height: 8px;
  }
  .k-sleep {
    background: var(--accent-ink);
    opacity: 0.25;
  }
  .key i.k-hr {
    height: 2px;
    background: var(--accent);
  }
  .k-workout {
    background: var(--accent-ink);
  }
  .k-journey {
    background: var(--text-primary);
  }
  .k-stop {
    background: var(--text-muted);
    opacity: 0.55;
  }
  .note {
    margin: 0;
    font-size: var(--fs-body-sm);
    color: var(--text-secondary);
  }
  .vh {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  @media (max-width: 719px) {
    .figs {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .figs dd {
      font-size: 1.1rem;
    }
  }
</style>
