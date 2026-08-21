<script lang="ts">
  // Today's three rings, and where they came from.
  //
  // Kept when the Breakdown card wall was dropped from the hub, because this is
  // the one figure it carried that nothing else on the page does — and because
  // it is genuinely today, which is the chapter it now sits in.
  //
  // The provenance line is not decoration. Apple's own `active_energy`,
  // `apple_exercise_time` and `apple_stand_hour` are not being ingested, so
  // these are DERIVED: Move from Whoop's daily kilojoules, Exercise from the sum
  // of zone-2-and-up workout minutes, Stand from the count of distinct hours
  // with any heart-rate reading. Presenting a derived number as a measured one
  // is how a dashboard stops being trustworthy.
  import type { ActivityRings } from '$lib/health/series-30d-service';

  let { rings }: { rings: ActivityRings } = $props();

  const pct = (v: number, target: number) => Math.min(1, v / Math.max(1, target));

  const movePct = $derived(pct(rings.moveKcal, rings.moveTarget));
  const exercisePct = $derived(pct(rings.exerciseMin, rings.exerciseTarget));
  const standPct = $derived(pct(rings.standHours, rings.standTarget));

  const R = [42, 32, 22];
  const circumference = (r: number) => 2 * Math.PI * r;

  const arcs = $derived([
    { r: R[0], p: movePct, colour: 'var(--accent)' },
    { r: R[1], p: exercisePct, colour: 'var(--trend-down)' },
    { r: R[2], p: standPct, colour: 'var(--accent-ink)' },
  ]);

  const rows = $derived([
    { label: 'Move', value: `${Math.round(rings.moveKcal)}`, of: `${rings.moveTarget} kcal`, colour: 'var(--accent)' },
    {
      label: 'Exercise',
      value: `${Math.round(rings.exerciseMin)}`,
      of: `${rings.exerciseTarget} min`,
      colour: 'var(--trend-down)',
    },
    {
      label: 'Stand',
      value: `${Math.round(rings.standHours)}`,
      of: `${rings.standTarget} hrs`,
      colour: 'var(--accent-ink)',
    },
  ]);
</script>

<div class="rings">
  <svg class="dial" viewBox="0 0 100 100" role="img" aria-label="Today's move, exercise and stand rings">
    {#each arcs as arc, i (i)}
      <circle
        cx="50"
        cy="50"
        r={arc.r}
        fill="none"
        stroke="var(--line)"
        stroke-width="7"
      />
      <circle
        cx="50"
        cy="50"
        r={arc.r}
        fill="none"
        stroke={arc.colour}
        stroke-width="7"
        stroke-linecap="butt"
        stroke-dasharray="{circumference(arc.r) * arc.p} {circumference(arc.r)}"
        transform="rotate(-90 50 50)"
      />
    {/each}
  </svg>

  <dl class="legend">
    {#each rows as row (row.label)}
      <div>
        <dt><span class="swatch" style="background: {row.colour}" aria-hidden="true"></span>{row.label}</dt>
        <dd>{row.value}<span class="of"> / {row.of}</span></dd>
      </div>
    {/each}
  </dl>

  <p class="provenance">
    Apple is not sending its own ring data, so these are derived — Move from Whoop's daily
    kilojoules, Exercise from zone-2-and-up workout minutes, Stand from the hours with a heart-rate
    reading in them. Close to Apple's, not the same as Apple's.
  </p>
</div>

<style>
  .rings {
    display: grid;
    grid-template-columns: 132px minmax(0, auto) minmax(0, 1fr);
    align-items: center;
    gap: 24px;
    padding: 20px 0 0 0;
  }
  @media (max-width: 900px) {
    .rings {
      grid-template-columns: 100px minmax(0, 1fr);
    }
    .provenance {
      grid-column: 1 / -1;
    }
  }

  .dial {
    width: 132px;
    height: 132px;
  }
  @media (max-width: 900px) {
    .dial {
      width: 100px;
      height: 100px;
    }
  }

  .legend {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .legend div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .legend dt {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .legend dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    line-height: 1;
    color: var(--text-primary);
  }
  .of {
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  .swatch {
    width: 9px;
    height: 9px;
    display: inline-block;
  }

  .provenance {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-muted);
    margin: 0;
    max-width: 46ch;
  }
</style>
