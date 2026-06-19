<script lang="ts">
  // The cruise logbook: a journal of past cruises recorded in live mode. Each
  // entry shows a mini track map, the headline stats (distance / duration / top
  // speed), an editable title + notes, and GPX export / delete. Tracks come from
  // IndexedDB via the shared `logbook` store.
  import { app } from '../lib/appState.svelte';
  import { logbook, toGpx, defaultTitle, type CruiseLog } from '../lib/logbook.svelte';
  import { fmtDist, fmtTime } from '../lib/format';

  let { onClose }: { onClose: () => void } = $props();

  // Project a track into a small viewbox (equirectangular, lat-scaled), returning
  // an SVG polyline `points` string plus the start/end coords in box space.
  const VB_W = 132, VB_H = 76, PAD = 6;
  function trackPath(log: CruiseLog) {
    const pts = log.points;
    if (pts.length < 2) return null;
    const latR = (pts.reduce((s, p) => s + p.lat, 0) / pts.length) * Math.PI / 180;
    const xs = pts.map((p) => p.lng * Math.cos(latR));
    const ys = pts.map((p) => -p.lat);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = maxX - minX || 1e-6, spanY = maxY - minY || 1e-6;
    const scale = Math.min((VB_W - 2 * PAD) / spanX, (VB_H - 2 * PAD) / spanY);
    const ox = (VB_W - spanX * scale) / 2, oy = (VB_H - spanY * scale) / 2;
    const proj = (i: number) => [ox + (xs[i] - minX) * scale, oy + (ys[i] - minY) * scale] as const;
    const coords = pts.map((_, i) => proj(i));
    return {
      d: coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
      start: coords[0], end: coords[coords.length - 1],
    };
  }

  function exportGpx(log: CruiseLog) {
    const blob = new Blob([toGpx(log)], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(log.title || defaultTitle(log.startedAt)).replace(/[^\w-]+/g, '-').toLowerCase()}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function when(log: CruiseLog) {
    const d = new Date(log.startedAt);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  function elapsed(log: CruiseLog) {
    if (!log.endedAt) return '—';
    return fmtTime(Math.round((log.endedAt - log.startedAt) / 1000));
  }

  let confirmDelete = $state<string | null>(null);
</script>

<div class="lb-backdrop" onclick={onClose} role="presentation">
  <div class="lb" role="dialog" aria-label="Cruise logbook" onclick={(e) => e.stopPropagation()}>
    <header class="lb-head">
      <span class="kicker">Cruise logbook</span>
      <h2>Your cruises</h2>
      <button class="close" onclick={onClose} aria-label="Close">✕</button>
    </header>

    <div class="lb-body">
      {#if logbook.recording}
        <p class="rec"><span class="rec-dot"></span> Recording now · {fmtDist(logbook.liveDistance_m, app.units)} so far. It'll be saved when you stop live mode.</p>
      {/if}

      {#if !logbook.entries.length}
        <div class="empty">
          <p class="empty-ic">⚓</p>
          <p class="empty-t">No cruises logged yet</p>
          <p class="empty-d">Tap <strong>Live</strong> and start moving on the water — your track records automatically and lands here when you stop.</p>
        </div>
      {:else}
        <ul class="logs">
          {#each logbook.entries as log (log.id)}
            {@const tp = trackPath(log)}
            <li class="log">
              <div class="log-top">
                <svg class="mini" viewBox="0 0 {VB_W} {VB_H}" aria-hidden="true">
                  {#if tp}
                    <polyline points={tp.d} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                    <circle cx={tp.start[0]} cy={tp.start[1]} r="3.2" fill="#2e7d32" stroke="#fff" stroke-width="1" />
                    <circle cx={tp.end[0]} cy={tp.end[1]} r="3.2" fill="#c62828" stroke="#fff" stroke-width="1" />
                  {:else}
                    <text x={VB_W / 2} y={VB_H / 2} text-anchor="middle" fill="var(--text-muted)" font-size="9">no track</text>
                  {/if}
                </svg>
                <div class="log-meta">
                  <input class="title-in" value={log.title || defaultTitle(log.startedAt)}
                    onchange={(e) => logbook.update(log.id, { title: e.currentTarget.value })}
                    aria-label="Cruise title" />
                  <span class="when">{when(log)}{log.boatName ? ` · ${log.boatName}` : ''}</span>
                  <div class="stats">
                    <span><strong>{fmtDist(log.distance_m, app.units)}</strong><em>distance</em></span>
                    <span><strong>{elapsed(log)}</strong><em>elapsed</em></span>
                    <span><strong>{fmtTime(log.movingTime_s)}</strong><em>under way</em></span>
                    <span><strong>{log.maxSpeedMph.toFixed(1)}</strong><em>top mph</em></span>
                  </div>
                </div>
              </div>

              <textarea class="notes" placeholder="Add a note — weather, who came, where you moored…"
                value={log.notes}
                onchange={(e) => logbook.update(log.id, { notes: e.currentTarget.value })}></textarea>

              <div class="log-actions">
                <button class="mini-btn" onclick={() => exportGpx(log)}>↓ GPX</button>
                {#if confirmDelete === log.id}
                  <button class="mini-btn danger" onclick={() => { logbook.remove(log.id); confirmDelete = null; }}>Confirm delete</button>
                  <button class="mini-btn" onclick={() => (confirmDelete = null)}>Cancel</button>
                {:else}
                  <button class="mini-btn ghost" onclick={() => (confirmDelete = log.id)}>Delete</button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>

<style>
  .lb-backdrop { position: absolute; inset: 0; z-index: 1000; background: rgba(26, 16, 8, 0.42); display: grid; place-items: center; padding: 0.6rem; }
  .lb { width: min(48rem, 96vw); max-height: calc(100dvh - 1.2rem); display: flex; flex-direction: column; background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.7rem; box-shadow: 0 12px 40px rgba(26, 16, 8, 0.35); overflow: hidden; }
  .lb-head { position: relative; padding: 0.9rem 1rem 0.7rem; border-bottom: 1px solid var(--card-border); }
  .kicker { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.58rem; color: var(--accent); }
  .lb-head h2 { margin: 0.15rem 0 0; font-family: var(--font-display); text-transform: uppercase; font-size: 1.05rem; color: var(--text-primary); }
  .close { position: absolute; top: 0.6rem; right: 0.7rem; background: transparent; border: none; color: var(--text-muted); font-size: 1.1rem; cursor: pointer; padding: 0.3rem; min-height: 36px; min-width: 36px; }
  .close:hover { color: var(--text-primary); }

  .lb-body { overflow-y: auto; padding: 0.8rem; display: flex; flex-direction: column; gap: 0.7rem; }
  .rec { margin: 0; display: flex; align-items: center; gap: 0.5rem; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-primary); background: color-mix(in srgb, #2e7d32 12%, var(--surface-elevated)); border: 1px solid color-mix(in srgb, #2e7d32 40%, transparent); border-radius: 0.45rem; padding: 0.5rem 0.65rem; }
  .rec-dot { width: 9px; height: 9px; border-radius: 50%; background: #c62828; flex: 0 0 auto; animation: lb-pulse 1.3s ease-out infinite; }
  @keyframes lb-pulse { 0% { box-shadow: 0 0 0 0 rgba(198, 40, 40, 0.5); } 100% { box-shadow: 0 0 0 7px rgba(198, 40, 40, 0); } }

  .empty { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; padding: 2rem 1rem; text-align: center; }
  .empty-ic { font-size: 2rem; margin: 0; opacity: 0.5; }
  .empty-t { margin: 0; font-family: var(--font-display); text-transform: uppercase; font-size: 1rem; color: var(--text-primary); }
  .empty-d { margin: 0; max-width: 26rem; font-family: var(--font-body); font-size: 0.86rem; line-height: 1.5; color: var(--text-secondary); }

  .logs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.7rem; }
  .log { border: 1px solid var(--card-border); border-radius: 0.55rem; padding: 0.7rem; background: var(--card-bg); display: flex; flex-direction: column; gap: 0.55rem; }
  .log-top { display: flex; gap: 0.7rem; }
  .mini { flex: 0 0 auto; width: 132px; height: 76px; background: var(--bg-section, var(--bg)); border: 1px solid var(--card-border); border-radius: 0.4rem; }
  .log-meta { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; flex: 1 1 auto; }
  .title-in { font-family: var(--font-body); font-weight: 600; font-size: 0.95rem; color: var(--text-primary); background: transparent; border: 1px solid transparent; border-radius: 0.3rem; padding: 0.15rem 0.25rem; margin-left: -0.25rem; }
  .title-in:hover { border-color: var(--card-border); }
  .title-in:focus { outline: none; border-color: var(--accent); background: var(--surface-elevated); }
  .when { font-family: var(--font-mono); font-size: 0.62rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .stats { display: flex; flex-wrap: wrap; gap: 0.5rem 0.9rem; margin-top: 0.15rem; }
  .stats span { display: flex; flex-direction: column; }
  .stats strong { font-family: var(--font-mono); font-size: 0.92rem; color: var(--text-primary); }
  .stats em { font-family: var(--font-mono); font-size: 0.54rem; font-style: normal; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }

  .notes { width: 100%; box-sizing: border-box; min-height: 2.2rem; resize: vertical; font-family: var(--font-body); font-size: 0.82rem; line-height: 1.4; color: var(--text-primary); background: var(--surface-elevated); border: 1px solid var(--card-border); border-radius: 0.4rem; padding: 0.45rem 0.55rem; }
  .notes:focus { outline: none; border-color: var(--accent); }

  .log-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .mini-btn { font-family: var(--font-mono); font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.4rem 0.65rem; border-radius: 0.35rem; min-height: 36px; cursor: pointer; background: var(--card-bg); border: 1px solid var(--card-border); color: var(--text-secondary); }
  .mini-btn:hover { border-color: var(--accent); color: var(--text-primary); }
  .mini-btn.ghost { color: var(--text-muted); }
  .mini-btn.danger { background: #c62828; border-color: #c62828; color: #fff; }
</style>
