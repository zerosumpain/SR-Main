<script lang="ts">
  // G — ROUTES & PLAN. What to actually go and do.
  //
  // The proposal card is the planner's real output: sport, distance and
  // intensity from `applyProgression`, and the rationale lines it wrote for
  // itself. Nothing here is re-derived — a second opinion computed in a
  // component is how a page ends up disagreeing with its own coach.
  //
  // The four route cards below are EDITORIAL, and the note under them says so.
  // They name real trail corridors near Darlington rather than planner output,
  // because a scored route needs live device location and belongs at
  // /health/plan; what belongs here is the argument for each kind of day.
  import type { DailyPlan } from '$lib/trails/coach-service';
  import SectionHead from './SectionHead.svelte';
  import { fixed, whole } from './format';

  interface Props {
    coach: DailyPlan | null;
  }

  let { coach }: Props = $props();

  const session = $derived(coach?.session ?? null);
  const evidence = $derived(coach?.evidence ?? null);

  const headline = $derived(
    session
      ? `${session.sportLabel} · ${(session.targetDistanceM / 1000).toFixed(1)} km`
      : 'No proposal today',
  );

  /** The four figures the proposal was actually reasoned from. */
  interface Cell {
    label: string;
    value: string;
    unit: string;
  }

  const cells = $derived.by((): Cell[] => {
    if (!evidence) return [];
    return [
      {
        label: 'Readiness',
        value: evidence.readiness != null ? whole(evidence.readiness) : '—',
        unit: evidence.readinessLabel ? evidence.readinessLabel.toLowerCase() : '',
      },
      {
        label: 'ACWR read',
        value: evidence.acwr != null ? fixed(evidence.acwr, 2) : '—',
        unit: evidence.acwrZone ?? '',
      },
      {
        label: 'Week hours',
        value: evidence.weekHours != null ? fixed(evidence.weekHours, 1) : '—',
        unit:
          evidence.typicalWeekHours != null
            ? `vs ${evidence.typicalWeekHours.toFixed(1)} typical`
            : '',
      },
      {
        label: 'Days since hard',
        value: evidence.daysSinceHard != null ? String(evidence.daysSinceHard) : '—',
        unit: evidence.daysSinceHard != null ? 'threshold or above' : 'none on record',
      },
    ];
  });

  /** Fixed editorial copy — four kinds of day, not four planner results. */
  const ROUTES = [
    {
      goal: 'Goal · volume',
      band: 'Moderate',
      severe: false,
      name: 'Tees riverside, out and back',
      figures: '14 km · ~60 m climb · 14.6 equiv-km',
      body: 'The Teesdale Way corridor from the town edge. Flat, surfaced, weather-proof, and repeatable on a weekday evening — which is the only property that matters for the one move that has to happen 12 times.',
      moves: 'Moves: ACWR · weekly volume',
    },
    {
      goal: 'Goal · vert',
      band: 'Hard',
      severe: false,
      name: 'North York Moors escarpment',
      figures: '18 km · ~700 m climb · 25 equiv-km',
      body: 'Cleveland Way ground, roughly 40 minutes out. The nearest terrain that rehearses 3 Peaks physiology — sustained climbing at hike heart rate, which is what 193 m/h of VAM was built on.',
      moves: 'Moves: VO₂max slope · big-day prep',
    },
    {
      goal: 'Goal · pace',
      band: 'Easy',
      severe: false,
      name: 'Your own segment loop',
      figures: '6–8 km · minimal climb · 7 equiv-km',
      body: 'Not a new route: the loop that already carries the most-repeated segments, run with one hard effort inside it. Repeated ground is the only ground where a time means anything, and this is where the hard-effort move gets measured.',
      moves: 'Moves: intensity mix · segment PBs',
    },
    {
      goal: 'Goal · the big day',
      band: 'Severe',
      severe: true,
      name: 'A named trail, one push',
      figures: '45–50 km · 1500 m+ · 60 equiv-km',
      body: 'Beyond the 3 Peaks round: a national or regional trail section from the discovery search, done in a day. This is the booked-objective move made concrete — and the reason the other three matter.',
      moves: 'Moves: everything · needs a date',
    },
  ];
</script>

<section class="g">
  <div class="g-inner">
    <SectionHead
      kicker="G / Routes &amp; plan · Darlington, 15 km discovery radius"
      title={['What to actually', 'go and do']}
      strap="Each proposal states its training purpose, its Naismith difficulty band, and which instrument it moves. Distances come from the planner's own logic: recent median, adjusted by ACWR and readiness."
    />

    <div class="g-proposal">
      <div>
        <p class="g-proposal-label">Today's proposal · unprompted</p>
        <div class="g-proposal-head">
          <h3 class="g-proposal-title">{headline}</h3>
          {#if session}
            <span class="g-chip">{session.intensityLabel}</span>
          {/if}
        </div>
        {#if session?.why.length}
          <div class="g-why">
            {#each session.why as line, i (i)}
              <p class="g-why-line">{line}</p>
            {/each}
          </div>
        {:else}
          <p class="g-why-line">
            {coach?.routeNote ??
              'The coach has not run today. Everything below still stands on its own.'}
          </p>
        {/if}
        {#if coach?.degraded.length}
          <p class="g-degraded">Degraded: {coach.degraded.join(' · ')}</p>
        {/if}
      </div>

      <div class="g-ranker">
        <p class="g-ranker-label">What the ranker throws out</p>
        <p class="g-ranker-text">
          The router will happily return a “10 km loop” that spends 800 m running down a lane and
          back. Seeds get generated on different bearings, then scored on retracing, spurs and
          surface fit — the ranking is the product, not the route.
        </p>
        {#if cells.length}
          <div class="g-cells">
            {#each cells as cell (cell.label)}
              <div>
                <p class="g-cell-label">{cell.label}</p>
                <p class="g-cell-value">{cell.value}</p>
                {#if cell.unit}<p class="g-cell-unit">{cell.unit}</p>{/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if coach?.route}
          <p class="g-route-note">
            Routed: {(coach.route.distanceM / 1000).toFixed(1)} km{#if coach.route.ascentM != null}, {whole(
                coach.route.ascentM,
              )} m ascent{/if} · {coach.route.difficulty}
          </p>
        {:else if coach?.routeNote}
          <p class="g-route-note">{coach.routeNote}</p>
        {/if}
      </div>
    </div>

    <div class="g-routes">
      {#each ROUTES as route (route.name)}
        <div class="g-route">
          <div class="g-route-head">
            <p class="g-route-goal">{route.goal}</p>
            <span class="g-band" class:severe={route.severe}>{route.band}</span>
          </div>
          <h3 class="g-route-name">{route.name}</h3>
          <p class="g-route-figures">{route.figures}</p>
          <p class="g-route-body">{route.body}</p>
          <div class="g-route-foot">
            <p class="g-route-moves">{route.moves}</p>
          </div>
        </div>
      {/each}
    </div>

    <p class="g-note">
      Route names above are real trail corridors near Darlington, not planner output. Run them
      through /health/plan with live device location for scored geometry, elevation and GPX.
    </p>
  </div>
</section>

<style>
  .g {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .g-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .g-proposal {
    border: 2px solid rgba(26, 16, 8, 0.2);
    background: var(--bg);
    padding: clamp(22px, 2.6vw, 32px);
    margin-bottom: clamp(20px, 2.5vw, 32px);
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: clamp(24px, 3vw, 44px);
    align-items: start;
  }
  .g-proposal-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 14px;
  }
  .g-proposal-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .g-proposal-title {
    font-family: var(--font-display);
    font-size: clamp(26px, 3vw, 38px);
    line-height: 0.95;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0;
  }
  .g-chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    background: var(--accent);
    color: var(--bg);
    padding: 5px 11px;
  }

  .g-why {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .g-why-line {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: rgba(26, 16, 8, 0.75);
    border-left: 3px solid rgba(196, 87, 10, 0.5);
    padding-left: 14px;
    margin: 0;
    text-wrap: pretty;
  }
  .g-degraded {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 14px 0 0;
  }

  .g-ranker {
    border-left: 1px solid rgba(26, 16, 8, 0.14);
    padding-left: clamp(20px, 2.5vw, 32px);
    min-width: 0;
  }
  .g-ranker-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 14px;
  }
  .g-ranker-text {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: rgba(26, 16, 8, 0.75);
    margin: 0 0 16px;
    text-wrap: pretty;
  }
  .g-cells {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }
  .g-cell-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 6px;
  }
  .g-cell-value {
    font-family: var(--font-display);
    font-size: 24px;
    line-height: 1;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .g-cell-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 5px 0 0;
  }
  .g-route-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 16px 0 0;
  }

  .g-routes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 16px;
  }
  .g-route {
    background: var(--bg);
    border: 1px solid var(--card-border);
    padding: 24px;
    min-width: 0;
  }
  .g-route-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .g-route-goal {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }
  .g-band {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid rgba(26, 16, 8, 0.25);
    padding: 3px 8px;
    white-space: nowrap;
  }
  .g-band.severe {
    border-color: rgba(196, 87, 10, 0.5);
    color: var(--accent);
  }
  .g-route-name {
    font-family: var(--font-display);
    font-size: 19px;
    line-height: 1.1;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0 0 6px;
  }
  .g-route-figures {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 14px;
  }
  .g-route-body {
    font-size: var(--fs-nav);
    line-height: 1.5;
    color: rgba(26, 16, 8, 0.75);
    margin: 0 0 16px;
    text-wrap: pretty;
  }
  .g-route-foot {
    border-top: 1px solid rgba(26, 16, 8, 0.14);
    padding-top: 12px;
  }
  .g-route-moves {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0;
  }

  .g-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 24px 0 0;
  }

  @media (max-width: 860px) {
    .g-proposal {
      grid-template-columns: minmax(0, 1fr);
    }
    .g-ranker {
      border-left: none;
      border-top: 1px solid rgba(26, 16, 8, 0.14);
      padding-left: 0;
      padding-top: 20px;
    }
  }
</style>
