// scrape-richardsons.ts — fleet.json. Attempts to scrape the Richardsons fleet
// for real boat names + air drafts; merges with (and falls back to) the curated
// seed. Air draft is parsed canopy-DOWN. Fuel/tank/water-draft are never
// published → class-default estimates flagged low-coverage.
//
// Run:  npx tsx scripts/broads-pilot/scrape-richardsons.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_FLEET, ftToM, type SeedBoat } from './lib/seed-fleet.ts';

const DIR = join(process.cwd(), 'static', 'broads-pilot');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const BASE = 'https://www.richardsonsboatingholidays.co.uk';

interface OutBoat {
  slug: string; name: string; class: SeedBoat['class']; propulsion: SeedBoat['propulsion'];
  sleeps: number; bedrooms?: number; toilets?: number; showers?: number;
  length_ft?: number | null; beam_ft?: number | null; air_draft_ft: number; air_draft_m: number;
  beam_m?: number | null; water_draft_m?: number | null; fuel_tank_l?: number | null;
  bridges_blocked: string[]; url?: string; source: string;
}

const fetchText = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
};

function parseAirDraftFt(html: string): number | null {
  // "Air Draft: 6ft 9in", "Air Draught 2.06m", "6' 9\"" near 'air draft'
  const m = html.match(/air\s*drau?ght[^0-9]{0,12}(\d+)\s*(?:ft|')\s*(\d+)?/i);
  if (m) return parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) / 12 : 0);
  const mm = html.match(/air\s*drau?ght[^0-9]{0,12}(\d+(?:\.\d+)?)\s*m/i);
  if (mm) return parseFloat(mm[1]) / 0.3048;
  return null;
}

function fromSeed(b: SeedBoat): OutBoat {
  return {
    slug: b.slug, name: b.name, class: b.class, propulsion: b.propulsion, sleeps: b.sleeps,
    bedrooms: b.bedrooms, toilets: b.toilets, showers: b.showers, length_ft: b.length_ft ?? null,
    beam_ft: b.beam_ft ?? null, air_draft_ft: b.air_draft_ft, air_draft_m: ftToM(b.air_draft_ft),
    beam_m: b.beam_ft ? ftToM(b.beam_ft) : null, water_draft_m: b.water_draft_m ?? null,
    fuel_tank_l: b.fuel_tank_l ?? null, bridges_blocked: b.bridges_blocked, url: b.url, source: 'seed',
  };
}

async function main() {
  const fleet = new Map<string, OutBoat>();
  for (const b of SEED_FLEET) fleet.set(b.slug, fromSeed(b));

  console.log('· attempting Richardsons fleet scrape…');
  const index = await fetchText(`${BASE}/all-boats/`);
  let scraped = 0;
  if (index) {
    const slugs = [...new Set([...index.matchAll(/\/all-boats\/([a-z0-9-]+)\/?/gi)].map((m) => m[1]))]
      .filter((s) => s && s !== 'all-boats').slice(0, 60);
    console.log(`  index OK, ${slugs.length} candidate boats`);
    for (const slug of slugs) {
      const html = await fetchText(`${BASE}/all-boats/${slug}/`);
      if (!html) continue;
      const nameM = html.match(/<h1[^>]*>([^<]{2,60})<\/h1>/i);
      const name = nameM ? nameM[1].trim() : slug;
      const airFt = parseAirDraftFt(html);
      if (airFt == null) continue; // air draft is the must-have field
      const blocked: string[] = [];
      const lower = html.toLowerCase();
      if (/can(?:not|'t)\s+pass[^.]*potter/.test(lower) || /not.*potter heigham/.test(lower)) blocked.push('potter-heigham-old');
      if (/can(?:not|'t)\s+pass[^.]*wroxham|wroxham[^.]*pilot/.test(lower)) blocked.push('wroxham-road');
      if (/can(?:not|'t)\s+pass[^.]*wayford/.test(lower)) blocked.push('wayford-bridge');
      if (/can(?:not|'t)\s+pass[^.]*beccles/.test(lower)) blocked.push('beccles-old');
      const sleepsM = lower.match(/sleeps?\s*(\d+)/);
      fleet.set(slug, {
        slug, name, class: 'modern', propulsion: 'diesel',
        sleeps: sleepsM ? parseInt(sleepsM[1], 10) : 4, air_draft_ft: Math.round(airFt * 100) / 100,
        air_draft_m: ftToM(airFt), length_ft: null, beam_ft: null, beam_m: null,
        water_draft_m: null, fuel_tank_l: null, bridges_blocked: blocked,
        url: `${BASE}/all-boats/${slug}/`, source: 'scrape',
      });
      scraped++;
    }
  }
  console.log(`  scraped ${scraped} boats (rest from seed)`);

  const out = [...fleet.values()].sort((a, b) => (a.class === 'generic' ? -1 : 0) - (b.class === 'generic' ? -1 : 0) || a.name.localeCompare(b.name));
  writeFileSync(join(DIR, 'fleet.json'), JSON.stringify(out));
  console.log(`✓ fleet.json: ${out.length} boats (${scraped} scraped, ${out.length - scraped} seed)`);
  if (out.length < 8) throw new Error(`fleet too small (${out.length})`);
}

main().catch((e) => { console.error('scrape-richardsons FAILED:', e); process.exit(1); });
