<svelte:options css="injected" />

<script lang="ts">
  // The landing page's header block, drawn as a place: the title hangs in the
  // sky over a small modern city made of the site's live numbers. Read the
  // skyline left to right as then to now: a distant skyline of every release
  // day from the first to six weeks ago, a street of the last forty days (a
  // building a day, a lit pane per deploy), and the tallest tower, whose beacon
  // keeps the last heart rate. Today's steps run along the promenade on the
  // day's own scale, and the next daydream gathers as a cloud beside the title.
  // The sky, and the light on the city, is the real light where the owner is
  // just now (the server sends only the sun's height and whether it climbs,
  // never where), or over the north of England when it has none to give: warm
  // windows and silhouettes at night, the low sun catching one side of every
  // tower at either end of the day, sunlit glass under a pale sky by day, when
  // the type on the sky turns from cream to ink (sky.ts `tone`).
  //
  // Each reading is a small label pinned to its part of the picture. Pointing
  // at one, focusing it or tapping it lights that part, dims the rest and puts
  // its explanation in the one plate, so there is no key to read first.
  //
  // Only two things move, both CSS off `--beat` (60/bpm seconds): the beacon
  // (`lamp` below), and a brief rain when a think fires. The beacon never
  // flashes more than three times a second: lub-dub to 90 a minute, one flash
  // a beat to 180, then lit and steady. Both stop with no fresh reading, when the reader asks ("hold
  // still"), off screen, in a hidden tab and under prefers-reduced-motion; the
  // rain pauses rather than restarts. Everything the rambler stands on is static.
  import { onMount, tick } from 'svelte';
  import type { CapabilityFacts } from '$lib/landing/capabilities';
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { binOf, cloud, footpath, lampFor, ridge, skyAt, skyVars, starfield } from '$lib/landing/place';
  import { city, cityLight, cityVars } from '$lib/landing/place-city';
  import { skyLight, type OwnerSun } from '$lib/landing/sun';
  import { lampCaption, placePlates, placeTags, tagLine } from '$lib/landing/place-copy';
  import { shipDays, shipStats, type DayCount } from '$lib/landing/rhythm';
  import { londonHour, NOTES, readDaydream, type NoteId, type Pulse } from '$lib/landing/sentence';
  import type { StepsToday } from '$lib/landing/steps';
  import { clampBpm } from '$lib/landing/traces';
  import { localToday } from '$lib/constants/health-day';
  import HeroTitle from './HeroTitle.svelte';
  import PlaceCloud from './place/PlaceCloud.svelte';
  import PlaceLabels from './place/PlaceLabels.svelte';
  import PlacePlate from './place/PlacePlate.svelte';
  import PlaceSkyProps from './place/PlaceSkyProps.svelte';
  import PlaceWorld from './place/PlaceWorld.svelte';

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
    sun = null,
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
    /** The sun where the owner is (whole degrees, rising or not), or null for the default sky. */
    sun?: OwnerSun | null;
  } = $props();

  let root: HTMLElement;

  /* ------------------------------------------------------------- the clock */

  let bpm = $derived(pulse.state === 'fresh' ? pulse.bpm : null);
  let held = $state(false);
  let away = $state(false);
  let reduced = $state(false);
  let moving = $derived(bpm != null && !held && !away && !reduced);
  // The lamp keeps the real rate; only an implausible one is held to the
  // nearest the hero draws, and the plate then says so.
  let drawn = $derived(bpm == null ? null : clampBpm(bpm));
  let beat = $derived(60 / (drawn ?? 60));
  let lamp = $derived(lampFor(drawn));

  /* ------------------------------------------------------------- the place */

  // The owner's day, as the dateline and the steps keep it.
  let todayKey = $derived(localToday(new Date(now)));
  let hour = $derived(londonHour(now));
  // The light where the owner is, from the server's sun; the north of England
  // (and the London morning) when it has none to give.
  let light = $derived(skyLight(sun, now, hour < 12));
  let sky = $derived(skyAt(light.alt, light.morning));
  // The sky and the city's light on it, as custom properties: nothing about where.
  let lightVars = $derived(`${skyVars(sky)};${cityVars(cityLight(sky))}`);
  // A sun low enough to stand in the skyline's haze, where no text sits.
  let lowSun = $derived(sky.sunUp && sky.sunY < 0.12);
  // Type turns from cream to ink in one step (sky.ts DAY_TONE_ALT). The sky
  // eases between two lights, but never across that step: for the frame it
  // happens in, nothing transitions, so type never sits on a half-changed sky.
  let snap = $state(false);
  let lastTone: string | undefined;
  $effect.pre(() => {
    const tone = sky.tone;
    if (lastTone !== undefined && tone !== lastTone) {
      snap = true;
      requestAnimationFrame(() => requestAnimationFrame(() => (snap = false)));
    }
    lastTone = tone;
  });
  const stars = starfield();

  let days = $derived(cadence.length ? shipDays(cadence, todayKey) : []);
  let stats = $derived(shipStats(days));
  let hills = $derived(ridge(cadence, todayKey));
  let houses = $derived(days.length ? city(days) : null);
  let path = $derived(footpath(steps, binOf(hour)));
  let daydream = $derived(readDaydream(v, facts.daydream, now));
  let weather = $derived(cloud(daydream, facts.daydream.cadenceMinutes));
  // "Hold still" is offered while something here moves: a flashing lamp, or rain.
  let stirs = $derived(lamp === 'lubdub' || lamp === 'flash' || weather.mode === 'rain');

  /* ------------------------------------------------------------ the labels */

  let tags = $derived(
    placeTags({
      now,
      pulse,
      steps: steps?.total ?? null,
      daydream,
      cadenceMinutes: facts.daydream.cadenceMinutes,
      deploys: days.length ? { today: days[days.length - 1].count, yesterday: days[days.length - 2].count } : null,
      releases: releases && releases.total > 0 ? { total: releases.total, since: releases.firstDeploy } : null,
    }),
  );
  let plates = $derived(
    placePlates({
      now,
      pulse,
      facts: facts.daydream,
      days,
      stats,
      releases,
      ridge: hills,
    }),
  );

  let degrees = $derived(temp == null || !Number.isFinite(temp) ? null : Math.round(temp));
  let dateline = $derived(
    [town, date, degrees == null ? null : `${degrees < 0 ? `−${-degrees}` : degrees}°`, sky.word].filter(Boolean).join(' · '),
  );

  // What the plate explains, strongest first: the label the keyboard is on
  // (a look, not a choice), the one clicked or tapped open, and the part under
  // the mouse. An open label beats the mouse, so the pointer can cross other
  // parts on its way to the plate's link without the plate changing under it.
  let peek = $state<NoteId | null>(null);
  let pinned = $state<NoteId | null>(null);
  let hover = $state<NoteId | null>(null);
  let shown = $derived(peek ?? pinned ?? hover);
  let leaving: ReturnType<typeof setTimeout> | undefined;

  const tagButton = (id: NoteId) => root.querySelector<HTMLButtonElement>(`.pl-tag[data-part="${id}"] button`);

  function onfocus(e: FocusEvent, id: NoteId) {
    if ((e.currentTarget as HTMLElement).matches(':focus-visible')) peek = id;
  }

  // A click or tap toggles, so a second tap closes. Enter or Space (a click
  // with no pointer behind it) always opens, and takes focus to the plate's
  // link, which tabs on to the next label as if it sat right after this one.
  function choose(e: MouseEvent, id: NoteId) {
    if (e.detail !== 0) {
      pinned = pinned === id ? null : id;
      return;
    }
    pinned = id;
    peek = null;
    void tick().then(() => root.querySelector<HTMLAnchorElement>('.pl-link')?.focus());
  }

  // A look lasts while focus is on its label or has gone on into the plate's
  // words (the last label tabs straight to the link); anywhere else ends it.
  function onfocusout(e: FocusEvent) {
    if (!(e.relatedTarget as Element | null)?.closest?.('.pl-say')) peek = null;
  }

  function onlinkkey(e: KeyboardEvent) {
    if (e.key !== 'Tab' || !pinned) return;
    const to = e.shiftKey ? pinned : NOTES[NOTES.indexOf(pinned) + 1];
    // From the last label's link, Tab carries on to "hold still" as usual.
    if (!to) return;
    e.preventDefault();
    pinned = null;
    tagButton(to)?.focus();
  }

  // The pointer lights whichever part it is over, the picture's or a label's.
  // Off every part it lets go after a moment.
  function onpointerover(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return;
    const t = e.target as Element;
    clearTimeout(leaving);
    const part = t.closest<HTMLElement>('[data-part]')?.dataset.part as NoteId | undefined;
    if (part) hover = part;
    else if (!t.closest('.pl-plate')) leaving = setTimeout(() => (hover = null), 450);
  }

  // Escape closes the open label (or the one being looked at) from anywhere in
  // the hero and puts focus back on it, without that focus opening it again.
  function onkeydown(e: KeyboardEvent) {
    const id = pinned ?? peek;
    if (e.key !== 'Escape' || !id) return;
    pinned = null;
    tagButton(id)?.focus();
    peek = null;
  }

  /* -------------------------------------------------------------- lifecycle */

  onMount(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const readMotion = () => (reduced = motion.matches);
    readMotion();
    motion.addEventListener('change', readMotion);

    // Nobody watches a lamp off screen or in a background tab.
    let visible = true;
    const settle = () => (away = !visible || document.hidden);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      settle();
    });
    io.observe(root);
    document.addEventListener('visibilitychange', settle);
    return () => {
      clearTimeout(leaving);
      motion.removeEventListener('change', readMotion);
      io.disconnect();
      document.removeEventListener('visibilitychange', settle);
    };
  });

  // A new rate changes the lamp's and the beam's beat at once; put them back
  // on the same downbeat. Once per change, never per frame.
  $effect(() => {
    void beat;
    if (!moving) return;
    void tick().then(() => {
      for (const a of root?.getAnimations({ subtree: true }) ?? []) {
        const el = (a.effect as KeyframeEffect | null)?.target;
        if (el instanceof Element && el.hasAttribute('data-beat')) a.currentTime = 0;
      }
    });
  });
</script>

<PlaceSkyProps />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pl"
  bind:this={root}
  data-still={held || away || reduced ? '' : undefined}
  data-lamp={lamp}
  data-focus={shown ?? undefined}
  data-sky={sky.word}
  data-tone={sky.tone}
  data-snap={snap ? '' : undefined}
  data-side={sky.side}
  style={lightVars}
  style:--beat="{beat.toFixed(4)}s"
  {onkeydown}
  {onfocusout}
  {onpointerover}
  onpointerleave={() => {
    clearTimeout(leaving);
    hover = null;
  }}
>
  {#if sky.stars > 0}
    <svg class="pl-stars" viewBox="0 0 1000 300" preserveAspectRatio="xMidYMin slice" aria-hidden="true" focusable="false">
      {#each stars as [x, y, r], i (i)}<circle cx={x} cy={y} r={r * 0.62} />{/each}
    </svg>
  {/if}
  <div class="pl-in">
    <div class="pl-box">
      <div class="pl-top">
        <!-- The rambler walks along the tops of these letters. -->
        <HeroTitle {tagline} />
      </div>

      <!-- The sky beside the title: the next daydream, gathering. -->
      <PlaceCloud {weather} />

      <!-- The city. Its parts are pictures; every number is in a label. -->
      <div class="pl-world">
        <PlaceWorld {hills} {houses} {bpm} {path} sun={lowSun} />
      </div>

      <!-- The readings, in the sentence's order: real buttons pinned to their parts. -->
      <PlaceLabels {tags} {hills} {houses} {shown} {pinned} {choose} {onfocus} />
      <!-- Read only through each label's aria-describedby, never in reading order. -->
      <div hidden>
        {#each NOTES as id (id)}<span id="pl-hint-{id}">{plates[id].hint}</span>{/each}
      </div>

      <PlacePlate
        {dateline}
        {shown}
        note={shown ? plates[shown] : null}
        caption={lampCaption(bpm, reduced)}
        {stirs}
        bind:held
        {onlinkkey}
      />

      <!-- Print: the picture cannot be read in ink, so every label prints with its explanation. -->
      <dl class="pl-print">
        {#each NOTES as id (id)}
          {@const t = tags[id]}
          <dt>{tagLine(t)}</dt>
          <dd>{plates[id].text}</dd>
        {/each}
      </dl>
    </div>
  </div>
</div>

<style>
  .pl {
    /* Geometry of the place, one set per width. x is a share of the column;
       y is measured up from the bottom of the picture, which is the hero's
       lower edge on a desktop and sits over the plate (--below) on a phone. */
    --gut: clamp(16px, 4vw, 64px);
    /* A little lower on a small laptop, where the title is too, so switching
       views barely moves the page. */
    --world: clamp(352px, calc(24px + 24.2vw), 372px);
    --ground: 56px;
    --below: 0px;
    --ridge-l: 0%;
    --ridge-w: 55%;
    --ridge-h: 90px;
    --town-l: 56.5%;
    --town-w: 30.5%;
    --town-h: 180px;
    --lh-w: 84px;
    --lh-h: 280px;
    /* The pavement between the street's foot and the promenade. */
    --kerb: 8px;
    --lh-b: calc(var(--ground) - 8px);
    --cloud-l: 66%;
    --cloud-t: 50px;
    --cloud-w: 150px;
    /* Where the labels' text stands, up from the bottom of the picture. */
    --rel-y: calc(var(--world) - 96px);
    --ship-y: 262px;
    --pulse-lead: 34px;
    /* The releases label's widest, which the plate keeps clear of. */
    --rel-w: 270px;
    --plate-w: min(33%, 430px, calc(var(--ridge-l) + var(--ridge-w) - var(--rel-w)));
    /* Type on the sky: cream on the deep sky, ink on the pale daytime one
       (data-tone, below). Anything on the ground puts cream back. */
    --type: 237, 228, 212;
    --cream: rgb(var(--type));
    --ink-sky: var(--sky-ground, #0b0806);
    /* The on-sky accents in the tone's own shades (sky.ts): on-dark orange
       and petrol on the deep sky, deep burnt orange and petrol on the pale. */
    --accent-on-dark: var(--sky-accent, #e8863a);
    --accent-ink-on-dark: var(--sky-accent-ink, #7fb8c0);
    /* How high the skyline's haze stands over the ground: behind the
       buildings, under the labels' type. */
    --haze-h: 150px;

    position: relative;
    isolation: isolate;
    overflow: hidden;
    color: var(--cream);
    /* The sky, then the haze along the skyline (warmest on the sun's side),
       then the ground. The colours ease over a couple of seconds when a
       vitals poll moves the light (the stops are registered as colours in
       PlaceSkyProps so they can). */
    background:
      radial-gradient(ellipse 60% 100% at var(--sun-x, 50%) 100%, var(--sky-haze), transparent) left 0 bottom calc(var(--below) + var(--ground) - 1px) /
        100% var(--haze-h) no-repeat,
      linear-gradient(0deg, var(--sky-haze), transparent) left 0 bottom calc(var(--below) + var(--ground) - 1px) / 100%
        calc(var(--haze-h) * 0.7) no-repeat,
      linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 48%, var(--sky-low) 100%) top / 100% calc(100% - var(--below)) no-repeat,
      var(--ink-sky);
    transition:
      --sky-top 2s ease,
      --sky-mid 2s ease,
      --sky-low 2s ease,
      --sky-haze 2s ease,
      --sky-ground 2s ease,
      --city-glass 2s ease,
      --city-stone 2s ease,
      --city-metal 2s ease,
      --city-glaze 2s ease,
      --city-near 2s ease,
      --city-far 2s ease,
      --city-cloud 2s ease;
  }
  .pl[data-tone='light'] {
    --type: 26, 16, 8;
  }
  .pl[data-tone='light'] :global(.ht-lede) {
    color: rgba(var(--type), 0.82);
  }
  /* The view switch hangs over the sky on a desktop (HeroViews). */
  @media (min-width: 761px) {
    :global(.hv:has(> .pl[data-tone='light']) .hv-bar) {
      --on-ink-55: rgba(26, 16, 8, 0.72);
      --on-ink-80: rgba(26, 16, 8, 0.86);
      --bg: #1a1008;
      --accent-on-dark: #6e2c06;
    }
  }
  .pl[data-snap],
  .pl[data-snap] :global(*) {
    transition: none !important;
  }

  /* Full bleed: the stars and the shore run the width of the screen; the
     place itself keeps to the page's 1312px measure. The stars thin out
     behind the type, so the title and the lede are never speckled. */
  .pl-stars {
    position: absolute;
    inset: 0 0 auto 0;
    width: 100%;
    height: 60%;
    opacity: var(--stars);
    fill: #efe6d6;
    -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.3) 46%, #000 66%);
    mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.3) 0%, rgba(0, 0, 0, 0.3) 46%, #000 66%);
  }
  .pl-stars circle:nth-child(3n) {
    opacity: 0.55;
  }
  .pl-in {
    max-width: 1312px;
    margin: 0 auto;
    padding: 0 var(--gut);
  }
  .pl-box {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'top' 'world';
  }
  .pl-top {
    grid-area: top;
    position: relative;
    z-index: 2;
    padding-top: clamp(20px, 3.5vh, 36px);
  }
  .pl-world {
    grid-area: world;
    position: relative;
    height: var(--world);
  }


  .pl-print {
    display: none;
  }

  /* ------------------------------------------------------------- narrower */

  /* A small laptop: the releases label stacks its unit, so the plate keeps
     its width beside it. */
  @media (max-width: 1299px) {
    .pl {
      --rel-w: 190px;
    }
  }
  /* A tablet keeps the desktop's picture, plate in the sky and all, so the
     hero stays about the sentence's height: the ridge widens under the plate,
     the town narrows, and the picture grows a little taller where the plate
     gets narrow. */
  @media (max-width: 1099px) {
    .pl {
      --world: max(372px, calc(700px - 36vw));
      --ridge-w: 60%;
      --ridge-h: 84px;
      --town-l: 61.5%;
      --town-w: calc(38.5% - var(--lh-w) - 14px);
      --town-h: 136px;
      --rel-y: 250px;
      --rel-w: 180px;
      --ship-y: 190px;
      --pulse-lead: 46px;
      --lh-w: 66px;
      --lh-h: 220px;
      /* The cloud comes in from the right far enough for its label's longest words. */
      --cloud-l: min(63%, calc(100% - var(--cloud-w) - 212px));
      /* The labels stand lower here: the haze keeps under them. */
      --haze-h: 104px;
      --cloud-t: 40px;
      --cloud-w: clamp(96px, 12vw, 124px);
    }
    .pl {
      --plate-w: min(40%, calc(var(--ridge-l) + var(--ridge-w) - var(--rel-w)));
    }
  }
  /* A phone: the plate leaves the sky for the ground under the picture, at a
     fixed height, so opening a label never moves the hero's lower edge (the
     rambler's floor) or anything under it. The town takes a larger share so
     its windows stay windows, and the cloud comes down off the title into the
     picture's own sky, top left, where it is a step down for the rambler. */
  @media (max-width: 759px) {
    .pl {
      --world: 360px;
      --ground: 52px;
      --ridge-w: 44%;
      --ridge-h: 72px;
      --town-l: 45.5%;
      --town-w: calc(54.5% - var(--lh-w) - 8px);
      --town-h: 100px;
      --lh-w: 45px;
      --lh-h: 150px;
      --kerb: 6px;
      --rel-y: 170px;
      --rel-w: 170px;
      --ship-y: 150px;
      --pulse-lead: 36px;
      --plate-h: 206px;
      --pad-b: 16px;
      --below: calc(var(--plate-h) + 8px + var(--pad-b));
      --cloud-l: 0px;
      --cloud-w: 96px;
      --haze-h: 84px;
      --cloud-t: auto;
    }
    .pl-box {
      grid-template-areas: 'top' 'world' 'plate';
      padding-bottom: var(--pad-b);
    }
  }
  /* The narrowest phones wrap the plate's words onto more lines; a wide one
     onto fewer. */
  @media (max-width: 374px) {
    .pl {
      --plate-h: 226px;
    }
  }
  @media (min-width: 560px) and (max-width: 759px) {
    .pl {
      --plate-h: 172px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pl {
      transition: none;
    }
  }

  /* Print: ink on paper. The picture does not survive the trip, so the title,
     the dateline and every reading print as text with its explanation. */
  @media print {
    .pl {
      --below: 0px;
      background: none;
      color: #1a1008;
    }
    .pl-stars,
    .pl-world {
      display: none;
    }

    .pl-box {
      grid-template-areas: 'top' 'plate' 'print';
      padding-bottom: 0;
    }
    .pl-print {
      grid-area: print;
      display: block;
      margin: 8px 0 12px;
      color: #1a1008;
      font-size: 12pt;
      line-height: 1.4;
    }
    .pl-print dt {
      margin-top: 6px;
      font-weight: 700;
    }
    .pl-print dd {
      margin: 0;
    }
  }
</style>
