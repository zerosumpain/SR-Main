<script lang="ts">
  import type { ResolvedStat } from '../lib/types';

  let { stat }: { stat: ResolvedStat } = $props();

  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<div class="stat">
  <div class="top">
    {#if stat.live}
      <span class="tag live"><i></i>LIVE</span>
    {:else}
      <span class="tag snap" title="Live source unreachable — showing the last captured value">SNAPSHOT</span>
    {/if}
    <a class="api" href={stat.apiUrl} target="_blank" rel="noopener" title={stat.apiUrl}>{stat.api}</a>
  </div>

  <div class="num">{fmt(stat.value)}</div>
  <div class="label">{stat.label}</div>
  {#if stat.detail}<div class="detail">{stat.detail}</div>{/if}

  <div class="foot">
    <a class="src" href={stat.sourceUrl} target="_blank" rel="noopener">{stat.source} ↗</a>
    {#if !stat.live}<span class="asof">as of {stat.asOf}</span>{/if}
  </div>
</div>

<style>
  .stat {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 14px 15px 12px;
    background: rgba(255, 255, 255, 0.42);
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: 10px;
    min-width: 0;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 2px;
  }
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: 999px;
  }
  .tag.live {
    color: #c4570a;
    background: rgba(196, 87, 10, 0.1);
  }
  .tag.live i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #c4570a;
    box-shadow: 0 0 0 0 rgba(196, 87, 10, 0.5);
    animation: pulse 1.8s ease-out infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(196, 87, 10, 0.5); }
    70% { box-shadow: 0 0 0 6px rgba(196, 87, 10, 0); }
    100% { box-shadow: 0 0 0 0 rgba(196, 87, 10, 0); }
  }
  .tag.snap {
    color: rgba(28, 22, 17, 0.55);
    background: rgba(28, 22, 17, 0.07);
  }
  .api {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: rgba(28, 22, 17, 0.45);
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .api:hover {
    color: #c4570a;
  }
  .num {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(28px, 4.2vw, 38px);
    line-height: 1;
    letter-spacing: -0.02em;
    color: #1c1611;
    font-variant-numeric: tabular-nums;
  }
  .label {
    font-size: 12.5px;
    font-weight: 500;
    color: #1c1611;
    line-height: 1.25;
  }
  .detail {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: rgba(28, 22, 17, 0.58);
    line-height: 1.35;
  }
  .foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
  }
  .src {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.03em;
    color: rgba(28, 22, 17, 0.6);
    text-decoration: none;
    border-bottom: 1px dashed rgba(28, 22, 17, 0.28);
  }
  .src:hover {
    color: #c4570a;
    border-bottom-color: #c4570a;
  }
  .asof {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    color: rgba(28, 22, 17, 0.42);
    white-space: nowrap;
  }
</style>
