<script lang="ts">
  // 01 — TOTALS. The dark head of the ledger: what the phone has sent, and
  // five figures describing whatever subset of it is currently filtered.
  //
  // The mono line under the tiles is not a caption, it is the contract. These
  // totals move with the FILTER and not with the page — a "this year" total
  // that silently meant "the rows on screen" would be a lie, and the one thing
  // that stops a reader assuming it is to say so under the number.
  //
  // The segments tile is the only one wearing accent: it is the figure this
  // page exists to make reachable, and the rest of the health hub hangs off it.
  import type { FilteredTotals } from '$lib/health/activity-list';

  interface Props {
    /** Over the FILTERED rows, never the rendered ones. */
    totals: FilteredTotals;
    /** Moving time, summed off the rows — `FilteredTotals.durationS` is elapsed. */
    movingS: number;
    /** Segment crossings across the filtered rows. */
    crossings: number;
    /** How many of those rows crossed at least one known segment. */
    crossedOn: number;
    /** Rows matching the filter, and rows the loader actually sent. */
    matching: number;
    loaded: number;
    /** The loader's row cap, and whether it was hit. */
    limit: number;
    truncated: boolean;
    /** Earliest local day in the loaded set, `YYYY-MM-DD`. */
    earliest: string | null;
  }

  let {
    totals,
    movingS,
    crossings,
    crossedOn,
    matching,
    loaded,
    limit,
    truncated,
    earliest,
  }: Props = $props();

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  const since = $derived.by((): string | null => {
    if (!earliest) return null;
    const [y, m] = earliest.slice(0, 10).split('-');
    const month = MONTHS[Number(m) - 1];
    if (!month || !y) return null;
    // With the cap hit, the oldest row loaded is not the oldest row there is,
    // and "since" would be a claim about history this page cannot see.
    return `${truncated ? 'Earliest loaded' : 'Since'} ${month} ${y} · no retroactive push`;
  });

  const km = $derived(Math.round(totals.distanceM / 1000).toLocaleString('en-GB'));
  const hours = $derived(Math.round(movingS / 3600).toLocaleString('en-GB'));
  const climb = $derived(Math.round(totals.elevationGainM).toLocaleString('en-GB'));
</script>

<section class="at">
  <div class="at-inner">
    <div class="at-head">
      <div class="at-head-left">
        <p class="at-kicker">Health · Activities</p>
        <h1 class="at-title">Everything<br />the phone sent</h1>
        <p class="at-intro">
          Every outdoor workout Apple Health has forwarded, with its GPS trace, heart rate and
          splits. Every heading sorts and filters, and every row carries the single best thing
          about that outing.
        </p>
      </div>
      <div class="at-readout">
        {#if since}<p class="at-since">{since}</p>{/if}
        <p class="at-rows">
          {matching.toLocaleString('en-GB')} of {loaded.toLocaleString('en-GB')} rows shown · cap
          {limit.toLocaleString('en-GB')}
        </p>
      </div>
    </div>

    <div class="at-tiles">
      <div class="at-tile">
        <p class="at-tile-label">Outings</p>
        <p class="at-tile-value">{totals.count.toLocaleString('en-GB')}</p>
      </div>
      <div class="at-tile">
        <p class="at-tile-label">Distance</p>
        <p class="at-tile-value">{km}<span class="at-unit">km</span></p>
      </div>
      <div class="at-tile">
        <p class="at-tile-label">Moving time</p>
        <p class="at-tile-value">{hours}<span class="at-unit">h</span></p>
      </div>
      <div class="at-tile">
        <p class="at-tile-label">Climb</p>
        <p class="at-tile-value">{climb}<span class="at-unit">m</span></p>
      </div>
      <div class="at-tile lit">
        <p class="at-tile-label">Segments crossed</p>
        <p class="at-tile-value">{crossings.toLocaleString('en-GB')}</p>
        <p class="at-tile-sub">
          Crossings on {crossedOn.toLocaleString('en-GB')} outings
        </p>
      </div>
    </div>

    <p class="at-note">
      Totals come from the filter, not the page — a "this year" total that silently meant "the rows
      shown" would be a lie.
    </p>
  </div>
</section>

<style>
  .at {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(30px, 3.6vw, 52px) clamp(20px, 3vw, 44px);
  }
  .at-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  .at-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 32px;
    flex-wrap: wrap;
    margin-bottom: 28px;
  }
  .at-head-left {
    min-width: 0;
  }

  .at-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0 0 16px;
  }
  .at-title {
    font-family: var(--font-display);
    font-size: clamp(38px, 6vw, 84px);
    line-height: 0.88;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 20px;
  }
  .at-intro {
    font-size: var(--fs-body);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.75);
    max-width: 60ch;
    text-wrap: pretty;
    margin: 0;
  }

  .at-readout {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .at-since,
  .at-rows {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    margin: 0;
  }
  .at-since {
    letter-spacing: 0.15em;
    color: rgba(237, 228, 212, 0.45);
  }
  .at-rows {
    letter-spacing: 0.1em;
    color: rgba(237, 228, 212, 0.7);
  }

  .at-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 14px;
  }
  /* Each tile carries its own border with a real gap — the gap:1px trick
     paints unfilled auto-fit tracks as blocks. */
  .at-tile {
    border: 1px solid rgba(237, 228, 212, 0.16);
    border-radius: 0;
    background: rgba(237, 228, 212, 0.05);
    padding: 18px;
    min-width: 0;
  }
  .at-tile.lit {
    border-color: rgba(232, 134, 58, 0.4);
    background: rgba(232, 134, 58, 0.09);
  }

  .at-tile-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 10px;
  }
  .at-tile.lit .at-tile-label {
    color: var(--accent-on-dark);
  }

  .at-tile-value {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .at-tile.lit .at-tile-value {
    color: var(--accent-on-dark);
  }
  .at-unit {
    font-size: 15px;
    color: rgba(237, 228, 212, 0.45);
  }

  .at-tile-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 8px 0 0;
  }

  .at-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 18px 0 0;
  }
</style>
