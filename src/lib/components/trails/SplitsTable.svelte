<script lang="ts">
  import type { Split } from '$lib/trails/track';
  import { formatDuration, formatPace, formatElevation } from '$lib/trails/format';

  let { splits, paceSport = true }: { splits: Split[]; paceSport?: boolean } = $props();

  // The bar is scaled against the slowest split, not against zero, so the
  // difference between a 4:45 and a 5:05 km is visible. Faster reads longer.
  const slowest = $derived(splits.length ? Math.max(...splits.map((s) => s.paceSPerKm)) : 1);
  const fastest = $derived(splits.length ? Math.min(...splits.map((s) => s.paceSPerKm)) : 1);

  function barWidth(pace: number): number {
    if (slowest === fastest) return 100;
    // Invert: a faster (smaller) pace gets a longer bar.
    return 25 + ((slowest - pace) / (slowest - fastest)) * 75;
  }

  const fullSplits = $derived(splits.filter((s) => s.distanceM >= 995));
</script>

{#if splits.length}
  <table class="splits">
    <colgroup>
      <col style="width: 3.5rem" />
      <col />
      <col style="width: 6rem" />
      <col style="width: 5rem" />
    </colgroup>
    <thead>
      <tr>
        <th scope="col">Km</th>
        <th scope="col">{paceSport ? 'Pace' : 'Speed'}</th>
        <th scope="col" class="num">Time</th>
        <th scope="col" class="num">Climb</th>
      </tr>
    </thead>
    <tbody>
      {#each splits as split (split.index)}
        {@const partial = split.distanceM < 995}
        <tr>
          <th scope="row" class="idx">
            {split.index}{#if partial}<span class="partial-mark" title="Partial split">*</span>{/if}
          </th>
          <td class="pace-cell">
            <span class="bar" style:width="{barWidth(split.paceSPerKm)}%"></span>
            <span class="pace-value">
              {paceSport
                ? formatPace(split.paceSPerKm)
                : `${(3600 / split.paceSPerKm).toFixed(1)} km/h`}
            </span>
          </td>
          <td class="num">{formatDuration(split.durationS)}</td>
          <td class="num">{formatElevation(split.elevationGainM)}</td>
        </tr>
      {/each}
    </tbody>
  </table>

  {#if splits.length > fullSplits.length}
    <p class="footnote">
      * Final split covers {(splits[splits.length - 1].distanceM / 1000).toFixed(2)} km, not a full
      kilometre.
    </p>
  {/if}
{:else}
  <p class="footnote">No splits — this activity has no GPS trace.</p>
{/if}

<style>
  .splits {
    width: 100%;
    table-layout: fixed;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }

  th,
  td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
  }

  thead th {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    font-weight: 500;
    border-bottom: 1px solid var(--line-strong);
  }

  .num {
    text-align: right;
  }

  .idx {
    color: var(--text-muted);
    font-weight: 500;
  }

  .partial-mark {
    color: var(--accent);
  }

  /* The bar sits behind the number rather than beside it, so the column reads
     as a value with weight, not as a chart competing with a table. */
  .pace-cell {
    position: relative;
    isolation: isolate;
  }

  .bar {
    position: absolute;
    left: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    height: 1.15rem;
    background: var(--accent);
    opacity: 0.16;
    z-index: -1;
  }

  .pace-value {
    color: var(--text-primary);
  }

  .footnote {
    margin: 0.5rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
</style>
