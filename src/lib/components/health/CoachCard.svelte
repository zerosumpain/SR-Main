<script lang="ts">
  // Today's session, and the working shown.
  //
  // The first version was a wall of cards that took a screen and a half to say
  // "steady walk, 2 km", showed no evidence for it, and did that on a day the
  // body was at 94% recovery. Three things changed:
  //
  //   * it reads the readiness composite upward, not only as a veto, so a good
  //     day gets a bigger session (see applyProgression in coach.ts);
  //   * it SHOWS why — the readiness score, the load ratio, the week against a
  //     typical week, and the fortnight of daily load the session sits on top
  //     of, as the same bar chart the load chapter uses;
  //   * it is one stat row, one chart and a short list, in the same grammar as
  //     every other chapter, instead of its own card system.
  import Bars, { type Bar } from '$lib/components/trails/Bars.svelte';
  import StatRow, { type Stat } from '$lib/components/health/StatRow.svelte';
  import { formatDistance, formatDuration } from '$lib/trails/format';
  import type { DailyPlan } from '$lib/trails/coach-service';

  let { plan, onevidence }: { plan: DailyPlan; onevidence?: (id: string) => void } = $props();

  const session = $derived(plan.session);
  const ev = $derived(plan.evidence);
  const hasWhy = $derived((session.why?.length ?? 0) > 0);
  const hasTargets = $derived((plan.targets?.length ?? 0) > 0);

  const TONE: Record<DailyPlan['session']['intensity'], Stat['tone']> = {
    recovery: 'warn',
    easy: 'neutral',
    steady: 'good',
    threshold: 'good',
    intervals: 'bad',
  };

  const stats = $derived.by((): Stat[] => {
    const out: Stat[] = [
      {
        label: 'The session',
        value: session.sportLabel,
        sub: session.intensityLabel.toLowerCase(),
        tone: TONE[session.intensity],
      },
      {
        label: 'Target',
        value: formatDistance(session.targetDistanceM),
        sub: `about ${session.targetMinutes} min`,
      },
    ];

    if (ev.readiness != null) {
      out.push({
        label: 'Readiness',
        value: String(Math.round(ev.readiness)),
        unit: '/100',
        sub: ev.readinessLabel ?? '',
        tone: ev.readiness >= 70 ? 'good' : ev.readiness >= 50 ? 'neutral' : 'warn',
        evidence: 'readiness',
      });
    }

    if (ev.acwr != null) {
      out.push({
        label: 'Load ratio',
        value: ev.acwr.toFixed(2),
        unit: '×',
        sub: ev.acwrZone ?? '',
        tone: ev.acwr > 1.4 ? 'bad' : ev.acwr < 0.8 ? 'warn' : 'good',
        evidence: 'acwr',
      });
    }

    if (ev.weekHours != null) {
      const typical = ev.typicalWeekHours;
      out.push({
        label: 'This week',
        value: ev.weekHours.toFixed(1),
        unit: 'h',
        sub:
          typical != null && typical > 0
            ? `${Math.round(((ev.weekHours - typical) / typical) * 100)}% vs a typical week`
            : 'no typical week to compare with yet',
      });
    }

    if (ev.daysSinceHard != null) {
      out.push({
        label: 'Since a hard one',
        value: String(ev.daysSinceHard),
        unit: ev.daysSinceHard === 1 ? 'day' : 'days',
        sub: 'mean HR in zone 4+',
      });
    }

    return out;
  });

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDay(day: string): string {
    const dt = new Date(Date.parse(day + 'T00:00:00Z'));
    return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
  }

  const loadBars = $derived.by((): Bar[] =>
    (ev.recentLoad ?? []).map((d) => ({
      key: d.date,
      tick: shortDay(d.date),
      value: d.load,
      readout: d.load > 0 ? `${d.load} TRIMP` : 'rest day',
      readoutSub: shortDay(d.date),
    })),
  );
  const hasLoadBars = $derived(loadBars.length > 1);
</script>

<div class="coach">
  <StatRow {stats} {onevidence} />

  <div class="split">
    <div class="col">
      {#if hasWhy}
        <ul class="why">
          {#each session.why as line, i (i)}
            <li>{line}</li>
          {/each}
        </ul>
      {:else}
        <p class="h-note">
          Nothing in the recent load argues for anything in particular — this is what you have been
          doing, at the distance you usually do it.
        </p>
      {/if}
      <p class="source">Load read from {session.acwrSource}</p>
    </div>

    {#if hasLoadBars}
      <div class="col">
        <Bars
          bars={loadBars}
          label="The fortnight this sits on — daily load"
          formatY={(v) => String(Math.round(v))}
          height={120}
        />
      </div>
    {/if}
  </div>

  {#if hasTargets}
    <div class="targets">
      <span class="targets-hd">Ground worth taking it to</span>
      <ul class="target-list">
        {#each plan.targets as t (t.id)}
          <li>
            <a class="t-name" href="/health/segments/{t.id}">{t.name}</a>
            <span class="t-fig">PB {formatDuration(t.pbDurationS ?? 0)}</span>
            <span class="t-fig t-target">aim {formatDuration(t.targetDurationS ?? 0)}</span>
            <span class="t-why">{t.reason}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if plan.routeNote}
    <p class="h-note">{plan.routeNote}</p>
  {:else if plan.route}
    <p class="h-note">
      A route through them: {formatDistance(plan.route.distanceM)}, {Math.round(
        plan.route.ascentM ?? 0,
      )} m of climb, about {Math.round((plan.route.estimatedTimeS ?? 0) / 60)} min.
      <a href="/health/plan">Open it in the planner →</a>
    </p>
  {/if}
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    gap: 1.5rem 2rem;
    align-items: start;
  }
  @media (max-width: 900px) {
    .split {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .col {
    min-width: 0;
  }

  .why {
    margin: 0;
    padding: 0 0 0 1.1rem;
    list-style: none;
  }
  .why li {
    position: relative;
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }
  .why li::before {
    content: '';
    position: absolute;
    left: -1.1rem;
    top: 0.6em;
    width: 5px;
    height: 5px;
    background: var(--accent);
  }

  .source {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    margin: 0.75rem 0 0 0;
  }

  /* One line per target. The old treatment gave each one a card with four
     figures in it, which is a screenful to say "this one is close". */
  .targets {
    margin-top: 1.5rem;
    padding-top: 0.9rem;
    border-top: 1px solid var(--line-hair);
  }
  .targets-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .target-list {
    list-style: none;
    margin: 0.5rem 0 0 0;
    padding: 0;
  }
  .target-list li {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) auto auto minmax(0, 1.6fr);
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--line-hair);
  }
  @media (max-width: 720px) {
    .target-list li {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }
    .t-why {
      grid-column: 1 / -1;
    }
  }
  .t-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t-name:hover {
    text-decoration: underline;
  }
  .t-fig {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .t-target {
    color: var(--text-primary);
  }
  .t-why {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    min-width: 0;
  }
</style>
