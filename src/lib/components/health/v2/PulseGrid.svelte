<script lang="ts">
  import type { HealthDay } from '$lib/health/series-30d-service';
  import { clamp, ramp, dayLabel, pulsePeakIndex, type PulseRowKey } from './utils';

  let { series }: { series: HealthDay[] } = $props();

  type Row = {
    key: PulseRowKey;
    name: string;
    meta: string;
    f: (d: HealthDay) => number;
    raw: (d: HealthDay) => number;
    display: (d: HealthDay) => string;
  };

  const rows: Row[] = [
    {
      key: 'rec',
      name: 'RECOVERY',
      meta: 'Whoop · %',
      f: (d) => d.rec / 100,
      raw: (d) => d.rec,
      display: (d) => `${d.rec}%`,
    },
    {
      key: 'hrv',
      name: 'HRV',
      meta: 'ms · 5d ema',
      f: (d) => clamp((d.hrv - 25) / 50, 0, 1),
      raw: (d) => d.hrv,
      display: (d) => `${d.hrv}ms`,
    },
    {
      key: 'rhr',
      name: 'RESTING HR',
      meta: 'bpm · inv',
      f: (d) => clamp(1 - (d.rhr - 50) / 22, 0, 1),
      raw: (d) => d.rhr,
      display: (d) => `${d.rhr}bpm`,
    },
    {
      key: 'slept',
      name: 'SLEEP',
      meta: 'hours',
      f: (d) => clamp((d.slept - 5) / 4, 0, 1),
      raw: (d) => d.slept,
      display: (d) => `${d.slept.toFixed(1)}h`,
    },
    {
      key: 'strain',
      name: 'STRAIN',
      meta: '0–21',
      f: (d) => clamp(d.strain / 21, 0, 1),
      raw: (d) => d.strain,
      display: (d) => d.strain.toFixed(1),
    },
    {
      key: 'steps',
      name: 'STEPS',
      meta: 'count · k',
      f: (d) => clamp(d.steps / 16000, 0, 1),
      raw: (d) => d.steps,
      display: (d) => `${(d.steps / 1000).toFixed(1)}k`,
    },
  ];

  const labels = $derived(series.map((d) => dayLabel(d.date)));
  const lastIndex = $derived(series.length - 1);

  // Peak ranks on raw values per metric (max for everything except RHR, which
  // wins on min). Today is eligible — when today is the peak, its cream tint
  // and the black ring render together.
  const peaks = $derived(
    rows.map((r) =>
      pulsePeakIndex(
        r.key,
        series.map((d) => r.raw(d)),
      ),
    ),
  );

  let tip = $state<{ x: number; y: number; label: string; val: string; metric: string } | null>(null);
  let wrap: HTMLDivElement | null = $state(null);

  function showTip(e: MouseEvent | FocusEvent, rowName: string, displayVal: string, idx: number) {
    if (!wrap) return;
    const target = e.currentTarget as HTMLElement;
    const r = target.getBoundingClientRect();
    const wrapR = wrap.getBoundingClientRect();
    const lbl = labels[idx];
    tip = {
      x: r.left - wrapR.left + r.width / 2,
      y: r.top - wrapR.top,
      label: `${lbl.dom} ${lbl.mon}`,
      val: displayVal,
      metric: rowName,
    };
  }
  function hideTip() {
    tip = null;
  }
</script>

<div class="h-pulsegrid-wrap" bind:this={wrap}>
  {#each rows as row, rowIdx (row.key)}
    <div class="h-pg-rowlabel">
      <p class="h-pg-row-name">{row.name}</p>
      <p class="h-pg-row-meta">{row.meta}</p>
    </div>
    <div class="h-pg-row">
      {#each series as d, i (i)}
        {@const v = row.f(d)}
        {@const isToday = i === lastIndex}
        {@const isPeak = peaks[rowIdx] === i && peaks[rowIdx] !== -1}
        {@const display = row.display(d)}
        <button
          type="button"
          class="h-pg-cell"
          class:today={isToday}
          class:peak={isPeak}
          style="--c: {ramp(v)}"
          aria-label="{labels[i].mon} {labels[i].dom} · {row.name} {display}{isToday
            ? ' · today'
            : ''}{isPeak ? ' · row peak' : ''}"
          onmouseenter={(e) => showTip(e, row.name, display, i)}
          onmouseleave={hideTip}
          onfocus={(e) => showTip(e, row.name, display, i)}
          onblur={hideTip}
        >
          {#if isToday}<span class="h-pg-today-tint" aria-hidden="true"></span>{/if}
        </button>
      {/each}
    </div>
  {/each}
  <div class="h-pg-rowlabel h-pg-rowlabel-axis">
    <p class="h-pg-row-meta">30 DAYS →</p>
  </div>
  <div class="h-pg-axis">
    {#each labels as l, i (i)}
      <div class="h-pg-axis-cell">
        {i === 0 || l.dom === 1 || i === lastIndex || i % 7 === 0 ? l.dom : ''}
      </div>
    {/each}
  </div>

  {#if tip}
    <div class="h-tip" style="left: {tip.x + 110}px; top: {tip.y}px;">
      <span class="h-tip-key">{tip.label}</span>
      <span class="h-tip-val">{tip.metric} {tip.val}</span>
    </div>
  {/if}
</div>

<style>
  .h-pulsegrid-wrap {
    position: relative;
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 0;
    border: 2px solid var(--card-border);
    background: rgba(26, 16, 8, 0.03);
    width: 100%;
    max-width: 100%;
  }
  @media (max-width: 900px) {
    .h-pulsegrid-wrap {
      grid-template-columns: 76px minmax(0, 1fr);
    }
    .h-pg-row-meta {
      display: none;
    }
    .h-pg-rowlabel {
      padding: 8px 8px;
    }
    .h-pg-row-name {
      font-size: 9px;
      letter-spacing: 0.1em;
    }
  }
  @media (max-width: 520px) {
    .h-pulsegrid-wrap {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .h-pg-rowlabel {
      padding: 6px 6px;
    }
    .h-pg-row-name {
      font-size: 8px;
      letter-spacing: 0.05em;
    }
  }
  .h-pg-rowlabel {
    padding: 10px 14px;
    border-right: 1px solid var(--divider);
    border-bottom: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
  }
  .h-pg-rowlabel-axis {
    border-bottom: none;
  }
  .h-pg-row-name {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-primary);
    margin: 0;
  }
  .h-pg-row-meta {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin: 0;
  }
  .h-pg-rowlabel-axis .h-pg-row-meta {
    color: var(--text-ghost);
  }
  .h-pg-row {
    display: grid;
    grid-template-columns: repeat(30, minmax(0, 1fr));
    gap: 0;
    border-bottom: 1px solid var(--divider);
    min-width: 0;
  }
  .h-pg-row:last-of-type {
    border-bottom: none;
  }
  .h-pg-cell {
    aspect-ratio: 1 / 1;
    border-right: 1px solid rgba(26, 16, 8, 0.05);
    position: relative;
    cursor: pointer;
    transition: filter 0.12s;
    background: transparent;
    padding: 0;
    border-top: none;
    border-bottom: none;
    border-left: none;
    font: inherit;
    color: inherit;
    text-align: left;
  }
  .h-pg-cell:last-child {
    border-right: none;
  }
  .h-pg-cell:hover,
  .h-pg-cell:focus-visible {
    filter: brightness(0.92) saturate(1.4);
    outline: none;
  }
  .h-pg-cell::before {
    content: '';
    position: absolute;
    inset: 2px;
    background: var(--c, transparent);
  }
  .h-pg-today-tint {
    position: absolute;
    inset: 2px;
    background: rgba(237, 228, 212, 0.55);
    mix-blend-mode: screen;
    pointer-events: none;
    z-index: 1;
  }
  .h-pg-cell.peak {
    z-index: 2;
  }
  .h-pg-cell.peak::after {
    content: '';
    position: absolute;
    inset: -2px;
    border: 3px solid var(--text-primary);
    box-shadow:
      inset 0 0 0 1.5px var(--bg),
      0 0 0 1px var(--divider);
    pointer-events: none;
    z-index: 3;
  }
  .h-pg-axis {
    display: grid;
    grid-template-columns: repeat(30, minmax(0, 1fr));
    border-top: 1px solid var(--divider);
    background: rgba(26, 16, 8, 0.02);
    min-width: 0;
  }
  .h-pg-axis-cell {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.05em;
    color: var(--text-ghost);
    text-align: center;
    padding: 6px 0;
  }
  .h-tip {
    position: absolute;
    pointer-events: none;
    z-index: 50;
    background: var(--text-primary);
    color: var(--bg);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    white-space: nowrap;
    transform: translate(-50%, -120%);
    border: 1px solid var(--divider);
  }
  .h-tip-key {
    color: color-mix(in srgb, var(--bg) 60%, transparent);
    margin-right: 6px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    font-size: 9px;
  }
  .h-tip-val {
    color: var(--bg);
    font-weight: 500;
  }
</style>
