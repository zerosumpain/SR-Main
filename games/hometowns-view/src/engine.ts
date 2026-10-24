// The page's one door into the engine. The map page runs exactly the
// server's engine source (spec §10.1: the bundle imports it from SR-Main's
// tree), so the page, the harness bot and the tests import it from here and
// nowhere else. If the engine moves, only these paths change.

export * from '../../../src/lib/games/hometowns/engine/index';
export { BUILDINGS, ZONE_DEFS, TIER_DEFS, buildingIndex, roadDef, type BuildingDef } from '../../../src/lib/games/hometowns/engine/content';
export { formatPounds } from '../../../src/lib/games/hometowns/engine/num';
export { placeCost } from '../../../src/lib/games/hometowns/engine/ops';
export { checklistOf } from '../../../src/lib/games/hometowns/engine/tiers';
export { BOTS, botById, brambleCommands, viewOf, type BotView } from '../../../src/lib/games/hometowns/engine/bots/index';
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
