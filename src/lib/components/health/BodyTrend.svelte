<script lang="ts">
  // The public half of "which way is it going".
  //
  // The signed-in chapter draws ninety days of workout physiology out of the
  // physio suite; an anonymous visitor gets the same charts, in the same shape,
  // over the thirty days of body readings the page already sends them. No extra
  // query, nothing new disclosed — the pulse grid above is the same numbers in
  // a different form, and this is the one that shows direction.
  import DateLineChart from '$lib/components/trails/DateLineChart.svelte';
  import { rollingMean, type DayPoint } from '$lib/health/analytics/rolling';
  import type { HealthDay } from '$lib/health/series-30d-service';

  let { series }: { series: HealthDay[] } = $props();

  // 0 is the missing sentinel everywhere in HealthDay — there are no nulls in
  // it — so a zero day is dropped rather than plotted as a collapse to the axis.
  function pick(read: (d: HealthDay) => number): DayPoint[] {
    return series
      .map((d) => ({ date: d.date, value: read(d) }))
      .filter((p) => p.value > 0);
  }

  interface Line {
    key: string;
    points: DayPoint[];
    label: string;
    unitSuffix: string;
    colour: string;
    dp: number;
  }

  const lines = $derived.by((): Line[] => {
    const candidates: Line[] = [
      {
        key: 'rec',
        points: pick((d) => d.rec),
        label: 'Recovery — higher is better',
        unitSuffix: '%',
        colour: 'var(--accent)',
        dp: 0,
      },
      {
        key: 'rhr',
        points: pick((d) => d.rhr),
        label: 'Resting heart rate — lower is better',
        unitSuffix: ' bpm',
        colour: 'var(--accent-ink)',
        dp: 0,
      },
      {
        key: 'hrv',
        points: pick((d) => d.hrv),
        label: 'HRV — higher is better',
        unitSuffix: ' ms',
        colour: 'var(--accent)',
        dp: 0,
      },
      {
        key: 'slept',
        points: pick((d) => d.slept),
        label: 'Sleep — hours a night',
        unitSuffix: ' h',
        colour: 'var(--accent-ink)',
        dp: 1,
      },
    ];
    // Two points is not a trend. A chart with one dot on it is worse than the
    // absence of the chart, because it implies a series.
    return candidates.filter((l) => l.points.length > 2);
  });

  // DateLineChart reads `rolling` by LENGTH, not truthiness, so an empty array
  // is the honest "no rolling line" and not an accidental one.
  const rollingFor = $derived((points: DayPoint[]) => rollingMean(points, 7, 3));
</script>

{#if lines.length > 0}
  <div class="chart-grid">
    {#each lines as line (line.key)}
      <DateLineChart
        points={line.points}
        rolling={rollingFor(line.points)}
        label={line.label}
        unitSuffix={line.unitSuffix}
        dp={line.dp}
        colour={line.colour}
      />
    {/each}
  </div>
  <p class="note">
    Thirty days of daily readings with a seven-day line over them. One night proves nothing; the
    line is the thing to read.
  </p>
{/if}

<style>
  .chart-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
    gap: 1.5rem 1.75rem;
  }
  @media (max-width: 720px) {
    .chart-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .note {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 1.25rem 0 0 0;
    max-width: 68ch;
  }
</style>
