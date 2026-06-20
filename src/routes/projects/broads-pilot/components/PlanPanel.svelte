<script lang="ts">
  // Current-leg summary, shown when app.route is set. Distance/time/fuel stats,
  // bridges en route (worst first), Breydon + daylight advisories, and the
  // add-to-itinerary / clear actions.
  import { app } from '../lib/appState.svelte';
  import { fmtDist, fmtTime, fmtMoney, fmtClearance } from '../lib/format';
  import { breydonAdvice, breydonCrossings, fmtTideTime } from '../lib/tide';
  import type { Verdict } from '../lib/types';

  // Real slack-water crossing windows for the planner date (Gorleston-based).
  const breydonWindows = $derived(breydonCrossings(app.data?.tides ?? null, app.date));
  const breydonDay = $derived(
    app.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }),
  );

  const VERDICT_COLOR: Record<Verdict, string> = { pass: 'var(--success)', marginal: 'var(--warn)', blocked: 'var(--error)' };
  const VERDICT_LABEL: Record<Verdict, string> = { pass: 'Pass', marginal: 'Marginal', blocked: 'Blocked' };

  // Worst-first ordering so the bits that matter surface at the top of the list.
  const RANK: Record<Verdict, number> = { blocked: 0, marginal: 1, pass: 2 };
  const sortedBridges = $derived(
    app.route ? [...app.route.bridges].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]) : [],
  );
  // Only the bridges that need attention; a clear route shows nothing but a tick.
  const issues = $derived(sortedBridges.filter((b) => b.verdict !== 'pass'));

  // A there-and-back day-trip won't fit if double the one-way time exceeds today's
  // daylight budget.
  const overDaylight = $derived(
    !!app.route && app.route.edges.length > 0 && app.route.time_s * 2 > app.daylightSeconds,
  );

  function add() {
    if (app.destinationNode) app.addStop(app.destinationNode);
  }
  function clear() {
    app.destinationNode = null;
  }
</script>

{#if app.route}
  <section class="plan" aria-label="Route plan">
    <header class="plan-head">
      <span class="kicker">Planned leg</span>
      <h2 class="leg-title">
        <span class="endpoint">{app.origin?.label ?? 'Origin'}</span>
        <span class="arrow" aria-hidden="true">→</span>
        <span class="endpoint">{app.nodeLabel(app.destinationNode ?? '')}</span>
      </h2>
    </header>

    {#if app.route.edges.length === 0}
      <div class="blocked-notice" role="alert">
        <span class="blocked-tag">Not reachable</span>
        <p class="blocked-msg">No passable route for this boat.</p>
        {#if app.route.blockedAt}
          <p class="blocked-detail">
            Blocked at <strong>{app.route.blockedAt.name}</strong> —
            clearance {fmtClearance(app.route.blockedAt.clearance_band_m[0], app.units)}.
          </p>
        {/if}
      </div>
    {:else}
      <div class="stats">
        <div class="stat">
          <span class="stat-label">Distance</span>
          <span class="stat-value">{fmtDist(app.route.distance_m, app.units)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Cruising</span>
          <span class="stat-value">{fmtTime(app.route.time_s)}</span>
        </div>
        {#if app.routeFuelCost}
          <div class="stat">
            <span class="stat-label">Fuel</span>
            <span class="stat-value">{app.routeFuelCost.litres.toFixed(1)} L</span>
            <span class="stat-sub">{fmtMoney(app.routeFuelCost.cost)}</span>
          </div>
        {/if}
      </div>

      {#if issues.length}
        <div class="bridges" role="status">
          <span class="kicker">Check these bridges</span>
          <ul class="bridge-list">
            {#each issues as { bridge, verdict } (bridge.id)}
              <li class="bridge-row">
                <span class="chip" style="--c:{VERDICT_COLOR[verdict]}">{VERDICT_LABEL[verdict]}</span>
                <span class="bridge-name">{bridge.name}</span>
                {#if bridge.pilot === 'mandatory'}<span class="tag tag-pilot">Pilot required</span>{/if}
                {#if bridge.opens_on_request}<span class="tag">Opens on request</span>{/if}
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        <p class="all-clear">✓ All bridges clear for your boat.</p>
      {/if}

      {#if app.route.crossesBreydon}
        <div class="callout callout-breydon" role="note">
          <span class="kicker callout-kicker">Breydon Water — tidal crossing</span>
          <p>{breydonAdvice()}</p>
          {#if breydonWindows.length}
            <p class="slack">
              <span class="slack-label">Slack water · {breydonDay}</span>
              {#each breydonWindows as w (w.mid.getTime())}
                <span class="slack-t" class:approx={w.approx}>{fmtTideTime(w.mid)}</span>
              {/each}
            </p>
          {/if}
        </div>
      {/if}

      {#if overDaylight}
        <div class="callout callout-daylight" role="note">
          <p>
            A there-and-back trip won't fit today's daylight
            (~{fmtTime(app.daylightSeconds)}); plan an overnight mooring.
          </p>
        </div>
      {/if}

      <div class="actions">
        <button class="btn btn-primary" onclick={add}>Add to itinerary</button>
        <button class="btn btn-ghost" onclick={clear}>Clear</button>
      </div>
    {/if}
  </section>
{/if}

<style>
  .plan {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    color: var(--text-primary);
  }
  .kicker {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .plan-head { display: flex; flex-direction: column; gap: 0.35rem; }
  .leg-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.95rem;
    line-height: 1.25;
    text-transform: uppercase;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
  }
  .endpoint { color: var(--text-primary); }
  .arrow { color: var(--accent); font-family: var(--font-mono); }

  /* blocked */
  .blocked-notice {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.75rem;
    border: 1px solid var(--card-border);
    border-left: 3px solid var(--error);
    border-radius: var(--radius-round);
    background: var(--card-bg);
  }
  .blocked-tag {
    align-self: flex-start;
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #fff;
    background: var(--error);
    padding: 0.18rem 0.45rem;
    border-radius: var(--radius-sharp);
  }
  .blocked-msg { margin: 0; font-family: var(--font-body); font-size: 0.9rem; }
  .blocked-detail { margin: 0; font-family: var(--font-body); font-size: 0.82rem; color: var(--text-secondary); }

  /* stats */
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1.2rem;
  }
  .stat { display: flex; flex-direction: column; gap: 0.1rem; min-width: 4.5rem; }
  .stat-label {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .stat-value {
    font-family: var(--font-mono);
    font-size: 1.3rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1.1;
  }
  .stat-sub { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-secondary); }

  /* bridges */
  .bridges { display: flex; flex-direction: column; gap: 0.4rem; }
  .bridge-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .bridge-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
  .chip {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #fff;
    background: var(--c);
    padding: 0.16rem 0.42rem;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
  }
  .bridge-name { font-family: var(--font-body); font-size: 0.88rem; color: var(--text-primary); }
  .tag {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    padding: 0.12rem 0.36rem;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
  }
  .tag-pilot { color: var(--accent); border-color: var(--accent); }
  .all-clear { margin: 0; font-family: var(--font-body); font-size: 0.84rem; color: var(--success); }

  /* callouts */
  .callout {
    padding: 0.7rem 0.75rem;
    border-radius: var(--radius-round);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 14%, var(--surface-elevated));
  }
  .callout p { margin: 0; font-family: var(--font-body); font-size: 0.84rem; line-height: 1.45; color: var(--text-primary); }
  .callout-kicker { color: var(--warn); margin-bottom: 0.3rem; }
  .slack { margin-top: 0.4rem !important; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.4rem 0.55rem; }
  .slack-label { font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
  .slack-t { font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: var(--warn); }
  .slack-t.approx { color: var(--text-muted); }
  .slack-t.approx::after { content: '~'; font-size: 0.7em; vertical-align: super; }

  /* actions */
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.55rem 0.9rem;
    border-radius: var(--radius-round);
    cursor: pointer;
    min-height: 40px;
  }
  .btn-primary { background: var(--accent); color: #fff; border: none; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-ghost { background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary); }
  .btn-ghost:hover { color: var(--text-primary); border-color: var(--text-muted); }
</style>
