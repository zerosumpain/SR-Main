<svelte:options css="injected" />

<script lang="ts">
  // The landing page's header block as a marked-up sheet: the title stays
  // put, and the site's live numbers are inked around it as marginalia. The
  // pulse is circled at the end of a hand-drawn heartbeat that underlines the
  // title, today's steps are pencilled onto a ruler of the day, forty days of
  // deploys are tallied on the wall, the daydreamer's wait is a small dial,
  // the release total is a card pinned in the corner and the date is a stamp.
  // Same numbers, same honest states and the same footnotes as the sentence
  // (HeroSentence); notes.ts has the words and notes-ink.ts the pen.
  //
  // Each reading's label is a button that opens its explanation at the foot
  // of the sheet (a keyboard focus opens it too, so tabbing reads the sheet
  // note by note). "Fair copy" types the whole sheet up as a plain list,
  // which is also what prints.
  //
  // The ink is static: every stroke's wobble is baked into its path. What
  // moves keeps time off one clock, `--beat` (60/bpm seconds), through CSS
  // alone: the pen nib along the heartbeat, and the ring round the number,
  // redrawn once a beat from three takes. Motion stops with no fresh reading,
  // when the reader asks ("hold still"), off screen, in a hidden tab and under
  // prefers-reduced-motion.
  import { onMount, tick } from 'svelte';
  import type { CapabilityFacts } from '$lib/landing/capabilities';
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import {
    daydreamReading,
    fairCopy,
    plates,
    pulseReading,
    releasesReading,
    shipReading,
    stampPlace,
    stepsReading,
    type Reading,
  } from '$lib/landing/notes';
  import { inkHeart, inkHook, inkLine, rng } from '$lib/landing/notes-ink';
  import { shipDays, shipStats, stepsSummary, type DayCount } from '$lib/landing/rhythm';
  import { londonHour, noteNumber, readDaydream, type NoteId, type Pulse } from '$lib/landing/sentence';
  import type { StepsToday } from '$lib/landing/steps';
  import { clampBpm } from '$lib/landing/traces';
  import { localToday } from '$lib/constants/health-day';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import HeroTitle from './HeroTitle.svelte';
  import DateStamp from './notes/DateStamp.svelte';
  import DayDial from './notes/DayDial.svelte';
  import DayRuler from './notes/DayRuler.svelte';
  import FairCopy from './notes/FairCopy.svelte';
  import InkPulse from './notes/InkPulse.svelte';
  import InkRing from './notes/InkRing.svelte';
  import NotePlate from './notes/NotePlate.svelte';
  import NotesFoot from './notes/NotesFoot.svelte';
  import TallyWall from './notes/TallyWall.svelte';

  let {
    date,
    town,
    temp,
    pulse,
    v,
    now,
    facts,
    steps,
    cadence,
    releases,
  }: {
    /** "Fri 9 Oct", London time. */
    date: string;
    /** The town the readings come from, once the feed has said; never more precise. */
    town: string | undefined;
    /** °C there, or null until the weather is in. */
    temp: number | null;
    pulse: Pulse;
    /** The landing vitals poll; null until the first answer lands. */
    v: LandingVitals | null;
    now: number;
    facts: CapabilityFacts;
    steps: StepsToday | null;
    /** Deploys per London day from the first deploy on record, oldest first. */
    cadence: DayCount[];
    /** All releases on record and the first deploy, or null when the record is unavailable. */
    releases: { total: number; firstDeploy: string | null; days: number } | null;
  } = $props();

  let root: HTMLElement;

  /* ------------------------------------------------------------- the clock */

  let bpm = $derived(pulse.state === 'fresh' ? pulse.bpm : null);
  let held = $state(false);
  let away = $state(false);
  let reduced = $state(false);
  let typed = $state(false);
  let moving = $derived(bpm != null && !held && !away && !reduced && !typed);
  let lineW = $state(880);
  let lineH = $state(64);
  let line = $derived(inkHeart(bpm, lineW, lineH));
  // A primitive, so the re-sync below reruns when the count changes, not on
  // every resize that redraws the line with the same number of beats.
  let beats = $derived(line.beats);
  // The same clamp the line draws with, so the line and the clock agree.
  let drawn = $derived(bpm == null ? null : clampBpm(bpm));
  let exact = $derived(bpm != null && drawn === bpm);
  let beat = $derived(60 / (drawn ?? 60));

  /* ----------------------------------------------------------- the readings */

  let todayKey = $derived(localToday(new Date(now)));
  let days = $derived(cadence.length ? shipDays(cadence, todayKey) : []);
  let stats = $derived(shipStats(days));
  let daydream = $derived(readDaydream(v, facts.daydream, now));

  let rPulse = $derived(pulseReading(pulse, now));
  let rSteps = $derived(stepsReading(steps?.total ?? null));
  let rDream = $derived(daydreamReading(daydream, facts.daydream));
  let rShip = $derived(shipReading(days));
  let rRel = $derived(releasesReading(releases, now));
  let place = $derived(stampPlace(town, temp));

  // The ruler's now: the steps' own when they came in, else the clock's.
  let nowBin = $derived(steps?.nowBin ?? Math.min(95, Math.floor(londonHour(now) * 4)));

  let copy = $derived(
    plates({
      pulse,
      drawn,
      now,
      facts: facts.daydream,
      days,
      stats,
      releases: releases && releases.total > 0 ? { total: releases.total, days: releases.days } : null,
      dial: rDream.dial,
    }),
  );
  let fair = $derived(fairCopy({ date, place, pulse, now, steps: steps?.total ?? null, daydream: rDream, facts: facts.daydream, days, stats, releases: rRel }));

  /** What a screen reader hears for a label: the reading, or what stands in for a dash. */
  const named = (r: Reading) => (r.spoken ? `${r.unit}: ${r.spoken}` : `${r.value} ${r.unit}`);

  /* ------------------------------------------------------------- the ink */

  const HOOK = inkHook(40, 64);
  const UNDER = [inkLine(rng(5), 2, 3, 98, 4.5, 0.4, 0.01), inkLine(rng(6), 9, 8.5, 95, 9.5, 0.4, 0.01)].join(' ');

  let dial = $derived(rDream.dial);

  /* ------------------------------------------------------- the explanations */

  let pinned = $state<NoteId | null>(null);
  let peek = $state<NoteId | null>(null);
  let active = $derived(peek ?? pinned);
  // Set while Escape hands focus back to a label, so that focus does not reopen it.
  let hush: NoteId | null = null;

  function toggle(id: NoteId) {
    // Opened by a keyboard focus: pressing the label keeps it open rather than
    // shutting the note its reader just asked for.
    if (peek === id && pinned !== id) {
      pinned = id;
      peek = null;
    } else if (active === id) {
      pinned = null;
      peek = null;
    } else pinned = id;
  }

  // A keyboard focus opens a note; a click focuses without opening twice.
  function focusIn(e: FocusEvent, id: NoteId) {
    if (hush === id) {
      hush = null;
      return;
    }
    if ((e.target as Element).matches(':focus-visible')) peek = id;
  }
  function focusOut(e: FocusEvent, id: NoteId) {
    if ((e.currentTarget as Element).contains(e.relatedTarget as Node | null)) return;
    if (peek === id) peek = null;
  }

  /** A mark's wrapper: its tone, whether its note is open, and the focus that opens it. */
  const mark = (id: NoteId, tone: 'accent' | 'ink') => ({
    'data-tone': tone,
    'data-on': active === id ? '' : undefined,
    onfocusin: (e: FocusEvent) => focusIn(e, id),
    onfocusout: (e: FocusEvent) => focusOut(e, id),
  });
  /** A mark's label: the button that opens its note, described by its hint. */
  const label = (id: NoteId) => ({
    type: 'button' as const,
    'aria-expanded': active === id,
    'aria-controls': `np-${id}`,
    'aria-describedby': `nh-${id}`,
    onclick: () => toggle(id),
  });

  // Escape closes the open note from anywhere inside it and puts focus back on its label.
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !active) return;
    const id = active;
    pinned = null;
    peek = null;
    hush = id;
    root.querySelector<HTMLButtonElement>(`.nm-b[aria-controls="np-${id}"]`)?.focus();
  }

  function fairToggle() {
    typed = !typed;
    pinned = null;
    peek = null;
  }

  let tempo = $derived(
    drawn == null
      ? 'nothing to keep time to just now'
      : reduced
        ? `the line is drawn at ${drawn} bpm, and keeps still`
        : `the pen keeps time at ${drawn} bpm${exact ? '' : ', as near as it draws'}`,
  );

  /* -------------------------------------------------------------- lifecycle */

  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const readMotion = () => (reduced = motion.matches);
    readMotion();
    motion.addEventListener('change', readMotion);

    // Nobody watches a beat off screen or in a background tab.
    let visible = true;
    const settle = () => (away = !visible || document.hidden);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      settle();
    });
    io.observe(root);
    document.addEventListener('visibilitychange', settle);
    return () => {
      motion.removeEventListener('change', readMotion);
      io.disconnect();
      document.removeEventListener('visibilitychange', settle);
    };
  });

  // A new rate (or a redrawn line) changes every beat's duration at once; put
  // the nib and the ring back on the same downbeat. Once per change, never per frame.
  $effect(() => {
    void beat;
    void beats;
    if (!moving) return;
    void tick().then(() => {
      for (const a of root?.getAnimations({ subtree: true }) ?? []) {
        const el = (a.effect as KeyframeEffect | null)?.target;
        if (el instanceof Element && el.hasAttribute('data-beat')) a.currentTime = 0;
      }
    });
  });
</script>

{#snippet sup(id: NoteId)}<sup aria-hidden="true">{noteNumber(id)}</sup>{/snippet}

<div
  class="hn"
  bind:this={root}
  data-still={held || reduced ? '' : undefined}
  data-fair={typed ? '' : undefined}
  data-open={active ?? undefined}
  style:--beat="{beat.toFixed(4)}s"
  style:--beats={line.beats}
  style:--peak={line.peak}
  {onkeydown}
  role="presentation"
>
  <div class="hn-in">
    <div class="hn-grid">
      <div class="hn-mast">
        <!-- The rambler walks along the tops of these letters. -->
        <HeroTitle />
        <!-- The date, stamped in the empty corner beside "JK's". Not scenery: it is rotated. -->
        <DateStamp {date} {place} />
      </div>

      <!-- 1 · the pulse: the heartbeat underlines the title and runs into the ring. -->
      <div class="nm hn-pulse" {...mark('pulse', 'accent')}>
        <div class="hn-ecg ink">
          <InkPulse {line} {moving} bind:width={lineW} bind:height={lineH} />
          <svg class="hn-hook" viewBox="0 0 40 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path class:live={bpm != null} d={HOOK} />
          </svg>
        </div>
        <div class="hn-read ink">
          <button class="nm-b hn-ring" {...label('pulse')}>
            <InkRing boil={moving} blank={bpm == null} />
            <span class="hn-ring-n" class:dash={!!rPulse.spoken} aria-hidden="true">{rPulse.value}</span>
            <span class="hn-unit" aria-hidden="true">{rPulse.unit}{@render sup('pulse')}</span>
            <span class="vh">{named(rPulse)}</span>
          </button>
          <span class="hn-aside">{rPulse.aside}</span>
        </div>
        <NotePlate id="pulse" p={copy.pulse} open={active === 'pulse'} />
      </div>

      <!-- 2 · the steps: the ruler is the rambler's lookout. -->
      <div class="nm hn-steps" {...mark('steps', 'accent')}>
        <div class="hn-row">
          <button
            class="nm-b hn-fig"
            {...label('steps')}
          >
            <span class="hn-n" class:dash={!!rSteps.spoken} aria-hidden="true"
              >{rSteps.value}{#if !rSteps.spoken}<svg class="hn-under ink" viewBox="0 0 100 12" preserveAspectRatio="none" focusable="false"><path d={UNDER} /></svg>{/if}</span
            >
            <span class="hn-unit" aria-hidden="true">{rSteps.unit}{@render sup('steps')}</span>
            <span class="vh">{named(rSteps)}</span>
          </button>
          <span class="hn-aside">{rSteps.aside}</span>
        </div>
        <DayRuler bins={steps && steps.total != null ? steps.bins : null} {nowBin} summary={stepsSummary(steps)} />
        <NotePlate id="steps" p={copy.steps} open={active === 'steps'} />
      </div>

      <!-- 3 · the daydreamer: a dial shaded for the wait till the next think. -->
      <div class="nm hn-dd" {...mark('daydream', 'ink')}>
        <div class="hn-dd-in ink">
          <button
            class="nm-b hn-dd-b"
            {...label('daydream')}
          >
            <DayDial {dial} />
            <span class="hn-dd-t" aria-hidden="true">
              <span class="hn-unit">{rDream.unit}{@render sup('daydream')}</span>
              <span class="hn-dd-lead">{rDream.lead}</span>
              <span class="hn-dd-v">{rDream.value}</span>
            </span>
            <span class="vh">daydream: {rDream.lead} {rDream.value}</span>
          </button>
          <span class="hn-aside">{rDream.aside}</span>
        </div>
        <NotePlate id="daydream" p={copy.daydream} open={active === 'daydream'} />
      </div>

      <!-- 4 · the deploys: forty days tallied on the wall. The aside is the
           wall's caption, so the figure is one line whatever the numbers say
           and the band never changes height with them. -->
      <div class="nm hn-ship" {...mark('ship', 'accent')}>
        <div class="hn-row ink">
          <button
            class="nm-b hn-fig"
            {...label('ship')}
          >
            <span class="hn-n" class:dash={!!rShip.spoken} aria-hidden="true">{rShip.value}</span>
            <!-- A ledge: the tops of these letters are a floor between the ruler and the foot. -->
            <span class="hn-unit" aria-hidden="true" use:scenery={{ text: true }}>{rShip.unit}{@render sup('ship')}</span>
            <span class="vh">{named(rShip)}</span>
          </button>
          {#if days.length}<span class="vh">{rShip.aside}</span>{/if}
        </div>
        {#if days.length}<div class="ink"><TallyWall {days} caption={rShip.aside} /></div>{:else}<p class="hn-aside hn-nowall">{rShip.aside}</p>{/if}
        <NotePlate id="ship" p={copy.ship} open={active === 'ship'} />
      </div>

      <!-- 5 · the releases: a card pinned in the corner. Not scenery: it is rotated. -->
      <div class="nm hn-rel" {...mark('releases', 'ink')}>
        <div class="hn-card ink">
          <button
            class="nm-b hn-card-b"
            {...label('releases')}
          >
            <span class="hn-pin" aria-hidden="true"></span>
            <span class="hn-unit" aria-hidden="true">{rRel.unit}{@render sup('releases')}</span>
            <span class="hn-card-n" class:dash={!!rRel.spoken} aria-hidden="true">{rRel.value}</span>
            <span class="vh">{named(rRel)}</span>
            {#if rRel.spoken}
              <span class="hn-card-s">{rRel.aside}</span>
            {:else}
              <span class="hn-card-s">{rRel.since}</span>
              {#if rRel.span}<span class="hn-card-d">{rRel.span}</span>{/if}
            {/if}
          </button>
        </div>
        <NotePlate id="releases" p={copy.releases} open={active === 'releases'} />
      </div>

      <!-- Read only through each label's aria-describedby, never in reading order. -->
      <div hidden>
        {#each Object.entries(copy) as [id, p] (id)}<span id="nh-{id}">{p.hint}</span>{/each}
      </div>

      <NotesFoot {tempo} notes={copy} hold={bpm != null && !typed} bind:held {typed} onfair={fairToggle} />

      <!-- The sheet typed up: shown by "fair copy", and what prints. -->
      <FairCopy rows={fair} />
    </div>
  </div>
</div>

<style>
  .hn {
    --gut: clamp(16px, 4vw, 64px);
    --ctl: 200px;
    position: relative;
    background: var(--text-primary);
    color: var(--bg);
    /* Clear ink along the bottom: the rambler's ground is the hero's lower edge. */
    padding-bottom: clamp(24px, 3.2vh, 34px);
    /* The sheet: faint ruled lines, full bleed, behind everything. */
    background-image: repeating-linear-gradient(to bottom, transparent 0 31px, var(--on-ink-05) 31px 32px);
    background-position: 0 14px;
  }
  .hn-in {
    position: relative;
    max-width: 1312px;
    margin: 0 auto;
    padding: clamp(20px, 3.5vh, 36px) var(--gut) 0;
  }
  .vh {
    position: absolute !important;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  /* ------------------------------------------------------------- the grid */

  .hn-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    /* The ruler straight under the pulse, so the rambler's lookout is within
       a drop of the title on a phone. */
    grid-template-areas: 'mast' 'pulse' 'steps' 'dd' 'ship' 'rel' 'foot';
    row-gap: 22px;
  }
  .hn-mast {
    grid-area: mast;
    position: relative;
  }
  .hn-pulse {
    grid-area: pulse;
  }
  .hn-steps {
    grid-area: steps;
  }
  .hn-dd {
    grid-area: dd;
  }
  .hn-ship {
    grid-area: ship;
  }
  .hn-rel {
    grid-area: rel;
  }

  /* ------------------------------------------------- the marks, in common */

  /* A mark: its label, its ink and its explanation. Proof-reader's corner
     marks frame it on hover (faint) and while its note is open (full), drawn
     as backgrounds so the mark itself stays unpositioned and its note can
     hang from the foot of the sheet. */
  .nm {
    --tone: var(--accent-on-dark);
    --cm: transparent;
    margin: -10px;
    padding: 10px;
    background:
      linear-gradient(var(--cm), var(--cm)) top left / 14px 2px no-repeat,
      linear-gradient(var(--cm), var(--cm)) top left / 2px 14px no-repeat,
      linear-gradient(var(--cm), var(--cm)) top right / 14px 2px no-repeat,
      linear-gradient(var(--cm), var(--cm)) top right / 2px 14px no-repeat,
      linear-gradient(var(--cm), var(--cm)) bottom left / 14px 2px no-repeat,
      linear-gradient(var(--cm), var(--cm)) bottom left / 2px 14px no-repeat,
      linear-gradient(var(--cm), var(--cm)) bottom right / 14px 2px no-repeat,
      linear-gradient(var(--cm), var(--cm)) bottom right / 2px 14px no-repeat;
  }
  .nm[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  .nm:has(.nm-b:hover) {
    --cm: color-mix(in srgb, var(--tone) 45%, transparent);
  }
  .nm[data-on] {
    --cm: var(--tone);
  }

  /* Labels are real buttons, set as type: a value and its small caps. */
  .nm-b {
    position: relative;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .nm-b:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 5px;
    border-radius: 2px;
  }
  .hn-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--tone);
    white-space: nowrap;
  }
  .hn-unit sup {
    margin-left: 0.25em;
    font-size: var(--fs-label-xs);
    line-height: 0;
    letter-spacing: 0;
    vertical-align: 0.5em;
  }
  /* Marginalia: lower case, Fraunces italic, in a softer ink. */
  .hn-aside {
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-style: italic;
    font-size: 16px;
    line-height: 1.3;
    color: var(--on-ink-70);
  }
  .hn-n {
    position: relative;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(28px, 2.3vw, 34px);
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    color: var(--bg);
  }
  .dash {
    color: var(--on-ink-55) !important;
    letter-spacing: 0;
  }
  .hn-fig {
    display: inline-flex;
    align-items: baseline;
    gap: 10px;
  }
  /* At least 44px wide and tall to a finger, without opening the layout. */
  .hn-fig::after {
    content: '';
    position: absolute;
    inset: -8px -6px;
    min-width: 44px;
  }
  .hn-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin-bottom: 14px;
  }

  /* ---------------------------------------------------------------- pulse */

  .hn-pulse {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 10px;
  }
  .hn-ecg {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    height: 56px;
  }
  .hn-hook {
    display: none;
  }
  .hn-hook path {
    fill: none;
    stroke: var(--on-ink-30);
    stroke-width: 1.5;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  /* In the same ink as the line it finishes (InkPulse). */
  .hn-hook path.live {
    stroke: var(--accent-on-dark);
    stroke-width: 2;
    opacity: 0.62;
  }
  .hn[data-still] .hn-hook path.live {
    opacity: 0.85;
  }
  .hn-read {
    position: relative;
    min-height: 94px;
  }
  /* The ring's focus takes in its label and aside, not a box through them. */
  .hn-ring:focus-visible {
    outline: none;
  }
  .hn-read:has(.hn-ring:focus-visible) {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
    border-radius: 2px;
  }
  .hn-ring {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .hn-ring-n {
    position: absolute;
    left: 0;
    top: 0;
    width: 116px;
    height: 94px;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 46px;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--accent-on-dark);
  }
  .hn-ring .hn-unit {
    padding-top: 18px;
  }
  .hn-read .hn-aside {
    position: absolute;
    left: 128px;
    top: 42px;
    max-width: 150px;
  }

  /* ---------------------------------------------------------------- steps */

  .hn-under {
    position: absolute;
    left: -2px;
    right: -2px;
    bottom: -12px;
    width: calc(100% + 4px);
    height: 12px;
    overflow: visible;
  }
  .hn-under path {
    fill: none;
    stroke: var(--accent-on-dark);
    stroke-width: 2;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  /* Room under the figure for its double underline, even when the aside wraps below it. */
  .hn-steps .hn-row {
    row-gap: 18px;
    margin-bottom: 22px;
  }

  /* ------------------------------------------------------------- daydream */

  .hn-dd-in {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    column-gap: 14px;
    row-gap: 6px;
    align-items: start;
  }
  .hn-dd-b {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
  }
  .hn-dd-in > .hn-aside {
    grid-column: 2;
  }
  .hn-dd-t {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .hn-dd-lead {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 1.2;
    color: var(--on-ink-80);
  }
  .hn-dd-v {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 26px;
    line-height: 1.05;
    letter-spacing: -0.025em;
    color: var(--accent-ink-on-dark);
  }

  /* ---------------------------------------------------------------- ship */

  /* The figure alone, on one line: its aside is the wall's caption. */
  .hn-ship .hn-row {
    flex-wrap: nowrap;
    margin-bottom: 8px;
    white-space: nowrap;
  }
  /* No record: the wall is left bare, at its usual height, rather than tallied
     with zeros; the aside says why. */
  .hn-nowall {
    margin: 0;
  }

  /* ------------------------------------------------------------- releases */

  /* A cream index card pinned to the sheet, a degree or two off true. Ink on
     paper inside, so it reads in the same colours as print. */
  .hn-card {
    display: flex;
    justify-content: flex-start;
    padding-top: 10px;
  }
  .hn-card-b {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    width: min(100%, 230px);
    padding: 18px 20px 16px;
    background: var(--bg);
    color: var(--text-primary);
    transform: rotate(1.6deg);
  }
  .hn-card-b:focus-visible {
    outline-offset: 6px;
  }
  .hn-card-b .hn-unit {
    color: var(--accent-ink);
  }
  .hn-pin {
    position: absolute;
    top: -6px;
    left: 50%;
    width: 13px;
    height: 13px;
    margin-left: -6px;
    border-radius: 100px;
    background: radial-gradient(circle at 35% 35%, #f6b37a 0 2px, var(--accent-on-dark) 3px, #b2561a 100%);
  }
  .hn-card-n {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    line-height: 1;
    letter-spacing: -0.035em;
    font-variant-numeric: tabular-nums;
  }
  .hn-card-n.dash {
    color: rgba(26, 16, 8, 0.65) !important;
  }
  .hn-card-s {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: 16px;
    line-height: 1.25;
    color: var(--text-secondary);
  }
  .hn-card-d {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgba(26, 16, 8, 0.72);
  }

  /* Typed up, the scribbles go; the ruler stays, as the rambler's lookout. */
  .hn[data-fair] .ink:not(.hn-steps *),
  .hn[data-fair] .hn-steps .hn-under {
    visibility: hidden;
  }

  /* ---------------------------------------------- desktop: the whole sheet */

  @media (min-width: 761px) {
    .hn-grid {
      column-gap: clamp(32px, 4vw, 56px);
      row-gap: 0;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      grid-template-areas: 'mast mast' 'pulse pulse' 'steps ship' 'dd rel' 'foot foot';
    }
    .hn-pulse {
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      margin-top: 2px;
    }
    .hn-ecg {
      grid-template-columns: minmax(0, 1fr) 40px;
      height: 64px;
    }
    .hn-hook {
      display: block;
      width: 40px;
      height: 64px;
      overflow: visible;
    }
    .hn-read {
      width: 290px;
    }
    .hn-steps,
    .hn-ship {
      margin-top: 2px;
    }
    .hn-nowall {
      height: 151px;
    }
    /* The ruler's box runs down to the foot of the band, so its side is a
       wall the rambler can reach from the hero's bottom edge and climb. */
    .hn-steps {
      display: flex;
      flex-direction: column;
    }
    .hn-steps > :global(.dr) {
      flex: 1;
    }
    .hn-dd,
    .hn-rel {
      margin-top: 18px;
    }
  }
  @media (min-width: 1100px) {
    .hn-grid {
      grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 0.78fr);
      grid-template-areas: 'mast mast dd' 'pulse pulse pulse' 'steps ship rel' 'foot foot foot';
    }
    .hn-mast {
      width: fit-content;
    }
    .hn-pulse {
      grid-template-columns: subgrid;
    }
    /* The curl runs on across the gutter, into the ring. */
    .hn-ecg {
      grid-column: 1 / 3;
      margin-right: calc(-1 * clamp(32px, 4vw, 56px) + 2px);
    }
    .hn-read {
      width: auto;
    }
    .hn-dd {
      align-self: center;
      margin-top: 10px;
    }
    .hn-rel {
      margin-top: 8px;
    }
  }

  /* ------------------------------------------------------------- phones */

  @media (max-width: 760px) {
    .hn-ecg {
      height: 48px;
    }
    .hn-mast {
      padding-right: 0;
    }
    .hn-aside {
      font-size: 15px;
    }
    .hn[data-fair] .ink:not(.hn-steps *) {
      display: none;
    }
    .hn[data-fair] .nm:not(.hn-steps) {
      display: none;
    }
  }

  /* Print: the title and the fair copy, ink on paper, every number legible. */
  @media print {
    .hn {
      background: none;
      color: #1a1008;
      padding-bottom: 12px;
    }
    /* The readings go; the fair copy (FairCopy) prints in their place. */
    .hn-grid > :not(.hn-mast) {
      display: none;
    }
  }
</style>
