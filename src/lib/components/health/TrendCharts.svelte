<script lang="ts">
  // The progression charts, lifted out of the old GroundDashboard so the page
  // can put them where the argument needs them rather than inside a second
  // dashboard nested in the first.
  //
  // Every line is the same shape — daily readings, a 7-day line over them, a
  // dashed 28-day baseline — so the reader learns to read one and gets the rest
  // free. Colour is not carrying meaning here: the two accents alternate so
  // adjacent charts are told apart, which is why the caption says which
  // direction is the good one for each.
  import DateLineChart from '$lib/components/trails/DateLineChart.svelte';
  import { isPaceSport } from '$lib/trails/format';
  import type { TrailsDashboard } from '$lib/trails/physio-service';

  let { dashboard }: { dashboard: TrailsDashboard | null } = $props();

  const d = $derived(dashboard);

  // Pace sports only. A ride's efficiency factor sits near 4 against a run's 1,
  // so one mixed series is a chart of which days were bike days.
  const efPoints = $derived(
    (d?.workouts ?? [])
      .filter((w) => w.ef != null && isPaceSport(w.activityType))
      .map((w) => ({ date: w.day, value: w.ef as number })),
  );
  const bkmPoints = $derived(
    (d?.workouts ?? [])
      .filter((w) => w.beatsPerKm != null && isPaceSport(w.activityType))
      .map((w) => ({ date: w.day, value: w.beatsPerKm as number })),
  );
  const hrrPoints = $derived(
    (d?.workouts ?? [])
      .filter((w) => w.hrr60 != null)
      .map((w) => ({ date: w.day, value: w.hrr60 as number })),
  );

  // An empty array is TRUTHY, so every one of these asks for a length.
  const hasVo2 = $derived((d?.vo2.series?.length ?? 0) > 1);
  const hasEf = $derived(efPoints.length > 1);
  const hasBkm = $derived(bkmPoints.length > 1);
  const hasHrr = $derived(hrrPoints.length > 1);
  const hasSdnn = $derived((d?.hrvSdnn?.daily.length ?? 0) >= 2);
</script>

{#if d}
  <div class="chart-grid">
    {#if hasVo2}
      <DateLineChart
        points={d.vo2.series}
        label="Cardio fitness — VO₂max, higher is better"
        unitSuffix=" ml/kg/min"
        dp={1}
        colour="var(--accent)"
      />
    {/if}
    {#if d.rhr}
      <DateLineChart
        points={d.rhr.daily}
        rolling={d.rhr.rolling7}
        baseline={d.rhr.baseline28}
        label="Resting heart rate — lower is better"
        unitSuffix=" bpm"
        colour="var(--accent-ink)"
      />
    {/if}
    {#if d.hrv}
      <DateLineChart
        points={d.hrv.daily}
        rolling={d.hrv.rolling7}
        baseline={d.hrv.baseline28}
        label="HRV — Whoop RMSSD, higher is better"
        unitSuffix=" ms"
        colour="var(--accent)"
      />
    {/if}
    {#if hasEf}
      <DateLineChart
        points={efPoints}
        label="Efficiency — metres per minute per beat, higher is better"
        unitSuffix=" m/min/bpm"
        dp={2}
        colour="var(--accent-ink)"
      />
    {/if}
    {#if hasBkm}
      <DateLineChart
        points={bkmPoints}
        label="Cost — heartbeats per kilometre, lower is better"
        unitSuffix=" b/km"
        colour="var(--accent)"
      />
    {/if}
    {#if hasHrr}
      <DateLineChart
        points={hrrPoints}
        label="HRR60 — how far the pulse falls in the minute after, higher is better"
        unitSuffix=" bpm"
        colour="var(--accent-ink)"
        zeroBaseline
      />
    {/if}
    {#if hasSdnn && d.hrvSdnn}
      <DateLineChart
        points={d.hrvSdnn.daily}
        rolling={d.hrvSdnn.rolling7}
        baseline={d.hrvSdnn.baseline28}
        label="HRV — Apple SDNN, a different measure and not comparable with the above"
        unitSuffix=" ms"
        colour="var(--text-secondary)"
      />
    {/if}
  </div>

  <p class="note">
    Efficiency and cost are one measure read in both directions — metres covered per heartbeat, and
    heartbeats spent per kilometre — so they should mirror each other. When they and the resting
    heart rate and HRV all point the same way at once, that is aerobic fitness moving rather than a
    good night's sleep. Read the seven-day line, not the daily dots.
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
