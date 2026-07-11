// Site-media catalogue for the deck editor's picker: what on this site can be
// dropped into a slide, structured by kind. Server-safe (built in the edit
// page load — the scenario list and static-image scan need the server).

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EMBEDS } from './embeds';

export interface MediaInteractive {
  embed: string;
  label: string;
  doc: string;
  scenarios: { id: string; title: string; group: string }[];
}

export interface MediaPage {
  path: string;
  title: string;
  note: string;
}

export interface MediaImage {
  src: string;
  label: string;
}

export interface MediaCatalogue {
  interactives: MediaInteractive[];
  pages: MediaPage[];
  images: MediaImage[];
}

/** Curated public pages that frame well inside a slide. The browse tab lets
 *  the owner navigate to anything else; these are the good defaults. */
const CURATED_PAGES: MediaPage[] = [
  { path: '/', title: 'Landing — vital signs', note: 'Live tiles: biome, GPS, workflows' },
  { path: '/projects', title: 'Projects index', note: 'The public field-study shelf' },
  { path: '/decks', title: 'Decks gallery', note: 'Published presentations' },
  { path: '/blog', title: 'Blog', note: 'Posts index' },
];

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg)$/i;

/** Images shipped in static/ — the repo is present on both homeserv and the
 *  VPS, so a direct scan works in dev and production alike. */
function scanStaticImages(): MediaImage[] {
  try {
    const root = join(process.cwd(), 'static', 'images');
    const out: MediaImage[] = [];
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !IMAGE_EXT.test(entry.name)) continue;
      const parent = entry.parentPath ?? (entry as { path?: string }).path ?? root;
      const rel = join(parent, entry.name).slice(join(process.cwd(), 'static').length);
      out.push({
        src: rel.replaceAll('\\', '/'),
        label: entry.name.replace(IMAGE_EXT, '').replace(/[-_]+/g, ' '),
      });
    }
    return out.sort((a, b) => a.src.localeCompare(b.src)).slice(0, 200);
  } catch {
    return [];
  }
}

export async function buildMediaCatalogue(): Promise<MediaCatalogue> {
  const { SCENARIOS } = await import('$lib/sim/federation/scenarios');
  const interactives: MediaInteractive[] = Object.entries(EMBEDS).map(([embed, def]) => ({
    embed,
    label: def.label,
    doc: def.doc,
    scenarios:
      embed === 'federation-sim'
        ? SCENARIOS.map((s) => ({ id: s.id, title: s.title, group: s.group }))
        : [],
  }));
  return { interactives, pages: CURATED_PAGES, images: scanStaticImages() };
}
