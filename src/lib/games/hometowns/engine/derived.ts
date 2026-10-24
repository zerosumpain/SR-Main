// The month-step blackboard's empty form and each slot's NEUTRAL value: what a
// stub writes until its package lands, so every downstream package can run
// against the whole tick from day one. Neutral means "nothing happening, and
// nothing in the way": no supply or demand, every tile powered and watered,
// zero pollution and crime, middling access, ten-minute trips.

import { CELLS, DISTRICTS, TILES, decodeCells } from './tiles';
import {
  COHORT_COUNT,
  COVERAGES,
  LEDGER_LINES,
  SECTOR_COUNT,
  STAR_COUNT,
  type CoverageSlot,
  type DerivedCache,
  type DevelopmentSlot,
  type FieldsSlot,
  type FirmsSlot,
  type GoodsSlot,
  type HousingSlot,
  type LabourSlot,
  type LedgerSlot,
  type MigrationSlot,
  type MoodSlot,
  type NeedsSlot,
  type SpendSlot,
  type StarsSlot,
  type TourismSlot,
  type TownState,
  type TravelSlot,
  type UtilitiesSlot,
} from './types';

export const SLOT_NAMES = [
  'development', 'utilities', 'fields', 'coverage', 'travel', 'labour', 'housing', 'stars', 'needs',
  'migration', 'spend', 'firms', 'goods', 'tourism', 'ledger', 'mood',
] as const satisfies readonly (keyof DerivedCache)[];

export function newDerivedCache(): DerivedCache {
  return {
    development: null, utilities: null, fields: null, coverage: null, travel: null, labour: null, housing: null,
    stars: null, needs: null, migration: null, spend: null, firms: null, goods: null, tourism: null, ledger: null, mood: null,
  };
}

const z3 = () => [0, 0, 0];
const zN = (n: number) => new Array<number>(n).fill(0);
const fill = (n: number, v: number) => new Float64Array(n).fill(v);

export const neutral = {
  development(): DevelopmentSlot {
    return {
      cap: z3(), pipeline: z3(), jobs: zN(SECTOR_COUNT * 3), pipeJobs: zN(SECTOR_COUNT * 3), beds: 0,
      zoned: zN(6), built: zN(6), reachableHomes: [true, true, true], reachableZone: [true, true, true, true, true, true],
    };
  },
  utilities(): UtilitiesSlot {
    return {
      powered: new Uint8Array(TILES).fill(1), watered: new Uint8Array(TILES).fill(1),
      powerSupply: 0, powerDemand: 0, waterSupply: 0, waterDemand: 0, powerImported: 0, waterImported: 0,
      powerExported: 0, waterExported: 0, importCost: 0, exportIncome: 0, cutTiles: 0, poweredShare: 1, wateredShare: 1,
    };
  },
  fields(t: TownState): FieldsSlot {
    const lv = t.lv ? decodeCells(t.lv) : new Uint8Array(CELLS).fill(1);
    return {
      pollution: fill(CELLS, 0), noise: fill(CELLS, 0), crime: fill(CELLS, 0), lvTarget: Float64Array.from(lv),
      jobsAccess: fill(CELLS, 50), custAccess: fill(CELLS, 50), freight: fill(CELLS, 50), visitorAccess: fill(CELLS, 0),
      pollutionPop: 0, safety: 100, gini: 0, crimePressure: 0, scenic: fill(CELLS, 0),
    };
  },
  coverage(t: TownState): CoverageSlot {
    return {
      cov: COVERAGES.map(() => fill(CELLS, 0)), town: zN(COVERAGES.length),
      seats: { primary: 0, secondary: 0, university: 0 }, pupils: { primary: 0, secondary: 0, university: 0 },
      healthCap: 0, eduQ: [0, 0, 0], libraryShare: 0, healthCovered: 0, healthQuality: 0, funVenue: false,
      staffDemand: z3(), effect: fill(t.buildings.length, 1),
    };
  },
  travel(): TravelSlot {
    return {
      port: new Int16Array(DISTRICTS).fill(-1), minutes: fill(DISTRICTS * DISTRICTS, 10), load: fill(TILES, 0),
      bpr: new Array<number>(DISTRICTS).fill(1), avgCommute: [10, 10, 10], congestion: 0,
      toSignpost: [fill(DISTRICTS, 10), fill(DISTRICTS, 10), fill(DISTRICTS, 10)], busShare: 0, railShare: 0,
    };
  },
  labour(): LabourSlot {
    return {
      workforce: z3(), jobSlots: z3(), employed: z3(), unemployed: z3(), underemployed: z3(), trainees: z3(), vacancies: z3(),
      sectorJobs: zN(SECTOR_COUNT), sectorFilled: zN(SECTOR_COUNT), fillRate: zN(SECTOR_COUNT),
      civicStaffNeeded: z3(), civicStaffFilled: z3(), staffFill: 1, wage: z3(), prod: 1, effJobs: 0,
      income: z3(), incomePerPerson: z3(), support: 0, pensions: 0, commutersIn: z3(), commutersOut: z3(),
    };
  },
  housing(): HousingSlot {
    return {
      cap: z3(), pipeline: z3(), occ: z3(), vacant: z3(), rent: z3(), rentShare: z3(), afford: [100, 100, 100],
      squeezed: 0, target: z3(), reachable: [true, true, true],
    };
  },
  stars(t: TownState): StarsSlot {
    return { actual: t.perceived.length === STAR_COUNT ? [...t.perceived] : new Array<number>(STAR_COUNT).fill(50), uHappy: zN(COHORT_COUNT) };
  },
  needs(): NeedsSlot {
    return { tier: [1, 1, 1], cohort: new Array<number>(COHORT_COUNT).fill(1), unmet: z3(), items: [[], [], []] };
  },
  migration(towns: number): MigrationSlot {
    return { movers: zN(COHORT_COUNT), leavers: zN(COHORT_COUNT), arrivals: zN(COHORT_COUNT), intents: zN(towns * COHORT_COUNT), utility: zN(COHORT_COUNT) };
  },
  spend(): SpendSlot {
    return { retail: 0, leisure: 0, shoppersOut: 0, shoppersIn: 0, visitorShops: 0, visitorLeisure: 0, inCommuterRetail: 0, turnover: 0 };
  },
  firms(): FirmsSlot {
    const z = () => zN(SECTOR_COUNT);
    return { rev: z(), cost: z(), margin: z(), target: z(), jobs: z(), pipeJobs: z(), unfilled: z(), labourGate: z(), turnover: 0 };
  },
  goods(): GoodsSlot {
    return { production: [0, 0], localUse: [0, 0], allocatedOut: [0, 0], allocatedIn: [0, 0], exported: [0, 0], imported: [0, 0], exportPrice: [0, 0], importPrice: [0, 0] };
  },
  tourism(): TourismSlot {
    return { stays: 0, dayTrips: 0, beds: 0, attr: 0, quality: 1, satisfaction: 60, hotelNights: 0, spend: 0, visitorRatio: 0 };
  },
  ledger(t: TownState): LedgerSlot {
    return { lines: [...t.books.lines], revenue: 0, spending: 0, net: 0, monthsOfSpending: 0 };
  },
  mood(t: TownState): MoodSlot {
    let s = 0;
    for (let k = 0; k < COHORT_COUNT; k++) s += t.happy[k];
    return { mood: s / COHORT_COUNT, faces: [0, 0, 0, 0, 0], townTalk: [], wants: [], advisors: [] };
  },
};

/** For tests: an all-neutral cache, as if every package were still a stub. */
export function neutralCache(t: TownState, towns = 1): DerivedCache {
  return {
    development: neutral.development(), utilities: neutral.utilities(), fields: neutral.fields(t), coverage: neutral.coverage(t),
    travel: neutral.travel(), labour: neutral.labour(), housing: neutral.housing(), stars: neutral.stars(t), needs: neutral.needs(),
    migration: neutral.migration(towns), spend: neutral.spend(), firms: neutral.firms(), goods: neutral.goods(), tourism: neutral.tourism(),
    ledger: neutral.ledger(t), mood: neutral.mood(t),
  };
}

export const LEDGER_LINE_COUNT = LEDGER_LINES.length;
