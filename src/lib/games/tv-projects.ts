// The site's projects that work from a sofa — something to watch, or pages a
// remote's arrows can scroll — for sr. tv's "From the site" row. Curated by
// hand: most projects want a mouse. Keys are the /projects keys; whether one
// shows at all is its /projects visibility, decided by the caller on the
// server (a private project never reaches the TV). Marbler has its own tile
// in the Watch row.

export interface TvProject {
  key: string;
  href: string;
  title: string;
  blurb: string;
}

/** In row order. Addresses match the /projects cards (src/routes/projects/cards.ts). */
const TV_FRIENDLY: TvProject[] = [
  { key: 'archetype', href: '/projects/archetype/', title: 'Archetype', blurb: 'An arms race you can watch — creatures evolve while you sit back.' },
  { key: 'wildmind', href: '/wildmind/', title: 'Wildmind', blurb: 'Survivors who invent. Leave it running and see what they come up with.' },
  { key: 'engine-room', href: '/projects/engine-room', title: 'The Engine Room', blurb: 'How this site thinks up, builds and ships things on its own.' },
  { key: 'policy-engine', href: '/projects/policy-engine', title: 'Schools simulator', blurb: 'A simulator of every school in England. Scroll with the arrows.' },
];

/** The curated projects that are public, in row order. PURE. */
export function tvProjects(isPublic: (key: string) => boolean): TvProject[] {
  return TV_FRIENDLY.filter((p) => isPublic(p.key));
}
