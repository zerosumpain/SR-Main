<script lang="ts">
  // TtftScatter — five consecutive calls in one turn, plotted as prompt size against time
  // to first token. The obvious explanation for the outlier (a long prompt) is visibly
  // wrong: the slowest call had a prompt the same size as the two fastest.
  import { TTFT_TRACE } from '../../lib/models';

  let hover = $state<number | null>(null);

  const W = 620, H = 210;
  const PADL = 46, PADR = 14, PADT = 12, PADB = 34;
  const xs = TTFT_TRACE.map((d) => d.promptTokens);
  const xMin = 17_000, xMax = 23_000;
  const yMax = 60;

  const px = (tok: number) => PADL + ((tok - xMin) / (xMax - xMin)) * (W - PADL - PADR);
  const py = (s: number) => H - PADB - (s / yMax) * (H - PADT - PADB);

  const active = $derived(hover !== null ? TTFT_TRACE[hover] : null);
  const outlier = TTFT_TRACE.reduce((a, b) => (b.ttft > a.ttft ? b : a));
</script>

<div class="ts">
  <div class="ts-head">
    <span class="k">Five consecutive calls · one turn · same model id</span>
    <p>Each dot is one call. Across is how much prompt it was given; up is how long before the first character
      appeared. If prompt size drove latency, these would form a line.</p>
  </div>

  <svg viewBox="0 0 {W} {H}" role="img"
    aria-label="Scatter plot of five calls. Prompt sizes cluster between eighteen and twenty-two thousand tokens while time to first token ranges from 1.5 to 52.9 seconds, with the slowest call having the same prompt size as the fastest.">
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

    <!-- points -->
    {#each TTFT_TRACE as d, i}
      <g class="pt" class:hot={d.ttft > 20} class:on={hover === i}
         role="button" tabindex="0"
         aria-label="Call {d.call}: {d.promptTokens.toLocaleString()} prompt tokens, first token after {d.ttft} seconds"
         onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}
         onfocus={() => (hover = i)} onblur={() => (hover = null)}>
        <circle cx={px(d.promptTokens)} cy={py(d.ttft)} r={hover === i ? 8 : 6} />
        <text x={px(d.promptTokens)} y={py(d.ttft) - 11} text-anchor="middle" class="ptlab">{d.ttft}s</text>
      </g>
    {/each}
  </svg>

  <div class="ts-read">
    {#if active}
      <b>Call {active.call}</b>
      <span>{active.promptTokens.toLocaleString()} prompt tokens · first token after {active.ttft}s</span>
    {:else}
      <b>The outlier</b>
      <span>Call {outlier.call} took {outlier.ttft}s on a {outlier.promptTokens.toLocaleString()}-token prompt —
        the same size as the two calls that took 1.5s. It was not the prompt. It was which seller answered.</span>
    {/if}
  </div>

  <p class="ts-foot">
    The measurable tell is <b>same-size prompts with an order-of-magnitude spread</b>. That pattern means the variable
    is the seller, not your input. After sorting sellers by latency, the worst first-token time on this task fell from
    <b>52.9s to 7.6s</b>, and wall clock for the whole task from <b>97s to 48s</b> — from one routing preference, with
    no change to a single prompt.
  </p>
</div>

<style>
  .ts { border: 1px solid rgba(28,22,17,0.16); border-radius: var(--radius-round); background: rgba(255,255,255,0.45); padding: 14px 16px; margin: 14px 0; }
  .ts-head .k { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-ink); }
  .ts-head p { margin: 5px 0 8px; font-size: 13px; line-height: 1.55; color: rgba(28,22,17,0.74); max-width: 78ch; }
  svg { display: block; width: 100%; height: auto; max-width: 640px; }
  .ax { stroke: rgba(28,22,17,0.3); stroke-width: 1; }
  .grid { stroke: rgba(28,22,17,0.09); stroke-width: 1; }
  .tick { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; fill: rgba(28,22,17,0.5); }
  .axlab { font-family: 'JetBrains Mono', monospace; font-size: 8px; letter-spacing: 0.12em; fill: rgba(28,22,17,0.42); }
  .pt { cursor: pointer; }
  .pt circle { fill: var(--accent-ink); transition: r 0.12s; }
  .pt.hot circle { fill: #c44; }
  .pt.on circle { stroke: rgba(28,22,17,0.4); stroke-width: 1.5; }
  .ptlab { font-family: 'JetBrains Mono', monospace; font-size: 9px; fill: rgba(28,22,17,0.6); }
  .pt.hot .ptlab { fill: #c44; font-weight: 600; }
  .pt:focus { outline: none; }
  .pt:focus-visible circle { stroke: var(--accent); stroke-width: 2.5; }

  .ts-read { margin-top: 8px; padding: 9px 13px; border-radius: var(--radius-round); background: var(--accent-ink-tint-12);
    border: 1px solid rgba(14,91,102,0.2); display: flex; gap: 9px; align-items: baseline; flex-wrap: wrap; min-height: 40px; }
  .ts-read b { font-family: 'Fraunces', serif; font-size: 14px; color: var(--text-primary); }
  .ts-read span { font-size: 12.5px; line-height: 1.5; color: rgba(28,22,17,0.74); flex: 1 1 240px; }
  .ts-foot { margin: 10px 0 0; font-size: 11.5px; line-height: 1.55; color: rgba(28,22,17,0.58); max-width: 92ch; }
  .ts-foot b { color: rgba(28,22,17,0.82); }
</style>
