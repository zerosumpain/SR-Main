<script lang="ts">
  import HealthShell from '$lib/components/health/hub/HealthShell.svelte';
  import SectionHead from '$lib/components/health/hub/SectionHead.svelte';
  /**
   * Landgrab — the family territory board.
   *
   * Owner-only: the whole gate is the load function next door, because
   * /projects is a public PREFIX. There is no card on the index and no data
   * endpoint; everything here arrived inside one owner-gated render.
   *
   * v2 is MAP FIRST. The page is five sections in the /health register — the
   * map and its filter, the standings, the battlegrounds, the boards, and the
   * letter with the method — and each one is a single component. What is left
   * in this file is the state the sections share: the URL-backed filter, the
   * shared clock, and the one tile the region drill is open on.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import MapStage from './MapStage.svelte';
  import ShareBar from './ShareBar.svelte';
  import Battlegrounds from './Battlegrounds.svelte';
  import LandgrabBoards from './LandgrabBoards.svelte';
  import WeeklyLetter from './WeeklyLetter.svelte';
  import RegionDrill from './RegionDrill.svelte';
  // Pure slippy-tile arithmetic — no DB, no Mapbox, no server reach — so the
  // client bundle may have it. A map tap arrives as a lat/lon and the drill
  // asks for a cell, and this is the only conversion between the two.
  import { parseTileKey, tileAt } from '$lib/geo/tiles';
  // The board's hex is 1.075 cells across the flats. The page says the ground
  // width in metres, so it needs the ratio rather than a second constant that
  // could drift from the lattice the map actually draws.
  import { HEX_WIDTH_TILES } from '$lib/geo/hex';
  import {
    activityLabel,
    km2,
    relativeAge,
    windowPhrase,
    DEFAULT_WINDOW,
    UNTYPED_LABEL,
  } from './identity';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const lg = $derived(data.landgrab);

  // Plain reactive clock for the "2h ago" strings. Not a handle — the template
  // reads it — but the interval id is, and stays a plain let.
  let now = $state(Date.now());
  let applying = $state(false);
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(id);
  });

  const chips = $derived([
    ...lg.available.activities.map((a) => ({ key: a, label: activityLabel(a) })),
    ...(lg.available.untyped ? [{ key: 'untyped', label: UNTYPED_LABEL }] : []),
  ]);
  /**
   * Only keys that have a CHIP. The server reports `selected.untyped = true` by
   * default even on a corpus with no untyped rows, and counting that phantom
   * key made the selection the same length as the chip list — so unticking a
   * chip produced an empty query string and the page silently did nothing.
   */
  const selectedActivityKeys = $derived(
    new Set([
      ...lg.selected.activities,
      ...(lg.available.untyped && lg.selected.untyped ? ['untyped'] : []),
    ]),
  );
  const selectedSubjects = $derived(new Set(lg.selected.subjects));
  const selectedWindow = $derived(lg.selected.window);
  const windowLine = $derived(windowPhrase(lg.selected.window));
  const missingPlayers = $derived(Math.max(0, 5 - lg.standings.length));
  /** Empty seats are drawn, not summarised. Four of five players have no
   *  history until the household backfill runs, and a board that hid that
   *  would read as "John won" rather than "the game has not started". */
  const openSeats = $derived(
    Array.from({ length: missingPlayers }, (_, i) => lg.standings.length + i + 1),
  );

  /**
   * The region drill's open cell.
   *
   * Seeded from the loader's validated `?geo=x:y`, then owned locally — so a
   * drill is a link you can send someone. Plain `$state`, never a `$derived`
   * off the URL: the drill is opened by a tap as well as by a link, and
   * something that read the URL and also wrote it is the read-own-write cycle
   * that ends in `effect_update_depth_exceeded`.
   *
   * There is deliberately NO prop→state sync effect behind it. Every filter
   * change is a `goto` and so a fresh payload whose `geo` is null; re-seeding
   * off that would slam the drawer shut whenever the reader touched a chip.
   *
   * The initialiser reads `lg` and Svelte warns `state_referenced_locally`.
   * That is correct and deliberate here — it captures the deep link at mount,
   * which is the only moment it means anything.
   */
  // svelte-ignore state_referenced_locally
  let drill = $state<{ x: number; y: number } | null>(lg.geo);

  /**
   * The filter as the drill must ask for it: the current `?activity&who&window`
   * with `geo` REMOVED. The deep-link param is the page's own state, not a
   * filter, and passing it through to `/projects/landgrab/geo` would be a
   * second, contradictory cell in the same request.
   */
  const currentQuery = $derived.by(() => {
    const params = new URLSearchParams(page.url.searchParams);
    params.delete('geo');
    return params.toString();
  });

  /** Filter state lives in the URL, so the page's own guard is also the
   *  filter's gate — nothing new to add to an allow-list and forget. */
  async function apply(next: { activities?: string[]; subjects?: string[]; window?: string }) {
    const params = new URLSearchParams();
    const acts = next.activities ?? [...selectedActivityKeys];
    const subs = next.subjects ?? [...selectedSubjects];
    const win = next.window ?? selectedWindow;
    const allActs = chips.map((c) => c.key);
    if (acts.length !== allActs.length) params.set('activity', acts.join(','));
    if (subs.length !== lg.available.subjects.length) params.set('who', subs.join(','));
    // The DEFAULT window stays out of the URL, so the unfiltered page keeps a
    // bare address. It must be compared against DEFAULT_WINDOW rather than the
    // literal 'all': while those were the same value, dropping the param for
    // 'all' was right — now it would make "All time" unselectable, because an
    // absent param is read back as the 30-day default.
    if (win !== DEFAULT_WINDOW) params.set('window', win);
    const qs = params.toString();
    applying = true;
    try {
      await goto(qs ? `?${qs}` : '?', { replaceState: true, noScroll: true, keepFocus: true });
    } finally {
      applying = false;
    }
  }

  function toggleActivity(key: string) {
    const next = new Set(selectedActivityKeys);
    next.has(key) ? next.delete(key) : next.add(key);
    void apply({ activities: [...next] });
  }

  /** One at a time — a window is a choice, not a set, so re-picking the active
   *  one is a no-op rather than a toggle back to all time. */
  function pickWindow(key: string) {
    if (key === selectedWindow) return;
    void apply({ window: key });
  }

  function toggleSubject(subject: string) {
    const next = new Set(selectedSubjects);
    next.has(subject) ? next.delete(subject) : next.add(subject);
    void apply({ subjects: [...next] });
  }

  /** A map tap lands on a coordinate; the drill is keyed on a cell. A hex is
   *  drawn over the cells, never instead of them, so this is unchanged by the
   *  board: tapping a hex opens the history of the ground under it. */
  function openAt(hit: { lat: number; lon: number; subject: string | null }) {
    drill = tileAt(hit.lat, hit.lon);
  }
</script>

<svelte:head>
  <title>Landgrab — Strange Ramblings</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<HealthShell
  path="/projects/landgrab"
  unifiedNav
  footer={[
    'strangeramblings.com/projects/landgrab · the household board',
    `${km2(lg.totals.areaM2)} km² in play · ${lg.totals.cells.toLocaleString('en-GB')} cells · ${windowLine} · read ${relativeAge(lg.generatedAt, now)}`,
    'owner only · never indexed',
  ]}
>
  <!-- The cover band. Ink, full-bleed, and the page hangs from it — the same
       register /projects and /decks took, not a panel inset in a cream page. -->
  <section class="lede">
    <div class="lede-inner">
      <div class="lede-copy">
        <p class="eyebrow">Private · household territory</p>
        <h1>WALK IT<br /><span>TO OWN IT.</span></h1>
        <p class="standfirst">
          Every walk, run and ride the household records paints ground. Close a
          loop and everything inside it is yours — until somebody walks it more
          recently, and more often, than you did.
        </p>
      </div>

      <!-- Three facts, and all three are now about MOVEMENT. "Claims scored"
           and "Seats taken" answered questions nobody arrived with; what a
           reader wants off the cover is how much ground is in play, how much
           of it moved, and how much of it is actually being fought over. -->
      <dl class="cover-deck" aria-label="Board summary">
        <div>
          <dt>Ground in play</dt>
          <dd>{km2(lg.totals.areaM2)}</dd>
          <small>km² · {lg.totals.cells.toLocaleString('en-GB')} cells</small>
        </div>
        <div>
          <dt>Changed hands</dt>
          <dd>{lg.handovers.cells.toLocaleString('en-GB')}</dd>
          <small>cells · vs a week ago</small>
        </div>
        <div>
          <dt>Battlegrounds</dt>
          <dd>{lg.battlegrounds.length.toLocaleString('en-GB')}</dd>
          <small>contested {lg.contested.cells.toLocaleString('en-GB')} cells</small>
        </div>
      </dl>
    </div>
  </section>

  {#if lg.totals.events === 0}
    <section class="sec">
      <div class="sec-inner virgin">
        <p class="virgin-kicker metric-label accent">Nothing claimed yet</p>
        <h2 class="virgin-h">The whole map is open ground.</h2>
        <p class="virgin-p">
          No journey has qualified yet. The first person to close a loop — any
          loop over about four hundred metres — takes every cell inside it, and
          the board starts with them alone on it.
        </p>
      </div>
    </section>
  {:else}
    <!-- 01. The map is the page. Everything that decides what it draws sits
         inside the section with it, not two screens above. -->
    <section class="sec">
      <div class="sec-inner">
        <SectionHead
          kicker="01 / The map"
          title={['WHERE THE', 'GROUND MOVED']}
          strap={`A fixed ${Math.round(lg.cellSideM * HEX_WIDTH_TILES)} m honeycomb over the whole map: every hex is ground, and a coloured one is taken. The map opens where ground changed hands; tap a hex for its history.`}
        />
        <MapStage
          {lg}
          {chips}
          {selectedActivityKeys}
          {selectedWindow}
          {selectedSubjects}
          {applying}
          ontoggleActivity={toggleActivity}
          onpickWindow={pickWindow}
          ontoggleSubject={toggleSubject}
          ontap={openAt}
        />
      </div>
    </section>

    <!-- 02. One bar, then one row each. Quieter than v1's five big numerals on
         purpose: the map above it is the loud thing now. -->
    <section class="sec">
      <div class="sec-inner">
        <SectionHead
          kicker="02 / The standings"
          title={['WHO HOLDS', 'THE GROUND']}
          strap="One bar, five colours: each share of everything the household holds, and what that is against the Darlington box."
        />
        <ShareBar
          share={lg.share}
          standings={lg.standings}
          players={lg.players}
          {openSeats}
        />
        {#if missingPlayers > 0}
          <p class="seatline">
            <b>{missingPlayers} of 5 seats are still open.</b> The rest of the household
            is phone-tracked and its history has not been walked into the ledger yet —
            so every cell on this map is currently cheap to take.
          </p>
        {/if}
      </div>
    </section>

    <section class="sec tinted">
      <div class="sec-inner">
        <SectionHead
          kicker="03 / Battlegrounds"
          title={['WHERE IT IS', 'A FIGHT']}
          strap="Ground two or more of you have stood on, in the clumps it comes in. Everything else is a walk nobody contested."
        />
        <Battlegrounds
          battlegrounds={lg.battlegrounds}
          moves={lg.nextMoves}
          players={lg.players}
          window={lg.window}
          onopen={(id) => (drill = parseTileKey(id))}
        />
      </div>
    </section>

    <section class="sec">
      <div class="sec-inner">
        <SectionHead
          kicker="04 / The boards"
          title={['THE WEEK,', 'READ THREE WAYS']}
          strap="The same ledger read three ways — who is winning contested ground, who moved this week, and the loops that closed — with the capture feed and the effort lines beneath."
        />
        <LandgrabBoards
          standings={lg.standings}
          players={lg.players}
          contested={lg.contested}
          dangle={lg.dangle}
          feed={lg.feed}
          window={lg.window}
          {now}
        />
      </div>
    </section>

    <section class="sec tinted">
      <div class="sec-inner">
        <SectionHead
          kicker="05 / The letter & the method"
          title={['LAST WEEK, AND', 'HOW IT IS SCORED']}
          strap={null}
        />
        <WeeklyLetter letter={lg.letter} />

        <!-- The five rules, off the old map rail. They are a glossary rather
             than a running order, so they are a definition list — and two
             columns on desktop, because a 380px rail's worth of stacked rows
             in a 1400px band is a column of air. -->
        <section class="rules" aria-label="How ground is won">
          <header class="rules-hd"><span class="metric-label">How ground is won</span></header>
          <dl class="rules-list">
            <div class="rules-row">
              <dt>×3</dt>
              <dd>Close a loop and every cell inside it is yours.</dd>
            </div>
            <div class="rules-row">
              <dt>×1</dt>
              <dd>Walk, run or ride through and you claim the line you crossed.</dd>
            </div>
            <div class="rules-row">
              <dt>÷n</dt>
              <dd>
                One outing, one claim — split over every cell it touched. Going
                further spreads the same claim thinner, so going often beats
                going far.
              </dd>
            </div>
            <div class="rules-row">
              <dt>½</dt>
              <dd>
                A capture halves in weight every 30 days — old ground gets cheap,
                but never changes hands on its own.
              </dd>
            </div>
            <div class="rules-row">
              <dt>1</dt>
              <dd>
                One capture per person, per cell, per day. Ten laps of the garden
                score once.
              </dd>
            </div>
          </dl>
        </section>

        <p class="foot">
          Territory is scored on a hidden grid of {Math.round(lg.cellSideM)} m cells; the
          map shows dissolved, smoothed ground, never the grid. A capture decays with
          a thirty-day half-life, so ground gets cheaper to steal but never changes
          hands on its own — somebody has to actually go there. Each outing's claim is
          divided by the number of cells it took, so a long run claims each of them
          thinly and a short walk claims a few of them hard: the board rewards going
          out often rather than going far. Total ground is mostly ground nobody else
          has been near, which is why the contested board is the one worth reading.
          Battlegrounds are the clumps of ground two or more people have stood on; a
          region's history ignores the date window.
          {#if lg.window.key !== 'all'}
            The date window narrows the evidence, not the picture: the map, every
            board, the capture feed and the ground-in-play figure all answer over
            {windowLine}. The gained and lost columns are the one thing measured
            against something else — they compare this window with {lg.window
              .weekBasis}, because a narrowed present held against an unnarrowed
            week ago would report movement nobody made.
          {/if}
        </p>

        <!-- The honesty line that used to sit beside the filter chips. The
             filter moved into the map's own toolbar, where there is no room for
             a paragraph — but the admission is the whole reason the filter is
             trustworthy, so it lands here rather than being lost. -->
        <p class="foot">
          {#if lg.window.key !== 'all'}
            Ownership is <b>replayed</b> over {windowLine} only, not hidden on the
            map: a cell somebody won in June and somebody else walked on Tuesday
            changes hands here. {#if lg.window.cellsOutsideWindow > 0}<b
                >{lg.window.cellsOutsideWindow.toLocaleString('en-GB')} cells</b
              > sit outside it.{:else}Every cell anyone holds falls inside it.{/if}
          {:else if lg.filterActive}
            Ownership is being replayed over the filtered ledger, not read off the
            stored map — a cell won by bike does not survive a foot-only view.
          {:else}
            Untyped capture is the phone-tracked half of the household. Turning it
            off removes four players, not four activities.
          {/if}
        </p>
      </div>
    </section>
  {/if}

  <!--
    The drill is mounted ONCE, at the page root, as a sibling of the sections
    and never inside one. Mounting it once is what lets an in-flight fetch for
    the last region be aborted when the next one is tapped.
  -->
  <RegionDrill
    open={drill}
    filterQuery={currentQuery}
    players={lg.players}
    cellAreaM2={lg.cellAreaM2}
    onclose={() => (drill = null)}
  />
</HealthShell>

<style>
  /* --- The cover band, the register /projects and /decks already wear ---
     Ink, full-bleed, and the page hangs from it. The lesson from PR #610 is
     that ink has to be the page's top edge: as a panel inset in a cream page
     it floats no matter how good the panel is. Paper tokens are invisible on
     this ground, so everything in here is lit for dark explicitly. */
  .lede {
    padding: clamp(28px, 3.5vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(420px, 0.85fr);
    align-items: end;
    gap: clamp(32px, 5vw, 72px);
    width: min(1400px, 100%);
    margin: 0 auto;
  }
  .lede-copy {
    min-width: 0;
  }
  .eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2.4rem, 4.4vw, 4.1rem);
    font-weight: 900;
    line-height: 0.88;
    letter-spacing: -0.04em;
    color: var(--bg);
    text-wrap: balance;
  }
  h1 span {
    color: transparent;
    -webkit-text-stroke: 1.5px var(--bg);
  }
  .standfirst {
    max-width: 56ch;
    margin: 18px 0 0;
    font-size: var(--fs-body);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
  }

  /* The count deck: three facts, cell outlines rather than gap-over-background
     (auto-fit + gap:1px paints unfilled tracks — the handoff's own trap note). */
  .cover-deck {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .cover-deck > div {
    min-width: 0;
    padding: 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .cover-deck dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
  }
  .cover-deck dd {
    margin: 8px 0 5px;
    font-family: var(--font-display);
    font-size: clamp(1.65rem, 2.4vw, 2.4rem);
    font-weight: 900;
    line-height: 0.9;
    letter-spacing: -0.03em;
    color: var(--bg);
    font-variant-numeric: tabular-nums;
  }
  .cover-deck small {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }

  /* --- Paper sections, on /health's band rhythm --- */
  .sec {
    padding: clamp(36px, 4.2vw, 64px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
    font-family: var(--font-body);
    color: var(--text-primary);
  }
  /* A band rule separates a section from the NEXT one. On the last it draws a
     stray line across whatever space is left above the ink footer. */
  section.sec:last-of-type {
    border-bottom: none;
  }
  .sec.tinted {
    background: var(--bg-section);
  }
  .sec-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  @media (max-width: 900px) {
    .lede-inner {
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
  }
  @media (max-width: 520px) {
    .cover-deck {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* ---- 02 / the open seats ----
     Butted straight onto the share bar's bottom edge: the bar's own border is
     this note's top rule, so the pair reads as one instrument rather than two
     boxes with a hairline of cream between them. */
  .seatline {
    margin: 0;
    padding: 12px 16px;
    border: 1px solid var(--line-strong);
    border-top: 0;
    border-left: 4px solid var(--accent);
    background: var(--accent-tint-04);
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: none;
  }
  .seatline b {
    font-family: var(--font-display);
    font-weight: 400;
    text-transform: uppercase;
    color: var(--text-primary);
  }

  /* ---- 05 / the rules ---- */
  .rules {
    margin-top: 1.5rem;
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .rules-hd {
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .rules-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    padding: 0;
  }
  /* `rules-row`, NOT `rule`: `.rule` is a global utility in app.css — a 2px
     hairline at 8% ink — and Svelte's scoping does not stop a global class of
     the same name applying. It won the `height` this rule never declares, so
     every row collapsed to its padding and the copy spilled out at 8% opacity. */
  .rules-row {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    min-width: 0;
    padding: 11px 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  /* Five rules over two columns leaves the last one alone on its row; only it
     needs the closing rule taken off. */
  .rules-row:last-child {
    border-bottom: 0;
  }
  /* Five rules over two columns: the fifth sits alone on the last row, and a
     right-hand rule on it draws a hairline into empty space. Only the odd rows
     that actually have a neighbour get the column rule. */
  .rules-row:nth-child(odd):not(:last-child) {
    border-right: 1px solid var(--line-hair);
  }
  .rules-row dt {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--fs-body-lg);
    letter-spacing: -0.01em;
    color: var(--accent);
  }
  .rules-row dd {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
  }

  /* ---- empty ---- */
  .virgin {
    border: 1px solid var(--line-strong);
    border-left: 4px solid var(--accent);
    background: var(--surface-sunken);
    padding: 2.5rem 2rem;
  }
  .virgin-kicker {
    margin: 0 0 0.6rem;
  }
  .virgin-h {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-display-sm);
    line-height: 0.95;
    text-transform: uppercase;
  }
  .virgin-p {
    margin: 1rem 0 0;
    max-width: 52ch;
    font-size: var(--fs-body-lg);
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .foot {
    margin: 1.5rem 0 0;
    max-width: 76ch;
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-muted);
  }
  .foot b {
    color: var(--text-secondary);
  }

  @media (max-width: 700px) {
    /* The cover band carries its own clamps, and every instrument below it is
       now a component with its own phone rules. What is left here is the rules
       list, which loses its second column and so its column rule with it. */
    .rules-list {
      grid-template-columns: minmax(0, 1fr);
    }
    /* Same three-class selector as above — a media query adds no specificity,
       so the `:not()` has to be repeated here or the rule above wins. */
    .rules-row:nth-child(odd):not(:last-child) {
      border-right: 0;
    }
    .virgin {
      padding: 1.5rem 1.25rem;
    }
  }
</style>
