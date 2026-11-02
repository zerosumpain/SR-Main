// The site's projects that work from a sofa — something to watch, or pages a
// remote's arrows can scroll — for sr. tv's "From the site" row. Curated by
// hand: most projects want a mouse. Title and address come from the
// /projects cards (`PROJECT_CARDS`); whether one shows at all is its
// /projects visibility, decided on the server (a private project never
// reaches the TV). Marbler has its own tile in the Watch row.

import { PROJECT_CARDS } from '../../projects/cards';

export interface TvProject {
  key: string;
  href: string;
  title: string;
  blurb: string;
}

/** Key → what the TV says about it (and a shorter name where the card's is long). Order is the row's. */
const TV_FRIENDLY: Record<string, { blurb: string; title?: string }> = {
  archetype: { blurb: 'An arms race you can watch — creatures evolve while you sit back.' },
  wildmind: { blurb: 'Survivors who invent. Leave it running and see what they come up with.' },
  'engine-room': { blurb: 'How this site thinks up, builds and ships things on its own.' },
  'policy-engine': { title: 'Schools simulator', blurb: 'A simulator of every school in England. Scroll with the arrows.' },
};

/** The curated projects, in row order, with their card's title and address. PURE. */
export function tvProjects(isPublic: (key: string) => boolean): TvProject[] {
  return Object.entries(TV_FRIENDLY).flatMap(([key, { blurb, title }]) => {
    const card = PROJECT_CARDS.find((c) => c.key === key);
    if (!card || !isPublic(key)) return [];
    return [{ key, href: card.href, title: title ?? card.title.split(' — ')[0], blurb }];
  });
}
