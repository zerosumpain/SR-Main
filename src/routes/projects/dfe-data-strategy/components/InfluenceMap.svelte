<script lang="ts">
  import { STRATEGIES, TIER_META, KIND_META, type StrategyItem } from '../lib/strategies';
  import { app } from '../lib/appState.svelte';

  let hovered = $state<string | null>(null);
  let selected = $state<string | null>(null); // click-to-pin (so the detail button is reachable)

  // plot geometry
  const W = 860, H = 580;
  const L = 60, R = 44, T = 38, B = 54;
  const px = (rel: number) => L + rel * (W - L - R);
  const py = (lev: number) => T + (1 - lev) * (H - T - B);
  const DIV_X = 0.66, DIV_Y = 0.64; // visual quadrant split

  const activeId = $derived(hovered ?? selected);
  const ordered = $derived([...STRATEGIES].sort((a, b) => (a.id === activeId ? 1 : b.id === activeId ? -1 : 0)));
  const hov = $derived(STRATEGIES.find((s) => s.id === activeId) ?? null);
  const r = (s: StrategyItem) => 6 + s.leverage * 6;
</script>

<div class="im">
  <svg viewBox="0 0 {W} {H}" width="100%" role="img" aria-label="Strategy influence map">
    <!-- quadrant tints -->
    <rect x={px(DIV_X)} y={T} width={W - R - px(DIV_X)} height={py(DIV_Y) - T} fill="rgba(138,45,58,0.06)" />
    <rect x={L} y={T} width={px(DIV_X) - L} height={py(DIV_Y) - T} fill="rgba(180,99,46,0.05)" />
    <rect x={px(DIV_X)} y={py(DIV_Y)} width={W - R - px(DIV_X)} height={H - B - py(DIV_Y)} fill="rgba(63,125,110,0.06)" />
    <rect x={L} y={py(DIV_Y)} width={px(DIV_X) - L} height={H - B - py(DIV_Y)} fill="rgba(28,22,17,0.03)" />
    <!-- divider lines -->
    <line x1={px(DIV_X)} y1={T} x2={px(DIV_X)} y2={H - B} stroke="rgba(28,22,17,0.16)" stroke-dasharray="2 4" />
    <line x1={L} y1={py(DIV_Y)} x2={W - R} y2={py(DIV_Y)} stroke="rgba(28,22,17,0.16)" stroke-dasharray="2 4" />
    <!-- frame -->
    <rect x={L} y={T} width={W - L - R} height={H - T - B} fill="none" stroke="rgba(28,22,17,0.18)" />

    <!-- quadrant labels -->
    <text x={W - R - 10} y={T + 18} text-anchor="end" class="q-lab" fill={TIER_META.shape.color}>SET THE COURSE</text>
    <text x={L + 10} y={T + 18} text-anchor="start" class="q-lab" fill={TIER_META.watch.color}>COMPLY &amp; WATCH</text>
    <text x={W - R - 10} y={H - B - 8} text-anchor="end" class="q-lab" fill={TIER_META.borrow.color}>BORROW FROM</text>
    <text x={L + 10} y={H - B - 8} text-anchor="start" class="q-lab" fill="rgba(28,22,17,0.45)">CONTEXT</text>

    <!-- axes -->
    <text x={(L + (W - R)) / 2} y={H - 14} text-anchor="middle" class="axis">Relevance to DfE →</text>
    <text x={16} y={(T + (H - B)) / 2} text-anchor="middle" class="axis" transform="rotate(-90 16 {(T + (H - B)) / 2})">How much it should shape the strategy →</text>

    <!-- bubbles -->
    {#each ordered as s (s.id)}
      {@const cx = px(s.relevance)}
      {@const cy = py(s.leverage)}
      {@const active = activeId === s.id}
      {@const labelLeft = s.relevance > 0.74}
      <g
        class="node"
        class:active
        role="button"
        tabindex="0"
        aria-label={s.name}
        onmouseenter={() => (hovered = s.id)}
        onmouseleave={() => (hovered = null)}
        onfocus={() => (hovered = s.id)}
        onblur={() => (hovered = null)}
        onclick={() => (selected = selected === s.id ? null : s.id)}
        onkeydown={(e) => { if (e.key === 'Enter') selected = selected === s.id ? null : s.id; }}
      >
        <circle {cx} {cy} r={active ? r(s) + 3 : r(s)} fill={TIER_META[s.tier].color} fill-opacity={active ? 0.95 : 0.78} stroke="#f1ead6" stroke-width="1.5" />
        {#if s.tier === 'shape' || active}
          <text x={labelLeft ? cx - r(s) - 6 : cx + r(s) + 6} y={cy + 3} text-anchor={labelLeft ? 'end' : 'start'} class="b-lab" class:active>{s.short}</text>
        {/if}
      </g>
    {/each}
  </svg>

  <!-- hover detail -->
  <div class="im-detail" class:show={!!hov}>
    {#if hov}
      <span class="d-chip" style="background:{KIND_META[hov.kind].color}">{KIND_META[hov.kind].label}</span>
      <span class="d-tier" style="color:{TIER_META[hov.tier].color}">{TIER_META[hov.tier].kicker}</span>
      <h4 class="d-name">{hov.name}</h4>
      <p class="d-take">{hov.take}</p>
      <p class="d-why"><b>For DfE:</b> {hov.whyDfE}</p>
      <div class="d-foot">
        <span class="d-status">{hov.status}</span>
        <button class="d-draft" onclick={() => app.openSuggest({ kind: 'strategy', id: hov.id, label: hov.short })}>✎ Draft policies</button>
      </div>
    {:else}
      <span class="d-hint">Hover a point for the verdict; <b>click to pin it</b>, then draft policies. Position = relevance to DfE (→) × how much it should shape the strategy (↑). Colour = verdict.</span>
    {/if}
  </div>

  <div class="im-legend">
    {#each Object.entries(TIER_META) as [k, m]}
      <span class="lg"><i style="background:{m.color}"></i>{m.label}</span>
    {/each}
  </div>
</div>

<style>
  .im { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(220px, 0.85fr); gap: 16px 22px; align-items: start; }
  svg { display: block; }
  .q-lab { font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.14em; font-weight: 600; opacity: 0.75; }
  .axis { font-family: 'JetBrains Mono', monospace; font-size: 10px; fill: rgba(28,22,17,0.5); letter-spacing: 0.05em; }
  .node { cursor: pointer; }
  .node circle { transition: r 0.12s ease, fill-opacity 0.12s ease; }
  .b-lab { font-family: 'DM Sans', sans-serif; font-size: 10.5px; fill: rgba(28,22,17,0.7); }
  .b-lab.active { font-weight: 600; fill: var(--ink, #1c1611); }
  .im-detail { align-self: center; border: 1px solid rgba(28,22,17,0.14); border-radius: 12px; background: rgba(255,255,255,0.55); padding: 14px 16px; min-height: 150px; }
  .im-detail.show { background: rgba(255,255,255,0.75); }
  .d-chip { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #fff; padding: 2px 7px; border-radius: 4px; }
  .d-tier { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; margin-left: 8px; font-weight: 600; }
  .d-name { margin: 8px 0 6px; font-family: 'Fraunces', serif; font-size: 17px; font-weight: 600; color: var(--ink); line-height: 1.15; }
  .d-take { margin: 0 0 8px; font-size: 13.5px; line-height: 1.5; color: var(--ink); font-style: italic; }
  .d-why { margin: 0 0 8px; font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.7); }
  .d-why b { color: var(--ink); }
  .d-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .d-status { font-family: 'JetBrains Mono', monospace; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(28,22,17,0.5); }
  .d-draft { font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: #8a2d3a; background: rgba(138,45,58,0.06); border: 1px solid rgba(138,45,58,0.35); border-radius: 6px; padding: 5px 9px; cursor: pointer; white-space: nowrap; }
  .d-draft:hover { background: rgba(138,45,58,0.14); }
  .d-hint { font-size: 12px; line-height: 1.5; color: rgba(28,22,17,0.55); }
  .im-legend { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 12px; }
  .lg { display: inline-flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-size: 9.5px; color: rgba(28,22,17,0.6); }
  .lg i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  @media (max-width: 860px) { .im { grid-template-columns: 1fr; } }
</style>
