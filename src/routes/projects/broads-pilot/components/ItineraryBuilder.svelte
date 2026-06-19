<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { fmtDist, fmtTime, fmtMoney } from '../lib/format';
  import { breydonAdvice } from '../lib/tide';

  let copied = $state(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      copied = false;
    }
  }
</script>

{#if app.itinerary.length > 0}
  <section class="trip">
    <header class="head">
      <h3 class="title">Your trip</h3>
      <button class="ghost" onclick={() => app.clearItinerary()}>Clear</button>
    </header>

    <ol class="stops">
      <li class="stop origin">
        <span class="idx">0</span>
        <span class="body">
          <span class="label">{app.origin?.label ?? 'Start'}</span>
          <span class="sub">Start</span>
        </span>
      </li>

      {#each app.itinerary as nodeId, i (nodeId + ':' + i)}
        {@const leg = app.itineraryLegs[i]}
        <li class="stop">
          <span class="idx">{i + 1}</span>
          <span class="body">
            <span class="label">{app.nodeLabel(nodeId)}</span>
            <span class="sub">
              {#if leg && leg.edges.length === 0}
                <span class="bad">unreachable for this boat</span>
              {:else if leg}
                <span class="num">{fmtDist(leg.distance_m, app.units)}</span>
                <span class="dot">·</span>
                <span class="num">{fmtTime(leg.time_s)}</span>
                {#if leg.crossesBreydon}
                  <span class="tag">tidal</span>
                {/if}
              {/if}
            </span>
          </span>
          <button class="rm" aria-label="Remove stop" onclick={() => app.removeStop(i)}>×</button>
        </li>
      {/each}
    </ol>

    <p class="add-hint">
      <span class="plus">＋</span>
      Tap any mooring on the map to add it after <strong>{app.lastStopLabel}</strong>.
    </p>

    {#if app.itinerarySummary}
      {@const s = app.itinerarySummary}
      <dl class="totals">
        <div class="tot">
          <dt>Distance</dt>
          <dd class="num">{fmtDist(s.distance_m, app.units)}</dd>
        </div>
        <div class="tot">
          <dt>Cruising</dt>
          <dd class="num">{fmtTime(s.time_s)}</dd>
        </div>
        <div class="tot">
          <dt>Fuel</dt>
          <dd class="num">{s.litres.toFixed(1)} L · {fmtMoney(s.cost)}</dd>
        </div>
      </dl>

      {#if s.blocked}
        <p class="note error">
          One or more legs are blocked for this boat — pick a boat that fits or change the route.
        </p>
      {/if}
      {#if s.overDaylight}
        <p class="note warn">
          Total cruising exceeds one day's daylight (~{fmtTime(app.daylightSeconds)}) — split across
          days, mooring overnight.
        </p>
      {/if}
      {#if s.crossesBreydon}
        <p class="note warn">{breydonAdvice()}</p>
      {/if}
    {/if}

    <button class="share" onclick={copyLink}>
      {copied ? 'Copied!' : 'Share / copy link'}
    </button>
  </section>
{/if}

<style>
  .trip {
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.6rem;
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-primary);
  }

  .ghost {
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-secondary);
    font-family: var(--font-mono);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.45rem 0.7rem;
    min-height: 40px;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .ghost:hover {
    color: var(--text-primary);
    border-color: var(--text-muted);
  }

  .stops {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .add-hint {
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.5rem 0.6rem;
    border: 1px dashed var(--card-border);
    border-radius: 0.4rem;
    font-family: var(--font-body);
    font-size: 0.78rem;
    line-height: 1.35;
    color: var(--text-secondary);
  }
  .add-hint .plus {
    font-family: var(--font-mono);
    color: var(--accent);
    font-weight: 700;
    flex: 0 0 auto;
  }
  .add-hint strong { color: var(--text-primary); }

  .stop {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.45rem;
    border-radius: 0.4rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
  }
  .stop.origin {
    background: transparent;
  }

  .idx {
    flex: 0 0 auto;
    width: 1.5rem;
    height: 1.5rem;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: #fff;
    background: var(--accent);
    border-radius: 50%;
  }
  .origin .idx {
    background: var(--text-muted);
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }

  .label {
    font-family: var(--font-body);
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.66rem;
    color: var(--text-secondary);
  }
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .dot {
    color: var(--text-ghost);
  }
  .bad {
    color: var(--error);
  }
  .tag {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--warn);
    border: 1px solid var(--warn);
    border-radius: 0.25rem;
    padding: 0.02rem 0.28rem;
  }

  .rm {
    flex: 0 0 auto;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 1.25rem;
    line-height: 1;
    cursor: pointer;
    border-radius: 0.4rem;
  }
  .rm:hover {
    color: var(--error);
  }

  .totals {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    padding-top: 0.3rem;
    border-top: 1px solid var(--card-border);
  }
  .tot {
    display: flex;
    flex-direction: column;
    gap: 0.18rem;
  }
  .tot dt {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .tot dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .note {
    margin: 0;
    padding: 0.55rem 0.65rem;
    border-radius: 0.4rem;
    font-family: var(--font-body);
    font-size: 0.78rem;
    line-height: 1.35;
    border: 1px solid;
  }
  .note.warn {
    color: var(--warn);
    border-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 8%, transparent);
  }
  .note.error {
    color: var(--error);
    border-color: var(--error);
    background: color-mix(in srgb, var(--error) 8%, transparent);
  }

  .share {
    align-self: stretch;
    background: var(--accent);
    color: #fff;
    border: none;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.6rem 0.8rem;
    min-height: 40px;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .share:hover {
    background: var(--accent-hover);
  }
</style>
