<script lang="ts">
  import type { HealthDay } from '$lib/health/series-30d-service';
  import {
    clamp,
    ramp,
    neutralRamp,
    rampGradient,
    neutralGradient,
    dayLabel,
    pulseBaseline,
    pulseExtent,
    divergingPosition,
    sequentialPosition,
    pulseTone,
    pulsePeakIndex,
    PULSE_DIRECTION,
    type PulseRowKey,
  } from './utils';

  let {
    series,
    /** Cap on a tile's edge, so a very wide column does not stretch the grid
     *  into a slab. Drives the wrapper's max-width, which keeps tiles square. */
    maxTilePx = 30,
  }: { series: HealthDay[]; maxTilePx?: number } = $props();

  type RowDef = {
    key: PulseRowKey;
    name: string;
    meta: string;
    raw: (d: HealthDay) => number;
    display: (v: number) => string;
  };

  const ROW_DEFS: RowDef[] = [
    { key: 'rec', name: 'RECOVERY', meta: 'whoop · %', raw: (d) => d.rec, display: (v) => `${Math.round(v)}%` },
    { key: 'hrv', name: 'HRV', meta: 'ms · 5d ema', raw: (d) => d.hrv, display: (v) => `${Math.round(v)}ms` },
    { key: 'rhr', name: 'RESTING HR', meta: 'bpm', raw: (d) => d.rhr, display: (v) => `${Math.round(v)}bpm` },
    { key: 'slept', name: 'SLEEP', meta: 'hours', raw: (d) => d.slept, display: (v) => `${v.toFixed(1)}h` },
    { key: 'strain', name: 'STRAIN', meta: 'whoop · 0–21', raw: (d) => d.strain, display: (v) => v.toFixed(1) },
    { key: 'steps', name: 'STEPS', meta: 'count', raw: (d) => d.steps, display: (v) => `${(v / 1000).toFixed(1)}k` },
    { key: 'weight', name: 'WEIGHT', meta: 'kg · no direction', raw: (d) => d.weight, display: (v) => `${v.toFixed(1)}kg` },
  ];

  const hasWeight = $derived(series.some((d) => d.weight > 0));
  const labels = $derived(series.map((d) => dayLabel(d.date)));
  const lastIndex = $derived(series.length - 1);

  type Cell = {
    /** '' when the day has no data — the tile renders as a hatch instead. */
    color: string;
    missing: boolean;
    aria: string;
    value: string;
    /** A week starts in the gutter to this cell's LEFT. */
    weekStart: boolean;
  };

  type RowView = {
    key: PulseRowKey;
    name: string;
    meta: string;
    neutral: boolean;
    now: string;
    range: string;
    peak: number;
    cells: Cell[];
  };

  const rows = $derived.by((): RowView[] =>
    ROW_DEFS.filter((def) => def.key !== 'weight' || hasWeight).map((def) => {
      const direction = PULSE_DIRECTION[def.key];
      const neutral = direction === 'neutral';
      const values = series.map((d) => def.raw(d));

      // Midpoint is this row's OWN median over the window and the scale is a
      // robust spread — no hard-coded magic range anywhere below.
      const baseline = pulseBaseline(values);
      const extent = pulseExtent(values);

      // Neutral rows have no direction of good, so they get no "best day".
      const peak = neutral ? -1 : pulsePeakIndex(def.key, values);

      // `neutral` is a boolean, which cannot narrow `direction`, so pin the
      // diverging direction once rather than re-deriving it per cell.
      const divDir = direction === 'lower-is-better' ? 'lower-is-better' : 'higher-is-better';

      const cells: Cell[] = values.map((v, i) => {
        const pos = neutral ? sequentialPosition(v, extent) : divergingPosition(v, baseline, divDir);
        const l = labels[i];
        const value = pos === null ? 'no data' : def.display(v);
        const tone = pulseTone(pos, direction);
        const marks = [i === lastIndex ? 'today' : '', peak === i ? 'best day in window' : '']
          .filter(Boolean)
          .join(' · ');
        return {
          color: pos === null ? '' : neutral ? neutralRamp(pos) : ramp(pos),
          missing: pos === null,
          value,
          aria: `${l.mon} ${l.dom} · ${def.name} ${value}${tone ? ` · ${tone}` : ''}${marks ? ` · ${marks}` : ''}`,
          weekStart: i > 0 && l.dowIndex === 1,
        };
      });

      const todayVal = values[lastIndex] ?? 0;
      return {
        key: def.key,
        name: def.name,
        meta: def.meta,
        neutral,
        now: todayVal > 0 ? def.display(todayVal) : '—',
        range: extent.n ? `${def.display(extent.min)}–${def.display(extent.max)}` : 'no data',
        peak,
        cells,
      };
    }),
  );

  const divergingRamp = rampGradient();
  const sequentialRamp = neutralGradient();

  type Tip = { x: number; y: number; day: string; metric: string; val: string; range: string };
  let tip = $state<Tip | null>(null);
  let wrap: HTMLDivElement | null = $state(null);

  function showTip(e: MouseEvent | FocusEvent, row: RowView, i: number) {
    if (!wrap) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wrapR = wrap.getBoundingClientRect();
    const l = labels[i];
    tip = {
      // Already wrapper-relative: the label column is inside `wrapR`, so there
      // is nothing to add back. Clamped so the bubble cannot leave the frame.
      x: clamp(r.left - wrapR.left + r.width / 2, 92, Math.max(92, wrapR.width - 92)),
      y: r.top - wrapR.top,
      day: `${l.dom} ${l.mon}`,
      metric: row.name,
      val: row.cells[i].value,
      range: row.range,
    };
  }
  function hideTip() {
    tip = null;
  }
</script>

<div
  class="h-pulsegrid-wrap"
  bind:this={wrap}
  style="--cols: {Math.max(1, series.length)}; --tile-cap: {maxTilePx}px;"
>
  {#each rows as row (row.key)}
    <div class="h-pg-rowlabel">
      <span class="h-pg-label-head">
        <span class="h-pg-row-name">{row.name}</span>
        <span class="h-pg-row-now">{row.now}</span>
      </span>
      <span class="h-pg-row-meta">{row.meta}</span>
    </div>
    <div class="h-pg-row">
      {#each row.cells as cell, i (i)}
        <button
          type="button"
          class="h-pg-cell"
          class:missing={cell.missing}
          class:peak={row.peak === i}
          class:weekstart={cell.weekStart}
          style={cell.missing ? undefined : `--c: ${cell.color}`}
          aria-label={cell.aria}
          onmouseenter={(e) => showTip(e, row, i)}
          onmouseleave={hideTip}
          onfocus={(e) => showTip(e, row, i)}
          onblur={hideTip}
        ></button>
      {/each}
    </div>
  {/each}

  <div class="h-pg-rowlabel h-pg-rowlabel-axis">
    <span class="h-pg-row-meta">{series.length} DAYS →</span>
  </div>
  <div class="h-pg-axis">
    {#each labels as l, i (i)}
      <div
        class="h-pg-axis-cell"
        class:today={i === lastIndex}
        class:weekstart={i > 0 && l.dowIndex === 1}
      >
        {i === 0 || i === lastIndex || (l.dowIndex === 1 && i > 1 && i < lastIndex - 1) ? l.dom : ''}
      </div>
    {/each}
  </div>

  <div class="h-pg-legend">
    <span class="h-pg-legend-scale">
      <span class="h-pg-legend-ramp" style="background: {divergingRamp}" aria-hidden="true"></span>
      <span class="h-pg-legend-ticks">
        <span class="h-pg-tick-lo">WORSE</span>
        <span class="h-pg-tick-mid">BASELINE</span>
        <span class="h-pg-tick-hi">BETTER</span>
      </span>
    </span>
    <span class="h-pg-legend-key">
      <span class="h-pg-legend-ring" aria-hidden="true"></span>best day
    </span>
    <span class="h-pg-legend-key">
      <span class="h-pg-legend-missing" aria-hidden="true"></span>no data
    </span>
    {#if hasWeight}
      <span class="h-pg-legend-key">
        <span class="h-pg-legend-swatch" style="background: {sequentialRamp}" aria-hidden="true"></span>weight ·
        no direction of good
      </span>
    {/if}
    <span class="h-pg-legend-note">
      baseline = that row's own {series.length}-day median · scale = robust spread
    </span>
  </div>

  {#if tip}
    <div class="h-tip" style="left: {tip.x}px; top: {tip.y}px;">
      <span class="h-tip-line"><span class="h-tip-key">{tip.day}</span>{tip.metric}</span>
      <span class="h-tip-val">{tip.val}</span>
      <span class="h-tip-range">range {tip.range}</span>
    </div>
  {/if}
</div>

<style>
  .h-pulsegrid-wrap {
    --label-w: 132px;
    position: relative;
    display: grid;
    grid-template-columns: var(--label-w) minmax(0, 1fr);
    gap: 0;
    border: 2px solid var(--line-strong);
    /* The gutter between tiles. Deeper than the baseline neutral so an
       at-baseline tile still reads as a tile rather than as empty ground. */
    background: var(--surface-rail);
    width: 100%;
    /* Cap the tile size instead of letting a wide column stretch the grid. */
    max-width: min(100%, calc(var(--label-w) + var(--cols) * (var(--tile-cap) + 2px)));
  }
  @media (max-width: 900px) {
    .h-pulsegrid-wrap {
      --label-w: 96px;
    }
    .h-pg-row-meta {
      display: none;
    }
    .h-pg-label-head {
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
    }
    .h-pg-rowlabel {
      padding: 6px 8px;
    }
  }
  @media (max-width: 520px) {
    .h-pulsegrid-wrap {
      --label-w: 78px;
    }
    .h-pg-rowlabel {
      padding: 5px 6px;
    }
    .h-pg-row-name {
      letter-spacing: 0.04em;
    }
  }

  .h-pg-rowlabel {
    padding: 8px 12px;
    background: var(--surface-shell);
    border-right: 1px solid var(--line);
    border-bottom: 1px solid var(--line-hair);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
  }
  /* The axis strip closes the grid, so its label carries no rule beneath it.
     (The old `.h-pg-row:last-of-type` rule never matched anything — the last
     child of the wrapper is the legend — so it is gone rather than "fixed".) */
  .h-pg-rowlabel-axis {
    border-bottom: none;
  }
  .h-pg-label-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .h-pg-row-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-primary);
    min-width: 0;
  }
  /* Today's actual value, right-aligned in mono — the grid shows the shape, the
     label shows the number. */
  .h-pg-row-now {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    /* Deliberately NOT the petrol pole — today's number is a reading, not a
       verdict, and petrol already means "better" everywhere else in here. */
    color: var(--text-primary);
    white-space: nowrap;
  }
  .h-pg-row-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }

  .h-pg-row {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    column-gap: 2px;
    /* 1px top + 1px bottom on adjacent rows = the same 2px gutter as the
       columns, so the whole field is one consistent grid. */
    padding: 1px 2px;
    min-width: 0;
  }
  .h-pg-cell {
    aspect-ratio: 1 / 1;
    max-height: var(--tile-cap);
    position: relative;
    min-width: 0;
    cursor: pointer;
    transition: filter 0.12s;
    background: var(--c, transparent);
    padding: 0;
    border: none;
    border-radius: 0;
    font: inherit;
    color: inherit;
  }
  .h-pg-cell.missing {
    background: repeating-linear-gradient(
      45deg,
      var(--surface-shell) 0 3px,
      rgba(26, 16, 8, 0.11) 3px 4px
    );
  }
  .h-pg-cell:hover {
    filter: brightness(0.9);
  }
  .h-pg-cell:focus-visible {
    outline: 2px solid var(--text-primary);
    outline-offset: 1px;
    z-index: 5;
  }
  /* Week rule, drawn INTO the gutter so it does not shift a tile. Consecutive
     rows' rules meet across the 1px row padding, giving one countable line. */
  .h-pg-cell.weekstart::before,
  .h-pg-axis-cell.weekstart::before {
    content: '';
    position: absolute;
    left: -2px;
    top: -1px;
    bottom: -1px;
    width: 2px;
    background: var(--line-strong);
    pointer-events: none;
  }
  .h-pg-cell.peak {
    z-index: 2;
  }
  /* The best day in the row. Three-pixel ink ring with a cream keyline inside
     it, so it reads as strongly against a light green cell as against a dark
     red one — a single-weight border disappeared on the pale end of both arms. */
  .h-pg-cell.peak::after {
    content: '';
    position: absolute;
    inset: -1px;
    border: 3px solid var(--text-primary);
    outline: 1px solid var(--bg);
    outline-offset: -4px;
    pointer-events: none;
    z-index: 3;
  }

  .h-pg-axis {
    display: grid;
    grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    column-gap: 2px;
    padding: 0 2px;
    border-top: 1px solid var(--line-hair);
    background: var(--surface-shell);
    min-width: 0;
  }
  .h-pg-axis-cell {
    position: relative;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-ghost);
    text-align: center;
    padding: 6px 0;
    min-width: 0;
  }
  /* Today is marked on the axis, not by tinting the tile — a wash over the
     cell would corrupt the one thing the colour is supposed to say. */
  .h-pg-axis-cell.today {
    color: var(--text-primary);
  }
  .h-pg-axis-cell.today::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 2px;
    background: var(--accent);
  }

  .h-pg-legend {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    padding: 9px 12px;
    border-top: 1px solid var(--line);
    background: var(--surface-shell);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-ghost);
  }
  .h-pg-legend-scale {
    display: inline-flex;
    flex-direction: column;
    gap: 3px;
    min-width: 204px;
  }
  /* Generated from `ramp()` itself — there is no second copy of the palette. */
  .h-pg-legend-ramp {
    display: block;
    width: 100%;
    height: 9px;
    border: 1px solid var(--line-hair);
  }
  .h-pg-legend-ticks {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .h-pg-tick-lo {
    text-align: left;
    color: var(--trend-down);
  }
  .h-pg-tick-mid {
    text-align: center;
    color: var(--text-muted);
  }
  .h-pg-tick-hi {
    text-align: right;
    color: var(--accent-ink);
  }
  .h-pg-legend-key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .h-pg-legend-note {
    color: var(--text-ghost);
    letter-spacing: 0.06em;
    text-transform: none;
  }
  .h-pg-legend-ring {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 2px solid var(--text-primary);
  }
  .h-pg-legend-missing {
    display: inline-block;
    width: 11px;
    height: 11px;
    background: repeating-linear-gradient(
      45deg,
      var(--surface-shell) 0 3px,
      rgba(26, 16, 8, 0.11) 3px 4px
    );
    border: 1px solid var(--line-hair);
  }
  .h-pg-legend-swatch {
    display: inline-block;
    width: 34px;
    height: 11px;
    border: 1px solid var(--line-hair);
  }

  .h-tip {
    position: absolute;
    pointer-events: none;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: var(--text-primary);
    color: var(--bg);
    padding: 7px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    white-space: nowrap;
    transform: translate(-50%, calc(-100% - 6px));
    border: 1px solid var(--line-hair);
  }
  .h-tip-line {
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .h-tip-key {
    color: color-mix(in srgb, var(--bg) 60%, transparent);
    margin-right: 7px;
  }
  .h-tip-val {
    color: var(--bg);
    font-weight: 500;
  }
  .h-tip-range {
    color: color-mix(in srgb, var(--bg) 55%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
</style>
