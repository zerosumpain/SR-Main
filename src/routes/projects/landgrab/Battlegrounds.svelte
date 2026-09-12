<script lang="ts">
  /**
   * Where it is actually a fight, and what to do about it.
   *
   * Total ground is 91% ground nobody else has been near, so a ranking by area
   * is a ranking of who walks furthest from the house. A battleground is the
   * opposite question: a connected clump two or more of you have stood on. The
   * table ranks those by how often they have changed hands, because a clump
   * with a settled owner is not a fight either.
   *
   * Beneath it, the one actionable line on the page. `nextMoves` overstates the
   * gap on purpose (a challenger with no score there is scored zero, not their
   * runner-up score), so a move is never sold as easier than it is.
   */
  import Swatch from './Swatch.svelte';
  import { identityMap, windowPhrase, windowShort } from './identity';
  import type { PlayerIdentity } from './identity';
  import type { Battleground, NextMove, WindowState } from './types';

  let {
    battlegrounds,
    moves,
    players,
    window: win,
    onopen,
  }: {
    battlegrounds: Battleground[];
    moves: NextMove[];
    players: PlayerIdentity[];
    /** Both surfaces answer over the active window and say so themselves. */
    window: WindowState;
    /** A tile key ("x:y") — everything the drill needs to open the region. */
    onopen: (id: string) => void;
  } = $props();

  const who = $derived(identityMap(players));
  const windowTag = $derived(windowShort(win.key));
  const windowLine = $derived(windowPhrase(win.key));

  const nameOf = (subject: string) => who.get(subject)?.name ?? subject;
  const colourOf = (subject: string) => who.get(subject)?.colour ?? 'var(--text-primary)';

  /** No name within 250 m of the centre — print the coordinates rather than
   *  blocking the page on a geocoder that is already out of budget. */
  const whereOf = (b: Battleground) =>
    b.name ?? `near ${b.centre[0].toFixed(3)}, ${b.centre[1].toFixed(3)}`;

  /** The module clamps at 999. Printing the ceiling as a bare number reads as a
   *  measurement rather than "more cells than one loop will ever cover". */
  const loops = (n: number) => (n >= 999 ? '999+' : `${n}`);

  const pctOf = (part: number, whole: number) =>
    `${whole ? Math.min(100, Math.round((part / whole) * 100)) : 0}%`;
</script>

<div class="lg-bg-wrap">
  <section class="lg-bg-sec" aria-label="Battlegrounds">
    <header class="lg-bg-hd">
      <span class="metric-label">Battlegrounds</span>
      <span class="metric-label muted">
        {battlegrounds.length} clump{battlegrounds.length === 1 ? '' : 's'} · {windowTag}
      </span>
    </header>

    {#if battlegrounds.length === 0}
      <p class="lg-bg-empty">
        {win.key === 'all'
          ? 'Nobody has contested any ground yet.'
          : `Nobody has contested any ground in ${windowLine}.`}
      </p>
    {:else}
      <table class="lg-bg">
        <!-- Five columns on a 360px phone is 40px a column before a figure is
             drawn. Fixed layout plus declared widths makes the container the
             authority rather than the longest place name; the contenders
             column then gives way entirely below 480px. -->
        <colgroup>
          <col class="c-where" />
          <col class="c-cells" />
          <col class="c-holder" />
          <col class="c-hands" />
          <col class="c-cont" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="metric-label">Where</th>
            <th scope="col" class="metric-label num-col">Cells</th>
            <th scope="col" class="metric-label">Holder</th>
            <th scope="col" class="metric-label num-col">Changed hands</th>
            <th scope="col" class="metric-label">Contenders</th>
          </tr>
        </thead>
        <tbody>
          {#each battlegrounds as b (b.id)}
            {@const top = b.holders[0]}
            <tr>
              <th scope="row" class="lg-bg-where">
                <button type="button" class="lg-bg-open" onclick={() => onopen(b.id)}>
                  {whereOf(b)}
                </button>
              </th>
              <td class="num-col">{b.cells.toLocaleString('en-GB')}</td>
              <td class="lg-bg-holder">
                {#if top}
                  <span class="lg-bg-holder-who" style="--who: {colourOf(top.subject)}">
                    <Swatch colour={colourOf(top.subject)} hatch={who.get(top.subject)?.hatch ?? 'dots'} />
                    <span class="lg-bg-holder-name">{nameOf(top.subject)}</span>
                  </span>
                  <span
                    class="lg-bg-track"
                    style="--who: {colourOf(top.subject)}"
                    role="img"
                    aria-label="{nameOf(top.subject)} holds {pctOf(top.cells, b.cells)} of it"
                  >
                    <span class="lg-bg-fill" style="width: {pctOf(top.cells, b.cells)}"></span>
                  </span>
                {:else}
                  <span class="lg-bg-nobody">nobody</span>
                {/if}
              </td>
              <td class="num-col" class:hot={b.handovers > 0}>
                {b.handovers.toLocaleString('en-GB')}
              </td>
              <td class="lg-bg-cont">
                {#each b.contenders as c (c)}
                  <span
                    class="lg-bg-badge"
                    style="--who: {colourOf(c)}"
                    title={nameOf(c)}>{who.get(c)?.initial ?? '?'}</span
                  >
                {/each}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <section class="lg-bg-sec" aria-label="Next best move">
    <header class="lg-bg-hd">
      <span class="metric-label">Next best move</span>
      <span class="metric-label muted">cheapest ground next door</span>
    </header>
    {#if moves.length === 0}
      <p class="lg-bg-empty">
        No cheap ground next to anyone yet — everything nearby is freshly held.
      </p>
    {:else}
      <ol class="lg-moves">
        {#each moves as m (m.subject)}
          <li class="lg-move" style="--who: {colourOf(m.subject)}">
            <Swatch colour={colourOf(m.subject)} hatch={who.get(m.subject)?.hatch ?? 'dots'} />
            <p class="lg-move-line">
              <span class="lg-move-who">{nameOf(m.subject)}</span>
              <span class="lg-move-arrow" aria-hidden="true">→</span>
              <b>{m.cells.toLocaleString('en-GB')}</b>
              of {nameOf(m.holder)}'s cells{m.near ? ` near ${m.near}` : ''} — a single loop of up
              to <b>{loops(m.loopCells)}</b> cells takes them.
            </p>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>

<style>
  .lg-bg-wrap {
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .lg-bg-sec + .lg-bg-sec {
    border-top: 1px solid var(--line-strong);
  }
  .lg-bg-hd {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--line-strong);
    background: var(--surface-rail);
  }
  .lg-bg-empty {
    margin: 0;
    padding: 18px 16px;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 52ch;
  }

  /* ---- the table ---- */
  .lg-bg {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
  }
  .c-where {
    width: 34%;
  }
  .c-cells {
    width: 12%;
  }
  .c-holder {
    width: 26%;
  }
  .c-hands {
    width: 14%;
  }
  .c-cont {
    width: 14%;
  }
  .lg-bg th,
  .lg-bg td {
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
    vertical-align: middle;
  }
  /* `CONTENDERS` is ten characters with no break opportunity in them, and its
     column is 14% — about 63px between 481 and 700px, where the column has not
     yet been dropped. Left to itself the word crosses the table's border
     rather than wrapping. */
  .lg-bg thead th {
    border-bottom: 1px solid var(--line-strong);
    vertical-align: bottom;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .lg-bg tbody tr:last-child th,
  .lg-bg tbody tr:last-child td {
    border-bottom: 0;
  }
  .num-col {
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  th.num-col {
    text-align: right;
  }
  /* Ground that has moved is the whole point of the ranking, so the number
     that moved is the one thing in the table wearing the accent. */
  .num-col.hot {
    color: var(--accent);
  }
  .lg-bg-where {
    font-weight: 400;
    padding: 0;
  }
  .lg-bg-open {
    display: block;
    width: 100%;
    padding: 10px 14px;
    border: 0;
    background: transparent;
    font-family: var(--font-display);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.01em;
    text-align: left;
    color: var(--text-primary);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .lg-bg-open:hover,
  .lg-bg-open:focus-visible {
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .lg-bg-holder-who {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .lg-bg-holder-name {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    text-transform: uppercase;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  /* A meter, not a chart: the unfilled track is the same ink at a hairline
     weight, so the proportion reads across the whole bar. */
  .lg-bg-track {
    display: block;
    height: 3px;
    margin-top: 7px;
    background: var(--line-hair);
  }
  .lg-bg-fill {
    display: block;
    height: 100%;
    background: var(--who);
  }
  .lg-bg-nobody {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .lg-bg-cont {
    line-height: 1;
  }
  .lg-bg-badge {
    display: inline-block;
    margin: 0 4px 4px 0;
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: var(--fs-label-xs);
    width: 20px;
    height: 20px;
    line-height: 20px;
    text-align: center;
    color: var(--bg);
    background: var(--who);
    border-radius: var(--radius-sharp);
  }

  /* ---- next best move ---- */
  .lg-moves {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lg-move {
    display: grid;
    grid-template-columns: 14px minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    padding: 12px 16px 12px 13px;
    border-bottom: 1px solid var(--line-hair);
    border-left: 3px solid var(--who);
  }
  .lg-move:last-child {
    border-bottom: 0;
  }
  .lg-move-line {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    overflow-wrap: anywhere;
  }
  .lg-move-who {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    text-transform: uppercase;
    color: var(--who);
  }
  .lg-move-arrow {
    font-family: var(--font-mono);
    color: var(--text-ghost);
  }
  .lg-move-line b {
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }

  @media (max-width: 700px) {
    .lg-bg th,
    .lg-bg td {
      padding: 10px 8px;
    }
    .lg-bg-open {
      padding: 10px 8px;
    }
    .lg-bg-hd {
      padding: 12px 10px;
    }
    .lg-bg-empty,
    .lg-move {
      padding-left: 10px;
      padding-right: 10px;
    }
  }
  /* Below 480px the contenders are the column that goes: the initials repeat
     the holder in most rows, and four columns is the most a 360px phone can
     hold without the last one running off the viewport. */
  @media (max-width: 480px) {
    .c-where {
      width: 40%;
    }
    .c-cells {
      width: 15%;
    }
    .c-holder {
      width: 29%;
    }
    .c-hands {
      width: 16%;
    }
    .c-cont {
      width: 0;
    }
    .lg-bg thead th:nth-child(5),
    .lg-bg tbody td:nth-child(5) {
      display: none;
    }
  }
  @media (pointer: coarse) {
    .lg-bg-open {
      min-height: 40px;
    }
  }
</style>
