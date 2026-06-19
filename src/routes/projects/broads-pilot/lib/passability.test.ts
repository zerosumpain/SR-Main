import { describe, it, expect } from 'vitest';
import {
  SAFETY_MARGIN_M,
  groundSpeedMs,
  bridgeVerdict,
  edgeVerdict,
  edgePassable,
} from './passability';
import type { Bridge, Boat, GraphEdge, Restrictions } from './types';

// ---- fixtures ----
const potter: Bridge = {
  id: 'p',
  name: 'Potter Heigham',
  river: 'Thurne',
  clearance_ahw_m: 1.98,
  clearance_band_m: [1.98, 2.03],
  tide_dependent: true,
  pilot: 'mandatory',
  opens_on_request: false,
  practically_closed: true,
  notes: '',
  lat: 52.71,
  lng: 1.58,
};
const acle: Bridge = {
  id: 'a',
  name: 'Acle',
  river: 'Bure',
  clearance_ahw_m: 3.66,
  clearance_band_m: [3.66, 3.66],
  tide_dependent: false,
  pilot: null,
  opens_on_request: false,
  notes: '',
  lat: 52.64,
  lng: 1.55,
};

const boat = (over: Partial<Boat> = {}): Boat => ({
  slug: 'generic',
  name: 'Generic',
  class: 'generic',
  propulsion: 'diesel',
  sleeps: 4,
  air_draft_ft: 0,
  air_draft_m: 3.0,
  bridges_blocked: [],
  ...over,
});

describe('passability constants & helpers', () => {
  it('SAFETY_MARGIN_M is 0.3', () => {
    expect(SAFETY_MARGIN_M).toBe(0.3);
  });
  it('groundSpeedMs converts mph→m/s', () => {
    expect(groundSpeedMs(1)).toBeCloseTo(0.44704, 5);
    expect(groundSpeedMs(6)).toBeCloseTo(2.68224, 5);
  });
});

describe('bridgeVerdict', () => {
  it('Potter (practically_closed) blocks a generic boat at air 2.3', () => {
    expect(bridgeVerdict(potter, boat({ air_draft_m: 2.3 }))).toBe('blocked');
  });
  it('Acle: air 3.0 → pass (3.0 ≤ 3.66 − 0.3)', () => {
    expect(bridgeVerdict(acle, boat({ air_draft_m: 3.0 }))).toBe('pass');
  });
  it('Acle: air 3.4 → marginal (within safety margin)', () => {
    expect(bridgeVerdict(acle, boat({ air_draft_m: 3.4 }))).toBe('marginal');
  });
  it('Acle: air 3.7 → blocked (over clearance)', () => {
    expect(bridgeVerdict(acle, boat({ air_draft_m: 3.7 }))).toBe('blocked');
  });
  it('bridge in bridges_blocked → blocked regardless of clearance', () => {
    expect(
      bridgeVerdict(acle, boat({ air_draft_m: 3.0, bridges_blocked: ['a'] })),
    ).toBe('blocked');
  });
  it('practically_closed + class !== dayboat → blocked even at low air draft', () => {
    expect(bridgeVerdict(potter, boat({ air_draft_m: 1.5, class: 'modern' }))).toBe(
      'blocked',
    );
  });
  it('practically_closed + class === dayboat + low air draft → pass', () => {
    expect(
      bridgeVerdict(potter, boat({ air_draft_m: 1.5, class: 'dayboat' })),
    ).toBe('pass');
  });
});

// ---- edge fixtures ----
const restrictions: Restrictions = {
  bridges: [potter, acle],
  lock: {
    id: 'l',
    name: 'lock',
    max_loa_m: 0,
    max_beam_m: 0,
    max_draft_m: 0,
    hours: '',
    booking: '',
    notes: '',
    lat: 0,
    lng: 0,
  },
  zones: [],
};

const edge = (over: Partial<GraphEdge> = {}): GraphEdge => ({
  id: 'e',
  from: 'x',
  to: 'y',
  length_m: 100,
  limit_mph: 5,
  river: 'Bure',
  way_id: 1,
  geometry: [],
  restriction_ids: [],
  ...over,
});

describe('edgeVerdict', () => {
  it('no restrictions → pass', () => {
    expect(edgeVerdict(edge(), restrictions, boat({ air_draft_m: 3.0 }))).toBe(
      'pass',
    );
  });
  it('returns worst verdict among the edge bridges', () => {
    const e = edge({ restriction_ids: ['a', 'p'] }); // acle pass-ish + potter blocked
    expect(edgeVerdict(e, restrictions, boat({ air_draft_m: 3.0 }))).toBe(
      'blocked',
    );
  });
  it('marginal when the only bridge is marginal', () => {
    const e = edge({ restriction_ids: ['a'] });
    expect(edgeVerdict(e, restrictions, boat({ air_draft_m: 3.4 }))).toBe(
      'marginal',
    );
  });
  it('blocked when boat beam exceeds edge.max_beam_m', () => {
    const e = edge({ max_beam_m: 3.5 });
    expect(
      edgeVerdict(e, restrictions, boat({ air_draft_m: 3.0, beam_m: 4.0 })),
    ).toBe('blocked');
  });
  it('blocked when boat water_draft exceeds edge.max_draft_m', () => {
    const e = edge({ max_draft_m: 1.0 });
    expect(
      edgeVerdict(e, restrictions, boat({ air_draft_m: 3.0, water_draft_m: 1.5 })),
    ).toBe('blocked');
  });
  it('null edge beam/draft fields are ignored', () => {
    const e = edge({ max_beam_m: null, max_draft_m: null });
    expect(
      edgeVerdict(
        e,
        restrictions,
        boat({ air_draft_m: 3.0, beam_m: 4.0, water_draft_m: 2.0 }),
      ),
    ).toBe('pass');
  });
});

describe('edgePassable', () => {
  it('true when verdict is pass', () => {
    expect(edgePassable(edge(), restrictions, boat({ air_draft_m: 3.0 }))).toBe(
      true,
    );
  });
  it('true when verdict is marginal', () => {
    const e = edge({ restriction_ids: ['a'] });
    expect(edgePassable(e, restrictions, boat({ air_draft_m: 3.4 }))).toBe(true);
  });
  it('false when blocked', () => {
    const e = edge({ restriction_ids: ['p'] });
    expect(edgePassable(e, restrictions, boat({ air_draft_m: 1.5 }))).toBe(false);
  });
});
