<script lang="ts">
  // 07 — SPLITS. Per kilometre, with the trailing part-kilometre reported
  // rather than hidden or rounded up.
  //
  // That last row is the reason this table is not a generic one. `computeSplits`
  // returns the trailing split at its TRUE distance with the pace extrapolated
  // to a full kilometre, so the column stays comparable; the floor is 10 m, so a
  // run that overshoots by a metre of GPS rounding does not gain a row reading
  // `0.00 km`. Nothing here recomputes either figure — the row is tinted, the
  // pace is suffixed `ext`, and the numbers are the service's.
  import { formatDuration, formatPace } from '$lib/trails/format';
  import type { Split } from '$lib/trails/track';
  import { splitRows, splitsNote } from '$lib/health/activity-detail';

  interface Props {
    splits: Split[];
    /** Runners read pace, cyclists read speed — the stored value is the same. */
    paceSport?: boolean;
  }

  let { splits, paceSport = true }: Props = $props();

  const rows = $derived(splitRows(splits));
  const note = $derived(splitsNote(rows));

  function rate(secondsPerKm: number): string {
    return paceSport
      ? formatPace(secondsPerKm).replace(' /km', '')
      : `${(3600 / secondsPerKm).toFixed(1)}`;
  }

  function climb(metres: number): string {
    return metres > 0 ? `+${Math.round(metres)} m` : '0 m';
  }
</script>

{#if rows.length}
  <section class="as">
    <div class="as-inner">
      <div class="as-head">
        <p class="as-kicker">Splits</p>
        <p class="as-meta">Per kilometre</p>
      </div>

      <div class="as-frame">
        <table class="as-table">
          <thead>
            <tr>
              <th class="lead" scope="col">Km</th>
              <th class="num" scope="col">Dist</th>
              <th class="num" scope="col">Time</th>
              <th class="num" scope="col">{paceSport ? 'Pace' : 'Speed'}</th>
              <th class="num" scope="col">Climb</th>
              <th class="rel" scope="col">Relative</th>
            </tr>
          </thead>
          <tbody>
            {#each rows as row (row.index)}
              <tr class:partial={row.partial}>
                <td class="lead idx">{row.index}</td>
                <td class="num" class:ghost={row.partial}
                  >{(row.distanceM / 1000).toFixed(2)} km</td
                >
                <td class="num" class:hit={row.fastest}>{formatDuration(row.durationS)}</td>
                <td class="num rate"
                  >{rate(row.paceSPerKm)}{#if row.partial}<span class="ext">ext</span>{/if}</td
                >
                <td class="num" class:hit={row.biggestClimb} class:ghost={row.partial}
                  >{climb(row.elevationGainM)}</td
                >
                <td class="rel">
                  <div
                    class="bar"
                    class:best={row.fastest}
                    class:dim={row.partial}
                    style:width="{row.relative}%"
                  ></div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if rows.some((r) => r.partial)}
        <p class="as-rule">
          The trailing split is reported but never rounded up: its distance is the true
          {(rows[rows.length - 1].distanceM / 1000).toFixed(2)} km, and its
          {paceSport ? 'pace' : 'speed'} is extrapolated to a full kilometre so the column stays comparable.
          The floor is 10 m — a run that overshoots by a metre of GPS rounding should not gain a row
          saying 0.00 km.
        </p>
      {/if}

      {#if note}<p class="as-note">{note}</p>{/if}
    </div>
  </section>
{/if}

<style>
  .as {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid var(--line);
  }
  .as-inner {
    max-width: 1300px;
    margin: 0 auto;
  }

  .as-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .as-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .as-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  /* The table scrolls sideways rather than reflowing — a split table with a
     wrapped RELATIVE column is not a split table. */
  .as-frame {
    border: 1px solid var(--card-border);
    border-radius: 0;
    overflow-x: auto;
  }
  .as-table {
    width: 100%;
    min-width: 640px;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }

  thead tr {
    background: var(--card-bg);
    border-bottom: 2px solid var(--line-strong);
  }
  th {
    padding: 11px 12px;
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-align: left;
    white-space: nowrap;
  }
  th.lead {
    padding-left: 16px;
  }
  th.num {
    text-align: right;
  }
  th.rel {
    padding-right: 16px;
    width: 42%;
  }

  tbody tr {
    border-bottom: 1px solid var(--line-hair);
  }
  tbody tr.partial {
    background: var(--surface-sunken);
    border-bottom: 0;
  }

  td {
    padding: 10px 12px;
    white-space: nowrap;
  }
  td.lead {
    padding-left: 16px;
  }
  td.num {
    text-align: right;
  }
  td.rel {
    padding-right: 16px;
  }
  .idx,
  .rate {
    color: var(--text-muted);
  }
  .ghost {
    color: var(--text-ghost);
  }
  .ext {
    margin-left: 0.4em;
    color: var(--text-ghost);
  }
  /* The quickest kilometre and the biggest climb — the two figures a reader is
     looking for before they have read a row. */
  .hit {
    font-weight: 700;
    color: var(--accent);
  }

  .bar {
    height: 10px;
    background: var(--accent-tint-50);
    border-radius: 0;
  }
  .bar.best {
    background: var(--accent);
  }
  .bar.dim {
    background: color-mix(in srgb, var(--text-primary) 20%, transparent);
  }

  .as-rule {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
    max-width: 92ch;
    margin: 16px 0 0;
  }

  .as-note {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 84ch;
    text-wrap: pretty;
    margin: 20px 0 0;
  }
</style>
