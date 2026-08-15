<script lang="ts">
  // Scatter — two measured quantities plotted against each other, for killing a plausible
  // theory. Every use of this on the study is of the form "people assume x drives y; here
  // are the actual observations". Hovering a point names it.
  interface Point { x: number; y: number; label: string; note?: string; tone?: string }
  interface Props {
    points: Point[];
    xLabel: string;
    yLabel: string;
    xUnit?: string;
    yUnit?: string;
    height?: number;
    tone?: string;
    /** Draw a horizontal band showing the range of y — makes "no relationship" legible. */
    showYBand?: boolean;
  }
  let { points, xLabel, yLabel, xUnit = '', yUnit = '', height = 250, tone = 'var(--accent-ink)', showYBand = false }: Props = $props();

  const pad = { l: 46, r: 14, t: 12, b: 34 };
  const W = 520;
  const H = $derived(height);

  const xs = $derived(points.map((p) => p.x));
  const ys = $derived(points.map((p) => p.y));
  const bounds = $derived.by(() => {
    const nice = (lo: number, hi: number) => {
      if (hi === lo) return [lo * 0.9, hi * 1.1] as const;
      const pad10 = (hi - lo) * 0.12;
      return [Math.max(0, lo - pad10), hi + pad10] as const;
    };
    const [x0, x1] = nice(Math.min(...xs), Math.max(...xs));
    const [y0, y1] = nice(Math.min(...ys), Math.max(...ys));
    return { x0, x1, y0, y1 };
  });

  const px = (x: number) => pad.l + ((x - bounds.x0) / (bounds.x1 - bounds.x0 || 1)) * (W - pad.l - pad.r);
  const py = (y: number) => H - pad.b - ((y - bounds.y0) / (bounds.y1 - bounds.y0 || 1)) * (H - pad.t - pad.b);

  const ticks = (lo: number, hi: number) => [lo, (lo + hi) / 2, hi];
  const fmt = (n: number) => (n >= 1000 ? Math.round(n).toLocaleString('en-GB') : Number(n.toFixed(n < 10 ? 1 : 0)).toString());

  let hover = $state<string | null>(null);
  const hovered = $derived(points.find((p) => p.label === hover) ?? null);

  const yBand = $derived(showYBand ? { top: py(Math.max(...ys)), bot: py(Math.min(...ys)) } : null);
</script>

<div class="sc" style="--tone:{tone}">
  <svg viewBox="0 0 {W} {H}" role="img" preserveAspectRatio="xMidYMid meet"
       aria-label="{yLabel} plotted against {xLabel}. {points.map((p) => `${p.label}: ${fmt(p.x)}${xUnit}, ${fmt(p.y)}${yUnit}`).join('; ')}.">
    {#if yBand}
      <rect x={pad.l} y={yBand.top} width={W - pad.l - pad.r} height={Math.max(1, yBand.bot - yBand.top)}
            fill="var(--tone)" opacity="0.07" />
    {/if}

    <!-- axes -->
    <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="rgba(28,22,17,0.3)" stroke-width="1" />
    <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="rgba(28,22,17,0.3)" stroke-width="1" />

    {#each ticks(bounds.y0, bounds.y1) as t}
      <line x1={pad.l - 3} y1={py(t)} x2={W - pad.r} y2={py(t)} stroke="rgba(28,22,17,0.1)" stroke-width="1" />
      <text x={pad.l - 7} y={py(t) + 3.5} text-anchor="end" class="ax">{fmt(t)}</text>
    {/each}
    {#each ticks(bounds.x0, bounds.x1) as t}
      <text x={px(t)} y={H - pad.b + 14} text-anchor="middle" class="ax">{fmt(t)}</text>
    {/each}

    <text x={(W - pad.l) / 2 + pad.l} y={H - 4} text-anchor="middle" class="axl">{xLabel}{xUnit ? ` (${xUnit.trim()})` : ''}</text>
    <text x="11" y={pad.t + (H - pad.t - pad.b) / 2} class="axl"
          transform="rotate(-90 11 {pad.t + (H - pad.t - pad.b) / 2})" text-anchor="middle">{yLabel}{yUnit ? ` (${yUnit.trim()})` : ''}</text>

    {#each points as p (p.label)}
      <circle cx={px(p.x)} cy={py(p.y)} r={hover === p.label ? 8 : 6}
              fill={p.tone ?? 'var(--tone)'} opacity={hover && hover !== p.label ? 0.35 : 0.85}
              stroke="rgba(255,255,255,0.9)" stroke-width="1.5" class="pt" aria-hidden="true"
              onmouseenter={() => (hover = p.label)} onmouseleave={() => (hover = null)}>
        <title>{p.label} — {fmt(p.x)}{xUnit}, {fmt(p.y)}{yUnit}</title>
      </circle>
    {/each}
  </svg>

  <p class="read" aria-live="polite">
    {#if hovered}
      <b>{hovered.label}</b> — {fmt(hovered.x)}{xUnit}, {fmt(hovered.y)}{yUnit}{hovered.note ? `. ${hovered.note}` : ''}
    {:else}
      <span class="dim">Hover a point, or step through them below.</span>
    {/if}
  </p>

  <!-- Keyboard and screen-reader path to the same readout the hover gives. -->
  <ul class="pts">
    {#each points as p (p.label)}
      <li>
        <button class="pt-btn" class:on={hover === p.label}
                onclick={() => (hover = hover === p.label ? null : p.label)}
                onmouseenter={() => (hover = p.label)} onmouseleave={() => (hover = null)}>
          {p.label}
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .sc { display: flex; flex-direction: column; gap: 4px; }
  svg { width: 100%; height: auto; display: block; }
  .ax { font-family: var(--font-mono); font-size: var(--fs-label-xs); fill: rgba(28,22,17,0.5); }
  .axl { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: 0.06em;
    fill: rgba(28,22,17,0.6); text-transform: uppercase; }
  .pt { cursor: pointer; transition: r 0.12s, opacity 0.12s; }
  .read { margin: 0; min-height: 1.5em; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.78); }
  .read b { color: var(--text-primary); }
  .dim { color: rgba(28,22,17,0.45); }

  .pts { list-style: none; display: flex; flex-wrap: wrap; gap: 5px; margin: 2px 0 0; padding: 0; }
  .pt-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.7);
    background: rgba(255,255,255,0.6); border: 1px solid rgba(28,22,17,0.18);
    border-radius: var(--radius-pill); padding: 3px 9px; cursor: pointer; }
  .pt-btn:hover { border-color: rgba(28,22,17,0.4); color: var(--text-primary); }
  .pt-btn.on { background: var(--tone); border-color: var(--tone); color: #fff; }
</style>
