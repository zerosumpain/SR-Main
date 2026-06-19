// build-meta.ts — provenance stamp for the /method page + "data last updated".
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const meta = {
  built_at: new Date().toISOString(),
  sources: {
    waterway_network: 'OpenStreetMap via Overpass (ODbL) — one connected navigable graph',
    speed_limits: 'Broads Authority Speed Limit Byelaws 1992 — representative per-reach (3/4/5/6 mph)',
    bridges: 'Broads Authority bridge clearances — advisory, average high water, tide-dependent',
    moorings: 'OpenStreetMap + Broads Authority visitor moorings & yacht stations (2025 charges)',
    pois: 'OpenStreetMap (ODbL) waterside pubs & attractions + curated dog-friendly walks',
    fleet: 'Richardsons Boating Holidays — curated representative sample (air draft canopy-down)',
    ratings: 'Google Places API + deep-links to TripAdvisor/Google',
  },
  attribution:
    'Map data © OpenStreetMap contributors (ODbL). Navigation facts from the Broads Authority. Boat specifications from Richardsons Boating Holidays. A planning aid only — NOT for navigation; always check the on-site gauge boards and Broads Authority notices.',
};

writeFileSync(join(process.cwd(), 'static', 'broads-pilot', 'meta.json'), JSON.stringify(meta));
console.log('✓ meta.json:', meta.built_at);
