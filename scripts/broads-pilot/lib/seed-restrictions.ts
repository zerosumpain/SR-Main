// Curated, source-grounded restrictions for the Norfolk Broads.
// Clearances from docs/superpowers/specs/2026-06-19-broads-pilot-research-brief.md §3
// (Broads Authority bridge sheet; "central clearance at average HIGH water" —
// advisory & tide-dependent). clearance_band_m = [conservative, optimistic].
// Coordinates corrected against OSM (bridge crossings). `attach_rivers` lists the
// graph river name(s) a bridge may snap onto, so it gates the correct edge.
// SAFETY: planning aids only — the app applies a 0.3 m margin, never auto-clears
// a marginal bridge, and defers to the on-site gauge board.

export interface SeedBridge {
  id: string;
  name: string;
  river: string;
  attach_rivers: string[]; // case-insensitive substrings of graph edge.river
  clearance_ahw_m: number;
  clearance_band_m: [number, number];
  tide_dependent: boolean;
  pilot: 'mandatory' | 'recommended' | null;
  opens_on_request: boolean;
  practically_closed?: boolean;
  arch_width_m?: number | null;
  notes: string;
  lat: number;
  lng: number;
}

export const BRIDGES: SeedBridge[] = [
  {
    id: 'potter-heigham-old', name: 'Potter Heigham (Old Road Bridge)', river: 'Thurne',
    attach_rivers: ['Thurne'],
    clearance_ahw_m: 1.98, clearance_band_m: [1.94, 1.98], tide_dependent: true,
    pilot: 'mandatory', opens_on_request: false, practically_closed: true, arch_width_m: 2.5,
    notes: 'Pilot mandatory (Phoenix Fleet, 01692 670460, ~£10). Low semicircular arch with steeply falling sides — effectively impassable for standard cruisers (0 boats through in 2024). Cross only near low water with the pilot.',
    lat: 52.7106, lng: 1.5818,
  },
  {
    id: 'wroxham-road', name: 'Wroxham (Road Bridge)', river: 'Bure',
    attach_rivers: ['Bure'],
    clearance_ahw_m: 2.21, clearance_band_m: [2.18, 2.21], tide_dependent: true,
    pilot: 'mandatory', opens_on_request: false, arch_width_m: 3.5,
    notes: 'Pilot mandatory for hire craft (07775 297 638, ~£15 return). 1619 arch, strong currents; height + tide affected.',
    lat: 52.7068, lng: 1.4072,
  },
  {
    id: 'wroxham-rail', name: 'Wroxham Railway Bridge', river: 'Bure',
    attach_rivers: ['Bure'],
    clearance_ahw_m: 4.57, clearance_band_m: [4.57, 4.57], tide_dependent: false,
    pilot: null, opens_on_request: false,
    notes: 'High — not a constraint for hire craft. Listed for completeness.',
    lat: 52.7045, lng: 1.4055,
  },
  {
    id: 'yarmouth-vauxhall', name: 'Great Yarmouth (Vauxhall / old rail)', river: 'Bure',
    attach_rivers: ['Bure', 'Yare', 'Breydon'],
    clearance_ahw_m: 2.06, clearance_band_m: [2.06, 2.06], tide_dependent: true,
    pilot: null, opens_on_request: false,
    notes: 'Lowest of the Yarmouth pair on the Breydon transit. Cross near low water (slack, ~1 h after LW at Yarmouth).',
    lat: 52.6115, lng: 1.7220,
  },
  {
    id: 'yarmouth-acle-road', name: 'Great Yarmouth (Acle New Road)', river: 'Bure',
    attach_rivers: ['Bure', 'Yare', 'Breydon'],
    clearance_ahw_m: 2.13, clearance_band_m: [2.13, 2.13], tide_dependent: true,
    pilot: null, opens_on_request: false,
    notes: 'On the Breydon transit; tide-dependent. Time the crossing with the Yarmouth tide.',
    lat: 52.6123, lng: 1.7227,
  },
  {
    id: 'breydon-bridge', name: 'Breydon Bridge', river: 'Breydon Water',
    attach_rivers: ['Breydon', 'Yare', 'Bure'],
    clearance_ahw_m: 3.96, clearance_band_m: [3.5, 3.96], tide_dependent: true,
    pilot: null, opens_on_request: true,
    notes: 'Fixed span ~3.96 m; lifting span ~3.5 m (opens on request). Use the right-hand span between the two arrows. On the Breydon tidal crossing.',
    lat: 52.6118, lng: 1.7154,
  },
  {
    id: 'beccles-old', name: 'Beccles (Old Road Bridge)', river: 'Waveney',
    attach_rivers: ['Waveney'],
    clearance_ahw_m: 1.98, clearance_band_m: [1.98, 1.98], tide_dependent: true,
    pilot: null, opens_on_request: false, arch_width_m: 3.0,
    notes: 'Tied lowest arched road bridge. No pilot but care required; gives access to upper Beccles/Geldeston. The bypass road bridge alongside is ~3.66 m (12 ft).',
    lat: 52.4585, lng: 1.5640,
  },
  {
    id: 'ludham-bridge', name: 'Ludham Bridge', river: 'Ant',
    attach_rivers: ['Ant'],
    clearance_ahw_m: 2.59, clearance_band_m: [2.55, 2.59], tide_dependent: true,
    pilot: null, opens_on_request: false,
    notes: 'Tide-affected (~1 ft range); pass with the canopy down. No pilot. Sharp blind bend — keep right.',
    lat: 52.6992, lng: 1.5093,
  },
  {
    id: 'wayford-bridge', name: 'Wayford Bridge', river: 'Ant',
    attach_rivers: ['Ant'],
    clearance_ahw_m: 2.13, clearance_band_m: [2.13, 2.13], tide_dependent: true,
    pilot: null, opens_on_request: false,
    notes: 'Head of navigation on the River Ant; tide-affected.',
    lat: 52.7701, lng: 1.4794,
  },
  {
    id: 'acle-bridge', name: 'Acle Bridge', river: 'Bure',
    attach_rivers: ['Bure'],
    clearance_ahw_m: 3.66, clearance_band_m: [3.66, 3.66], tide_dependent: true,
    pilot: null, opens_on_request: false,
    notes: 'Tide-affected. A constraint only for the tallest craft.',
    lat: 52.6447, lng: 1.5566,
  },
  {
    id: 'reedham-swing', name: 'Reedham Swing Bridge', river: 'Yare',
    attach_rivers: ['Yare'],
    clearance_ahw_m: 3.05, clearance_band_m: [3.05, 3.16], tide_dependent: true,
    pilot: null, opens_on_request: true,
    notes: 'Rail swing bridge — opens on request (3 long horn blasts / VHF Ch 12 / 0330 858 4655). 1 red flag = operational, 2 = out of service.',
    lat: 52.5587, lng: 1.5724,
  },
  {
    id: 'somerleyton-swing', name: 'Somerleyton Swing Bridge', river: 'Waveney',
    attach_rivers: ['Waveney'],
    clearance_ahw_m: 2.59, clearance_band_m: [2.59, 2.59], tide_dependent: false,
    pilot: null, opens_on_request: true,
    notes: 'Rail swing bridge — 8 ft 6 in (2.59 m) closed clearance; opens on request (3 long blasts / VHF Ch 12).',
    lat: 52.5125, lng: 1.6465,
  },
  {
    id: 'thorpe-rail', name: 'Thorpe Railway Bridges (Norwich)', river: 'Yare',
    attach_rivers: ['Yare', 'Wensum'],
    clearance_ahw_m: 1.83, clearance_band_m: [1.83, 1.83], tide_dependent: true,
    pilot: null, opens_on_request: false,
    notes: 'Very low (~6 ft) — on the short Whitlingham dead-end above Norwich; not on the main route to Norwich Yacht Station.',
    lat: 52.6248, lng: 1.3360,
  },
];

// Average tidal-time offset (minutes) of each bridge's local tide from the
// Gorleston (Great Yarmouth) standard port — the figure norfolk-tides.com /
// Reeds publish ("based on Gorleston with an average HW adjustment of +X min").
// Applied to BOTH HW and LW so the planner can show the local low-water
// (= maximum headroom) time at each tide-dependent bridge. Sources: norfolk-
// tides.com per-location pages + Herbert Woods / Reeds Broads LW differences.
// Omitted (no offset) = effectively non-tidal for routing (Wroxham rail high
// bridge) or offset not reliably published (Thorpe dead-end).
export const TIDE_OFFSET_MIN: Record<string, number> = {
  'yarmouth-vauxhall': 60,
  'yarmouth-acle-road': 60,
  'breydon-bridge': 60,
  'reedham-swing': 150,
  'somerleyton-swing': 150, // approx — interpolated St Olaves↔Oulton on the Waveney
  'acle-bridge': 210,
  'ludham-bridge': 240,
  'beccles-old': 240,
  'wayford-bridge': 240, // approx — head of the Ant
  'potter-heigham-old': 240,
  'wroxham-road': 270,
};

export interface SeedLock {
  id: string; name: string; max_loa_m: number; max_beam_m: number; max_draft_m: number;
  hours: string; booking: string; notes: string; lat: number; lng: number;
}
export const LOCK: SeedLock = {
  id: 'mutford', name: 'Mutford Lock (Oulton Broad)',
  max_loa_m: 22, max_beam_m: 6.5, max_draft_m: 1.7,
  hours: 'Apr–Oct ~08:00–12:00 & 13:00–17:00; Nov–Mar ~08:00–12:00 (closed bank holidays)',
  booking: 'Book ≥24 h ahead — 01502 531778 / VHF Ch 73 (~£17/day)',
  notes: 'The only lock on the Broads — the gateway from Oulton Broad to Lake Lothing and the sea. The Mutford road bridge alongside is ~2.40 m.',
  lat: 52.4718, lng: 1.7088,
};

export interface SeedZone {
  id: string; type: 'conservation' | 'tidal' | 'no_hire'; name: string;
  center: [number, number]; radius_m: number; notes: string;
}
// Map-display advisories. The graph already excludes conservation broads, so the
// router never enters them; these draw the "do not enter / take care" overlays.
export const ZONES: SeedZone[] = [
  { id: 'breydon', type: 'tidal', name: 'Breydon Water', center: [52.602, 1.69], radius_m: 2600,
    notes: 'Tidal crossing linking the Northern & Southern Broads. Cross at slack water (~1 h after low water at Great Yarmouth). Keep strictly inside the red & green posts ("Up, Red, Right"). Last safe moorings ~4 mi out at Berney Arms / Burgh Castle. Do NOT approach Haven Bridge.' },
  { id: 'hoveton-great', type: 'conservation', name: 'Hoveton Great Broad', center: [52.7155, 1.4385], radius_m: 500,
    notes: 'Conservation broad — no powered navigation. Nature trail accessible by dinghy only.' },
  { id: 'cockshoot', type: 'conservation', name: 'Cockshoot Broad', center: [52.6855, 1.4995], radius_m: 350,
    notes: 'Conservation broad — closed to navigation; boardwalk & hide reached on foot from Cockshoot Dyke moorings.' },
  { id: 'upton', type: 'conservation', name: 'Upton Broad', center: [52.6605, 1.5710], radius_m: 350,
    notes: 'Private conservation broad — no navigation.' },
];
