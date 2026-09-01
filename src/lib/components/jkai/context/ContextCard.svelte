<script lang="ts">
  import { scaleLinear, scaleTime } from 'd3-scale';
  import { curveMonotoneX, line } from 'd3-shape';
  import type { ContextCard as Card } from '$lib/jkai/context-panel/types';

  let { card, onSelect }: { card: Card; onSelect?: (label: string, detail: string) => void } = $props();
  let width = $state(0);
  let selectedPoint = $state<{ label: string; detail: string } | null>(null);
  const height = 148;
  const pad = { left: 30, right: 10, top: 12, bottom: 23 };

  function measure(node: HTMLElement) {
    const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  const chart = $derived.by(() => {
    if (card.type !== 'series') return null;
    const all = card.series.flatMap((s) => s.points.map((p) => ({ ...p, t: new Date(p.x) }))).filter((p) => Number.isFinite(+p.t));
    if (!all.length) return null;
    const xExtent = [Math.min(...all.map((p) => +p.t)), Math.max(...all.map((p) => +p.t))] as [number, number];
    const values = all.map((p) => p.y);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const yPad = Math.max(1, (hi - lo) * 0.08);
    const x = scaleTime().domain(xExtent.map((n) => new Date(n)) as [Date, Date]).range([pad.left, Math.max(pad.left + 1, width - pad.right)]);
    const y = scaleLinear().domain([lo - yPad, hi + yPad]).nice().range([height - pad.bottom, pad.top]);
    const makeLine = line<{ x: string; y: number }>().x((p) => x(new Date(p.x))).y((p) => y(p.y)).curve(curveMonotoneX);
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

<section class="ctx-card" use:measure>
  <header>
    <div>
      <h3>{card.title}</h3>
      {#if card.subtitle}<p>{card.subtitle}</p>{/if}
    </div>
    {#if card.href}<a href={card.href} aria-label="Open {card.title}">open →</a>{/if}
  </header>

  {#if card.type === 'metrics'}
    <div class="metrics">
      {#each card.metrics as metric (metric.label)}
        <button type="button" class="metric" class:good={metric.tone === 'good'} class:warn={metric.tone === 'warn'} class:bad={metric.tone === 'bad'} onclick={() => choose(metric.label, `${metric.label}: ${metric.value}${metric.detail ? ` — ${metric.detail}` : ''}`)}>
          <span>{metric.label}</span><strong>{metric.value}</strong>{#if metric.detail}<small>{metric.detail}</small>{/if}
        </button>
      {/each}
    </div>
  {:else if card.type === 'bars'}
    {@const max = Math.max(1, ...card.rows.map((row) => row.value))}
    <div class="bars">
      {#each card.rows as row (row.id)}
        <button type="button" class="bar-row" onclick={() => choose(row.label, `${row.label}: ${row.display ?? row.value}`)}>
          <span class="bar-label">{row.label}</span><span class="bar-track"><span style="width:{Math.round((row.value / max) * 100)}%"></span></span><strong>{row.display ?? row.value}</strong>
        </button>
      {/each}
    </div>
  {:else if card.type === 'links'}
    <div class="links">
      {#each card.rows as row (row.id)}
        <div class="link-row">
          <button type="button" onclick={() => choose(row.label, [row.label, row.meta, row.note].filter(Boolean).join(' — '))}>
            <span>{row.label}</span>{#if row.meta}<small>{row.meta}</small>{/if}
          </button>
          {#if row.href}<a href={row.href} aria-label="Open {row.label}">→</a>{/if}
        </div>
      {/each}
    </div>
  {:else if card.type === 'series'}
    {#if chart}
      <svg class="series-chart" viewBox="0 0 {Math.max(width, 240)} {height}" role="img" aria-label={card.title}>
        {#each chart.yTicks as tick (tick)}
          <line x1={pad.left} x2={Math.max(pad.left, width - pad.right)} y1={chart.y(tick)} y2={chart.y(tick)} class="grid" />
          <text x={pad.left - 4} y={chart.y(tick) + 3} text-anchor="end">{tick}</text>
        {/each}
        {#each chart.xTicks as tick (+tick)}
          <text x={chart.x(tick)} y={height - 5} text-anchor="middle">{tick.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>
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
      <div class="legend">{#each card.series as series (series.key)}<span><i style="background:{series.colour ?? 'var(--accent)'}"></i>{series.label}</span>{/each}</div>
    {:else}<p class="empty">No measured points in this window.</p>{/if}
  {:else}
    <p class:warn-note={card.tone === 'warn'} class="note">{card.body}</p>
  {/if}

  {#if selectedPoint}
    <div class="selection"><span>{selectedPoint.detail}</span><button type="button" onclick={() => onSelect?.(selectedPoint!.label, selectedPoint!.detail)}>ask about this →</button></div>
  {/if}
</section>

<style>
  .ctx-card { position:relative; border:1px solid var(--line-strong); background:var(--surface-card); min-width:0; }
  .ctx-card::before { content:''; position:absolute; z-index:1; inset:-1px auto auto -1px; width:42px; height:3px; background:var(--accent); }
  header { display:flex; justify-content:space-between; gap:10px; padding:15px 13px 10px; border-bottom:1px solid var(--line-hair); }
  h3 { margin:0; color:var(--text-primary); font-family:var(--font-display); font-size:var(--fs-body-sm); font-weight:400; letter-spacing:-.01em; text-transform:uppercase; }
  header p { margin:3px 0 0; color:var(--text-muted); font-size:var(--fs-label-xs); line-height:1.35; }
  header a, .link-row > a { color:var(--accent); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-decoration:none; white-space:nowrap; }
  .metrics { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); }
  .metric { min-width:0; min-height:76px; padding:10px 11px; text-align:left; border:0; border-right:1px solid var(--line-hair); border-bottom:1px solid var(--line-hair); background:none; color:var(--text); cursor:pointer; }
  .metric:nth-child(even) { border-right:0; }
  .metric span, .metric small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .metric span { color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.08em; }
  .metric strong { display:block; margin-top:4px; color:var(--text-primary); font-family:var(--font-display); font-size:var(--fs-display-xs); font-weight:400; font-variant-numeric:tabular-nums; letter-spacing:-.03em; }
  .metric small { margin-top:2px; color:var(--text-muted); font-size:var(--fs-label-xs); }
  .metric.good strong { color:var(--success); } .metric.warn strong { color:var(--warn); } .metric.bad strong { color:var(--error); }
  button:hover { background:var(--surface-overlay); }
  .bars, .links { padding:5px 0; }
  .bar-row { width:100%; display:grid; grid-template-columns:minmax(72px,1fr) 70px auto; align-items:center; gap:8px; padding:7px 10px; border:0; background:none; color:var(--text); cursor:pointer; text-align:left; }
  .bar-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--fs-body-sm); }
  .bar-track { height:4px; background:var(--surface-sunken); } .bar-track span { display:block; height:100%; background:var(--accent); }
  .bar-row strong { color:var(--text-muted); font-family:var(--font-mono); font-size:var(--fs-label-xs); font-weight:500; }
  .link-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; padding-right:11px; }
  .link-row button { min-width:0; padding:8px 11px; border:0; background:none; text-align:left; color:var(--text); cursor:pointer; }
  .link-row button span, .link-row button small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .link-row button span { font-size:var(--fs-body-sm); } .link-row button small { color:var(--text-muted); font-family:var(--font-mono); font-size:var(--fs-label-xs); margin-top:2px; }
  .series-chart { display:block; width:100%; height:148px; overflow:visible; }
  .series-chart text { fill:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); }
  .series-chart .grid { stroke:var(--line-hair); stroke-width:1; }
  .series-chart circle:focus { stroke:var(--accent); fill:var(--surface-card); outline:none; }
  .legend { display:flex; gap:12px; padding:0 10px 9px 31px; color:var(--text-muted); font-size:var(--fs-label-xs); }
  .legend span { display:flex; align-items:center; gap:4px; } .legend i { width:12px; height:2px; }
  .note, .empty { margin:0; padding:13px; color:var(--text-muted); font-size:var(--fs-body-sm); line-height:1.5; }
  .warn-note { color:var(--warn); }
  .selection { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; border-top:1px solid var(--line-hair); background:var(--accent-tint-08); }
  .selection span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-muted); font-size:var(--fs-label-xs); }
  .selection button { flex:none; border:0; background:none; color:var(--accent); font-family:var(--font-mono); font-size:var(--fs-label-xs); cursor:pointer; }
</style>
