<script lang="ts">
  import { onMount } from 'svelte';

  // Ambient "what is JKai doing right now" indicator, visible on every /jkai
  // page. Polls the cheap hub-status endpoint and only appears when there's
  // actually running work — otherwise it stays out of the way.
  type Activity = { runningJobs: number; currentStep: string | null; nextRun: string | null };
  let activity = $state<Activity | null>(null);

  onMount(() => {
    let alive = true;
    const poll = async () => {
      // Skip the fetch entirely while the tab is hidden — a backgrounded PWA
      // shouldn't hit the server 3x/min; visibilitychange refreshes on return.
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/jkai/hub-status');
        if (!r.ok || !alive) return;
        const s = await r.json();
        activity = s.activity as Activity;
      } catch {
        /* ignore — ambient */
      }
    };
    void poll();
    const iv = setInterval(poll, 20000);
    // Also refresh when the tab regains focus (cheap, feels live).
    const onVis = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  });

  const visible = $derived(!!activity && activity.runningJobs > 0);
  const label = $derived.by(() => {
    if (!activity) return '';
    const step = (activity.currentStep || 'working').replace(/_/g, ' ');
    const n = activity.runningJobs;
    return `${step}${n > 1 ? ` · ${n} jobs` : ''}`;
  });
</script>

{#if visible}
  <a class="as" href="/jkai" title="JKai is working — open chat">
    <span class="as-dot"></span>
    <span class="as-label">{label}</span>
  </a>
{/if}

<style>
  .as {
    position: fixed;
    top: max(10px, env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 160;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(70vw, 360px);
    padding: 5px 12px;
    background: var(--surface-elevated, var(--bg));
    border: 1px solid var(--card-border);
    border-radius: 100px;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    text-decoration: none;
    color: var(--text-muted);
    font-size: 12px;
  }
  .as-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent-ink, var(--accent, #c4570a));
    flex-shrink: 0;
    animation: as-pulse 1.4s ease-in-out infinite;
  }
  .as-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: capitalize; }
  @keyframes as-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  @media (prefers-reduced-motion: reduce) {
    .as-dot { animation: none; }
  }
</style>
