// The engine's public API (spec §10.3): the one interface the server adapter,
// the map page, the bots and the Lab all code against. Pure and import-free
// beyond the engine's own files.

import { hashOf } from './hash';
import type { CountyState, TownState } from './types';
import type { Params } from './params';

export { createCounty, foundTown, regionalDay, catchUp, behind, townIndexOf, terrainLandValue, type CreateCountyInput, type DriveOptions } from './county';
export { applyCommand, moveId, HANDLERS, LOG_KEEP, type MoveHandler } from './commands';
export { tickTown, monthStep, sprintTick, makeContext, townContext, catchUpTown, tickCost, type TownEnv } from './tick';
export { snapshotOf, publicCard, cohortsOf, facesOf, inFortnight } from './snapshot';
export { forecast, type ForecastOptions } from './forecast';
export { STEPS, withSteps } from './steps';
export { paramsFor, paramsFile, resolveParams, leafPaths, byRivalry, PARAMS_VERSIONS, type Params, type ParamsVersion, type ParamLeaf } from './params';
export { checkTown, checkCounty } from './invariants';
export { postMoney, postWhole, postPeople, moveStock, flow, population, flowsFor, lineIndex, flowIndex } from './core';
export {
  gridTickAt,
  gridEndAt,
  nextRegionalDayAt,
  effectiveNow,
  napCheck,
  napStartAt,
  hello,
  setPause,
  calendarMonth,
  countyMonth,
  isCountyWeek,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
} from './clock';
export { worldAt, eventAt, slowdownAhead } from './world';
// WP3 (the county layer): what the adapter and the wire read beyond county state itself.
export { countyExpiry, type Expiry } from './expiry';
export { regionOf, countyMoney, countyMedian, pairLinks } from './region-state';
export { offerOpen, runningContracts } from './offers';
export { advertCost, STICKERS, type Sticker } from './social';
export { countyWeekDue } from './county-week';
export { canonical, fnv64, hashOf } from './hash';
export { ENGINE_HASH } from './engine-hash.generated';
export * from './types';

/** §10.3 stateHash: FNV-1a 64 of the town's canonical serialisation (the canary). */
export function stateHash(t: TownState): string {
  return hashOf(t);
}

/** The whole county's hash (determinism tests, the Lab). */
export function countyHash(c: CountyState): string {
  return hashOf(c);
}

/** A params version hash: two counties with equal hashes run the same rules. */
export function paramsHash(p: Params): string {
  return hashOf(p);
}
