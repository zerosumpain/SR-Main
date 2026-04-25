<script lang="ts">
  import MiniSparkline from './MiniSparkline.svelte';

  let { sparklines }: { sparklines: any[] } = $props();

  const labels: Record<string, string> = {
    recovery: 'Recovery', sleep: 'Sleep', heart_rate: 'Heart Rate', strain: 'Strain',
  };
  const units: Record<string, string> = { recovery: '%', sleep: '%', heart_rate: 'bpm', strain: '' };

  function points(s: any) {
    return s.values.map((v: any) => ({ date: new Date(v.date), value: v.value }));
  }
</script>

<section class="ss">
  <div class="ss-grid">
    {#each sparklines || [] as s}
      <div class="ss-cell nm-sec">
        <div class="ss-hd"><span class="sr-label-tight">{labels[s.metric] || s.metric}</span></div>
        <div class="ss-val">
          {Math.round(s.current)}<span class="ss-unit">{units[s.metric] || ''}</span>
        </div>
        <div class="ss-spark"><MiniSparkline points={points(s)} /></div>
        <div class="ss-trend">
          {s.trend === 'up' ? '↑' : s.trend === 'down' ? '↓' : '→'} 7d
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .ss { padding: 0 1.5rem; max-width: 1200px; margin: 0 auto; }
  .ss-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; }
  .ss-cell { padding: 0.85rem 1rem 0.75rem; gap: 0; }
  .ss-hd { margin-bottom: 0.5rem; padding-bottom: 0.4rem; border-bottom: 1px solid var(--card-border); }
  .ss-val {
    font-family: var(--font-display); font-size: 26px; font-weight: 300;
    color: var(--text-primary); line-height: 1;
  }
  .ss-unit { font-size: 11px; color: var(--text-ghost); margin-left: 4px; }
  .ss-spark { margin-top: 6px; }
  .ss-trend { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); margin-top: 6px; }
  @media (max-width: 768px) { .ss-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
