<script lang="ts">
  import MiniSparkline from './MiniSparkline.svelte';

  let { sparklines }: { sparklines: any[] } = $props();

  const labels: Record<string, string> = {
    recovery: 'Recovery',
    sleep: 'Sleep',
    heart_rate: 'Heart rate',
    strain: 'Strain',
  };
  const units: Record<string, string> = { recovery: '%', sleep: '%', heart_rate: 'bpm', strain: '' };

  function points(s: any) {
    return s.values.map((v: any) => ({ date: new Date(v.date), value: v.value }));
  }

  function trendArrow(t: string): string {
    return t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
  }
</script>

<section class="nm-sec ss">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">7-day signals</span>
    <span class="nm-sec-meta">{(sparklines || []).length} metrics</span>
  </div>

  <div class="ss-grid">
    {#each sparklines || [] as s}
      <div class="ss-cell">
        <div class="ss-row">
          <span class="ss-label">{labels[s.metric] || s.metric}</span>
          <span class="ss-trend">{trendArrow(s.trend)}</span>
        </div>
        <div class="ss-value-row">
          <span class="ss-value">{Math.round(s.current)}</span>
          {#if units[s.metric]}<span class="ss-unit">{units[s.metric]}</span>{/if}
        </div>
        <div class="ss-spark">
          <MiniSparkline points={points(s)} height={24} color="var(--text-muted)" />
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .ss { padding: 0.9rem 1.1rem 1rem; }
  .ss-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    border-top: 1px solid var(--card-border);
  }
  .ss-cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0.6rem 0.85rem 0.65rem;
    border-right: 1px solid var(--card-border);
    border-bottom: 1px solid var(--card-border);
    min-width: 0;
  }
  .ss-cell:nth-child(4n) { border-right: 0; }
  .ss-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--font-mono);
  }
  .ss-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .ss-trend { font-size: 11px; color: var(--text-ghost); }
  .ss-value-row {
    display: flex;
    align-items: baseline;
    gap: 3px;
    font-family: var(--font-mono);
  }
  .ss-value {
    font-size: 20px;
    font-weight: 400;
    color: var(--text-primary);
    line-height: 1;
  }
  .ss-unit { font-size: 10px; color: var(--text-ghost); }
  .ss-spark { margin-top: 2px; }

  @media (max-width: 640px) {
    .ss-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .ss-cell:nth-child(4n) { border-right: 1px solid var(--card-border); }
    .ss-cell:nth-child(2n) { border-right: 0; }
  }
</style>
