// Seed fleet — the named Richardsons boats documented in research brief §5 plus a
// generic fallback. Air draft is the load-bearing routing field (canopy DOWN).
// Fuel/tank/water-draft are NEVER published by Richardsons → class-default
// estimates, flagged low-coverage in the UI. bridges_blocked = operator's
// explicit "cannot pass" statements (the engine ALSO blocks by air-draft physics).

export interface SeedBoat {
  slug: string; name: string; class: 'modern' | 'classic' | 'dayboat' | 'generic';
  propulsion: 'diesel' | 'electric' | 'unknown';
  sleeps: number; bedrooms?: number; toilets?: number; showers?: number;
  length_ft?: number | null; beam_ft?: number | null; air_draft_ft: number;
  water_draft_m?: number | null; fuel_tank_l?: number | null;
  bridges_blocked: string[]; url?: string;
}

export const ftToM = (ft: number) => Math.round(ft * 0.3048 * 100) / 100;

export const SEED_FLEET: SeedBoat[] = [
  {
    slug: 'generic-cruiser', name: 'Generic 35 ft Cruiser', class: 'generic', propulsion: 'diesel',
    sleeps: 4, bedrooms: 2, toilets: 1, showers: 1, length_ft: 35, beam_ft: 12, air_draft_ft: 7.5,
    water_draft_m: 1.0, fuel_tank_l: 110, bridges_blocked: [],
  },
  // --- Premier "Broads Sun…" class — Richardsons' newer dual-steer cruisers.
  // Air drafts are verbatim from the Richardsons /all-boats/ pages (canopy down):
  // 7ft 2in = 7.1667 ft → 2.18 m, 7ft = 7.0 ft → 2.13 m. Every one of these is
  // blocked outright at Potter Heigham and needs the mandatory Wroxham pilot.
  // Only Broads Sunrise has a verified length/beam (44 ft × 12 ft, via Hoseasons);
  // length/beam null elsewhere, and water-draft/fuel are class estimates (never
  // published per boat).
  {
    slug: 'broads-sunrise', name: 'Broads Sunrise', class: 'modern', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 2, showers: 2, length_ft: 44, beam_ft: 12, air_draft_ft: 7.1667,
    water_draft_m: 1.0, fuel_tank_l: 140, bridges_blocked: ['potter-heigham-old'],
    url: 'https://www.richardsonsboatingholidays.co.uk/all-boats/broads-sunrise/',
  },
  {
    slug: 'broads-sunset', name: 'Broads Sunset', class: 'modern', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 2, showers: 2, length_ft: null, beam_ft: null, air_draft_ft: 7.1667,
    water_draft_m: 1.0, fuel_tank_l: 140, bridges_blocked: ['potter-heigham-old'],
    url: 'https://www.richardsonsboatingholidays.co.uk/all-boats/broads-sunset/',
  },
  {
    slug: 'broads-sunray', name: 'Broads Sunray', class: 'modern', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 2, showers: 2, length_ft: null, beam_ft: null, air_draft_ft: 7.1667,
    water_draft_m: 1.0, fuel_tank_l: 140, bridges_blocked: ['potter-heigham-old'],
    url: 'https://www.richardsonsboatingholidays.co.uk/all-boats/broads-sunray/',
  },
  {
    slug: 'broads-suncharm', name: 'Broads Suncharm', class: 'modern', propulsion: 'diesel',
    sleeps: 5, bedrooms: 2, toilets: 1, showers: 1, length_ft: null, beam_ft: null, air_draft_ft: 7.0,
    water_draft_m: 0.95, fuel_tank_l: 130, bridges_blocked: ['potter-heigham-old'],
    url: 'https://www.richardsonsboatingholidays.co.uk/all-boats/broads-suncharm/',
  },
  {
    slug: 'broads-harmony', name: 'Broads Harmony', class: 'modern', propulsion: 'diesel',
    sleeps: 7, bedrooms: 3, toilets: 2, showers: 2, length_ft: null, beam_ft: null, air_draft_ft: 7.1667,
    water_draft_m: 1.05, fuel_tank_l: 150, bridges_blocked: ['potter-heigham-old'],
    url: 'https://www.richardsonsboatingholidays.co.uk/all-boats/broads-harmony/',
  },
  {
    slug: 'broads-serenade', name: 'Broads Serenade', class: 'modern', propulsion: 'diesel',
    sleeps: 9, bedrooms: 4, toilets: 2, showers: 2, length_ft: null, beam_ft: null, air_draft_ft: 7.1667,
    water_draft_m: 1.1, fuel_tank_l: 160, bridges_blocked: ['potter-heigham-old'],
    url: 'https://www.richardsonsboatingholidays.co.uk/all-boats/broads-serenade/',
  },
  {
    slug: 'dominica', name: 'Dominica', class: 'modern', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 2, showers: 1, length_ft: 45, beam_ft: 12, air_draft_ft: 7,
    water_draft_m: 1.0, fuel_tank_l: 130, bridges_blocked: [],
  },
  {
    slug: 'broadway', name: 'Broadway', class: 'modern', propulsion: 'diesel',
    sleeps: 4, bedrooms: 2, toilets: 1, showers: 1, length_ft: 38, beam_ft: 11, air_draft_ft: 6.75,
    water_draft_m: 0.95, fuel_tank_l: 110, bridges_blocked: [],
  },
  {
    slug: 'broadsman', name: 'Broadsman', class: 'classic', propulsion: 'diesel',
    sleeps: 5, bedrooms: 2, toilets: 1, showers: 1, length_ft: 40, beam_ft: 11, air_draft_ft: 6.75,
    water_draft_m: 1.0, fuel_tank_l: 110, bridges_blocked: [],
  },
  {
    slug: 'commodore', name: 'Commodore', class: 'classic', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 2, showers: 1, length_ft: 46, beam_ft: 12, air_draft_ft: 8.75,
    water_draft_m: 1.1, fuel_tank_l: 140, bridges_blocked: ['potter-heigham-old', 'wayford-bridge', 'wroxham-road', 'beccles-old'],
  },
  {
    slug: 'san-francisco', name: 'San Francisco', class: 'modern', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 2, showers: 1, length_ft: 44, beam_ft: 13, air_draft_ft: 7,
    water_draft_m: 1.05, fuel_tank_l: 140, bridges_blocked: ['potter-heigham-old'],
  },
  {
    slug: 'broadsventure', name: 'Broadsventure', class: 'modern', propulsion: 'diesel',
    sleeps: 8, bedrooms: 4, toilets: 2, showers: 2, length_ft: 48, beam_ft: 13, air_draft_ft: 7.5,
    water_draft_m: 1.1, fuel_tank_l: 150, bridges_blocked: ['potter-heigham-old'],
  },
  {
    slug: 'fair-royal', name: 'Fair Royal', class: 'classic', propulsion: 'diesel',
    sleeps: 4, bedrooms: 2, toilets: 1, showers: 1, length_ft: 36, beam_ft: 11, air_draft_ft: 6.5,
    water_draft_m: 0.9, fuel_tank_l: 100, bridges_blocked: [],
  },
  {
    slug: 'star-gem', name: 'Star Gem', class: 'modern', propulsion: 'diesel',
    sleeps: 6, bedrooms: 3, toilets: 1, showers: 1, length_ft: 42, beam_ft: 12, air_draft_ft: 6.75,
    water_draft_m: 1.0, fuel_tank_l: 120, bridges_blocked: ['potter-heigham-old'],
  },
  {
    slug: 'electric-day-boat-8', name: '8-Seater Electric Day Boat', class: 'dayboat', propulsion: 'electric',
    sleeps: 0, toilets: 0, showers: 0, length_ft: 23, beam_ft: 8, air_draft_ft: 5,
    water_draft_m: 0.6, fuel_tank_l: null, bridges_blocked: [],
  },
  {
    slug: 'electric-day-boat-6', name: '6-Seater Electric Day Boat', class: 'dayboat', propulsion: 'electric',
    sleeps: 0, toilets: 0, showers: 0, length_ft: 20, beam_ft: 7.5, air_draft_ft: 4.75,
    water_draft_m: 0.55, fuel_tank_l: null, bridges_blocked: [],
  },
];
