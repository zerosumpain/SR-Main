import { describe, it, expect } from 'vitest';
import {
  srVegaConfig,
  applyNaturalSort,
  CHART_CATEGORICAL,
} from '$lib/jkai/artifacts/vega-theme';

/**
 * The palette here is validated, not chosen — see the comment block in
 * `vega-theme.ts`. These tests are what stops a well-meaning edit from
 * re-introducing the colourblind failure or the alphabetical-week bug.
 */
describe('srVegaConfig', () => {
  it('carries the four validated categorical hues, in assignment order', () => {
    // The re-stepped green (#3a8658, not the field studies' original #2f7d4f)
    // is what clears the CVD floor against #b4632e. Changing it needs a re-run
    // of the dataviz palette validator, not a guess.
    expect(CHART_CATEGORICAL).toEqual(['#7a5aa6', '#b4632e', '#3a8658', '#8a2d3a']);
    expect(srVegaConfig().range).toMatchObject({ category: [...CHART_CATEGORICAL] });
  });

  it('never ships a fifth categorical hue', () => {
    // Past four, the rule is fold-into-other or facet — not a generated hue.
    expect(CHART_CATEGORICAL).toHaveLength(4);
  });

  it('paints a single series in the site accent, not a categorical hue', () => {
    const c = srVegaConfig() as Record<string, Record<string, unknown>>;
    expect(c.bar.fill).toBe('#c4570a');
    expect(c.line.stroke).toBe('#c4570a');
  });

  it('leaves the chart ground to the card, not a white plate', () => {
    expect(srVegaConfig().background).toBeNull();
  });

  it('keeps the legend on — it is the palette\'s secondary encoding', () => {
    // The orange/green pair clears CVD only in the 6-8 band, which is legal
    // solely alongside a non-colour cue. Dropping the legend breaks that.
    expect(srVegaConfig().legend).toBeTruthy();
  });
});

describe('applyNaturalSort', () => {
  it('keeps a discrete axis in data order', () => {
    const spec: Record<string, unknown> = {
      mark: 'bar',
      encoding: { x: { field: 'day', type: 'ordinal' }, y: { field: 'n', type: 'quantitative' } },
    };
    applyNaturalSort(spec);
    const enc = spec.encoding as Record<string, Record<string, unknown>>;
    expect(enc.x.sort).toBeNull();
    // A quantitative channel already sorts numerically; leave it alone.
    expect('sort' in enc.y).toBe(false);
  });

  it('does not overrule a sort the spec asked for', () => {
    const spec: Record<string, unknown> = {
      encoding: { x: { field: 'day', type: 'nominal', sort: '-y' } },
    };
    applyNaturalSort(spec);
    expect((spec.encoding as Record<string, Record<string, unknown>>).x.sort).toBe('-y');
  });

  it('reaches into layered and faceted specs', () => {
    const spec: Record<string, unknown> = {
      layer: [{ encoding: { x: { field: 'a', type: 'ordinal' } } }],
      spec: { encoding: { y: { field: 'b', type: 'nominal' } } },
    };
    applyNaturalSort(spec);
    const layer = (spec.layer as Array<Record<string, unknown>>)[0];
    expect((layer.encoding as Record<string, Record<string, unknown>>).x.sort).toBeNull();
    const nested = spec.spec as Record<string, unknown>;
    expect((nested.encoding as Record<string, Record<string, unknown>>).y.sort).toBeNull();
  });

  it('survives a spec with no encoding at all', () => {
    const spec: Record<string, unknown> = { mark: 'bar' };
    expect(() => applyNaturalSort(spec)).not.toThrow();
  });
});
