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
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  onMount(() => {
    void fetchState();
    const onVisibility = () => {
      if (document.hidden) {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
      } else {
        void fetchState();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });

  onDestroy(() => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
  });

  async function fetchState() {
    try {
      const res = await fetch('/api/live-walk');
      if (res.ok) state = await res.json();
    } catch {
      // keep the last known state; the next scheduled read retries
    } finally {
      if (!stopped && !document.hidden) {
        // A live walk needs a responsive banner; an absent walk changes rarely.
        pollTimer = setTimeout(fetchState, state.active ? 15_000 : 120_000);
      }
    }
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
    border-radius: var(--radius-pill);
    background: var(--accent-tint-08);
    border: 1px solid var(--accent-tint-20);
    text-decoration: none;
    color: var(--text-primary);
    font-size: var(--fs-label-xs);
    font-family: var(--font-mono, monospace);
    letter-spacing: 0.02em;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s;
  }

  .live-banner:hover {
    background: var(--accent-tint-14);
    border-color: var(--accent-tint-35);
  }

  .live-dot {
    width: 6px;
    height: 6px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse-dot 1.5s ease-in-out infinite;
    box-shadow: var(--accent-glow);
    flex-shrink: 0;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }

  .live-text {
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.1em;
  }

  .live-sep {
    color: var(--text-ghost);
    opacity: 0.4;
  }

  .live-detail {
    color: var(--text-secondary);
  }

  .live-arrow {
    color: var(--accent);
    opacity: 0.6;
  }
</style>
