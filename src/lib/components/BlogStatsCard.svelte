<script lang="ts">
  type Stats = { pageviews: number; visitors: number } | null;
  type Daily = { date: string; count: number };
  type Referrer = { name: string; count: number };

  type Props = {
    stats30d: Stats;
    statsLifetime: Stats;
    daily: Daily[];
    referrers: Referrer[];
    available: boolean;
  };

  let { stats30d, statsLifetime, daily, referrers, available }: Props = $props();

  let max = $derived(Math.max(1, ...daily.map((d) => d.count)));
  let pathFor = (count: number, i: number) => {
    const x = (i / Math.max(1, daily.length - 1)) * 100;
    const y = 30 - (count / max) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  };
  let polyline = $derived(daily.map((d, i) => pathFor(d.count, i)).join(' '));
</script>

<section class="nm-sec stats-card">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Viewership</span>
    <span class="nm-sec-meta">last 30 days</span>
  </div>
  {#if !available}
    <div class="nm-empty">Stats unavailable.</div>
  {:else}
    <div class="kpis">
      <div class="kpi"><span class="n">{statsLifetime?.pageviews ?? '–'}</span><span class="l">views (lifetime)</span></div>
      <div class="kpi"><span class="n">{stats30d?.pageviews ?? '–'}</span><span class="l">views (30d)</span></div>
      <div class="kpi"><span class="n">{stats30d?.visitors ?? '–'}</span><span class="l">visitors (30d)</span></div>
    </div>
    {#if daily.length > 1}
      <svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={polyline} fill="none" stroke="currentColor" stroke-width="0.6" />
      </svg>
    {/if}
    {#if referrers.length}
      <ul class="refs">
        {#each referrers as r}
          <li><span class="r-name">{r.name}</span><span class="r-count">{r.count}</span></li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

<style>
  .kpis { display: flex; gap: 1.5rem; margin-bottom: 0.6rem; }
  .kpi { display: flex; flex-direction: column; }
  .kpi .n { font-family: var(--font-mono); font-size: 1.4rem; }
  .kpi .l { font-size: 0.72rem; color: var(--text-ghost); letter-spacing: 0.05em; text-transform: uppercase; }
  .spark { width: 100%; height: 40px; color: var(--accent); display: block; margin-bottom: 0.6rem; }
  .refs { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.2rem; }
  .refs li { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); }
  .r-count { color: var(--text-ghost); }
</style>
