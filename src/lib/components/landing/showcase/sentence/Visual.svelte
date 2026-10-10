<svelte:options css="injected" />

<script lang="ts">
  // The small exact pictures of the sentence showcase, drawn the same way in
  // a footnote card (the long version) and in a chapter's margin (always in
  // view, `compact`). Everything is a <span> because a footnote lives inside
  // a <p>. Each chart is aria-hidden with a one-sentence summary beside it;
  // quotes and lists are real text.
  //
  // Colours come from the parent (--tone, --fg, --fg2, --fg3), so the same
  // picture reads on paper and in the app chapter's ink band. Marks carry
  // `ss-g` (and `ss-gy` for bars that grow) with a stagger index `--i`, so a
  // chapter can draw its margin chart in once as its figure counts up.
  import type { Visual } from '$lib/landing/showcase-sentence';
  import { dayName } from '$lib/landing/rhythm';

  let { visual: v, compact = false }: { visual: Visual; compact?: boolean } = $props();

  const HOURS = [0, 6, 12, 18, 24];
  const hh = (h: number) => String(h).padStart(2, '0');
  // Recovery marks: one row in a card, rows of ten in the margin.
  let perRow = $derived(v.kind === 'bands' ? (compact ? 10 : Math.max(1, v.marks.length)) : 1);
  let rows = $derived(v.kind === 'bands' ? Math.max(1, Math.ceil(v.marks.length / perRow)) : 1);
</script>

{#if v.kind === 'slots'}
  {@const nx = v.thinks.findIndex((t) => t.state === 'next')}
  <span class="ss-vh">{v.summary}</span>
  <span class="ss-vis" class:ss-off={v.off} class:ss-compact={compact} aria-hidden="true">
    <svg class="ss-dots" viewBox="0 0 {Math.max(1, v.thinks.length) * 14} 16" focusable="false">
      {#each v.thinks as t, i (t.at)}
        <circle cx={i * 14 + 7} cy="8" r={t.state === 'next' ? 5 : 3.5} class="ss-{t.state}" />
      {/each}
    </svg>
    <span class="ss-ends">
      <span>{v.thinks[0]?.at ?? ''}</span>
      {#if nx >= 0 && !v.off}<span class="ss-nx">next {v.thinks[nx].at}</span>{/if}
      <span>{v.thinks.at(-1)?.at ?? ''}</span>
    </span>
  </span>
{:else if v.kind === 'verdicts'}
  <span class="ss-vh">{v.summary}</span>
  <span class="ss-vis" class:ss-compact={compact} aria-hidden="true">
    <svg class="ss-cols" viewBox="0 0 {v.cols.length * 20} 64" preserveAspectRatio="none" focusable="false">
      {#each v.cols as c, i (c.start)}
        {@const x = i * 20 + 4}
        {@const u = c.hUseful * 60}
        {@const nu = c.hNotUseful * 60}
        {@const ud = c.hUndecided * 60}
        <g class="ss-g ss-gy" style:--i={i}>
          {#if u > 0}<rect class="ss-u" {x} y={64 - u} width="12" height={u} />{/if}
          {#if nu > 0}<rect class="ss-nu" {x} y={64 - u - nu} width="12" height={nu} />{/if}
          {#if ud > 0}<rect class="ss-ud" x={x + 0.75} y={64 - u - nu - ud + 0.75} width="10.5" height={Math.max(0, ud - 1.5)} />{/if}
        </g>
      {/each}
    </svg>
    <span class="ss-ends"><span>{v.cols.length ? dayName(v.cols[0].start) : ''}</span><span>this week</span></span>
    <span class="ss-key"
      ><span><i class="ss-sw ss-u"></i>useful</span><span><i class="ss-sw ss-nu"></i>not useful</span><span
        ><i class="ss-sw ss-ud"></i>undecided</span
      ></span
    >
  </span>
{:else if v.kind === 'hours'}
  <span class="ss-vh">{v.summary}</span>
  <span class="ss-vis" class:ss-compact={compact} aria-hidden="true">
    <svg class="ss-bars" viewBox="0 0 240 56" preserveAspectRatio="none" focusable="false">
      <line class="ss-base" x1="0" y1="55.5" x2="240" y2="55.5" />
      {#each v.bars as b (b.hour)}
        {#if b.state === 'future'}
          <line class="ss-fut" x1={b.hour * 10 + 5} y1="55" x2={b.hour * 10 + 5} y2="51" />
        {:else if b.h > 0}
          <rect
            class="ss-g ss-gy"
            class:ss-now={b.state === 'now'}
            style:--i={b.hour}
            x={b.hour * 10 + 1.5}
            y={55 - Math.max(1.5, b.h * 52)}
            width="7"
            height={Math.max(1.5, b.h * 52)}
          />
        {/if}
      {/each}
    </svg>
    <span class="ss-hours">
      {#each HOURS as h (h)}<span style:left="{(h / 24) * 100}%">{hh(h)}</span>{/each}
    </span>
  </span>
{:else if v.kind === 'days'}
  <span class="ss-vh">{v.summary}</span>
  <span class="ss-vis" class:ss-compact={compact} aria-hidden="true">
    <span class="ss-row ss-days">
      {#each v.cells as d, i (d.i)}<span class="ss-cell ss-g" class:ss-over={d.over} class:ss-gap={d.steps == null} style:--a={d.a} style:--i={i}
          >{d.k}</span
        >{/each}
    </span>
    <span class="ss-ends"><span>oldest</span><span>latest</span></span>
  </span>
{:else if v.kind === 'deploys'}
  <span class="ss-vh">{v.summary}</span>
  <span class="ss-vis" class:ss-compact={compact} aria-hidden="true">
    <span class="ss-row ss-deps">
      {#each v.cells as d, i (d.date)}<span class="ss-cell ss-g" class:ss-z={d.count === 0} class:ss-today={d.today} style:--a={d.a} style:--i={i}
          >{d.count || '·'}</span
        >{/each}
    </span>
    <span class="ss-ends"><span>{v.cells.length ? dayName(v.cells[0].date) : ''}</span><span>today</span></span>
  </span>
{:else if v.kind === 'bands'}
  <span class="ss-vh">{v.summary}</span>
  <span class="ss-vis" class:ss-compact={compact} aria-hidden="true">
    <svg class="ss-marks" viewBox="0 0 {perRow * 12} {rows * 14 - 2}" focusable="false">
      {#each v.marks as m, i (i)}
        {@const x = (i % perRow) * 12 + 1}
        {@const y = Math.floor(i / perRow) * 14 + 1}
        <g class="ss-g" style:--i={i}>
          <rect class="ss-m ss-{m}" {x} {y} width="9" height="10" />
          {#if m === 'mid'}<rect class="ss-half" {x} y={y + 5} width="9" height="5" />{/if}
        </g>
      {/each}
    </svg>
    <span class="ss-key"
      ><span><i class="ss-sw ss-high"></i>good</span><span><i class="ss-sw ss-mid"></i>middling</span><span
        ><i class="ss-sw ss-low"></i>low</span
      ></span
    >
  </span>
{:else if v.kind === 'quotes'}
  <span class="ss-vis ss-quotes" class:ss-compact={compact}>
    {#each v.lines as l, i (l)}<span class="ss-q ss-g" style:--i={i * 4}>“{l}”</span>{/each}
  </span>
{:else if v.kind === 'list'}
  <span class="ss-vis ss-list" class:ss-compact={compact}>
    {#each v.items as it, i (i)}<span class="ss-li">{it}</span>{/each}
  </span>
{/if}

<style>
  .ss-vis {
    display: block;
    padding-top: 4px;
    container: ss-vis / inline-size;
  }
  .ss-ends,
  .ss-hours,
  .ss-key,
  .ss-row,
  .ss-li {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .ss-vh {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
  svg {
    display: block;
    width: 100%;
    overflow: visible;
  }
  .ss-ends {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0 12px;
    margin-top: 6px;
    color: var(--fg3);
  }
  .ss-compact .ss-ends {
    letter-spacing: 0.04em;
  }
  .ss-nx {
    color: var(--tone);
  }
  .ss-key {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin-top: 6px;
    color: var(--fg3);
  }
  .ss-compact .ss-key {
    gap: 2px 12px;
    letter-spacing: 0.04em;
  }
  .ss-key > span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ss-sw {
    display: inline-block;
    width: 10px;
    height: 10px;
    box-sizing: border-box;
    border: 1.5px solid var(--tone);
  }

  /* Today's think slots: gone by, next, still to come. */
  .ss-dots {
    height: 16px;
  }
  .ss-dots circle {
    stroke: var(--tone);
    stroke-width: 1.25;
  }
  .ss-dots .ss-earlier {
    fill: var(--tone);
    opacity: 0.45;
  }
  .ss-dots .ss-next {
    fill: var(--tone);
  }
  .ss-dots .ss-later {
    fill: none;
  }
  .ss-off .ss-dots circle {
    fill: none;
    stroke: var(--fg3);
    opacity: 1;
  }

  /* Twelve weeks of verdicts. */
  .ss-cols {
    height: 64px;
  }
  .ss-compact .ss-cols {
    height: 48px;
  }
  .ss-cols .ss-u {
    fill: var(--tone);
  }
  .ss-cols .ss-nu {
    fill: var(--fg2);
    opacity: 0.55;
  }
  .ss-cols .ss-ud {
    fill: none;
    stroke: var(--tone);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }
  .ss-sw.ss-u {
    background: var(--tone);
  }
  .ss-sw.ss-nu {
    border-color: transparent;
    background: color-mix(in srgb, var(--fg2) 55%, transparent);
  }

  /* Today, an hour to a bar. */
  .ss-bars {
    height: 56px;
  }
  .ss-bars rect {
    fill: var(--tone);
  }
  .ss-bars .ss-base,
  .ss-bars .ss-fut {
    stroke: var(--fg3);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .ss-bars .ss-fut {
    stroke-dasharray: 1 2;
  }
  .ss-hours {
    position: relative;
    display: block;
    height: 18px;
    margin-top: 6px;
    color: var(--fg3);
  }
  .ss-hours span {
    position: absolute;
    transform: translateX(-50%);
  }
  .ss-hours span:first-child {
    transform: none;
  }
  .ss-hours span:last-child {
    transform: translateX(-100%);
  }

  /* Numeral rows: thirty days of steps in thousands, forty days of deploys.
     A grid of type, as the hero's ship row; it folds to fit, keeping each
     cell wide enough for two digits at the 12px floor. */
  .ss-row {
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    row-gap: 4px;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    line-height: 1.6;
  }
  @container ss-vis (min-width: 280px) {
    .ss-row.ss-days {
      grid-template-columns: repeat(15, minmax(0, 1fr));
    }
  }
  /* Twenty to a row only where each cell is 18px or more. */
  @container ss-vis (min-width: 360px) {
    .ss-row.ss-deps {
      grid-template-columns: repeat(20, minmax(0, 1fr));
    }
  }
  @container ss-vis (min-width: 470px) {
    .ss-row.ss-days {
      grid-template-columns: repeat(30, minmax(0, 1fr));
    }
  }
  @container ss-vis (min-width: 620px) {
    .ss-row.ss-deps {
      grid-template-columns: repeat(40, minmax(0, 1fr));
    }
  }
  .ss-cell {
    text-align: center;
    color: var(--fg);
    opacity: var(--a, 1);
  }
  .ss-cell.ss-over {
    color: var(--tone);
    font-weight: 500;
    opacity: 1;
  }
  .ss-cell.ss-gap,
  .ss-cell.ss-z {
    color: var(--fg3);
    opacity: 1;
  }
  .ss-cell.ss-today {
    color: var(--fg);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  /* Recovery, a mark a day by band. */
  .ss-marks {
    max-width: 380px;
  }
  .ss-marks .ss-m {
    fill: none;
    stroke: var(--tone);
    stroke-width: 1.25;
  }
  .ss-marks .ss-high,
  .ss-marks .ss-half {
    fill: var(--tone);
  }
  .ss-sw.ss-high {
    background: var(--tone);
  }
  .ss-sw.ss-mid {
    background: linear-gradient(transparent 50%, var(--tone) 50%);
  }

  /* Siri's phrases, set as said; the app's lists, set as type. */
  .ss-quotes {
    display: grid;
    gap: 2px;
  }
  .ss-q {
    font-family: var(--fs-serif);
    font-style: italic;
    font-size: var(--fs-body-lg);
    color: var(--fg);
  }
  .ss-compact .ss-q {
    font-size: clamp(20px, 1.6vw, 24px);
    line-height: 1.25;
  }
  .ss-quotes.ss-compact {
    gap: 6px;
  }
  .ss-list {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 0;
  }
  .ss-li {
    color: var(--fg);
    white-space: nowrap;
  }
  .ss-li:not(:last-child)::after {
    content: '·';
    margin: 0 0.7em;
    color: var(--tone);
  }

  @media print {
    .ss-ends,
    .ss-nx,
    .ss-hours,
    .ss-key,
    .ss-cell,
    .ss-cell.ss-over,
    .ss-cell.ss-gap,
    .ss-cell.ss-z,
    .ss-cell.ss-today,
    .ss-q,
    .ss-li {
      color: #1a1008;
      opacity: 1;
    }
    .ss-dots circle,
    .ss-cols .ss-ud,
    .ss-marks .ss-m,
    .ss-bars .ss-base,
    .ss-bars .ss-fut {
      stroke: #1a1008;
    }
    .ss-dots .ss-earlier,
    .ss-dots .ss-next,
    .ss-cols .ss-u,
    .ss-bars rect,
    .ss-marks .ss-high,
    .ss-marks .ss-half {
      fill: #1a1008;
    }
    .ss-cols .ss-nu {
      fill: #1a1008;
      opacity: 0.4;
    }
    /* Backgrounds don't print by default: the swatches keep their fills
       (print-color-adjust), and each also differs by its border, so the key
       still reads if a printer drops them anyway. */
    .ss-sw {
      border-color: #1a1008;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .ss-sw.ss-u,
    .ss-sw.ss-high {
      background: #1a1008;
    }
    .ss-sw.ss-nu {
      border: 1.5px dotted #1a1008;
      background: rgba(26, 16, 8, 0.4);
    }
    .ss-sw.ss-ud {
      border-style: solid;
    }
    .ss-sw.ss-mid {
      border-style: dashed;
      background: linear-gradient(transparent 50%, #1a1008 50%);
    }
  }
</style>
