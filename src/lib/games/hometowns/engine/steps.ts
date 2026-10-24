// The step table: the fixed order of the tick (spec §5.2, A18), the month
// step M1–M14 (§5.3, with A41's M7a/b/c split) and the Regional Day (§8.3).
// This is how packages plug in. Each entry names its owner and the
// blackboard slots it writes; the driver (tick.ts) enforces that a step sets
// only the slots it declares and never replaces a slot another step set.
//
// TO LAND A PACKAGE: implement the step in your own file with the stub's
// signature, then repoint ONLY your import line below, e.g.
//   import { stepUtilities } from './utilities';
// and use it in your row. Do not reorder rows: the order is the design.

import { constructionStep } from './construction';
import { coreCloseDay, corePublish } from './dayclose';
import {
  stubBulletin,
  stubCloseBooks,
  stubCountyWeek,
  stubDeliver,
  stubDemography,
  stubDevelop,
  stubDevelopMemo,
  stubFields,
  stubFinance,
  stubFixFlows,
  stubGreatWork,
  stubHouseholds,
  stubHappiness,
  stubHousing,
  stubLabour,
  stubMigration,
  stubMoveMoney,
  stubPlayerMigration,
  stubRecords,
  stubStars,
  stubSupply,
  stubTaxReceipts,
  stubTransport,
  stubUtilities,
  stubYearEnd,
} from './stubs';
import type { StepTable } from './types';

// ---- WP2a (space) ----
import { stepUtilities } from './utilities';
import { stepFields } from './fields';
import { stepTransport } from './transport';
void [stubUtilities, stubFields, stubTransport]; // WP2a landed; the stubs stay for off-rule runs
// ---- WP2b (people) ----
import { stepLabour } from './labour';
import { stepHouseholds, stepHousing } from './housing';
import { stepDemography } from './people';
import { stepStars } from './needs';
import { stepMigration } from './migration';
// ---- WP2c (market) ----
import { stepTourism } from './tourism';
import { stepSpending } from './trade';
import { stepFirms } from './business';
// ---- WP2d (civic) ----
import { stepFinance, stepTaxReceipts } from './finance';
import { stepHappiness, stepRecords } from './mood';
import { stepTierCheck } from './tiers';
void [stubTaxReceipts, stubFinance, stubHappiness, stubRecords]; // WP2d landed; the stubs stay for off-rule runs
// ---- WP2e (development) ----
import { stepDevelop, stepDevelopMemo, stepSupply } from './develop';
void [stubDevelop, stubSupply, stubDevelopMemo]; // WP2e landed; the stubs stay for off-rule runs
// ---- WP3 (county) ----
const stepCloseBooks = stubCloseBooks; // → './regional-day'
const stepMoveMoney = stubMoveMoney; // → './regional-day'
const stepPlayerMigration = stubPlayerMigration; // → './region'
const stepFixFlows = stubFixFlows; // → './region'
const stepGreatWork = stubGreatWork; // → './greatworks'
const stepDeliver = stubDeliver; // → './regional-day'
const stepYearEnd = stubYearEnd; // → './regional-day' (tier checks: './tiers', WP2d)
const stepCountyWeek = stubCountyWeek; // → './county-week'
const stepBulletin = stubBulletin; // → './bulletin'

/** M1 World: the World is computed into the context before the steps run (§5.16); nothing to write. */
const stepWorld = () => {};

export const STEPS: StepTable = {
  // A18: moves with atTick = t (the driver), then these, then the month step when t mod 4 = 3.
  tick: [
    { id: 'construction', owner: 'WP1', run: constructionStep },
    { id: 'develop', owner: 'WP2e', run: stepDevelop },
  ],
  month: [
    { id: 'M1 world', owner: 'WP1', writes: [], run: stepWorld },
    { id: 'M1b supply', owner: 'WP2e', writes: ['development'], run: stepSupply },
    { id: 'M2 utilities', owner: 'WP2a', writes: ['utilities'], run: stepUtilities },
    { id: 'M3 fields', owner: 'WP2a', writes: ['fields', 'coverage'], run: stepFields },
    { id: 'M4 transport', owner: 'WP2a', writes: ['travel'], run: stepTransport },
    { id: 'M5 labour', owner: 'WP2b', writes: ['labour'], run: stepLabour },
    { id: 'M6 tourism', owner: 'WP2c', writes: ['tourism'], run: stepTourism },
    { id: 'M7a households', owner: 'WP2b', writes: ['housing'], run: stepHouseholds },
    { id: 'M7b spending', owner: 'WP2c', writes: ['spend', 'goods'], run: stepSpending },
    { id: 'M7c tax receipts', owner: 'WP2d', writes: ['ledger'], run: stepTaxReceipts },
    { id: 'M8 firms', owner: 'WP2c', writes: ['firms'], run: stepFirms },
    { id: 'M9 demography', owner: 'WP2b', writes: [], run: stepDemography },
    { id: 'M10 stars', owner: 'WP2b', writes: ['stars', 'needs'], run: stepStars },
    // §5.3 M10 ends with happiness, so M11 reads this month's (WP2d's half of M10).
    { id: 'M10b happiness', owner: 'WP2d', writes: [], run: stepHappiness },
    { id: 'M11 migration', owner: 'WP2b', writes: ['migration'], run: stepMigration },
    { id: 'M12 housing', owner: 'WP2b', writes: [], run: stepHousing },
    { id: 'M13 finance', owner: 'WP2d', writes: [], run: stepFinance },
    { id: 'M14 records', owner: 'WP2d', writes: ['mood'], run: stepRecords },
    // WP2e addition: last month step, it keeps this month's fields for the next four ticks' development rolls.
    { id: 'M14b develop memo', owner: 'WP2e', writes: [], run: stepDevelopMemo },
  ],
  // §8.3: step 0 (sprints and catch-up) is the driver's; steps 1–8 and 10 are WP3's; 7's bookkeeping and 9 are WP1's.
  regional: [
    { id: '1 close books', owner: 'WP3', run: stepCloseBooks },
    { id: '2 move money', owner: 'WP3', run: stepMoveMoney },
    { id: '3 player migration', owner: 'WP3', run: stepPlayerMigration },
    { id: '4 fix flows', owner: 'WP3', run: stepFixFlows },
    { id: '5 great work', owner: 'WP3', run: stepGreatWork },
    { id: '6 deliver', owner: 'WP3', run: stepDeliver },
    { id: '7 year end', owner: 'WP3', run: stepYearEnd },
    { id: '7a tier check', owner: 'WP2d', run: stepTierCheck },
    { id: '7b close day', owner: 'WP1', run: coreCloseDay },
    { id: '8 county week', owner: 'WP3', run: stepCountyWeek },
    { id: '9 publish snapshot', owner: 'WP1', run: corePublish },
    { id: '10 bulletin', owner: 'WP3', run: stepBulletin },
  ],
};

/** A copy of the table with some step functions replaced (tests, the Lab's off-rule runs). */
export function withSteps(over: Partial<Record<string, StepTable['month'][number]['run'] | StepTable['tick'][number]['run'] | StepTable['regional'][number]['run']>>): StepTable {
  const pick = <T extends { id: string; run: unknown }>(rows: T[]): T[] => rows.map((r) => (over[r.id] ? { ...r, run: over[r.id] as T['run'] } : r));
  return { tick: pick(STEPS.tick), month: pick(STEPS.month), regional: pick(STEPS.regional) };
}
