<script lang="ts">
  import { onMount } from 'svelte';
  import type { HostCard } from '$lib/estate/hosts';
  import { formatUptime } from '$lib/estate/hosts';

  let { compact = false }: { compact?: boolean } = $props();

  let hosts = $state<HostCard[] | null>(null);
  let at = $state<number | null>(null);
  let failed = $state(false);
  // Plain let, never $state — svelte5-pitfalls rule 1. load() reads and writes
  // this, and it is called from onMount's interval; as $state the effect would
  // subscribe to the handle it reassigns.
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  async function load() {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await fetch('/api/admin/hosts');
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      hosts = body.hosts;
      at = body.at;
      failed = false;
    } catch {
      // Keep the last known cards on screen. A transient fetch failure from the
      // browser says nothing about the boxes, and blanking the tiles would read
      // as an outage that is not happening.
      failed = true;
    } finally {
      inFlight = false;
    }
  }

  onMount(() => {
    load();
    // 60s. The probe behind this opens ~19 sockets across the tailnet; at 10s
    // it would be doing that six times a minute for a strip nobody is watching
    // that closely.
    timer = setInterval(load, 60_000);
    return () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
  });

  function pct(v: number | null | undefined): string {
    return v == null ? '—' : `${v}%`;
  }

  /** Amber once a figure is within sight of its threshold, so the tile shows
   *  pressure building rather than only announcing it on arrival. */
  function level(v: number | null | undefined, warn: number): string {
    if (v == null) return 'idle';
    if (v >= warn) return 'error';
    if (v >= warn - 15) return 'warn';
    return 'ok';
  }
</script>

<section class="hs-strip" class:compact aria-label="Home server status">
  <div class="hs-hd">
    <span class="hs-hd-label">Home estate</span>
    <span class="hs-hd-meta">
      {#if failed}
        <span class="hs-stale">status fetch failed — showing last known</span>
      {:else if at}
        checked {new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      {:else}
        checking…
      {/if}
    </span>
  </div>

  <div class="hs-grid">
    {#if !hosts}
      {#each ['homeserv', 'porkserv'] as name (name)}
        <div class="hs-card hs-loading">
          <div class="hs-card-hd">
            <span class="hs-name">{name}</span>
            <span class="nm-pill" data-state="idle">checking</span>
          </div>
          <div class="hs-role">&nbsp;</div>
        </div>
      {/each}
    {:else}
      {#each hosts as h (h.id)}
        <a class="hs-card" href="/admin/estate" data-state={h.state}>
          <div class="hs-card-hd">
            <span class="hs-name">{h.label}</span>
            <span class="nm-pill" data-state={h.state === 'up' ? 'ok' : h.state === 'degraded' ? 'warn' : h.state === 'down' ? 'error' : 'idle'}>
              {h.state}
            </span>
          </div>
          <div class="hs-role">{h.role}</div>

          {#if h.vitals}
            <div class="hs-metrics">
              <div class="hs-metric">
                <span class="hs-m-label">load</span>
                <span class="hs-m-value">{h.vitals.load[1]?.toFixed(2) ?? '—'}</span>
                <span class="hs-m-sub">{h.vitals.cpus} cores</span>
              </div>
              <div class="hs-metric">
                <span class="hs-m-label">memory</span>
                <span class="hs-m-value" data-level={level(h.vitals.mem?.usedPct, 90)}>{pct(h.vitals.mem?.usedPct)}</span>
                <span class="hs-m-sub">{h.vitals.mem ? `${(h.vitals.mem.availableMb / 1024).toFixed(1)}GB free` : '—'}</span>
              </div>
              <div class="hs-metric">
                <span class="hs-m-label">disk</span>
                <span class="hs-m-value" data-level={level(h.vitals.disk?.usedPct, 85)}>{pct(h.vitals.disk?.usedPct)}</span>
                <span class="hs-m-sub">{h.vitals.disk ? `${h.vitals.disk.freeGb}GB free` : '—'}</span>
              </div>
              <div class="hs-metric">
                <span class="hs-m-label">swap</span>
                <span class="hs-m-value" data-level={level(h.vitals.swap?.usedPct, 50)}>{pct(h.vitals.swap?.usedPct)}</span>
                <span class="hs-m-sub">{h.vitals.swap ? `${h.vitals.swap.usedMb}MB` : '—'}</span>
              </div>
            </div>
          {/if}

          <div class="hs-foot">
            <span>
              {#if h.vitals}
                up {formatUptime(h.vitals.uptimeSec)}{#if h.vitals.tempC} · {h.vitals.tempC}°C{/if}
              {:else}
                no vitals
              {/if}
            </span>
            <span class="hs-svc" data-level={h.services.down.length ? 'error' : 'ok'}>
              {h.services.up}/{h.services.total} services
            </span>
          </div>

          {#if h.reason}
            <div class="hs-reason">{h.reason}</div>
          {/if}
        </a>
      {/each}
    {/if}
  </div>
</section>

<style>
  .hs-strip {
    margin-bottom: 1.25rem;
  }
  .hs-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }
  .hs-hd-label,
  .hs-hd-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-ghost);
  }
  .hs-hd-meta {
    letter-spacing: 0.08em;
    text-transform: none;
  }
  .hs-stale {
    color: var(--warn);
  }

  .hs-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }

  .hs-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    /* The state lives on the left edge, so a glance down the strip reads as a
       column of colour rather than four pills needing to be found and parsed. */
    border-left-width: 3px;
    border-left-color: var(--line-strong);
    text-decoration: none;
    color: inherit;
  }
  .hs-card[data-state='up'] { border-left-color: var(--success); }
  .hs-card[data-state='degraded'] { border-left-color: var(--warn); }
  .hs-card[data-state='down'] { border-left-color: var(--error); }
  a.hs-card:hover { border-color: var(--accent); }
  a.hs-card:hover[data-state='up'] { border-left-color: var(--success); }
  a.hs-card:hover[data-state='degraded'] { border-left-color: var(--warn); }
  a.hs-card:hover[data-state='down'] { border-left-color: var(--error); }
  .hs-loading { opacity: 0.55; }

  .hs-card-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .hs-name {
    font-family: var(--font-brand);
    font-size: 1.15rem;
    font-weight: 500;
    letter-spacing: -0.01em;
    color: var(--text-primary);
  }
  .hs-role {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }

  .hs-metrics {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    padding-top: 0.15rem;
  }
  .hs-metric {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .hs-m-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .hs-m-value {
    font-family: var(--font-brand);
    font-variant-numeric: tabular-nums;
    font-size: 1.1rem;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .hs-m-value[data-level='warn'] { color: var(--warn); }
  .hs-m-value[data-level='error'] { color: var(--error); }
  .hs-m-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hs-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-top: 0.35rem;
    border-top: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .hs-svc[data-level='error'] { color: var(--error); }

  .hs-reason {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--warn);
  }

  .compact .hs-metrics { grid-template-columns: repeat(2, 1fr); }

  @media (max-width: 560px) {
    .hs-metrics { grid-template-columns: repeat(2, 1fr); }
  }
</style>
