/**
 * The Vega-Lite theme for chat charts.
 *
 * One home for the chart look, the way `$lib/fieldstudy/study.ts` is the one
 * home for the study hues. A chart in chat is drawn from a spec a model wrote,
 * so the spec cannot be trusted to carry the design system — the theme is
 * applied underneath it and the model only supplies data, marks and encodings.
 *
 * COLOUR. The four categorical hues are the site's, and they are validated,
 * not chosen: the shipped fieldstudy ramp fails colourblind separation on its
 * orange/green pair (OKLab ΔE 4.0 protan, against a floor of 6), so the green
 * is re-stepped to #3a8658 — a drift of 0.031 in OKLCH, which reads as the
 * same green and clears the floor at ΔE 6.2. That pair sits in the 6–8 band,
 * which is legal ONLY with a secondary encoding, so `legend` below is not
 * optional decoration: it is what makes the palette compliant. Do not turn it
 * off, and do not add a fifth hue — past four, fold into "other" or facet.
 *
 * Keep these in step with `--chart-cat-*` in `src/app.css`. Vega cannot read a
 * CSS custom property (it paints into SVG attributes), so the values are
 * duplicated here deliberately; `chart-theme.test.ts` fails if they drift.
 */

/** Categorical hues, in fixed assignment order. Identity never moves. */
export const CHART_CATEGORICAL = ['#7a5aa6', '#b4632e', '#3a8658', '#8a2d3a'] as const;

/** Single-hue ramp for magnitude. The site's petrol counter-accent. */
export const CHART_SEQUENTIAL = ['#dfeaec', '#9cc3c9', '#4d8f9b', '#0e5b66'] as const;

/** Warm/cool poles either side of a neutral midpoint, for polarity. */
export const CHART_DIVERGING = ['#8a2d3a', '#c58a72', '#ded3c2', '#6d9aa4', '#0e5b66'] as const;

/** Burnt orange: the site's identity colour, and what every single-series chart
 *  in the repo already paints with (ModelValueChart, the field studies' bars).
 *  The categorical ramp only comes out when there is something to tell apart. */
const ACCENT = '#c4570a';
const SURFACE = '#ede4d4';
const INK = '#1a1008';
const INK_MUTED = 'rgba(26, 16, 8, 0.65)';
const HAIRLINE = 'rgba(26, 16, 8, 0.14)';
/** jkai runs on Segoe UI, not the site's DM Sans — see the sr-design skill. */
const FONT_BODY =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';
const FONT_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/**
 * The Vega config. Merged UNDER a model's spec, so a spec that deliberately
 * sets a scale or an axis still wins — this only supplies what it left out,
 * which in practice is everything visual.
 */
export function srVegaConfig(): Record<string, unknown> {
  return {
    background: null,
    font: FONT_BODY,
    padding: 4,
    // Recessive chrome: the data is the only thing that carries weight.
    axis: {
      labelFont: FONT_MONO,
      labelFontSize: 10,
      labelColor: INK_MUTED,
      labelPadding: 6,
      titleFont: FONT_MONO,
      titleFontSize: 10,
      titleFontWeight: 500,
      titleColor: INK_MUTED,
      titlePadding: 10,
      domainColor: HAIRLINE,
      tickColor: HAIRLINE,
      tickSize: 4,
      grid: false,
      labelAngle: 0,
    },
    axisY: { grid: true, gridColor: HAIRLINE, gridDash: [], domain: false, ticks: false },
    axisX: { grid: false },
    view: { stroke: null, continuousWidth: 400, continuousHeight: 220 },
    // A legend is always present for >= 2 series: it is the secondary encoding
    // the orange/green pair depends on, not a nicety.
    legend: {
      labelFont: FONT_BODY,
      labelFontSize: 11,
      labelColor: INK,
      titleFont: FONT_MONO,
      titleFontSize: 10,
      titleColor: INK_MUTED,
      symbolType: 'square',
      symbolSize: 90,
      orient: 'right',
    },
    title: {
      font: FONT_BODY,
      fontSize: 13,
      fontWeight: 600,
      color: INK,
      anchor: 'start',
      offset: 10,
    },
    range: {
      category: [...CHART_CATEGORICAL],
      ordinal: [...CHART_SEQUENTIAL],
      ramp: [...CHART_SEQUENTIAL],
      diverging: [...CHART_DIVERGING],
    },
    // Thin marks, rounded data-ends, a surface-coloured gap between fills.
    bar: { fill: ACCENT, cornerRadiusEnd: 4, stroke: SURFACE, strokeWidth: 2 },
    line: { stroke: ACCENT, strokeWidth: 2, strokeCap: 'round' },
    point: { fill: ACCENT, size: 64, stroke: SURFACE, strokeWidth: 2 },
    area: { fill: ACCENT, fillOpacity: 0.18, line: { strokeWidth: 2 } },
    arc: { stroke: SURFACE, strokeWidth: 2 },
    rect: { stroke: SURFACE, strokeWidth: 1 },
    text: { font: FONT_BODY, fontSize: 11, fill: INK },
    rule: { stroke: HAIRLINE },
  };
}

/** Encoding channels whose domain a model means positionally, not alphabetically. */
const POSITIONAL = ['x', 'y', 'xOffset', 'yOffset'] as const;

/**
 * Keep a discrete axis in the order the rows were written.
 *
 * Vega-Lite's default for a nominal/ordinal domain is an alphabetical sort, so
 * a week of data comes out "Fri Mon Sat Sun Thu Tue Wed" and a funnel comes out
 * scrambled. `sort: null` means "use data order", which is what a model that
 * wrote the rows in sequence intended.
 *
 * Only fills a gap: an explicit `sort` (including a sort-by-another-field
 * object) is left exactly as written, and temporal/quantitative channels are
 * untouched because their natural order is already numeric. Recurses through
 * `layer`, `hconcat`, `vconcat`, `facet` and `spec` so a composed chart gets
 * the same treatment as a flat one.
 */
export function applyNaturalSort(spec: Record<string, unknown>): void {
  const enc = spec.encoding as Record<string, Record<string, unknown>> | undefined;
  if (enc && typeof enc === 'object') {
    for (const channel of POSITIONAL) {
      const def = enc[channel];
      if (!def || typeof def !== 'object') continue;
      if ('sort' in def) continue;
      if (def.type === 'nominal' || def.type === 'ordinal') def.sort = null;
    }
  }
  for (const key of ['layer', 'hconcat', 'vconcat', 'concat']) {
    const branch = spec[key];
    if (Array.isArray(branch)) {
      for (const child of branch) {
        if (child && typeof child === 'object') applyNaturalSort(child as Record<string, unknown>);
      }
    }
  }
  const nested = spec.spec;
  if (nested && typeof nested === 'object') applyNaturalSort(nested as Record<string, unknown>);
}
