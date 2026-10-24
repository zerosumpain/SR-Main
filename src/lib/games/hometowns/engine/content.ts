// The v1 catalogue (spec §6, with the A14 upkeeps): zones, roads, buildings,
// policies, deals, events, gifts, links, Great Works and the growth stages.
// This is data, not behaviour: the packages read it, the page draws its menus
// from it, and the Lab may tune any value. Named content.ts, not catalogue.ts
// (A35): src/lib/games/catalogue.ts is the games registry and
// $lib/access/catalogue.ts is hash-guarded across four repos.
//
// A building's numeric kind (stored in buildings[][B_KIND]) is its index in
// BUILDINGS, so the list is append-only.

import type { CoverageKind, DrawnRoad, FundingKey, SiteKind, Tier, ZoneKind } from './types';

// ---- Zones (§3.3) ---------------------------------------------------------------------

export interface ZoneDef {
  id: ZoneKind;
  unlock: Tier;
  /** Tiers above this cannot newly zone it (Farms: Hamlet–Town). */
  zoneUntil: Tier;
  /** Persons (Homes) or jobs per tile at L1–L5; 0 = no such level. */
  capacity: readonly number[];
  /** Leisure hotel-variant beds per tile at L1–L5. */
  beds?: readonly number[];
  /** Max level by town tier (Hamlet … Metropolis); 0 = not available. */
  tierCap: readonly number[];
  /** The lowest level a tile grows to (Offices start at L3). */
  minLevel: number;
}

export const ZONE_DEFS: readonly ZoneDef[] = [
  { id: 'homes', unlock: 0, zoneUntil: 4, capacity: [8, 20, 50, 120, 260], tierCap: [2, 3, 4, 5, 5], minLevel: 1 },
  { id: 'shops', unlock: 0, zoneUntil: 4, capacity: [3, 8, 20, 45, 90], tierCap: [1, 2, 3, 4, 5], minLevel: 1 },
  { id: 'leisure', unlock: 2, zoneUntil: 4, capacity: [3, 8, 18, 40, 80], beds: [0, 6, 20, 50, 110], tierCap: [0, 0, 3, 4, 5], minLevel: 1 },
  { id: 'industry', unlock: 0, zoneUntil: 4, capacity: [6, 15, 35, 70, 120], tierCap: [2, 2, 3, 4, 5], minLevel: 1 },
  { id: 'offices', unlock: 2, zoneUntil: 4, capacity: [0, 0, 60, 130, 260], tierCap: [0, 0, 3, 4, 5], minLevel: 3 },
  { id: 'farms', unlock: 0, zoneUntil: 2, capacity: [3, 0, 0, 0, 0], tierCap: [1, 1, 1, 1, 1], minLevel: 1 },
];

/**
 * Jobs' skill mix (£, ££, £££ shares) by SECTOR from L3 (§3.3). A2: L1
 * tiles of every sector hire £ only, L2 tiles hire 80/20/0.
 */
export const SECTOR_MIX: readonly (readonly number[])[] = [
  [0.9, 0.1, 0], // farms
  [0.7, 0.25, 0.05], // industry L1–L4 (L5 below)
  [0.6, 0.32, 0.08], // shops
  [0.6, 0.35, 0.05], // leisure and hotels
  [0.1, 0.5, 0.4], // offices
];
export const INDUSTRY_L5_MIX: readonly number[] = [0.4, 0.45, 0.15];
export const CIVIC_MIX: readonly number[] = [0.3, 0.5, 0.2];
export const ENTRY_MIX_L1: readonly number[] = [1, 0, 0];

/** The skill mix of one tile of `sector` at `level` (A2). L2's mix comes from params (labour.entryMixL2). */
export function tileMix(sector: number, level: number, l2: readonly number[]): readonly number[] {
  if (level <= 1) return ENTRY_MIX_L1;
  if (level === 2) return l2;
  if (sector === 1 && level >= 5) return INDUSTRY_L5_MIX;
  return SECTOR_MIX[sector];
}

// ---- Roads (§3.4) --------------------------------------------------------------------------

export interface RoadDef {
  id: DrawnRoad | 'county';
  unlock: Tier;
  build: number;
  upkeep: number;
  minutesPerTile: number;
  /** Trips per peak (rail: 0, stations carry riders). */
  capacity: number;
}

export const ROAD_DEFS: readonly RoadDef[] = [
  { id: 'lane', unlock: 0, build: 1500, upkeep: 8, minutesPerTile: 1.2, capacity: 300 },
  { id: 'street', unlock: 1, build: 4000, upkeep: 25, minutesPerTile: 0.8, capacity: 900 },
  { id: 'avenue', unlock: 2, build: 12000, upkeep: 60, minutesPerTile: 0.5, capacity: 2400 },
  // The County Road: built in at founding, free, cannot be bulldozed.
  { id: 'county', unlock: 0, build: 0, upkeep: 0, minutesPerTile: 0.5, capacity: 2400 },
];
export const RAIL_DEF: RoadDef = { id: 'rail', unlock: 3, build: 20000, upkeep: 90, minutesPerTile: 0.25, capacity: 0 };
export const RAIL_WAIT_MINUTES = 4;

export function roadDef(kind: DrawnRoad | 'county'): RoadDef {
  return kind === 'rail' ? RAIL_DEF : ROAD_DEFS.find((r) => r.id === kind)!;
}

// ---- Buildings (§6.1–§6.5) -------------------------------------------------------------------

/** Same-function groups, for the catalogue lint (A14). */
export type BuildingGroup =
  | 'civic' | 'transit' | 'freight' | 'gateway' | 'power' | 'water' | 'police' | 'fire' | 'health'
  | 'primary' | 'secondary' | 'library' | 'university' | 'park' | 'fun' | 'culture' | 'attraction' | 'youth' | 'landmark';

export interface BuildingDef {
  id: string;
  name: string;
  tier: Tier;
  w: number;
  h: number;
  /** £ to build (0 with `free`). */
  build: number;
  /** £ per month at Normal funding. */
  upkeep: number;
  /** Town Hall: + this per resident a month. */
  upkeepPerResident?: number;
  /** Public jobs (mix 30/50/20; Hamlet-tier buildings hire £ only, A2). */
  staff: number;
  /** Town Hall: + 1 staff per this many residents. */
  staffPerResidents?: number;
  /** Coverage radius in tiles; Infinity = the whole town. 0 = no coverage. */
  radius: number;
  cover?: Partial<Record<CoverageKind, number>>;
  /** People served (police, fire, health), or 0. */
  capacity?: number;
  /** School seats or university places. */
  seats?: number;
  supply?: { power?: number; water?: number };
  pollution?: number;
  noise?: number;
  appeal?: number;
  /** Culture points a month. */
  culture?: number;
  visitorCap?: number;
  /** Land value bonus within the radius. */
  lvBonus?: number;
  /** Placement rule. */
  requires?: 'coast' | 'water' | 'scenic' | 'river';
  /** Site kinds that change its supply (River's −40% on water facilities is the general rule in params.build). */
  siteMult?: { sites: readonly SiteKind[]; supply: number };
  group: BuildingGroup;
  /** Which funding dial scales it. */
  funding: FundingKey;
  /** At most one per town (Town Landmark) or placed only by the engine (Town Hall). */
  unique?: boolean;
  free?: boolean;
  /** School quality (School House 0.8, Village School 0.9). */
  quality?: number;
  note?: string;
}

const INF = Infinity;

export const BUILDINGS: readonly BuildingDef[] = [
  // Civic
  { id: 'townHall', name: 'Town Hall', tier: 0, w: 2, h: 2, build: 0, free: true, unique: true, upkeep: 300, upkeepPerResident: 1, staff: 4, staffPerResidents: 500, radius: 8, cover: { police: 15, fire: 10 }, group: 'civic', funding: 'police', note: 'free at founding' },
  // 6.1 Transit, freight and gateways
  { id: 'busDepot', name: 'Bus Depot', tier: 2, w: 2, h: 1, build: 60000, upkeep: 8000, staff: 6, radius: 0, group: 'transit', funding: 'transit', note: 'enables bus lines' },
  { id: 'busStop', name: 'Bus stop', tier: 2, w: 1, h: 1, build: 5000, upkeep: 4000, staff: 0, radius: 4, cover: { transit: 40 }, group: 'transit', funding: 'transit', note: 'on a road; upkeep is per line; mode share up to 35%' },
  { id: 'railStation', name: 'Rail Station', tier: 3, w: 3, h: 1, build: 250000, upkeep: 12000, staff: 20, radius: 8, cover: { transit: 70 }, group: 'transit', funding: 'transit', note: 'rail link node' },
  { id: 'freightYard', name: 'Rail Freight Yard', tier: 3, w: 4, h: 2, build: 150000, upkeep: 8000, staff: 0, radius: 0, group: 'freight', funding: 'transit', note: 'FreightScore +0.25 with a rail link' },
  { id: 'harbour', name: 'Harbour', tier: 2, w: 4, h: 3, build: 900000, upkeep: 20000, staff: 30, radius: 0, appeal: 8, requires: 'coast', group: 'freight', funding: 'transit', note: 'FreightScore +0.35' },
  { id: 'airfield', name: 'Airfield', tier: 3, w: 6, h: 3, build: 5000000, upkeep: 60000, staff: 60, radius: 0, noise: 80, pollution: 50, group: 'gateway', funding: 'transit', note: 'Outside World gate +0.2; offices outside demand +30%' },
  // 6.2 Power and water (A14 upkeeps)
  { id: 'well', name: 'Well', tier: 0, w: 1, h: 1, build: 1500, upkeep: 300, staff: 0, radius: 0, supply: { water: 300 }, group: 'water', funding: 'utilities' },
  { id: 'windmill', name: 'Windmill', tier: 0, w: 1, h: 1, build: 12000, upkeep: 720, staff: 0, radius: 0, supply: { power: 300 }, noise: 5, group: 'power', funding: 'utilities' },
  { id: 'generator', name: 'Generator', tier: 1, w: 1, h: 1, build: 20000, upkeep: 1320, staff: 0, radius: 0, supply: { power: 600 }, pollution: 20, group: 'power', funding: 'utilities' },
  { id: 'waterTower', name: 'Water Tower', tier: 1, w: 1, h: 1, build: 25000, upkeep: 2400, staff: 0, radius: 0, supply: { water: 3000 }, group: 'water', funding: 'utilities' },
  { id: 'windTurbine', name: 'Wind Turbine', tier: 2, w: 1, h: 1, build: 120000, upkeep: 2700, staff: 0, radius: 0, supply: { power: 1500 }, noise: 5, siteMult: { sites: ['hills', 'coast'], supply: 1.3 }, group: 'power', funding: 'utilities', note: '×1.3 on Hills and Coast' },
  { id: 'coalPlant', name: 'Coal Plant', tier: 2, w: 3, h: 3, build: 400000, upkeep: 28000, staff: 60, radius: 0, supply: { power: 20000 }, pollution: 140, group: 'power', funding: 'utilities', note: 'cheap and dirty' },
  { id: 'gasPlant', name: 'Gas Plant', tier: 2, w: 2, h: 3, build: 650000, upkeep: 36000, staff: 40, radius: 0, supply: { power: 20000 }, pollution: 60, group: 'power', funding: 'utilities' },
  { id: 'pumpingStation', name: 'Pumping Station', tier: 2, w: 2, h: 2, build: 180000, upkeep: 15000, staff: 10, radius: 0, supply: { water: 25000 }, group: 'water', funding: 'utilities' },
  { id: 'solarFarm', name: 'Solar Farm', tier: 3, w: 4, h: 4, build: 700000, upkeep: 6000, staff: 0, radius: 0, supply: { power: 8000 }, group: 'power', funding: 'utilities', note: 'clean' },
  { id: 'waterWorks', name: 'Water Works', tier: 3, w: 3, h: 3, build: 600000, upkeep: 45000, staff: 30, radius: 0, supply: { water: 100000 }, requires: 'water', group: 'water', funding: 'utilities', note: 'touching water' },
  // 6.3 Safety, fire and health (A14)
  { id: 'constablePost', name: 'Constable Post', tier: 1, w: 1, h: 1, build: 25000, upkeep: 6000, staff: 6, radius: 10, cover: { police: 40 }, capacity: 3000, group: 'police', funding: 'police' },
  { id: 'policeStation', name: 'Police Station', tier: 2, w: 2, h: 2, build: 250000, upkeep: 40000, staff: 30, radius: 18, cover: { police: 70 }, capacity: 25000, group: 'police', funding: 'police' },
  { id: 'fireVolunteers', name: 'Fire Volunteers', tier: 1, w: 1, h: 1, build: 20000, upkeep: 3000, staff: 6, radius: 10, cover: { fire: 40 }, capacity: 1500, group: 'fire', funding: 'fire' },
  { id: 'fireStation', name: 'Fire Station', tier: 2, w: 2, h: 2, build: 220000, upkeep: 40000, staff: 20, radius: 18, cover: { fire: 60 }, capacity: 25000, group: 'fire', funding: 'fire' },
  { id: 'surgery', name: "Doctor's Surgery", tier: 1, w: 1, h: 1, build: 30000, upkeep: 7500, staff: 8, radius: 10, cover: { health: 45 }, capacity: 2500, group: 'health', funding: 'health' },
  { id: 'healthCentre', name: 'Health Centre', tier: 2, w: 2, h: 2, build: 300000, upkeep: 30000, staff: 40, radius: 18, cover: { health: 65 }, capacity: 12000, group: 'health', funding: 'health' },
  { id: 'hospital', name: 'Hospital', tier: 3, w: 3, h: 4, build: 3000000, upkeep: 120000, staff: 600, radius: INF, cover: { health: 85 }, capacity: 60000, group: 'health', funding: 'health', note: 'shared places with linked towns within 40 min' },
  // 6.4 Education
  { id: 'schoolHouse', name: 'School House', tier: 0, w: 1, h: 1, build: 12000, upkeep: 4200, staff: 3, radius: 6, cover: { school: 60 }, seats: 60, quality: 0.8, group: 'primary', funding: 'education', note: 'primary-lite' },
  { id: 'villageSchool', name: 'Village School', tier: 1, w: 2, h: 1, build: 50000, upkeep: 12000, staff: 10, radius: 10, cover: { school: 70 }, seats: 200, quality: 0.9, group: 'primary', funding: 'education' },
  { id: 'primarySchool', name: 'Primary School', tier: 2, w: 2, h: 2, build: 400000, upkeep: 20000, staff: 15, radius: 12, cover: { school: 80 }, seats: 400, quality: 1, group: 'primary', funding: 'education' },
  { id: 'secondarySchool', name: 'Secondary School', tier: 2, w: 3, h: 3, build: 1400000, upkeep: 100000, staff: 45, radius: 20, cover: { school: 80 }, seats: 1200, quality: 1, group: 'secondary', funding: 'education' },
  { id: 'library', name: 'Library', tier: 2, w: 2, h: 1, build: 150000, upkeep: 20000, staff: 8, radius: 14, culture: 1.5, group: 'library', funding: 'education', note: 'Edu +15 within radius' },
  { id: 'university', name: 'University', tier: 3, w: 4, h: 4, build: 6000000, upkeep: 700000, staff: 600, radius: INF, seats: 6000, culture: 5, group: 'university', funding: 'education', note: 'students pay £150/month fees; unlocks Students' },
  // 6.5 Fun, culture and attractions
  { id: 'villageGreen', name: 'Village Green', tier: 0, w: 1, h: 1, build: 2000, upkeep: 300, staff: 0, radius: 6, cover: { fun: 25, nature: 25 }, culture: 0.2, visitorCap: 200, group: 'park', funding: 'fun' },
  { id: 'pocketPark', name: 'Pocket Park', tier: 0, w: 1, h: 1, build: 3000, upkeep: 300, staff: 0, radius: 4, cover: { fun: 20, nature: 15 }, visitorCap: 100, group: 'park', funding: 'fun' },
  { id: 'park', name: 'Park', tier: 1, w: 2, h: 2, build: 8000, upkeep: 1500, staff: 0, radius: 8, cover: { fun: 30, nature: 30 }, visitorCap: 400, group: 'park', funding: 'fun', note: 'absorbs pollution' },
  { id: 'playground', name: 'Playground', tier: 1, w: 1, h: 1, build: 5000, upkeep: 800, staff: 0, radius: 6, cover: { fun: 30 }, group: 'fun', funding: 'fun', note: 'Fun ×1.5 for Families' },
  { id: 'communityHall', name: 'Community Hall', tier: 1, w: 2, h: 1, build: 60000, upkeep: 5000, staff: 0, radius: 16, cover: { fun: 15 }, culture: 0.5, group: 'culture', funding: 'culture' },
  { id: 'viewpoint', name: 'Viewpoint / Pier', tier: 1, w: 1, h: 1, build: 15000, upkeep: 1000, staff: 0, radius: 0, appeal: 8, visitorCap: 600, requires: 'scenic', group: 'attraction', funding: 'fun' },
  { id: 'sportsPitches', name: 'Sports Pitches', tier: 2, w: 3, h: 2, build: 60000, upkeep: 3000, staff: 0, radius: 12, cover: { fun: 50 }, appeal: 5, visitorCap: 1000, group: 'fun', funding: 'fun' },
  { id: 'swimmingPool', name: 'Swimming Pool', tier: 2, w: 2, h: 2, build: 400000, upkeep: 30000, staff: 0, radius: 16, cover: { fun: 50, health: 5 }, visitorCap: 500, group: 'fun', funding: 'fun' },
  { id: 'cinema', name: 'Cinema', tier: 2, w: 2, h: 1, build: 250000, upkeep: 15000, staff: 0, radius: 12, cover: { fun: 50 }, noise: 10, visitorCap: 1500, group: 'fun', funding: 'fun', note: '+10 Fun town-wide; tickets offset upkeep' },
  { id: 'youthClub', name: 'Youth Club', tier: 2, w: 1, h: 1, build: 80000, upkeep: 12000, staff: 0, radius: 10, group: 'youth', funding: 'fun', note: 'crime pressure −20% within radius' },
  { id: 'botanicGarden', name: 'Botanic Garden', tier: 2, w: 4, h: 3, build: 900000, upkeep: 15000, staff: 0, radius: 16, cover: { nature: 40 }, appeal: 18, visitorCap: 3000, group: 'attraction', funding: 'fun' },
  { id: 'museum', name: 'Museum', tier: 2, w: 3, h: 2, build: 600000, upkeep: 35000, staff: 0, radius: 0, culture: 4, appeal: 20, visitorCap: 2000, group: 'culture', funding: 'culture' },
  { id: 'theatre', name: 'Theatre', tier: 3, w: 3, h: 3, build: 1500000, upkeep: 90000, staff: 0, radius: 0, culture: 7, appeal: 25, noise: 10, visitorCap: 3000, group: 'culture', funding: 'culture' },
  { id: 'stadium', name: 'Stadium', tier: 3, w: 4, h: 4, build: 6000000, upkeep: 120000, staff: 0, radius: INF, cover: { fun: 90 }, appeal: 35, noise: 60, visitorCap: 8000, group: 'fun', funding: 'fun', note: 'hosts festivals; tickets offset upkeep' },
  { id: 'clockTower', name: 'Clock Tower', tier: 3, w: 2, h: 2, build: 1000000, upkeep: 10000, staff: 0, radius: 10, culture: 3, appeal: 15, lvBonus: 30, visitorCap: 1500, group: 'landmark', funding: 'culture' },
  { id: 'grandPier', name: 'Grand Pier', tier: 3, w: 4, h: 2, build: 2000000, upkeep: 20000, staff: 0, radius: 10, appeal: 30, lvBonus: 20, visitorCap: 4000, requires: 'coast', group: 'landmark', funding: 'culture' },
  { id: 'townLandmark', name: 'Town Landmark', tier: 4, w: 3, h: 3, build: 4000000, upkeep: 40000, staff: 0, radius: 12, culture: 8, appeal: 60, lvBonus: 30, visitorCap: 8000, unique: true, group: 'landmark', funding: 'culture', note: 'one per town; the mayor picks one of 6 designs' },
];

export const BEACH = { appeal: 15, perCleanTile: 2, visitorCap: 4000 } as const;

export function buildingIndex(id: string): number {
  return BUILDINGS.findIndex((b) => b.id === id);
}

// ---- Policy cards (§6.7) ------------------------------------------------------------------

export interface PolicyDef {
  id: string;
  name: string;
  tier: Tier;
  cost: { kind: 'perResident' | 'flat' | 'free' | 'earnsPerResident' | 'fares'; amount: number };
  painted: boolean;
  effect: string;
  catch: string;
}

export const POLICY_SLOTS: readonly number[] = [0, 2, 4, 6, 8];

export const POLICIES: readonly PolicyDef[] = [
  { id: 'litterPickers', name: 'Litter Pickers', tier: 1, cost: { kind: 'perResident', amount: 0.2 }, painted: false, effect: 'Nature +5, tourism quality +3%', catch: '' },
  { id: 'neighbourhoodWatch', name: 'Neighbourhood Watch', tier: 1, cost: { kind: 'perResident', amount: 0.4 }, painted: false, effect: 'crime ×0.92', catch: 'Fun −2' },
  { id: 'farmersMarket', name: "Farmers' Market", tier: 1, cost: { kind: 'flat', amount: 5000 }, painted: false, effect: 'Shops meter +10, Fun +5', catch: 'farm jobs −10%' },
  { id: 'smokeAlarms', name: 'Smoke Alarms', tier: 1, cost: { kind: 'perResident', amount: 0.2 }, painted: false, effect: 'incident risk −40%', catch: '' },
  { id: 'cleanAirRules', name: 'Clean Air Rules', tier: 2, cost: { kind: 'free', amount: 0 }, painted: false, effect: 'industry emissions −30%', catch: 'industry costs +6%' },
  { id: 'nightMarket', name: 'Night Market', tier: 2, cost: { kind: 'earnsPerResident', amount: 0.2 }, painted: false, effect: 'Fun +8, leisure spending +8%', catch: 'noise +10 in shop cells, crime +3%' },
  { id: 'freeBusFridays', name: 'Free Bus Fridays', tier: 2, cost: { kind: 'fares', amount: 1 / 7 }, painted: false, effect: 'bus share +25%', catch: '' },
  { id: 'readingChallenge', name: 'Reading Challenge', tier: 2, cost: { kind: 'perResident', amount: 0.1 }, painted: false, effect: 'education inflow +15%', catch: '' },
  { id: 'treePlanting', name: 'Tree Planting', tier: 2, cost: { kind: 'flat', amount: 15000 }, painted: false, effect: 'pollution −10%, views +0.05', catch: '' },
  { id: 'startupHoliday', name: 'Start-up Holiday', tier: 2, cost: { kind: 'free', amount: 0 }, painted: false, effect: 'new business tiles pay no business tax for 12 months', catch: 'less revenue now' },
  { id: 'shortLetLimits', name: 'Short-let Limits', tier: 2, cost: { kind: 'free', amount: 0 }, painted: false, effect: 'stops short-let conversion', catch: 'hotel beds −10%' },
  { id: 'tourismPromotion', name: 'Tourism Promotion', tier: 2, cost: { kind: 'flat', amount: 15000 }, painted: false, effect: 'Awareness p ×3, Buzz +5', catch: 'irritation threshold −0.1' },
  { id: 'keepHomesAffordable', name: 'Keep Homes Affordable', tier: 2, cost: { kind: 'free', amount: 0 }, painted: true, effect: 'no re-tiering in the area; rent ×0.8 there', catch: 'homes tax yield there −20%' },
  { id: 'heritageProtection', name: 'Heritage Protection', tier: 3, cost: { kind: 'free', amount: 0 }, painted: true, effect: 'heritage culture ×1.5 in the area; tourism appeal +', catch: 'protected tiles cannot level up' },
  { id: 'carFreeCentre', name: 'Car-Free Centre', tier: 3, cost: { kind: 'flat', amount: 10000 }, painted: true, effect: 'noise −40% and Leisure + in the area', catch: 'car times ×1.3 inside it' },
  { id: 'greenEnergyPledge', name: 'Green Energy Pledge', tier: 3, cost: { kind: 'free', amount: 0 }, painted: false, effect: 'coal blocked; Nature +5; culture +1/month', catch: 'no cheap coal' },
];

// ---- Deal buildings (§6.6) ----------------------------------------------------------------

export interface DealDef {
  id: string;
  name: string;
  tier: Tier;
  w: number;
  h: number;
  pays: string;
  costs: string;
  lease?: number;
}

export const DEALS: readonly DealDef[] = [
  { id: 'funFair', name: 'Fun Fair', tier: 2, w: 3, h: 3, lease: 30000, pays: 'lease £30,000/month, appeal 25', costs: 'noise 40 nearby, crime +2%' },
  { id: 'recyclingYard', name: 'County Recycling Yard', tier: 2, w: 4, h: 4, lease: 25000, pays: '£25,000/month from neighbours and Kingsport', costs: 'land value −20 within 8 tiles, Nature −5' },
  { id: 'logisticsPark', name: 'Logistics Park', tier: 2, w: 4, h: 3, pays: '300 £ jobs and their business tax', costs: 'Shops meter −10, heavy trucks' },
  { id: 'filmStudio', name: 'Film Studio', tier: 3, w: 4, h: 4, pays: 'Offices meter +20, culture +2/month, appeal 10', costs: 'rents +5% town-wide' },
];

// ---- World events (§5.16) -----------------------------------------------------------------

export interface EventDef {
  id: string;
  name: string;
  effect: string;
  /** Real calendar month only (0–11), e.g. Cosy Winter in December. */
  realMonth?: number;
  coastOnly?: boolean;
}

export const EVENTS: readonly EventDef[] = [
  { id: 'factoryBoom', name: 'Factory Boom', effect: 'World_goods +20%' },
  { id: 'techFair', name: 'Tech Fair', effect: 'World_office +20%' },
  { id: 'rainySpell', name: 'Rainy Spell', effect: 'tourism −15%' },
  { id: 'festivalSeason', name: 'Festival Season', effect: 'tourism +15%' },
  { id: 'buildersShortage', name: "Builders' Shortage", effect: 'build time +1 tick' },
  { id: 'bumperHarvest', name: 'Bumper Harvest', effect: 'food price ×0.8' },
  { id: 'babyBoom', name: 'Baby Boom', effect: 'births +30%' },
  { id: 'cosyWinter', name: 'Cosy Winter', effect: 'power demand +15%', realMonth: 11 },
  { id: 'bigConcert', name: 'Big Concert', effect: 'a county festival; day trips +25%' },
  { id: 'sunnyWeekend', name: 'Sunny Weekend', effect: 'day trips +40%' },
  { id: 'ferryFun', name: 'Ferry Fun', effect: 'coast-site tourism +20%', coastOnly: true },
  { id: 'bargainWeek', name: 'Bargain Week', effect: 'shop spending +10%' },
];

// ---- Gifts and pranks (§6.8) ----------------------------------------------------------------

export const GIFTS = ['tree', 'bench', 'flowerbed', 'bandstand', 'coins', 'coach', 'thankYou'] as const;
export const PRANKS = ['duck', 'seagulls', 'rubberChicken', 'snowman'] as const;
export const GIFT_SHED_MAX = 20;

// ---- Links (§8.2) and Great Works (§8.8) ------------------------------------------------------

export interface LinkDef {
  id: 'road' | 'bus' | 'rail';
  tier: Tier;
  cost: number;
  upkeep: number;
  minutesNeighbour: number;
  minutesVia: number;
  tripsPerDay: number;
  goodsPerMonth: number;
}

export const LINKS: readonly LinkDef[] = [
  { id: 'road', tier: 1, cost: 40000, upkeep: 0, minutesNeighbour: 25, minutesVia: 50, tripsPerDay: 3000, goodsPerMonth: 2000 },
  { id: 'bus', tier: 2, cost: 60000, upkeep: 8000, minutesNeighbour: 25, minutesVia: 50, tripsPerDay: 1000, goodsPerMonth: 0 },
  { id: 'rail', tier: 3, cost: 600000, upkeep: 0, minutesNeighbour: 12, minutesVia: 24, tripsPerDay: 15000, goodsPerMonth: 10000 },
];

export interface GreatWorkDef {
  id: string;
  name: string;
  benefit: string;
}

export const GREAT_WORKS: readonly GreatWorkDef[] = [
  { id: 'countyRailway', name: 'County Railway', benefit: 'every link gets railway time and capacity; rail links unlock at Town; FreightScore +0.2' },
  { id: 'grandMuseum', name: 'Grand Museum', benefit: 'culture inflow +2/month and the Edu target +5 in every town; county tourist pool +15%' },
  { id: 'windValleyFarm', name: 'Wind Valley Farm', benefit: '3,000 free power points per town per month' },
  { id: 'wonderWheel', name: 'Wonder Wheel', benefit: 'county tourist pool +20%; Fun +10 in every town' },
];
export const GREAT_WORK_INPUTS = ['coins', 'goods', 'builders', 'culture', 'visitors', 'power'] as const;

// ---- Growth stages (§7) ------------------------------------------------------------------------

export interface TierDef {
  id: string;
  population: number;
  /** Parcel rights granted at promotion (Hamlet: the 4 central parcels at founding). */
  parcelRights: number;
  policySlots: number;
}

export const TIER_DEFS: readonly TierDef[] = [
  { id: 'hamlet', population: 0, parcelRights: 0, policySlots: 0 },
  { id: 'village', population: 300, parcelRights: 2, policySlots: 2 },
  { id: 'town', population: 2000, parcelRights: 4, policySlots: 4 },
  { id: 'city', population: 15000, parcelRights: 4, policySlots: 6 },
  { id: 'metropolis', population: 80000, parcelRights: 2, policySlots: 8 },
];

// ---- The Deputy's standing orders (§5.18): defaults for a child's and an adult's seat ------------

export interface OrderDef {
  kind: string;
  kid: boolean;
  adult: boolean;
  /** Adult-editable thresholds, documented per order. */
  args: readonly number[];
  doc: string;
}

export const ORDER_DEFAULTS: readonly OrderDef[] = [
  { kind: 'budgetHealthy', kid: true, adult: true, args: [2, 200], doc: 'reserves under args[0] months of spending and falling: Fun and Culture to Low, then homes tax up by at most args[1] bp in total; never borrows' },
  { kind: 'buyUtilities', kid: true, adult: true, args: [], doc: 'buy missing power and water from Kingsport' },
  { kind: 'fixDamaged', kid: true, adult: true, args: [], doc: 'fix damaged buildings' },
  { kind: 'renewContracts', kid: true, adult: false, args: [], doc: 'renew contracts I made, unless they lost money' },
  { kind: 'awayZoning', kid: true, adult: false, args: [12, 60, 3], doc: 'while away, zone up to args[0] Homes or Shops tiles a day next to roads when that meter is above args[1] and reserves exceed args[2] months of spending' },
  { kind: 'repayLoan', kid: false, adult: false, args: [3], doc: 'repay the Town Loan early when reserves exceed args[0] months of spending' },
  { kind: 'hold', kid: false, adult: false, args: [], doc: 'change nothing' },
];

// ---- Town names (§1.5): two preset halves; WP8 extends the lists ------------------------------

export const NAME_FIRST = ['Sunny', 'Oak', 'Elm', 'Brook', 'Meadow', 'Fox', 'Willow', 'Ash', 'Bramble', 'Kestrel', 'Hazel', 'Otter', 'Clover', 'Heather', 'Mill', 'Stone'] as const;
export const NAME_SECOND = ['vale', 'ridge', 'field', 'ford', 'bury', 'wick', 'by', 'mouth', 'stead', 'ton', 'hollow', 'dale', 'cliff', 'bridge', 'haven', 'combe'] as const;

// ---- The catalogue lint (A14) ---------------------------------------------------------------------

/** Three decimals, by arithmetic: the engine never formats numbers with platform APIs (A25). */
function milli(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Units served per month for the lint: people, seats, points or units. */
function served(b: BuildingDef): number {
  if (b.supply?.power) return b.supply.power;
  if (b.supply?.water) return b.supply.water;
  if (b.seats) return b.seats;
  return b.capacity ?? 0;
}

/**
 * A14: between two items with the same function, the one unlocked later must
 * not cost more upkeep per unit served; and no utility's full unit cost
 * (upkeep + build over 240 months) may fall below Kingsport's export price.
 * Returns human-readable problems (empty = clean).
 */
export function lintCatalogue(exportPower: number, exportWater: number): string[] {
  const out: string[] = [];
  const groups: BuildingGroup[] = ['power', 'water', 'police', 'fire', 'health', 'primary'];
  for (const g of groups) {
    const items = BUILDINGS.filter((b) => b.group === g && served(b) > 0);
    for (const a of items)
      for (const b of items) {
        if (b.tier <= a.tier) continue;
        const ua = a.upkeep / served(a);
        const ub = b.upkeep / served(b);
        if (ub > ua + 1e-9) out.push(`${b.id} (tier ${b.tier}) costs £${milli(ub)}/unit, more than ${a.id} (tier ${a.tier}) at £${milli(ua)}`);
      }
  }
  for (const b of BUILDINGS) {
    const p = b.supply?.power ?? 0;
    const w = b.supply?.water ?? 0;
    const unitCost = (b.upkeep + b.build / 240) / Math.max(1, p + w);
    if (p > 0 && unitCost < exportPower) out.push(`${b.id}: full unit cost £${milli(unitCost)} is below the power export price`);
    if (w > 0 && unitCost < exportWater) out.push(`${b.id}: full unit cost £${milli(unitCost)} is below the water export price`);
  }
  return out;
}
