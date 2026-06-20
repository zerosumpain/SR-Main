<script lang="ts">
  // Live "cruising companion": when the planner is in cruise mode it shows a
  // status line, and — only when you're ON the Broads AND moving — pops up
  // banners of the notable things coming up (moorings, pubs, dog walks,
  // attractions), nearest first. Tap one to open its details.
  import { app } from '../lib/appState.svelte';
  import { logbook } from '../lib/logbook.svelte';
  import { fmtDist } from '../lib/format';

  const KIND_LABEL: Record<string, string> = { mooring: 'Mooring', pub: 'Pub', walk: 'Walk', attraction: 'Attraction', shop: 'Shop', fuel: 'Fuel' };
</script>

{#snippet kindIcon(kind: string)}
  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if kind === 'mooring'}
      <circle cx="10" cy="4" r="1.6" /><line x1="10" y1="5.6" x2="10" y2="17" /><line x1="6.5" y1="8.5" x2="13.5" y2="8.5" /><path d="M3.5 11.5a6.5 6.5 0 0 0 13 0" />
    {:else if kind === 'pub'}
      <path d="M5 3h7l-.7 8.5a2.5 2.5 0 0 1-5 0z" /><path d="M11.6 5h2.4a2 2 0 0 1 0 4h-2.1" /><line x1="6" y1="17" x2="12" y2="17" /><line x1="8.5" y1="14.5" x2="8.5" y2="17" />
    {:else if kind === 'walk'}
      <circle cx="6" cy="7" r="1.4" /><circle cx="14" cy="7" r="1.4" /><circle cx="3.5" cy="11" r="1.2" /><circle cx="16.5" cy="11" r="1.2" /><path d="M10 10c-2.4 0-4 1.8-4 4 0 1.6 1.4 2.5 4 2.5s4-.9 4-2.5c0-2.2-1.6-4-4-4z" />
    {:else if kind === 'shop'}
      <path d="M4 7h12l-.8 9H4.8z" /><path d="M7 7V5.5a3 3 0 0 1 6 0V7" />
    {:else if kind === 'fuel'}
      <rect x="4.5" y="4" width="7" height="13" rx="1" /><line x1="4.5" y1="8.5" x2="11.5" y2="8.5" /><path d="M11.5 7h2a1.5 1.5 0 0 1 1.5 1.5V13a1.3 1.3 0 0 0 2.6 0V8l-1.6-2" />
    {:else}
      <path d="M10 2.5l1.9 4.4 4.8.4-3.6 3.1 1.1 4.6L10 13l-4.2 2.6 1.1-4.6L3.3 7.3l4.8-.4z" />
    {/if}
  </svg>
{/snippet}

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
        <span class="zone-limit">{@render kindIcon('mooring')} {app.currentLimitMph} mph zone</span>
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
                <span class="ic">{@render kindIcon(n.kind)}</span>
                <span class="name">{n.name}</span>
                <span class="meta">{KIND_LABEL[n.kind] ?? n.kind}{n.dog ? ' · dog-friendly' : ''} · {fmtDist(n.dist_m, app.units)}</span>
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
    border-radius: var(--radius-round);
    overflow: hidden;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border-bottom: 1px solid var(--card-border);
  }
  .dot { width: 9px; height: 9px; border-radius: var(--radius-pill); background: var(--text-muted); flex: 0 0 auto; }
  .dot.live { background: var(--success); box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 60%, transparent); animation: cruise-pulse 1.4s ease-out infinite; }
  @keyframes cruise-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 55%, transparent); } 100% { box-shadow: 0 0 0 9px color-mix(in srgb, var(--success) 0%, transparent); } }
  .status { flex: 1 1 auto; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-primary); line-height: 1.3; }
  .stop {
    flex: 0 0 auto; font-family: var(--font-mono); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.06em;
    background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary);
    border-radius: var(--radius-round); padding: 0.3rem 0.55rem; min-height: 34px; cursor: pointer;
  }
  .stop:hover { color: var(--text-primary); border-color: var(--accent); }
  .rec { flex: 0 0 auto; font-family: var(--font-mono); font-size: 0.58rem; font-weight: 700; letter-spacing: 0.08em; color: var(--error); }

  /* live speed-limit readout for the stretch you're on */
  .zone { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; padding: 0.45rem 0.7rem; border-bottom: 1px solid var(--card-border); background: var(--card-bg); }
  .zone.over { background: color-mix(in srgb, var(--error) 12%, var(--surface-elevated)); }
  .zone-limit { display: inline-flex; align-items: center; gap: 0.3rem; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; color: var(--text-primary); }
  .zone-msg { font-family: var(--font-mono); font-size: 0.66rem; color: var(--text-muted); }
  .zone-msg.warn { color: var(--error); font-weight: 700; }

  .near { padding: 0.5rem 0.6rem 0.6rem; }
  .near-label { display: block; font-family: var(--font-mono); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.14em; color: var(--accent); margin-bottom: 0.4rem; }
  .cards { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.15rem; scrollbar-width: thin; }
  .card {
    flex: 0 0 auto; min-width: 9.5rem; max-width: 13rem; text-align: left;
    display: flex; flex-direction: column; gap: 0.12rem;
    background: var(--card-bg); border: 1px solid var(--card-border); border-left: 3px solid var(--accent);
    border-radius: var(--radius-round); padding: 0.45rem 0.55rem; cursor: pointer;
  }
  .card:hover { border-color: var(--accent); }
  .card .ic { display: inline-flex; line-height: 1; color: var(--accent); }
  .card .name { font-family: var(--font-body); font-size: 0.84rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card .meta { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); }
</style>
