<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface LiveWalkState {
    active: boolean;
    routeName?: string;
    routeType?: 'hike' | 'cycle';
    status?: 'active' | 'paused' | 'finished';
    stats?: {
      distanceKm: number;
      durationMs: number;
      avgSpeedKmh: number;
      elevationGainM: number;
    };
    startedAt?: number;
    updatedAt?: number;
  }

  let state = $state<LiveWalkState>({ active: false });
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  onMount(() => {
    fetchState();
    pollInterval = setInterval(fetchState, 30000); // poll every 30s
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  async function fetchState() {
    try {
      const res = await fetch('/api/live-walk');
      if (res.ok) state = await res.json();
    } catch {
      // Silently ignore
    }
  }

  function formatDuration(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  function formatElapsed(startedAt: number): string {
    return formatDuration(Date.now() - startedAt);
  }

  let isActive = $derived(state.active && state.status !== 'finished');
</script>

{#if isActive}
  <div class="live-walk-banner">
    <div class="live-walk-indicator">
      <span class="live-dot"></span>
      <span class="live-label">ACTIVITY IN PROGRESS</span>
    </div>
    <div class="live-walk-info">
      <span class="live-walk-name">{state.routeName}</span>
      <div class="live-walk-stats">
        <span>{state.stats?.distanceKm.toFixed(1)} km</span>
        <span class="live-sep">&middot;</span>
        <span>{formatElapsed(state.startedAt!)}</span>
        <span class="live-sep">&middot;</span>
        <span>+{Math.round(state.stats?.elevationGainM ?? 0)}m</span>
      </div>
    </div>
    <a href="/live" class="live-walk-link" aria-label="View live activity">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
        <path d="M5 12h14M12 5l7 7-7 7"/>
      </svg>
    </a>
  </div>
{/if}

<style>
  .live-walk-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(61, 184, 122, 0.08);
    border: 1px solid rgba(61, 184, 122, 0.2);
    border-radius: 12px;
    margin-top: 16px;
  }

  .live-walk-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .live-dot {
    width: 8px;
    height: 8px;
    background: #3db87a;
    border-radius: 50%;
    animation: pulse-live 1.5s ease-in-out infinite;
    box-shadow: 0 0 8px rgba(61, 184, 122, 0.6);
  }

  @keyframes pulse-live {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  .live-label {
    font-family: 'Archivo Black', 'Outfit', system-ui, sans-serif;
    font-size: 10px;
    letter-spacing: 0.1em;
    color: #3db87a;
  }

  .live-walk-info {
    flex: 1;
    min-width: 0;
  }

  .live-walk-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary, #e8eaf0);
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .live-walk-stats {
    font-size: 11px;
    color: var(--text-secondary, #888);
    margin-top: 2px;
    display: flex;
    gap: 4px;
    font-family: 'JetBrains Mono', monospace;
  }

  .live-sep {
    opacity: 0.4;
  }

  .live-walk-link {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #3db87a;
    border-radius: 8px;
    transition: background 0.15s;
  }

  .live-walk-link:hover {
    background: rgba(61, 184, 122, 0.12);
  }
</style>
