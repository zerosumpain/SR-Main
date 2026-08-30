<script lang="ts">
  // C — FORECAST. Four cards, each the same chart: a solid black line for what
  // was recorded, a dashed accent line for the trend extended ninety days, and
  // a filled cone that opens from today's point.
  //
  // The cone is the honest part. It is drawn from the real per-step
  // `lower`/`upper` pair rather than as a symmetric wedge, so a series whose
  // scatter is bigger than its slope LOOKS like one — which is the whole
  // argument the section is making.
  //
  // The viewBox is padded on every side. Endpoint markers and axis labels are
  // drawn at the edges of a 300×110 frame, and half of a 3.5px dot at x=300 is
  // outside the box: the viewport clips it, and no CSS `overflow` gets it back.
  import type { MetricResult } from '$lib/health/analytics/types';
  import type { ForecastResult } from '$lib/health/analytics/forecast';
  import { ACWR_BANDS } from '$lib/health/analytics/acwr';
  import { usable } from '$lib/health/ledes';
  import SectionHead from './SectionHead.svelte';
  import type { ForecastSet } from './types';
  import { signed } from './format';
  import { extent, include, yOf, type Extent } from './chart';

  interface Props {
    forecast: ForecastSet;
  }

  let { forecast }: Props = $props();

  /** Frame the chart is drawn in, before padding. */
  const W = 300;
  const H = 110;
  /** Today's vertical rule sits at the midpoint — half history, half forecast. */
  const MID = W / 2;

  interface Guide {
    value: number;
    label: string;
  }
  interface Band {
    from: number;
    to: number;
    label: string;
  }

  interface CardSpec {
    id: keyof ForecastSet;
    name: string;
    /** Decimal places on the now → then figures. */
    dp: number;
    suffix: string;
    /** The sentence that is about THIS metric rather than about the slope. */
    note: string;
    result: MetricResult<ForecastResult> | null;
  }

  const specs = $derived.by((): CardSpec[] => [
    {
      id: 'sleep',
      name: 'Sleep · 30d mean',
      dp: 1,
      suffix: 'h',
      note: 'Sleep answers to one decision taken nightly, so it is the line most able to beat its own forecast.',
      result: forecast.sleep,
    },
    {
      id: 'hrv',
      name: 'HRV · 7d mean',
      dp: 0,
      suffix: 'ms',
      note: 'HRV responds fast to sleep, so a change made this week shows here before it shows anywhere else.',
      result: forecast.hrv,
    },
    {
      id: 'vo2max',
      name: 'VO₂max',
      dp: 1,
      suffix: '',
      note: 'Read the slope, never the value — the percentile behind it is pinned to a fixed age-32 profile.',
      result: forecast.vo2max,
    },
    {
      id: 'acwr',
      name: 'ACWR',
      dp: 2,
      suffix: '',
      note: 'The one line whose fix is purely calendar: it moves when sessions land, and not otherwise.',
      result: forecast.acwr,
    },
  ]);

  interface Card {
    id: string;
    name: string;
    readable: boolean;
    confidence: number;
    now: string;
    then: string;
    body: string;
    /** Everything the SVG needs, or null when there is nothing to draw. */
    chart: {
      history: string;
      projection: string;
      cone: string;
      dot: { x: number; y: number };
      guides: Array<{ y: number; label: string; below: boolean }>;
      band: { y: number; height: number; label: string } | null;
    } | null;
  }

  function fmt(value: number, dp: number, suffix: string): string {
    return `${value.toFixed(dp)}${suffix}`;
  }

  /** The reference marks each metric is read against. ACWR has real band
   *  constants; the rest are read against the mean of their own window, which
   *  is a computed number rather than a target somebody invented. */
  function marksFor(id: string, history: Array<{ value: number }>): { guides: Guide[]; band: Band | null } {
    if (id === 'acwr') {
      return {
        guides: [{ value: ACWR_BANDS.detraining, label: `${ACWR_BANDS.detraining.toFixed(1)} · detraining` }],
        band: {
          from: ACWR_BANDS.undertraining,
          to: ACWR_BANDS.optimal,
          label: `${ACWR_BANDS.undertraining.toFixed(1)}–${ACWR_BANDS.optimal.toFixed(1)} optimal`,
        },
      };
    }
    if (!history.length) return { guides: [], band: null };
    const mean = history.reduce((a, p) => a + p.value, 0) / history.length;
    return { guides: [{ value: mean, label: `${mean.toFixed(mean < 10 ? 1 : 0)} · 28d mean` }], band: null };
  }

  const cards = $derived.by((): Card[] =>
    specs.map((spec): Card => {
      const r = spec.result;
      if (!usable(r) || r.value.history.length < 2) {
        return {
          id: spec.id,
          name: spec.name,
          readable: false,
          confidence: 0,
          now: '—',
          then: '—',
          body: 'Not enough of a window to fit a line through. A projection off a handful of points is a drawing, not a forecast.',
          chart: null,
        };
      }
      const f = r.value;
      const { guides, band } = marksFor(spec.id, f.history);

      // One scale for everything drawn: history, projection, the whole cone,
      // and any reference mark. A guide off the top of the scale would
      // otherwise render as a line pinned to the frame's edge.
      let e: Extent = extent([
        ...f.history.map((p) => p.value),
        ...f.projection.map((p) => p.value),
        ...f.cone.map((p) => p.lower),
        ...f.cone.map((p) => p.upper),
      ]);
      for (const g of guides) e = include(e, g.value);
      if (band) e = include(include(e, band.from), band.to);

      const hx = (i: number) => (i / Math.max(1, f.history.length - 1)) * MID;
      const px = (i: number) => MID + (i / Math.max(1, f.projection.length - 1)) * MID;
      const y = (v: number) => yOf(v, e, H);

      const history = f.history.map((p, i) => `${hx(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
      const projection = f.projection.map((p, i) => `${px(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
      // Upper edge out, lower edge back — a real polygon, not a triangle.
      const cone = f.cone.length
        ? [
            `M${MID.toFixed(1)} ${y(f.now).toFixed(1)}`,
            ...f.cone.map((p, i) => `L${px(i).toFixed(1)} ${y(p.upper).toFixed(1)}`),
            ...[...f.cone].reverse().map((p, i) => `L${px(f.cone.length - 1 - i).toFixed(1)} ${y(p.lower).toFixed(1)}`),
            'Z',
          ].join(' ')
        : '';

      const dir =
        Math.abs(f.slopePerMonth) < 0.005
          ? 'Flat'
          : f.slopePerMonth > 0
            ? 'Rising'
            : 'Declining';
      const spread =
        f.confidence >= 70
          ? 'Tight cone: the recorded points sit close to their own trend, so the projection is worth reading.'
          : f.confidence >= 50
            ? 'A wide cone — the scatter about the trend is comparable to the move being projected.'
            : 'The widest cone here, and deliberately: this much scatter cannot pin a direction over ninety days.';

      return {
        id: spec.id,
        name: spec.name,
        readable: true,
        confidence: f.confidence,
        now: fmt(f.now, spec.dp, spec.suffix),
        then: fmt(f.then, spec.dp, spec.suffix),
        body: `${dir} at ${signed(f.slopePerMonth, 2)} a month. ${spread} ${spec.note}`,
        chart: {
          history,
          projection,
          cone,
          dot: { x: MID, y: y(f.now) },
          guides: guides.map((g) => ({
            y: y(g.value),
            label: g.label,
            // A guide near the top of the frame gets its label BELOW the line,
            // where there is room for it.
            below: y(g.value) < 16,
          })),
          band: band
            ? {
                y: Math.min(y(band.to), y(band.from)),
                height: Math.abs(y(band.from) - y(band.to)),
                label: band.label,
              }
            : null,
        },
      };
    }),
  );
</script>

<section class="c">
  <div class="c-inner">
    <SectionHead
      kicker="C / Forecast · 90 days"
      title={['Where the lines', 'go if nothing changes']}
      strap="Solid is recorded. Dashed is the current trend extended. The cone is the honest spread — it widens because thin data should look uncertain."
    />

    <div class="c-grid">
      {#each cards as card (card.id)}
        <div class="c-card">
          <div class="c-card-head">
            <p class="c-name">{card.name}</p>
            <p class="c-conf">{card.readable ? `${card.confidence}% conf` : 'no read'}</p>
          </div>
          <p class="c-figure">
            {card.now} <span class="c-arrow">→</span> <span class="c-then">{card.then}</span>
          </p>

          {#if card.chart}
            <svg viewBox="-6 -6 312 124" class="c-chart" role="img" aria-label="{card.name}: {card.now} today, {card.then} in ninety days">
              {#if card.chart.band}
                <rect x="0" y={card.chart.band.y} width={W} height={card.chart.band.height} fill="rgba(138,154,91,0.16)" />
                <text x="4" y={card.chart.band.y + 8} class="c-axis">{card.chart.band.label}</text>
              {/if}
              {#each card.chart.guides as g, i (i)}
                <line x1="0" y1={g.y} x2={W} y2={g.y} stroke="rgba(26,16,8,0.14)" stroke-width="1" stroke-dasharray="4 4" />
                <text x="4" y={g.below ? g.y + 12 : g.y - 5} class="c-axis">{g.label}</text>
              {/each}
              {#if card.chart.cone}
                <path d={card.chart.cone} fill="rgba(196,87,10,0.14)" />
              {/if}
              <polyline points={card.chart.history} fill="none" stroke="#1a1008" stroke-width="2" />
              <polyline points={card.chart.projection} fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" />
              <circle cx={card.chart.dot.x} cy={card.chart.dot.y} r="3.5" fill="var(--accent)" />
              <line x1={MID} y1="0" x2={MID} y2={H} stroke="rgba(26,16,8,0.2)" stroke-width="1" />
              <text x={MID - 4} y={H - 3} text-anchor="end" class="c-axis">Today</text>
              <text x={W - 4} y={H - 3} text-anchor="end" class="c-axis">+90d</text>
            </svg>
          {:else}
            <div class="c-empty">Awaiting a window</div>
          {/if}

          <p class="c-body">{card.body}</p>
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .c {
    padding: clamp(44px, 5vw, 76px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid rgba(26, 16, 8, 0.12);
  }
  .c-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .c-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: clamp(18px, 2vw, 28px);
  }
  .c-card {
    border: 1px solid var(--card-border);
    padding: 22px;
    min-width: 0;
  }

  .c-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 4px;
  }
  .c-name,
  .c-conf {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    margin: 0;
  }
  .c-name {
    font-weight: 500;
    letter-spacing: 0.15em;
  }
  .c-conf {
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    white-space: nowrap;
  }

  .c-figure {
    font-family: var(--font-display);
    font-size: 30px;
    line-height: 1;
    letter-spacing: -0.02em;
    margin: 0 0 14px;
  }
  .c-arrow {
    color: rgba(26, 16, 8, 0.3);
  }
  .c-then {
    color: var(--accent);
  }

  .c-chart {
    width: 100%;
    height: auto;
    display: block;
  }
  /* Axis labels are SVG user units inside a 312-wide box that renders about
     260px on screen, so 8 user units is roughly 7px of type — small, but this
     is a chart annotation, not reading copy. */
  .c-axis {
    font-family: var(--font-mono);
    font-size: 8px; /* svg-user-units: viewBox -6 -6 312 124 */
    letter-spacing: 0.6px;
    fill: var(--text-ghost);
  }

  .c-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 110px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    border: 1px dashed var(--card-border);
  }

  .c-body {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 12px 0 0;
    text-wrap: pretty;
  }
</style>
