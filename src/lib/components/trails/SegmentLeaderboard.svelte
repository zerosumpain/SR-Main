<script lang="ts">
  // Every effort on one segment, ranked. Sorting is the whole point of the
  // table, so the header cells are buttons and the current key is obvious.
  import type { SegmentEffortRow } from '$lib/trails/segments-service';
  import { rankEfforts, type RankKey } from '$lib/trails/segments/metrics';
  import {
    formatDistance,
    formatDuration,
    formatPace,
    formatSpeed,
    formatLocalDate,
  } from '$lib/trails/format';

  let {
    efforts,
    paceSport = true,
  }: { efforts: SegmentEffortRow[]; paceSport?: boolean } = $props();

  interface Column {
    key: RankKey;
    label: string;
    /** Reads the sortable number. Null means this effort cannot be ranked. */
    read: (e: SegmentEffortRow) => number | null;
    show: (e: SegmentEffortRow) => string;
    hint: string;
  }

  const columns: Column[] = [
    {
      key: 'durationS',
      label: 'Time',
      read: (e) => e.durationS,
      show: (e) => formatDuration(e.durationS),
      hint: 'Elapsed time on the segment, including anything you stopped for',
    },
    {
      key: 'speedMps',
      label: paceSport ? 'Pace' : 'Speed',
      read: (e) => e.speedMps,
      show: (e) => (paceSport ? formatPace(e.paceSPerKm) : formatSpeed(e.paceSPerKm)),
      hint: 'Over the distance this effort actually covered',
    },
    {
      key: 'avgHeartrate',
      label: 'Avg HR',
      read: (e) => e.avgHeartrate,
      show: (e) => (e.avgHeartrate == null ? '—' : `${Math.round(e.avgHeartrate)}`),
      hint: 'Time-weighted over the segment. Blank when the series does not cover it',
    },
    {
      key: 'efficiencyFactor',
      label: 'Effic.',
      read: (e) => e.efficiencyFactor,
      show: (e) => e.efficiencyFactor?.toFixed(2) ?? '—',
      hint: 'Metres per minute per beat — ground covered per heartbeat. Higher is better',
    },
    {
      key: 'beatsPerKm',
      label: 'Cost',
      read: (e) => e.beatsPerKm,
      show: (e) => (e.beatsPerKm == null ? '—' : Math.round(e.beatsPerKm).toLocaleString()),
      hint: 'Heartbeats spent per kilometre. Lower is better',
    },
  ];

  // Efficiency leads: it is the one that answers "am I getting fitter" rather
  // than "was I trying harder today".
  let sortKey = $state<RankKey>('efficiencyFactor');

  const ranks = $derived.by(() => {
    const map = new Map<RankKey, Map<SegmentEffortRow, number>>();
    for (const column of columns) map.set(column.key, rankEfforts(efforts, column.key, column.read));
    return map;
  });

  const sorted = $derived.by(() => {
    const byKey = ranks.get(sortKey);
    if (!byKey) return efforts;
    // Unrankable efforts keep their place at the bottom rather than vanishing:
    // a walk with no heart-rate data still happened.
    return [...efforts].sort((a, b) => {
      const ra = byKey.get(a);
      const rb = byKey.get(b);
      if (ra == null && rb == null) return b.startedAt - a.startedAt;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb || b.startedAt - a.startedAt;
    });
  });

  const anyHeartrate = $derived(efforts.some((e) => e.avgHeartrate != null));
</script>

<div class="scroller">
  <table class="board">
    <thead>
      <tr>
        <th scope="col" class="pos">#</th>
        <th scope="col">Date</th>
        {#each columns as column (column.key)}
          <th scope="col" class="num" class:active={sortKey === column.key}>
            <button type="button" title={column.hint} onclick={() => (sortKey = column.key)}>
              {column.label}
            </button>
          </th>
        {/each}
        <th scope="col" class="num">Dist</th>
      </tr>
    </thead>
    <tbody>
      {#each sorted as effort, i (effort.id)}
        <tr>
          <td class="pos">{i + 1}</td>
          <th scope="row" class="when">
            <a href="/health/activities/{encodeURIComponent(effort.activityId)}">
              {formatLocalDate(effort.startDateLocal, effort.startedAt)}
            </a>
            {#if effort.lapIndex > 1}<span class="lap">lap {effort.lapIndex}</span>{/if}
          </th>
          {#each columns as column (column.key)}
            {@const rank = ranks.get(column.key)?.get(effort)}
            <td class="num" class:active={sortKey === column.key} class:best={rank === 1}>
              {column.show(effort)}
            </td>
          {/each}
          <td class="num dist">{formatDistance(effort.distanceM)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<p class="footnote">
  Efficiency is metres per minute per beat, the same measure the activity pages use; cost is its
  mirror — heartbeats spent per kilometre. Those two are the ones that answer whether you are
  getting fitter: the lowest average heart rate is marked like the rest, but on its own it usually
  just means you took it gently.
  {#if !anyHeartrate}
    None of these efforts carries heart-rate data, so all three heart-rate columns are blank
    throughout.
  {/if}
</p>

<style>
  /* Wide content scrolls inside its own box; the page never scrolls sideways. */
  .scroller {
    overflow-x: auto;
  }

  .board {
    width: 100%;
    min-width: 40rem;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }

  th,
  td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
    white-space: nowrap;
  }

  thead th {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    font-weight: 500;
    border-bottom: 1px solid var(--line-strong);
  }

  thead th button {
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: inherit;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  thead th button:hover {
    color: var(--text-primary);
  }

  thead th.active {
    color: var(--accent);
  }

  .num {
    text-align: right;
  }

  .pos {
    width: 2.5rem;
    color: var(--text-muted);
    text-align: right;
  }

  .when a {
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--line-hair);
  }

  .when a:hover {
    border-bottom-color: var(--accent);
  }

  .lap {
    margin-left: 0.4rem;
    font-size: var(--fs-label-xs);
    color: var(--accent);
  }

  td.active {
    color: var(--text-primary);
  }

  td.best {
    font-weight: 700;
    color: var(--accent);
  }

  .dist {
    color: var(--text-muted);
  }

  .footnote {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 70ch;
  }
</style>
