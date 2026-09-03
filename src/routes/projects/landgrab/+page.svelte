<script lang="ts">
  import SiteHeader from '$lib/components/SiteHeader.svelte';
  /**
   * Landgrab — the family territory board.
   *
   * Owner-only: the whole gate is the load function next door, because
   * /projects is a public PREFIX. There is no card on the index and no data
   * endpoint; everything here arrived inside one owner-gated render.
   */
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import TerritoryMap from './TerritoryMap.svelte';
  import CaptureFeed from './CaptureFeed.svelte';
  import LandgrabBoards from './LandgrabBoards.svelte';
  import {
    activityLabel,
    km2,
    relativeAge,
    windowPhrase,
    DATE_WINDOWS,
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

  const roster = $derived(lg.players.filter((p) => lg.available.subjects.includes(p.subject)));
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
    // All time is the default and stays out of the URL, so the unfiltered page
    // keeps the bare address it had before the window existed.
    if (win !== 'all') params.set('window', win);
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

  const ordinal = (i: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][i] ?? `${i + 1}th`;
</script>

<svelte:head>
  <title>Landgrab — Strange Ramblings</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<SiteHeader />

<div class="lg">
  <header class="page-hdr">
    <div class="hdr-l">
      <div class="kicker">Private / household</div>
      <h1>Landgrab</h1>
      <p class="lede">
        Every walk, run and ride the household records paints ground. Close a
        loop and everything inside it is yours — until somebody walks it more
        recently, and more often, than you did.
      </p>
    </div>
    <div class="hdr-r">
      <p class="hdr-stat">
        <span class="metric-label muted">Ground in play</span>
        <span class="hdr-num">{km2(lg.totals.areaM2)}<span class="hdr-unit">km²</span></span>
        <span class="metric-label muted hdr-sub">
          {lg.totals.cells.toLocaleString('en-GB')} cells · {windowLine} · read {relativeAge(
            lg.generatedAt,
            now,
          )}
        </span>
      </p>
    </div>
  </header>

  {#if lg.totals.events === 0}
    <section class="virgin">
      <p class="virgin-kicker metric-label accent">Nothing claimed yet</p>
      <h2 class="virgin-h">The whole map is open ground.</h2>
      <p class="virgin-p">
        No journey has qualified yet. The first person to close a loop — any
        loop over about four hundred metres — takes every cell inside it, and
        the board starts with them alone on it.
      </p>
    </section>
  {:else}
    <!-- Standings: the loudest voice on the page, once. Everything below is
         quieter on purpose. -->
    <section class="standings cellgrid" aria-label="Standings">
      {#each lg.standings as s, i (s.subject)}
        {@const p = lg.players.find((x) => x.subject === s.subject)}
        <article class="stand" style="--who: {p?.colour ?? 'var(--text-primary)'}">
          <div class="stand-hd">
            <span class="metric-label">{ordinal(i)}</span>
            <span class="stand-badge" aria-hidden="true">{p?.initial ?? '?'}</span>
          </div>
          <h2 class="stand-name">{p?.name ?? s.subject}</h2>
          <p class="stand-num">
            {km2(s.areaM2)}<span class="stand-unit">km²</span>
          </p>
          <p class="stand-meta">
            {s.tiles.toLocaleString('en-GB')} cells · {s.geos} geo{s.geos === 1 ? '' : 's'}
          </p>
          <p class="stand-week">
            <span class="up">+{km2(s.gainedM2)}</span>
            <span class="down">−{km2(s.lostM2)}</span>
            <span class="metric-label">vs a week ago</span>
          </p>
        </article>
      {/each}
      {#each openSeats as seat (seat)}
        <article class="stand stand--open">
          <div class="stand-hd">
            <span class="metric-label accent">Seat {seat}</span>
            <span class="stand-badge stand-badge--open" aria-hidden="true">?</span>
          </div>
          <h2 class="stand-name">Open</h2>
          <p class="stand-num stand-num--open" aria-label="no ground held">—</p>
          <p class="stand-meta">No ground yet</p>
        </article>
      {/each}
    </section>

    {#if missingPlayers > 0}
      <p class="seatline">
        <b>{missingPlayers} of 5 seats are still open.</b> The rest of the household
        is phone-tracked and its history has not been walked into the ledger yet —
        so every cell on this map is currently cheap to take.
      </p>
    {/if}

    <!-- The filter. John's requirement, and the reason the ledger carries an
         activity type at all: a bike loop encloses about ten times a run for
         the same effort, so a ride counts, and it is filterable. -->
    <section class="tools" aria-label="What counts">
      <div class="tool-group">
        <span class="metric-label">Counts as territory</span>
        <div class="chips">
          {#each chips as c (c.key)}
            <button
              type="button"
              class="chip"
              class:on={selectedActivityKeys.has(c.key)}
              aria-pressed={selectedActivityKeys.has(c.key)}
              onclick={() => toggleActivity(c.key)}
              disabled={applying}>{c.label}</button
            >
          {/each}
        </div>
      </div>
      <div class="tool-group">
        <span class="metric-label">Captured within</span>
        <div class="chips" role="radiogroup" aria-label="Date window">
          {#each DATE_WINDOWS as w (w.key)}
            <button
              type="button"
              class="chip"
              role="radio"
              class:on={selectedWindow === w.key}
              aria-checked={selectedWindow === w.key}
              onclick={() => pickWindow(w.key)}
              disabled={applying}>{w.label}</button
            >
          {/each}
        </div>
      </div>
      <div class="tool-group">
        <span class="metric-label">Players</span>
        <div class="chips">
          {#each roster as p (p.subject)}
            <button
              type="button"
              class="chip chip--who"
              class:on={selectedSubjects.has(p.subject)}
              style="--who: {p.colour}"
              aria-pressed={selectedSubjects.has(p.subject)}
              onclick={() => toggleSubject(p.subject)}
              disabled={applying}
            >
              <span class="chip-sw" data-hatch={p.hatch} aria-hidden="true"></span>{p.name}
            </button>
          {/each}
        </div>
      </div>
      <p class="tool-note">
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
    </section>

    <div class="stage">
      <div class="stage-map">
        <TerritoryMap
          territory={lg.territory}
          players={lg.players}
          cellAreaM2={lg.cellAreaM2}
        />
        <ul class="legend" aria-label="Territory legend">
          {#each lg.standings.filter((s) => s.tiles > 0) as s (s.subject)}
            {@const p = lg.players.find((x) => x.subject === s.subject)}
            <li style="--who: {p?.colour ?? 'var(--text-primary)'}">
              <span class="chip-sw" data-hatch={p?.hatch} aria-hidden="true"></span>
              <b>{p?.initial}</b>
              {p?.name ?? s.subject}
              <span class="legend-v">{km2(s.areaM2)} km²</span>
            </li>
          {/each}
          {#if lg.territory.length === 0}
            <li class="legend-none">
              {lg.window.key === 'all'
                ? 'No ground matches this filter.'
                : `Nobody captured anything in ${windowLine}.`}
            </li>
          {/if}
        </ul>
      </div>
      <aside class="stage-rail">
        <CaptureFeed feed={lg.feed} players={lg.players} window={lg.window} {now} />
        <section class="rules" aria-label="How ground is won">
          <header class="rules-hd"><span class="metric-label">How ground is won</span></header>
          <ol class="rules-list">
            <li><b>×3</b><span>Close a loop and every cell inside it is yours.</span></li>
            <li><b>×1</b><span>Walk, run or ride through and you claim the line you crossed.</span></li>
            <li><b>½</b><span>A capture halves in weight every 30 days — old ground gets cheap, but never changes hands on its own.</span></li>
            <li><b>1</b><span>One capture per person, per cell, per day. Ten laps of the garden score once.</span></li>
          </ol>
        </section>
      </aside>
    </div>

    <LandgrabBoards
      standings={lg.standings}
      players={lg.players}
      dangle={lg.dangle}
      feed={lg.feed}
      window={lg.window}
      {now}
    />

    <p class="foot">
      Territory is scored on a hidden grid of {Math.round(lg.cellSideM)} m cells; the
      map shows dissolved, smoothed ground, never the grid. A capture decays with
      a thirty-day half-life, so ground gets cheaper to steal but never changes
      hands on its own — somebody has to actually go there.
      {#if lg.window.key !== 'all'}
        The date window narrows the evidence, not the picture: the map, every
        board, the capture feed and the ground-in-play figure all answer over
        {windowLine}. The gained and lost columns are the one thing measured
        against something else — they compare this window with {lg.window
          .weekBasis}, because a narrowed present held against an unnarrowed
        week ago would report movement nobody made.
      {/if}
    </p>
  {/if}
</div>

<style>
  .lg {
    max-width: 1440px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 2rem;
    padding-bottom: 1rem;
    margin-bottom: 1.5rem;
    border-bottom: 2px solid var(--line-title);
  }
  .hdr-l {
    min-width: 0;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 0.4rem;
  }
  h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-display-md);
    line-height: 0.9;
    letter-spacing: -0.02em;
    text-transform: uppercase;
  }
  .lede {
    margin: 0.8rem 0 0;
    max-width: 56ch;
    font-size: var(--fs-body-lg);
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .hdr-r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    white-space: nowrap;
  }
  .hdr-stat {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
    margin: 0.75rem 0 0;
  }
  .hdr-num {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  /* The window's name lives on this line, so it is the one part of the header
     that has to be allowed to wrap: `.hdr-r` is nowrap for the big numeral's
     sake, and "1,358 cells / the last 7 days / read just now" is wider than a
     390 px phone. It wraps rather than shrinking because the 12 px floor is
     gated sitewide. */
  .hdr-sub {
    white-space: normal;
    text-align: right;
    max-width: 34ch;
  }
  .hdr-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-left: 5px;
  }

  /* ---- standings ---- */
  /* Five seats, always. The roster is the shape of the game, so the grid is
     the roster rather than however many people happen to have scored. */
  .standings {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    margin-bottom: 1.5rem;
  }
  @media (max-width: 1200px) {
    .standings {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .stand {
    border-left: 4px solid var(--who);
    background: var(--bg);
  }
  .stand--open {
    border-left-color: var(--accent-tint-35);
    background: transparent;
  }
  .stand--open .stand-name,
  .stand--open .stand-num {
    color: var(--text-ghost);
  }
  /* An empty seat is a fact, not a headline: it keeps the seat's shape and
     gives the page's one big numeral back to whoever actually holds ground. */
  .stand-num--open {
    font-size: var(--fs-display-xs);
    line-height: 1.6;
  }
  .stand-badge--open {
    background: transparent;
    border: 1px solid var(--accent-tint-35);
    color: var(--accent);
  }
  .seatline {
    margin: -0.5rem 0 1.5rem;
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
  .stand-hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .stand-badge {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: var(--fs-label);
    width: 26px;
    height: 26px;
    line-height: 26px;
    text-align: center;
    color: var(--bg);
    background: var(--who);
    border-radius: var(--radius-sharp);
  }
  .stand-name {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
  }
  .stand-num {
    margin: 10px 0 0;
    font-family: var(--font-display);
    font-size: var(--fs-num-lg);
    line-height: 0.88;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
    color: var(--who);
  }
  .stand-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
    margin-left: 6px;
  }
  .stand-meta {
    margin: 8px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .stand-week {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 10px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
  }
  .up {
    color: var(--success);
  }
  .down {
    color: var(--trend-down);
  }

  /* ---- filter ---- */
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 12px 32px;
    padding: 14px 16px;
    margin-bottom: 1.25rem;
    border: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .tool-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    padding: 6px 11px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      color var(--t-fast) var(--ease-out),
      border-color var(--t-fast) var(--ease-out),
      background var(--t-fast) var(--ease-out);
  }
  .chip:hover:not(:disabled) {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }
  .chip.on {
    background: var(--text-primary);
    border-color: var(--text-primary);
    color: var(--bg);
  }
  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .chip--who {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .chip--who.on {
    background: var(--who);
    border-color: var(--who);
    color: var(--bg);
  }
  .chip--who.on .chip-sw {
    border-color: var(--bg);
    --who: var(--bg);
  }
  .tool-note {
    flex: 1 1 24ch;
    margin: 0;
    align-self: center;
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-muted);
    max-width: 46ch;
  }

  /* ---- stage ---- */
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }
  .stage-map {
    min-width: 0;
  }
  .stage-rail {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .rules {
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .rules-hd {
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .rules-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .rules-list li {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    gap: 12px;
    align-items: baseline;
    padding: 11px 16px;
    border-bottom: 1px solid var(--line-hair);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .rules-list li:last-child {
    border-bottom: 0;
  }
  .rules-list b {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: var(--fs-body-lg);
    color: var(--accent);
    letter-spacing: -0.01em;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 18px;
    list-style: none;
    margin: 0;
    padding: 10px 14px;
    border: 1px solid var(--line-strong);
    border-top: 0;
    background: var(--surface-rail);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .legend b {
    color: var(--who);
    font-weight: 700;
  }
  .legend-v {
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .legend-none {
    color: var(--accent);
  }

  .chip-sw {
    display: block;
    width: 14px;
    height: 14px;
    border: 1px solid var(--who);
    border-radius: var(--radius-sharp);
    flex: 0 0 auto;
  }
  .chip-sw[data-hatch='diag'] {
    background-image: repeating-linear-gradient(45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .chip-sw[data-hatch='back'] {
    background-image: repeating-linear-gradient(-45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .chip-sw[data-hatch='vert'] {
    background-image: repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .chip-sw[data-hatch='horiz'] {
    background-image: repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .chip-sw[data-hatch='grid'] {
    background-image:
      repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .chip-sw[data-hatch='dots'] {
    background-image: radial-gradient(var(--who) 1.6px, transparent 1.7px);
    background-size: 6px 6px;
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

  @media (max-width: 1100px) {
    .stage {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 700px) {
    .lg {
      margin-top: 1.25rem;
      padding: 0 1rem;
    }
    .page-hdr {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }
    .hdr-r {
      align-items: flex-start;
    }
    .hdr-stat {
      align-items: flex-start;
      margin-top: 0.5rem;
    }
    .hdr-sub {
      text-align: left;
    }
    h1 {
      font-size: var(--fs-display-sm);
    }
    .lede {
      font-size: var(--fs-body);
    }
    .standings {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .stand-num {
      font-size: var(--fs-num-md);
    }
    .stand-name {
      font-size: var(--fs-body-lg);
    }
    .virgin {
      padding: 1.5rem 1.25rem;
    }
  }
</style>
