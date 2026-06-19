// Shared types for Broads Pilot: bundled datasets + engine contracts.
// See docs/superpowers/specs/2026-06-19-broads-pilot-design.md §5.

export type LatLng = [number, number]; // [lat, lng]

// ---------- waterway graph ----------
export interface GraphNode {
  id: string;
  lat: number;
  lng: number;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  length_m: number;
  limit_mph: number;
  river: string;
  way_id: number;
  geometry: LatLng[];
  restriction_ids: string[];
  conservation?: boolean;
  tidal_zone?: 'breydon' | null;
  max_beam_m?: number | null;
  max_draft_m?: number | null;
}
export interface WaterGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------- restrictions ----------
export interface Bridge {
  id: string;
  name: string;
  river: string;
  clearance_ahw_m: number;
  clearance_band_m: [number, number]; // [conservative-low, optimistic-high]
  tide_dependent: boolean;
  pilot: 'mandatory' | 'recommended' | null;
  opens_on_request: boolean;
  practically_closed?: boolean;
  arch_width_m?: number | null;
  notes: string;
  lat: number;
  lng: number;
}
export interface Lock {
  id: string;
  name: string;
  max_loa_m: number;
  max_beam_m: number;
  max_draft_m: number;
  hours: string;
  booking: string;
  notes: string;
  lat: number;
  lng: number;
}
export interface Zone {
  id: string;
  type: 'conservation' | 'tidal' | 'no_hire';
  geometry: LatLng[];
  notes: string;
}
export interface Restrictions {
  bridges: Bridge[];
  lock: Lock;
  zones: Zone[];
}

// ---------- moorings ----------
export type MooringTier =
  | 'ba_free'
  | 'ba_staffed'
  | 'yacht_station'
  | 'pub'
  | 'private'
  | 'marina'
  | 'hire_yard';
export interface Mooring {
  id: string;
  name: string;
  lat: number;
  lng: number;
  node_id?: string; // nearest graph node (set at build time)
  tier: MooringTier;
  rate: { amount: number; unit: 'night' | 'metre_night' | 'day' | 'hour' | 'free' };
  waived_with_meal: boolean;
  facilities: {
    water: boolean;
    shore_power: boolean;
    pump_out: boolean;
    toilets: boolean;
    showers: boolean;
    refuse: boolean;
  };
  capacity?: number | null;
  capacity_caveat: boolean;
  last_verified: string; // year, e.g. '2025'
  source: string;
}

// ---------- POIs ----------
export type PoiKind = 'pub' | 'walk' | 'attraction' | 'shop' | 'fuel';
export interface Poi {
  id: string;
  name: string;
  kind: PoiKind;
  lat: number;
  lng: number;
  dog_friendly?: boolean | null;
  food?: boolean;
  description: string;
  place_id?: string | null;
  tripadvisor_url?: string | null;
  google_url?: string | null;
  osm_id?: string;
  source: string;
}
export type MooringPois = Record<
  string,
  { poi_id: string; dist_m: number; on_foot: boolean }[]
>;

// ---------- fleet ----------
export interface Boat {
  slug: string;
  name: string;
  class: 'modern' | 'classic' | 'dayboat' | 'generic';
  propulsion: 'diesel' | 'electric' | 'unknown';
  sleeps: number;
  bedrooms?: number;
  toilets?: number;
  showers?: number;
  length_ft?: number | null;
  beam_ft?: number | null;
  air_draft_ft: number;
  air_draft_m: number;
  beam_m?: number | null;
  water_draft_m?: number | null;
  fuel_tank_l?: number | null;
  bridges_blocked: string[]; // bridge ids the operator says this boat cannot pass
  image?: string | null;
  url?: string;
}

// ---------- engine results ----------
export type Verdict = 'pass' | 'marginal' | 'blocked';
export interface BridgeVerdict {
  bridge: Bridge;
  verdict: Verdict;
}
export interface RouteLeg {
  edges: GraphEdge[];
  distance_m: number;
  time_s: number;
  blockedAt?: Bridge | null;
  bridges: BridgeVerdict[];
  crossesBreydon: boolean;
}

// ---------- provenance ----------
export interface Meta {
  built_at: string;
  sources: Record<string, string>;
  attribution: string;
}

// ---------- bundle ----------
export interface Datasets {
  graph: WaterGraph;
  restrictions: Restrictions;
  moorings: Mooring[];
  pois: Poi[];
  mooringPois: MooringPois;
  fleet: Boat[];
  meta: Meta;
}
