// The fourteen lenses (spec §9.4). One tap greys the map and shows one field
// as a calm, colour-blind-safe five-step gradient with a legend; tapping a
// cell says why it is what it is ("+40 near jobs · +18 parks · −22 smoke").
// A Hamlet has two lenses (Happy and Land value); from Village all fourteen.
//
// The fields come from the engine itself: `spaceAt` recomputes utilities,
// coverage, fields and travel from stored state without writing anything
// (WP2a wrote it for exactly this), and the Desirability lens is WP2e's own
// L(x) for Homes. Everything here is pure, so it is unit-tested in Node and
// can run in the forecast worker if a big town ever needs it off the main
// thread.

import {
  CAT_BUILDING,
  CAT_ROAD,
  CAT_ZONE,
  CELLS,
  COV,
  MAP,
  ROAD_KINDS,
  TILES,
  Z_HOMES,
  cellOf,
  cohortsOf,
  decodeCells,
  desirability,
  lvlLevel,
  lvlTier,
  planesOf,
  roadDef,
  spaceAt,
  townContext,
  useCat,
  usePayload,
  type Params,
  type Place,
  type TickContext,
  type TownEnv,
  type TownState,
} from './engine';

export const LENS_IDS = [
  'happy',
  'landValue',
  'pollution',
  'noise',
  'safety',
  'schools',
  'health',
  'fun',
  'culture',
  'traffic',
  'utilities',
  'jobs',
  'visitors',
  'desirability',
] as const;
export type LensId = (typeof LENS_IDS)[number];
/** The map with no lens. */
export type LensOrNone = LensId | 'none';

export interface LensDef {
  id: LensId;
  label: string;
  group: 'Overview' | 'Environment' | 'Services' | 'Culture and movement' | 'Economy';
  /** Lowest town tier that has it (§9.4: a Hamlet has Happy and Land value only). */
  tier: number;
  /** Five step labels, low to high, for adults; `kid` for children (faces and plain words). */
  legend: readonly string[];
  kid: readonly string[];
  /** Step thresholds: a value at or above thresholds[k] reaches step k + 1. */
  steps: readonly number[];
  /** Units for the cell readout. */
  unit: string;
}

const FACES_KID = ['very sad', 'sad', 'okay', 'happy', 'very happy'];
const LOW_HIGH_KID = ['none', 'a little', 'some', 'lots', 'loads'];
const SVC = ['none', 'a little', 'some', 'good', 'great'];

export const LENS_DEFS: Record<LensId, LensDef> = {
  happy: { id: 'happy', label: 'Happy', group: 'Overview', tier: 0, legend: ['under 30', '30–44', '45–59', '60–74', '75 and up'], kid: FACES_KID, steps: [30, 45, 60, 75], unit: 'happiness' },
  landValue: { id: 'landValue', label: 'Land value', group: 'Overview', tier: 0, legend: ['under 40', '40–69', '70–99', '100–139', '140 and up'], kid: ['cheap', 'a bit', 'middling', 'pricey', 'very pricey'], steps: [40, 70, 100, 140], unit: 'land value' },
  pollution: { id: 'pollution', label: 'Pollution', group: 'Environment', tier: 1, legend: ['clean', 'a little', 'some', 'smoky', 'very smoky'], kid: ['clean', 'a little', 'some', 'smoky', 'very smoky'], steps: [5, 20, 40, 70], unit: 'smoke' },
  noise: { id: 'noise', label: 'Noise', group: 'Environment', tier: 1, legend: ['quiet', 'a little', 'some', 'loud', 'very loud'], kid: ['quiet', 'a little', 'some', 'loud', 'very loud'], steps: [5, 20, 40, 70], unit: 'noise' },
  safety: { id: 'safety', label: 'Safety', group: 'Services', tier: 1, legend: ['under 40', '40–54', '55–69', '70–84', '85 and up'], kid: ['worried', 'a bit worried', 'okay', 'safe', 'very safe'], steps: [40, 55, 70, 85], unit: 'safety' },
  schools: { id: 'schools', label: 'Schools', group: 'Services', tier: 1, legend: SVC, kid: SVC, steps: [15, 35, 55, 75], unit: 'school cover' },
  health: { id: 'health', label: 'Health', group: 'Services', tier: 1, legend: SVC, kid: SVC, steps: [15, 35, 55, 75], unit: 'health cover' },
  fun: { id: 'fun', label: 'Fun', group: 'Services', tier: 1, legend: SVC, kid: SVC, steps: [15, 35, 55, 75], unit: 'fun' },
  culture: { id: 'culture', label: 'Culture', group: 'Culture and movement', tier: 1, legend: SVC, kid: SVC, steps: [15, 35, 55, 75], unit: 'culture' },
  traffic: { id: 'traffic', label: 'Traffic', group: 'Culture and movement', tier: 1, legend: ['empty', 'light', 'busy', 'full', 'jammed'], kid: ['empty', 'a few cars', 'busy', 'full', 'stuck'], steps: [0.25, 0.5, 0.75, 1], unit: 'load ÷ capacity' },
  utilities: { id: 'utilities', label: 'Power & water', group: 'Culture and movement', tier: 1, legend: ['neither', '', 'one of the two', '', 'power and water'], kid: ['nothing', '', 'half', '', 'all on'], steps: [1, 2, 3, 4], unit: 'supplied' },
  jobs: { id: 'jobs', label: 'Jobs reach', group: 'Economy', tier: 1, legend: LOW_HIGH_KID, kid: LOW_HIGH_KID, steps: [10, 25, 45, 65], unit: 'jobs reach' },
  visitors: { id: 'visitors', label: 'Visitors', group: 'Economy', tier: 1, legend: LOW_HIGH_KID, kid: LOW_HIGH_KID, steps: [10, 25, 45, 65], unit: 'visitor reach' },
  desirability: { id: 'desirability', label: 'Desirability', group: 'Economy', tier: 1, legend: ['nobody', 'few', 'some', 'many', 'everyone'], kid: ['nobody', 'a few', 'some', 'lots', 'everyone'], steps: [-40, -10, 10, 40], unit: 'want to live here' },
};

/** The lenses this town has (§9.4), in menu order. */
export function lensesFor(tier: number): LensId[] {
  return LENS_IDS.filter((id) => LENS_DEFS[id].tier <= tier);
}

/** Which of the five steps (0–4) a value falls in. */
export function step5(v: number, thresholds: readonly number[]): number {
  let s = 0;
  for (let k = 0; k < thresholds.length && k < 4; k++) if (v >= thresholds[k]) s = k + 1;
  return s;
}

// ---- The space read ----------------------------------------------------------------------------

export type Space = ReturnType<typeof spaceAt>;

/** What the page needs to build a TickContext for its town (the wire's `predict` block, or the harness county). */
export interface SpaceEnv {
  env: TownEnv;
  townIndex: number;
  /** The instant to read at (the town's last tick end; only seasonality reads it). */
  at: number;
}

export function contextFor(t: TownState, s: SpaceEnv): TickContext {
  return townContext(t, s.townIndex, t.tick, s.env, s.at, false);
}

/** The fields at the town's current state (a few ms on a metropolis; callers cache it per state). */
export function readSpace(t: TownState, s: SpaceEnv): Space {
  return spaceAt(t, contextFor(t, s));
}

/** Lenses that need the space read (the rest read stored planes only). */
export function needsSpace(id: LensOrNone): boolean {
  return id !== 'none' && id !== 'happy' && id !== 'landValue';
}

/** A cell's measured Place (the same shape WP2e reads for growth), for Desirability and the inspector. */
export function placeAt(t: TownState, space: Space, cell: number, lv = decodeCells(t.lv)): Place {
  const c = (k: number) => space.coverage.cov[k]?.[cell] ?? 0;
  const f = space.fields;
  const crime = f.crime[cell];
  return {
    lv: lv[cell],
    poll: f.pollution[cell],
    noise: f.noise[cell],
    safety: 100 - crime,
    crime,
    school: c(COV.school),
    nature: c(COV.nature),
    cust: f.custAccess[cell],
    visitor: f.visitorAccess[cell],
    freight: f.freight[cell],
    fun: c(COV.fun),
    culture: c(COV.culture),
    transit: c(COV.transit),
  };
}

/** Happiness of the people living at a Homes tier: a population-weighted mean of its three cohorts. */
export function tierHappiness(t: TownState, tier: number): number {
  const n = cohortsOf(t);
  let w = 0;
  let s = 0;
  for (let kind = 0; kind < 3; kind++) {
    const k = tier * 3 + kind;
    w += n[k];
    s += n[k] * (t.happy[k] ?? 0);
  }
  return w > 0 ? s / w : (t.happy[tier * 3 + 1] ?? 50);
}

export interface LensData {
  id: LensId;
  /** Step 0–4 per tile, 255 where the lens says nothing. */
  steps: Uint8Array;
  /** The raw value per tile (NaN where it says nothing), for the cell readout. */
  values: Float32Array;
  /** A town-wide line under the legend ("Seats used: 180 of 260"). */
  note: string | null;
}

/** One lens over the whole map. `space` is required for every lens except Happy and Land value. */
export function lensData(id: LensId, t: TownState, space: Space | null, params: Params): LensData {
  const def = LENS_DEFS[id];
  const steps = new Uint8Array(TILES).fill(255);
  const values = new Float32Array(TILES).fill(NaN);
  const p = planesOf(t);
  let note: string | null = null;
  const perCell = (cells: ArrayLike<number>, only?: (i: number) => boolean) => {
    for (let i = 0; i < TILES; i++) {
      if (only && !only(i)) continue;
      const v = cells[cellOf(i)];
      values[i] = v;
      steps[i] = step5(v, def.steps);
    }
  };
  switch (id) {
    case 'happy': {
      const byTier = [0, 1, 2].map((h) => tierHappiness(t, h));
      for (let i = 0; i < TILES; i++) {
        const u = p.use[i];
        if (useCat(u) !== CAT_ZONE || usePayload(u) !== Z_HOMES || lvlLevel(p.lvl[i]) === 0) continue;
        const v = byTier[lvlTier(p.lvl[i])] ?? byTier[0];
        values[i] = v;
        steps[i] = step5(v, def.steps);
      }
      break;
    }
    case 'landValue':
      perCell(decodeCells(t.lv));
      break;
    case 'pollution':
      perCell(need(space).fields.pollution);
      break;
    case 'noise':
      perCell(need(space).fields.noise);
      break;
    case 'safety': {
      const crime = need(space).fields.crime;
      const safe = new Float64Array(CELLS);
      for (let c = 0; c < CELLS; c++) safe[c] = 100 - crime[c];
      perCell(safe);
      break;
    }
    case 'schools': {
      const s = need(space);
      perCell(s.coverage.cov[COV.school]);
      const seats = s.coverage.seats.primary + s.coverage.seats.secondary;
      const pupils = s.coverage.pupils.primary + s.coverage.pupils.secondary;
      note = `Seats used: ${Math.round(pupils)} of ${Math.round(seats)}`;
      break;
    }
    case 'health':
      perCell(need(space).coverage.cov[COV.health]);
      break;
    case 'fun':
      perCell(need(space).coverage.cov[COV.fun]);
      break;
    case 'culture':
      perCell(need(space).coverage.cov[COV.culture]);
      break;
    case 'traffic': {
      const load = need(space).travel.load;
      for (let i = 0; i < TILES; i++) {
        const u = p.use[i];
        if (useCat(u) !== CAT_ROAD) continue;
        const cap = roadDef(ROAD_KINDS[usePayload(u)]).capacity;
        const v = cap > 0 ? load[i] / cap : 0;
        values[i] = v;
        steps[i] = step5(v, def.steps);
      }
      break;
    }
    case 'utilities': {
      const u = need(space).utilities;
      for (let i = 0; i < TILES; i++) {
        const cat = useCat(p.use[i]);
        if (cat !== CAT_BUILDING && !(cat === CAT_ZONE && lvlLevel(p.lvl[i]) > 0)) continue;
        const v = (u.powered[i] ? 2 : 0) + (u.watered[i] ? 2 : 0);
        values[i] = v;
        steps[i] = v;
      }
      note = `Power ${Math.round(u.powerSupply)} for ${Math.round(u.powerDemand)} · water ${Math.round(u.waterSupply)} for ${Math.round(u.waterDemand)}`;
      break;
    }
    case 'jobs':
      perCell(need(space).fields.jobsAccess);
      break;
    case 'visitors':
      perCell(need(space).fields.visitorAccess);
      break;
    case 'desirability': {
      const s = need(space);
      const lv = decodeCells(t.lv);
      const cells = new Float64Array(CELLS);
      for (let c = 0; c < CELLS; c++) cells[c] = desirability(Z_HOMES, placeAt(t, s, c, lv), params.develop);
      perCell(cells);
      note = 'Where would families like to live?';
      break;
    }
  }
  return { id, steps, values, note };
}

function need(space: Space | null): Space {
  if (!space) throw new Error('this lens needs the space read');
  return space;
}

// ---- "Why is it 140 here?" ------------------------------------------------------------------------

/** Plain words for the land value terms (WP8's copy file replaces these once it lands). */
const LV_WORDS: Record<string, string> = {
  'lv.base': 'any land',
  'lv.jobs': 'near jobs',
  'lv.nature': 'parks and nature',
  'lv.school': 'schools',
  'lv.health': 'health care',
  'lv.culture': 'culture',
  'lv.transit': 'buses and trains',
  'lv.scenic': 'the view',
  'lv.premium': 'the town’s name',
  'lv.pollution': 'smoke',
  'lv.noise': 'noise',
  'lv.crime': 'safety worries',
  'lv.bonus': 'landmarks',
  'lv.potholes': 'potholes',
};

export interface CellWhy {
  lens: LensId;
  x: number;
  y: number;
  value: number | null;
  /** A one-line reading, e.g. "Land value 140: +40 near jobs · +18 parks and nature · −22 smoke". */
  line: string;
  terms: [label: string, amount: number][];
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v))}`;

/** The readout for a tapped cell under a lens (§9.4). */
export function cellWhy(id: LensId, data: LensData, space: Space | null, x: number, y: number): CellWhy {
  const def = LENS_DEFS[id];
  const i = y * MAP + x;
  const raw = data.values[i];
  const value = Number.isNaN(raw) ? null : raw;
  let terms: [string, number][] = [];
  if (id === 'landValue' && space) {
    terms = space
      .lvTerms(cellOf(i))
      .filter(([k, v]) => k !== 'lv.base' && Math.abs(v) >= 0.5)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([k, v]) => [LV_WORDS[k] ?? k, v]);
  }
  const shown = value === null ? 'nothing here' : id === 'traffic' ? `${Math.round(value * 100)}% full` : String(Math.round(value));
  const line = `${def.label} ${shown}${terms.length ? ': ' + terms.map(([k, v]) => `${signed(v)} ${k}`).join(' · ') : ''}`;
  return { lens: id, x, y, value, line, terms };
}
