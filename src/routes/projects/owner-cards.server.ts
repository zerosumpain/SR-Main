// Cards for pages that exist on /projects but must never be advertised.
//
// SERVER ONLY, and the filename says so: `*.server.ts` makes a client import a
// build error. That is the point. `./cards.ts` is imported by `+page.svelte`,
// so every key, title and blurb in it ships to anonymous visitors inside a JS
// chunk whether or not the card renders — which for these pages would publish
// the one fact they are hiding. These never leave the server unless the viewer
// is the owner.
//
// Why not just add them to PROJECT_CARDS and toggle them private?
// `registry-cards.test.ts` forces every carded key into STATIC_PROJECT_KEYS,
// and that list is the set whose default is PUBLIC (see $lib/projects/
// visibility). A card there is public on first deploy until somebody remembers
// to write a `project_visibility` row by hand — a default that fails open, on a
// page rendering five people's movements. An owner-only card carries no
// visibility key at all, so there is nothing to forget and no toggle to misclick.

import type { ProjectCard } from './cards';

export const OWNER_ONLY_CARDS: ProjectCard[] = [
  {
    key: 'landgrab',
    href: '/projects/landgrab',
    label: 'Open Landgrab',
    kind: 'Tool',
    tag: 'Private · Household',
    title: 'Landgrab — Territory From The Family’s Own Movements',
    blurb:
      'Every walk, run and ride the household records paints ground. Close a loop and everything inside it is yours — until somebody walks it more recently, and more often, than you did. Life360 trails and Apple workouts become owned cells on a hidden 44 m grid, dissolved into smoothed territory, scored on a 30-day half-life so stale ground goes cheap.',
    chips: 'Life360 + Apple · 44 m cells · 30-day decay',
    ownerOnly: true,
  },
];
