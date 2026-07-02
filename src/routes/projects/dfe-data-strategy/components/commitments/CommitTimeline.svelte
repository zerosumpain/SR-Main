<script lang="ts">
  import { ledger } from '../../lib/commitmentsFilter.svelte';
  import { THEME_META, THEME_ORDER, STATUS_META } from '../../lib/commitments';
  import CommitList from './CommitList.svelte';
  import type { Commitment, CommitmentStatus } from '../../lib/types';

  // the delivery wall: when the commitments land, lane per theme, glyph per status
  const START = 2024 * 12; // months since year 0
  const END = 2031 * 12;
  const monthsOf = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    return y * 12 + (m - 1);
  };
  const NOW = monthsOf('2026-07');

  const dated = $derived(ledger.filtered.filter((c) => c.timeframeDate));
  const undated = $derived(ledger.filtered.filter((c) => !c.timeframeDate));
  const lanes = $derived(THEME_ORDER.filter((t) => dated.some((c) => c.theme === t)));

  const W = 980;
  const PAD_L = 118;
  const PAD_R = 16;
  const LANE_H = 40;
  const PAD_T = 26;
  const PAD_B = 8;
  const H = $derived(PAD_T + lanes.length * LANE_H + PAD_B);
  const x = (months: number) => PAD_L + ((months - START) / (END - START)) * (W - PAD_L - PAD_R);
  const years = Array.from({ length: 8 }, (_, i) => 2024 + i);

  // stagger overlapping points within a lane
  const plotted = $derived.by(() => {
    const out: { c: Commitment; cx: number; cy: number }[] = [];
    for (let li = 0; li < lanes.length; li++) {
      const inLane = dated
        .filter((c) => c.theme === lanes[li])
        .sort((a, b) => (a.timeframeDate! < b.timeframeDate! ? -1 : 1));
      const seen: Record<string, number> = {};
      for (const c of inLane) {
        const bucket = c.timeframeDate!.slice(0, 7);
        const n = (seen[bucket] = (seen[bucket] ?? 0) + 1);
        const cy = PAD_T + li * LANE_H + LANE_H / 2 + ((n - 1) % 3) * 10 - (n > 1 ? 10 : 0);
        out.push({ c, cx: x(monthsOf(c.timeframeDate!)), cy });
      }
    }
    return out;
  });

  let tip = $state<{ x: number; y: number; c: Commitment } | null>(null);

  const GLYPHS: { status: CommitmentStatus; label: string }[] = [
    { status: 'statutory-duty', label: STATUS_META['statutory-duty'].label },
    { status: 'legislated-not-commenced', label: STATUS_META['legislated-not-commenced'].label },
    { status: 'in-delivery', label: STATUS_META['in-delivery'].label },
    { status: 'announced', label: STATUS_META.announced.label },
    { status: 'proposed', label: STATUS_META.proposed.label },
    { status: 'consulting', label: STATUS_META.consulting.label },
  ];
</script>

{#snippet glyph(status: CommitmentStatus, cx: number, cy: number, color: string)}
  {#if status === 'statutory-duty'}
    <path d="M {cx} {cy - 6} L {cx + 5.5} {cy + 4.5} L {cx - 5.5} {cy + 4.5} Z" fill={color} stroke="#fdfaf2" stroke-width="1.5" />
  {:else if status === 'legislated-not-commenced'}
    <path d="M {cx} {cy - 6} L {cx + 6} {cy} L {cx} {cy + 6} L {cx - 6} {cy} Z" fill={color} stroke="#fdfaf2" stroke-width="1.5" />
  {:else if status === 'in-delivery'}
    <circle {cx} {cy} r="5" fill={color} stroke="#fdfaf2" stroke-width="1.5" />
  {:else if status === 'announced'}
    <circle {cx} {cy} r="4.5" fill="#fdfaf2" stroke={color} stroke-width="2" />
  {:else if status === 'proposed'}
    <rect x={cx - 4} y={cy - 4} width="8" height="8" fill="#fdfaf2" stroke={color} stroke-width="2" rx="1.5" />
  {:else}
    <rect x={cx - 4} y={cy - 4} width="8" height="8" fill="#fdfaf2" stroke={color} stroke-width="2" stroke-dasharray="3 2" rx="1.5" />
  {/if}
{/snippet}

<div class="tl">
  {#if !dated.length}
    <p class="none">Nothing with a date matches the current filters{undated.length ? ` — ${undated.length} undated below` : ''}.</p>
  {:else}
    <div class="legend">
      {#each GLYPHS as g}
        <span class="lg">
          <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true">{@render glyph(g.status, 8, 7, '#55606b')}</svg>
          {STATUS_META[g.status].short}
        </span>
      {/each}
      <span class="lg-note">lane = theme · position = when it must land</span>
    </div>
    <div class="svg-wrap">
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Commitments plotted by delivery date and theme">
        <!-- year grid -->
        {#each years as y}
          <line x1={x(y * 12)} y1={PAD_T - 12} x2={x(y * 12)} y2={H - PAD_B} stroke="rgba(28,22,17,0.1)" stroke-width="1" />
          <text x={x(y * 12) + 4} y={PAD_T - 14} class="tick">{y}</text>
        {/each}
        <!-- today -->
        <line x1={x(NOW)} y1={PAD_T - 12} x2={x(NOW)} y2={H - PAD_B} stroke="#8a2d3a" stroke-width="1.5" stroke-dasharray="4 3" />
        <text x={x(NOW) + 4} y={PAD_T - 2} class="tick today">today</text>
        <!-- lanes -->
        {#each lanes as t, i}
          <rect x="0" y={PAD_T + i * LANE_H} width={W} height={LANE_H} fill={i % 2 ? 'rgba(28,22,17,0.025)' : 'transparent'} />
          <text x="8" y={PAD_T + i * LANE_H + LANE_H / 2 + 3.5} class="lane" fill={THEME_META[t].color}>{THEME_META[t].label}</text>
        {/each}
        <!-- points -->
        {#each plotted as p (p.c.id)}
          <g
            class="pt"
            role="button"
            tabindex="0"
            aria-label={p.c.title}
            onclick={() => ledger.select(p.c.id)}
            onkeydown={(e) => e.key === 'Enter' && ledger.select(p.c.id)}
            onmouseenter={() => (tip = { x: p.cx, y: p.cy, c: p.c })}
            onmouseleave={() => (tip = null)}
          >
            <circle cx={p.cx} cy={p.cy} r="11" fill="transparent" />
            {@render glyph(p.c.status, p.cx, p.cy, THEME_META[p.c.theme].color)}
          </g>
        {/each}
      </svg>
      {#if tip}
        <div class="tip" style="left:{(tip.x / W) * 100}%; top:{(tip.y / H) * 100}%">
          <b>{tip.c.title}</b>
          <span>{tip.c.timeframe ?? tip.c.timeframeDate} · {STATUS_META[tip.c.status].label}</span>
        </div>
      {/if}
    </div>
  {/if}

  {#if undated.length}
    <h3 class="list-h">No date attached ({undated.length}) — commitments without a public timeline</h3>
    <CommitList items={undated} dense />
  {/if}
</div>

<style>
  .none {
    margin: 0 0 12px;
    font-size: 12.5px;
    color: rgba(28, 22, 17, 0.55);
    padding: 14px;
    border: 1px dashed rgba(28, 22, 17, 0.2);
    border-radius: var(--radius-round);
    text-align: center;
  }
  .legend {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.65);
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .lg-note {
    margin-left: auto;
    color: rgba(28, 22, 17, 0.45);
  }
  .svg-wrap {
    position: relative;
    border: 1px solid rgba(28, 22, 17, 0.14);
    border-radius: var(--radius-round);
    background: #fdfaf2;
    padding: 6px 4px;
    overflow-x: auto;
  }
  .svg-wrap > svg {
    display: block;
    width: 100%;
    min-width: 720px;
    height: auto;
  }
  .lg svg {
    flex: none;
  }
  .tick {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    fill: rgba(28, 22, 17, 0.5);
  }
  .tick.today {
    fill: #8a2d3a;
  }
  .lane {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    font-weight: 600;
  }
  .pt {
    cursor: pointer;
  }
  .pt:hover {
    opacity: 0.85;
  }
  .tip {
    position: absolute;
    transform: translate(-50%, -130%);
    background: var(--ink, #1c1611);
    color: #f1ead6;
    border-radius: var(--radius-round);
    padding: 7px 11px;
    max-width: 300px;
    pointer-events: none;
    z-index: 5;
  }
  .tip b {
    display: block;
    font-size: 12px;
    line-height: 1.35;
  }
  .tip span {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    opacity: 0.75;
  }
  .list-h {
    margin: 18px 0 9px;
    font-family: 'Fraunces', serif;
    font-size: 15.5px;
    font-weight: 600;
    color: var(--ink);
  }
</style>
