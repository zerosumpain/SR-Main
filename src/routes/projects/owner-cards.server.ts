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

// The Local Plan Navigator left this list on 2026-10-07 for PROJECT_CARDS as a
// private-by-default card (PRIVATE_BY_DEFAULT in $lib/projects/visibility), so
// the owner can hand it out with a /projects share link.
export const OWNER_ONLY_CARDS: ProjectCard[] = [
  // Wildmind runs on porkserv and is served at /wildmind/ through the site's
  // tunnel (SR-Infra registry `wildmind`). It checks every request with Main's
  // session authority itself: the owner gets the whole app, anyone else signed
  // in a read-only view, and nobody the login. The card stays owner-only; the
  // owner hands out the address.
  {
    key: 'wildmind',
    href: '/wildmind/',
    label: 'Open Wildmind',
    kind: 'Simulation',
    tag: 'Live · signed-in guests watch',
    title: 'Wildmind — survivors who invent',
    blurb:
      'Two characters, JKai and a companion, whose minds are Claude, survive in an open world that grows as they explore. Every tool, building and vehicle is designed by the model, checked against what they have actually discovered, and drawn from primitive shapes in the browser. Nothing is pre-made, and spaceflight is possible but a very long way off.',
    chips: 'Three.js · Claude · open world · independent app',
    ownerOnly: true,
  },
];
