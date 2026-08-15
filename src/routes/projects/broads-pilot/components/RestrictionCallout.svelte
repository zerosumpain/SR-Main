<script lang="ts">
  // Drawer body for a selected bridge or lock. Shows clearance band, tags,
  // this-boat verdict, notes and a safety advisory. Opaque panel so it can float.
  import { app } from '../lib/appState.svelte';
  import { fmtClearance } from '../lib/format';
  import { bridgeVerdict } from '../lib/passability';
  import { bridgeTideWindows, hasRealDataForDay, fmtTideTime } from '../lib/tide';
  import type { Bridge, Lock, Verdict } from '../lib/types';

  const VERDICT_COLOR: Record<Verdict, string> = { pass: 'var(--success)', marginal: 'var(--warn)', blocked: 'var(--error)' };
  const VERDICT_LABEL: Record<Verdict, string> = {
    pass: 'Your boat passes',
    marginal: 'Marginal for your boat',
    blocked: 'Blocked for your boat',
  };

  const sel = $derived(app.selected);

  const bridge = $derived<Bridge | null>(
    sel?.kind === 'bridge'
      ? app.data?.restrictions.bridges.find((b) => b.id === sel.id) ?? null
      : null,
  );
  const lock = $derived<Lock | null>(
    sel?.kind === 'lock' ? app.data?.restrictions.lock ?? null : null,
  );

  const verdict = $derived<Verdict | null>(
    bridge && app.boat ? bridgeVerdict(bridge, app.boat) : null,
  );

  // Single value when the band collapses, otherwise "low to high".
  function clearanceText(b: Bridge): string {
    const [lo, hi] = b.clearance_band_m;
    return lo === hi
      ? fmtClearance(lo, app.units)
      : `${fmtClearance(lo, app.units)} to ${fmtClearance(hi, app.units)}`;
  }

  // Local low-water (= max headroom) times at this bridge for the planner date.
  const tideLows = $derived(bridge ? bridgeTideWindows(app.data?.tides ?? null, bridge, app.date) : []);
  const tideReal = $derived(hasRealDataForDay(app.data?.tides ?? null, app.date));
  const dayLabel = $derived(
    app.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' }),
  );
</script>

{#if bridge || lock}
  <aside class="callout" role="dialog" aria-label="Restriction detail">
    {#if bridge}
      <header class="head">
        <div class="head-text">
          <span class="kicker">Bridge · {bridge.river}</span>
          <h2 class="title">{bridge.name}</h2>
        </div>
        <button class="close" onclick={() => app.closeSelection()} aria-label="Close">×</button>
      </header>

      <div class="metric">
        <span class="metric-label">Clearance (at high water)</span>
        <span class="metric-value">{clearanceText(bridge)}</span>
      </div>

      <div class="tags">
        {#if bridge.tide_dependent}<span class="tag">Tide-dependent</span>{/if}
        {#if bridge.pilot}<span class="tag tag-accent">Pilot {bridge.pilot}</span>{/if}
        {#if bridge.opens_on_request}<span class="tag">Opens on request</span>{/if}
        {#if bridge.practically_closed}<span class="tag tag-danger">Practically closed</span>{/if}
      </div>

      {#if verdict}
        <p class="verdict" style="--c:{VERDICT_COLOR[verdict]}">
          <span class="verdict-dot" aria-hidden="true"></span>
          {VERDICT_LABEL[verdict]}
        </p>
      {:else}
        <p class="verdict verdict-muted">Pick a boat to see the verdict for your vessel.</p>
      {/if}

      {#if bridge.notes}
        <p class="notes">{bridge.notes}</p>
      {/if}

      {#if tideLows.length}
        <div class="tide">
          <span class="tide-label">
            Best to pass · {dayLabel}
            <span class="tide-sub">low water = max headroom</span>
          </span>
          <span class="tide-times">
            {#each tideLows as l (l.at.getTime())}
              <span class="tide-t" class:approx={l.approx}>{fmtTideTime(l.at)}</span>
            {/each}
          </span>
          {#if !tideReal}
            <span class="tide-approx">~ approximate (no published table for this date)</span>
          {/if}
        </div>
      {/if}

      <p class="safety">
        Advisory — clearances are at average high water and vary with the tide.
        Check the gauge board.
      </p>
    {:else if lock}
      <header class="head">
        <div class="head-text">
          <span class="kicker">Lock</span>
          <h2 class="title">{lock.name}</h2>
        </div>
        <button class="close" onclick={() => app.closeSelection()} aria-label="Close">×</button>
      </header>

      <dl class="spec">
        <div class="spec-row">
          <dt>Max LOA</dt><dd>{lock.max_loa_m.toFixed(1)} m</dd>
        </div>
        <div class="spec-row">
          <dt>Max beam</dt><dd>{lock.max_beam_m.toFixed(1)} m</dd>
        </div>
        <div class="spec-row">
          <dt>Max draft</dt><dd>{lock.max_draft_m.toFixed(1)} m</dd>
        </div>
        <div class="spec-row">
          <dt>Hours</dt><dd>{lock.hours}</dd>
        </div>
        <div class="spec-row">
          <dt>Booking</dt><dd>{lock.booking}</dd>
        </div>
      </dl>

      {#if lock.notes}
        <p class="notes">{lock.notes}</p>
      {/if}

      <p class="safety">
        Advisory — lock dimensions are nominal; confirm with the keeper before
        committing your boat.
      </p>
    {/if}
  </aside>
{/if}

<style>
  .callout {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-primary);
  }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
  .head-text { display: flex; flex-direction: column; gap: 0.3rem; }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.05rem;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .close {
    flex: none;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 1.4rem;
    line-height: 1;
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .close:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .metric { display: flex; flex-direction: column; gap: 0.15rem; }
  .metric-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .metric-value {
    font-family: var(--font-mono);
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    padding: 0.16rem 0.42rem;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
  }
  .tag-accent { color: var(--accent); border-color: var(--accent); }
  .tag-danger { color: #fff; background: var(--error); border-color: var(--error); }

  .verdict {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.92rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--c);
  }
  .verdict-dot { width: 0.7rem; height: 0.7rem; border-radius: var(--radius-pill); background: var(--c); flex: none; }
  .verdict-muted { color: var(--text-muted); font-weight: 400; text-transform: none; letter-spacing: 0; }

  .notes {
    margin: 0;
    font-family: var(--font-body);
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .tide {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.6rem 0.7rem;
    border-radius: var(--radius-sharp);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    background: color-mix(in srgb, var(--accent) 9%, var(--surface-elevated));
  }
  .tide-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: baseline;
  }
  .tide-sub { color: var(--text-muted); letter-spacing: 0.06em; }
  .tide-times { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .tide-t { font-family: var(--font-mono); font-size: 1.05rem; font-weight: 700; color: var(--text-primary); }
  .tide-t.approx { color: var(--text-muted); }
  .tide-t.approx::after { content: '~'; font-size: max(0.7em, var(--fs-label-xs)); vertical-align: super; }
  .tide-approx { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  .spec { margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .spec-row {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    padding-bottom: 0.3rem;
    border-bottom: 1px solid var(--card-border);
  }
  .spec-row dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .spec-row dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.84rem;
    color: var(--text-primary);
    text-align: right;
  }

  .safety {
    margin: 0;
    padding: 0.6rem 0.7rem;
    border-radius: var(--radius-sharp);
    border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface-elevated));
    font-family: var(--font-body);
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-primary);
  }
</style>
