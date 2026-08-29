<script lang="ts">
  /**
   * The boards. Four of the five are ranked lists over the same standings row;
   * the weekly one is two columns and never one signed number, because "Katie
   * +3" hides that she took eleven cells and lost eight, which is the whole
   * story of the week.
   *
   * `longest held` is the board a low-mileage walker can win outright — days
   * since your oldest still-owned cell changed hands — and it exists for
   * exactly that reason.
   */
  import { km2, relativeAge } from './identity';
  import type { PlayerIdentity } from './identity';
  import type { DangleLine, FeedItem, Standing } from './types';

  let {
    standings,
    players,
    dangle,
    feed,
    now,
  }: {
    standings: Standing[];
    players: PlayerIdentity[];
    dangle: DangleLine[];
    feed: FeedItem[];
    now: number;
  } = $props();

  const byId = $derived(new Map(players.map((p) => [p.subject, p])));
  const byArea = $derived([...standings].sort((a, b) => b.areaM2 - a.areaM2));
  const byGeos = $derived([...standings].sort((a, b) => b.geos - a.geos || b.areaM2 - a.areaM2));
  const byWeek = $derived(
    [...standings].sort((a, b) => b.gainedTiles - a.gainedTiles || a.lostTiles - b.lostTiles),
  );
  const byHeld = $derived([...standings].sort((a, b) => b.heldDays - a.heldDays));
  const recent = $derived(feed.slice(0, 6));
</script>

<div class="boards">
  <section class="board board--wide">
    <header class="board-hd"><span class="metric-label">Ground held</span><span class="metric-label muted">km²</span></header>
    <ol class="board-list">
      {#each byArea as s, i (s.subject)}
        {@const p = byId.get(s.subject)}
        <li class="board-row" style="--who: {p?.colour ?? 'var(--text-primary)'}">
          <span class="rank">{i + 1}</span>
          <span class="sw" data-hatch={p?.hatch} aria-hidden="true"></span>
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
      <span class="metric-label muted">gained / lost, never netted</span>
    </header>
    <table class="week">
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
              <span class="sw" data-hatch={p?.hatch} aria-hidden="true"></span>
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
    <header class="board-hd"><span class="metric-label">Geos</span><span class="metric-label muted">count</span></header>
    <ol class="board-list">
      {#each byGeos as s, i (s.subject)}
        {@const p = byId.get(s.subject)}
        <li class="board-row board-row--tight" style="--who: {p?.colour ?? 'var(--text-primary)'}">
          <span class="rank">{i + 1}</span>
          <span class="sw" data-hatch={p?.hatch} aria-hidden="true"></span>
          <span class="who">{p?.name ?? s.subject}</span>
          <span class="val">{s.geos}</span>
        </li>
      {/each}
    </ol>
  </section>
  <section class="board">
    <header class="board-hd">
      <span class="metric-label">Longest held</span><span class="metric-label muted">days</span>
    </header>
    <ol class="board-list">
      {#each byHeld as s, i (s.subject)}
        {@const p = byId.get(s.subject)}
        <li class="board-row board-row--tight" style="--who: {p?.colour ?? 'var(--text-primary)'}">
          <span class="rank">{i + 1}</span>
          <span class="sw" data-hatch={p?.hatch} aria-hidden="true"></span>
          <span class="who">{p?.name ?? s.subject}</span>
          <span class="val">{s.heldDays}</span>
        </li>
      {/each}
    </ol>
  </section>
  <section class="board">
    <header class="board-hd">
      <span class="metric-label">Most recent captures</span>
      <span class="metric-label muted">closed loops</span>
    </header>
    {#if recent.length === 0}
      <p class="board-empty">Nothing has closed a loop yet.</p>
    {:else}
      <ol class="board-list">
        {#each recent as c (c.id)}
          {@const p = byId.get(c.subject)}
          <li class="board-row board-row--recent" style="--who: {p?.colour ?? 'var(--text-primary)'}">
            <span class="sw" data-hatch={p?.hatch} aria-hidden="true"></span>
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




</div>

<section class="dangles" aria-label="Effort against ground">
  <header class="board-hd">
    <span class="metric-label">Effort against ground</span>
    <span class="metric-label muted">last 7 days</span>
  </header>
  {#each dangle as d (d.subject)}
    {@const p = byId.get(d.subject)}
    <p class="dangle" style="--who: {p?.colour ?? 'var(--text-primary)'}">
      <span class="dangle-badge" aria-hidden="true">{p?.initial ?? '?'}</span>
      <span class="dangle-name">{p?.name ?? d.subject}</span>
      {#if d.movedKm === 0 && d.enclosedM2 === 0}
        <span class="dangle-quiet">nothing recorded in the last seven days</span>
      {:else}
        moved <b>{d.movedKm.toFixed(1)} km</b> this week, enclosed
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
    grid-template-columns: repeat(6, minmax(0, 1fr));
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
  .board--wide {
    grid-column: span 3;
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
  .board-row--tight {
    grid-template-columns: 22px 16px minmax(0, 1fr) auto;
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
  .board-row--tight .sw {
    grid-column: 2;
  }
  .board-empty {
    margin: 0;
    padding: 16px 14px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }

  /* Swatch: the hatch, repeated outside the map so the legend and the ground
     agree. Colour is never the only channel anywhere on this page. */
  .sw {
    display: block;
    width: 16px;
    height: 16px;
    border: 1px solid var(--who);
    border-radius: var(--radius-sharp);
    background-color: transparent;
  }
  .sw[data-hatch='diag'] {
    background-image: repeating-linear-gradient(45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='back'] {
    background-image: repeating-linear-gradient(-45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='vert'] {
    background-image: repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='horiz'] {
    background-image: repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='grid'] {
    background-image:
      repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .sw[data-hatch='dots'] {
    background-image: radial-gradient(var(--who) 1.6px, transparent 1.7px);
    background-size: 6px 6px;
  }

  .week {
    width: 100%;
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

  @media (max-width: 1000px) {
    .boards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .board,
    .board--wide {
      grid-column: span 1;
    }
  }
  @media (max-width: 620px) {
    .boards {
      grid-template-columns: minmax(0, 1fr);
    }
    .board,
    .board--wide {
      grid-column: span 1;
    }
  }
</style>
