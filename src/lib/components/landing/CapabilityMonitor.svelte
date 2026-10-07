<script lang="ts">
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { ago, until } from '$lib/landing/live-vitals.svelte';
  import type { CapabilityFacts } from '$lib/landing/capabilities';
  import type { StepsToday } from '$lib/landing/steps';
  import {
    ecgTrace,
    tickTrace,
    spikeTrace,
    stepsTrace,
    hourMarks,
  } from '$lib/landing/traces';

  interface Day {
    date: string;
    count: number;
  }

  let {
    meta,
    v,
    now,
    bpm,
    bpmAt,
    facts,
    steps,
    releases,
    days,
  }: {
    /** Date and town, set small beside the title. */
    meta: string;
    /** The landing vitals poll; null until the first answer lands. */
    v: LandingVitals | null;
    now: number;
    /** Live heart rate, or null when no real HR source is reporting. */
    bpm: number | null;
    /** When the watch took that reading (ISO), or null with no live reading. */
    bpmAt: string | null;
    facts: CapabilityFacts;
    steps: StepsToday | null;
    /** All-time release count, or null when the record is unavailable. */
    releases: number | null;
    /** Deploys per day over the showcase window, oldest first. */
    days: Day[];
  } = $props();

  type ChannelId = 'pulse' | 'steps' | 'daydream' | 'ship' | 'releases';
  interface Channel {
    id: ChannelId;
    label: string;
    sub: string;
    tone: 'accent' | 'ink';
    value: string;
    unit: string;
    path: string;
    /** A second, fainter path: the steps strip's hour marks. */
    marks?: string;
    detail: string;
    href: string;
    cta: string;
  }

  let picked = $state<ChannelId>('pulse');

  const SHIP_DAYS = 40;

  let todayKey = $derived(new Date(now).toISOString().slice(0, 10));
  let shipDays = $derived(days.slice(-SHIP_DAYS));
  let deploysToday = $derived(days.length ? (days.find((d) => d.date === todayKey)?.count ?? 0) : null);

  const fmtDay = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  let channels = $derived.by<Channel[]>(() => {
    const dd = facts.daydream;
    const hit = dd.hitRate == null ? null : Math.round(dd.hitRate * 100);
    const live = v?.daydream;
    const next = live && !live.paused ? until(live.nextRunAt, now) : '';
    const hours = `${String(dd.activeHours.start).padStart(2, '0')}:00–${String(dd.activeHours.end).padStart(2, '0')}:00`;

    return [
      {
        id: 'pulse',
        label: 'Pulse',
        sub: bpmAt ? `Apple Watch · ${ago(bpmAt, now)}` : 'Apple Watch',
        tone: 'accent',
        value: bpm != null ? String(bpm) : '—',
        unit: 'bpm',
        path: ecgTrace(bpm),
        detail: 'The owner’s heart rate as the Apple Watch last read it, sent up by the phone. The trace beats at exactly that rate.',
        href: '/health',
        cta: 'Health record',
      },
      {
        id: 'steps',
        label: 'Steps',
        sub: '00:00 → 23:59',
        tone: 'accent',
        value: steps?.total != null ? steps.total.toLocaleString('en-GB') : '—',
        unit: 'steps today',
        path: steps ? stepsTrace(steps.bins, steps.nowBin) : stepsTrace([], -1),
        marks: hourMarks(),
        detail: 'Today on foot, a quarter-hour per bar: midnight at the left edge, 23:59 at the right. The ticks are 06:00, noon and 18:00.',
        href: '/health',
        cta: 'Health record',
      },
      {
        id: 'daydream',
        label: 'Daydream',
        sub: `every ${dd.cadenceMinutes} min`,
        tone: 'ink',
        value: next ? next.replace(/^in /, '') : live?.paused ? 'asleep' : `${dd.cadenceMinutes}m`,
        unit: next ? 'next think' : live?.paused ? hours : 'cycle',
        path: tickTrace(Math.round((24 * 60) / dd.cadenceMinutes / 4), 10, !!next),
        detail:
          `Between ${hours} the site asks itself one narrow question at a time and writes down only what is worth attention.` +
          (hit != null ? ` ${hit}% of rated notes were useful over the last ${dd.windowDays} days.` : ''),
        href: '/projects/engine-room/daydream',
        cta: 'How Daydream works',
      },
      {
        id: 'ship',
        label: 'Ship',
        sub: `last ${SHIP_DAYS} days`,
        tone: 'accent',
        value: deploysToday != null ? String(deploysToday) : '—',
        unit: 'deploys today',
        path: spikeTrace(shipDays.map((d) => d.count)),
        detail: 'Each spike is a day of deploys. Click one to read what shipped that day.',
        href: '/releases',
        cta: 'Browse the record',
      },
      {
        id: 'releases',
        label: 'Releases',
        sub: `per day · ${days.length || 90} days`,
        tone: 'ink',
        value: releases != null ? releases.toLocaleString('en-GB') : '—',
        unit: 'since March',
        path: spikeTrace(days.map((d) => d.count), days.length || 90),
        detail: `Releases per day over the last ${days.length || 90} days, each one summarised from its own commit range.`,
        href: '/releases',
        cta: 'Browse the record',
      },
    ];
  });

  let sel = $derived(channels.find((c) => c.id === picked) ?? channels[0]);
</script>

<div class="mon-hero">
  <div class="mon-in">
  <div class="mon-top">
    <!-- The rambler walks along the tops of these letters. -->
    <h1 class="mon-title">JK’s<br /><span use:scenery={{ text: true }}>strange ramblings</span></h1>
    <p class="mon-lede">I say things, I do things, and I share things. And look hey, now you see things</p>
    <p class="mon-meta">{meta}</p>
  </div>

  <div class="mon" role="group" aria-label="Live capability monitor" use:scenery={{ spot: 'lookout', at: 0.86 }}>
    {#each channels as c (c.id)}
      <div class="row">
        <button
          type="button"
          class="ch"
          class:on={c.id === picked}
          data-tone={c.tone}
          aria-pressed={c.id === picked}
          aria-controls="mon-detail"
          onclick={() => (picked = c.id)}
        >
          <span class="ch-l">
            <span class="ch-label">{c.label}</span>
            <span class="ch-sub">{c.sub}</span>
          </span>
          <span class="ch-t" aria-hidden="true">
            <svg viewBox="0 0 1000 60" preserveAspectRatio="none">
              {#if c.marks}<path class="marks" d={c.marks} fill="none" vector-effect="non-scaling-stroke" />{/if}
              <path d={c.path} fill="none" vector-effect="non-scaling-stroke" />
            </svg>
            <span class="sweep"></span>
          </span>
          <span class="ch-v">
            <span class="ch-val">{c.value}</span>
            <span class="ch-unit">{c.unit}</span>
          </span>
        </button>
        {#if c.id === 'ship' && shipDays.length}
          <!-- One link per day, laid over the spikes: a sibling of the row's
               button, never inside it. Kept out of the tab order (forty stops
               in a hero is a trap); the detail strip's link is the keyboard
               route to the same record. -->
          <div class="days">
            {#each shipDays as d (d.date)}
              <a
                class="day"
                href="/releases?from={d.date}&to={d.date}"
                tabindex="-1"
                aria-label="{fmtDay(d.date)}: {plural(d.count, 'deploy')}"
                title="{fmtDay(d.date)} · {plural(d.count, 'deploy')}"
              ></a>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    <div id="mon-detail" class="detail" aria-live="polite">
      <p class="detail-k">{sel.label}</p>
      <p class="detail-p">{sel.detail}</p>
      <a class="detail-cta" href={sel.href}>{sel.cta} <span aria-hidden="true">→</span></a>
    </div>
  </div>
  </div>
</div>

<style>
  /* The page's own 1312px measure, so the monitor lines up with the title
     above and the grid below and reads as an instrument set into the
     masthead, not a band that stretches with the screen. On a wide monitor
     the ink still runs edge to edge; the traces stop at the column. */
  .mon-hero {
    --col-l: 168px;
    /* Wide enough for the longest reading on one line: "12,345 steps today"
       or "asleep 07:00–23:00". A narrower column lets the value spill left
       over the end of its trace. */
    --col-v: 220px;
    --line: rgba(237, 228, 212, 0.1);
    background: var(--text-primary);
    color: var(--bg);
  }
  .mon-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 clamp(16px, 4vw, 64px) clamp(28px, 5vh, 48px);
  }

  /* The masthead: the name on two lines, then the subtitle on one. */
  .mon-top {
    padding: clamp(20px, 3.5vh, 36px) 0 clamp(18px, 3vh, 28px);
  }
  .mon-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(var(--fs-display-sm), 5vw, var(--fs-display-md));
    line-height: 0.9;
    letter-spacing: -0.04em;
    text-transform: uppercase;
  }
  .mon-lede {
    margin: 14px 0 6px;
    font-size: var(--fs-body-lg);
    line-height: 1.4;
    color: rgba(237, 228, 212, 0.82);
  }
  .mon-meta {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }

  /* One row per capability, every trace swept by the same cursor on the same
     clock, so the stack reads as one instrument. Kept low and quiet: the
     masthead is the headline, the monitor is the evidence beneath it. */
  .mon {
    border: 1px solid var(--line);
  }
  .row {
    position: relative;
  }
  .row + .row .ch {
    border-top: 1px solid var(--line);
  }
  .ch {
    --tone: var(--bg);
    display: grid;
    grid-template-columns: var(--col-l) minmax(0, 1fr) var(--col-v);
    align-items: stretch;
    width: 100%;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--bg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .ch[data-tone='accent'] {
    --tone: var(--accent-on-dark);
  }
  .ch[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  .ch:hover {
    background: rgba(237, 228, 212, 0.03);
  }
  .ch.on {
    background: rgba(232, 134, 58, 0.06);
  }
  .ch:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: -2px;
  }
  .ch-l,
  .ch-v {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 0 14px;
    min-width: 0;
  }
  .ch-v {
    flex-direction: row;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }
  .ch-label,
  .ch-unit,
  .detail-k,
  .detail-cta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .ch-label {
    color: var(--tone);
  }
  .ch-sub {
    font-size: var(--fs-label-xs);
    color: rgba(237, 228, 212, 0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ch-unit {
    color: rgba(237, 228, 212, 0.5);
    letter-spacing: 0.08em;
    white-space: nowrap;
  }
  .ch-val {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    line-height: 1.1;
    color: var(--tone);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ch-t {
    position: relative;
    overflow: hidden;
    opacity: 0.7;
    transition: opacity 0.2s ease;
  }
  .ch:hover .ch-t,
  .ch.on .ch-t {
    opacity: 1;
  }
  .ch-t svg {
    position: absolute;
    top: 5px;
    left: 0;
    width: 100%;
    height: calc(100% - 10px);
  }
  .ch-t path {
    stroke: var(--tone);
    stroke-width: 1.25;
  }
  .ch-t path.marks {
    stroke: rgba(237, 228, 212, 0.3);
    stroke-width: 1;
  }
  .sweep {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -56px;
    width: 56px;
    background: linear-gradient(90deg, rgba(26, 16, 8, 0), var(--text-primary) 75%);
    animation: sweep 6s linear infinite;
    pointer-events: none;
  }
  .sweep::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 1px;
    background: var(--accent-on-dark);
    opacity: 0.8;
  }
  @keyframes sweep {
    to {
      left: 100%;
    }
  }

  /* Clickable days over the Ship spikes. Same columns as the row, so day i sits
     exactly over spike i. */
  .days {
    position: absolute;
    top: 0;
    bottom: 0;
    left: var(--col-l);
    right: var(--col-v);
    display: flex;
  }
  .day {
    flex: 1;
  }
  .day:hover {
    background: rgba(232, 134, 58, 0.2);
    box-shadow: inset 0 -2px 0 var(--accent-on-dark);
  }

  /* The explanation: a quiet footer line inside the instrument, not a band. */
  .detail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    padding: 6px 6px 6px 14px;
    border-top: 1px solid var(--line);
    background: rgba(237, 228, 212, 0.03);
  }
  .detail-k {
    margin: 0;
    color: var(--accent-on-dark);
  }
  .detail-p {
    flex: 1 1 360px;
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    color: rgba(237, 228, 212, 0.72);
  }
  .detail-cta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 12px;
    color: var(--bg);
    text-decoration: none;
    white-space: nowrap;
  }
  .detail-cta:hover {
    color: var(--accent-on-dark);
  }
  .detail-cta:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: -2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .sweep {
      display: none;
    }
    .ch-t {
      transition: none;
    }
  }
  @media (max-width: 760px) {
    .mon-lede {
      font-size: var(--fs-body);
    }
  }
  @media (max-width: 900px) {
    .mon-hero {
      --col-l: 92px;
      --col-v: 96px;
    }
    .ch {
      height: 48px;
    }
    .ch-l,
    .ch-v {
      padding: 0 10px;
    }
    .ch-v {
      flex-direction: column;
      align-items: flex-end;
      justify-content: center;
      gap: 1px;
    }
    .ch-sub {
      display: none;
    }
    .ch-unit {
      white-space: normal;
      text-align: right;
      letter-spacing: 0.06em;
      line-height: 1.15;
    }
  }
</style>
