<script lang="ts">
  // The landing page's header block, drawn as a place: the title hangs in a
  // dusk sky over a small landscape made of the site's live numbers. Read the
  // horizon left to right as then to now: a ridge of every release day from
  // the first to six weeks ago, a terrace of the last forty days (a house a
  // day, a lit window per deploy), and a lighthouse whose lamp keeps the last
  // heart rate. Today's steps run along the shore on the day's own scale, and
  // the next daydream gathers as a cloud beside the title. The sky is the real
  // light over the north of England just now, held dark for the type.
  //
  // Each reading is a small label pinned to its part of the picture. Pointing
  // at one, focusing it or tapping it lights that part, dims the rest and puts
  // its explanation in the one plate, so there is no key to read first.
  //
  // Only two things move, both CSS off `--beat` (60/bpm seconds): the lamp, and
  // a brief rain when a think fires. The lamp never flashes more than three
  // times a second: lub-dub to 90 a minute, one flash a beat to 180, then lit
  // and steady. Both stop with no fresh reading, when the reader asks ("hold
  // still"), off screen, in a hidden tab and under prefers-reduced-motion; the
  // rain pauses rather than restarts. Everything the rambler stands on is static.
  import { onMount, tick } from 'svelte';
  import type { CapabilityFacts } from '$lib/landing/capabilities';
  import type { LandingVitals } from '$lib/landing/live-vitals.svelte';
  import { binOf, cloud, footpath, lampFor, ridge, skyAt, starfield, sunAltitude, town as terrace } from '$lib/landing/place';
  import { lampCaption, placePlates, placeTags, tagLine } from '$lib/landing/place-copy';
  import { shipDays, shipStats, type DayCount } from '$lib/landing/rhythm';
  import { londonHour, NOTES, readDaydream, type NoteId, type Pulse } from '$lib/landing/sentence';
  import type { StepsToday } from '$lib/landing/steps';
  import { clampBpm } from '$lib/landing/traces';
  import { localToday } from '$lib/constants/health-day';
  import HeroTitle from './HeroTitle.svelte';
  import PlaceCloud from './place/PlaceCloud.svelte';
  import PlacePlate from './place/PlacePlate.svelte';
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
  let sky = $derived(skyAt(sunAltitude(now), hour < 12));
  const stars = starfield();

  let days = $derived(cadence.length ? shipDays(cadence, todayKey) : []);
  let stats = $derived(shipStats(days));
  let hills = $derived(ridge(cadence, todayKey));
  let houses = $derived(days.length ? terrace(days) : null);
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pl"
  bind:this={root}
  data-still={held || away || reduced ? '' : undefined}
  data-lamp={lamp}
  data-focus={shown ?? undefined}
  data-sky={sky.word}
  style:--beat="{beat.toFixed(4)}s"
  style:--sky-top={sky.top}
  style:--sky-mid={sky.mid}
  style:--sky-low={sky.low}
  style:--stars={sky.stars}
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
        <HeroTitle />
      </div>

      <!-- The sky beside the title: the next daydream, gathering. -->
      <PlaceCloud {weather} />

      <!-- The landscape. Its parts are pictures; every number is in a label. -->
      <div class="pl-world">
        <PlaceWorld {hills} {houses} {bpm} {path} />
      </div>

      <!-- The readings, in the sentence's order: real buttons pinned to their parts. -->
      {#each NOTES as id (id)}
        {@const t = tags[id]}
        {@const anchored =
          (id === 'releases' && hills) || (id === 'ship' && houses)}
        <div
          class="pl-tag"
          data-part={id}
          data-dash={t.spoken ? '' : undefined}
          data-loose={(id === 'releases' || id === 'ship') && !anchored ? '' : undefined}
          style:--px={id === 'releases' && hills ? hills.pin.x : undefined}
          style:--py={id === 'releases' && hills ? hills.pin.y : undefined}
          style:--bx={id === 'ship' && houses ? houses.blocks[1].x / 1000 + houses.blocks[1].w / 2000 : undefined}
          style:--by={id === 'ship' && houses ? 1 - houses.blocks[1].top / 100 : undefined}
          style:--bx0={id === 'ship' && houses ? houses.blocks[0].x / 1000 + houses.blocks[0].w / 2000 : undefined}
          style:--by0={id === 'ship' && houses ? 1 - houses.blocks[0].top / 100 : undefined}
          data-on={shown === id ? '' : undefined}
        >
          <i class="pl-lead" aria-hidden="true"></i>
          <button
            type="button"
            aria-expanded={pinned === id}
            aria-controls="pl-plate"
            aria-describedby="pl-hint-{id}"
            onclick={(e) => choose(e, id)}
            onfocus={(e) => onfocus(e, id)}
          >
            <span class="k">{t.kicker}</span>
            <span class="vu"
              >{#if t.spoken}<span class="v" aria-hidden="true">{t.value}</span><span class="vh">{t.spoken}</span
                >{:else}<span class="v">{t.value}</span>{/if}{#if t.unit}{' '}<span class="u">{t.unit}</span>{/if}</span
            >
            {#if t.sub}<span class="s"><span class="vh">, </span>{t.sub}</span>{/if}
          </button>
        </div>
      {/each}
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
    --ridge-h: 132px;
    --town-l: 56.5%;
    --town-w: 30.5%;
    --town-h: 112px;
    --lh-w: 66px;
    --lh-h: 220px;
    --lh-b: calc(var(--ground) - 8px);
    --cloud-l: 66%;
    --cloud-t: 50px;
    --cloud-w: 150px;
    /* Where the labels' text stands, up from the bottom of the picture. */
    --rel-y: calc(var(--world) - 96px);
    --ship-y: 200px;
    --pulse-lead: 34px;
    /* The releases label's widest, which the plate keeps clear of. */
    --rel-w: 270px;
    --plate-w: min(33%, 430px, calc(var(--ridge-l) + var(--ridge-w) - var(--rel-w)));
    --cream: #ede4d4;
    --ink-sky: #0b0806;

    position: relative;
    isolation: isolate;
    overflow: hidden;
    color: var(--cream);
    background:
      linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 48%, var(--sky-low) 100%) top / 100% calc(100% - var(--below)) no-repeat,
      var(--ink-sky);
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

  /* -------------------------------------------------------------- labels */

  /* A label sits on its anchor (a zero-size box at the point it names); the
     leader runs up from that point to the text. */
  .pl-tag {
    position: absolute;
    z-index: 3;
    width: 0;
    height: 0;
    --lead: 0px;
  }
  .pl-lead {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 1px;
    height: var(--lead);
    background: rgba(237, 228, 212, 0.42);
  }
  .pl-lead::after {
    content: '';
    position: absolute;
    left: -2px;
    bottom: -2px;
    width: 5px;
    height: 5px;
    border-radius: 100px;
    background: var(--cream);
  }
  .pl-tag button {
    --tone: var(--accent-on-dark);
    position: absolute;
    left: -1px;
    bottom: var(--lead);
    display: block;
    min-width: 44px;
    margin: 0;
    padding: 0 0 4px 9px;
    border: 0;
    border-left: 1px solid rgba(237, 228, 212, 0.42);
    background: none;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    color: var(--cream);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  /* Right-handed: the text hangs to the left of its leader. */
  .pl-tag[data-part='releases'] button,
  .pl-tag[data-part='pulse'] button {
    left: auto;
    right: -1px;
    padding: 0 9px 4px 0;
    border-left: 0;
    border-right: 1px solid rgba(237, 228, 212, 0.42);
    text-align: right;
  }
  .pl-tag button::after {
    content: '';
    position: absolute;
    inset: -6px -8px -2px -6px;
  }
  .pl-tag[data-part='daydream'] button,
  .pl-tag[data-part='releases'] button {
    --tone: var(--accent-ink-on-dark);
  }
  .pl-tag button:focus-visible {
    outline: 2px solid var(--accent-on-dark);
    outline-offset: 4px;
  }
  .k {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--tone);
  }
  .vu {
    display: block;
    line-height: 1.15;
  }
  .v {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--cream);
  }
  .u {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.78);
  }
  .s {
    display: block;
    margin-top: 2px;
    font-size: 13px;
    line-height: 1.3;
    color: rgba(237, 228, 212, 0.74);
  }
  .pl-tag[data-dash] .v {
    color: rgba(237, 228, 212, 0.72);
  }
  .pl-tag button:hover .k,
  .pl-tag[data-on] .k {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }
  .pl[data-focus] .pl-lead {
    opacity: 0.4;
  }
  .pl[data-focus='pulse'] [data-part='pulse'] .pl-lead,
  .pl[data-focus='steps'] [data-part='steps'] .pl-lead,
  .pl[data-focus='daydream'] [data-part='daydream'] .pl-lead,
  .pl[data-focus='ship'] [data-part='ship'] .pl-lead,
  .pl[data-focus='releases'] [data-part='releases'] .pl-lead {
    opacity: 1;
  }

  /* Releases: pinned to the highest crest in the ridge's last third, its text
     standing at the ridge's end where the town begins, the leader elbowing
     across to it. Wherever the crest falls, the text keeps clear of the plate. */
  .pl-tag[data-part='releases'] {
    left: calc(var(--ridge-l) + var(--ridge-w) * var(--px, 0.85));
    width: calc(var(--ridge-w) * (1 - var(--px, 0.85)));
    bottom: calc(var(--below) + var(--ground) + var(--ridge-h) * var(--py, 0));
    --lead: calc(var(--rel-y) - var(--ground) - var(--ridge-h) * var(--py, 0));
  }
  .pl-tag[data-part='releases']::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: var(--lead);
    height: 1px;
    background: rgba(237, 228, 212, 0.42);
  }
  .pl[data-focus]:not([data-focus='releases']) .pl-tag[data-part='releases']::before {
    opacity: 0.4;
  }
  .pl-tag[data-part='releases'] button {
    width: max-content;
    max-width: calc(var(--rel-w) - 24px);
    white-space: normal;
  }
  .pl-tag[data-part='releases'] .v {
    white-space: nowrap;
  }
  /* Ship: pinned to the roof of the town's second block. */
  .pl-tag[data-part='ship'] {
    left: calc(var(--town-l) + var(--town-w) * var(--bx, 0.1));
    bottom: calc(var(--below) + var(--ground) + var(--town-h) * var(--by, 0));
    --lead: calc(var(--ship-y) - var(--ground) - var(--town-h) * var(--by, 0));
  }
  /* With no record there is nothing to pin to: the label stands on the shore. */
  .pl-tag[data-loose] {
    bottom: calc(var(--below) + var(--ground) + 16px);
    --lead: 0px;
  }
  .pl-tag[data-loose] .pl-lead {
    display: none;
  }
  .pl-tag[data-part='releases'][data-loose] {
    left: 50%;
    width: 0;
  }
  .pl-tag[data-loose]::before {
    display: none;
  }
  /* Pulse: up and to the left of the lamp, its leader dropping to the
     lantern, and clear of the gallery where the rambler comes to stand. */
  .pl-tag[data-part='pulse'] {
    left: calc(100% - var(--lh-w) / 2);
    bottom: calc(var(--below) + var(--lh-b) + var(--lh-h) * 0.8225 + 8px);
    --lead: var(--pulse-lead);
  }
  .pl-tag[data-part='pulse'] button {
    right: 46px;
  }
  .pl-tag[data-part='pulse'] .pl-lead::before {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 47px;
    height: 1px;
    background: inherit;
  }
  /* Steps: on the shore under the path, on one line. */
  .pl-tag[data-part='steps'] {
    left: 0;
    bottom: calc(var(--below) + 21px);
  }
  .pl-tag[data-part='steps'] .pl-lead {
    display: none;
  }
  .pl-tag[data-part='steps'] button {
    bottom: auto;
    top: 0;
    transform: translateY(-50%);
    padding: 0;
    border: 0;
  }
  .pl-tag[data-part='steps'] :is(.k, .vu, .s) {
    display: inline;
  }
  .pl-tag[data-part='steps'] .k {
    margin-right: 10px;
  }
  .pl-tag[data-part='steps'] .v {
    font-size: 20px;
  }
  /* Daydream: off the cloud's right shoulder. */
  .pl-tag[data-part='daydream'] {
    left: calc(var(--cloud-l) + var(--cloud-w) + 6px);
    top: calc(var(--cloud-t) + var(--cloud-w) * 0.28);
    --lead: 22px;
  }
  .pl-tag[data-part='daydream'] .pl-lead {
    bottom: auto;
    top: 0;
    width: var(--lead);
    height: 1px;
  }
  .pl-tag[data-part='daydream'] .pl-lead::after {
    left: -3px;
    bottom: -2px;
  }
  .pl-tag[data-part='daydream'] button {
    left: calc(var(--lead) + 6px);
    bottom: auto;
    top: 0;
    transform: translateY(-24px);
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
    .pl-tag[data-part='releases'] .u {
      display: block;
      margin-top: 2px;
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
      --ridge-h: 118px;
      --town-l: 61.5%;
      --town-w: calc(38.5% - var(--lh-w) - 14px);
      --town-h: 100px;
      --rel-y: 250px;
      --rel-w: 180px;
      --ship-y: 166px;
      --pulse-lead: 40px;
      --lh-w: 57px;
      --lh-h: 190px;
      /* The cloud comes in from the right far enough for its label's longest words. */
      --cloud-l: min(63%, calc(100% - var(--cloud-w) - 212px));
      --cloud-t: 40px;
      --cloud-w: clamp(96px, 12vw, 124px);
    }
    .pl {
      --plate-w: min(40%, calc(var(--ridge-l) + var(--ridge-w) - var(--rel-w)));
    }
    .pl-tag[data-part='ship'] .u {
      display: block;
      margin-top: 2px;
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
      --ridge-h: 104px;
      --town-l: 45.5%;
      --town-w: 40%;
      --town-h: 84px;
      --lh-w: 42px;
      --lh-h: 140px;
      --rel-y: 170px;
      --rel-w: 170px;
      --ship-y: 146px;
      --pulse-lead: 44px;
      --plate-h: 206px;
      --pad-b: 16px;
      --below: calc(var(--plate-h) + 8px + var(--pad-b));
      --cloud-l: 0px;
      --cloud-w: 96px;
      --cloud-t: auto;
    }
    .pl-box {
      grid-template-areas: 'top' 'world' 'plate';
      padding-bottom: var(--pad-b);
    }
    .pl-tag[data-part='daydream'] {
      left: calc(var(--cloud-w) + 14px);
      top: auto;
      bottom: calc(var(--below) + var(--world) - 66px);
    }
    .pl-tag[data-part='daydream'] .pl-lead {
      display: none;
    }
    .pl-tag[data-part='daydream'] button {
      left: 0;
      top: auto;
      bottom: 0;
      transform: none;
    }
    /* Ship stands on the town's first block, clear of the lighthouse. */
    .pl-tag[data-part='ship'] {
      left: calc(var(--town-l) + var(--town-w) * var(--bx0, 0.06));
      bottom: calc(var(--below) + var(--ground) + var(--town-h) * var(--by0, 0));
      --lead: calc(var(--ship-y) - var(--ground) - var(--town-h) * var(--by0, 0));
    }
    .pl-tag[data-part='ship'] .s {
      display: none;
    }
    .pl-tag[data-part='pulse'] .s {
      width: 8.5em;
      margin-left: auto;
      white-space: normal;
    }
    .v {
      font-size: 20px;
    }
    .pl-tag[data-part='steps'] {
      bottom: calc(var(--below) + 15px);
    }
    .pl-tag[data-part='steps'] .v {
      font-size: 18px;
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

  /* Print: ink on paper. The picture does not survive the trip, so the title,
     the dateline and every reading print as text with its explanation. */
  @media print {
    .pl {
      --below: 0px;
      background: none;
      color: #1a1008;
    }
    .pl-stars,
    .pl-world,
    .pl-tag {
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
