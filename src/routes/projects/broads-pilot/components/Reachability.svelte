<script lang="ts">
  // Today's reachable destinations from the chosen origin, derived from the
  // engine's reachability map. Each row routes to that node on tap. Only shows
  // when an origin and a boat are set; lists moorings + named broads/staithes.
  import { app } from '../lib/appState.svelte';
  import { fmtDist, fmtTime } from '../lib/format';

  interface Row { nodeId: string; label: string; time_s: number; dist_m: number }

  // Filter the reachable map to destinations worth steering to (moorings, broads,
  // staithes), drop the origin, sort by quickest, and cap the list.
  const rows = $derived.by((): Row[] => {
    if (!app.reachable || !app.origin) return [];
    const originId = app.origin.nodeId;
    const out: Row[] = [];
    for (const [nodeId, r] of app.reachable) {
      if (nodeId === originId) continue;
      const isDestination =
        app.mooringsByNode.has(nodeId) ||
        nodeId.startsWith('broad-') ||
        nodeId.startsWith('staithe-');
      if (!isDestination) continue;
      out.push({ nodeId, label: app.nodeLabel(nodeId), time_s: r.time_s, dist_m: r.dist_m });
    }
    out.sort((a, b) => a.time_s - b.time_s);
    return out.slice(0, 40);
  });
</script>

{#if app.origin && app.boat}
  <section class="reach" aria-label="Reachable destinations today">
    <header class="reach-head">
      <div class="head-row">
        <span class="kicker">Reachable today</span>
        <label class="rings-toggle">
          <input type="checkbox" bind:checked={app.showRangeRings} />
          <span class="rings-label">Range bands</span>
        </label>
      </div>
      <p class="reach-note">
        From <strong>{app.origin.label}</strong> within today's daylight
        (~{fmtTime(app.daylightSeconds)}).
      </p>
      {#if app.showRangeRings}
        <ul class="legend" aria-label="Range band colours">
          <li><span class="dot" style="--c:#1b7a3d"></span>&le;1h</li>
          <li><span class="dot" style="--c:#7cb342"></span>&le;2h</li>
          <li><span class="dot" style="--c:#e69500"></span>&le;4h</li>
          <li><span class="dot" style="--c:#c4570a"></span>&gt;4h</li>
        </ul>
      {/if}
    </header>

    {#if rows.length === 0}
      <p class="empty">No destinations reachable from here today for this boat.</p>
    {:else}
      <ul class="list">
        {#each rows as r (r.nodeId)}
          <li>
            <button
              class="row"
              class:active={r.nodeId === app.destinationNode}
              aria-pressed={r.nodeId === app.destinationNode}
              onclick={() => app.routeTo(r.nodeId)}
            >
              <span class="row-name">{r.label}</span>
              <span class="row-stats">
                <span class="row-time">{fmtTime(r.time_s)}</span>
                <span class="row-dist">{fmtDist(r.dist_m, app.units)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .reach {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.6rem;
    color: var(--text-primary);
  }
  .reach-head { display: flex; flex-direction: column; gap: 0.4rem; }
  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .rings-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    cursor: pointer;
    min-height: 40px;
  }
  .rings-toggle input { width: 1.05rem; height: 1.05rem; accent-color: var(--accent); cursor: pointer; }
  .rings-label {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
  }
  .reach-note {
    margin: 0;
    font-family: var(--font-body);
    font-size: 0.82rem;
    line-height: 1.4;
    color: var(--text-secondary);
  }
  .reach-note strong { color: var(--text-primary); }

  .legend {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.9rem;
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.62rem;
    color: var(--text-muted);
  }
  .dot { width: 0.7rem; height: 0.7rem; border-radius: 50%; background: var(--c); flex: none; }

  .empty {
    margin: 0;
    font-family: var(--font-body);
    font-size: 0.84rem;
    color: var(--text-muted);
  }

  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    min-height: 40px;
    padding: 0.5rem 0.65rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 0.45rem;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
  }
  .row:hover { border-color: var(--text-muted); }
  .row.active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--surface-elevated));
  }
  .row-name {
    font-family: var(--font-body);
    font-size: 0.88rem;
    line-height: 1.2;
  }
  .row-stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.05rem;
    flex: none;
  }
  .row-time {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .row-dist {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--text-muted);
  }
</style>
