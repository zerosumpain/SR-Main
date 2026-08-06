<script lang="ts">
  // TtftScatter — the five measured calls, plotted as prompt size against time to first
  // token. The obvious explanation for the outlier (a long prompt) is visibly wrong: the
  // slowest call sits mid-range on size, and the largest prompt of the five was near-instant.
  //
  // Nothing here is asserted beyond TTFT_TRACE: the spreads are ratios computed from it, and
  // the outlier readout quotes the gap in tokens rather than calling two sizes "the same".
  import { TTFT_TRACE } from '../../../lib/models';

  let hover = $state<number | null>(null);

  const W = 620, H = 210;
  const PADL = 46, PADR = 14, PADT = 12, PADB = 34;
  const xMin = 17_000, xMax = 23_000;
  const yMax = 60;

  const px = (tok: number) => PADL + ((tok - xMin) / (xMax - xMin)) * (W - PADL - PADR);
  const py = (s: number) => H - PADB - (s / yMax) * (H - PADT - PADB);

  const active = $derived(hover !== null ? TTFT_TRACE[hover] : null);

  const outlier = TTFT_TRACE.reduce((a, b) => (b.ttft > a.ttft ? b : a));
  const quickest = TTFT_TRACE.reduce((a, b) => (b.ttft < a.ttft ? b : a));
  // The honest version of "same size": the gap between them, in tokens.
  const gap = outlier.promptTokens - quickest.promptTokens;

  const fmt = (n: number) => n.toLocaleString('en-GB');
</script>

<div class="ts">
  <div class="ts-head">
    <span class="k">Five measured calls · prompt size against first-token time</span>
  </div>

  <svg viewBox="0 0 {W} {H}" role="img"
    aria-label="Prompt tokens plotted against time to first token, five measured calls: {TTFT_TRACE
      .map((d) => `${fmt(d.promptTokens)} tokens, ${d.ttft} seconds`)
      .join('; ')}. The points form no line.">
    <!-- axes -->
    <line x1={PADL} y1={H - PADB} x2={W - PADR} y2={H - PADB} class="ax" />
    <line x1={PADL} y1={PADT} x2={PADL} y2={H - PADB} class="ax" />
    {#each [0, 15, 30, 45, 60] as g}
      <line x1={PADL} y1={py(g)} x2={W - PADR} y2={py(g)} class="grid" />
      <text x={PADL - 7} y={py(g) + 3.5} text-anchor="end" class="tick">{g}s</text>
    {/each}
    {#each [18, 20, 22] as k}
      <text x={px(k * 1000)} y={H - PADB + 15} text-anchor="middle" class="tick">{k}k</text>
    {/each}
    <text x={(W + PADL) / 2} y={H - 4} text-anchor="middle" class="axlab">PROMPT TOKENS</text>
    <text x="11" y={PADT + (H - PADT - PADB) / 2} text-anchor="middle" class="axlab"
          transform="rotate(-90 11 {PADT + (H - PADT - PADB) / 2})">FIRST TOKEN</text>

    <!-- points: decorative, because the svg's own label carries every value and the
         buttons below give the same readout to keyboard and screen readers -->
    {#each TTFT_TRACE as d, i}
      <g class="pt" class:hot={d.ttft > 20} class:on={hover === i} aria-hidden="true"
         onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}>
        <circle cx={px(d.promptTokens)} cy={py(d.ttft)} r={hover === i ? 8 : 6} />
        <text x={px(d.promptTokens)} y={py(d.ttft) - 11} text-anchor="middle" class="ptlab">{d.ttft}s</text>
      </g>
    {/each}
  </svg>

  <ul class="pts">
    {#each TTFT_TRACE as d, i (d.call)}
      <li>
        <button class="pt-btn" class:on={hover === i} aria-pressed={hover === i}
                onclick={() => (hover = hover === i ? null : i)}
                onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}>
          Call {d.call}
        </button>
      </li>
    {/each}
  </ul>

  <div class="ts-read" aria-live="polite">
    {#if active}
      <b>Call {active.call}</b>
      <span>{fmt(active.promptTokens)} prompt tokens · first token after {active.ttft}s</span>
    {:else}
      <b>The outlier</b>
      <span>Call {outlier.call} took {outlier.ttft}s on a {fmt(outlier.promptTokens)}-token prompt —
        {fmt(gap)} tokens more than a call that answered in {quickest.ttft}s.</span>
    {/if}
  </div>

</div>

<style>
  .ts { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .ts-head { margin-bottom: 8px; }
  .ts-head .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  svg { display: block; width: 100%; height: auto; max-width: 640px; }
  .ax { stroke: rgba(28,22,17,0.3); stroke-width: 1; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .tick { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: rgba(28,22,17,0.5); }
  .axlab { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.12em; fill: rgba(28,22,17,0.42); }
  .pt { cursor: pointer; }
  .pt circle { fill: var(--accent-ink); transition: r 0.12s; }
  .pt.hot circle { fill: var(--error); }
  .pt.on circle { stroke: rgba(28,22,17,0.4); stroke-width: 1.5; }
  .ptlab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.6); }
  .pt.hot .ptlab { fill: var(--error); font-weight: 600; }

  .pts { list-style: none; display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 0; padding: 0; }
  .pt-btn { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: rgba(28,22,17,0.7);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-pill); padding: 3px 9px; cursor: pointer; }
  .pt-btn:hover { border-color: rgba(28,22,17,0.4); color: var(--text-primary); }
  .pt-btn.on { background: var(--accent-ink); border-color: var(--accent-ink); color: #fff; }

  .ts-read { margin-top: 8px; padding: 9px 13px; border-radius: var(--radius-round); background: var(--accent-ink-tint-12);
    border: 1px solid rgba(14,91,102,0.2); display: flex; gap: 9px; align-items: baseline; flex-wrap: wrap; min-height: 40px; }
  .ts-read b { font-family: 'Fraunces', serif; font-size: 14px; color: var(--text-primary); }
  .ts-read span { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.74); flex: 1 1 240px; }
</style>
