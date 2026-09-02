<script lang="ts">
  /**
   * One card in the thread inspector's CONTEXT mode.
   *
   * Cards used to be raised tiles floating on the rail with an accent tab in the
   * corner — a third visual register in a column that already had two. They are
   * now cells in the same grammar as everything else in the inspector: mono
   * tracked title, hairline rule, flush to the column. The card's SHAPE is what
   * distinguishes it (figures, bars, a line, links, prose), not a frame around
   * it, and that is what lets five card types sit in one scroll without the
   * column looking like five different products.
   *
   * Figures are mono and tabular, not display-face. Archivo Black on a two-digit
   * number in a 390px column is an editorial gesture on an application surface,
   * and it broke alignment between adjacent metrics.
   */
  import { scaleLinear, scaleTime } from 'd3-scale';
  import { curveMonotoneX, line } from 'd3-shape';
  import type { ContextCard as Card } from '$lib/jkai/context-panel/types';

  let { card, onSelect }: { card: Card; onSelect?: (label: string, detail: string) => void } = $props();

  let width = $state(0);
  let selectedPoint = $state<{ label: string; detail: string } | null>(null);
  const height = 148;
  const pad = { left: 32, right: 10, top: 12, bottom: 23 };

  function measure(node: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  const chart = $derived.by(() => {
    if (card.type !== 'series') return null;
    const all = card.series
      .flatMap((s) => s.points.map((p) => ({ ...p, t: new Date(p.x) })))
      .filter((p) => Number.isFinite(+p.t));
    if (!all.length) return null;
    const xExtent = [Math.min(...all.map((p) => +p.t)), Math.max(...all.map((p) => +p.t))] as [number, number];
    const values = all.map((p) => p.y);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const yPad = Math.max(1, (hi - lo) * 0.08);
    const x = scaleTime()
      .domain(xExtent.map((n) => new Date(n)) as [Date, Date])
      .range([pad.left, Math.max(pad.left + 1, width - pad.right)]);
    const y = scaleLinear().domain([lo - yPad, hi + yPad]).nice().range([height - pad.bottom, pad.top]);
    const makeLine = line<{ x: string; y: number }>()
      .x((p) => x(new Date(p.x)))
      .y((p) => y(p.y))
      .curve(curveMonotoneX);
    return {
      x,
      y,
      paths: card.series.map((s) => ({ ...s, path: makeLine(s.points) ?? '' })),
      yTicks: y.ticks(3),
      xTicks: x.ticks(Math.max(2, Math.floor(width / 100))),
    };
  });

  function choose(label: string, detail: string) {
    selectedPoint = { label, detail };
  }
</script>

<section class="cd" use:measure>
  <header class="cd-hd">
    <div class="cd-hd-text">
      <h3 class="cd-title">{card.title}</h3>
      {#if card.subtitle}<p class="cd-sub">{card.subtitle}</p>{/if}
    </div>
    {#if card.href}
      <a class="cd-open" href={card.href} aria-label="Open {card.title}">open →</a>
    {/if}
  </header>

  {#if card.type === 'metrics'}
    <!-- Two columns, ruled rather than boxed. Every value is mono and tabular so
         the figures in the left column line up with those in the right. -->
    <div class="cd-metrics">
      {#each card.metrics as metric (metric.label)}
        <button
          type="button"
          class="mt"
          data-tone={metric.tone ?? 'default'}
          onclick={() => choose(metric.label, `${metric.label}: ${metric.value}${metric.detail ? ` — ${metric.detail}` : ''}`)}
        >
          <span class="mt-label">{metric.label}</span>
          <strong class="mt-val">{metric.value}</strong>
          {#if metric.detail}<small class="mt-detail">{metric.detail}</small>{/if}
        </button>
      {/each}
    </div>

  {:else if card.type === 'bars'}
    {@const max = Math.max(1, ...card.rows.map((row) => row.value))}
    <!-- Label and figure on the line, bar beneath it at full width. A bar that
         has to share its line with a label and a number is too short in a 390px
         column to be comparable, and an incomparable bar is decoration. -->
    <div class="cd-rows">
      {#each card.rows as row (row.id)}
        <button
          type="button"
          class="br"
          onclick={() => choose(row.label, `${row.label}: ${row.display ?? row.value}`)}
        >
          <span class="br-label">{row.label}</span>
          <strong class="br-val">{row.display ?? row.value}</strong>
          <span class="br-track" aria-hidden="true">
            <span class="br-fill" style="width:{Math.round((row.value / max) * 100)}%"></span>
          </span>
        </button>
      {/each}
    </div>

  {:else if card.type === 'links'}
    <div class="cd-rows">
      {#each card.rows as row (row.id)}
        <div class="lk">
          <button
            type="button"
            class="lk-main"
            onclick={() => choose(row.label, [row.label, row.meta, row.note].filter(Boolean).join(' — '))}
          >
            <span class="lk-label">{row.label}</span>
            {#if row.meta}<small class="lk-meta">{row.meta}</small>{/if}
          </button>
          {#if row.href}
            <a class="lk-go" href={row.href} aria-label="Open {row.label}">→</a>
          {/if}
        </div>
      {/each}
    </div>

  {:else if card.type === 'series'}
    {#if chart}
      <svg class="cd-chart" viewBox="0 0 {Math.max(width, 240)} {height}" role="img" aria-label={card.title}>
        {#each chart.yTicks as tick (tick)}
          <line x1={pad.left} x2={Math.max(pad.left, width - pad.right)} y1={chart.y(tick)} y2={chart.y(tick)} class="grid" />
          <text x={pad.left - 5} y={chart.y(tick) + 3} text-anchor="end">{tick}</text>
        {/each}
        {#each chart.xTicks as tick (+tick)}
          <text x={chart.x(tick)} y={height - 5} text-anchor="middle">
            {tick.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </text>
        {/each}
        {#each chart.paths as series (series.key)}
          <path d={series.path} fill="none" stroke={series.colour ?? 'var(--accent)'} stroke-width="2" />
          {#each series.points as point (`${series.key}:${point.x}`)}
            <circle
              cx={chart.x(new Date(point.x))}
              cy={chart.y(point.y)}
              r="5"
              fill="transparent"
              stroke="transparent"
              tabindex="0"
              role="button"
              aria-label="{series.label}, {point.x}: {point.y} {card.unit ?? ''}"
              onclick={() => choose(`${series.label} on ${point.x}`, `${series.label}: ${point.y}${card.unit ? ` ${card.unit}` : ''} on ${point.x}`)}
              onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') choose(`${series.label} on ${point.x}`, `${series.label}: ${point.y}${card.unit ? ` ${card.unit}` : ''} on ${point.x}`); }}
            />
          {/each}
        {/each}
      </svg>
      <div class="cd-legend">
        {#each card.series as series (series.key)}
          <span><i style="background:{series.colour ?? 'var(--accent)'}"></i>{series.label}</span>
        {/each}
      </div>
    {:else}
      <p class="cd-note">No measured points in this window.</p>
    {/if}

  {:else}
    <p class="cd-note" class:warn={card.tone === 'warn'}>{card.body}</p>
  {/if}

  {#if selectedPoint}
    <!-- The bridge back into the conversation: the panel is only worth reading
         if what you find in it can become the next question. -->
    <div class="cd-sel">
      <span class="cd-sel-text">{selectedPoint.detail}</span>
      <button type="button" class="cd-sel-go" onclick={() => onSelect?.(selectedPoint!.label, selectedPoint!.detail)}>
        ask about this →
      </button>
    </div>
  {/if}
</section>

<style>
  /* A card is a cell, not a tile: flush to the column, ruled off from the next
     one, sitting on the panel's own paper. */
  .cd {
    position: relative;
    min-width: 0;
    border-bottom: 1px solid var(--line-hair);
    background: var(--bg);
  }

  .cd-hd {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    padding: 12px 15px 9px;
  }
  .cd-hd-text {
    min-width: 0;
  }
  .cd-title {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    line-height: 1.25;
    color: var(--text-secondary);
  }
  .cd-sub {
    margin: 4px 0 0;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    color: var(--text-muted);
  }
  .cd-open {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    white-space: nowrap;
  }
  .cd-open:hover {
    color: var(--accent-hover);
  }

  /* ── Metrics ─────────────────────────────────────────────────────────── */
  .cd-metrics {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-top: 1px solid var(--line-hair);
  }
  .mt {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    min-height: 66px;
    padding: 9px 15px 11px;
    border: none;
    border-right: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease-out;
  }
  .mt:hover {
    background: var(--surface-sunken);
  }
  .mt:nth-child(even) {
    border-right: none;
  }
  /* The last row's rule would double up with the card's own. */
  .mt:nth-last-child(-n + 2):nth-child(odd),
  .mt:last-child {
    border-bottom: none;
  }
  .mt-label,
  .mt-detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mt-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .mt-val {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-num-md);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .mt[data-tone='good'] .mt-val { color: var(--success); }
  .mt[data-tone='warn'] .mt-val { color: var(--warn); }
  .mt[data-tone='bad'] .mt-val { color: var(--error); }
  .mt-detail {
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  /* ── Rows shared by bars and links ───────────────────────────────────── */
  .cd-rows {
    padding: 0 15px 11px;
  }

  .br {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 0 8px;
    width: 100%;
    padding: 6px 6px 7px;
    margin: 0 -6px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease-out;
  }
  .br:hover {
    background: var(--surface-sunken);
  }
  .br-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .br:hover .br-label {
    color: var(--text-primary);
  }
  .br-val {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .br-track {
    grid-column: 1 / -1;
    display: block;
    height: 3px;
    margin-top: 5px;
    background: rgba(26, 16, 8, 0.08);
  }
  /* Petrol, not burnt-orange. A bars card draws seven or eight of these at once
     and orange is the panel's state colour — seven orange bars spend the one
     hue that means "live or selected" on ordinary data. The graph's own topic
     bars keep their per-node colour because there it carries provenance; here
     there is nothing for a hue to say. */
  .br-fill {
    display: block;
    height: 100%;
    background: var(--accent-ink);
  }

  .lk {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-left: 2px solid var(--line-hair);
    margin: 0 -6px;
    padding-left: 6px;
    transition: border-color 0.15s ease-out, background 0.15s ease-out;
  }
  .lk:hover {
    border-left-color: var(--accent);
    background: var(--surface-sunken);
  }
  .lk-main {
    min-width: 0;
    padding: 7px 4px 8px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
  }
  .lk-label,
  .lk-meta {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lk-label {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .lk:hover .lk-label {
    color: var(--text-primary);
  }
  .lk-meta {
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .lk-go {
    flex: none;
    padding-right: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    text-decoration: none;
  }
  .lk-go:hover {
    color: var(--accent-hover);
  }

  /* ── Series ──────────────────────────────────────────────────────────── */
  .cd-chart {
    display: block;
    width: 100%;
    height: 148px;
    overflow: visible;
  }
  .cd-chart text {
    fill: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
  }
  .cd-chart .grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .cd-chart circle:focus {
    stroke: var(--accent);
    fill: var(--bg);
    outline: none;
  }
  .cd-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 13px;
    padding: 0 15px 11px 32px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .cd-legend span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .cd-legend i {
    width: 12px;
    height: 2px;
    flex: none;
  }

  /* ── Note ────────────────────────────────────────────────────────────── */
  .cd-note {
    margin: 0;
    padding: 0 15px 13px;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.55;
    color: var(--text-muted);
  }
  .cd-note.warn {
    border-left: 3px solid var(--warn);
    margin: 0 15px 13px;
    padding: 0 0 0 10px;
    color: var(--warn);
  }

  /* ── Selection ───────────────────────────────────────────────────────── */
  .cd-sel {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 9px;
    padding: 8px 15px 9px;
    border-top: 1px solid var(--line-hair);
    background: var(--accent-tint-08);
  }
  .cd-sel-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-body);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
  }
  .cd-sel-go {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .cd-sel-go:hover {
    color: var(--accent-hover);
  }

  @media (max-width: 799px) {
    .br,
    .lk-main {
      padding-top: 9px;
      padding-bottom: 10px;
    }
  }
</style>
