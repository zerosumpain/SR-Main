// Shape of the AI day-planner response (mirrors /api/broads-pilot/guide).
export interface PlanActivity {
  poiId: string;
  name: string;
  kind: string;
  dog: boolean | null;
  dist_m: number | null;
  length_mi: number | null;
  what: string;
  opening_hours: string | null;
}
export interface PlanStop {
  mooringId: string;
  name: string;
  lat: number;
  lng: number;
  nodeId: string;
  tier: string;
  why: string;
  activities: PlanActivity[];
  leg: {
    distance_m: number;
    time_s: number;
    fuel_l: number;
    fuel_cost: number;
    crossesBreydon: boolean;
    marginalBridges: string[];
  } | null;
  mooring: { charge: string; facilities: string[]; shorePower: boolean; capacityCaveat: boolean; lastVerified: string };
}
export interface Plan {
  summary: string;
  tips: string[];
  weather: { tempC: number; windMph: number; windDir: string; description: string; precip: number; isDay: boolean } | null;
  stops: PlanStop[];
  totals: { distance_m: number; time_s: number; fuel_l: number };
  warnings: string[];
  boat: { name: string; air_draft_m: number };
}
