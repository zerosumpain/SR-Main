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
    key: 'local-plan-navigator',
    href: '/projects/local-plan-navigator',
    label: 'Open the Local Plan Navigator',
    kind: 'Prototype',
    tag: 'Owner only · Planning',
    title: 'Local Plan Navigator — Thirty Months, Three Gateways, One Map',
    blurb: 'A GOV.UK-style prototype for navigating England\'s local plan process, with stage maps, a timeline planner, checklists, cited search and model-assisted answers.',
    chips: 'GOV.UK Frontend · 2026 Regulations · NPPF · in-browser model',
    ownerOnly: true,
  },
];
