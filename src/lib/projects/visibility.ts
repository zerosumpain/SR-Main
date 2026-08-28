// Pure visibility logic for /projects.
//
// Two kinds of key share one namespace and get OPPOSITE defaults.
//
//  - A hand-built project page (STATIC_PROJECT_KEYS) is PUBLIC unless a row
//    marks it private. That is how the feature shipped; the cards on /projects
//    and every `requireProjectPublic()` page rely on it.
//  - Anything else — an AI build's publishedSlug — is PRIVATE unless a row
//    publishes it. Builds arrive without being asked for: the Forge finishes a
//    self-improvement run and opens a PR, a headless turn calls `build_control
//    publish`. Under "absence means public" each one went live on /projects the
//    moment it completed, and the only thing standing between a change-request
//    PR and the public index was someone noticing and toggling it off by hand
//    (15 such rows existed in prod on 2026-08-22, every one added after the
//    fact). A default the site can trip on its own has to fail closed.

// The hardcoded "Field Study" cards on /projects, keyed by their URL segment
// (the part after /projects/). These are the ONLY keys that default to public.
//
// IMPORTANT: every key rendered by a `visToggle(...)` card in
// src/routes/projects/+page.svelte MUST appear here, or its public/private
// toggle silently fails (POST /api/projects/visibility → 400 Unknown project
// key → the page reverts optimistically). src/lib/projects/registry-cards.test.ts
// guards this parity so a new card can't ship un-toggleable.
//
// A relocated static bundle belongs here too even when it renders no card —
// `pulse` is reachable by URL only and is not a build, so without an entry the
// build default would 404 it.
export const STATIC_PROJECT_KEYS = [
  'engine-room',
  'scs-earnings',
  'broads-pilot',
  'terminal-descent',
  'data-standard-designer',
  'data-spine',
  'spine-in-practice',
  'dfe-data-strategy',
  'dfe-data-estate',
  'policy-engine',
  'whitehall',
  'brass-and-rails',
  'archetype',
  'data-convergence',
  'bathroom',
  'pulse',
] as const;

const STATIC_KEYS: ReadonlySet<string> = new Set(STATIC_PROJECT_KEYS);

/** A /projects address: one lowercase URL segment, as `slugifyTitle` produces. */
const PROJECT_SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface VisibilityRow {
  projectKey: string;
  isPublic: boolean;
}

export type VisibilityMap = Record<string, boolean>;

/** Collapse DB rows into a `key -> isPublic` lookup. */
export function resolveVisibilityMap(rows: VisibilityRow[]): VisibilityMap {
  const map: VisibilityMap = {};
  for (const row of rows) map[row.projectKey] = row.isPublic;
  return map;
}

/** One of the hand-built project pages, as opposed to an AI build's slug. */
export function isStaticProjectKey(key: string): boolean {
  return STATIC_KEYS.has(key);
}

/**
 * Is this `published_slug` a /projects address at all?
 *
 * A git-target build stores its PR URL or branch ref in the SAME column a
 * static build stores its slug in (see the `gitTargetConfig` note on
 * `jkai_builds`). So `https://github.com/zerosumpain/SR-Main/pull/341` and
 * `master...agent/ab2-a15e73d3` both reached /projects as cards linking at
 * `/projects/https://…`. Neither is an address, and neither ever belonged in
 * the listing — a PR is a thing to review, not a project to visit.
 */
export function isProjectSlug(slug: string | null | undefined): slug is string {
  return typeof slug === 'string' && PROJECT_SLUG.test(slug);
}

/** What a key resolves to when `project_visibility` has no row for it. */
export function defaultsPublic(key: string): boolean {
  return isStaticProjectKey(key);
}

/** An explicit row always wins; otherwise the key's own default applies. */
export function isProjectPublic(map: VisibilityMap, key: string): boolean {
  return map[key] ?? defaultsPublic(key);
}

/** Authed viewers see everything; the public sees only public projects. */
export function filterForViewer<T extends { key: string }>(
  items: T[],
  map: VisibilityMap,
  authed: boolean,
): T[] {
  if (authed) return items;
  return items.filter((item) => isProjectPublic(map, item.key));
}
