<script lang="ts">
  // Live "cruising companion": when the planner is in cruise mode it shows a
  // status line, and — only when you're ON the Broads AND moving — pops up
  // banners of the notable things coming up (moorings, pubs, dog walks,
  // attractions), nearest first. Tap one to open its details.
  import { app } from '../lib/appState.svelte';
  import { logbook } from '../lib/logbook.svelte';
  import { fmtDist } from '../lib/format';

  const KIND_ICON: Record<string, string> = { mooring: '⚓', pub: '🍺', walk: '🐾', attraction: '★', shop: '🛒', fuel: '⛽' };
  const KIND_LABEL: Record<string, string> = { mooring: 'Mooring', pub: 'Pub', walk: 'Walk', attraction: 'Attraction', shop: 'Shop', fuel: 'Fuel' };
</script>

{#if app.cruiseActive}
  <div class="cruise" role="region" aria-label="Live cruise companion">
    <div class="bar">
      <span class="dot" class:live={app.cruising}></span>
      <span class="status">
        {#if app.geoError}{app.geoError}
        {:else if !app.userPosition}Getting your position…
        {:else if !app.onBroads}Cruise mode · you're not on the Broads yet
        {:else if !app.moving}Moored · {app.speedMph.toFixed(1)} mph — start moving to see what's nearby
        {:else}Cruising · {app.speedMph.toFixed(1)} mph{/if}
      </span>
      {#if logbook.recording}<span class="rec" title="Recording this cruise to your logbook">● REC</span>{/if}
      <button class="stop" onclick={() => app.stopCruise()}>Stop</button>
    </div>

    {#if app.cruising && app.currentLimitMph != null}
      <div class="zone" class:over={app.overLimit}>
        <span class="zone-limit">⚓ {app.currentLimitMph} mph zone</span>
        {#if app.overLimit}
          <span class="zone-msg warn">Ease off — you're doing {app.speedMph.toFixed(1)}</span>
        {:else}
          <span class="zone-msg">Doing {app.speedMph.toFixed(1)} — you're fine</span>
        {/if}
      </div>
    {/if}

    {#if app.cruising}
      {#if app.nearby.length}
        <div class="near">
          <span class="near-label">Coming up nearby</span>
          <div class="cards">
            {#each app.nearby as n (n.id)}
              <button class="card" onclick={() => app.select(n.sel)}>
                <span class="ic">{KIND_ICON[n.kind] ?? '•'}</span>
                <span class="name">{n.name}</span>
                <span class="meta">{KIND_LABEL[n.kind] ?? n.kind}{n.dog ? ' · 🐾' : ''} · {fmtDist(n.dist_m, app.units)}</span>
              </button>
            {/each}
          </div>
        </div>
      {:else}
        <div class="near"><span class="near-label">Nothing notable within 600 m — keep cruising</span></div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .cruise {
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: 0.6rem;
    box-shadow: 0 6px 24px rgba(26, 16, 8, 0.22);
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--card-border);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-muted); flex: 0 0 auto; }
  .dot.live { background: #2e7d32; box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.6); animation: cruise-pulse 1.4s ease-out infinite; }
  @keyframes cruise-pulse { 0% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.55); } 100% { box-shadow: 0 0 0 9px rgba(46, 125, 50, 0); } }
  .status { flex: 1 1 auto; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-primary); line-height: 1.3; }
  .stop {
    flex: 0 0 auto; font-family: var(--font-mono); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em;
    background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary);
    border-radius: 0.35rem; padding: 0.3rem 0.55rem; min-height: 34px; cursor: pointer;
  }
  .stop:hover { color: var(--text-primary); border-color: var(--accent); }
  .rec { flex: 0 0 auto; font-family: var(--font-mono); font-size: 0.58rem; font-weight: 700; letter-spacing: 0.08em; color: #c62828; }

  /* live speed-limit readout for the stretch you're on */
  .zone { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.45rem 0.7rem; border-bottom: 1px solid var(--card-border); background: var(--card-bg); }
  .zone.over { background: color-mix(in srgb, #c62828 12%, var(--surface-elevated)); }
  .zone-limit { font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: var(--text-primary); }
  .zone-msg { font-family: var(--font-mono); font-size: 0.66rem; color: var(--text-muted); }
  .zone-msg.warn { color: #c62828; font-weight: 700; }

  .near { padding: 0.5rem 0.6rem 0.6rem; }
  .near-label { display: block; font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent); margin-bottom: 0.4rem; }
  .cards { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.15rem; scrollbar-width: thin; }
  .card {
    flex: 0 0 auto; min-width: 9.5rem; max-width: 13rem; text-align: left;
    display: flex; flex-direction: column; gap: 0.12rem;
    background: var(--card-bg); border: 1px solid var(--card-border); border-left: 3px solid var(--accent);
    border-radius: 0.4rem; padding: 0.45rem 0.55rem; cursor: pointer;
  }
  .card:hover { border-color: var(--accent); }
  .card .ic { font-size: 0.95rem; line-height: 1; }
  .card .name { font-family: var(--font-body); font-size: 0.84rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .meta { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); }
</style>
