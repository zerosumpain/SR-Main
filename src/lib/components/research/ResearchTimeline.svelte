<script lang="ts" module>
  export interface TimelinePeriod {
    /** 'YYYY-MM', 'YYYY' or an ISO date — whatever the synthesis emitted. */
    date: string;
    /** Fact contents for this period, already resolved by the loader. */
    facts: { id: string; content: string }[];
  }
</script>

<script lang="ts">
  /**
   * When the evidence is FROM.
   *
   * `report.timeline` has been computed on every finished run for months and
   * rendered nowhere. It is the one genuine series the report carries — facts
   * grouped by the date of the thing they describe — so it is the one thing on
   * this dashboard that is honestly a chart rather than a number.
   *
   * Encoding, in the order the dataviz procedure asks:
   *
   *  - **Form:** change over time, one measure → bars on a CONTINUOUS time axis.
   *    Not a line: the periods are sparse and irregular (a run can jump 2014 →
   *    2021 → 2022-08), and a line drawn between them would assert a trend
   *    through years where nothing was found. Not evenly spaced categories
   *    either — that would hide the gaps, which are the interesting part.
   *  - **Colour:** one series, so one hue — the site accent, which clears 3:1
   *    against both the cream and dark surfaces. No legend: with a single
   *    series the title names it.
   *  - **Relief:** the tallest period is directly labelled; the rest are read
   *    from the hover tooltip. A number on every bar is noise at this size.
   *
   * Clicking a period reveals its facts, which is the whole reason the fact IDs
   * are resolved server-side — a bar you cannot open is a decoration.
   */
  let {
    periods = [],
    onSelect,
  }: {
    periods: TimelinePeriod[];
    /** Notifies the page which period is open, so it can scroll or highlight. */
    onSelect?: (date: string | null) => void;
  } = $props();

  const W = 760;
  const H = 150;
  const PAD_L = 4;
  const PAD_R = 4;
  const PAD_T = 16;
  /** Room for the axis labels under the baseline. */
  const AXIS_H = 20;

  let hovered = $state<string | null>(null);
  let openDate = $state<string | null>(null);

  /**
   * Period start as epoch ms. 'YYYY-MM' is parsed as the first of that month;
   * a bare 'YYYY' as the first of January. Anything unparseable is dropped
   * rather than plotted at 1970, which would flatten every real period into the
   * right-hand edge.
   */
  function toMs(date: string): number | null {
    const s = (date ?? '').trim();
    if (/^\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1);
    if (/^\d{4}-\d{2}$/.test(s)) return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1);
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }

  function labelFor(date: string): string {
    const ms = toMs(date);
    if (ms == null) return date;
    const d = new Date(ms);
    return /^\d{4}$/.test(date.trim())
      ? String(d.getUTCFullYear())
      : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  const points = $derived.by(() => {
    const rows = periods
      .map((p) => ({ ...p, ms: toMs(p.date), count: p.facts.length }))
      .filter((p): p is typeof p & { ms: number } => p.ms != null && p.count > 0)
      .sort((a, b) => a.ms - b.ms);
    return rows;
  });

  const scale = $derived.by(() => {
    const lo = points[0]?.ms ?? 0;
    const hi = points[points.length - 1]?.ms ?? 0;
    const span = hi - lo;
    const plotW = W - PAD_L - PAD_R;
    // A single period, or several inside one month, would divide by zero — put
    // them in the middle instead of at the left edge.
    const x = (ms: number) => (span <= 0 ? W / 2 : PAD_L + ((ms - lo) / span) * plotW);
    return { lo, hi, span, x };
  });

  const maxCount = $derived(Math.max(1, ...points.map((p) => p.count)));
  const plotH = $derived(H - PAD_T - AXIS_H);

  /**
   * Bar width from the tightest gap between periods, so neighbouring bars never
   * overlap, floored at 3px so a lone month is still something you can hit.
   */
  const barW = $derived.by(() => {
    if (points.length < 2) return 26;
    let min = Infinity;
    for (let i = 1; i < points.length; i++) {
      min = Math.min(min, scale.x(points[i].ms) - scale.x(points[i - 1].ms));
    }
    return Math.max(3, Math.min(26, min - 2));
  });

  const bars = $derived(
    points.map((p) => {
      const h = Math.max(2, (p.count / maxCount) * plotH);
      return {
        ...p,
        x: scale.x(p.ms) - barW / 2,
        y: PAD_T + plotH - h,
        h,
        centre: scale.x(p.ms),
      };
    }),
  );

  const peak = $derived(bars.reduce<(typeof bars)[number] | null>((best, b) => (!best || b.count > best.count ? b : best), null));

  /** First and last only — a sparse axis cannot carry regular ticks honestly. */
  const axisTicks = $derived(
    bars.length === 0
      ? []
      : bars.length === 1
        ? [{ x: bars[0].centre, label: labelFor(bars[0].date), anchor: 'middle' }]
        : [
            { x: bars[0].centre, label: labelFor(bars[0].date), anchor: 'start' },
            { x: bars[bars.length - 1].centre, label: labelFor(bars[bars.length - 1].date), anchor: 'end' },
          ],
  );

  const hoveredBar = $derived(hovered ? (bars.find((b) => b.date === hovered) ?? null) : null);
  const openPeriod = $derived(openDate ? (points.find((p) => p.date === openDate) ?? null) : null);

  const totalFacts = $derived(points.reduce((n, p) => n + p.count, 0));

  function toggle(date: string) {
    openDate = openDate === date ? null : date;
    onSelect?.(openDate);
  }
</script>

{#if bars.length > 0}
  <section class="nm-sec" id="timeline">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Evidence over time</span>
      <span class="nm-sec-meta">
        {totalFacts} dated {totalFacts === 1 ? 'fact' : 'facts'} across {bars.length}
        {bars.length === 1 ? 'period' : 'periods'}
      </span>
    </div>

    <div class="chart-host">
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Facts by the period they describe">
        <!-- Baseline only. Gridlines would imply a precision this axis does not have. -->
        <line class="axis" x1={PAD_L} y1={PAD_T + plotH} x2={W - PAD_R} y2={PAD_T + plotH} />

        {#each bars as b (b.date)}
          <g
            class="bar"
            class:on={openDate === b.date}
            role="button"
            tabindex="0"
            aria-label="{labelFor(b.date)}: {b.count} {b.count === 1 ? 'fact' : 'facts'}"
            onclick={() => toggle(b.date)}
            onkeydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle(b.date);
              }
            }}
            onmouseenter={() => (hovered = b.date)}
            onmouseleave={() => (hovered = null)}
            onfocus={() => (hovered = b.date)}
            onblur={() => (hovered = null)}
          >
            <!-- A generous transparent hit area: the bars can be 3px wide. -->
            <rect class="hit" x={b.centre - 9} y={PAD_T} width="18" height={plotH} />
            <rect class="fill" x={b.x} y={b.y} width={barW} height={b.h} rx="2" />
          </g>
        {/each}

        {#if peak}
          <text class="peak-label" x={peak.centre} y={peak.y - 5} text-anchor="middle">{peak.count}</text>
        {/if}

        {#each axisTicks as t (t.label)}
          <text class="tick" x={t.x} y={H - 6} text-anchor={t.anchor}>{t.label}</text>
        {/each}
      </svg>

      {#if hoveredBar}
        <!-- Positioned in percentages: the SVG scales uniformly to the container,
             so viewBox coordinates map linearly onto it. -->
        <div
          class="tip"
          style="left: {(hoveredBar.centre / W) * 100}%; bottom: {((H - hoveredBar.y + 6) / H) * 100}%"
        >
          <strong>{labelFor(hoveredBar.date)}</strong>
          <span>{hoveredBar.count} {hoveredBar.count === 1 ? 'fact' : 'facts'}</span>
        </div>
      {/if}
    </div>

    {#if openPeriod}
      <div class="facts">
        <div class="facts-hd">
          <span class="sr-label-tight">{labelFor(openPeriod.date)}</span>
          <button type="button" class="close" onclick={() => toggle(openPeriod.date)} aria-label="Close">×</button>
        </div>
        <ul>
          {#each openPeriod.facts as f (f.id)}<li>{f.content}</li>{/each}
        </ul>
      </div>
    {:else}
      <p class="hint">Click a period to read the facts dated to it</p>
    {/if}
  </section>
{/if}

<style>
  /* .nm-sec, .nm-sec-hd, .sr-label-tight and .nm-sec-meta come from
     $lib/styles/nm-tokens.css, which the root layout imports. They are
     deliberately NOT redefined here — that file is the source of truth and says
     so at the top. */
  .chart-host { position: relative; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }

  .axis { stroke: var(--card-border); stroke-width: 1; }
  .bar { cursor: pointer; }
  .hit { fill: transparent; }
  .fill { fill: var(--accent); fill-opacity: 0.72; transition: fill-opacity 0.12s ease; }
  .bar:hover .fill, .bar:focus-visible .fill, .bar.on .fill { fill-opacity: 1; }
  .bar:focus-visible { outline: none; }
  .bar:focus-visible .fill { stroke: var(--text-primary); stroke-width: 1.5; }

  /* Text wears text tokens, never the series colour. */
  .peak-label { font-family: var(--font-mono); font-size: 11px; fill: var(--text-secondary); }
  .tick { font-family: var(--font-mono); font-size: 10px; fill: var(--text-ghost); }

  .tip {
    position: absolute;
    transform: translateX(-50%);
    z-index: 3;
    pointer-events: none;
    white-space: nowrap;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    padding: 4px 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-primary);
    display: grid;
    gap: 1px;
  }
  .tip span { color: var(--text-muted); }

  .facts { margin-top: 0.6rem; border-top: 1px solid var(--divider); padding-top: 0.5rem; }
  .facts-hd { display: flex; align-items: baseline; gap: 0.5rem; }
  .close { margin-left: auto; background: none; border: none; color: var(--text-muted); font-size: 1.1rem; line-height: 1; cursor: pointer; padding: 0 4px; }
  .close:hover { color: var(--error); }
  .facts ul { margin: 0.4rem 0 0; padding-left: 1.1rem; display: grid; gap: 0.3rem; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); }

  .hint { margin: 0.5rem 0 0; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
</style>
