// The page's one door into the engine. The map page runs exactly the
// server's engine source (spec §10.1: the bundle imports it from SR-Main's
// tree), so the page, the harness bot and the tests import it from here and
// nowhere else. If the engine moves, only these paths change.

export * from '../../../src/lib/games/hometowns/engine/index';
export type * from '../../../src/lib/games/hometowns/engine/wire';
export {
  BUILDINGS,
  NAME_FIRST,
  NAME_SECOND,
  ORDER_DEFAULTS,
  POLICIES,
  POLICY_SLOTS,
  RAIL_DEF,
  ROAD_DEFS,
  ZONE_DEFS,
  TIER_DEFS,
  buildingIndex,
  roadDef,
  type BuildingDef,
  type BuildingGroup,
} from '../../../src/lib/games/hometowns/engine/content';
export { formatPounds } from '../../../src/lib/games/hometowns/engine/num';
export { commitTown } from '../../../src/lib/games/hometowns/engine/core';
export { applyBuild, applyUndo, pathTiles, placeCost, type OpsEnv } from '../../../src/lib/games/hometowns/engine/ops';
export { checklistOf } from '../../../src/lib/games/hometowns/engine/tiers';
export { BOTS, botById, brambleCommands, viewOf, type BotView } from '../../../src/lib/games/hometowns/engine/bots/index';
// WP6 owns forecast.ts (A41): the paired, baseline-cached forecast behind the card.
export {
  bandOf,
  forecastPlan,
  forecastSamples,
  happyByFace,
  type Band,
  type ForecastSample,
  type PlanForecast,
  type SampleSet,
} from '../../../src/lib/games/hometowns/engine/forecast';
// The read-only explainers WP2a and WP2e wrote for the lenses and the inspector.
export { spaceAt } from '../../../src/lib/games/hometowns/engine/fields';
export { COV } from '../../../src/lib/games/hometowns/engine/services';
export { desirability, explainGrowth, type Place } from '../../../src/lib/games/hometowns/engine/develop';
export { readWhy, TERMS, QUANTITIES, type WhyEntry, type WhyRecord } from '../../../src/lib/games/hometowns/engine/why';
export { readHistory, readTileLog, HISTORY_SERIES, TILE_EVENTS, type TileEvent, type TileEventKind } from '../../../src/lib/games/hometowns/engine/records';
export { ADVISOR_RULES } from '../../../src/lib/games/hometowns/engine/advisors';
export { NEED_ITEMS, ladder } from '../../../src/lib/games/hometowns/engine/needs';
export {
  COUNTY_ROAD_X,
  COUNTY_ROAD_END_Y,
  TERRAIN_KINDS,
  TF_COAST,
  TF_RIVER,
  buildable,
  terrainElevation,
  terrainKind,
  terrainOf,
} from '../../../src/lib/games/hometowns/engine/terrain';
export {
  B_BUILT,
  B_DAMAGED,
  B_KIND,
  B_ROT,
  B_X,
  B_Y,
  CAT_BUILDING,
  CAT_RAIL,
  CAT_ROAD,
  CAT_ZONE,
  ALL_PARCELS,
  CELLS,
  CELLS_PER_SIDE,
  MAP,
  PARCEL,
  TILES,
  USE_EMPTY,
  cellOf,
  constructionLeft,
  decodeCells,
  footprint,
  inMap,
  lvlLevel,
  lvlStyle,
  lvlTier,
  openableParcels,
  parcelOf,
  parcelOpen,
  planesOf,
  roadAccess,
  tileIndex,
  tileX,
  tileY,
  useCat,
  usePayload,
} from '../../../src/lib/games/hometowns/engine/tiles';
