<script lang="ts">
  // Today's brief: the session, the reasoning behind it, the records that are
  // realistically beatable, and — when there is a key and the ground allows —
  // the route through them.
  //
  // The type comes from coach-service as a TYPE ONLY, so none of that module's
  // database or openrouteservice code follows it into the client bundle.
  //
  // Shared .h-detail-grid / .h-card / .cellgrid primitives come from app.css;
  // only the bespoke pieces are in this file's style block.
  import type { DailyPlan } from '$lib/trails/coach-service';
  import { formatDistance, formatDuration } from '$lib/trails/format';

  let { plan }: { plan: DailyPlan } = $props();

  const session = $derived(plan.session);
  const hasWhy = $derived((session.why?.length ?? 0) > 0);
  const hasTargets = $derived((plan.targets?.length ?? 0) > 0);
  const hasNotes = $derived((plan.route?.notes?.length ?? 0) > 0);

  // Intensity → the card's tag tone. Recovery is the one the body asked for, so
  // it reads as a warning rather than as a win.
  const TONE: Record<DailyPlan['session']['intensity'], 'good' | 'warn' | 'bad' | 'flat'> = {
    recovery: 'warn',
    easy: 'flat',
    steady: 'good',
    threshold: 'good',
    intervals: 'bad',
  };

  // Difficulty band → the word the rest of the site uses. Mapped here rather
  // than imported so the card pulls in no module beyond the formatters.
  const DIFFICULTY: Record<string, string> = {
    easy: 'Easy',
    moderate: 'Moderate',
    hard: 'Hard',
    severe: 'Severe',
  };

  function gapLabel(gapS: number | null, gapPct: number | null): string {
    if (gapS == null || gapPct == null) return 'No recent effort';
    if (gapS <= 0) return 'Level with it';
    // Under a minute reads as seconds; "0:15 behind" is a worse sentence.
    const behind = gapS < 60 ? `${Math.round(gapS)}s` : formatDuration(gapS);
    return `+${behind} (${(gapPct * 100).toFixed(1)}%)`;
  }
</script>

<div class="coach">
  <div class="h-detail-grid">
    <div class="h-card span-6">
      <div class="h-card-head">
        <div class="h-card-head-l">
          <p class="h-card-name">The session</p>
        </div>
        <span class="h-card-tag {TONE[session.intensity]}">{session.intensityLabel}</span>
      </div>

      <p class="coach-headline">{session.sportLabel}</p>

      <div class="coach-figures cellgrid">
        <div>
          <p class="coach-fig-l">Target distance</p>
          <p class="coach-fig-v">{formatDistance(session.targetDistanceM)}</p>
        </div>
        <div>
          <p class="coach-fig-l">Rough time</p>
          <p class="coach-fig-v">{session.targetMinutes} min</p>
        </div>
      </div>
    </div>

    <div class="h-card span-6">
      <div class="h-card-head">
        <div class="h-card-head-l">
          <p class="h-card-name">Why this one</p>
        </div>
      </div>

      {#if hasWhy}
        <ul class="coach-why">
          {#each session.why as line, i (i)}
            <li>{line}</li>
          {/each}
        </ul>
      {:else}
        <p class="coach-why-empty">
          Nothing in the recent load argues for anything in particular — this is simply what you
          have been doing, at the distance you usually do it.
        </p>
      {/if}

      <p class="coach-source">Load read from: {session.acwrSource}</p>
    </div>
  </div>

  {#if hasTargets}
    <div class="coach-block">
      <p class="coach-block-name">Records worth going after</p>
      <ol class="coach-targets">
        {#each plan.targets as target (target.id)}
          <li class="coach-target">
            <div class="coach-target-head">
              <a class="coach-target-name" href="/health/segments/{target.id}">{target.name}</a>
              <span class="coach-target-dist">{formatDistance(target.distanceM)}</span>
            </div>

            <div class="coach-target-times cellgrid">
              <div>
                <p class="coach-fig-l">Your best</p>
                <p class="coach-fig-v">{formatDuration(target.pbDurationS)}</p>
              </div>
              <div>
                <p class="coach-fig-l">Go for</p>
                <p class="coach-fig-v accent">{formatDuration(target.targetDurationS)}</p>
              </div>
              <div>
                <p class="coach-fig-l">Currently</p>
                <p class="coach-fig-v">{gapLabel(target.gapS, target.gapPct)}</p>
              </div>
            </div>

            <p class="coach-target-reason">{target.reason}</p>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  {#if plan.route}
    <div class="coach-block">
      <p class="coach-block-name">A route through them</p>
      <div class="coach-route cellgrid">
        <div>
          <p class="coach-fig-l">Distance</p>
          <p class="coach-fig-v">{formatDistance(plan.route.distanceM)}</p>
        </div>
        <div>
          <p class="coach-fig-l">Climb</p>
          <p class="coach-fig-v">
            {plan.route.ascentM == null ? 'Unknown' : `${plan.route.ascentM} m`}
          </p>
        </div>
        <div>
          <p class="coach-fig-l">Estimated</p>
          <p class="coach-fig-v">{formatDuration(plan.route.estimatedTimeS)}</p>
        </div>
        <div>
          <p class="coach-fig-l">Grade</p>
          <p class="coach-fig-v">{DIFFICULTY[plan.route.difficulty] ?? plan.route.difficulty}</p>
        </div>
      </div>

      <p class="coach-route-through">
        Takes in {plan.route.through.join(', then ')}.
      </p>

      {#if hasNotes}
        <p class="coach-route-notes">{plan.route.notes.join(' · ')}</p>
      {/if}

      <a class="coach-link" href="/health/plan">Open it in the planner</a>
    </div>
  {:else if plan.routeNote}
    <p class="coach-note">{plan.routeNote}</p>
  {/if}
</div>

<style>
  .coach {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* The sport, as the headline. Clamped rather than fixed at the card scale —
     "Trail run" at 3.5rem overflows a half-width card on a phone. */
  .coach-headline {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(2rem, 7vw, 3.25rem);
    line-height: 0.95;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0;
  }

  .coach-figures {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-top: auto;
  }
  .coach-fig-l {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 4px;
  }
  .coach-fig-v {
    font-family: var(--font-mono);
    font-size: var(--fs-body-sm);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    margin: 0;
  }
  .coach-fig-v.accent {
    color: var(--accent);
  }

  .coach-why {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .coach-why li {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
    padding-left: 14px;
    border-left: 2px solid var(--accent-tint-35);
  }
  .coach-why-empty {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 0;
  }
  .coach-source {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin: auto 0 0;
  }

  /* Blocks below the two head cards, sharing the grid's outer rule. */
  .coach-block {
    border: 1px solid var(--line-strong);
    border-top: 0;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .coach-block-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }

  .coach-targets {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .coach-target {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .coach-target + .coach-target {
    border-top: 1px solid var(--line-hair);
    padding-top: 16px;
  }
  .coach-target-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }
  .coach-target-name {
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    font-weight: 600;
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-35);
    min-width: 0;
  }
  .coach-target-name:hover {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .coach-target-dist {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    white-space: nowrap;
  }
  .coach-target-times {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .coach-target-reason {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 0;
  }

  .coach-route {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .coach-route-through,
  .coach-route-notes,
  .coach-note {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.45;
    color: var(--text-secondary);
    margin: 0;
  }
  .coach-route-notes {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.04em;
    color: var(--text-ghost);
  }

  /* No route drawn. One calm line, in the same frame as everything else — an
     absent route is a stated outcome here, not a failure to hide. */
  .coach-note {
    border: 1px solid var(--line-strong);
    border-top: 0;
    background: var(--surface-sunken);
    padding: 16px 18px;
    color: var(--text-muted);
  }

  .coach-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-tint-35);
    align-self: flex-start;
  }
  .coach-link:hover {
    border-bottom-color: var(--accent);
  }

  @media (max-width: 700px) {
    .coach-target-times,
    .coach-route {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
