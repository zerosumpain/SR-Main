// Curated mooring metadata (charges/facilities/tier) overlaid by NAME onto OSM
// mooring/marina features, plus a few EXTRA well-known moorings that may be
// missing or unnamed in OSM. Charges from research brief §4 (2025 season).

export type Tier = 'ba_free' | 'ba_staffed' | 'yacht_station' | 'pub' | 'private' | 'marina' | 'hire_yard';
export interface Facilities { water: boolean; shore_power: boolean; pump_out: boolean; toilets: boolean; showers: boolean; refuse: boolean }
export interface Meta {
  tier: Tier;
  rate: { amount: number; unit: 'night' | 'metre_night' | 'day' | 'hour' | 'free' };
  waived_with_meal?: boolean;
  facilities?: Partial<Facilities>;
  capacity?: number | null;
  capacity_caveat?: boolean;
  last_verified?: string;
}
export const F = (f: Partial<Facilities> = {}): Facilities =>
  ({ water: false, shore_power: false, pump_out: false, toilets: false, showers: false, refuse: false, ...f });

// Name-keyed overlay: first match wins.
export const CURATED: { match: RegExp; meta: Meta }[] = [
  { match: /norwich.*(yacht station|yacht stn)|yacht station.*norwich/i, meta: { tier: 'yacht_station', rate: { amount: 18, unit: 'night' }, facilities: F({ water: true, shore_power: true, toilets: true, showers: true, refuse: true }), last_verified: '2025' } },
  { match: /(great )?yarmouth.*yacht station/i, meta: { tier: 'yacht_station', rate: { amount: 12, unit: 'night' }, facilities: F({ water: true, shore_power: true, toilets: true, showers: true }), last_verified: '2025' } },
  { match: /oulton broad.*yacht station|nicholas everitt/i, meta: { tier: 'yacht_station', rate: { amount: 12, unit: 'night' }, facilities: F({ water: true, shore_power: true, toilets: true }), last_verified: '2025' } },
  { match: /brundall bay/i, meta: { tier: 'marina', rate: { amount: 21, unit: 'metre_night' }, facilities: F({ water: true, shore_power: true, pump_out: true, toilets: true, showers: true, refuse: true }), last_verified: '2025' } },
  { match: /ferry marina|horning.*marina|swan.*marina|wroxham.*marina|brooms|brundall.*marina/i, meta: { tier: 'marina', rate: { amount: 20, unit: 'night' }, facilities: F({ water: true, shore_power: true, pump_out: true, toilets: true, showers: true, refuse: true }), last_verified: '2025' } },
  { match: /swan.*horning|new inn.*horning|ferry inn|the lion|maltsters|the ship|berney arms|the falgate|kings head|the pleasure boat|the dog/i, meta: { tier: 'pub', rate: { amount: 5, unit: 'night' }, waived_with_meal: true, facilities: F({}), last_verified: '2025' } },
  { match: /salhouse broad/i, meta: { tier: 'private', rate: { amount: 10, unit: 'night' }, facilities: F({}), last_verified: '2025' } },
  { match: /reedham quay|reedham.*moor/i, meta: { tier: 'ba_staffed', rate: { amount: 12, unit: 'night' }, facilities: F({ water: true }), last_verified: '2025' } },
  { match: /ranworth/i, meta: { tier: 'ba_staffed', rate: { amount: 6, unit: 'night' }, facilities: F({ water: true }), capacity_caveat: true, last_verified: '2025' } },
  { match: /st benet|cockshoot|how hill|acle bridge|coltishall|neatishead|womack|ludham bridge|hardley|gay'?s staithe|sutton staithe|thurne/i, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({}), capacity_caveat: true, last_verified: '2025' } },
  { match: /richardson|stalham staithe/i, meta: { tier: 'hire_yard', rate: { amount: 0, unit: 'free' }, facilities: F({ water: true, pump_out: true }), last_verified: '2025' } },
];

export interface ExtraMooring { name: string; lat: number; lng: number; meta: Meta }
export const EXTRA: ExtraMooring[] = [
  { name: 'Ranworth Staithe', lat: 52.6677, lng: 1.4958, meta: { tier: 'ba_staffed', rate: { amount: 6, unit: 'night' }, facilities: F({ water: true, toilets: true }), capacity_caveat: true, last_verified: '2025' } },
  { name: 'Reedham Quay', lat: 52.5666, lng: 1.5712, meta: { tier: 'ba_staffed', rate: { amount: 12, unit: 'night' }, facilities: F({ water: true }), last_verified: '2025' } },
  { name: 'Norwich Yacht Station', lat: 52.6268, lng: 1.3108, meta: { tier: 'yacht_station', rate: { amount: 18, unit: 'night' }, facilities: F({ water: true, shore_power: true, toilets: true, showers: true, refuse: true }), last_verified: '2025' } },
  { name: 'Great Yarmouth Yacht Station', lat: 52.6097, lng: 1.7288, meta: { tier: 'yacht_station', rate: { amount: 12, unit: 'night' }, facilities: F({ water: true, shore_power: true, toilets: true, showers: true }), last_verified: '2025' } },
  { name: "St Benet's Abbey", lat: 52.6758, lng: 1.5258, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({}), capacity: 60, capacity_caveat: true, last_verified: '2025' } },
  { name: 'How Hill', lat: 52.7092, lng: 1.4794, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({}), capacity_caveat: true, last_verified: '2025' } },
  { name: 'Coltishall Common', lat: 52.7268, lng: 1.3760, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({ water: true }), capacity_caveat: true, last_verified: '2025' } },
  { name: 'Acle Bridge Moorings', lat: 52.6447, lng: 1.5566, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({ water: true, shore_power: true }), capacity_caveat: true, last_verified: '2025' } },
  { name: 'Stalham Staithe (Richardsons)', lat: 52.7772, lng: 1.5072, meta: { tier: 'hire_yard', rate: { amount: 0, unit: 'free' }, facilities: F({ water: true, pump_out: true, refuse: true }), last_verified: '2025' } },
  { name: 'Horning Staithe', lat: 52.7088, lng: 1.4178, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({}), capacity: 10, capacity_caveat: true, last_verified: '2025' } },
  { name: 'Womack Water (Ludham)', lat: 52.7052, lng: 1.5410, meta: { tier: 'ba_free', rate: { amount: 0, unit: 'free' }, facilities: F({ water: true }), capacity_caveat: true, last_verified: '2025' } },
];
