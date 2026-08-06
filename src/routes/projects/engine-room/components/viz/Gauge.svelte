<script lang="ts">
  // Gauge — one accumulating value against a decision threshold. Used wherever the story is
  // "evidence adds up until it crosses a line": entity matching, risk scoring, budgets.
  interface Props {
    value: number;
    threshold: number;
    max?: number;
    label?: string;
    /** Text shown when the value is at or above the threshold. */
    overLabel?: string;
    underLabel?: string;
    /** Render the value as a percentage rather than a raw number. */
    asPercent?: boolean;
    decimals?: number;
  }
  let { value, threshold, max = 1, label, overLabel = 'over the line', underLabel = 'below the line',
        asPercent = false, decimals = 2 }: Props = $props();

  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const vPct = $derived(clamp(value / max) * 100);
  const tPct = $derived(clamp(threshold / max) * 100);
  const over = $derived(value >= threshold);
  const shown = $derived(asPercent ? `${Math.round(value * 100)}%` : value.toFixed(decimals));
</script>

<div class="gauge" class:over>
  <div class="g-top">
    {#if label}<span class="g-lab">{label}</span>{/if}
    <b class="g-val">{shown}</b>
    <span class="g-state">{over ? overLabel : underLabel}</span>
  </div>
  <div class="g-track" role="img"
       aria-label="{label ?? 'Score'} {shown} against a threshold of {asPercent ? Math.round(threshold * 100) + '%' : threshold.toFixed(decimals)}. {over ? overLabel : underLabel}.">
    <div class="g-fill" style="width:{vPct}%"></div>
    <div class="g-line" style="left:{tPct}%"></div>
  </div>
  <div class="g-scale">
    <span>0</span>
    <span class="g-tlab" style="left:{tPct}%">{asPercent ? `${Math.round(threshold * 100)}%` : threshold.toFixed(decimals)}</span>
    <span>{asPercent ? '100%' : max}</span>
  </div>
</div>

<style>
  .gauge { display: flex; flex-direction: column; gap: 5px; }
  .g-top { display: flex; align-items: baseline; gap: 9px; flex-wrap: wrap; }
  .g-lab { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; letter-spacing: 0.1em;
    text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .g-val { font-family: 'JetBrains Mono', monospace; font-size: 26px; font-weight: 600; line-height: 1;
    color: var(--text-primary); letter-spacing: -0.02em; }
  .g-state { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.06em;
    text-transform: uppercase; padding: 2px 8px; border-radius: var(--radius-pill);
    color: var(--accent-ink); background: rgba(14,91,102,0.14); margin-left: auto; }
  .over .g-state { color: #2d7a3a; background: rgba(45,122,58,0.16); }

  .g-track { position: relative; height: 16px; background: rgba(28,22,17,0.07);
    border-radius: var(--radius-round); overflow: hidden; }
  .g-fill { position: absolute; inset: 0 auto 0 0; background: var(--accent-ink); opacity: 0.75;
    transition: width 0.4s cubic-bezier(0.3,0,0.2,1); }
  .over .g-fill { background: #2d7a3a; }
  .g-line { position: absolute; top: -3px; bottom: -3px; width: 0; border-left: 2px dashed rgba(28,22,17,0.7); }

  .g-scale { position: relative; display: flex; justify-content: space-between;
    font-family: 'JetBrains Mono', monospace; font-size: 9px; color: rgba(28,22,17,0.45); }
  .g-tlab { position: absolute; transform: translateX(-50%); color: rgba(28,22,17,0.72); }
</style>
