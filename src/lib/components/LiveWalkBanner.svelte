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
    pollInterval = setInterval(fetchState, 30000);
  });

  onDestroy(() => {
    if (pollInterval) clearInterval(pollInterval);
  });

  async function fetchState() {
    try {
      const res = await fetch('/api/live-walk');
      if (res.ok) state = await res.json();
    } catch {}
  }

  function formatElapsed(startedAt: number): string {
    const ms = Date.now() - startedAt;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  }

  let isActive = $derived(state.active && state.status !== 'finished');
</script>

<a href="/live" class="live-banner" style="display: {isActive ? 'inline-flex' : 'none'}">
  <span class="live-dot"></span>
  <span class="live-text">LIVE</span>
  <span class="live-sep">/</span>
  <span class="live-detail">{state.routeName ?? 'Activity'}</span>
  <span class="live-sep">/</span>
  <span class="live-detail">{state.stats?.distanceKm?.toFixed(1) ?? '0'} km</span>
  <span class="live-sep">/</span>
  <span class="live-detail">{state.startedAt ? formatElapsed(state.startedAt) : '--'}</span>
  <span class="live-sep">/</span>
  <span class="live-detail">+{Math.round(state.stats?.elevationGainM ?? 0)}m</span>
  <span class="live-arrow">&#x2192;</span>
</a>

<style>
  .live-banner {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-radius: 100px;
    background: rgba(196, 87, 10, 0.08);
    border: 1px solid rgba(196, 87, 10, 0.2);
    text-decoration: none;
    color: var(--text-primary, #e8eaf0);
    font-size: 11px;
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.02em;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
  }

  .live-banner:hover {
    background: rgba(196, 87, 10, 0.14);
    border-color: rgba(196, 87, 10, 0.35);
  }

  .live-dot {
    width: 6px;
    height: 6px;
    background: var(--accent, #c4570a);
    border-radius: 50%;
    animation: pulse-dot 1.5s ease-in-out infinite;
    box-shadow: 0 0 6px rgba(196, 87, 10, 0.5);
    flex-shrink: 0;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }

  .live-text {
    font-weight: 700;
    color: var(--accent, #c4570a);
    letter-spacing: 0.1em;
  }

  .live-sep {
    color: var(--text-ghost, #555);
    opacity: 0.4;
  }

  .live-detail {
    color: var(--text-secondary, #999);
  }

  .live-arrow {
    color: var(--accent, #c4570a);
    opacity: 0.6;
  }
</style>
