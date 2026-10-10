<svelte:options css="injected" />

<script lang="ts">
  // The landing page's header block: the title, then the site's live numbers
  // read out as one sentence instead of a dashboard. A heartbeat line runs
  // under the title at the rate the watch last read; each number in the
  // sentence is a value word that unfolds its footnote in place; forty days of
  // shipping sit underneath as a line of numerals.
  //
  // Everything that moves keeps time off one clock, `--beat` (60/bpm seconds),
  // through CSS alone: the line's sweep, the glow on the pulse, the ship row's
  // playhead. Nothing is written per frame. Motion stops with no fresh reading,
  // when the reader asks it to ("hold still"), off screen, in a hidden tab and
  // under prefers-reduced-motion.
  import { onMount, tick } from 'svelte';
  import type { CapabilityFacts } from '$lib/landing/capabilities';
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { scenery } from '$lib/landing/ramblers/scenery';
  import { releaseCalendar, shipDays, shipStats, dayName, thinkSchedule, type DayCount } from '$lib/landing/rhythm';
  import {
    buildSentence,
    clock,
    noteNumber,
    readDaydream,
    agoWords,
    type NoteId,
    type Pulse,
  } from '$lib/landing/sentence';
  import type { StepsToday } from '$lib/landing/steps';
  import { BPM_MAX, BPM_MIN, clampBpm, heartLine } from '$lib/landing/traces';
  import { localToday } from '$lib/constants/health-day';
  import HeartLine from './HeartLine.svelte';
  import HeroTitle from './HeroTitle.svelte';
  import HeroNote, { type NoteVisual } from './HeroNote.svelte';
  import ShipRhythm from './ShipRhythm.svelte';

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
    tagline,
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
    /** The masthead's subtitle (HeroTitle): the owner's line from /admin/content/hero, or the default. */
    tagline: string;
  } = $props();

  let root: HTMLElement;

  /* ------------------------------------------------------------- the clock */

  let bpm = $derived(pulse.state === 'fresh' ? pulse.bpm : null);
  let held = $state(false);
  let away = $state(false);
  let reduced = $state(false);
  let moving = $derived(bpm != null && !held && !away && !reduced);
  let lineW = $state(1440);
  let lineH = $state(72);
  let line = $derived(heartLine(bpm, lineW, lineH));
  // A primitive, so the re-sync below reruns when the count changes, not on
  // every resize that rebuilds `line` with the same number of beats.
  let beats = $derived(line.beats);
  // The same clamp heartLine draws with, so the line and the clock agree. It
  // spans every rate on record; only an implausible reading is drawn at the
  // nearest end, and then the copy stops calling the rate exact.
  let drawn = $derived(bpm == null ? null : clampBpm(bpm));
  let exact = $derived(bpm != null && drawn === bpm);
  let beat = $derived(60 / (drawn ?? 60));
  // The glow is a small blink on one word; above three a second it sits out.
  let glows = $derived(drawn != null && drawn <= 180);

  /* ----------------------------------------------------------- the numbers */

  // The owner's day, as the dateline and the steps keep it.
  let todayKey = $derived(localToday(new Date(now)));
  let days = $derived(cadence.length ? shipDays(cadence, todayKey) : []);
  let stats = $derived(shipStats(days));
  let daydream = $derived(readDaydream(v, facts.daydream, now));
  let sentence = $derived(
    buildSentence({
      now,
      temp,
      pulse,
      steps: steps?.total ?? null,
      daydream,
      deploys: days.length ? { today: days[days.length - 1].count, yesterday: days[days.length - 2].count } : null,
      releases: releases && releases.total > 0 ? { total: releases.total, since: releases.firstDeploy } : null,
    }),
  );

  /* --------------------------------------------------------- the footnotes */

  let open = $state<NoteId | null>(null);

  interface Note {
    tone: 'accent' | 'ink';
    /** Read on focus, so the word explains itself without being opened. */
    hint: string;
    head: string;
    text: string;
    href: string;
    cta: string;
    visual: NoteVisual;
  }

  let notes = $derived.by<Record<NoteId, Note>>(() => {
    const dd = facts.daydream;
    const hours = `${clock(dd.activeHours.start)}–${clock(dd.activeHours.end)}`;
    const hit = dd.hitRate == null ? null : Math.round(dd.hitRate * 100);
    const live = v?.daydream;
    const busiest = stats.busiest;
    return {
      pulse: {
        tone: 'accent',
        hint: 'Heart rate, from the Apple Watch.',
        // A stale reading's age stays off the page, as in the sentence.
        head: `Pulse · Apple Watch · ${pulse.state === 'fresh' ? `read ${agoWords(pulse.at, now)}` : 'no fresh reading'}`,
        text:
          'My heart rate as the Apple Watch last read it, sent up by the phone. ' +
          (bpm == null
            ? 'With no fresh reading the line above lies flat rather than make one up.'
            : exact
              ? 'The line above beats at exactly that rate, and so does everything else here that moves.'
              : `The line above draws ${BPM_MIN} to ${BPM_MAX} a minute, so it beats at ${drawn}, the nearest it can.`),
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'pulse', bpm: drawn },
      },
      steps: {
        tone: 'accent',
        hint: 'Steps since midnight, from the phone.',
        head: 'Steps · 00:00 → 23:59 · a quarter-hour per bar',
        text: 'Today on foot, a quarter-hour per bar: midnight at the left edge, 23:59 at the right. Nothing is drawn after now.',
        href: '/health',
        cta: 'Health record',
        visual: { kind: 'steps', steps },
      },
      daydream: {
        tone: 'ink',
        hint: 'When the site next thinks to itself.',
        head: `Daydream · every ${dd.cadenceMinutes} min · ${hours}`,
        text:
          `Between ${clock(dd.activeHours.start)} and ${clock(dd.activeHours.end)} the site asks itself one narrow question at a time and writes down only what is worth attention.` +
          (hit != null ? ` ${hit}% of rated notes were useful over the last ${dd.windowDays} days.` : ''),
        href: '/projects/engine-room/daydream',
        cta: 'How Daydream works',
        visual: {
          kind: 'daydream',
          thinks: thinkSchedule(
            now,
            dd.cadenceMinutes,
            dd.activeHours,
            live && !live.paused && daydream.state !== 'late' ? live.nextRunAt : null,
          ),
          off: daydream.state === 'off',
        },
      },
      ship: {
        tone: 'accent',
        hint: 'Deploys today.',
        head: `Ship · ${days.at(-1)?.count ?? 0} today · ${days.at(-2)?.count ?? 0} yesterday · last ${days.length} days`,
        text:
          'Each spike is a day of deploys, oldest on the left and today on the right. ' +
          (busiest
            ? `${stats.total.toLocaleString('en-GB')} in ${days.length} days, the busiest ${busiest.count} on ${dayName(busiest.date)}, and ${stats.quiet} days with none.`
            : `Nothing in ${days.length} days.`),
        href: '/releases',
        cta: 'Browse the record',
        visual: { kind: 'ship', days },
      },
      releases: {
        tone: 'ink',
        hint: 'Every release on record.',
        head: `Releases · ${(releases?.total ?? 0).toLocaleString('en-GB')} over ${releases?.days ?? 0} days`,
        text: 'Releases per day since the first, a month to a row, each one summarised from its own commit range.',
        href: '/releases',
        cta: 'Browse the record',
        visual: { kind: 'releases', months: releaseCalendar(cadence, todayKey) },
      },
    };
  });

  function toggle(id: NoteId) {
    open = open === id ? null : id;
  }

  // Escape closes the open note from anywhere inside it and puts focus back on its word.
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !open) return;
    const id = open;
    open = null;
    root.querySelector<HTMLButtonElement>(`.w[aria-controls="fn-${id}"]`)?.focus();
  }

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

  // A new rate (or a resized line) changes every beat's duration at once; put
  // the sweep, the glow and the playhead back on the same downbeat so they stay
  // in step with each other. Once per change, never per frame.
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

<div
  class="hs"
  bind:this={root}
  data-still={held || reduced ? '' : undefined}
  style:--beat="{beat.toFixed(4)}s"
  style:--beats={line.beats}
  style:--peak={line.peak}
>
  <div class="hs-in hs-top">
    <!-- The rambler walks along the tops of these letters. -->
    <HeroTitle {tagline} />
  </div>

  <div class="hs-line">
    <HeartLine {line} {moving} bind:width={lineW} bind:height={lineH} />
  </div>

  <div class="hs-in hs-body">
    <!-- The dateline hangs in the margin column on desktop, inline on a phone;
         the caption sits beside the sentence's foot, the ship row under both. -->
    <!-- The lookout: he sits on the sentence and looks out over the line. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <p class="hs-say" use:scenery={{ spot: 'lookout', at: 0.86 }} {onkeydown}>
      <span class="hs-date"
        >{#if town}<span class="hs-town">{town}</span><span class="hs-sep" aria-hidden="true">{' · '}</span><span
            class="vh">, </span
          >{/if}<span>{date}</span><span class="vh">. </span></span
      >{sentence.opening}{#each sentence.clauses as c (c.id)}{@const n = noteNumber(c.id)}{@const note = notes[c.id]}{@const glued = !c.tail && !c.aside}{c.lead}<span
          class="nb"
          ><button
            type="button"
            class="w"
            class:dash={!!c.spoken}
            class:beat={c.id === 'pulse' && moving && glows}
            data-beat={c.id === 'pulse' ? '' : undefined}
            data-tone={note.tone}
            aria-expanded={open === c.id}
            aria-controls="fn-{c.id}"
            aria-describedby="fd-{c.id}"
            onclick={() => toggle(c.id)}
            >{#if c.spoken}<span aria-hidden="true">{c.word}</span><span class="vh">{c.spoken}</span>{:else}{c.word}{/if}</button
          >{#if glued}{c.end}{/if}<sup aria-hidden="true">{n}</sup></span
        >{#if !glued}{c.tail}{#if c.aside}&nbsp;<span class="aside">({c.aside})</span>{/if}{c.end}{/if}<HeroNote
          id="fn-{c.id}"
          {n}
          open={open === c.id}
          tone={note.tone}
          head={note.head}
          text={note.text}
          href={note.href}
          cta={note.cta}
          visual={note.visual}
        />{/each}{sentence.closing}
    </p>
    <!-- Read only through each word's aria-describedby, never in reading order. -->
    <div hidden>
      {#each sentence.clauses as c (c.id)}<span id="fd-{c.id}">{notes[c.id].hint}</span>{/each}
    </div>

    <p class="hs-cap">
      <span class="hs-tempo"
        >{#if drawn == null}nothing to keep time to just now{:else if reduced}the line is drawn at {drawn} bpm, and keeps
          still{:else if exact}everything here keeps time at {drawn} bpm{:else}everything here keeps time at {drawn} bpm, as
          near as it draws{/if} · tap a coloured word</span
      >
      {#if bpm != null}
        <button type="button" class="hs-hold" aria-pressed={held} onclick={() => (held = !held)}>
          <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            {#if held}<path d="M2 1 L9 5 L2 9 Z" />{:else}<path d="M1.5 1h2.5v8H1.5zM6 1h2.5v8H6z" />{/if}
          </svg>
          hold still
        </button>
      {/if}
    </p>

    {#if days.length}
      <div class="hs-ship">
        <ShipRhythm {days} {moving} />
      </div>
    {/if}

  </div>
</div>

<style>
  .hs {
    --gut: clamp(16px, 4vw, 64px);
    --margin: 0px;
    --say: clamp(21px, 2.05vw, 30px);
    /* The sentence's line height, shared with the value words' tap targets. */
    --say-lh: 1.3;
    background: var(--text-primary);
    color: var(--bg);
    /* Clear ink along the bottom: the rambler's ground is the hero's lower edge. */
    padding-bottom: clamp(30px, 4.5vh, 44px);
  }
  /* The page's 1312px measure, so the sentence lines up with the grid below;
     only the heartbeat line runs the full bleed. */
  .hs-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut);
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

  /* The masthead: the name on two lines, then the subtitle on one. */
  .hs-top {
    padding-top: clamp(20px, 3.5vh, 36px);
  }

  .hs-line {
    height: 72px;
    margin: clamp(6px, 1.2vh, 14px) 0 clamp(6px, 1vh, 12px);
  }

  /* The sentence, with the dateline and the caption in its margin. */
  .hs-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 14px;
  }
  .hs-say {
    position: relative;
    margin: 0;
    font-family: var(--fs-serif);
    font-optical-sizing: auto;
    font-weight: 400;
    font-size: var(--say);
    line-height: var(--say-lh);
    letter-spacing: -0.012em;
    color: rgba(237, 228, 212, 0.9);
    text-wrap: pretty;
  }
  .hs-date {
    margin-right: 0.6em;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    line-height: 1.6;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    vertical-align: 0.25em;
    white-space: nowrap;
  }
  .aside {
    font-style: italic;
    color: var(--on-ink-70);
  }
  .nb {
    white-space: nowrap;
  }

  /* Value words: real buttons, set as type. Each is its own stacking context,
     so the glow can sit behind its letters (z-index -1) and over the ink. */
  .w {
    --tone: var(--accent-on-dark);
    position: relative;
    z-index: 0;
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    font-family: var(--font-display);
    font-size: max(0.88em, var(--fs-label-xs));
    letter-spacing: -0.025em;
    font-variant-numeric: tabular-nums;
    color: var(--tone);
    cursor: pointer;
    text-decoration: underline dotted;
    text-decoration-thickness: 0.06em;
    text-underline-offset: 0.18em;
    text-decoration-color: color-mix(in srgb, var(--tone) 55%, transparent);
    -webkit-tap-highlight-color: transparent;
  }
  .w[data-tone='ink'] {
    --tone: var(--accent-ink-on-dark);
  }
  /* A bigger target without opening up the line: at least 44px wide, and as
     tall as the line it sits on, less a hair, so a word never reaches into the
     line above or below and steals a neighbour's tap. A word in a sentence is
     the inline case WCAG 2.5.8 allows for; the width does the rest. */
  .w::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: max(100% + 8px, 44px);
    height: calc(var(--say) * var(--say-lh) - 4px);
    transform: translate(-50%, -50%);
  }
  .w:hover,
  .w[aria-expanded='true'] {
    text-decoration-style: solid;
    text-decoration-color: var(--tone);
  }
  .w:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
    border-radius: 2px;
  }
  .w.dash {
    color: var(--on-ink-55);
    letter-spacing: 0;
  }
  /* The footnote numeral: after the word, or after its punctuation when the
     punctuation follows at once ("40 minutes.³"), as type sets a note mark. */
  .nb > sup {
    display: inline-block;
    margin-left: 0.12em;
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-label-xs);
    letter-spacing: 0;
    line-height: 1;
    /* Raised by a share of the sentence's size, not the numeral's, so it sits
       at cap height on a phone as on a desktop. */
    vertical-align: calc(var(--say) * 0.42);
    color: var(--on-ink-55);
  }
  /* The pulse glows on each beat, landing on the R wave as the sweep crosses
     it. A soft blob behind the word whose opacity alone animates, so the
     compositor does the work and the paragraph is never laid out again. */
  .w::before {
    content: '';
    position: absolute;
    z-index: -1;
    inset: -0.3em -0.5em;
    background: radial-gradient(closest-side, rgba(232, 134, 58, 0.42), rgba(232, 134, 58, 0));
    opacity: 0;
    pointer-events: none;
  }
  .w.beat::before {
    will-change: opacity;
    animation: hs-glow var(--beat) ease-out calc(var(--beat) * var(--peak)) infinite;
  }
  @keyframes hs-glow {
    0% {
      opacity: 1;
    }
    45%,
    100% {
      opacity: 0;
    }
  }

  /* One quiet line: what keeps time, and the switch that stops it. */
  .hs-cap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 14px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.6;
    letter-spacing: 0.06em;
    color: var(--on-ink-55);
  }
  .hs-hold {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 2px 0;
    border: 0;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    color: var(--on-ink-80);
    cursor: pointer;
  }
  .hs-hold::after {
    content: '';
    position: absolute;
    inset: -10px -8px;
  }
  .hs-hold:hover,
  .hs-hold[aria-pressed='true'] {
    color: var(--accent-on-dark);
  }
  .hs-hold:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .hs-hold svg {
    width: 9px;
    height: 9px;
    fill: currentColor;
  }

  /* Desktop: a margin column holds the dateline beside the first line and the
     caption beside the ship row; the sentence fills the column next to it. */
  @media (min-width: 900px) {
    .hs-body {
      --margin: clamp(176px, 15vw, 224px);
      grid-template-columns: var(--margin) minmax(0, 1fr);
      grid-template-areas: 'cap say' 'ship ship';
      column-gap: 32px;
      row-gap: 16px;
    }
    .hs-say {
      grid-area: say;
    }
    .hs-ship {
      grid-area: ship;
    }
    /* Beside the sentence's last lines, clear of the dateline at its top. */
    .hs-cap {
      grid-area: cap;
      align-self: end;
      align-content: end;
      padding: 56px 0 6px;
    }
    .hs-date {
      position: absolute;
      top: calc((var(--say-lh) * var(--say) - 1.6 * 12px) / 2 + 2px);
      left: calc(-1 * (var(--margin) + 32px));
      width: var(--margin);
      margin: 0;
      white-space: normal;
      vertical-align: baseline;
    }
    .hs-town {
      display: block;
    }
    .hs-sep {
      display: none;
    }
  }
  @media (max-width: 760px) {
    .hs-line {
      height: 56px;
    }
    .hs {
      --say-lh: 1.38;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .w.beat::before {
      animation: none;
    }
    .hs-hold {
      display: none;
    }
  }
  /* "Hold still" also stops the glow and the playhead, not just the line. */
  .hs[data-still] .w.beat::before {
    animation: none;
  }

  /* Print: ink on paper, every number legible, every footnote open. */
  @media print {
    .hs {
      background: none;
      color: #1a1008;
      padding-bottom: 12px;
    }
    .hs-line,
    .hs-hold {
      display: none;
    }
    .hs-say,
    .hs-cap,
    .aside {
      color: #1a1008;
    }
    .hs-date,
    .w,
    .w.dash,
    .nb > sup {
      color: #1a1008;
      text-decoration-color: currentColor;
    }
    .w::before {
      display: none;
    }
  }
</style>
