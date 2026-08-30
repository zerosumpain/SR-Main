<script lang="ts">
  // 01 — THE CORPUS. The dark head of the segments explorer: how much ground
  // has been covered twice, and what shape it is in.
  //
  // The five tiles are a CLASSIFICATION, not five magnitudes — which is where
  // this band parts company with the activities page it borrows its shape
  // from. There, the tiles are distance and climb and hours. Here the only
  // question worth five tiles is which way each piece of ground is going, so
  // the magnitudes are demoted to the mono line under the intro and the tiles
  // carry the form taxonomy instead.
  //
  // They are the DASHBOARD'S taxonomy, from `formTaxonomy` in
  // $lib/health/segment-list — the same function section F of /health counts
  // with. Two implementations of "how many are improving" is how two pages end
  // up printing different numbers about the same corpus on the same afternoon.
  //
  // And like the activities totals, they describe the FILTER rather than the
  // page. The mono line under them says so, because a reader who assumes
  // otherwise is reading a lie rather than a subtlety.
  import {
    GETTABLE_GAP_PCT,
    HOLDING_BAND_PCT,
    MIN_EFFORTS_FOR_FORM,
  } from '$lib/trails/segments/form';
  import type { SegmentTaxonomy } from '$lib/health/segment-list';

  interface Props {
    /** Over the FILTERED rows, never the rendered ones. */
    taxonomy: SegmentTaxonomy;
    /** Efforts and ground covered across the filtered rows. */
    efforts: number;
    distanceM: number;
    climbM: number;
    /** Rows matching the filter, and rows the loader actually sent. */
    matching: number;
    loaded: number;
    /** The loader's row cap, and whether it was hit. */
    limit: number;
    truncated: boolean;
  }

  let { taxonomy, efforts, distanceM, climbM, matching, loaded, limit, truncated }: Props =
    $props();

  const n = (value: number) => value.toLocaleString('en-GB');

  interface Tile {
    key: string;
    label: string;
    count: number;
    tone: 'good' | 'plain' | 'accent' | 'ghost';
    lit?: boolean;
    note: string;
  }

  const tiles = $derived.by((): Tile[] => [
    {
      key: 'improving',
      label: 'Improving',
      count: taxonomy.improving,
      tone: 'good',
      note: `Recent median quicker than the window before it by more than ${HOLDING_BAND_PCT}%.`,
    },
    {
      key: 'holding',
      label: 'Holding',
      count: taxonomy.holding,
      tone: 'plain',
      note: `Inside the ±${HOLDING_BAND_PCT}% band. Neither gaining nor losing ground.`,
    },
    {
      key: 'slipping',
      label: 'Slipping',
      count: taxonomy.slipping,
      tone: 'accent',
      note: `Slower by more than ${HOLDING_BAND_PCT}%. Expected across the board once weekly volume drops.`,
    },
    {
      key: 'noRead',
      label: 'No form read',
      count: taxonomy.noRead,
      tone: 'ghost',
      note: `Under ${MIN_EFFORTS_FOR_FORM} efforts. Most of a corpus this size sits here permanently.`,
    },
    {
      key: 'gettable',
      label: 'Gettable',
      count: taxonomy.gettable,
      tone: 'accent',
      lit: true,
      note: `Improving and inside ${(GETTABLE_GAP_PCT * 100).toFixed(0)}% of the record — where a PB is an afternoon rather than a fantasy.`,
    },
  ]);

  const km = $derived(Math.round(distanceM / 1000));
  const climb = $derived(Math.round(climbM));
</script>

<section class="st">
  <div class="st-inner">
    <div class="st-head">
      <div class="st-head-left">
        <p class="st-kicker">Health · Segments</p>
        <h1 class="st-title">Ground you have<br />covered twice</h1>
        <p class="st-intro">
          Stretches of at least 500 m that turn up in more than one outing of the same kind, matched
          wherever two traces stay within 20 m of each other. Each one gets a name, a record and a
          direction.
        </p>
      </div>
      <div class="st-readout">
        <p class="st-cap">
          {truncated ? 'Busiest loaded' : 'Whole corpus'} · cap {n(limit)}
        </p>
        <p class="st-rows">{n(matching)} of {n(loaded)} rows shown</p>
      </div>
    </div>

    <p class="st-corpus">
      {n(matching)} segment{matching === 1 ? '' : 's'} · {n(efforts)} effort{efforts === 1
        ? ''
        : 's'} · {n(km)} km of ground · {n(climb)} m of climb
    </p>

    <div class="st-tiles">
      {#each tiles as tile (tile.key)}
        <div class="st-tile" class:lit={tile.lit}>
          <p class="st-tile-label">{tile.label}</p>
          <p class="st-tile-value tone-{tile.tone}">{n(tile.count)}</p>
          <p class="st-tile-note">{tile.note}</p>
        </div>
      {/each}
    </div>

    <p class="st-note">
      The tiles come from the filter, not the page — and from the same derivation the dashboard's
      segments section counts with, so the two cannot disagree about the same ground.
    </p>
  </div>
</section>

<style>
  .st {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(30px, 3.6vw, 52px) clamp(20px, 3vw, 44px);
  }
  .st-inner {
    max-width: 1500px;
    margin: 0 auto;
  }

  .st-head {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 32px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .st-head-left {
    min-width: 0;
  }

  .st-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0 0 16px;
  }
  .st-title {
    font-family: var(--font-display);
    font-size: clamp(38px, 6vw, 84px);
    line-height: 0.88;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 20px;
  }
  .st-intro {
    font-size: var(--fs-body);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.75);
    max-width: 60ch;
    text-wrap: pretty;
    margin: 0;
  }

  .st-readout {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .st-cap,
  .st-rows {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    margin: 0;
  }
  .st-cap {
    letter-spacing: 0.15em;
    color: rgba(237, 228, 212, 0.45);
  }
  .st-rows {
    letter-spacing: 0.1em;
    color: rgba(237, 228, 212, 0.7);
  }

  /* The magnitudes, demoted to one mono line so the tiles can be the shape of
     the corpus rather than the size of it. */
  .st-corpus {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.06em;
    color: rgba(237, 228, 212, 0.8);
    margin: 0 0 26px;
  }

  /* Each tile carries its own border with a real gap — the gap:1px trick
     paints unfilled auto-fit tracks as blocks. */
  .st-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
    gap: 14px;
  }
  .st-tile {
    border: 1px solid rgba(237, 228, 212, 0.16);
    border-radius: 0;
    background: rgba(237, 228, 212, 0.05);
    padding: 18px;
    min-width: 0;
  }
  .st-tile.lit {
    border-color: rgba(232, 134, 58, 0.4);
    background: rgba(232, 134, 58, 0.09);
  }

  .st-tile-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 10px;
  }
  .st-tile.lit .st-tile-label {
    color: var(--accent-on-dark);
  }

  .st-tile-value {
    font-family: var(--font-display);
    font-size: 34px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .st-tile-value.tone-good {
    color: var(--good-on-dark);
  }
  .st-tile-value.tone-accent {
    color: var(--accent-on-dark);
  }
  .st-tile-value.tone-ghost {
    color: rgba(237, 228, 212, 0.35);
  }

  .st-tile-note {
    font-size: var(--fs-label);
    line-height: 1.45;
    color: rgba(237, 228, 212, 0.55);
    text-wrap: pretty;
    margin: 10px 0 0;
  }

  .st-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 18px 0 0;
  }
</style>
