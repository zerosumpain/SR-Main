<script lang="ts">
  /**
   * The week, read four ways: contested ground, ground covered, gained against
   * lost, and the captures themselves. The weekly board is two columns and
   * never one signed number, because "Katie +3" hides that she took eleven
   * cells and lost eight, which is the whole story of the week.
   *
   * `Geos` and `Longest held` were retired here in v2. Both ranked the same
   * standings row a third and fourth time without answering a question anyone
   * asked of the page, and the room they took is now the capture feed's — the
   * one surface on the page that names somebody taking ground off somebody
   * else, and the reason this is a game for five people.
   */
  import CaptureFeed from './CaptureFeed.svelte';
  import Swatch from './Swatch.svelte';
  import { km2, relativeAge, windowPhrase, windowShort } from './identity';
  import type { PlayerIdentity } from './identity';
  import type {
    ContestedStanding,
    DangleLine,
    FeedItem,
    Standing,
    WindowState,
  } from './types';

  let {
    standings,
    players,
    contested,
    dangle,
    feed,
    now,
    window: win,
  }: {
    standings: Standing[];
    players: PlayerIdentity[];
    /** Ground more than one person has stood on — the only head-to-head here. */
    contested: { cells: number; board: ContestedStanding[] };
    dangle: DangleLine[];
    feed: FeedItem[];
    now: number;
    /** The active date window. Every board here answers over it, and each one
     *  says so in its own header rather than leaving the page to explain it
     *  once at the top — a board read on its own must not read as all time. */
    window: WindowState;
  } = $props();

  const windowed = $derived(win.key !== 'all');
  /** Nobody has contested anything yet — the board would be five zeroes. */
  const anyContest = $derived(contested.board.some((r) => r.visited > 0));
  const contestRows = $derived(contested.board.filter((r) => r.visited > 0));
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const windowLine = $derived(windowPhrase(win.key));
  const windowTag = $derived(windowShort(win.key));
  /** The effort lines sum the narrower of the window and a week, so the period
   *  is a number from the server, never the hard-coded "last 7 days" it was. */
  const effortLine = $derived(
    win.effortDays >= 1
      ? `last ${Math.round(win.effortDays)} day${Math.round(win.effortDays) === 1 ? '' : 's'}`
      : `last ${Math.round(win.effortDays * 24)} hours`,
  );

  const byId = $derived(new Map(players.map((p) => [p.subject, p])));
  const byArea = $derived([...standings].sort((a, b) => b.areaM2 - a.areaM2));
  const byWeek = $derived(
    [...standings].sort((a, b) => b.gainedTiles - a.gainedTiles || a.lostTiles - b.lostTiles),
  );
  const recent = $derived(feed.slice(0, 6));
</script>

<div class="boards">
  {#if anyContest}
    <section class="board board--wide">
      <header class="board-hd">
        <span class="metric-label">Contested ground</span>
        <span class="metric-label muted">
          {contested.cells.toLocaleString('en-GB')} cells · {windowTag}
        </span>
      </header>
      <table class="week">
        <!-- Four columns is one more than this table was built for, and a
             table's `width: 100%` does not bind it below its min-content: at
             360px the fourth column ran 13px past the viewport and was clipped
             rather than scrolled. Fixed layout plus declared widths makes the
             container the authority instead of the header text. -->
        <colgroup>
          <col style="width: 40%" />
          <col style="width: 20%" />
          <col style="width: 20%" />
          <col style="width: 20%" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="metric-label">Player</th>
            <th scope="col" class="metric-label num-col">Holds</th>
            <th scope="col" class="metric-label num-col">Visited</th>
            <th scope="col" class="metric-label num-col">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {#each contestRows as r (r.subject)}
            {@const p = byId.get(r.subject)}
            <tr style="--who: {p?.colour ?? 'var(--text-primary)'}">
              <th scope="row" class="week-who">
                <Swatch colour={p?.colour ?? 'var(--text-primary)'} hatch={p?.hatch ?? 'dots'} />
                {p?.name ?? r.subject}
              </th>
              <td class="num-col gain">{r.holds.toLocaleString('en-GB')}</td>
              <td class="num-col">{r.visited.toLocaleString('en-GB')}</td>
              <td class="num-col">{pct(r.winRate)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="board-note">
        Cells more than one of you has ever stood on — the only ground anyone is
        actually playing for. Everything else on this page is ranked by area, and
        area is mostly ground nobody else has been near.
      </p>
    </section>
  {/if}

  <section class="board board--wide">
    <header class="board-hd">
      <span class="metric-label">Ground covered</span>
      <span class="metric-label muted">km² · {windowTag}</span>
    </header>
    <ol class="board-list">
      {#each byArea as s, i (s.subject)}
        {@const p = byId.get(s.subject)}
        <li class="board-row" style="--who: {p?.colour ?? 'var(--text-primary)'}">
          <span class="rank">{i + 1}</span>
          <Swatch colour={p?.colour ?? 'var(--text-primary)'} hatch={p?.hatch ?? 'dots'} />
          <span class="who">{p?.name ?? s.subject}</span>
          <span class="bar" style="width: {byArea[0].areaM2 ? (s.areaM2 / byArea[0].areaM2) * 100 : 0}%"></span>
          <span class="val">{km2(s.areaM2)}</span>
        </li>
      {/each}
    </ol>
  </section>
  <section class="board board--wide">
    <header class="board-hd">
      <span class="metric-label">This week</span>
      <span class="metric-label muted">gained / lost vs {win.weekBasis}</span>
    </header>
    <table class="week">
      <colgroup>
        <col style="width: 50%" />
        <col style="width: 25%" />
        <col style="width: 25%" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" class="metric-label">Player</th>
          <th scope="col" class="metric-label num-col">Gained</th>
          <th scope="col" class="metric-label num-col">Lost</th>
        </tr>
      </thead>
      <tbody>
        {#each byWeek as s (s.subject)}
          {@const p = byId.get(s.subject)}
          <tr style="--who: {p?.colour ?? 'var(--text-primary)'}">
            <th scope="row" class="week-who">
              <Swatch colour={p?.colour ?? 'var(--text-primary)'} hatch={p?.hatch ?? 'dots'} />
              {p?.name ?? s.subject}
            </th>
            <td class="num-col gain">{s.gainedTiles ? `+${km2(s.gainedM2)}` : '—'}</td>
            <td class="num-col loss">{s.lostTiles ? `−${km2(s.lostM2)}` : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
  <section class="board">
    <header class="board-hd">
      <span class="metric-label">Most recent captures</span>
      <span class="metric-label muted">closed loops · {windowTag}</span>
    </header>
    {#if recent.length === 0}
      <p class="board-empty">
        {windowed ? `No loop closed in ${windowLine}.` : 'Nothing has closed a loop yet.'}
      </p>
    {:else}
      <ol class="board-list">
        {#each recent as c (c.id)}
          {@const p = byId.get(c.subject)}
          <li class="board-row board-row--recent" style="--who: {p?.colour ?? 'var(--text-primary)'}">
            <Swatch colour={p?.colour ?? 'var(--text-primary)'} hatch={p?.hatch ?? 'dots'} />
            <span class="who">{p?.name ?? c.subject}</span>
            <span class="recent-r">
              <span class="val val--sm">{km2(c.areaM2)} km²</span>
              <span class="when">{relativeAge(c.at, now)}</span>
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <!-- The feed used to sit in the map rail, where it competed with the map for
       the same eye. It is a board: the same cell grid, the same header, and the
       frame it drew for itself given up to the grid's own lines. -->
  <section class="board board--wide board--feed">
    <CaptureFeed {feed} {players} {now} window={win} />
  </section>
</div>

<section class="dangles" aria-label="Effort against ground">
  <header class="board-hd">
    <span class="metric-label">Effort against ground</span>
    <span class="metric-label muted">{effortLine}</span>
  </header>
  {#each dangle as d (d.subject)}
    {@const p = byId.get(d.subject)}
    <p class="dangle" style="--who: {p?.colour ?? 'var(--text-primary)'}">
      <span class="dangle-badge" aria-hidden="true">{p?.initial ?? '?'}</span>
      <span class="dangle-name">{p?.name ?? d.subject}</span>
      {#if d.movedKm === 0 && d.enclosedM2 === 0}
        <span class="dangle-quiet">nothing recorded in the {effortLine}</span>
      {:else}
        moved <b>{d.movedKm.toFixed(1)} km</b> in the {effortLine}, enclosed
        <b>{km2(d.enclosedM2)} km²</b>
        {#if d.claims}
          across {d.claims} loop{d.claims === 1 ? '' : 's'}
        {/if}
      {/if}
    </p>
  {/each}
</section>

<style>
  .boards {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    border-top: 1px solid var(--line-strong);
    border-left: 1px solid var(--line-strong);
  }
  .board {
    grid-column: span 2;
    border-right: 1px solid var(--line-strong);
    border-bottom: 1px solid var(--line-strong);
    min-width: 0;
    background: var(--bg);
  }
  /* Four boards, two to a row. `--wide` no longer means wider — every board
     here carries a table or a list that needs the full half — but the class
     stays because the markup reads by it and the two spans may diverge again. */
  .board--wide {
    grid-column: span 2;
  }
  /* The contested board is conditional, so the grid holds four boards or five.
     At five the last one lands alone on its own row beside an empty cell the
     grid draws no hairlines into — a hole rather than a board. An odd last
     child takes the full width instead. */
  .board:last-child:nth-child(odd) {
    grid-column: span 4;
  }
  /* CaptureFeed draws its own picture frame for the rail it used to live in.
     Inside the cell grid that frame doubles every line, so the board keeps the
     border and the feed gives its own up. */
  .board--feed :global(.feed) {
    border: 0;
    height: 100%;
  }
  .board-hd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 11px 14px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  /* The one board that needs a sentence under it: "contested" is a word this
     page invented and the number is meaningless without it. */
  .board-note {
    margin: 0;
    padding: 10px 14px 12px;
    border-top: 1px solid var(--line);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
  }
  .board-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .board-row {
    position: relative;
    display: grid;
    grid-template-columns: 22px 16px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-hair);
  }
  .board-row:last-child {
    border-bottom: 0;
  }
  .rank {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    font-variant-numeric: tabular-nums;
  }
  .who {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.01em;
    color: var(--text-primary);
    z-index: 1;
  }
  .val {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-body-lg);
    font-variant-numeric: tabular-nums;
    color: var(--who);
    z-index: 1;
  }
  .val--sm {
    font-size: var(--fs-label);
  }
  .when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  /* The bar is the board's one piece of chart. It sits under the row rather
     than beside it so the ranking reads as type first and quantity second. */
  .bar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 3px;
    background: var(--who);
    opacity: 0.75;
    z-index: 0;
  }
  .board-row--recent {
    grid-template-columns: 16px minmax(0, 1fr) auto;
  }
  .recent-r {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .board-empty {
    margin: 0;
    padding: 16px 14px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }

  .week {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  .week th,
  .week td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
  }
  .week thead th {
    border-bottom: 1px solid var(--line-strong);
  }
  .week tbody tr:last-child th,
  .week tbody tr:last-child td {
    border-bottom: 0;
  }
  .week-who {
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-display);
    font-size: var(--fs-label);
    font-weight: 400;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .num-col {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-label);
  }
  th.num-col {
    text-align: right;
  }
  .gain {
    color: var(--success);
  }
  .loss {
    color: var(--trend-down);
  }

  .dangles {
    border: 1px solid var(--line-strong);
    border-top: 0;
    background: var(--surface-sunken);
  }
  .dangle {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 0;
    padding: 11px 16px;
    border-bottom: 1px solid var(--line-hair);
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }
  .dangle:last-child {
    border-bottom: 0;
  }
  .dangle b {
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .dangle-badge {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: var(--fs-label-xs);
    width: 22px;
    height: 22px;
    line-height: 22px;
    text-align: center;
    color: var(--bg);
    background: var(--who);
    border-radius: var(--radius-sharp);
  }
  .dangle-quiet {
    color: var(--text-ghost);
  }
  .dangle-name {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    text-transform: uppercase;
    color: var(--who);
  }

  @media (max-width: 900px) {
    .boards {
      grid-template-columns: minmax(0, 1fr);
    }
    /* The full-width rule above is a three-class selector and a media query
       adds no specificity, so it has to be named again here or it wins. */
    .board,
    .board--wide,
    .board:last-child:nth-child(odd) {
      grid-column: span 1;
    }
  }
  /* A four-column table on a 360px phone has 56px of horizontal padding before
     a single figure is drawn. The 12px floor on the type is gated sitewide, so
     the padding is what gives. */
  @media (max-width: 430px) {
    .week th,
    .week td {
      padding: 10px 8px;
    }
    .board-hd {
      padding: 11px 10px;
    }
    .board-note {
      padding: 10px 10px 12px;
    }
  }
</style>
