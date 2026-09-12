<script lang="ts">
  /**
   * Who holds the ground — one 100% bar, then one row each.
   *
   * The bar is the only chart on the page that answers "how is the household
   * split", and it answers it in the same colours and hatches the map paints
   * territory in, so the two read as one picture. The rows underneath are the
   * legend: colour never carries identity alone here either, so every row
   * shows the swatch's hue AND the mono initial AND the name.
   *
   * Open seats stay as muted rows rather than being summarised away. Four of
   * five players only reached the ledger in July, and a board that hid the
   * empty seats would read as "John won" rather than "the game has not
   * started".
   */
  import Swatch from './Swatch.svelte';
  import { identityMap, km2 } from './identity';
  import type { PlayerIdentity } from './identity';
  import type { ShareRow, Standing } from './types';

  let {
    share,
    standings,
    players,
    openSeats,
  }: {
    share: ShareRow[];
    standings: Standing[];
    players: PlayerIdentity[];
    /** Seat numbers with nobody in them, drawn rather than counted. */
    openSeats: number[];
  } = $props();

  const who = $derived(identityMap(players));
  /** Cells and geos per player — the two figures the share row itself does not
   *  carry, and the reason `standings` is a prop rather than a re-derivation. */
  const held = $derived(new Map(standings.map((s) => [s.subject, s])));

  const ordinal = (i: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][i] ?? `${i + 1}th`;

  /**
   * One decimal below 10%, none above.
   *
   * "0% of the Darlington box" is the wrong answer for somebody holding a
   * quarter of a square kilometre of it, and "2.34%" is more precision than a
   * cell count of a few hundred can carry. The break at ten is where the extra
   * digit stops being noise.
   */
  const fmtPct = (v: number) => {
    const p = v * 100;
    return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
  };

  const basis = (v: number) => `${(Math.max(0, Math.min(1, v)) * 100).toFixed(3)}%`;
</script>

<div class="lg-share">
  {#if share.length}
    <!-- A stacked 100% bar. The 2px gaps are surface, not stroke: neighbouring
         hues one step apart read as distinct because of the gap, and a border
         round each segment would add ink that is not data. `flex-shrink`
         absorbs the gaps in proportion to each basis, so the ratios survive. -->
    <div class="lg-share-bar" role="img" aria-label="Share of household ground">
      {#each share as s (s.subject)}
        {@const p = who.get(s.subject)}
        <span
          class="lg-share-seg"
          data-hatch={p?.hatch ?? 'dots'}
          style="--who: {p?.colour ?? 'var(--text-primary)'}; flex-basis: {basis(s.share)}"
          title="{p?.name ?? s.subject} — {fmtPct(s.share)} of household ground, {km2(
            s.areaM2,
          )} km²"
        ></span>
      {/each}
    </div>
  {:else}
    <p class="lg-share-none">Nobody holds ground under this filter.</p>
  {/if}

  <ol class="lg-share-rows">
    {#each share as s, i (s.subject)}
      {@const p = who.get(s.subject)}
      {@const st = held.get(s.subject)}
      <li class="lg-share-row" style="--who: {p?.colour ?? 'var(--text-primary)'}">
        <span class="lg-rank metric-label">{ordinal(i)}</span>
        <span class="lg-sw">
          <Swatch colour={p?.colour ?? 'var(--text-primary)'} hatch={p?.hatch ?? 'dots'} />
        </span>
        <span class="lg-badge" aria-hidden="true">{p?.initial ?? '?'}</span>
        <span class="lg-name">
          {p?.name ?? s.subject}
          <small
            >{(st?.tiles ?? s.cells).toLocaleString('en-GB')} cells{#if st}
              · {st.geos} geo{st.geos === 1 ? '' : 's'}{/if}</small
          >
        </span>
        <span class="lg-num">{km2(s.areaM2)}<small>km²</small></span>
        <span class="lg-figs">
          <span class="lg-pct lg-pct--house">{Math.round(s.share * 100)}%<small>of the household</small
          ></span>
          <span class="lg-pct lg-pct--home">{fmtPct(s.homeShare)}<small>of the Darlington box</small
          ></span>
          <span class="lg-week">
            <b class="up">+{km2(s.gainedM2)}</b>
            <b class="down">−{km2(s.lostM2)}</b>
            <small>km² vs a week ago</small>
          </span>
        </span>
      </li>
    {/each}
    {#each openSeats as seat (seat)}
      <li class="lg-share-row lg-share-row--open">
        <span class="lg-rank metric-label accent">{seat}</span>
        <span class="lg-badge lg-badge--open" aria-hidden="true">?</span>
        <span class="lg-name">Seat {seat} · Open</span>
        <span class="lg-num lg-num--open">No ground yet</span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .lg-share {
    border: 1px solid var(--line-strong);
    background: var(--bg);
  }

  /* ---- the bar ---- */
  .lg-share-bar {
    display: flex;
    gap: 2px;
    height: 22px;
    margin: 16px 16px 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    overflow: hidden;
  }
  .lg-share-seg {
    min-width: 2px;
    flex-grow: 0;
    flex-shrink: 1;
    background-color: color-mix(in srgb, var(--who) 28%, transparent);
  }
  /* The same six hatch rules `Swatch` draws, at a segment's proportions. A
     Swatch cannot be stretched — it is a fixed square by contract — so the
     alphabet is repeated here rather than the component being bent. */
  .lg-share-seg[data-hatch='diag'] {
    background-image: repeating-linear-gradient(45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .lg-share-seg[data-hatch='back'] {
    background-image: repeating-linear-gradient(-45deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .lg-share-seg[data-hatch='vert'] {
    background-image: repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .lg-share-seg[data-hatch='horiz'] {
    background-image: repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .lg-share-seg[data-hatch='grid'] {
    background-image:
      repeating-linear-gradient(90deg, var(--who) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(0deg, var(--who) 0 2px, transparent 2px 6px);
  }
  .lg-share-seg[data-hatch='dots'] {
    background-image: radial-gradient(var(--who) 1.6px, transparent 1.7px);
    background-size: 6px 6px;
  }
  .lg-share-none {
    margin: 0;
    padding: 16px;
    font-size: var(--fs-body-sm);
    color: var(--text-muted);
  }

  /* ---- the rows ---- */
  .lg-share-rows {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .lg-share-row {
    display: grid;
    grid-template-columns: 40px 14px 26px minmax(0, 1fr) auto auto auto auto;
    grid-template-areas: 'rank sw badge name num pct home week';
    align-items: center;
    gap: 6px 16px;
    padding: 12px 16px;
    border-top: 1px solid var(--line-hair);
    border-left: 4px solid var(--who);
  }
  /* The open row has no `--who`, so it cannot inherit the seated row's
     `border-left: 4px solid var(--who)` — an undefined custom property makes
     the whole shorthand invalid at computed-value time and the style falls
     back to `none`, taking the border with it. A `border-left-color` on its own
     then paints a border that does not exist. The full shorthand, or nothing.
     The empty `sw` column stays so the badges line up down the list. */
  .lg-share-row--open {
    grid-template-columns: 40px 14px 26px minmax(0, 1fr) auto;
    grid-template-areas: 'rank sw badge name num';
    border-left: 4px solid var(--accent-tint-35);
    background: transparent;
  }
  /* A pass-through on the wide layout so the three small figures sit in their
     own grid cells; under 700px it becomes the second line's one flex row. */
  .lg-figs {
    display: contents;
  }
  .lg-rank {
    grid-area: rank;
  }
  /* The bar's segments carry colour AND hatch; the rows carried colour and an
     initial. Without the hatch here a reader who cannot separate two hues has
     no way to map a hatched segment back to a name, which is the whole reason
     the hatch exists. The wrapper is what takes the grid area — a child
     component's root is out of reach of this component's scoped CSS. */
  .lg-sw {
    grid-area: sw;
    display: flex;
    align-items: center;
  }
  .lg-badge {
    grid-area: badge;
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
  .lg-badge--open {
    background: transparent;
    border: 1px solid var(--accent-tint-35);
    color: var(--accent);
  }
  .lg-name {
    grid-area: name;
    min-width: 0;
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.05;
    text-transform: uppercase;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  /* `overflow-wrap: anywhere` above is right for a real name in a 1fr column
     that has other columns to yield to. The open row has no such column: the
     `auto` track holding "No ground yet" takes its max-content width first, and
     at 390px what is left starves "SEAT 2 · OPEN" into "SEA / T 2 / · / OP /
     EN". So the seat label never breaks — it ellipsises if it ever has to — and
     the figure moves out of its way under 700px instead. */
  .lg-share-row--open .lg-name {
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .lg-name small {
    display: block;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .lg-num {
    grid-area: num;
    font-family: var(--font-display);
    font-size: var(--fs-num-md);
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--who);
  }
  .lg-num--open {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .lg-num small,
  .lg-pct small,
  .lg-week small {
    display: block;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .lg-pct {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--text-primary);
  }
  .lg-pct--house {
    grid-area: pct;
  }
  .lg-pct--home {
    grid-area: home;
  }
  .lg-week {
    grid-area: week;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
  }
  .lg-week b {
    font-weight: 500;
  }
  .lg-week small {
    flex-basis: 100%;
    margin-top: 1px;
    text-align: right;
  }
  .up {
    color: var(--success);
  }
  .down {
    color: var(--trend-down);
  }

  /* Two lines under 700px: who and how much, then the three small figures.
     Eight columns on a 360px phone give each figure under 30px before a digit
     is drawn, and the 12px floor is gated sitewide, so the layout is what
     gives. */
  @media (max-width: 700px) {
    .lg-share-row {
      grid-template-columns: 34px 14px 26px minmax(0, 1fr) auto;
      grid-template-areas:
        'rank sw badge name num'
        'figs figs figs figs figs';
      gap: 12px 10px;
      padding: 12px;
    }
    .lg-share-row--open {
      grid-template-columns: 34px 14px 26px minmax(0, 1fr);
      grid-template-areas:
        'rank sw badge name'
        'num num num num';
    }
    /* Second line now, so it reads left with the figures above it rather than
       hanging off a right edge that is no longer there. */
    .lg-num--open {
      text-align: left;
    }
    .lg-figs {
      grid-area: figs;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 10px 20px;
    }
    .lg-pct,
    .lg-week {
      text-align: left;
      justify-content: flex-start;
    }
    .lg-week small {
      text-align: left;
    }
    .lg-name {
      font-size: var(--fs-body-lg);
    }
    .lg-num {
      font-size: var(--fs-body-lg);
    }
    .lg-share-bar {
      margin: 12px 12px 10px;
    }
  }
</style>
